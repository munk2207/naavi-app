/**
 * send-sms Edge Function
 *
 * Sends an SMS or WhatsApp message to a phone number via Twilio.
 * Called by check-email-alerts, check-reminders, and the app (DRAFT_MESSAGE).
 *
 * Required Supabase secrets:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER    (e.g. "+15145550100" — for SMS)
 *   TWILIO_WHATSAPP_FROM  (e.g. "+14155238886" — sandbox or production WhatsApp number)
 *
 * Request body:
 *   { to: "+1234567890", body: "message text", channel?: "sms" | "whatsapp" }
 *
 * For WhatsApp: prefixes To/From with "whatsapp:" per Twilio API.
 * Default channel is "sms" for backwards compatibility.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { to, body, channel = 'sms' } = await req.json() as {
      to: string;
      body: string;
      channel?: 'sms' | 'whatsapp';
    };

    if (!to || !body) {
      return new Response(JSON.stringify({ error: 'Missing to or body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
    const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')!;

    // WhatsApp: prefix To and From with "whatsapp:" per Twilio API
    // WhatsApp Sandbox uses +14155238886, not the SMS number
    const isWhatsApp = channel === 'whatsapp';
    const whatsAppFrom = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '+14155238886';
    const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER')!;
    const twilioTo   = isWhatsApp ? `whatsapp:${to}` : to;
    const twilioFrom = isWhatsApp ? `whatsapp:${whatsAppFrom}` : fromNumber;

    const credentials = btoa(`${accountSid}:${authToken}`);

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: twilioTo, From: twilioFrom, Body: body }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error(`[send-sms] Twilio error (${channel}):`, data);
      return new Response(JSON.stringify({ error: data.message ?? 'Twilio error' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[send-sms] Sent ${channel} to ${to}: ${body.slice(0, 60)}`);
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
