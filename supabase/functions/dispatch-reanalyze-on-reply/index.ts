/**
 * dispatch-reanalyze-on-reply Edge Function — rewritten 2026-06-03.
 *
 * Called by pg_cron every minute. Looks for tickets that already have a
 * draft but where the customer has replied since the last draft — and
 * re-invokes analyze-ticket so staff sees an updated draft.
 *
 * Detection: query tickets where last_drafted_at IS NOT NULL AND status
 * NOT IN ('closed','cancelled') AND replies JSONB contains at least one
 * inbound entry with at > last_drafted_at.
 *
 * HubSpot removed 2026-06-03 — detection now uses tickets.replies array.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    // Find tickets that have a draft AND a customer reply AFTER the last draft.
    const { data: tickets, error } = await admin
      .from('tickets')
      .select('id, ticket_number, last_drafted_at, replies, status')
      .not('last_drafted_at', 'is', null)
      .not('replies', 'is', null)
      .not('status', 'in', '("closed","cancelled")')
      .order('last_drafted_at', { ascending: true })
      .limit(BATCH_LIMIT * 3);

    if (error) {
      console.error('[dispatch-reanalyze-on-reply] query failed:', error.message);
      return json({ error: error.message }, 500);
    }

    if (!tickets || tickets.length === 0) {
      return json({ processed: 0, candidates: 0 });
    }

    // Filter: only tickets where a customer (inbound) reply arrived after last_drafted_at
    const toProcess: Array<{ id: string; ticket_number: number; latest_inbound_iso: string }> = [];
    for (const t of tickets) {
      const replies = Array.isArray(t.replies) ? t.replies : [];
      const lastDraftedMs = new Date(t.last_drafted_at).getTime();
      const freshInbound = replies.find((r: any) =>
        r.direction === 'inbound' && new Date(r.at).getTime() > lastDraftedMs
      );
      if (freshInbound) {
        toProcess.push({
          id:                 t.id,
          ticket_number:      t.ticket_number,
          latest_inbound_iso: freshInbound.at,
        });
      }
    }

    if (toProcess.length === 0) {
      return json({ processed: 0, candidates: tickets.length });
    }

    // Re-invoke analyze-ticket for each, capped at BATCH_LIMIT.
    const winners = toProcess.slice(0, BATCH_LIMIT);
    const results: Array<{ ticket_number: number; http: number; ok: boolean; error?: string }> = [];
    for (const t of winners) {
      // Reset last_drafted_at so analyze-ticket runs fresh
      await admin.from('tickets').update({ last_drafted_at: null }).eq('id', t.id);

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
        console.log(`[dispatch-reanalyze-on-reply] #${t.ticket_number} re-analyzed (new inbound at ${t.latest_inbound_iso}) http=${res.status} ok=${res.ok}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ ticket_number: t.ticket_number, http: 0, ok: false, error: msg });
      }
    }

    return json({ processed: results.length, candidates: tickets.length, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dispatch-reanalyze-on-reply] error:', msg);
    return json({ error: msg }, 500);
  }
});
