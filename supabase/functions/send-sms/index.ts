/**
 * send-sms Edge Function
 *
 * Sends an SMS to a phone number via Twilio.
 * Called by check-email-alerts when a watch rule is triggered.
 *
 * Required Supabase secrets:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER  (e.g. "+15145550100")
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { to, body } = await req.json() as { to: string; body: string };

    if (!to || !body) {
      return new Response(JSON.stringify({ error: 'Missing to or body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accountSid  = Deno.env.get('TWILIO_ACCOUNT_SID')!;
    const authToken   = Deno.env.get('TWILIO_AUTH_TOKEN')!;
    const fromNumber  = Deno.env.get('TWILIO_FROM_NUMBER')!;

    const credentials = btoa(`${accountSid}:${authToken}`);

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: fromNumber, Body: body }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error('[send-sms] Twilio error:', data);
      return new Response(JSON.stringify({ error: data.message ?? 'Twilio error' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[send-sms] Sent to ${to}: ${body.slice(0, 60)}`);
    return new Response(JSON.stringify({ success: true, sid: data.sid }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[send-sms] Error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
