/**
 * check-reminders Edge Function
 *
 * Runs every minute via pg_cron.
 * Finds all reminders where datetime <= now() and fired = false,
 * then fans out to SMS + WhatsApp + Email + Push + Voice Call — each
 * gated by the user's alert_channels_enabled preference in user_settings.
 * Default (no preference set) = all 5 channels on.
 *
 * Mirrors the fan-out pattern in evaluate-rules::fireAction().
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
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const now = new Date().toISOString();

  const { data: reminders, error } = await adminClient
    .from('reminders')
    .select('id, user_id, title, datetime, phone_number')
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

  const ALL_CHANNELS = ['sms', 'whatsapp', 'email', 'push', 'voice_call'] as const;

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

      const body = `🔔 Reminder: ${reminder.title}\n🕐 ${alertTime}\n— MyNaavi`;

      // Read user preferences: phone, name, alert_channels_enabled
      const { data: settings } = await adminClient
        .from('user_settings')
        .select('phone, name, alert_channels_enabled')
        .eq('user_id', reminder.user_id)
        .maybeSingle();

      const userPhone   = settings?.phone ?? reminder.phone_number;
      const userName    = settings?.name  ?? 'there';

      // Resolve auth email
      const { data: authData } = await adminClient.auth.admin.getUserById(reminder.user_id);
      const userEmail = authData?.user?.email ?? null;

      // Channel preference — default all 5 on if not set
      const enabledChannels = new Set<string>(
        Array.isArray(settings?.alert_channels_enabled) && settings.alert_channels_enabled.length > 0
          ? settings.alert_channels_enabled
          : ALL_CHANNELS,
      );
      const channelEnabled = (c: string): boolean => enabledChannels.has(c);

      const fanFetch = async (label: string, url: string, payload: unknown): Promise<{ channel: string; ok: boolean }> => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => '<no body>');
            console.error(`[check-reminders] ${label} HTTP ${res.status}: ${errText.slice(0, 200)}`);
          } else {
            console.log(`[check-reminders] ${label} ok`);
          }
          return { channel: label, ok: res.ok };
        } catch (err) {
          console.error(`[check-reminders] ${label} threw:`, err);
          return { channel: label, ok: false };
        }
      };

      // Voice call — pre-generate TTS then dial Twilio (mirrors evaluate-rules)
      const callVoice = async (): Promise<{ channel: string; ok: boolean }> => {
        const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
        const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')  ?? '';
        const voiceBase  = Deno.env.get('VOICE_SERVER_URL')   ?? '';
        const twilioFrom = '+12495235394';
        if (!accountSid || !authToken || !voiceBase) {
          console.error('[check-reminders] callVoice: missing Twilio/voice-server secrets');
          return { channel: 'voice_call', ok: false };
        }
        try {
          let preToken: string | null = null;
          try {
            const prepRes = await fetch(`${voiceBase}/prepare-alert`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
              body: JSON.stringify({ body, user_id: reminder.user_id, voice: 'aura-hera-en' }),
            });
            if (prepRes.ok) {
              const prepData = await prepRes.json();
              if (typeof prepData?.token === 'string' && prepData.token.length > 0) {
                preToken = prepData.token;
              }
            }
          } catch (_) { /* fall through to legacy path */ }

          const twiUrl = preToken
            ? `${voiceBase}/speak-alert?token=${encodeURIComponent(preToken)}&user_id=${encodeURIComponent(reminder.user_id)}`
            : `${voiceBase}/speak-alert?body=${encodeURIComponent(body)}&user_id=${encodeURIComponent(reminder.user_id)}`;

          const form = new URLSearchParams();
          form.append('To',    userPhone);
          form.append('From',  twilioFrom);
          form.append('Url',   twiUrl);
          form.append('Method','POST');

          const creds = btoa(`${accountSid}:${authToken}`);
          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
            {
              method: 'POST',
              headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: form,
            }
          );
          console.log(`[check-reminders] Voice call ${res.ok ? 'initiated' : 'failed'} for "${reminder.title}"`);
          return { channel: 'voice_call', ok: res.ok };
        } catch (err) {
          console.error('[check-reminders] callVoice error:', err);
          return { channel: 'voice_call', ok: false };
        }
      };

      // Fan out to all enabled channels
      const sends: Promise<{ channel: string; ok: boolean }>[] = [];

      if (userPhone) {
        if (channelEnabled('sms')) {
          sends.push(fanFetch('SMS', `${supabaseUrl}/functions/v1/send-sms`, {
            to: userPhone, body,
            user_id: reminder.user_id, source: 'reminder',
          }));
        }
        if (channelEnabled('whatsapp')) {
          sends.push(fanFetch('WhatsApp', `${supabaseUrl}/functions/v1/send-sms`, {
            to: userPhone, body, channel: 'whatsapp',
            recipient_name: userName, sender_name: 'Naavi',
            user_id: reminder.user_id, source: 'reminder',
          }));
        }
        if (channelEnabled('voice_call')) {
          sends.push(callVoice());
        }
      }
      if (userEmail && channelEnabled('email')) {
        sends.push(fanFetch('Email', `${supabaseUrl}/functions/v1/send-user-email`, {
          user_id: reminder.user_id,
          subject: `Reminder: ${reminder.title}`,
          body,
        }));
      }
      if (channelEnabled('push')) {
        sends.push(fanFetch('Push', `${supabaseUrl}/functions/v1/send-push-notification`, {
          user_id: reminder.user_id, title: 'Naavi Reminder', body,
        }));
      }

      await Promise.allSettled(sends);

      // Mark as fired
      await adminClient
        .from('reminders')
        .update({ fired: true, fired_at: now })
        .eq('id', reminder.id);

      fired.push(reminder.id);
      console.log(`[check-reminders] Fired: "${reminder.title}" → channels=[${[...enabledChannels].join(',')}]`);

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
