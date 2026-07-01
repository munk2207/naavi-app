/**
 * receive-demo-sms-reply Edge Function
 *
 * Twilio inbound SMS webhook for the demo line's SMS sender number(s)
 * (DEMO_SMS_FROM in production; a separate staging equivalent). Mirrors the
 * shape of receive-sms-reply (the existing ticket-reply inbound webhook)
 * but is scoped to a different job — F2b TCPA opt-out enforcement — so it
 * is its own function rather than overloading receive-sms-reply's ticket
 * logic. See docs/F2B_PHASE2_CHANGE_PLAN_2026-07-01.md.
 *
 * Twilio posts form-encoded body with: From, To, Body, MessageSid
 *
 * When Body matches a standard opt-out keyword, upserts the sender's phone
 * into demo_optouts. Both create-demo-reminder (at creation time) and
 * evaluate-rules::fireAction (at send time, for action_config.source =
 * 'demo_line' rows) check this table before sending.
 *
 * Deployed separately per environment (staging / production project ref);
 * each environment's demo SMS number's Twilio webhook points at that
 * environment's own deployment, so no environment branching is needed here.
 *
 * Returns empty TwiML so Twilio does not read anything back to the sender
 * beyond its own standard opt-out confirmation text.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

// Twilio's standard Advanced Opt-Out keyword set (case-insensitive, exact
// match on the trimmed body) — matches what carriers already treat as an
// opt-out signal, so app-level enforcement doesn't diverge from platform
// behavior.
const OPT_OUT_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);

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
    const text = await req.text();
    const params = new URLSearchParams(text);

    const fromPhone  = params.get('From') ?? '';
    const body       = (params.get('Body') ?? '').trim().toLowerCase();
    const messageSid = params.get('MessageSid') ?? '';

    if (!fromPhone || !body) {
      console.warn('[receive-demo-sms-reply] missing From or Body — ignoring');
      return twiml();
    }

    if (!OPT_OUT_KEYWORDS.has(body)) {
      console.log(`[receive-demo-sms-reply] non-opt-out reply from ${fromPhone}, ignoring (MessageSid: ${messageSid})`);
      return twiml();
    }

    const { error } = await admin
      .from('demo_optouts')
      .upsert({ phone: fromPhone }, { onConflict: 'phone' });

    if (error) {
      console.error(`[receive-demo-sms-reply] failed to record opt-out for ${fromPhone}:`, error.message);
      return twiml(500);
    }

    console.log(`[receive-demo-sms-reply] opt-out recorded for ${fromPhone} (MessageSid: ${messageSid})`);
    return twiml();

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[receive-demo-sms-reply] error:', msg);
    return twiml(500);
  }
});
