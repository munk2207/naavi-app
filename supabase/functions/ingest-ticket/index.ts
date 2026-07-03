/**
 * ingest-ticket Edge Function — F6a Phase 2 (Wael 2026-06-01).
 *
 * Single ingress point for the support ticket system.
 * Replaces HubSpot integration with Postmark for email delivery.
 *
 * On every ticket creation:
 *   1. Saves ticket row to Supabase
 *   2. Sends acknowledgment email to customer via Postmark
 *   3. Notifies staff at support@mynaavi.com
 *
 * Source channels: web-contact, web-report, internal-relay, mobile-contact,
 * mobile-report, voice-call.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const POSTMARK_API   = 'https://api.postmarkapp.com';
const SUPPORT_EMAIL  = 'support@mynaavi.com';
const SUPPORT_NAME   = 'MyNaavi Team';

interface IngestPayload {
  source_channel:     string;
  subject?:           string;
  body?:              string;
  reporter_email?:    string;
  reporter_phone?:    string;
  reporter_name?:     string;
  severity?:          string;
  linked_holding_id?: string;
  user_id?:           string;
  created_by?:        string;
  email?:             string;
  name?:              string;
  phone?:             string;
  description?:       string;
  context?:           string;
  message?:           string;
  reason?:            string;
  intent?:            string;
  note?:              string;
  source?:            string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sendEmail(pmToken: string, opts: {
  to: string; toName?: string;
  from: string; fromName: string;
  subject: string; textBody: string; htmlBody?: string;
  replyTo?: string; tag?: string;
}): Promise<void> {
  const res = await fetch(`${POSTMARK_API}/email`, {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': pmToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      From:     `${opts.fromName} <${opts.from}>`,
      To:       opts.toName ? `${opts.toName} <${opts.to}>` : opts.to,
      Subject:  opts.subject,
      TextBody: opts.textBody,
      HtmlBody: opts.htmlBody,
      ReplyTo:  opts.replyTo,
      Tag:      opts.tag,
      MessageStream: 'outbound',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`postmark_send_${res.status}: ${JSON.stringify(err).slice(0, 200)}`);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const pmToken     = Deno.env.get('POSTMARK_SERVER_TOKEN') ?? '';
  const admin       = createClient(supabaseUrl, serviceKey);

  try {
    const payload = (await req.json()) as IngestPayload;
    const channel = String(payload.source_channel ?? '').trim();

    // ── Validate source_channel ──────────────────────────────────────
    const allowedChannels = new Set([
      'formspree-report', 'formspree-contact', 'formspree-invitation',
      'web-report', 'web-contact', 'web-invitation',
      'mobile-report', 'mobile-contact',
      'internal-relay', 'voice-call',
    ]);
    if (!allowedChannels.has(channel)) {
      return json({ error: `unknown source_channel: ${channel}` }, 400);
    }

    // ── CSRF / origin validation for web-* channels ──────────────────
    if (channel.startsWith('web-')) {
      const origin = req.headers.get('origin') || '';
      const allowedOrigins = ['https://mynaavi.com', 'https://www.mynaavi.com'];
      const isAllowed = allowedOrigins.includes(origin) ||
        /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin);
      if (!isAllowed) {
        console.warn(`[ingest-ticket] rejected web-* call from origin: "${origin}"`);
        return json({ error: 'origin_not_allowed' }, 403);
      }
    }

    // ── Extract subject + body ───────────────────────────────────────
    let subject = String(payload.subject ?? '').trim();
    let body    = String(payload.body ?? '').trim();
    const description = String(payload.description ?? '').trim();
    const context     = String(payload.context ?? '').trim();
    const message     = String(payload.message ?? '').trim();
    const reason      = String(payload.reason ?? '').trim();
    const intent      = String(payload.intent ?? '').trim();
    const note        = String(payload.note ?? '').trim();

    if (!body) {
      if (description)           body = context ? `${description}\n\n— context: ${context}` : description;
      else if (message && reason) body = `[${reason}] ${message}`;
      else if (intent || message) body = `intent: ${intent || '(none)'}\n\n${message || '(no message)'}`;
      else if (note)              body = note;
      else if (message)           body = message;
    }
    if (!subject) {
      if (description)            subject = description.slice(0, 80);
      else if (reason && message) subject = message.slice(0, 80);
      else if (intent)            subject = 'Signup request';
      else if (note)              subject = 'Invitation request';
      else if (message)           subject = message.slice(0, 80);
      else if (body)              subject = body.slice(0, 80);
    }
    if (!subject || !body) {
      return json({ error: 'subject and body required' }, 400);
    }

    // ── Validate reporter email ──────────────────────────────────────
    const emailCandidate = String(payload.email ?? payload.reporter_email ?? '').trim();
    if (!emailCandidate || !/@/.test(emailCandidate)) {
      return json({ error: 'email required and must be a valid address' }, 400);
    }

    const reporterEmail = emailCandidate.toLowerCase();
    const reporterPhone = String(payload.phone ?? payload.reporter_phone ?? '').trim();
    const reporterName  = String(payload.name  ?? payload.reporter_name  ?? '').trim();

    // ── Resolve user_id ──────────────────────────────────────────────
    let userId: string | null = payload.user_id ? String(payload.user_id) : null;
    if (!userId && reporterEmail) {
      try {
        const { data: users } = await admin.auth.admin.listUsers();
        const found = users?.users?.find(u => u.email?.toLowerCase() === reporterEmail);
        if (found) userId = found.id;
      } catch (_) { /* anonymous report acceptable */ }
    }
    if (!userId && reporterPhone) {
      const { data: settings } = await admin
        .from('user_settings')
        .select('user_id')
        .or(`phone.eq.${reporterPhone},phone_numbers.cs.{${reporterPhone}}`)
        .maybeSingle();
      if (settings?.user_id) userId = String(settings.user_id);
    }

    // ── B8b (2026-07-03) — track who actually created the ticket ────────
    // Separate from source_channel (how the customer originally reached
    // support). The staff portal already sends created_by on every
    // channel, not just "Other" (internal-relay) — previously this was
    // only read for internal-relay and silently discarded otherwise, so
    // a staffer picking "Phone call" produced a ticket indistinguishable
    // from one the real live voice-call system created automatically.
    // Now persisted as its own column regardless of channel; NULL means
    // system-created. send-ticket-reply uses this to always reply by
    // email for staff-created tickets, regardless of source_channel.
    const createdBy = String(payload.created_by ?? '').trim();

    // ── Insert ticket row ────────────────────────────────────────────
    const auditEntry = {
      at:          new Date().toISOString(),
      actor:       createdBy || 'system',
      from_status: null,
      to_status:   'new',
      note:        `Ingested via ${channel}` + (userId ? ` — resolved to user ${userId.slice(0, 8)}` : ' — anonymous'),
    };

    const { data: ticket, error } = await admin
      .from('tickets')
      .insert({
        source_channel:    channel,
        created_by:        createdBy || null,
        user_id:           userId,
        reporter_email:    reporterEmail || null,
        reporter_phone:    reporterPhone || null,
        reporter_name:     reporterName  || null,
        subject:           subject.slice(0, 500),
        body:              body.slice(0, 8000),
        severity:          payload.severity ?? null,
        linked_holding_id: payload.linked_holding_id ?? null,
        audit_trail:       [auditEntry],
      })
      .select('id, ticket_number, subject')
      .single();

    if (error || !ticket) {
      console.error('[ingest-ticket] insert failed:', error?.message ?? 'no row');
      return json({ error: `insert_failed: ${error?.message ?? 'unknown'}` }, 500);
    }

    console.log(`[ingest-ticket] new ticket #${ticket.ticket_number} via ${channel}: "${ticket.subject.slice(0, 60)}"`);

    // ── Send acknowledgment email to customer (Postmark) ────────────
    // Skip all email/SMS sends for known test addresses — prevents auto-tester
    // runs from flooding support@mynaavi.com with notification emails.
    const isTestTicket = /\.example\.com$/i.test(reporterEmail)
      || reporterEmail === 'firebase-testlab@mynaavi.com'
      || subject.startsWith('TICKET-TEST-');
    if (reporterEmail && pmToken && !isTestTicket) {
      const firstName = reporterName.split(/\s+/)[0] || 'there';
      const submittedDate = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
      const ackText =
        `Hi ${firstName},\n\n` +
        `Thank you for reaching out to MyNaavi. We've received your support request and a member of our team will follow up within 2 business days.\n\n` +
        `To add more details or follow up, simply reply to this email.\n\n` +
        `── Your ticket details ──────────────────\n` +
        `Ticket #${ticket.ticket_number}\n` +
        `Submitted: ${submittedDate}\n` +
        `Description: ${body.slice(0, 200)}\n` +
        `────────────────────────────────────────\n\n` +
        `— MyNaavi Team`;

      const ackHtml =
        `<p>Hi ${firstName},</p>` +
        `<p>Thank you for reaching out to MyNaavi. We've received your support request and a member of our team will follow up within 2 business days.</p>` +
        `<p>To add more details or follow up, simply reply to this email.</p>` +
        `<table style="border-collapse:collapse;width:100%;max-width:480px;background:#f9f9f7;border-radius:8px;padding:16px;font-size:14px;">` +
        `<tr><td colspan="2" style="padding:8px 12px;font-weight:700;border-bottom:1px solid #e0e0e0;">Ticket #${ticket.ticket_number}</td></tr>` +
        `<tr><td style="padding:6px 12px;color:#666;width:120px;">Submitted</td><td style="padding:6px 12px;">${submittedDate}</td></tr>` +
        `<tr><td style="padding:6px 12px;color:#666;vertical-align:top;">Description</td><td style="padding:6px 12px;">${body.slice(0, 200)}</td></tr>` +
        `</table>` +
        `<br><p>— MyNaavi Team</p>`;

      try {
        await sendEmail(pmToken, {
          from:     SUPPORT_EMAIL,
          fromName: SUPPORT_NAME,
          to:       reporterEmail,
          toName:   reporterName || undefined,
          subject:  `MyNaavi Support — Ticket #${ticket.ticket_number} received`,
          textBody: ackText,
          htmlBody: ackHtml,
          replyTo:  SUPPORT_EMAIL,
          tag:      'ticket-ack',
        });
        console.log(`[ingest-ticket] acknowledgment email sent to ${reporterEmail} for ticket #${ticket.ticket_number}`);
      } catch (emailErr) {
        console.warn('[ingest-ticket] acknowledgment email failed (non-fatal):', emailErr);
      }

      // ── Notify staff ─────────────────────────────────────────────
      try {
        await sendEmail(pmToken, {
          from:     SUPPORT_EMAIL,
          fromName: SUPPORT_NAME,
          to:       SUPPORT_EMAIL,
          subject:  `New ticket #${ticket.ticket_number} — ${ticket.subject.slice(0, 60)}`,
          textBody: `New ticket received.\n\nFrom: ${reporterName || reporterEmail} <${reporterEmail}>\nChannel: ${channel}\n\n${body.slice(0, 500)}`,
          tag:      'ticket-staff-notify',
        });
        console.log(`[ingest-ticket] staff notification sent for ticket #${ticket.ticket_number}`);
      } catch (notifyErr) {
        console.warn('[ingest-ticket] staff notification failed (non-fatal):', notifyErr);
      }
    }

    // ── SMS confirmation for phone-based channels ────────────────────
    // voice-call and internal-relay originate from phone interactions —
    // the reporter may not have email open. Send an SMS with the ticket
    // number as a safety net so they have immediate confirmation.
    // B8b (2026-07-03) — only for a REAL live-call ticket the automated
    // voice system created (no created_by). A staffer manually logging a
    // ticket after the fact has no live-call urgency; the acknowledgment
    // email above already covers it.
    if (!createdBy && (channel === 'voice-call' || channel === 'internal-relay') && reporterPhone && !isTestTicket) {
      try {
        const smsBody = `MyNaavi support ticket #${ticket.ticket_number} received. We'll follow up by email within 2 business days.`;
        await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ to: reporterPhone, body: smsBody, user_id: userId }),
        });
        console.log(`[ingest-ticket] SMS confirmation sent to ${reporterPhone} for ticket #${ticket.ticket_number}`);
      } catch (smsErr) {
        console.warn('[ingest-ticket] SMS confirmation failed (non-fatal):', smsErr);
      }
    }

    return json({
      success:       true,
      ticket_id:     ticket.id,
      ticket_number: ticket.ticket_number,
      status:        'new',
      user_id:       userId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingest-ticket] error:', msg);
    return json({ error: msg }, 500);
  }
});
