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

// Empty TwiML acknowledges the webhook without replying. `message` (added by
// S1 Track D) emits a <Message> so Twilio sends an SMS back — used to confirm
// a BLOCK instruction so the owner knows it took effect.
function twiml(status = 200, message?: string): Response {
  const escaped = message
    ? message.replace(/[<>&'"]/g, (c) =>
        ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] ?? c))
    : '';
  const inner = message ? `<Message>${escaped}</Message>` : '';
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
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

    // ── S1 Track D (2026-08-19) — "BLOCK" stops unregistered-phone access ────
    //
    // The bank model: Naavi alerts the owner about failed PIN attempts and the
    // OWNER decides. Never automatic — auto-blocking would hand an attacker a
    // denial-of-service against the real owner (Wael, Phase 0).
    //
    // Checked BEFORE ticket handling so a security instruction is never
    // swallowed as a reply to an open support thread. Matched strictly: the
    // whole message must be the word, so "block" inside ordinary prose in a
    // ticket reply cannot trigger it.
    //
    // Authority comes from the sending number: only the registered owner of an
    // account can block it, because only they receive SMS at that number.
    // Re-enabling is deliberately NOT possible here — it requires the mobile
    // app, so the recovery channel stays stronger than the attacked one and an
    // attacker working the phone line cannot undo it.
    if (/^\s*block\s*$/i.test(body)) {
      const { data: owners, error: oErr } = await admin
        .from('user_settings')
        .select('user_id')
        .eq('phone', fromPhone);

      if (oErr) {
        console.error('[receive-sms-reply] S1 BLOCK — owner lookup failed:', oErr.message);
        return twiml();
      }
      if (!owners?.length) {
        // Say nothing useful back: replying "no account" to an arbitrary number
        // would confirm which numbers are registered.
        console.warn(`[receive-sms-reply] S1 BLOCK from unrecognised number ${fromPhone} — ignoring`);
        return twiml();
      }

      const ids = owners.map((o: { user_id: string }) => o.user_id);
      const { error: uErr } = await admin
        .from('user_settings')
        .update({ voice_unregistered_blocked: true })
        .in('user_id', ids);

      if (uErr) {
        console.error('[receive-sms-reply] S1 BLOCK — update failed:', uErr.message);
        return twiml();
      }

      console.log(`[receive-sms-reply] S1 BLOCK applied to ${ids.length} account(s) for ${fromPhone}`);
      return twiml(
        200,
        'Done. Calls from unregistered phones are now blocked for your account. '
        + 'Turn it back on in the Naavi app.',
      );
    }

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
