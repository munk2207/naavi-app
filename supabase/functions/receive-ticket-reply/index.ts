/**
 * receive-ticket-reply Edge Function
 *
 * Postmark inbound webhook — fires when a customer replies to a staff email.
 * Extracts the ticket number from the subject line, appends the customer's
 * reply to the ticket thread, and updates status back to 'new' so staff
 * can see there is a new customer message waiting.
 *
 * Postmark sends a POST with JSON body containing:
 *   From, FromFull, Subject, TextBody, HtmlBody, MessageID, Date, etc.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Extract ticket number from subject like "Re: Ticket #3113 — subject"
function extractTicketNumber(subject: string): number | null {
  const m = subject.match(/ticket\s+#(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

// Strip quoted reply text (lines starting with ">") to keep only the new content
function stripQuotedText(text: string): string {
  return text
    .split('\n')
    .filter(line => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(/\r/g, '')
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin       = createClient(supabaseUrl, serviceKey);

  try {
    const payload = await req.json();

    const fromEmail  = String(payload.From || payload.FromFull?.Email || '').toLowerCase().trim();
    const subject    = String(payload.Subject || '').trim();
    const rawText    = String(payload.TextBody || '').trim();
    const messageId  = String(payload.MessageID || '').trim();
    const fromName   = String(payload.FromFull?.Name || payload.FromName || '').trim();

    if (!fromEmail || !subject) {
      console.warn('[receive-ticket-reply] missing From or Subject — ignoring');
      return json({ ok: true, skipped: 'missing_from_or_subject' });
    }

    const ticketNumber = extractTicketNumber(subject);
    if (!ticketNumber) {
      console.warn(`[receive-ticket-reply] no ticket number in subject: "${subject}"`);
      return json({ ok: true, skipped: 'no_ticket_number_in_subject' });
    }

    // Load ticket by ticket_number + reporter_email for security
    const { data: ticket, error: tErr } = await admin
      .from('tickets')
      .select('id, ticket_number, status, reporter_email, replies, audit_trail')
      .eq('ticket_number', ticketNumber)
      .maybeSingle();

    if (tErr || !ticket) {
      console.warn(`[receive-ticket-reply] ticket #${ticketNumber} not found`);
      return json({ ok: true, skipped: 'ticket_not_found' });
    }

    if (ticket.status === 'closed') {
      console.warn(`[receive-ticket-reply] ticket #${ticketNumber} is closed — ignoring reply`);
      return json({ ok: true, skipped: 'ticket_closed' });
    }

    // Verify sender matches reporter email
    if (ticket.reporter_email && fromEmail !== ticket.reporter_email.toLowerCase()) {
      console.warn(`[receive-ticket-reply] sender ${fromEmail} does not match reporter ${ticket.reporter_email} for ticket #${ticketNumber}`);
      return json({ ok: true, skipped: 'sender_mismatch' });
    }

    const body = stripQuotedText(rawText) || rawText;

    const newReply = {
      at:         new Date().toISOString(),
      from_email: fromEmail,
      from_name:  fromName || fromEmail,
      direction:  'inbound',
      body,
      message_id: messageId,
    };

    const replies = Array.isArray(ticket.replies) ? [...ticket.replies, newReply] : [newReply];

    const auditEntry = {
      at:          new Date().toISOString(),
      actor:       fromEmail,
      from_status: ticket.status,
      to_status:   'new',
      note:        `Customer replied via email (MessageID: ${messageId})`,
    };
    const newAudit = Array.isArray(ticket.audit_trail)
      ? [...ticket.audit_trail, auditEntry]
      : [auditEntry];

    const { error: uErr } = await admin
      .from('tickets')
      .update({ replies, audit_trail: newAudit, status: 'new' })
      .eq('id', ticket.id);

    if (uErr) {
      console.error('[receive-ticket-reply] DB update failed:', uErr.message);
      return json({ error: 'db_update_failed' }, 500);
    }

    console.log(`[receive-ticket-reply] customer reply appended to ticket #${ticketNumber} from ${fromEmail}`);
    return json({ ok: true, ticket_number: ticketNumber });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[receive-ticket-reply] error:', msg);
    return json({ error: msg }, 500);
  }
});
