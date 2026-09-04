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
 *   (b) per-IP rate limit
 * Option (d) — keyword-filter first, AI only on a miss — was REJECTED: it
 * reverses the AI-every-submission behaviour Wael approved on 2026-09-02.
 * Do not reintroduce it as an optimisation.
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

    // ── (b) rate limit — only for calls that will actually cost money ─────
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
    const ipHash = await sha256(ip);
    const windowStart = new Date(Math.floor(Date.now() / (WINDOW_MINUTES * 60_000)) * (WINDOW_MINUTES * 60_000)).toISOString();

    const { data: rl } = await admin
      .from('faq_rate_limit')
      .select('request_count')
      .eq('ip_hash', ipHash)
      .eq('window_start', windowStart)
      .maybeSingle();

    const used = (rl as { request_count: number } | null)?.request_count ?? 0;
    if (used >= MAX_PER_WINDOW) {
      console.warn(`[match-faq] rate limited ip_hash=${ipHash.slice(0, 8)}… surface=${surface}`);
      // 'unavailable', not 'no_match' — nothing was checked, and the page must
      // be able to tell the difference (contract property 3).
      return json({ ok: false, status: 'unavailable', matches: [], error: 'rate_limited' }, 429);
    }

    await admin.from('faq_rate_limit').upsert(
      { ip_hash: ipHash, window_start: windowStart, request_count: used + 1 },
      { onConflict: 'ip_hash,window_start' },
    );

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
