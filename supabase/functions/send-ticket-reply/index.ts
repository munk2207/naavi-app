/**
 * send-ticket-reply Edge Function (2026-06-01)
 *
 * Staff approves the draft and sends a reply to the customer via Postmark.
 * Called from the mynaavi.com/tickets.html staff page.
 *
 * Input: { ticket_id, reply_body, staff_email }
 *
 * Steps:
 *   1. Validate staff_email against support_staff table
 *   2. Load ticket (reporter_email, ticket_number, subject, replies)
 *   3. Send email to customer via Postmark
 *   4. Append reply to tickets.replies JSONB array
 *   5. Update audit_trail
 *   6. Update status to 'sent' if first reply, else keep 'new'
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const POSTMARK_API  = 'https://api.postmarkapp.com';
const SUPPORT_EMAIL = 'support@mynaavi.com';
const SUPPORT_NAME  = 'MyNaavi Team';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const pmToken     = Deno.env.get('POSTMARK_SERVER_TOKEN') ?? '';
  const admin       = createClient(supabaseUrl, serviceKey);

  try {
    const { ticket_id, reply_body, staff_email } = await req.json();

    if (!ticket_id)    return json({ error: 'ticket_id required' }, 400);
    if (!reply_body?.trim()) return json({ error: 'reply_body required' }, 400);
    if (!staff_email)  return json({ error: 'staff_email required' }, 400);

    // ── Validate staff ───────────────────────────────────────────────
    const { data: staffRow } = await admin
      .from('support_staff')
      .select('email')
      .eq('email', staff_email)
      .eq('active', true)
      .maybeSingle();
    if (!staffRow) return json({ error: 'not_authorized' }, 403);

    // ── Load ticket ──────────────────────────────────────────────────
    const { data: ticket, error: tErr } = await admin
      .from('tickets')
      .select('id, ticket_number, subject, reporter_email, reporter_name, reporter_phone, source_channel, created_by, status, replies, audit_trail')
      .eq('id', ticket_id)
      .maybeSingle();
    if (tErr || !ticket) return json({ error: 'ticket_not_found' }, 404);
    if (ticket.status === 'closed') return json({ error: 'ticket_already_closed' }, 400);
    if (!ticket.reporter_email)     return json({ error: 'ticket_has_no_reporter_email' }, 400);

    // ── Send email via Postmark ──────────────────────────────────────
    if (!pmToken) return json({ error: 'POSTMARK_SERVER_TOKEN not set' }, 500);

    const emailSubject = `Re: Ticket #${ticket.ticket_number} — ${ticket.subject}`.slice(0, 200);
    // Strip trailing signature if already present in the draft to avoid duplication.
    const cleanBody    = reply_body.trim().replace(/\s*—\s*MyNaavi Team\s*$/i, '').trim();
    const textBody     = `${cleanBody}\n\n— MyNaavi Team`;
    const htmlBody     = `<p>${cleanBody.replace(/\n/g, '<br>')}</p><p>— MyNaavi Team</p>`;

    const pmRes = await fetch(`${POSTMARK_API}/email`, {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': pmToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        From:          `${SUPPORT_NAME} <${SUPPORT_EMAIL}>`,
        To:            ticket.reporter_name
          ? `${ticket.reporter_name} <${ticket.reporter_email}>`
          : ticket.reporter_email,
        Subject:       emailSubject,
        TextBody:      textBody,
        HtmlBody:      htmlBody,
        ReplyTo:       '0711007d25ae18da311a4386f94e5744@inbound.postmarkapp.com',
        Tag:           'ticket-reply',
        MessageStream: 'outbound',
      }),
    });

    if (!pmRes.ok) {
      const pmErr = await pmRes.json().catch(() => ({}));
      console.error('[send-ticket-reply] Postmark error:', pmRes.status, JSON.stringify(pmErr).slice(0, 200));
      return json({ error: `postmark_${pmRes.status}`, detail: pmErr }, 502);
    }

    const pmData = await pmRes.json();
    const messageId = pmData.MessageID ?? '';
    console.log(`[send-ticket-reply] reply sent for ticket #${ticket.ticket_number} → ${ticket.reporter_email}, MessageID: ${messageId}`);

    // ── SMS for voice-call tickets ───────────────────────────────────
    // Voice callers may not check email — send the full reply via SMS too.
    // B8b (2026-07-03) — email always sends above regardless; this SMS is
    // a supplementary send, not a replacement. Only fires for a REAL
    // live-call ticket the automated voice system created (no created_by)
    // — a staffer manually logging a ticket after receiving a call has no
    // live-call urgency, and email is already guaranteed, so no extra SMS.
    let smsSent = false;
    if (!ticket.created_by && (ticket.source_channel === 'voice-call' || ticket.source_channel === 'internal-relay') && ticket.reporter_phone) {
      try {
        const smsText = `MyNaavi support (ticket #${ticket.ticket_number}):\n${cleanBody}`;
        await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ to: ticket.reporter_phone, body: smsText }),
        });
        smsSent = true;
        console.log(`[send-ticket-reply] SMS reply sent to ${ticket.reporter_phone} for ticket #${ticket.ticket_number}`);
      } catch (smsErr) {
        console.warn('[send-ticket-reply] SMS reply failed (non-fatal):', smsErr);
      }
    }

    // ── Append to replies ────────────────────────────────────────────
    const newReply: Record<string, unknown> = {
      at:         new Date().toISOString(),
      from_email: SUPPORT_EMAIL,
      from_name:  SUPPORT_NAME,
      direction:  'outbound',
      body:       reply_body.trim(),
      message_id: messageId,
      sent_by:    staff_email,
      sms_sent:   smsSent,
      sms_to:     smsSent ? ticket.reporter_phone : null,
    };
    const replies = Array.isArray(ticket.replies) ? [...ticket.replies, newReply] : [newReply];

    // ── Auto-advance status: new → in_progress on first staff reply ────
    const newStatus = ticket.status === 'new' ? 'sent' : ticket.status;

    // ── Append to audit_trail ────────────────────────────────────────
    const auditEntry = {
      at:          new Date().toISOString(),
      actor:       staff_email,
      from_status: ticket.status,
      to_status:   newStatus,
      note:        `Reply sent to ${ticket.reporter_email} (MessageID: ${messageId})`,
    };
    const newAudit = Array.isArray(ticket.audit_trail)
      ? [...ticket.audit_trail, auditEntry]
      : [auditEntry];

    // ── Update ticket ────────────────────────────────────────────────
    const { error: uErr } = await admin
      .from('tickets')
      .update({ replies, audit_trail: newAudit, status: newStatus })
      .eq('id', ticket.id);

    if (uErr) {
      console.error('[send-ticket-reply] DB update failed:', uErr.message);
      return json({ error: 'db_update_failed', detail: uErr.message }, 500);
    }

    return json({
      success:       true,
      ticket_number: ticket.ticket_number,
      message_id:    messageId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[send-ticket-reply] error:', msg);
    return json({ error: msg }, 500);
  }
});
