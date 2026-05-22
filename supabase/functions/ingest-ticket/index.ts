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

const HUBSPOT_API = 'https://api.hubapi.com';
// "Support Pipeline" id=0, stage "New" id=1 — verified 2026-05-20 via connectivity test
const HUBSPOT_PIPELINE_ID    = '0';
const HUBSPOT_PIPELINE_STAGE = '1';
const HUBSPOT_PORTAL_ID      = '343125145'; // MyNaavi Foundation

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

  // Web form payload shape — fields named per the form's
  // <input name="..."> attributes. We extract subject/body from
  // these when source_channel starts with 'web-' or 'formspree-' or
  // 'mobile-'. Optional fields cover all 4 production forms today:
  //   /report  — description + context + email + severity
  //   /contact — email + reason + message
  //   /start   — name + email + phone + note
  //   /#signup — email + intent + message
  email?:       string;
  name?:        string;
  phone?:       string;
  description?: string;
  context?:     string;
  message?:     string;
  reason?:      string;
  intent?:      string;
  note?:        string;
  source?:      string; // analytics tag — home-signup / phone-demo-line / web-report etc.
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
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const payload = (await req.json()) as IngestPayload;
    const channel = String(payload.source_channel ?? '').trim();

    // ── Validate source_channel ──────────────────────────────────────
    // web-* channels are public form submissions (browser-originated);
    // formspree-* kept for backward compat if a Formspree submission
    // hits before the Formspree projects are deleted; mobile-* come
    // from the in-app screens; internal-relay is Wael creating tickets
    // via Claude; voice-call is the future Twilio path.
    const allowedChannels = new Set([
      'formspree-report',
      'formspree-contact',
      'formspree-invitation',
      'web-report',
      'web-contact',
      'web-invitation',
      'mobile-report',
      'mobile-contact',
      'internal-relay',
      'voice-call',
    ]);
    if (!allowedChannels.has(channel)) {
      return json({ error: `unknown source_channel: ${channel}` }, 400);
    }

    // ── CSRF / origin validation for web-* channels ─────────────────
    // Browser-originated POSTs MUST come from mynaavi.com (or a known
    // dev origin). Server-originated calls (internal-relay, mobile-*,
    // voice-call) come without an Origin header and require the
    // Authorization Bearer service-role check upstream — they bypass
    // this gate. The check is belt-and-suspenders to Cloudflare's
    // Bot Fight Mode at the edge.
    if (channel.startsWith('web-')) {
      const origin = req.headers.get('origin') || '';
      const allowedOrigins = [
        'https://mynaavi.com',
        'https://www.mynaavi.com',
        // Vercel preview deploys + local dev allowed for testing.
        // Production rejects everything else.
      ];
      const isAllowed = allowedOrigins.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin);
      if (!isAllowed) {
        console.warn(`[ingest-ticket] rejected web-* call from origin: "${origin}"`);
        return json({ error: 'origin_not_allowed' }, 403);
      }
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
    const intent      = String(payload.intent ?? '').trim();
    const note        = String(payload.note ?? '').trim();
    const sourceTag   = String(payload.source ?? '').trim();

    if (!body) {
      // /report shape — description (required) + context (optional).
      if (description) body = context ? `${description}\n\n— context: ${context}` : description;
      // /contact shape — message + reason.
      else if (message && reason) body = `[${reason}] ${message}`;
      // /#signup shape — intent + message.
      else if (intent || message) body = `intent: ${intent || '(none)'}\n\n${message || '(no message)'}`;
      // /start shape — note (freeform "Anything we should know?").
      else if (note) body = note;
      // Bare message fallback (no reason).
      else if (message) body = message;
    }
    // 2026-05-21 (Wael) — customer-facing subjects only. The dropdown/tag
    // values (intent, reason, sourceTag) are internal classifications that
    // appear in the HubSpot ticket BODY for staff context; they must NOT
    // leak into the email subject the customer sees in their inbox.
    if (!subject) {
      if (description)         subject = description.slice(0, 80);              // /report — customer-written
      else if (reason && message) subject = message.slice(0, 80);                // /contact — drop reason tag
      else if (intent)         subject = 'Signup request';                       // homepage signup — drop intent tag
      else if (note)           subject = 'Invitation request';                   // /start — drop sourceTag
      else if (message)        subject = message.slice(0, 80);
      else if (body)           subject = body.slice(0, 80);
    }

    if (!subject || !body) {
      return json({ error: 'subject and body required (either directly or via description/message)' }, 400);
    }

    // 2026-05-20 (Wael) — every ticket MUST carry a reporter email,
    // no exceptions. Public submitters need it as the only response
    // channel. Registered users carry it via OAuth. Voice-call and
    // internal-relay paths must look up the user's email before
    // invoking ingest-ticket. Rejecting at the entry keeps the
    // tickets.reporter_email column reliable for every downstream
    // path (HubSpot mirror, analyze-ticket drafter, reply routing).
    const emailCandidate = String(payload.email ?? payload.reporter_email ?? '').trim();
    if (!emailCandidate || !/@/.test(emailCandidate)) {
      return json({ error: 'email required and must be a valid address' }, 400);
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

    // ── Create HubSpot ticket (awaited) ──────────────────────────────
    // HubSpot Service Hub is the team's triage surface. For each ticket
    // with a reporter_email we:
    //   (a) find-or-create a Contact in HubSpot by email
    //   (b) create a Ticket in the Support Pipeline → "New" stage,
    //       associated with the Contact
    // HubSpot's built-in pipeline automation handles the customer
    // acknowledgment email (configured server-side in HubSpot, not in
    // this function).
    //
    // Awaited because Deno Edge Functions kill unfinished async work
    // when the response is sent. Failures are recorded in audit_trail
    // but do not block — the DB row is the source of truth.
    let hubspotTicketId: string | null = null;
    let hubspotContactId: string | null = null;
    let hubspotError:    string | null = null;
    if (reporterEmail) {
      const hsToken = Deno.env.get('HUBSPOT_ACCESS_TOKEN');
      if (hsToken) {
        const hsHeaders = {
          Authorization: `Bearer ${hsToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        };
        try {
          // Find existing contact by email.
          const searchRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
            method: 'POST',
            headers: hsHeaders,
            body: JSON.stringify({
              filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: reporterEmail }] }],
              properties: ['email', 'firstname', 'lastname'],
              limit: 1,
            }),
          });
          const searchBody = await searchRes.json();
          if (!searchRes.ok) {
            throw new Error(`contact_search_${searchRes.status}: ${JSON.stringify(searchBody).slice(0, 200)}`);
          }
          if (searchBody.results?.length) {
            hubspotContactId = String(searchBody.results[0].id);
          } else {
            // Create new contact.
            let firstname = '';
            let lastname  = '';
            if (reporterName.trim()) {
              const parts = reporterName.trim().split(/\s+/);
              firstname = parts[0];
              lastname  = parts.slice(1).join(' ');
            }
            const createContactRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts`, {
              method: 'POST',
              headers: hsHeaders,
              body: JSON.stringify({
                properties: {
                  email: reporterEmail,
                  firstname: firstname || reporterEmail.split('@')[0],
                  lastname:  lastname  || '',
                  phone:     reporterPhone || undefined,
                },
              }),
            });
            const createContactBody = await createContactRes.json();
            if (!createContactRes.ok) {
              throw new Error(`contact_create_${createContactRes.status}: ${JSON.stringify(createContactBody).slice(0, 200)}`);
            }
            hubspotContactId = String(createContactBody.id);
          }

          // Create ticket, associated with the contact.
          // hs_ticket_category accepts free-text; we put the source_channel there
          // for triage. Naavi ticket # goes into the subject prefix.
          const ticketRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/tickets`, {
            method: 'POST',
            headers: hsHeaders,
            body: JSON.stringify({
              properties: {
                // 2026-05-21 (Wael) — HubSpot ticket subject is JUST the
                // Naavi ticket number. Customer subject line stays short
                // and predictable ("Your ticket 'Ticket #1049' has been
                // received") regardless of how long their typed content
                // is. The customer's original subject + body content
                // appear in the HubSpot ticket BODY below (so staff sees
                // the full request when they click into a ticket).
                subject:           `Ticket #${ticket.ticket_number}`,
                content:           body + `\n\n— Source: ${channel}` + (sourceTag ? ` (${sourceTag})` : '') + `\n— Ticket: #${ticket.ticket_number}` + `\n— Sender Email: ${reporterEmail}`,
                hs_pipeline:       HUBSPOT_PIPELINE_ID,
                hs_pipeline_stage: HUBSPOT_PIPELINE_STAGE,
                hs_ticket_priority: 'MEDIUM',
              },
              associations: [{
                to: { id: hubspotContactId },
                types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 16 }],
              }],
            }),
          });
          const ticketBody = await ticketRes.json();
          if (!ticketRes.ok) {
            throw new Error(`ticket_create_${ticketRes.status}: ${JSON.stringify(ticketBody).slice(0, 300)}`);
          }
          hubspotTicketId = String(ticketBody.id);
          console.log(`[ingest-ticket] HubSpot ticket ${hubspotTicketId} created for Naavi ticket #${ticket.ticket_number}`);

          // 2026-05-21 (Wael) — also create an inbound EMAIL engagement
          // representing the customer's submission. Without this, the
          // ticket has no email thread for staff to "Reply" on — clicking
          // the standalone Email button opens a blank composer with no
          // subject / no recipient context. With this inbound email in
          // the timeline, staff clicks Reply on it and HubSpot auto-fills
          // the composer with subject "Re: Ticket #NNNN — <subject>",
          // To: customer, From: staff. Decided after the 2026-05-21
          // editable-Logged-email UI verification.
          const inboundSubject = `Ticket #${ticket.ticket_number} — ${ticket.subject}`.slice(0, 200);
          const inboundRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/emails`, {
            method:  'POST',
            headers: hsHeaders,
            body: JSON.stringify({
              properties: {
                hs_timestamp:       new Date().toISOString(),
                hs_email_status:    'SENT',
                hs_email_direction: 'INCOMING_EMAIL',
                hs_email_subject:   inboundSubject,
                hs_email_text:      body,
                hs_email_headers:   JSON.stringify({
                  from: { email: reporterEmail, firstName: reporterName.split(/\s+/)[0] || '', lastName: reporterName.split(/\s+/).slice(1).join(' ') || '' },
                  to:   [{ email: 'support@mynaavi.com', firstName: 'MyNaavi', lastName: 'Team' }],
                  cc:   [],
                  bcc:  [],
                }),
              },
              associations: [
                { to: { id: hubspotTicketId },  types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 224 }] }, // email → ticket
                { to: { id: hubspotContactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 198 }] }, // email → contact
              ],
            }),
          });
          if (!inboundRes.ok) {
            const inboundErrBody = await inboundRes.json().catch(() => ({}));
            console.warn(`[ingest-ticket] inbound email engagement create failed (non-fatal): ${inboundRes.status} ${JSON.stringify(inboundErrBody).slice(0, 200)}`);
          } else {
            const inboundBody = await inboundRes.json();
            console.log(`[ingest-ticket] inbound email engagement ${inboundBody.id} created`);
          }
        } catch (err) {
          hubspotError = err instanceof Error ? err.message : String(err);
          console.warn('[ingest-ticket] HubSpot integration threw:', hubspotError);
        }
      } else {
        hubspotError = 'credentials_missing';
        console.warn('[ingest-ticket] HUBSPOT_ACCESS_TOKEN not set — skipping HubSpot ticket create');
      }

      // Append audit_trail entry with the outcome.
      const followupEntry = {
        at: new Date().toISOString(),
        actor: 'system',
        from_status: 'new',
        to_status: 'new',
        note: hubspotTicketId
          ? `HubSpot ticket ${hubspotTicketId} created (contact ${hubspotContactId}) — https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/ticket/${hubspotTicketId}`
          : `HubSpot integration failed: ${hubspotError}`,
      };
      // Persist the HubSpot ids as dedicated columns so analyze-ticket can
      // look them up without regex-parsing audit_trail text. Migration
      // 20260521_tickets_hubspot_refs.sql added the columns + backfilled
      // existing rows; this populates them going forward. Stays NULL when
      // HubSpot integration failed.
      await admin.from('tickets').update({
        audit_trail:        [auditEntry, followupEntry],
        hubspot_ticket_id:  hubspotTicketId,
        hubspot_contact_id: hubspotContactId,
      }).eq('id', ticket.id);
    }

    // Always return success even if Help Scout fails — the
    // ticket is already saved.
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
