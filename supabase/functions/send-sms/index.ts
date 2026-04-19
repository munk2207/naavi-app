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
 *   { to: "+1234567890", body: "message text", channel?: "sms" | "whatsapp",
 *     recipient_name?: "Wael", sender_name?: "Naavi" }
 *
 * For WhatsApp: uses the naavi_message_from_sender template with ContentVariables.
 *   - {{1}} = recipient_name (defaults to "there")
 *   - {{2}} = sender_name (defaults to "Naavi")
 *   - {{3}} = body
 *
 * For SMS: sends body as plain text.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { to, body, channel = 'sms', recipient_name, sender_name } = await req.json() as {
      to: string;
      body: string;
      channel?: 'sms' | 'whatsapp';
      recipient_name?: string;
      sender_name?: string;
    };

    if (!to || !body) {
      return new Response(JSON.stringify({ error: 'Missing to or body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
    const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')!;

    const isWhatsApp = channel === 'whatsapp';
    const whatsAppFrom = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '+14155238886';
    const fromNumber = Deno.env.get('TWILIO_FROM_NUMBER')!;
    const twilioTo   = isWhatsApp ? `whatsapp:${to}` : to;
    const twilioFrom = isWhatsApp ? `whatsapp:${whatsAppFrom}` : fromNumber;

    const credentials = btoa(`${accountSid}:${authToken}`);

    let params: URLSearchParams;

    if (isWhatsApp) {
      // Use the pre-approved template so the message goes through outside the 24h window.
      // Template: "Hi {{1}}, {{2}} shared this message with you: {{3}} — Sent via MyNaavi."
      const templateSid = Deno.env.get('TWILIO_WHATSAPP_TEMPLATE_MESSAGE_SID');
      if (templateSid) {
        params = new URLSearchParams({
          To: twilioTo,
          From: twilioFrom,
          ContentSid: templateSid,
          ContentVariables: JSON.stringify({
            '1': recipient_name || 'there',
            '2': sender_name || 'Naavi',
            '3': body,
          }),
        });
      } else {
        // Fallback: free-form body (works only within 24h session window)
        params = new URLSearchParams({ To: twilioTo, From: twilioFrom, Body: body });
      }
    } else {
      // SMS — plain text, no template
      params = new URLSearchParams({ To: twilioTo, From: twilioFrom, Body: body });
    }

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
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
