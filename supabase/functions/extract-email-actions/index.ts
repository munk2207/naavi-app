/**
 * extract-email-actions Edge Function
 *
 * Takes one tier-1 Gmail message and asks Claude whether it contains an
 * actionable item (bill due, appointment confirmation, subscription
 * renewal, etc.). If yes, writes a structured row to `email_actions`.
 *
 * Called from:
 *   - sync-gmail, per tier-1 message, immediately after upsert
 *   - One-off backfill scripts (pass { gmail_message_id, user_id })
 *
 * Input body: { gmail_message_id: string, user_id: string }
 * Returns:    { action: ExtractedAction | null }
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
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const { gmail_message_id, user_id } = await req.json();
    if (!gmail_message_id || !user_id) {
      throw new Error('gmail_message_id and user_id required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

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

    if (!msg.is_tier1) {
      return new Response(JSON.stringify({ action: null, reason: 'not_tier1' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

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

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `You are helping a senior user triage email. Decide whether the email below contains a real action or time-sensitive fact worth surfacing. Ignore newsletters, generic confirmations ("your order has shipped" is fine to surface; "thanks for signing up" is not), marketing, social prompts.

Today is ${todayISO} (${wd}, America/Toronto).

Respond with ONE line of JSON. No markdown. No code fences.

If NO action — return: {"is_actionable": false}

If YES — return an object with these fields:
{
  "is_actionable": true,
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

EMAIL:
${emailText.slice(0, 3000)}`,
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

    if (!parsed?.is_actionable) {
      return new Response(JSON.stringify({ action: null, reason: 'not_actionable' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const action: ExtractedAction = {
      action_type: parsed.action_type ?? 'info',
      title: String(parsed.title ?? '').slice(0, 120),
      vendor: String(parsed.vendor ?? msg.sender_name ?? '').slice(0, 120),
      amount_cents: typeof parsed.amount_cents === 'number' ? parsed.amount_cents : null,
      currency: typeof parsed.currency === 'string' ? parsed.currency.slice(0, 8) : null,
      due_date: parsed.due_date ?? null,
      urgency: parsed.urgency ?? 'info',
      summary: String(parsed.summary ?? '').slice(0, 300),
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
