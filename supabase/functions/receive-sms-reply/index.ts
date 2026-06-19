/**
 * receive-sms-reply Edge Function
 *
 * Twilio inbound SMS webhook — fires when a customer replies to an SMS
 * that was sent as part of a voice-call or internal-relay ticket reply.
 *
 * Twilio posts form-encoded body with: From, To, Body, MessageSid
 *
 * Finds the most recent non-closed ticket for the sender's phone number,
 * appends the reply to the thread, and resets status to 'new' so staff
 * can see there is a new customer message waiting.
 *
 * Returns empty TwiML <Response/> so Twilio does not read anything back.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

function twiml(status = 200): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status,
    headers: { 'Content-Type': 'text/xml' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin       = createClient(supabaseUrl, serviceKey);

  try {
    // Twilio posts form-encoded
    const text = await req.text();
    const params = new URLSearchParams(text);

    const fromPhone  = params.get('From') ?? '';
    const body       = (params.get('Body') ?? '').trim();
    const messageSid = params.get('MessageSid') ?? '';

    if (!fromPhone || !body) {
      console.warn('[receive-sms-reply] missing From or Body — ignoring');
      return twiml();
    }

    console.log(`[receive-sms-reply] inbound SMS from ${fromPhone}: "${body.slice(0, 80)}"`);

    // Find most recent non-closed ticket for this phone number
    const { data: ticket, error: tErr } = await admin
      .from('tickets')
      .select('id, ticket_number, status, replies, audit_trail')
      .eq('reporter_phone', fromPhone)
      .neq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tErr || !ticket) {
      console.warn(`[receive-sms-reply] no open ticket found for phone ${fromPhone}`);
      return twiml();
    }

    const newReply = {
      at:         new Date().toISOString(),
      from_phone: fromPhone,
      direction:  'inbound',
      channel:    'sms',
      body,
      message_sid: messageSid,
    };

    const replies = Array.isArray(ticket.replies) ? [...ticket.replies, newReply] : [newReply];

    const wantsClose = /\bclose\b/i.test(body);
    const newStatus  = wantsClose ? 'closed' : 'new';

    const auditEntry = {
      at:          new Date().toISOString(),
      actor:       fromPhone,
      from_status: ticket.status,
      to_status:   newStatus,
      note:        wantsClose
        ? `Customer closed ticket via SMS (MessageSid: ${messageSid})`
        : `Customer replied via SMS (MessageSid: ${messageSid})`,
    };
    const newAudit = Array.isArray(ticket.audit_trail)
      ? [...ticket.audit_trail, auditEntry]
      : [auditEntry];

    const { error: uErr } = await admin
      .from('tickets')
      .update({ replies, audit_trail: newAudit, status: newStatus })
      .eq('id', ticket.id);

    if (uErr) {
      console.error('[receive-sms-reply] DB update failed:', uErr.message);
      return twiml(500);
    }

    console.log(`[receive-sms-reply] SMS reply appended to ticket #${ticket.ticket_number} from ${fromPhone}`);
    return twiml();

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[receive-sms-reply] error:', msg);
    return twiml(500);
  }
});
