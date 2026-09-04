/**
 * match-faq — the ONE matching module. (F25, 2026-09-02)
 *
 * Called by the FAQ page's support forms today and available to the mobile app
 * later without an API redesign. Phase 1A approved moving this capability from
 * Duplicated to Shared Core on exactly that basis.
 *
 * ── What it does, and the line it must not cross ───────────────────────────
 * It reads what a customer wrote and returns which PUBLISHED answers address
 * it. It never composes an answer. What a customer reads is always what a
 * staffer wrote — Wael's rule from the ticket system, applied here: AI may
 * point at an answer, a person writes it.
 *
 * It must also be able to return NOTHING. A matcher that always finds
 * something sends a person with a real bug off to read an irrelevant article
 * instead of getting help.
 *
 * ── The response contract (Phase 2 §5) ─────────────────────────────────────
 * Three properties, each expensive to change once a surface depends on it:
 *   1. `matches` is ALWAYS a list — never a single answer — so a future
 *      surface can show one, two or five without an API change.
 *   2. An empty list is a valid, meaningful answer: status 'no_match'.
 *   3. 'unavailable' is DISTINCT from 'no_match', so a page can stay silent
 *      during an outage rather than telling a customer nothing matched when
 *      nothing was actually checked.
 *
 * ── Phase 3 A1 — this endpoint is unauthenticated and spends money ─────────
 * Anyone who finds the URL can call it. Three controls, approved as c + e + b:
 *   (c) input validation before any model call
 *   (e) cache by normalised input — a repeat, real or a probe, costs nothing
 *   (b) rate limit per SUBJECT — the signed-in user where there is one, the
 *       address otherwise. It was per-IP until F25 Stage 2 (2026-09-04); the
 *       mobile app arrives behind carrier NAT, where an address is shared by
 *       many people. See resolveSubject().
 * Option (d) — keyword-filter first, AI only on a miss — was REJECTED: it
 * reverses the AI-every-submission behaviour Wael approved on 2026-09-02.
 * Do not reintroduce it as an optimisation.
 *
 * ⚠️ THIS FUNCTION MUST STAY DEPLOYED WITH --no-verify-jwt.
 * It reads an Authorization header when one is present, but it must remain
 * callable with none: mynaavi.com/report and /contact send no credentials.
 * With gateway JWT verification on, those pages get a 401 BEFORE this code
 * runs, and no amount of correct fail-open in here would help.
 *
 * ── Phase 3 A3 — non-determinism ──────────────────────────────────────────
 * The model is given the slug list and asked to select from it; every returned
 * slug is then validated against that list and anything unknown is discarded.
 * An invented answer is therefore structurally impossible, not merely
 * instructed against.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

const MODEL = 'claude-haiku-4-5-20251001';
const FAQ_BASE_URL = 'https://mynaavi.com/faq';

// (c) input validation
const MIN_CHARS = 8;
const MAX_CHARS = 2000;

// (b) rate limit
const WINDOW_MINUTES = 5;
const MAX_PER_WINDOW = 20;

const MAX_MATCHES = 3;

/**
 * Who is this request counted against?
 *
 * A signed-in caller is counted as themselves; everyone else is counted by
 * address. Added by F25 Stage 2 because the mobile app arrives behind carrier
 * NAT, where many customers share one address and an IP-keyed limit would put
 * them in a single bucket.
 *
 * ⚠️ THREE THINGS THIS MUST KEEP DOING, each with a reason:
 *
 *  1. It must never refuse. The function stays fully usable with no
 *     credentials at all — the public website sends none. Identity decides
 *     WHICH bucket a caller is counted in, never WHETHER they are served.
 *
 *  2. It must not call getUser when no real token arrived. Verification was
 *     measured at 132 ms; paying that on every website request for a token
 *     nobody sent is pure waste.
 *
 *  3. ⭐ The anon key is NOT an identity. app/contact.tsx falls back to it
 *     when there is no session, and that value is byte-identical on every
 *     install — so treating it as a subject would put every signed-out app
 *     user in ONE bucket, which is strictly worse than the address they came
 *     from. It resolves to no identity and falls through.
 *
 * The "user:" / "ip:" prefixes keep the two namespaces from colliding: an
 * address can never hash to the same subject as an account.
 */
