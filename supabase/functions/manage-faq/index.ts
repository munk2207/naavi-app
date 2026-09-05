/**
 * manage-faq — the ONE write entry point for the FAQ. (F25, 2026-09-02)
 *
 * CLAUDE.md DATA INTEGRITY Layer 2: every write to faq_items flows through
 * here. RLS denies all client roles, so there is no second path this could
 * drift from.
 *
 * Staff only. Authorisation reuses the check-staff contract — verify the JWT,
 * then require the email to be an active row in support_staff (or the
 * hardcoded superadmin). check-staff itself is NOT modified; this function
 * becomes its fifth consumer, which is why Phase 7 must exercise the other
 * four rather than assume an unmodified file cannot affect them.
 *
 * ── Classification ─────────────────────────────────────────────────────────
 * Categories and search terms are assigned by Claude Haiku on create, and
 * again on update WHEN THE WORDS CHANGE (content_hash comparison). Wael,
 * 2026-09-02: an answer improved after review can deserve different
 * categories, and keeping the original would lose that; an untouched answer
 * must not drift on its own.
 *
 * The classifier SELECTS from faq_categories and never invents a name —
 * anything it returns that is not a known category is discarded. Staff own
 * the list.
 *
 * ⚠️ Phase 3 A2 — FAIL OPEN. If classification cannot run, the save STILL
 * SUCCEEDS, the row is stored with needs_classification = true, and it stays
 * published and searchable. A staffer must never lose an answer they wrote
 * because a third-party API was unavailable, and there is no cron here, so a
 * row parked for "later" would be parked forever.
 *
 * ⚠️ Phase 3 A6 — stored answer HTML is restricted at write time to the six
 * tags the existing 23 answers actually use. Narrow by construction, not by
 * trusting the author.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

const SUPERADMIN = 'wael@mynaavi.com';
const MODEL = 'claude-haiku-4-5-20251001';

// Phase 3 A6 — the exact tag set the existing 23 answers use. Nothing else.
//
// ⚠️ CORRECTED IN PHASE 4, 2026-09-02. Phase 2 §7a named this set as "the six
// tags the existing 23 answers actually use" — that was asserted, not checked,
// and it was wrong in both directions. Measured against faq.html:
//     p 152 · strong 88 · em 34 · br 24 · span 10 · a 2
// `code` appears ZERO times; `span` appears 10 and was missing from the list.
// Migrating the 23 answers would have failed on five of them.
//
// `span` is kept because those ten carry the muted annotation lines under the
// worked examples ("→ calendar event + travel-time alert + SMS rule"), and
// dropping the tag would change how a published answer reads. `code` is kept
// as harmless headroom for future answers.
const ALLOWED_TAGS = ['p', 'strong', 'em', 'br', 'span', 'a', 'code'];

// A6's stated purpose is that arbitrary HTML must not round-trip into a public
// page. Tag filtering alone does not achieve that: an allowed tag carrying an
// event handler is the actual hazard. Inline `style` IS permitted — the ten
// existing spans depend on it, and removing it would alter published answers.
const FORBIDDEN_ATTR_RE = /\son[a-z]+\s*=/i;
const FORBIDDEN_URL_RE = /(?:href|src)\s*=\s*["']?\s*(?:javascript|data):/i;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Authorisation — same contract as check-staff ────────────────────────
  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim();
  if (!token) return json({ ok: false, error: 'auth_required' }, 401);

  let email: string | null = null;
  let role: string | null = null;

  // Two auth paths, mirroring the pattern manage-voice-pin already uses
  // (CLAUDE.md Rule 4):
  //   1) Staff JWT — the portal. Email must be active in support_staff.
  //   2) Service-role — the one-time migration of the 23 existing answers.
  //      This exists so the migration writes through the SAME entry point as
  //      everything else rather than inserting behind it, which is what
  //      DATA INTEGRITY Layer 2 is for. No client ever holds this key.
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    email = 'service-role';
    role = 'superadmin';
  } else {
  try {
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user?.email) return json({ ok: false, error: 'not_authorized' }, 401);
    email = user.email;
    if (email === SUPERADMIN) {
      role = 'superadmin';
    } else {
      const { data } = await admin
        .from('support_staff')
        .select('email, role')
        .eq('email', email)
        .eq('active', true)
        .maybeSingle();
      if (!data) return json({ ok: false, error: 'not_authorized' }, 403);
      role = (data as { role: string }).role;
    }
  } catch (err) {
    console.error('[manage-faq] auth threw:', err instanceof Error ? err.message : String(err));
    return json({ ok: false, error: 'not_authorized' }, 401);
  }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }
  const op = String(body.op ?? '');

  try {
    switch (op) {
      /**
       * list — newest first, and DELIBERATELY the opposite of get-faq.
       *
       * get-faq orders oldest-first because that preserves the order the 23
       * migrated answers were published in, so a customer still meets "What is
       * MyNaavi?" before anything else. That order is curated and must not
       * change.
       *
       * A staffer wants the opposite. The thing they just wrote is the thing
       * they want to see, and oldest-first buried it below everything already
       * published — a cost that grows with every answer added, which is the
       * whole point of this feature.
       *
       * The two orders answer different questions. Do not "fix" one to match
       * the other.
       */
      case 'list': {
        const { data, error } = await admin
          .from('faq_items')
          .select('id, slug, question, answer_html, categories, search_terms, needs_classification, active, updated_at')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return json({ ok: true, items: data ?? [], role });
      }

      /**
       * publish_status — is the public page actually up to date?
       *
       * Phase 6 mandatory change #1. Regeneration is triggered by a deploy
       * hook, and a hook that silently stops firing leaves the crawler copy
       * stale with nothing to say so. That is the same failure that left
       * lib/faq.ts eleven questions behind — reproduced inside the fix for
       * it — so it has to be visible to the person who would care, at the
       * moment they would care: a staffer looking at the FAQ.
       *
       * Read server-side deliberately. The staff portal and the website are
       * different origins, and mynaavi.com serves plain static HTML with no
       * CORS headers, so a browser fetch would be blocked. Doing it here also
       * means the check cannot be defeated by a page that fails to load.
       */
      case 'publish_status': {
        const { data: newest, error: newestErr } = await admin
          .from('faq_items')
          .select('updated_at')
          .eq('active', true)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (newestErr) throw newestErr;

        const lastContentChange = (newest as { updated_at: string } | null)?.updated_at ?? null;
        const pageUrl = Deno.env.get('FAQ_PUBLIC_URL') ?? 'https://mynaavi.com/faq';

        let generatedAt: string | null = null;
        let generatedCount: number | null = null;
        let reachable = false;
        try {
          const res = await fetch(pageUrl, { headers: { 'Cache-Control': 'no-cache' } });
          if (res.ok) {
            reachable = true;
            const html = await res.text();
            const m = html.match(/<!--\s*F25:generated-at\s+(\S+)\s+count:(\d+)\s*-->/);
            if (m) { generatedAt = m[1]; generatedCount = Number(m[2]); }
          } else {
            console.error(`[manage-faq] publish_status: ${pageUrl} returned HTTP ${res.status}`);
          }
        } catch (err) {
          console.error('[manage-faq] publish_status fetch threw:', err instanceof Error ? err.message : String(err));
        }

        // Unknown is NOT the same as fresh. If the page cannot be read, or
        // carries no stamp, say so rather than reporting healthy.
        let state: 'current' | 'stale' | 'unknown' = 'unknown';
        let behindMinutes: number | null = null;
        if (reachable && generatedAt && lastContentChange) {
          const diffMs = new Date(lastContentChange).getTime() - new Date(generatedAt).getTime();
          behindMinutes = Math.round(diffMs / 60000);
          // A minute of slack: the hook fires on save, so the build always
          // finishes slightly after the write it was triggered by.
          state = diffMs > 60_000 ? 'stale' : 'current';
        }

        return json({
          ok: true,
          state,
          page_url: pageUrl,
          page_reachable: reachable,
          page_generated_at: generatedAt,
          page_answer_count: generatedCount,
          last_content_change: lastContentChange,
          behind_minutes: behindMinutes,
          hook_configured: Boolean(Deno.env.get('VERCEL_DEPLOY_HOOK_URL')),
        });
      }

      /** Manual recovery path when the hook has failed. */
      case 'rebuild_now': {
        const url = Deno.env.get('VERCEL_DEPLOY_HOOK_URL');
        if (!url) return json({ ok: false, error: 'hook_not_configured' }, 400);
        await pingDeployHook('manual');
        return json({ ok: true });
      }

      case 'categories': {
        const { data, error } = await admin
          .from('faq_categories')
          .select('id, name, sort_order, active')
          .order('sort_order', { ascending: true });
        if (error) throw error;
        return json({ ok: true, categories: data ?? [] });
      }

      case 'add_category': {
        const name = String(body.name ?? '').trim();
        if (!name) return json({ ok: false, error: 'name_required' }, 400);
        const { error } = await admin.from('faq_categories').insert({ name, sort_order: 999 });
        if (error) {
          if ((error as { code?: string }).code === '23505') {
            return json({ ok: false, error: 'category_exists' }, 409);
          }
          throw error;
        }
        return json({ ok: true });
      }

      case 'create':
      case 'update': {
        const question = String(body.question ?? '').trim();
        const answerHtml = String(body.answer_html ?? '').trim();
        if (!question) return json({ ok: false, error: 'question_required' }, 400);
        if (!answerHtml) return json({ ok: false, error: 'answer_required' }, 400);

        const tagCheck = disallowedTag(answerHtml);
        if (tagCheck) {
          return json({ ok: false, error: 'tag_not_allowed', tag: tagCheck, allowed: ALLOWED_TAGS }, 400);
        }

        const hash = await sha256(`${question}\n${answerHtml}`);

        // ── update ────────────────────────────────────────────────────────
        if (op === 'update') {
          const id = String(body.id ?? '');
          if (!id) return json({ ok: false, error: 'id_required' }, 400);

          const { data: existing, error: exErr } = await admin
            .from('faq_items')
            .select('id, content_hash, categories, search_terms')
            .eq('id', id)
            .maybeSingle();
          if (exErr) throw exErr;
          if (!existing) return json({ ok: false, error: 'not_found' }, 404);

          const prev = existing as { content_hash: string; categories: string[]; search_terms: string[] };
          const wordsChanged = prev.content_hash !== hash;

          // Re-classify ONLY when the words changed. This is the whole point of
          // content_hash: an improved answer gets the categories it now
          // deserves; an untouched one never moves on its own.
          let categories = prev.categories ?? [];
          let searchTerms = prev.search_terms ?? [];
          let needsClassification = false;

          if (wordsChanged || body.force_classify === true) {
            const result = await classify(admin, question, answerHtml);
            if (result) {
              categories = result.categories;
              searchTerms = result.search_terms;
            } else {
              needsClassification = true; // A2 — fail open, save anyway
            }
          }

          const { error: upErr } = await admin
            .from('faq_items')
            .update({
              question,
              answer_html: answerHtml,
              categories,
              search_terms: searchTerms,
              content_hash: hash,
              needs_classification: needsClassification,
              updated_at: new Date().toISOString(),
            })
            .eq('id', id);
          if (upErr) throw upErr;

          await forgetMatchCache(admin, 'update');
        await pingDeployHook('update');
          return json({ ok: true, reclassified: wordsChanged, needs_classification: needsClassification });
        }

        // ── create ────────────────────────────────────────────────────────
        const slug = await uniqueSlug(admin, String(body.slug ?? '') || question);
        const result = await classify(admin, question, answerHtml);

        const { error: insErr } = await admin.from('faq_items').insert({
          slug,
          question,
          answer_html: answerHtml,
          categories: result?.categories ?? [],
          search_terms: result?.search_terms ?? [],
          content_hash: hash,
          needs_classification: !result, // A2 — fail open
          created_by: email,
        });
        if (insErr) {
          if ((insErr as { code?: string }).code === '23505') {
            return json({ ok: false, error: 'slug_exists', slug }, 409);
          }
          throw insErr;
        }

        await forgetMatchCache(admin, 'create');
        await pingDeployHook('create');
        return json({ ok: true, slug, needs_classification: !result });
      }

      case 'deactivate': {
        const id = String(body.id ?? '');
        if (!id) return json({ ok: false, error: 'id_required' }, 400);
        const { error } = await admin
          .from('faq_items')
          .update({ active: false, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
        await forgetMatchCache(admin, 'deactivate');
        await pingDeployHook('deactivate');
        return json({ ok: true });
      }

      case 'reactivate': {
        const id = String(body.id ?? '');
        if (!id) return json({ ok: false, error: 'id_required' }, 400);
        const { error } = await admin
          .from('faq_items')
          .update({ active: true, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
        await forgetMatchCache(admin, 'reactivate');
        await pingDeployHook('reactivate');
        return json({ ok: true });
      }

      default:
        return json({ ok: false, error: 'unknown_op', op }, 400);
    }
  } catch (err) {
    // Rule 21 — enough context to diagnose: which function, which op, what.
    console.error(`[manage-faq] op=${op} failed:`, err instanceof Error ? err.message : String(err));
    return json({ ok: false, error: 'operation_failed' }, 500);
  }
});

