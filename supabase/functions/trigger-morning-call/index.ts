/**
 * trigger-morning-call Edge Function
 *
 * Called by pg_cron every minute. Checks if it's time for Robert's
 * morning brief call, then initiates an outbound Twilio call.
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

    // Get all users with morning call enabled
    const { data: settings, error } = await supabase
      .from('user_settings')
      .select('user_id, morning_call_time, morning_call_phone, timezone, last_morning_call_date')
      .eq('morning_call_enabled', true);

    if (error || !settings?.length) {
      console.log('[morning-call] No enabled settings found');
      return new Response(JSON.stringify({ triggered: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let triggered = 0;

    for (const s of settings) {
      // Get current time in user's timezone
      const now = new Date();
      const currentTime = now.toLocaleTimeString('en-GB', {
        timeZone: s.timezone || 'America/Toronto',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }); // returns "08:00" format

      // Get configured call time (stored as "08:00:00", trim seconds)
      const callTime = String(s.morning_call_time).substring(0, 5);

      if (currentTime !== callTime) continue;

      // Check if already called today (dedup)
      const todayStr = now.toLocaleDateString('sv-SE', {
        timeZone: s.timezone || 'America/Toronto',
      }); // returns "2026-04-15" format

      if (s.last_morning_call_date === todayStr) {
        console.log(`[morning-call] Already called today (${todayStr})`);
        continue;
      }

      // Initiate Twilio outbound call
      const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
      const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!;
      const voiceServerUrl = Deno.env.get('VOICE_SERVER_URL')!;
      const twilioNumber = '+12495235394'; // Naavi's Twilio number

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
          }),
        }
      );

      const callData = await callRes.json();

      if (!callRes.ok) {
        console.error('[morning-call] Twilio call error:', callData);
        continue;
      }

      console.log(`[morning-call] Call initiated — SID: ${callData.sid}, To: ${s.morning_call_phone}`);

      // Mark as called today
      await supabase
        .from('user_settings')
        .update({ last_morning_call_date: todayStr })
        .eq('user_id', s.user_id);

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