async function resolveSubject(
  req: Request,
  admin: ReturnType<typeof createClient>,
): Promise<{ hash: string; kind: 'user' | 'ip' }> {
  const ipFallback = async () => {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
    return { hash: await sha256(`ip:${ip}`), kind: 'ip' as const };
  };

  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim();

  // (2) and (3): no token, or the anon key, is no identity — and no auth call.
  if (!token) return ipFallback();
  if (token === Deno.env.get('SUPABASE_ANON_KEY')) return ipFallback();

  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user?.id) return ipFallback();
    return { hash: await sha256(`user:${data.user.id}`), kind: 'user' as const };
  } catch (err) {
    // (1) — an auth outage must not take the FAQ matcher down with it.
    console.error(
      '[match-faq] identity check threw, counting by address instead:',
      err instanceof Error ? err.message : String(err),
    );
    return ipFallback();
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let text = '';
  let surface = 'unknown';
  try {
    const body = await req.json();
    text = String(body.text ?? '').trim();
    surface = String(body.surface ?? 'unknown').slice(0, 40);
  } catch {
    return json({ ok: false, status: 'unavailable', matches: [], error: 'bad_request' }, 400);
  }

  // ── (c) validate before spending anything ───────────────────────────────
  if (text.length < MIN_CHARS || text.length > MAX_CHARS) {
    // Not an error the customer needs to see — there is simply nothing to
    // match on yet. 'no_match' is honest: nothing matched, because nothing
    // was worth matching.
    return json({ ok: true, status: 'no_match', matches: [] });
  }

  const normalised = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const inputHash = await sha256(normalised);

  try {
    // ── (e) cache ─────────────────────────────────────────────────────────
    const { data: cached } = await admin
      .from('faq_match_cache')
      .select('result, hit_count')
      .eq('input_hash', inputHash)
      .maybeSingle();

    if (cached) {
      const row = cached as { result: unknown; hit_count: number };
      // Best-effort counter; a failure here must never cost the caller a
      // result they already have.
      admin.from('faq_match_cache')
        .update({ hit_count: (row.hit_count ?? 1) + 1 })
        .eq('input_hash', inputHash)
        .then(undefined, (e: unknown) =>
          console.error('[match-faq] hit_count update failed:', e instanceof Error ? e.message : String(e)));
      return json({ ok: true, cached: true, ...(row.result as Record<string, unknown>) });
    }

    // ── identity, then (b) rate limit ─────────────────────────────────────
    //
    // Placement is load-bearing and was approved as part of the design, not
    // chosen here: AFTER the cache, BEFORE the limiter. A cached answer then
    // costs neither the model call nor the 132 ms an auth round trip was
    // measured to take — the same reasoning the limiter itself already
    // carries, "only for calls that will actually cost money".
    const subject = await resolveSubject(req, admin);
    const windowStart = new Date(Math.floor(Date.now() / (WINDOW_MINUTES * 60_000)) * (WINDOW_MINUTES * 60_000)).toISOString();

    // A2 — one atomic statement increments and returns the resulting count, so
    // "did this request cross the threshold" is answered by the statement that
    // produced the number. It used to be select -> compute -> upsert, which
    // lost updates under concurrency; mobile is the population most able to
    // produce that. See the migration and Architecture Reference §2c.
    const { data: countAfter, error: countErr } = await admin.rpc('count_faq_match_request', {
      p_subject_hash: subject.hash,
      p_window_start: windowStart,
    });

    if (countErr) {
      // A1 — FAIL OPEN, LOUDLY. Wael, 2026-09-04: log the failure, preserve
      // availability. Refusing a real customer to guard against a cost that
      // only appears while the database is unhealthy is the wrong trade for a
      // support form.
      //
      // This block exists because the previous code discarded this error
      // entirely: a failed read produced used = 0, so the limit silently never
      // tripped, and the only control between a public paid endpoint and an
      // unbounded bill could stop working without a single log line.
      console.error(
        `[match-faq] RATE LIMIT NOT ENFORCED — counter failed for ${subject.kind} ` +
        `surface=${surface}: ${countErr.message}`,
      );
    } else if ((countAfter as number) > MAX_PER_WINDOW) {
      console.warn(
        `[match-faq] rate limited ${subject.kind}=${subject.hash.slice(0, 8)}… ` +
        `surface=${surface} count=${countAfter}`,
      );
      // 'unavailable', not 'no_match' — nothing was checked, and the caller
      // must be able to tell the difference (contract property 3).
      return json({ ok: false, status: 'unavailable', matches: [], error: 'rate_limited' }, 429);
    }

    // ── the published answers the model may choose from ───────────────────
    const { data: items, error: itemsErr } = await admin
      .from('faq_items')
      .select('slug, question, search_terms')
      .eq('active', true);

    if (itemsErr) {
      console.error('[match-faq] items query failed:', itemsErr.message);
      return json({ ok: false, status: 'unavailable', matches: [] }, 500);
    }
    const published = (items ?? []) as { slug: string; question: string; search_terms: string[] }[];
    if (!published.length) return json({ ok: true, status: 'no_match', matches: [] });

    const matched = await askModel(text, published);
    if (matched === null) {
      // The model could not run. NOT the same as finding nothing.
      return json({ ok: false, status: 'unavailable', matches: [] }, 503);
    }

    const result = {
      status: matched.length ? 'matched' : 'no_match',
      matches: matched,
    };

    await admin.from('faq_match_cache')
      .upsert({ input_hash: inputHash, result }, { onConflict: 'input_hash' });

    return json({ ok: true, ...result });
  } catch (err) {
    console.error('[match-faq] threw:', err instanceof Error ? err.message : String(err));
    return json({ ok: false, status: 'unavailable', matches: [] }, 500);
  }
});