// ── helpers ───────────────────────────────────────────────────────────────

/**
 * Phase 3 A6. Returns the first tag found that is not on the allowlist, or
 * null. Deliberately conservative: anything unrecognised is refused rather
 * than stripped, so a staffer is told what happened instead of silently
 * losing formatting they intended.
 */
function disallowedTag(html: string): string | null {
  const tags = [...html.matchAll(/<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)/g)].map(m => m[1].toLowerCase());
  for (const t of tags) {
    if (!ALLOWED_TAGS.includes(t)) return t;
  }
  if (FORBIDDEN_ATTR_RE.test(html)) return 'event-handler attribute';
  if (FORBIDDEN_URL_RE.test(html)) return 'javascript: or data: URL';
  return null;
}

/**
 * Pull the first JSON object out of a model reply.
 *
 * ⚠️ Fixed in Phase 4, 2026-09-02. The first version stripped a fence from the
 * start and a fence from the end of the whole string; Haiku routinely answers
 * with fenced JSON **followed by prose**, so the closing fence is mid-string,
 * nothing was stripped, and JSON.parse threw. In this function that silently
 * meant "classification failed" — the row would have been saved with
 * needs_classification = true and no categories, for a call that had actually
 * succeeded and cost money.
 *
 * Caught by a match-faq control probe, not by the four required phrases: they
 * all matched something, so the model answered with JSON and nothing after it.
 *
 * Same approach as naavi-chat/index.ts:72.
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

async function uniqueSlug(admin: ReturnType<typeof createClient>, source: string): Promise<string> {
  const base = slugify(source) || 'question';
  let candidate = base;
  for (let n = 2; n < 50; n++) {
    const { data } = await admin.from('faq_items').select('id').eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Assign categories and search terms with Claude Haiku.
 *
 * Returns null on ANY failure — no key, network error, bad JSON, model
 * unavailable. The caller treats null as "save anyway, flag it" (A2). This
 * function never throws for that reason: a classifier outage is an expected
 * condition here, not an exception.
 *
 * The model chooses from the categories that exist. Anything it returns that
 * is not a known category is discarded, so it cannot invent one — staff own
 * the list (Wael, 2026-09-02).
 */
