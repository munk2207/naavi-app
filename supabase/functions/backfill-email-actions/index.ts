/**
 * backfill-email-actions Edge Function
 *
 * One-off utility: for a given user_id, runs extract-email-actions across the
 * user's tier-1 gmail messages. Sequential to respect Anthropic rate limits.
 * Returns counts.
 *
 * Input body: { user_id: string, max?: number, force?: boolean }
 *
 * `force` was already accepted here but undocumented (fixed 2026-08-24). It is
 * now passed through to extract-email-actions per message, where it bypasses the
 * already-classified guard AND NOTHING ELSE — the keyword pre-filter still runs
 * and sentinel rows are still written.
 *
 * ⭐ Without force this call is now largely a no-op: extract-email-actions skips
 * any message that already has an email_actions row (B11x). Forced mode is the
 * approved procedure for applying a widened ACTIONABLE_KEYWORDS list to mail
 * already in the window — see the comment at that array's declaration.
 *
 * This function's own duplicate-skipping guard was REMOVED in B11x; see the
 * comment at the `todo` assignment for why it was wrong.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { user_id, max = 100, force = false } = await req.json();
    if (!user_id) throw new Error('user_id required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Fetch the user's most recent tier-1 messages. (Was "…that don't already have
    // an email_action row" — that filter lived in the `seen` guard below, which B11x
    // removed; the comment is corrected here rather than left describing code that
    // no longer exists.)
    const { data: msgs, error } = await supabase
      .from('gmail_messages')
      .select('gmail_message_id')
      .eq('user_id', user_id)
      .eq('is_tier1', true)
      .order('received_at', { ascending: false })
      .limit(max);

    if (error) throw new Error(error.message);

    // B11x (2026-08-24) — the local `seen` guard that used to live here was REMOVED.
    //
    // It read every email_actions row for the user and skipped any message that had
    // one. That is the "skip if a row exists" shape B11x identified as broken: before
    // B11x the keyword pre-filter wrote no row at all, so this guard skipped exactly
    // the emails that HAD produced an action and re-sent every pre-filtered email on
    // every run — backwards, and live in production for four months.
    //
    // Deduplication now belongs to extract-email-actions, which owns the sentinel
    // rows that make the question answerable. Retired on ChatGPT's Phase 3 review,
    // Mandatory Change 1. Do not reintroduce a second guard here — two guards over
    // one fact is how they drift apart.
    //
    // `force` is passed straight through per message instead: it bypasses the
    // downstream already-classified guard and nothing else.
    const todo = (msgs ?? []).map((r: { gmail_message_id: string }) => r.gmail_message_id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    let processed = 0;
    let actionable = 0;
    let notActionable = 0;
    let errors = 0;

    for (const id of todo) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/extract-email-actions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ gmail_message_id: id, user_id, force }),
        });
        const data = await res.json();
        if (data?.action) actionable++;
        else notActionable++;
        processed++;
      } catch (e) {
        errors++;
        console.error('[backfill] failed for', id, e);
      }
    }

    return new Response(
      JSON.stringify({
        total_tier1: msgs?.length ?? 0,
        already_extracted: seen.size,
        processed,
        actionable,
        not_actionable: notActionable,
        errors,
      }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[backfill-email-actions] Error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }
});
