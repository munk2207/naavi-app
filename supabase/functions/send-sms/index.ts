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
 *     recipient_name?: "Wael", sender_name?: "Naavi", from?: "+14313006228" }
 *
 * `from` (SMS only, optional) overrides TWILIO_FROM_NUMBER for this one
 * send. Added 2026-07-01 for demo-line reminders — see
 * docs/F2B_SCENARIO_WALKTHROUGH_PHASE5_EVIDENCE_2026-07-01.md. Every
 * existing caller omits it, so behavior is unchanged for real users.
 *
 * For WhatsApp: uses the naavi_message_from_sender template with ContentVariables.
 *   - {{1}} = recipient_name (defaults to "there")
 *   - {{2}} = sender_name (defaults to "Naavi")
 *   - {{3}} = body
 *
 * For SMS: sends body as plain text.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Resolve user_id from JWT (mobile) or body (voice / server-side).
async function resolveUserId(
  authHeader: string,
  bodyUserId: string | undefined,
): Promise<string | null> {
  if (authHeader) {
    try {
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await userClient.auth.getUser();
      if (user?.id) return user.id;
    } catch {
      /* fall through */
    }
  }
  if (bodyUserId && typeof bodyUserId === 'string' && bodyUserId.length > 0) {
    return bodyUserId;
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { to, body, channel = 'sms', recipient_name, sender_name, user_id: bodyUserId, source, from } =
      await req.json() as {
        to: string;
        body: string;
        channel?: 'sms' | 'whatsapp';
        recipient_name?: string;
        sender_name?: string;
        user_id?: string;
        source?: string;
        from?: string;
      };

    const authHeader = req.headers.get('Authorization') ?? '';
    const userId = await resolveUserId(authHeader, bodyUserId);

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
    // `from` override only ever applies to SMS (see docstring above) — the
    // WhatsApp path always uses TWILIO_WHATSAPP_FROM, untouched.
    const fromNumber = from || Deno.env.get('TWILIO_FROM_NUMBER')!;
    const twilioTo   = isWhatsApp ? `whatsapp:${to}` : to;
    const twilioFrom = isWhatsApp ? `whatsapp:${whatsAppFrom}` : fromNumber;

    const credentials = btoa(`${accountSid}:${authToken}`);

    let params: URLSearchParams;

    if (isWhatsApp) {
      // Use the pre-approved template so the message goes through outside the 24h window.
      // Template: "Hi {{1}}, {{2}} shared this message with you: {{3}} — Sent via MyNaavi."
      const templateSid = Deno.env.get('TWILIO_WHATSAPP_TEMPLATE_MESSAGE_SID');
      if (templateSid) {
        // V57.12.6 Bug I fix — Twilio rejects ContentVariables with
        // newlines, certain emojis, em-dashes, etc. (error 21656 "The
        // Content Variables parameter is invalid"). Sanitize the body
        // for the template-variable slot ONLY: collapse newlines to
        // spaces, drop characters outside Basic Multilingual Plane
        // (emoji, etc.), keep ASCII + common punctuation. The full
        // emoji-rich body still flows on SMS / email — only the
        // WhatsApp template slot needs flat ASCII.
        const sanitizedBody = body
          .replace(/\r?\n/g, ' ')
          .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}]/gu, '')
          .replace(/—/g, '-')
          .replace(/\s+/g, ' ')
          .trim();
        params = new URLSearchParams({
          To: twilioTo,
          From: twilioFrom,
          ContentSid: templateSid,
          ContentVariables: JSON.stringify({
            '1': (recipient_name || 'there').slice(0, 60),
            '2': (sender_name || 'Naavi').slice(0, 60),
            '3': sanitizedBody.slice(0, 1024),
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

    // Log to sent_messages — fire-and-forget so a log failure never blocks
    // a successful send response. Uses service role to bypass RLS when the
    // caller is the voice server / cron (no JWT).
    if (userId) {
      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      admin
        .from('sent_messages')
        .insert({
          user_id: userId,
          channel,
          to_name: recipient_name ?? null,
          to_phone: to,
          body,
          delivery_status: 'sent',
          provider_sid: data.sid ?? null,
          source: source ?? null,
        })
        .then(({ error }) => {
          if (error) console.error('[send-sms] sent_messages log failed:', error.message);
        });
    } else {
      console.warn('[send-sms] no user_id — skipping sent_messages log');
    }

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
