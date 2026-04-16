/**
 * trigger-morning-call Edge Function
 *
 * Called by pg_cron every minute. Checks if it's time for Robert's
 * daily briefing call, then initiates an outbound Twilio call.
 *
 * Retry logic:
 * - First attempt at scheduled time
 * - If missed, retries every 5 minutes up to 3 attempts
 * - After 3 failed attempts, voice server sends SMS + WhatsApp + push alert
 *
 * Required Supabase secrets:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   VOICE_SERVER_URL  (e.g. "https://naavi-voice-server-production.up.railway.app")
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: settings, error } = await supabase
      .from('user_settings')
      .select('user_id, morning_call_time, morning_call_phone, timezone, last_morning_call_date, morning_call_status, morning_call_attempts, morning_call_last_attempt')
      .eq('morning_call_enabled', true);

    if (error || !settings?.length) {
      return new Response(JSON.stringify({ triggered: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let triggered = 0;
    const now = new Date();

    for (const s of settings) {
      const tz = s.timezone || 'America/Toronto';
      const todayStr = now.toLocaleDateString('sv-SE', { timeZone: tz });
      const currentTime = now.toLocaleTimeString('en-GB', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const callTime = String(s.morning_call_time).substring(0, 5);

      // New day — reset attempts
      if (s.last_morning_call_date !== todayStr) {
        if (s.morning_call_attempts > 0 || s.morning_call_status !== 'pending') {
          await supabase.from('user_settings').update({
            morning_call_attempts: 0,
            morning_call_status: 'pending',
            morning_call_last_attempt: null,
          }).eq('user_id', s.user_id);
          s.morning_call_attempts = 0;
          s.morning_call_status = 'pending';
          s.morning_call_last_attempt = null;
        }
      }

      // Already answered today — skip
      if (s.last_morning_call_date === todayStr && s.morning_call_status === 'answered') {
        continue;
      }

      // Already exhausted retries today — skip
      if (s.last_morning_call_date === todayStr && s.morning_call_status === 'missed') {
        continue;
      }

      // Max 10 attempts — skip (voice server sends final alert at 10)
      if (s.morning_call_attempts >= 10) {
        continue;
      }

      // Check if it's time for first attempt or retry
      const attempts = s.morning_call_attempts || 0;

      if (attempts === 0) {
        // First attempt — only at scheduled time
        if (currentTime !== callTime) continue;
      } else {
        // Retry — wait 5 minutes since last attempt
        if (s.morning_call_last_attempt) {
          const lastAttempt = new Date(s.morning_call_last_attempt);
          const minutesSince = (now.getTime() - lastAttempt.getTime()) / 60000;
          if (minutesSince < 5) continue;
        }
      }

      // Initiate Twilio outbound call
      const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
      const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!;
      const voiceServerUrl = Deno.env.get('VOICE_SERVER_URL')!;
      const twilioNumber = '+12495235394';
      const credentials = btoa(`${accountSid}:${authToken}`);

      const callRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: s.morning_call_phone,
            From: twilioNumber,
            Url: `${voiceServerUrl}/outbound-voice`,
            Method: 'POST',
            StatusCallback: `${voiceServerUrl}/call-status`,
            StatusCallbackMethod: 'POST',
            // 'answered' fires the moment the user picks up (CallStatus=in-progress).
            // 'completed' fires on terminal states (completed/busy/no-answer/failed/canceled).
            // Both are needed so retries stop at pickup, not when the call ends.
            StatusCallbackEvent: 'answered completed',
          }),
        }
      );

      const callData = await callRes.json();

      if (!callRes.ok) {
        console.error('[morning-call] Twilio error:', callData);
        continue;
      }

      console.log(`[morning-call] Call initiated — SID: ${callData.sid}, attempt ${attempts + 1}`);

      // Update attempts
      await supabase.from('user_settings').update({
        morning_call_attempts: attempts + 1,
        morning_call_last_attempt: now.toISOString(),
        last_morning_call_date: todayStr,
      }).eq('user_id', s.user_id);

      triggered++;
    }

    return new Response(JSON.stringify({ triggered }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[morning-call] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
