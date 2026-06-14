/**
 * outbound-call Edge Function
 *
 * Places a Twilio outbound call to a third-party number and delivers a
 * spoken TTS message on behalf of the user. Used by the MAKE_CALL intent
 * ("Call Bob and say I'll be there by 3").
 *
 * POST { user_id, to_phone, to_name, body }
 * Returns { ok: true, sid: string } or { error: string }
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID        = Deno.env.get('TWILIO_ACCOUNT_SID')!;
const TWILIO_AUTH_TOKEN         = Deno.env.get('TWILIO_AUTH_TOKEN')!;
const TWILIO_FROM_NUMBER        = '+12495235394';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function xmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] ?? c),
  );
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user_id, to_phone, to_name, body } = await req.json().catch(() => ({}));

    if (!user_id || !to_phone || !body) {
      return new Response(JSON.stringify({ error: 'user_id, to_phone, and body are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch caller's name for the call intro
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: settings } = await admin
      .from('user_settings')
      .select('name')
      .eq('user_id', user_id)
      .maybeSingle();
    const callerName = settings?.name ?? 'your contact';

    // Build TwiML — Polly Joanna speaks the message then hangs up
    const safeBody = xmlEscape(String(body));
    const safeName = xmlEscape(callerName);
    const twiml = `<Response><Say voice="Polly.Joanna">Hi, this is a message from ${safeName} via Naavi. ${safeBody}</Say></Response>`;

    // Twilio REST API — initiate outbound call with inline TwiML
    const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const formBody = new URLSearchParams();
    formBody.append('To',    to_phone);
    formBody.append('From',  TWILIO_FROM_NUMBER);
    formBody.append('Twiml', twiml);

    const callRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`,
      {
        method: 'POST',
        headers: {
          Authorization:  `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody,
      },
    );

    const callData = await callRes.json();

    if (!callRes.ok) {
      console.error(`[outbound-call] Twilio error | to=${to_phone}:`, JSON.stringify(callData));
      return new Response(JSON.stringify({ error: callData.message ?? 'Twilio call failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[outbound-call] Call placed | sid=${callData.sid} | to=${to_phone} | user=${user_id}`);
    return new Response(JSON.stringify({ ok: true, sid: callData.sid }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[outbound-call] Unexpected error: ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