async function classify(
  admin: ReturnType<typeof createClient>,
  question: string,
  answerHtml: string,
): Promise<{ categories: string[]; search_terms: string[] } | null> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) {
    console.error('[manage-faq] classify skipped — ANTHROPIC_API_KEY not set');
    return null;
  }

  const { data: catRows } = await admin
    .from('faq_categories')
    .select('name')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  const known = (catRows ?? []).map((c: { name: string }) => c.name);
  if (!known.length) {
    console.error('[manage-faq] classify skipped — no active categories');
    return null;
  }

  const plain = answerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const prompt =
    `You are sorting one entry for a product FAQ.\n\n` +
    `QUESTION: ${question}\n\n` +
    `ANSWER: ${plain.slice(0, 2000)}\n\n` +
    `Choose every category this entry genuinely belongs to, from EXACTLY this list ` +
    `(copy the names verbatim; do not invent any):\n` +
    known.map(n => `- ${n}`).join('\n') +
    `\n\nAlso write 6 to 12 search terms: the words a real person might type when they ` +
    `have this problem but do not know the product's vocabulary. Include everyday ` +
    `phrasings, not just words already in the question.\n\n` +
    `Reply with JSON only, no prose:\n` +
    `{"categories": ["..."], "search_terms": ["..."]}`;

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
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error(`[manage-faq] classify HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const raw = data?.content?.[0]?.text ?? '';

    const parsed = extractJson(raw);
    if (!parsed) {
      console.error(`[manage-faq] classify — unparseable model output: ${JSON.stringify(raw).slice(0, 300)}`);
      return null;
    }

    // The model selects; it does not create. Anything not already a category
    // is dropped rather than trusted.
    const categories = (Array.isArray(parsed.categories) ? parsed.categories : [])
      .map((c: unknown) => String(c).trim())
      .filter((c: string) => known.includes(c));

    const searchTerms = (Array.isArray(parsed.search_terms) ? parsed.search_terms : [])
      .map((t: unknown) => String(t).toLowerCase().trim())
      .filter((t: string) => t.length > 1)
      .slice(0, 20);

    if (!categories.length && !searchTerms.length) {
      console.error('[manage-faq] classify returned nothing usable');
      return null;
    }
    return { categories, search_terms: searchTerms };
  } catch (err) {
    console.error('[manage-faq] classify threw:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * F25 §10 — ask Vercel to rebuild the website after a published answer changes.
 *
 * The FAQ page bakes the answers into its HTML at build time so crawlers that
 * do not run JavaScript can read them (build-faq.js). That copy is only
 * trustworthy if something regenerates it, and Wael's founding requirement was
 * that no human step exists — so the save itself triggers it.
 *
 * ⚠️ Fire and forget, deliberately. A slow or broken deploy hook must NEVER
 * cost a staffer the answer they just wrote. Same fail-open principle as the
 * classifier (A2), applied to a different dependency: the write has already
 * committed by the time this runs, and nothing here can undo it.
 *
 * ⚠️ Known gap, recorded at Phase 2 §7b and Phase 3 Part C2: if this hook
 * silently stops firing, the crawler copy goes stale. Humans are unaffected —
 * the page fetches live data — but it is the same shape of failure as the
 * lib/faq.ts drift that motivated this whole item. Phase 6 is required to
 * settle how that gets noticed.
 */
/**
 * Forget what the matcher previously concluded, because the answers changed.
 *
 * match-faq caches its result against the customer's words alone. Nothing in
 * that key knows which answers existed when the result was computed, so a
 * question asked BEFORE its answer was written keeps returning the old miss
 * — permanently. There is no expiry: the table has created_at and an index on
 * it, and nothing reads either.
 *
 * That is worst exactly where this product is strongest. A customer asks
 * something, gets no match, files a ticket; a staffer turns that ticket into
 * an FAQ answer; and the next customer who phrases it the same way still gets
 * the miss. The tool built to end the loop keeps the loop running.
 *
 * So: when the published set changes, the cache is emptied. Not expired,
 * emptied — a window in which a customer gets a stale answer to a question we
 * have just answered is the whole defect, and a timer leaves one.
 *
 * Cheap by construction. The cache exists to stop an identical repeat costing
 * a model call, not to be durable; it refills on demand.
 *
 * ⚠️ Best-effort, deliberately. A failure here is logged and the save still
 * succeeds — the same fail-open reasoning as the classifier and the deploy
 * hook. A staffer must never lose an answer they wrote because a cache would
 * not clear.
 *
 * Found 2026-09-04 while copying three answers to staging: the ChatGPT
 * question was published and the matcher still answered "What is MyNaavi?"
 * to a phrase probed minutes earlier.
 */
async function forgetMatchCache(
  admin: ReturnType<typeof createClient>,
  reason: string,
): Promise<void> {
  const { error } = await admin
    .from('faq_match_cache')
    .delete()
    .neq('input_hash', '__never_matches__');
  if (error) {
    console.error(`[manage-faq] match cache NOT cleared after ${reason} — customers may keep getting a stale answer: ${error.message}`);
  }
}

async function pingDeployHook(reason: string): Promise<void> {
  const url = Deno.env.get('VERCEL_DEPLOY_HOOK_URL');
  if (!url) {
    console.warn(`[manage-faq] VERCEL_DEPLOY_HOOK_URL not set — the crawler copy of the FAQ will not be regenerated (${reason})`);
    return;
  }
  try {
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) {
      console.error(`[manage-faq] deploy hook returned HTTP ${res.status} (${reason}) — crawler copy may be stale`);
      return;
    }
    console.log(`[manage-faq] deploy hook fired (${reason})`);
  } catch (err) {
    console.error(`[manage-faq] deploy hook threw (${reason}):`, err instanceof Error ? err.message : String(err));
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
