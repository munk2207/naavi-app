/**
 * check-reminders Edge Function
 *
 * Runs every minute via pg_cron.
 * Finds all reminders where datetime <= now() and fired = false,
 * sends a Twilio SMS to the stored phone number, then marks as fired.
 *
 * Completely server-side — works whether or not Robert has the app open.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Reminder {
  id: string;
  user_id: string;
  title: string;
  datetime: string;
  phone_number: string;
  is_priority?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const interFnKey  = Deno.env.get('NAAVI_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;

  const now = new Date().toISOString();

  // Find all due reminders not yet fired
  const { data: reminders, error } = await adminClient
    .from('reminders')
    .select('id, user_id, title, datetime, phone_number, is_priority')
    .eq('fired', false)
    .not('phone_number', 'is', null)
    .lte('datetime', now);

  if (error) {
    console.error('[check-reminders] Query error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!reminders?.length) {
    return new Response(JSON.stringify({ message: 'No reminders due', checked_at: now }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const fired: string[] = [];
  const errors: string[] = [];

  for (const reminder of reminders as Reminder[]) {
    try {
      const alertTime = new Date().toLocaleString('en-CA', {
        timeZone: 'America/Toronto',
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
        hour12: true,
      });

      const smsBody = `🔔 Reminder: ${reminder.title}\n🕐 ${alertTime}\n— MyNaavi`;

      if (reminder.is_priority) {
        // Priority reminder — initiate a phone call instead of SMS
        const voiceServerUrl = Deno.env.get('VOICE_SERVER_URL');
        const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
        const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!;
        const twilioNumber = '+12495235394';
        const credentials = btoa(`${accountSid}:${authToken}`);

        if (voiceServerUrl) {
          const callRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
            {
              method: 'POST',
              headers: {
                Authorization: `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                To: reminder.phone_number,
                From: twilioNumber,
                Url: `${voiceServerUrl}/reminder-call?title=${encodeURIComponent(reminder.title)}`,
                Method: 'POST',
              }),
            }
          );

          if (!callRes.ok) {
            const errData = await callRes.json().catch(() => ({}));
            console.error(`[check-reminders] Priority call failed:`, errData);
            // Fall back to SMS
            await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
              body: JSON.stringify({ to: reminder.phone_number, body: smsBody }),
            });
          } else {
            console.log(`[check-reminders] Priority call initiated for "${reminder.title}"`);
          }
        }
      } else {
        // Normal reminder — fan out to SMS + WhatsApp + Email + Push (all 4).
        // Follows the ALERT FAN-OUT rule (project_naavi_alert_fanout.md).
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        // V57.12.1 Bug I — surface non-2xx responses so silent fan-out
        // failures (missing env var, expired Twilio template, etc.) show
        // up in logs instead of vanishing. .catch() only catches network
        // errors; an HTTP 502 from send-sms was being swallowed before.
        const fanFetch = async (label: string, url: string, body: any) => {
          try {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
              body: JSON.stringify(body),
            });
            if (!res.ok) {
              const errText = await res.text().catch(() => '<no body>');
              console.error(`[check-reminders] ${label} HTTP ${res.status}: ${errText.slice(0, 200)}`);
            } else {
              console.log(`[check-reminders] ${label} ok`);
            }
          } catch (err) {
            console.error(`[check-reminders] ${label} threw:`, err);
          }
        };

        // V57.12.1 — look up the user's name for WhatsApp template substitution.
        // Without recipient_name passed in, send-sms defaults to "there" which
        // can cause template rejection in some Twilio configurations.
        const { data: settings } = await adminClient
          .from('user_settings')
          .select('name')
          .eq('user_id', reminder.user_id)
          .maybeSingle();
        const recipientName = settings?.name || 'there';

        // Self-reminder: SMS + WhatsApp + Email + Push (all four channels).
        // Awaited via Promise.allSettled so failures don't cascade and we
        // still mark the reminder fired even if one channel is broken.
        await Promise.allSettled([
          fanFetch('SMS', `${supabaseUrl}/functions/v1/send-sms`, {
            to: reminder.phone_number, body: smsBody,
            user_id: reminder.user_id, source: 'reminder',
          }),
          fanFetch('WhatsApp', `${supabaseUrl}/functions/v1/send-sms`, {
            to: reminder.phone_number, body: smsBody, channel: 'whatsapp',
            recipient_name: recipientName, sender_name: 'Naavi',
            user_id: reminder.user_id, source: 'reminder',
          }),
          fanFetch('Email', `${supabaseUrl}/functions/v1/send-user-email`, {
            user_id: reminder.user_id,
            subject: `Reminder: ${reminder.title}`,
            body: smsBody,
          }),
          fanFetch('Push', `${supabaseUrl}/functions/v1/send-push-notification`, {
            user_id: reminder.user_id, title: 'Naavi Reminder', body: smsBody,
          }),
        ]);
      }

      // Mark as fired
      await adminClient
        .from('reminders')
        .update({ fired: true, fired_at: now })
        .eq('id', reminder.id);

      fired.push(reminder.id);
      console.log(`[check-reminders] Fired: "${reminder.title}" → ${reminder.phone_number}`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Reminder ${reminder.id}: ${msg}`);
      console.error(`[check-reminders] Error for reminder ${reminder.id}:`, msg);
    }
  }

  return new Response(
    JSON.stringify({ fired: fired.length, fired_ids: fired, errors }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
