/**
 * fire-pending-dwells Edge Function — runs every minute via cron.
 *
 * Picks up pending_dwell_fires rows whose fire_at has passed and that
 * weren't cancelled (user reversed direction) or already fired, marks
 * each row fired_at = now() to prevent double-fire in overlapping cron
 * runs, then POSTs to report-location-event with from_pending_dwell=true
 * so the existing fan-out (SMS + WhatsApp + Email + Push + voice call
 * for self-alerts) runs without re-evaluating direction or re-deferring.
 *
 * Wael 2026-05-11. Spec: docs/SERVER_SIDE_DWELL_DESIGN.md (TBD — implicit
 * for now via this file + migration + report-location-event changes).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PendingRow {
  id:         string;
  rule_id:    string;
  user_id:    string;
  entered_at: string;
  fire_at:    string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const interFnKey  = Deno.env.get('NAAVI_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const startedAt = Date.now();

  // Pull a bounded batch of ready rows. 100 is generous for a minute
  // window; if we ever sustain more than that we should add parallelism
  // or shorten the cron cadence rather than process them all here.
  const { data: rows, error: selectErr } = await admin
    .from('pending_dwell_fires')
    .select('id, rule_id, user_id, entered_at, fire_at')
    .lte('fire_at', new Date().toISOString())
    .is('cancelled_at', null)
    .is('fired_at', null)
    .order('fire_at', { ascending: true })
    .limit(100);

  if (selectErr) {
    console.error('[fire-pending-dwells] SELECT error:', selectErr.message);
    return json({ ok: false, error: selectErr.message }, 500);
  }

  const ready = (rows ?? []) as PendingRow[];
  if (ready.length === 0) {
    return json({ ok: true, fired: 0 });
  }

  console.log(`[fire-pending-dwells] ${ready.length} ready row(s)`);

  let firedCount = 0;
  let errorCount = 0;

  for (const row of ready) {
    // Lock the row by stamping fired_at NOW before any network call.
    // The partial unique index on (rule_id) WHERE active treats this
    // row as inactive once fired_at is set, so a concurrent cron tick
    // won't pick it up again. We accept a lost alert if the subsequent
    // POST fails — geofence delivery is best-effort and a retry could
    // produce a double-send, which is worse than a missed one.
    const { error: lockErr } = await admin
      .from('pending_dwell_fires')
      .update({ fired_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('cancelled_at', null)
      .is('fired_at', null);

    if (lockErr) {
      console.error(`[fire-pending-dwells] failed to lock row ${row.id}:`, lockErr.message);
      errorCount++;
      continue;
    }

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/report-location-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${interFnKey}`,
        },
        body: JSON.stringify({
          user_id:            row.user_id,
          rule_id:            row.rule_id,
          // event/lat/lng are unused on the from_pending_dwell path but
          // the schema requires non-empty values. Fill with sentinel.
          event:              'enter',
          lat:                0,
          lng:                0,
          timestamp:          row.entered_at,
          from_pending_dwell: true,
        }),
      });

      if (res.ok) {
        firedCount++;
      } else {
        errorCount++;
        const errBody = await res.text().catch(() => '');
        console.error(`[fire-pending-dwells] fan-out HTTP ${res.status} for row ${row.id}: ${errBody.slice(0, 200)}`);
      }
    } catch (err) {
      errorCount++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[fire-pending-dwells] fan-out network error for row ${row.id}:`, msg);
    }
  }

  console.log(`[fire-pending-dwells] done — fired=${firedCount} errored=${errorCount} elapsed=${Date.now() - startedAt}ms`);
  return json({ ok: true, fired: firedCount, errored: errorCount });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
