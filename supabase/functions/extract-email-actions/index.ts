/**
 * extract-email-actions Edge Function
 *
 * Takes one tier-1 Gmail message and asks Claude whether it contains an
 * actionable item (bill due, appointment confirmation, subscription
 * renewal, etc.). If yes, writes a structured row to `email_actions`.
 *
 * Called from:
 *   - sync-gmail, per tier-1 message, immediately after upsert
 *   - backfill-email-actions, for administrative reclassification (sends force)
 *
 * Input body: { gmail_message_id: string, user_id: string, force?: boolean }
 * Returns:    { action: ExtractedAction | null, reason?: string }
 *
 * ⭐ B11x (2026-08-24) — this function is idempotent per (user_id, gmail_message_id).
 * A message that already has an `email_actions` row is skipped without a Claude
 * call, and emails the keyword pre-filter rejects now record a SENTINEL row
 * (action_type NULL) so that "already looked at, found nothing" is a fact the
 * guard can read. Before this, the pre-filter path wrote nothing, and sync-gmail
 * re-sent every email in its 7-day window to Claude on every hourly tick.
 *
 * `force: true` bypasses the already-classified guard AND NOTHING ELSE. The
 * pre-filter still runs, sentinels are still written, the error path still writes
 * nothing. Only backfill-email-actions sets it; no cron may.
 *
 * `email_actions` therefore no longer means "emails with actions" — it means
 * "emails Naavi has looked at", with action_type IS NULL marking the ones that
 * had nothing worth surfacing.
 *
 * Only non-marketing, human-or-institutional emails should be fed to this
 * function (caller enforces `is_tier1 = true`). We still return `null` if
 * Claude concludes there is no actual action — avoids noise in
 * email_actions.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ExtractedAction = {
  action_type: 'pay' | 'confirm' | 'review' | 'respond' | 'appointment' | 'renewal' | 'delivery' | 'info';
  title: string;
  vendor: string;
  amount_cents: number | null;
  currency: string | null;
  due_date: string | null; // ISO 8601
  urgency: 'today' | 'this_week' | 'soon' | 'info';
  summary: string;
  document_type: 'invoice' | 'warranty' | 'receipt' | 'contract' | 'medical' | 'statement' | 'tax' | 'ticket' | 'notice' | 'other' | null;
  reference: string | null;
  expiry_date: string | null; // ISO 8601
};

type SenderType = 'personal' | 'institutional' | 'ambient';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const { gmail_message_id, user_id, force = false } = await req.json();
    if (!gmail_message_id || !user_id) {
      throw new Error('gmail_message_id and user_id required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // B11x — ALREADY-CLASSIFIED GUARD.
    //
    // sync-gmail fires this function on `if (!error && !isMarketing)` (index.ts:362),
    // and `!error` is true for an UPDATE exactly as for an INSERT — the upsert cannot
    // fail on a message already present. So every email in the rolling 7-day window
    // was re-sent to Claude on every sync, up to 168 times where the intended number
    // is 1. Measured 2026-08-24: ~1.21M Haiku input tokens/hour, flat around the
    // clock, on a two-user account.
    //
    // The guard keys on (user_id, gmail_message_id) and NOTHING ELSE — the same
    // logical key as email_actions' UNIQUE constraint, so the lookup and the table's
    // uniqueness cannot disagree. Row EXISTENCE is the whole signal. Do not add
    // action_type, dismissed, extracted_at or recency to this check: a sentinel row
    // (action_type NULL, written below when the pre-filter rejects an email) is
    // exactly how "already looked at, found nothing" is recorded, and any extra
    // condition would make those rows invisible to the guard again.
    //
    // `force` bypasses THIS GUARD ONLY. The pre-filter still runs, sentinels are
    // still written, and the error path still writes nothing. It is set solely by
    // backfill-email-actions for administrative reclassification. NO CRON AND NO
    // sync-gmail-REACHABLE PATH MAY SET IT — if force were reachable from the hourly
    // or 5-minute cron it would reinstate B11x exactly.
    if (!force) {
      const { data: priorRow } = await supabase
        .from('email_actions')
        .select('id')
        .eq('user_id', user_id)
        .eq('gmail_message_id', gmail_message_id)
        .maybeSingle();

      if (priorRow) {
        console.log(`[extract-email-actions] Already classified ${gmail_message_id} — skipping Claude call.`);
        return new Response(JSON.stringify({ action: null, reason: 'already_classified' }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }
    }

    // Fetch the email
    const { data: msg, error: fetchErr } = await supabase
      .from('gmail_messages')
      .select('subject, sender_name, sender_email, snippet, body_text, received_at, is_tier1')
      .eq('user_id', user_id)
      .eq('gmail_message_id', gmail_message_id)
      .maybeSingle();

    if (fetchErr || !msg) {
      throw new Error(`Email not found: ${fetchErr?.message ?? 'no row'}`);
    }

    // Tier-1 is a ranking signal, not a processing gate. Non-tier-1 emails
    // (e.g. receipts from SaaS billing that aren't in the institutional list)
    // still need action extraction and attachment harvesting.

    // Today's date — anchor relative dates in the email ("due tomorrow", "in 2 weeks").
    const todayParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
    }).formatToParts(new Date());
    const y = todayParts.find(p => p.type === 'year')!.value;
    const m = todayParts.find(p => p.type === 'month')!.value;
    const d = todayParts.find(p => p.type === 'day')!.value;
    const wd = todayParts.find(p => p.type === 'weekday')!.value;
    const todayISO = `${y}-${m}-${d}`;

    const emailText = [
      `From: ${msg.sender_name ?? ''} <${msg.sender_email ?? ''}>`,
      `Subject: ${msg.subject ?? ''}`,
      `Received: ${msg.received_at ?? ''}`,
      '',
      msg.snippet ?? '',
      '',
      msg.body_text ?? '',
    ].join('\n');

    // V57.7 cost audit — pre-filter emails BEFORE paying for a Claude call.
    // Tier-1 includes lots of receipts, confirmations, social posts that
    // never produce a real action. Run a fast keyword check first; only
    // emails that match an actionable signal go to Claude.
    //
    // Empirical: ~70-80% of tier-1 emails are filtered here. With 100 beta
    // users, this cuts ~$200-400/month off the email pipeline cost without
    // changing what surfaces in the morning brief.
    //
    // ⭐ B11x — IF YOU WIDEN THIS LIST, READ THIS FIRST.
    //
    // Emails rejected here now get a sentinel email_actions row (action_type NULL),
    // and the guard at the top of this function skips any message that already has
    // a row. That means widening this list NO LONGER re-evaluates old mail — it
    // applies to newly arriving email only. Before B11x, every email in the window
    // was re-classified hourly, so a keyword change took effect retroactively by
    // accident.
    //
    // To apply a widened list to email already in the window, reprocess deliberately:
    //
    //   POST /functions/v1/backfill-email-actions
    //   { "user_id": "<uuid>", "force": true, "max": <n> }
    //
    // There is deliberately NO automatic sentinel-clearing mechanism (ChatGPT Phase 3
    // review, Mandatory Change 2, 2026-08-24). Reprocessing costs real Claude calls
    // and must be an explicit decision, not a side effect of editing an array.
    const ACTIONABLE_KEYWORDS = [
      // bills / payments
      'invoice', 'receipt', 'bill', 'payment', 'charge', 'charged', 'due', 'balance', 'overdue', 'amount owed',
      // appointments / scheduling
      'appointment', 'meeting', 'reminder', 'scheduled', 'confirmed for',
      'reschedule', 'cancelled', 'canceled',
      // medical
      'prescription', 'doctor', 'clinic', 'lab result', 'test result',
      'pharmacy', 'medication', 'refill',
      // financial
      'statement', 'tax', 'refund', 'transaction', 'deposit',
      // documents / legal
      'contract', 'agreement', 'renewal', 'expir',
      // travel
      'flight', 'booking', 'reservation', 'itinerary', 'boarding',
      // urgent signals
      'urgent', 'action required', 'response needed', 'please review',
      'verify', 'confirm', 'authorize',
      // shipping (tier-1 from institutional)
      'delivered', 'shipped', 'tracking',
    ];
    // Define fireHarvest early so it can be called from the pre-filter path too.
    // harvest-attachment no-ops on emails without eligible attachments, so the
    // overhead is just a single Gmail metadata call.
    const fireHarvest = () => {
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/harvest-attachment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ user_id, gmail_message_id }),
      }).catch(err => console.error('[extract-email-actions] harvest-attachment trigger failed:', err?.message ?? err));
    };

    const lower = (msg.subject + ' ' + (msg.snippet ?? '') + ' ' + (msg.body_text ?? '').slice(0, 1500)).toLowerCase();
    const matchesActionable = ACTIONABLE_KEYWORDS.some(kw => lower.includes(kw));

    if (!matchesActionable) {
      console.log(`[extract-email-actions] Pre-filter: no actionable keywords in email "${msg.subject?.slice(0, 60)}". Skipping Claude call but still harvesting attachments.`);
      fireHarvest();

      // B11x — SENTINEL ROW. Before this, the pre-filter path wrote nothing at all,
      // which is why "skip if an email_actions row exists" was a trap: for the 70-80%
      // of emails that land here, absence of a row could not distinguish
      // never-processed from processed-and-correctly-found-nothing.
      //
      // Recording the outcome is what makes the guard above safe. Every content
      // field stays NULL — action_type IS NULL is the sole marker (Wael's Phase 2
      // decision 2, 2026-08-24). No 'pre_filter_no_keywords' string goes in `summary`
      // or any other user-content column: get-naavi-prompt instructs Naavi never to
      // read those aloud, and a system string there could reach a caller's ear.
      //
      // Deliberately NOT written on the error path further down — a pre-filter
      // rejection is deterministic (same keyword list, same answer forever) while an
      // error is transient, so errors must stay retryable. That asymmetry is what
      // preserves Success Criterion 3 with no new schema.
      const { error: sentinelErr } = await supabase
        .from('email_actions')
        .upsert({
          user_id,
          gmail_message_id,
          action_type: null,
          extracted_at: new Date().toISOString(),
        }, { onConflict: 'user_id,gmail_message_id' });

      if (sentinelErr) {
        // Non-fatal: the email genuinely has no action, so the user loses nothing
        // now. The only cost is that this message gets re-classified next sync.
        // Logged rather than swallowed, per AI Coding Discipline #21 — silent
        // failure here would look exactly like B11x never having been fixed.
        console.error(`[extract-email-actions] sentinel upsert failed for ${gmail_message_id}:`, sentinelErr.message);
      }

      return new Response(JSON.stringify({ action: null, reason: 'pre_filter_no_keywords' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const client = new Anthropic({ apiKey });

    // Prompt caching: the classifier prompt below is ~1.2k tokens and identical
    // on every email. Split into a cached system block (stable) and a short
    // user message (just the email body). ~90% input-token reduction per call.
    const classifierPrompt = `You are helping a senior user triage email. Decide whether the email below contains a real action or time-sensitive fact worth surfacing. Ignore newsletters, generic confirmations ("your order has shipped" is fine to surface; "thanks for signing up" is not), marketing, social prompts.

Also classify the sender on its OWN merit, regardless of whether the email is actionable: personal (a friend / family member / doctor / lawyer — any real individual), institutional (a government agency, bank, insurance company, utility, telecom, hospital, property manager, employer, or other organization that matters to the user's life), or ambient (newsletters, marketing, random notifications, anything else).

Also classify what KIND of document (if any) the email represents — this is about retention value, independent of whether there's an action. Use null when the email is purely conversational or doesn't resemble any document type.

Document types:
  invoice    = a bill or request for payment
  warranty   = a warranty, guarantee, or extended-protection confirmation
  receipt    = proof of purchase, order confirmation with amount paid
  contract   = signed agreement, service terms, employment document
  medical    = lab results, prescriptions, referrals, test notifications
  statement  = monthly/periodic account summary (bank, credit card, utility)
  tax        = tax slips (T4, CRA correspondence), tax-year documents
  ticket     = travel or event tickets, boarding passes, reservations
  notice     = government or institutional notice (gov.ca, Service Canada, condo board)
  calendar   = a recurring schedule listing many dated events — school year calendars, sports season schedules, holiday lists, program timetables
  other      = documentary in nature but doesn't fit above

Today is ${todayISO} (${wd}, America/Toronto).

Respond with ONE line of JSON. No markdown. No code fences.

Always include sender_type and document_type (both may be null only when truly not applicable; document_type is null for pure conversation).

If NO action — return: {"is_actionable": false, "sender_type": "<<value>>", "document_type": "<<value or null>>", "reference": "<<identifier or null>>", "expiry_date": "<<ISO 8601 or null>>"}

If YES — return an object with these fields:
{
  "is_actionable": true,
  "sender_type": "personal" | "institutional" | "ambient",
  "document_type": "invoice" | "warranty" | "receipt" | "contract" | "medical" | "statement" | "tax" | "ticket" | "notice" | "calendar" | "other" | null,
  "reference": "<<any invoice number, policy number, case ID, order number, claim number mentioned, else null>>",
  "expiry_date": "<<ISO 8601 date when the document stops being relevant (warranty end, policy expiry, ticket use-by) — NOT the same as due_date, else null>>",
  "action_type": "pay" | "confirm" | "review" | "respond" | "appointment" | "renewal" | "delivery" | "info",
  "title": "<<8-word summary>>",
  "vendor": "<<who sent it (company or person)>>",
  "amount_cents": <<integer cents if monetary amount present, else null>>,
  "currency": "<<USD|CAD|EUR|etc.>>" or null,
  "due_date": "<<ISO 8601 date/datetime if an action deadline exists, else null>>",
  "urgency": "today" | "this_week" | "soon" | "info",
  "summary": "<<one sentence, under 140 chars, tells the user what to do and when>>"
}

Rules:
- due_date must be resolved against today (${todayISO}). "tomorrow" = today + 1 day. "next Friday" = the coming Friday.
- amount_cents is an integer: "$12.50" → 1250. "CA$75" → 7500 with currency="CAD".
- urgency: "today" = due today; "this_week" = within 7 days; "soon" = 7–30 days; "info" = no hard deadline but worth knowing.
- Keep summary plain-spoken. Example: "Phone bill $65 due Thursday" or "Dr. Smith confirmed appointment Friday 3pm".
- reference must be a real identifier appearing in the email (look for "Invoice #", "Policy", "Order", "Claim", "Case", "Confirmation"). Do not fabricate.

CRITICAL — due_date vs expiry_date (they are not interchangeable):

due_date = the moment the user has to DO something.
expiry_date = the moment a document/coverage STOPS being valid.

NEVER put the same value in both fields. If only one applies, leave the other null. Examples:

  Bill/invoice due Friday               → due_date = Friday, expiry_date = null
  Appointment Friday 3pm                → due_date = Friday 3pm, expiry_date = null  (an appointment is a time to show up, NOT a document expiring)
  Meeting / event / AGM on April 30     → due_date = April 30, expiry_date = null
  Confirm/respond by Tuesday            → due_date = Tuesday, expiry_date = null
  Warranty valid for 2 years            → due_date = null, expiry_date = 2-years-from-issue
  Car insurance policy to May 2027      → due_date = null, expiry_date = May 2027
  Event ticket for June 3 concert       → due_date = June 3, expiry_date = null  (the date you use the ticket is when you act)
  Subscription renews Dec 1, cancel by Nov 20 → due_date = Nov 20 (act-by), expiry_date = Dec 1 (current period ends)

Rule of thumb: if the field tracks when to SHOW UP or PAY, it's due_date. If it tracks when a THING stops working, it's expiry_date. Appointments, events, and meetings are always due_date.

The user message will contain the email text under "EMAIL:".`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: [
        { type: 'text', text: classifierPrompt, cache_control: { type: 'ephemeral' } },
      ] as any,
      messages: [{
        role: 'user',
        content: `EMAIL:\n${emailText.slice(0, 3000)}`,
      }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    let parsed: any = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('[extract-email-actions] parse failed:', cleaned.substring(0, 200));
      return new Response(JSON.stringify({ action: null, reason: 'parse_failed' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    // Promote signal_strength when Claude says the sender is institutional
    // but sync-gmail's domain list didn't catch it (e.g., a local property
    // manager or a hospital not on the seed list). This runs whether or not
    // the email is actionable — sender type is independent of actionability.
    const senderType: SenderType | null =
      parsed?.sender_type === 'personal' || parsed?.sender_type === 'institutional' || parsed?.sender_type === 'ambient'
        ? parsed.sender_type
        : null;

    if (senderType === 'institutional') {
      // Only upgrade (institutional > personal > ambient). Never downgrade.
      const { data: current } = await supabase
        .from('gmail_messages')
        .select('signal_strength')
        .eq('user_id', user_id)
        .eq('gmail_message_id', gmail_message_id)
        .maybeSingle();

      if (current?.signal_strength !== 'institutional') {
        await supabase
          .from('gmail_messages')
          .update({ signal_strength: 'institutional' })
          .eq('user_id', user_id)
          .eq('gmail_message_id', gmail_message_id);
      }
    }

    if (!parsed?.is_actionable) {
      fireHarvest();

      // B11x — SENTINEL, second site. ⭐ THE PHASE 2 PLAN'S OUTCOME TABLE MISSED THIS
      // BRANCH. It listed three outcomes (action found / pre-filter rejected / call
      // errored); this is a fourth: Claude ran to completion and judged the email
      // non-actionable, and the original code returned here without writing anything.
      //
      // That is the *expensive* silent-nothing. A message that clears the keyword
      // pre-filter but comes back not_actionable had a Claude call paid for — and with
      // no row recording it, the guard above could not see it, so it would be re-sent
      // to Claude on every tick forever. Guarding only the pre-filter path would have
      // left this entire class of email costing money hourly, and the fix would have
      // looked like it worked because the 70-80% pre-filter case dominates the counts.
      //
      // Same shape as the pre-filter sentinel: action_type NULL, every content field
      // NULL. Deliberately NOT applied to the parse_failed branch above — a malformed
      // Claude response is a transient failure and must stay retryable, exactly like
      // the error path.
      const { error: sentinelErr } = await supabase
        .from('email_actions')
        .upsert({
          user_id,
          gmail_message_id,
          action_type: null,
          extracted_at: new Date().toISOString(),
        }, { onConflict: 'user_id,gmail_message_id' });

      if (sentinelErr) {
        console.error(`[extract-email-actions] not_actionable sentinel upsert failed for ${gmail_message_id}:`, sentinelErr.message);
      }

      return new Response(JSON.stringify({ action: null, sender_type: senderType, reason: 'not_actionable' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const validDocTypes = ['invoice','warranty','receipt','contract','medical','statement','tax','ticket','notice','calendar','other'];
    const documentType = validDocTypes.includes(parsed.document_type)
      ? parsed.document_type as ExtractedAction['document_type']
      : null;

    const action: ExtractedAction = {
      action_type: parsed.action_type ?? 'info',
      title: String(parsed.title ?? '').slice(0, 120),
      vendor: String(parsed.vendor ?? msg.sender_name ?? '').slice(0, 120),
      amount_cents: typeof parsed.amount_cents === 'number' ? parsed.amount_cents : null,
      currency: typeof parsed.currency === 'string' ? parsed.currency.slice(0, 8) : null,
      due_date: parsed.due_date ?? null,
      urgency: parsed.urgency ?? 'info',
      summary: String(parsed.summary ?? '').slice(0, 300),
      document_type: documentType,
      reference: typeof parsed.reference === 'string' ? parsed.reference.slice(0, 120) : null,
      expiry_date: parsed.expiry_date ?? null,
    };

    // Upsert — one row per (user_id, gmail_message_id). Repeat calls overwrite.
    const { error: upsertErr } = await supabase
      .from('email_actions')
      .upsert({
        user_id,
        gmail_message_id,
        ...action,
        extracted_at: new Date().toISOString(),
      }, { onConflict: 'user_id,gmail_message_id' });

    if (upsertErr) {
      console.error('[extract-email-actions] upsert failed:', upsertErr.message);
      throw new Error(upsertErr.message);
    }

    fireHarvest();

    return new Response(JSON.stringify({ action }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[extract-email-actions] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});
