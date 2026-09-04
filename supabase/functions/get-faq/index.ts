/**
 * get-faq — the customer-facing read of the published FAQ. (F25, 2026-09-02)
 *
 * Unauthenticated by design: this is public content. Phase 1A chose this
 * function over an RLS public-read policy (option B) for one reason —
 * **what is public is stated here, in code, so it cannot drift by someone
 * adding a column.** faq_items also holds content_hash, needs_classification
 * and timestamps; a public-read policy would have published each of those the
 * day it was added, silently.
 *
 * ⚠️ Phase 3 A4 — this function holds SERVICE-ROLE privileges against a table
 * no client can read. It therefore accepts NO caller-controlled filtering:
 * no select list, no predicate, no "include inactive" flag, no ordering
 * parameter. The query shape below is the only one this function can perform.
 * Do not add a parameter here without re-reading that finding.
 *
 * Caching: Wael, 2026-09-02 — "every 1 hour the page will pull and update".
 * That is this header, not a cron job. A staffer's save is live immediately in
 * the database; the hour governs only how soon a customer's browser looks
 * again.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

const CACHE_SECONDS = 3600;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    // The only query this function performs. Fixed column list — adding a
    // column to faq_items must not publish it by accident.
    const { data: items, error: itemsErr } = await admin
      .from('faq_items')
      .select('slug, question, answer_html, categories, search_terms')
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (itemsErr) {
      console.error('[get-faq] items query failed:', itemsErr.message);
      return json({ ok: false, error: 'read_failed' }, 500);
    }

    const { data: cats, error: catsErr } = await admin
      .from('faq_categories')
      .select('name')
      .eq('active', true)
      .order('sort_order', { ascending: true });

    if (catsErr) {
      console.error('[get-faq] categories query failed:', catsErr.message);
      return json({ ok: false, error: 'read_failed' }, 500);
    }

    return json(
      {
        ok: true,
        categories: (cats ?? []).map((c: { name: string }) => c.name),
        items: items ?? [],
      },
      200,
      { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
    );
  } catch (err) {
    // Rule 21 — no silent failures. Which function, what happened.
    console.error('[get-faq] threw:', err instanceof Error ? err.message : String(err));
    return json({ ok: false, error: 'read_failed' }, 500);
  }
});

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', ...extra },
  });
}
