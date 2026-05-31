/**
 * hubspot-ticket-closed — HubSpot webhook receiver.
 *
 * HubSpot calls this URL when a ticket's pipeline stage changes to "Closed".
 * We update the matching Supabase tickets row to status='closed' and append
 * an audit_trail entry.
 *
 * Setup in HubSpot:
 *   Settings → Integrations → Webhooks → Create webhook
 *   Event: Ticket property change — hs_pipeline_stage
 *   URL: https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/hubspot-ticket-closed
 *
 * Payload shape (HubSpot sends an array):
 *   [{ objectId: "<hubspot_ticket_id>", propertyName: "hs_pipeline_stage", propertyValue: "<stage_id>" }]
 *
 * HubSpot "Closed" stage id for the Support Pipeline = "4" (verified 2026-05-31).
 * If the stage is not Closed, we ignore the event.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hubspot-signature',
};

const HUBSPOT_CLOSED_STAGE = '4'; // Support Pipeline → Closed

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const events = await req.json();
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let closed = 0;

    for (const event of Array.isArray(events) ? events : [events]) {
      const { objectId, propertyName, propertyValue } = event ?? {};

      // Only act on pipeline stage changes to Closed
      if (propertyName !== 'hs_pipeline_stage') continue;
      if (String(propertyValue) !== HUBSPOT_CLOSED_STAGE) continue;
      if (!objectId) continue;

      const hubspotTicketId = String(objectId);

      // Find the Supabase ticket by HubSpot ticket id
      const { data: ticket, error: findErr } = await admin
        .from('tickets')
        .select('id, ticket_number, status, audit_trail')
        .eq('hubspot_ticket_id', hubspotTicketId)
        .maybeSingle();

      if (findErr || !ticket) {
        console.warn(`[hubspot-ticket-closed] No Supabase ticket for HubSpot id ${hubspotTicketId}`);
        continue;
      }

      if (ticket.status === 'closed') {
        console.log(`[hubspot-ticket-closed] Ticket #${ticket.ticket_number} already closed — skip`);
        continue;
      }

      const auditEntry = {
        at:          new Date().toISOString(),
        actor:       'hubspot',
        from_status: ticket.status,
        to_status:   'closed',
        note:        `Closed by staff in HubSpot (ticket id ${hubspotTicketId}).`,
      };
      const newAudit = Array.isArray(ticket.audit_trail)
        ? [...ticket.audit_trail, auditEntry]
        : [auditEntry];

      const { error: updateErr } = await admin
        .from('tickets')
        .update({ status: 'closed', audit_trail: newAudit })
        .eq('id', ticket.id);

      if (updateErr) {
        console.error(`[hubspot-ticket-closed] Update failed for ticket #${ticket.ticket_number}:`, updateErr.message);
        continue;
      }

      console.log(`[hubspot-ticket-closed] Ticket #${ticket.ticket_number} marked closed.`);
      closed++;
    }

    return json({ received: true, closed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[hubspot-ticket-closed] error:', msg);
    return json({ error: msg }, 500);
  }
});