/**
 * Returns the selected matches, or null when the model could not run.
 * null and [] are deliberately different: one means "not checked", the other
 * means "checked, nothing fits".
 */
async function askModel(
  text: string,
  published: { slug: string; question: string; search_terms: string[] }[],
): Promise<{ slug: string; question: string; url: string; confidence: string }[] | null> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) {
    console.error('[match-faq] ANTHROPIC_API_KEY not set');
    return null;
  }

  const catalogue = published
    .map(p => `${p.slug} :: ${p.question}${p.search_terms?.length ? ` :: ${p.search_terms.join(', ')}` : ''}`)
    .join('\n');

  const prompt =
    `A customer wrote this message to support:\n\n"""${text}"""\n\n` +
    `Below are the published FAQ answers, as "slug :: question :: search terms".\n\n` +
    `${catalogue}\n\n` +
    `Which of these answers would actually solve the customer's problem? Judge by MEANING, ` +
    `not by shared words — "my alarm didn't go off" may be the morning brief entry even though ` +
    `it shares no words with it.\n\n` +
    `Return at most ${MAX_MATCHES}, best first. ` +
    `**If none genuinely addresses what they wrote, return an empty list.** ` +
    `Returning a loosely related answer is worse than returning none: it sends someone with a ` +
    `real problem off to read something irrelevant instead of getting help.\n\n` +
    `Reply with JSON only, no prose:\n` +
    `{"matches": [{"slug": "...", "confidence": "high|medium|low"}]}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error(`[match-faq] model HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const raw = data?.content?.[0]?.text ?? '';

    const parsed = extractJson(raw);
    if (!parsed) {
      console.error(`[match-faq] unparseable model output: ${JSON.stringify(raw).slice(0, 300)}`);
      return null;
    }

    const bySlug = new Map(published.map(p => [p.slug, p]));

    // A3 — validate every returned slug against the known set. Anything the
    // model invented is discarded here rather than shown to a customer.
    return (Array.isArray(parsed.matches) ? parsed.matches : [])
      .map((m: { slug?: unknown; confidence?: unknown }) => {
        const slug = String(m?.slug ?? '');
        const item = bySlug.get(slug);
        if (!item) {
          console.warn(`[match-faq] discarded unknown slug from model: "${slug.slice(0, 40)}"`);
          return null;
        }
        const c = String(m?.confidence ?? 'medium').toLowerCase();
        return {
          slug,
          question: item.question,
          url: `${FAQ_BASE_URL}#${slug}`,
          confidence: ['high', 'medium', 'low'].includes(c) ? c : 'medium',
        };
      })
      .filter(Boolean)
      .slice(0, MAX_MATCHES) as { slug: string; question: string; url: string; confidence: string }[];
  } catch (err) {
    console.error('[match-faq] model call threw:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Pull the first JSON object out of a model reply.
 *
 * ⚠️ Fixed in Phase 4, 2026-09-02, after a control probe caught it. The first
 * version stripped a fence from the START and a fence from the END of the
 * whole string. Haiku routinely answers with the fenced JSON **and then adds
 * prose after it**:
 *
 *     ```json
 *     {"matches": []}
 *     ```
 *     The customer is asking about ordering a pizza, which is unrelated to…
 *
 * The trailing fence is not at the end, so nothing was stripped, JSON.parse
 * threw, and the function reported `unavailable`. That is the worst possible
 * wrong answer here: it happened precisely on off-topic input, where
 * `no_match` is correct, and `unavailable` is the one status the contract says
 * must mean "nothing was checked". A page would have shown an outage message
 * for a question that was answered correctly.
 *
 * Same approach as naavi-chat/index.ts:72 — take the fenced block if there is
 * one, otherwise the first '{', then walk to its matching '}' with a
 * brace-depth counter that respects strings and escapes.
 */
function extractJson(rawText: string): Record<string, unknown> | null {
  if (typeof rawText !== 'string' || !rawText.length) return null;

  let start = -1;
  const fence = rawText.match(/```(?:json)?\s*/i);
  if (fence && fence.index !== undefined) start = fence.index + fence[0].length;
  else start = rawText.indexOf('{');
  if (start < 0) return null;

  let depth = 0, inString = false, escape = false, end = -1;
  for (let i = start; i < rawText.length; i++) {
    const ch = rawText[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;

  try {
    return JSON.parse(rawText.slice(start, end));
  } catch {
    return null;
  }
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
