/**
 * trigger-morning-call Edge Function
 *
 * Called by pg_cron every minute. Checks all four brief windows
 * (morning, midday, evening, night) and fires any that are due.
 *
 * Window settings are read from user_settings.brief_windows (JSONB).
 * Falls back to the legacy morning_call_enabled + morning_call_time
 * columns for users who have never opened the Briefings settings page.
 *
 * Retry logic (per window per day):
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
    // Optional debug body. Cron passes `{}`; manual calls can pass:
    //   { force: true }                    — bypass time + same-day-status checks
    //   { force: true, user_id: '<uuid>' } — restrict to a single user
    // The `force` path lets us fire a brief on demand for debugging without
    // waiting for the scheduled minute window.
    let force = false;
    let forceUserId: string | null = null;
    try {
      if (req.method === 'POST') {
        const body = await req.clone().json().catch(() => ({}));
        force = body?.force === true;
        forceUserId = typeof body?.user_id === 'string' ? body.user_id : null;
      }
    } catch { /* ignore — cron sends empty body */ }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fetch all users who have morning_call_enabled OR have any brief_window enabled.
    // brief_windows users are identified by the column being non-null; the loop
    // below checks each window individually. Legacy users (brief_windows IS NULL)
    // are filtered by morning_call_enabled as before.
    let query = supabase
      .from('user_settings')
      .select('user_id, morning_call_time, morning_call_phone, timezone, last_morning_call_date, morning_call_status, morning_call_attempts, morning_call_last_attempt, brief_windows, phone')
      .or('morning_call_enabled.eq.true,brief_windows.not.is.null');
    if (forceUserId) query = query.eq('user_id', forceUserId);
    const { data: settings, error } = await query;

    const WINDOWS = ['morning', 'midday', 'evening', 'night'] as const;
    type BriefWindow = typeof WINDOWS[number];

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

      // Determine which windows to check for this user.
      // If brief_windows is set, use it for all 4 windows.
      // Otherwise fall back to legacy morning_call_enabled + morning_call_time.
      const windowsToCheck: Array<{ window: BriefWindow; time: string; channels: string[] }> = [];
      if (s.brief_windows) {
        for (const w of WINDOWS) {
          const cfg = s.brief_windows[w];
          if (cfg?.enabled && cfg?.time) {
            windowsToCheck.push({ window: w, time: String(cfg.time).substring(0, 5), channels: cfg.channels ?? [] });
          }
        }
      } else {
        // Legacy: morning only
        windowsToCheck.push({ window: 'morning', time: String(s.morning_call_time).substring(0, 5), channels: ['voice'] });
      }

      for (const wCfg of windowsToCheck) {
        const callTime = wCfg.time;
        const windowKey = `${wCfg.window}_call`; // e.g. morning_call, midday_call
        // Per-window daily state stored in brief_windows_state JSONB (best-effort).
        // For now we reuse the legacy morning_call_* columns for the morning window
        // and skip retry tracking for other windows (Phase 1 simplification).
        const isMorningWindow = wCfg.window === 'morning';

        // New day — reset morning attempts (legacy columns, morning window only)
        if (isMorningWindow && s.last_morning_call_date !== todayStr) {
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

        const attempts = isMorningWindow ? (s.morning_call_attempts || 0) : 0;
        if (!force) {
          if (isMorningWindow) {
            // Legacy retry logic — morning window only
            if (s.last_morning_call_date === todayStr && s.morning_call_status === 'answered') continue;
            if (s.last_morning_call_date === todayStr && s.morning_call_status === 'missed') continue;
            if (s.morning_call_attempts >= 3) continue;
            if (attempts === 0) {
              if (currentTime !== callTime) continue;
            } else {
              if (s.morning_call_last_attempt) {
                const lastAttempt = new Date(s.morning_call_last_attempt);
                const minutesSince = (now.getTime() - lastAttempt.getTime()) / 60000;
                if (minutesSince < 5) continue;
              }
            }
          } else {
            // Non-morning windows — fire once at the scheduled time, no retry tracking (Phase 1)
            if (currentTime !== callTime) continue;
          }
        } else {
          console.log(`[trigger-morning-call] FORCE mode for user ${s.user_id} window ${wCfg.window} — bypassing time + status gates`);
        }

        // Resolve phone — use morning_call_phone or fall back to user phone
        const callPhone = s.morning_call_phone || s.phone || null;
        if (!callPhone) {
          console.warn(`[trigger-morning-call] Skip user ${s.user_id} window ${wCfg.window} — no phone`);
          continue;
        }

        // For non-voice channels, skip Twilio and fire via evaluate-rules pattern (Phase 1: voice only)
        if (wCfg.channels.length > 0 && !wCfg.channels.includes('voice')) {
          console.log(`[trigger-morning-call] user ${s.user_id} window ${wCfg.window} — non-voice channels not yet wired (Phase 1)`);
          // TODO Phase 2: fire push/SMS/email briefing via send-sms / push-notification
          continue;
        }

        // Initiate Twilio outbound call
        const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
        const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!;
        const voiceServerUrl = Deno.env.get('VOICE_SERVER_URL')!;
        const twilioNumber = '+12495235394';
        const credentials = btoa(`${accountSid}:${authToken}`);

        const body = new URLSearchParams();
        body.append('To', callPhone);
        body.append('From', twilioNumber);
        body.append('Url', `${voiceServerUrl}/outbound-voice?user_id=${encodeURIComponent(s.user_id)}&phone=${encodeURIComponent(callPhone)}&window=${encodeURIComponent(wCfg.window)}`);
        body.append('Method', 'POST');
        body.append('StatusCallback', `${voiceServerUrl}/call-status`);
        body.append('StatusCallbackMethod', 'POST');
        body.append('StatusCallbackEvent', 'answered');
        body.append('StatusCallbackEvent', 'completed');
        // MachineDetection removed 2026-05-10 — see git history.
        // Wael 2026-05-10: removed MachineDetection entirely. Even in async
        // mode, DetectMessageEnd added 5-7 seconds of perceived pickup-to-
        // first-audio delay (Twilio holds analysis before letting TwiML
        // play). The voice server's spoken-"hello" gate inside the media
        // stream is already the human-vs-machine gatekeeper, so AMD was
        // double-duty. If voicemail picks up, the gate prompt plays, no
        // reply within 6s, voice server hangs up — same outcome as before
      // without the 5-7s of dead air.

        const callRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${credentials}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
          }
        );

        const callData = await callRes.json();

        if (!callRes.ok) {
          console.error(`[morning-call] Twilio error (${wCfg.window}):`, callData);
          continue;
        }

        console.log(`[morning-call] Call initiated — window: ${wCfg.window}, SID: ${callData.sid}, attempt ${attempts + 1}`);

        // Update attempt tracking (morning window uses legacy columns)
        if (isMorningWindow) {
          await supabase.from('user_settings').update({
            morning_call_attempts: attempts + 1,
            morning_call_last_attempt: now.toISOString(),
            last_morning_call_date: todayStr,
          }).eq('user_id', s.user_id);
        }

        triggered++;
      } // end window loop
    } // end user loop

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
