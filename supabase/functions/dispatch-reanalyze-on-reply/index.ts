/**
 * dispatch-reanalyze-on-reply Edge Function — F6a Phase 2 Step 6
 * (Wael 2026-05-21).
 *
 * Called by pg_cron every minute. Looks for tickets that already have a
 * draft (status='drafted') but where the customer has replied since our
 * last draft — and re-invokes analyze-ticket so staff sees an updated
 * draft reflecting the new context.
 *
 * Detection logic:
 *   1. Query our DB for tickets WHERE status='drafted' AND
 *      hubspot_ticket_id IS NOT NULL AND last_drafted_at IS NOT NULL.
 *   2. For each, query HubSpot for its associated INCOMING_EMAIL
 *      engagements.
 *   3. If ANY inbound email has hs_timestamp > tickets.last_drafted_at,
 *      the customer has replied → invoke analyze-ticket.
 *
 * Decision (locked 2026-05-21): re-engage only on CUSTOMER reply, never
 * on staff's own outbound. Staff's reply is the human truth until the
 * customer responds.
 *
 * Throttle: BATCH_LIMIT tickets per cron firing. Caps Anthropic +
 * HubSpot spend at predictable per-minute rate.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Throttle: max tickets processed per cron firing.
const BATCH_LIMIT = 5;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const hubspotToken = Deno.env.get('HUBSPOT_ACCESS_TOKEN');
  if (!hubspotToken) return json({ error: 'HUBSPOT_ACCESS_TOKEN not set' }, 500);

  const admin = createClient(supabaseUrl, serviceKey);
  const hsHeaders = {
    Authorization:  `Bearer ${hubspotToken}`,
    'Content-Type': 'application/json',
    Accept:         'application/json',
  };

  try {
    // 1. Candidate tickets: drafted + has HubSpot mirror + has a prior
    //    draft timestamp to compare against.
    const { data: tickets, error } = await admin
      .from('tickets')
      .select('id, ticket_number, hubspot_ticket_id, last_drafted_at')
      .eq('status', 'drafted')
      .not('hubspot_ticket_id', 'is', null)
      .not('last_drafted_at', 'is', null)
      .order('last_drafted_at', { ascending: true })
      .limit(BATCH_LIMIT * 3); // pull extra candidates; we'll filter then cap to BATCH_LIMIT.
    if (error) {
      console.error('[dispatch-reanalyze-on-reply] query failed:', error.message);
      return json({ error: error.message }, 500);
    }

    if (!tickets || tickets.length === 0) {
      return json({ processed: 0, candidates: 0 });
    }

    // 2. For each candidate, check HubSpot for fresh inbound emails.
    const toProcess: Array<{ id: string; ticket_number: number; latest_inbound_iso: string }> = [];
    for (const t of tickets) {
      // 2a. List email engagements associated with the ticket.
      const assocRes = await fetch(
        `https://api.hubapi.com/crm/v4/objects/tickets/${t.hubspot_ticket_id}/associations/emails?limit=100`,
        { headers: hsHeaders },
      );
      if (!assocRes.ok) {
        console.warn(`[dispatch-reanalyze-on-reply] #${t.ticket_number} assoc list http=${assocRes.status} — skipping`);
        continue;
      }
      const assocBody = await assocRes.json();
      const emailIds: string[] = (assocBody.results ?? []).map((x: { toObjectId: string | number }) => String(x.toObjectId));
      if (emailIds.length === 0) continue;

      // 2b. Batch-read those emails to find INCOMING_EMAIL newer than last_drafted_at.
      const batchRes = await fetch('https://api.hubapi.com/crm/v3/objects/emails/batch/read', {
        method:  'POST',
        headers: hsHeaders,
        body: JSON.stringify({
          properties: ['hs_email_direction', 'hs_email_status', 'hs_timestamp'],
          inputs:     emailIds.map(id => ({ id })),
        }),
      });
      if (!batchRes.ok) {
        const errBody = await batchRes.json().catch(() => ({}));
        console.warn(`[dispatch-reanalyze-on-reply] #${t.ticket_number} batch read http=${batchRes.status}: ${JSON.stringify(errBody).slice(0, 200)}`);
        continue;
      }
      const batchBody = await batchRes.json();
      const lastDraftedMs = new Date(t.last_drafted_at).getTime();
      let latestInboundMs = 0;
      for (const e of (batchBody.results ?? [])) {
        const p = e.properties || {};
        if (p.hs_email_direction !== 'INCOMING_EMAIL') continue;
        const tsMs = p.hs_timestamp ? new Date(p.hs_timestamp).getTime() : 0;
        if (tsMs > lastDraftedMs && tsMs > latestInboundMs) {
          latestInboundMs = tsMs;
        }
      }
      if (latestInboundMs > 0) {
        toProcess.push({
          id:                 t.id,
          ticket_number:      t.ticket_number,
          latest_inbound_iso: new Date(latestInboundMs).toISOString(),
        });
      }
    }

    if (toProcess.length === 0) {
      return json({ processed: 0, candidates: tickets.length });
    }

    // 3. Re-invoke analyze-ticket for each, capped at BATCH_LIMIT.
    const winners = toProcess.slice(0, BATCH_LIMIT);
    const results: Array<{ ticket_number: number; http: number; ok: boolean; error?: string; latest_inbound: string }> = [];
    for (const t of winners) {
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
          ticket_number:  t.ticket_number,
          http:           res.status,
          ok:             res.ok,
          error:          res.ok ? undefined : String((respBody as any).error ?? '(no body)'),
          latest_inbound: t.latest_inbound_iso,
        });
        console.log(`[dispatch-reanalyze-on-reply] #${t.ticket_number} re-analyzed (new inbound at ${t.latest_inbound_iso}) http=${res.status}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ ticket_number: t.ticket_number, http: 0, ok: false, error: msg, latest_inbound: t.latest_inbound_iso });
      }
    }

    return json({
      processed:  results.length,
      candidates: tickets.length,
      toProcess:  toProcess.length,
      results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dispatch-reanalyze-on-reply] error:', msg);
    return json({ error: msg }, 500);
  }
});
