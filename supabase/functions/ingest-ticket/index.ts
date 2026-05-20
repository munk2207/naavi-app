/**
 * ingest-ticket Edge Function — F6a Phase 1 (Wael 2026-05-20).
 *
 * Single ingress point for the mini AI-triage support system. Accepts
 * two payload shapes, both writing to the same `tickets` table:
 *
 *   1. Formspree webhook payload — when a user submits /report,
 *      /contact, /start, or the mobile-app equivalents. Formspree
 *      POSTs JSON with the form fields after a successful submission
 *      (paid Production plan feature; needs the webhook URL
 *      configured per project in the Formspree dashboard).
 *
 *   2. Internal-relay payload — when Wael or team creates a ticket
 *      manually because a user reported via informal channels (SMS to
 *      Wael, verbal, voice call, in-person). Source: 'internal-relay'.
 *
 * Both paths:
 *   - Resolve user_id from reporter_email / reporter_phone where
 *     possible (so the ticket links to the right user_settings row).
 *   - Insert a ticket row with status 'new' and an initial audit_trail
 *     entry capturing the ingest event.
 *   - Fire an SMS notification to Wael (+16137697957) with the ticket
 *     number + short subject. Reuses send-sms Edge Function.
 *
 * Service-role authenticated (server-to-server). Formspree webhook
 * uses the long-lived webhook URL; internal-relay uses a Claude /
 * server-side call.
 *
 * Out of scope for Phase 1:
 *   - Auto-triage (Claude API call to draft a response on ingest).
 *   - Admin UI / dashboard for ticket review.
 *   - Pattern detection (linked_holding_id aggregation, weekly
 *     summary, multiple-reports-same-issue alerts).
 *   - Public status surface ("user texts 'status of my ticket'").
 *
 * All of those land in Phase 2/3/4. Phase 1 proves the data model +
 * the manual investigate-draft-approve-send loop via Claude chat.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WAEL_PHONE   = '+16137697957';
const WAEL_USER_ID = '788fe85c-b6be-4506-87e8-a8736ec8e1d1';

interface IngestPayload {
  // Common fields — all entry points populate these.
  source_channel: string;
  subject?:       string;
  body?:          string;
  reporter_email?: string;
  reporter_phone?: string;
  reporter_name?:  string;
  severity?:      string;
  linked_holding_id?: string;

  // Internal-relay extras — pre-resolved user_id allowed; saves a
  // lookup when Wael already knows who the ticket is from.
  user_id?: string;

  // Formspree webhook payload shape — fields named per the form's
  // <input name="..."> attributes. We extract subject/body from
  // these when source_channel starts with 'formspree-'.
  // Example shape: { email, name, phone, description, context,
  //   severity, source, ... }
  email?:       string;
  name?:        string;
  phone?:       string;
  description?: string;
  context?:     string;
  message?:     string;
  reason?:      string;
}

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
  const interFnKey   = Deno.env.get('NAAVI_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const payload = (await req.json()) as IngestPayload;
    const channel = String(payload.source_channel ?? '').trim();

    // ── Validate source_channel ──────────────────────────────────────
    const allowedChannels = new Set([
      'formspree-report',
      'formspree-contact',
      'formspree-invitation',
      'mobile-report',
      'mobile-contact',
      'internal-relay',
      'voice-call',
    ]);
    if (!allowedChannels.has(channel)) {
      return json({ error: `unknown source_channel: ${channel}` }, 400);
    }

    // ── Extract subject + body — shape varies by source ──────────────
    // Formspree forms post the fields by their <input name>; map to
    // canonical subject/body. Internal-relay passes subject/body
    // directly. If neither shape produces content, reject.
    let subject = String(payload.subject ?? '').trim();
    let body    = String(payload.body ?? '').trim();
    const description = String(payload.description ?? '').trim();
    const context     = String(payload.context ?? '').trim();
    const message     = String(payload.message ?? '').trim();
    const reason      = String(payload.reason ?? '').trim();

    if (!body) {
      // Formspree /report shape: description (required) + context (optional).
      if (description) body = context ? `${description}\n\n— context: ${context}` : description;
      // Formspree /contact shape: message + reason.
      else if (message) body = reason ? `[${reason}] ${message}` : message;
    }
    if (!subject) {
      // Derive a subject from the first line of body when not provided.
      if (description) subject = description.slice(0, 80);
      else if (message) subject = (reason || 'Contact form') + ': ' + message.slice(0, 60);
      else if (body) subject = body.slice(0, 80);
    }

    if (!subject || !body) {
      return json({ error: 'subject and body required (either directly or via description/message)' }, 400);
    }

    // ── Resolve user_id from reporter_email / reporter_phone ─────────
    // Service-role auth lets us join across auth.users + user_settings
    // to find the matching account. Best-effort — anonymous reports
    // (no matching user) leave user_id NULL.
    const reporterEmail = String(payload.email ?? payload.reporter_email ?? '').trim().toLowerCase();
    const reporterPhone = String(payload.phone ?? payload.reporter_phone ?? '').trim();
    const reporterName  = String(payload.name  ?? payload.reporter_name  ?? '').trim();

    let userId: string | null = payload.user_id ? String(payload.user_id) : null;

    if (!userId && reporterEmail) {
      // Try auth.users first (Supabase Auth email).
      try {
        const { data: users } = await admin.auth.admin.listUsers();
        const found = users?.users?.find(u => u.email?.toLowerCase() === reporterEmail);
        if (found) userId = found.id;
      } catch (_) { /* swallow — anonymous report acceptable */ }
    }
    if (!userId && reporterPhone) {
      // Try user_settings.phone (mobile-registered phone).
      const { data: settings } = await admin
        .from('user_settings')
        .select('user_id, phone, phone_numbers')
        .or(`phone.eq.${reporterPhone},phone_numbers.cs.{${reporterPhone}}`)
        .maybeSingle();
      if (settings?.user_id) userId = String(settings.user_id);
    }

    // ── Build initial audit_trail entry ──────────────────────────────
    const auditEntry = {
      at: new Date().toISOString(),
      actor: channel === 'internal-relay' ? 'wael' : 'system',
      from_status: null,
      to_status: 'new',
      note: `Ingested via ${channel}` + (userId ? ` — resolved to user ${userId.slice(0, 8)}` : ' — anonymous'),
    };

    // ── Insert ticket row ────────────────────────────────────────────
    const { data: ticket, error } = await admin
      .from('tickets')
      .insert({
        source_channel:    channel,
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

    console.log(`[ingest-ticket] new ticket #${ticket.ticket_number} via ${channel}: "${ticket.subject.slice(0,60)}"`);

    // ── Notify Wael via SMS (fire-and-forget) ────────────────────────
    // Per the CLAUDE.md outbound-message rule, this SMS is a NEUTRAL
    // status notification to the team member who owns triage — not a
    // message to the reporter. Safe to fire without per-claim
    // verification because we're only relaying ticket # + subject.
    const notifBody = `[Naavi support] New ticket #${ticket.ticket_number} via ${channel}: ${ticket.subject.slice(0, 120)}`;
    fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
      body: JSON.stringify({
        to: WAEL_PHONE,
        body: notifBody,
        channel: 'sms',
        user_id: WAEL_USER_ID,
        recipient_name: 'Wael',
        sender_name: 'Naavi',
        source: 'ticket-ingest-notification',
      }),
    }).then(res => {
      if (!res.ok) console.warn(`[ingest-ticket] notification SMS returned ${res.status}`);
    }).catch(err => console.warn('[ingest-ticket] notification SMS threw:', err.message ?? err));

    // Always return success even if notification fails — the ticket is
    // already saved; we just couldn't ping Wael yet.
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
