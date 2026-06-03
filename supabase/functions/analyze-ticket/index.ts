/**
 * analyze-ticket Edge Function — F6a Phase 2 drafter (Wael 2026-05-21).
 *
 * Reads a ticket + scoped evidence, calls Claude under the
 * "no-unverified-claims" rule (CLAUDE.md 2026-05-20), and produces a
 * draft reply. Posts the draft to HubSpot as an Internal Note so staff
 * can review/edit/send via HubSpot's native Reply button, and stores
 * the draft on tickets.draft_response for re-run continuity.
 *
 * Input: { ticket_id: uuid, dry_run?: boolean }
 *   - dry_run=true  → returns the draft + evidence list as JSON;
 *                     does NOT post to HubSpot, does NOT update tickets.
 *   - dry_run=false → posts HubSpot Internal Note, updates tickets row.
 *
 * Evidence sources passed to Claude (locked 2026-05-21):
 *   1. The ticket body itself.
 *   2. audit_trail of prior tickets from the same reporter_email.
 *   3. When the email maps to a registered user:
 *        - user_settings (name, phone, addresses)
 *        - action_rules (active alerts/reminders)
 *        - recent sent_messages (last 30 outbound)
 *
 * NOT in scope: HubSpot's full historical ticket thread for the contact
 * (decision 2026-05-21: keep evidence sources DB-local to avoid
 * surprises from manual HubSpot edits flowing into drafts unexpectedly).
 *
 * Service-role authenticated. Called by cron analyze-new-tickets and
 * cron reanalyze-on-reply (Step 4 + Step 5 of F6a Phase 2).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.79.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};


const CLAUDE_MODEL    = 'claude-sonnet-4-6';
const CLAUDE_MAX_TOK  = 2048;

interface AnalyzeInput {
  ticket_id: string;
  dry_run?:  boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function est(iso: string | null | undefined): string {
  if (!iso) return '(unknown time)';
  try {
    return new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Toronto' }) + ' EST';
  } catch { return iso; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');

  if (!anthropicKey) return json({ error: 'ANTHROPIC_API_KEY not set' }, 500);

  const admin = createClient(supabaseUrl, serviceKey);
  const claude = new Anthropic({ apiKey: anthropicKey });

  try {
    const { ticket_id, dry_run = false } = (await req.json()) as AnalyzeInput;
    if (!ticket_id) return json({ error: 'ticket_id required' }, 400);

    // ── Load the ticket ──────────────────────────────────────────────
    const { data: ticket, error: tErr } = await admin
      .from('tickets')
      .select('*')
      .eq('id', ticket_id)
      .maybeSingle();
    if (tErr || !ticket) return json({ error: `ticket not found: ${tErr?.message ?? 'no row'}` }, 404);

    // We don't draft for terminal-state tickets.
    if (['sent', 'closed', 'cancelled'].includes(ticket.status)) {
      return json({ skipped: true, reason: `ticket status='${ticket.status}' — not drafting`, ticket_number: ticket.ticket_number });
    }

    // ── Load scoped evidence ─────────────────────────────────────────
    const evidence: Record<string, unknown> = {
      ticket: {
        ticket_number:  ticket.ticket_number,
        source_channel: ticket.source_channel,
        reporter_email: ticket.reporter_email,
        reporter_name:  ticket.reporter_name,
        reporter_phone: ticket.reporter_phone,
        subject:        ticket.subject,
        body:           ticket.body,
        severity:       ticket.severity,
        created_at:     est(ticket.created_at),
        status:         ticket.status,
        prior_drafts:   Array.isArray(ticket.audit_trail)
          ? ticket.audit_trail.filter((e: any) => e.actor === 'analyze-ticket').slice(-3)
          : [],
      },
    };

    // (a) Prior tickets from the same reporter_email (exclude current).
    const { data: priorTickets } = await admin
      .from('tickets')
      .select('ticket_number, source_channel, subject, body, status, created_at, audit_trail')
      .eq('reporter_email', ticket.reporter_email)
      .neq('id', ticket.id)
      .order('created_at', { ascending: false })
      .limit(10);
    evidence.prior_tickets_same_reporter = (priorTickets ?? []).map(t => ({
      ticket_number: t.ticket_number,
      status:        t.status,
      created_at:    est(t.created_at),
      source_channel: t.source_channel,
      subject:       (t.subject || '').slice(0, 120),
      body_excerpt:  (t.body   || '').slice(0, 400),
    }));

    // (b) Registered-user context (only when user_id resolved).
    if (ticket.user_id) {
      const [settingsRes, rulesRes, sentRes] = await Promise.all([
        admin.from('user_settings').select('name, phone, phone_numbers, home_address, work_address, voice_pin_hash').eq('user_id', ticket.user_id).maybeSingle(),
        admin.from('action_rules').select('id, trigger_type, action_type, label, enabled, trigger_config, action_config, last_fired_at, created_at').eq('user_id', ticket.user_id).order('updated_at', { ascending: false }).limit(20),
        admin.from('sent_messages').select('channel, recipient, body, status, created_at').eq('user_id', ticket.user_id).order('created_at', { ascending: false }).limit(30),
      ]);
      evidence.user_settings = settingsRes.data ? {
        name:           settingsRes.data.name,
        phone:          settingsRes.data.phone,
        phone_numbers:  settingsRes.data.phone_numbers,
        home_address:   settingsRes.data.home_address,
        work_address:   settingsRes.data.work_address,
        voice_pin_set:  !!settingsRes.data.voice_pin_hash,
      } : null;
      evidence.action_rules = (rulesRes.data ?? []).map(r => ({
        id:             r.id,
        trigger_type:   r.trigger_type,
        action_type:    r.action_type,
        label:          r.label,
        enabled:        r.enabled,
        trigger_config: r.trigger_config,
        action_config:  r.action_config,
        last_fired_at:  est(r.last_fired_at),
        created_at:     est(r.created_at),
      }));
      evidence.recent_sent_messages = (sentRes.data ?? []).map(m => ({
        channel:      m.channel,
        recipient:    m.recipient,
        body_excerpt: (m.body || '').slice(0, 200),
        status:       m.status,
        created_at:   est(m.created_at),
      }));
    } else {
      evidence.user_settings = null;
      evidence.action_rules = [];
      evidence.recent_sent_messages = [];
    }

    // ── Detect close intent in latest customer message ───────────────
    // If the customer's latest inbound message says "close", "resolved",
    // "thank you that's all", etc. — generate a thank-you closing draft
    // and auto-close the ticket instead of a regular support reply.
    const CLOSE_INTENT_RE = /\b(close|closed|closing|resolved|resolve|no\s+need|cancel|never\s+mind|nevermind|that'?s?\s+(all|it|fine|ok|okay|good)|thank\s+you\s+(that'?s?\s+all|so\s+much|for\s+your\s+help|for\s+the\s+help)|all\s+(good|set|resolved)|issue\s+(is\s+)?(resolved|fixed|gone)|it\s+(works?|worked|fixed)|fixed\s+now|sorted|no\s+longer\s+(an?\s+)?(issue|problem))\b/i;

    const replies = Array.isArray(ticket.replies) ? ticket.replies : [];
    const lastInbound = [...replies].reverse().find((r: any) => r.direction === 'inbound');
    const latestCustomerBody = lastInbound?.body ?? ticket.body ?? '';

    if (CLOSE_INTENT_RE.test(latestCustomerBody)) {
      console.log(`[analyze-ticket] close intent detected for ticket #${ticket.ticket_number}: "${latestCustomerBody.slice(0, 80)}"`);

      const customerName = ticket.reporter_name?.split(' ')?.[0] || null;
      const greeting = customerName && /^[A-Za-z]{2,20}$/.test(customerName) ? `Hi ${customerName},` : 'Hi,';

      const thankYouDraft = `${greeting}\n\nThank you for letting us know — we're glad the issue is resolved! We'll go ahead and close this ticket.\n\nIf you ever need anything else, don't hesitate to reach out.\n\n— MyNaavi Team`;

      if (!dry_run) {
        await admin.from('tickets').update({
          draft_response:  thankYouDraft,
          last_drafted_at: new Date().toISOString(),
          audit_trail:     [...(Array.isArray(ticket.audit_trail) ? ticket.audit_trail : []), {
            at:    new Date().toISOString(),
            actor: 'analyze-ticket',
            note:  'Close intent detected — thank-you draft generated for staff to send and close',
          }],
        }).eq('id', ticket_id);
      }

      return json({
        ticket_number:    ticket.ticket_number,
        close_intent:     true,
        draft_reply:      thankYouDraft,
      });
    }

    // ── Build the Claude prompt ──────────────────────────────────────
    const systemPrompt = `You are Naavi's support drafter. Your job is to draft a reply to a customer support ticket. The draft will be posted as an internal note on a HubSpot ticket; a human staff member will read it, edit if needed, then send to the customer via HubSpot's native Reply.

THE RULE THAT GOVERNS YOUR DRAFT (CLAUDE.md 2026-05-20 — "no unverified claims in outbound messages"):

Every factual assertion in your draft about the user, their account, their alerts, their history, or system state MUST trace to a specific entry in the EVIDENCE PACKET below. If you can't trace a claim to evidence, you cannot include it in the draft. When evidence is missing, write "we don't know yet" or "we're still investigating" — never invent a cause.

NEVER write any of these without an evidence row backing it:
- "You disconnected X" / "You changed Y" / "You stopped Z" (these accuse the user of an action).
- "Your alert at <address> fired at <time>" (the time + address + fire must be in evidence).
- "We sent you <message>" (must be in recent_sent_messages).
- "Your <feature> is enabled/disabled" (must be in evidence settings).

Default to neutral state observations: "Naavi's connection to your account isn't working — here's how to restore it" beats "you disconnected." Prefer the action over the diagnosis: tell the user the EXACT step to take.

STYLE RULES — keep the draft tight and human:

1. Salutation. ONLY use the customer's first name in the greeting when user_settings.name is a plausible real first name (e.g., "Sarah", "Hussein", "Wael"). If the name looks like an email handle (lowercase with digits, no spaces), a brand/domain ("mynaavi", "egyptiancan"), or is empty/null, write exactly "Hi," — never "Hi there", never the misleading handle/brand name.

2. Natural warmth is welcome. Opening phrases like "Thank you for signing up" or "We're glad you're here" are appropriate and human — keep them where they fit naturally. The substance is still the focus; the warmth is the wrapper.

3. Short and direct. Aim for 2–4 short paragraphs. If one sentence is enough, write one sentence.

4. No vague timing. Never write "shortly", "ASAP", "soon", "very soon", "in a bit", "in a moment". When referencing how long the customer will wait for a human response, state the concrete SLA: "within 2 business days". If the answer is already in the draft and the customer doesn't need to wait, don't reference timing at all.

5. Signature is always exactly "— MyNaavi Team" on its own line at the bottom. Never "Naavi support", "Naavi team", "Customer Support", "— Wael", or anyone's individual name. The whole team responds, not a dedicated support role; the signature reflects that.

OUTPUT FORMAT — you MUST respond with a single JSON object only (no prose around it):

{
  "draft_reply": "<the message to the customer — friendly, concise, action-oriented, signed exactly '— MyNaavi Team' on its own line at the bottom>",
  "claims_evidence": [
    { "claim": "<short paraphrase of one factual claim in your draft>", "source": "<evidence section + specific row, e.g. 'action_rules row id=abc — trigger_type=location, enabled=true'>" },
    ...one entry per factual claim...
  ],
  "uncertainty_notes": "<what you don't know that may affect the reply, or empty string if nothing>"
}

If the ticket is a simple non-factual reply (e.g., a "thanks" or a feature request you can answer generically), claims_evidence can be empty array. If a factual answer would require evidence we don't have, say so in uncertainty_notes and write a draft that asks the customer for the missing info OR honestly says "we're investigating."`;

    const userMessage = `EVIDENCE PACKET (everything you may rely on):

${JSON.stringify(evidence, null, 2)}

Draft the reply now. JSON only — no prose, no markdown fences.`;

    // ── Call Claude ──────────────────────────────────────────────────
    const claudeStart = Date.now();
    const response = await claude.messages.create({
      model:        CLAUDE_MODEL,
      max_tokens:   CLAUDE_MAX_TOK,
      system:       systemPrompt,
      messages:     [{ role: 'user', content: userMessage }],
      temperature:  0,
    });
    const claudeMs = Date.now() - claudeStart;

    const textBlocks = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => String(b.text ?? ''))
      .join('');

    // Strip code fences if Claude added them despite our instruction.
    const cleaned = textBlocks.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    let parsed: { draft_reply: string; claims_evidence: { claim: string; source: string }[]; uncertainty_notes: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('[analyze-ticket] Claude returned non-JSON:', cleaned.slice(0, 500));
      return json({ error: 'claude_response_not_json', raw: cleaned.slice(0, 1000), claude_ms: claudeMs }, 500);
    }

    const evidenceCount = Array.isArray(parsed.claims_evidence) ? parsed.claims_evidence.length : 0;
    console.log(`[analyze-ticket] #${ticket.ticket_number} drafted in ${claudeMs}ms — ${parsed.draft_reply.length} chars, ${evidenceCount} cited claims, dry_run=${dry_run}`);

    // ── Dry-run: return without writing ──────────────────────────────
    if (dry_run) {
      return json({
        success:        true,
        dry_run:        true,
        ticket_id,
        ticket_number:  ticket.ticket_number,
        claude_ms:      claudeMs,
        draft:          parsed,
      });
    }

    // ── Save draft to Supabase (HubSpot removed 2026-06-01) ─────────
    // Draft stored in tickets.draft_response for staff to read and send
    // via the Naavi tickets web page. Status stays 'new' until staff closes.
    const auditEntry = {
      at:          new Date().toISOString(),
      actor:       'analyze-ticket',
      from_status: ticket.status,
      to_status:   ticket.status,
      note:        `Draft saved (${evidenceCount} cited claims, ${parsed.draft_reply.length} chars).`,
    };
    const newAudit = Array.isArray(ticket.audit_trail) ? [...ticket.audit_trail, auditEntry] : [auditEntry];

    const { error: uErr } = await admin
      .from('tickets')
      .update({
        draft_response:  parsed.draft_reply,
        last_drafted_at: new Date().toISOString(),
        audit_trail:     newAudit,
      })
      .eq('id', ticket.id);
    if (uErr) {
      console.error('[analyze-ticket] tickets UPDATE failed:', uErr.message);
      return json({ error: 'tickets_update_failed', detail: uErr.message }, 500);
    }

    return json({
      success:       true,
      ticket_id,
      ticket_number: ticket.ticket_number,
      status:        ticket.status,
      claude_ms:     claudeMs,
      draft_length:     parsed.draft_reply.length,
      claims_count:     evidenceCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[analyze-ticket] error:', msg);
    return json({ error: msg }, 500);
  }
});

// Minimal markdown→HTML for the draft body. HubSpot's editable email
// composer renders hs_email_html (not hs_email_text) as rich content,
// so without this the draft appears as one collapsed paragraph with
// literal "**asterisks**". Only supports: paragraphs (double newline),
// line breaks (single newline), bold (**text**), italic (*text*),
// numbered lists. Strips nothing beyond HTML-escaping the source.
function mdToHtml(md: string): string {
  // 1) HTML-escape first so any literal &/</> in the draft is safe.
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // 2) Bold and italic (bold before italic so ** doesn't get consumed as two *).
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?])/g, '$1<em>$2</em>');
  // 3) Split into paragraphs on blank line, then convert single newlines inside
  // each paragraph to <br>.
  const paragraphs = html.split(/\n{2,}/).map(p => p.replace(/\n/g, '<br>'));
  return paragraphs.map(p => `<p>${p}</p>`).join('');
}

function formatDraftEmailBody(parsed: { draft_reply: string; claims_evidence: { claim: string; source: string }[]; uncertainty_notes: string }, ticket: { ticket_number: number }): string {
  // Return the draft reply only — no internal footer, no evidence section.
  // Staff reviews and sends directly from HubSpot.
  return parsed.draft_reply;
}
