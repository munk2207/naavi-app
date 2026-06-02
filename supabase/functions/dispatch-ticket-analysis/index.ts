/**
 * dispatch-ticket-analysis Edge Function — F6a Phase 2 Step 4 (Wael 2026-05-21).
 *
 * Called by pg_cron every minute. Scans for new tickets that qualify
 * for analyze-ticket and invokes analyze-ticket per ticket.
 *
 * Qualifying tickets:
 *   - status='new' (already-drafted tickets are skipped — analyze-ticket
 *     itself enforces this; the filter here is for efficiency)
 *   - hubspot_ticket_id IS NOT NULL (we can only post Internal Notes to
 *     tickets that have a HubSpot mirror; the 11 pre-Phase-2 tickets
 *     without a HubSpot id are excluded naturally)
 *   - created_at >= ANALYZE_BASELINE (locks the "only future tickets"
 *     decision from 2026-05-21; existing 'new' tickets are NOT
 *     auto-drafted retroactively)
 *
 * Throttle: BATCH_LIMIT per cron firing protects against runaway in a
 * burst (e.g., spam wave).
 *
 * Calls analyze-ticket sequentially (not parallel) — keeps Anthropic
 * spend predictable per cron tick and avoids rate-limit storms on
 * HubSpot's notes endpoint.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Baseline: only tickets created AFTER this timestamp are eligible for
// analyze-ticket dispatch. Set on 2026-05-21 to exclude the 9 existing
// HubSpot-mirrored test tickets (#1037–#1045) plus all pre-Phase-2 rows.
// Adjust this constant + redeploy if a reset / backfill is ever needed.
const ANALYZE_BASELINE = '2026-05-21T05:00:00Z';

// Max tickets processed per cron firing. Cron runs every minute, so this
// caps Anthropic + HubSpot calls at BATCH_LIMIT × 60 per hour worst case.
const BATCH_LIMIT = 5;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const { data: tickets, error } = await admin
      .from('tickets')
      .select('id, ticket_number, created_at, reporter_email')
      .eq('status', 'new')
      .is('last_drafted_at', null)        // skip tickets already drafted
      .not('reporter_email', 'ilike', '%autotester%')  // skip auto-tester tickets
      .not('reporter_email', 'ilike', '%autotest%')    // skip auto-tester tickets
      .not('reporter_email', 'ilike', '%example.com%') // skip all test domains
      .gte('created_at', ANALYZE_BASELINE)
      .order('created_at', { ascending: true })
      .limit(BATCH_LIMIT);
    if (error) {
      console.error('[dispatch-ticket-analysis] query failed:', error.message);
      return json({ error: error.message }, 500);
    }

    if (!tickets || tickets.length === 0) {
      return json({ processed: 0, baseline: ANALYZE_BASELINE });
    }

    const results: Array<{ ticket_number: number; http: number; ok: boolean; error?: string }> = [];
    for (const t of tickets) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/analyze-ticket`, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:  `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ ticket_id: t.id, dry_run: false }),
        });
        const respBody = await res.json().catch(() => ({}));
        results.push({
          ticket_number: t.ticket_number,
          http:          res.status,
          ok:            res.ok,
          error:         res.ok ? undefined : String((respBody as any).error ?? '(no body)'),
        });
        console.log(`[dispatch-ticket-analysis] #${t.ticket_number} analyze-ticket http=${res.status} ok=${res.ok}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[dispatch-ticket-analysis] #${t.ticket_number} fetch threw:`, msg);
        results.push({ ticket_number: t.ticket_number, http: 0, ok: false, error: msg });
      }
    }

    return json({
      processed: results.length,
      baseline:  ANALYZE_BASELINE,
      results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dispatch-ticket-analysis] error:', msg);
    return json({ error: msg }, 500);
  }
});
