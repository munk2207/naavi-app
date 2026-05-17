/**
 * create-calendar-event Edge Function
 *
 * Creates an event in Robert's primary Google Calendar.
 * Called when Claude detects a scheduling intent and returns a CREATE_EVENT action.
 *
 * Auth: RLS-based (same pattern as send-email / send-drive-file).
 * verify_jwt = false in config.toml.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const CALENDAR_API      = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getNewAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders,
    });
  }

  const body = await req.json();
  const { summary, description, start, end, attendees, recurrence, is_priority, user_id: bodyUserId } = body;

  if (!summary || !start || !end) {
    return new Response(JSON.stringify({ error: 'Missing summary, start, or end' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // User resolution per CLAUDE.md Rule 4:
  //   (a) JWT auth — mobile app path
  //   (b) Explicit user_id in request body — voice server / server-side path
  //   (c) Fail loudly — NEVER use `.limit(1)` on user_tokens (multi-user unsafe)
  let userId: string | null = null;

  // (a) JWT auth
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  try {
    const { data: { user } } = await userClient.auth.getUser();
    if (user) userId = user.id;
  } catch (_) { /* ignore */ }

  // (b) Explicit user_id in body (voice server passes service role key + user_id)
  if (!userId && typeof bodyUserId === 'string' && bodyUserId.length > 0) {
    userId = bodyUserId;
    console.log(`[create-calendar-event] Resolved user from request body: ${userId}`);
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  if (!userId) {
    console.error('[create-calendar-event] No user_id — JWT missing and body.user_id absent');
    return new Response(JSON.stringify({ error: 'No user found — provide JWT or user_id in body' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const user = { id: userId };

  const { data: tokenRow, error: tokenError } = await adminClient
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .single();

  if (tokenError || !tokenRow?.refresh_token) {
    console.error('[create-calendar-event] Token lookup failed for user:', user.id, tokenError?.message);
    return new Response(JSON.stringify({ error: 'No Google token found' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Idempotency — if an event with the same title + start_time already
    // exists for this user, return it instead of creating another. Covers
    // the retry / double-fire class of bug where Claude emits CREATE_EVENT
    // twice for the same scheduling intent, which would otherwise clutter
    // the user's calendar with identical rows.
    const { data: existingEvent } = await adminClient
      .from('calendar_events')
      .select('google_event_id')
      .eq('user_id', user.id)
      .eq('title', summary)
      .eq('start_time', start)
      .maybeSingle();

    if (existingEvent?.google_event_id) {
      console.log(`[create-calendar-event] Duplicate suppressed: "${summary}" at ${start} → ${existingEvent.google_event_id}`);
      return new Response(JSON.stringify({
        success: true,
        eventId: existingEvent.google_event_id,
        deduped: true,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // TEMP DIAGNOSTIC — Session 24, prescription cross-account bug.
    console.log('[create-calendar-event][DIAG] resolved user_id:', user.id, 'refresh_token prefix:', tokenRow.refresh_token.slice(0, 25), 'event_title:', summary);
    const accessToken = await getNewAccessToken(tokenRow.refresh_token);
    // Verify which Google account the access token actually belongs to.
    try {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userInfoRes.ok) {
        const userInfo = await userInfoRes.json();
        console.log('[create-calendar-event][DIAG] google_account_email:', userInfo.email, 'for user_id:', user.id);
      }
    } catch (_) { /* diagnostic only */ }

    // All-day events use { date: "YYYY-MM-DD" }; timed events use
    // { dateTime, timeZone }. Detect format from input shape.
    const isDateOnly = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

    // 2026-05-17 — defensive all-day coercion. If Claude emits an all-day
    // event as midnight UTC ("YYYY-MM-DDT00:00:00" or "YYYY-MM-DDT00:00:00Z")
    // and the duration is exactly 24h, Google would render it as 8 PM EDT
    // the PREVIOUS day (UTC midnight → -4 hours in Toronto TZ). Real bug —
    // Huss saw "Today — Victoria Day at 8:00 p.m." on 2026-05-17 for a
    // May 18 holiday. Coerce these to proper { date: "YYYY-MM-DD" } all-day
    // events here even if Claude's prompt update slipped. Catches the
    // failure at the API boundary.
    const allDayMidnightRe = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?(?:Z|\+00:00)?$/;
    const startMidnight = typeof start === 'string' ? allDayMidnightRe.exec(start) : null;
    const endMidnight   = typeof end   === 'string' ? allDayMidnightRe.exec(end)   : null;
    let normalisedStart = start;
    let normalisedEnd   = end;
    if (startMidnight && endMidnight) {
      const startDate = new Date(`${startMidnight[1]}T00:00:00Z`);
      const endDate   = new Date(`${endMidnight[1]}T00:00:00Z`);
      const diffDays  = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays >= 0.99 && diffDays <= 1.01) {
        normalisedStart = startMidnight[1];
        normalisedEnd   = endMidnight[1];
        console.log(
          `[create-calendar-event] all-day coercion: ` +
          `${start} / ${end} → ${normalisedStart} / ${normalisedEnd}`
        );
      }
    }

    const event: Record<string, unknown> = {
      summary,
      description: description ?? '',
      start: isDateOnly(normalisedStart) ? { date: normalisedStart } : { dateTime: normalisedStart, timeZone: 'America/Toronto' },
      end:   isDateOnly(normalisedEnd)   ? { date: normalisedEnd }   : { dateTime: normalisedEnd,   timeZone: 'America/Toronto' },
    };

    // Only include attendees that look like email addresses
    const validAttendees = (Array.isArray(attendees) ? attendees : [])
      .filter((a: string) => typeof a === 'string' && a.includes('@'));
    if (validAttendees.length > 0) {
      event.attendees = validAttendees.map((email: string) => ({ email }));
    }

    // Recurring event support (e.g. ["RRULE:FREQ=WEEKLY;BYDAY=SA"])
    if (Array.isArray(recurrence) && recurrence.length > 0) {
      event.recurrence = recurrence;
    }

    const createRes = await fetch(CALENDAR_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      return new Response(JSON.stringify({ error: `Calendar API failed: ${err}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const created = await createRes.json();
    console.log(`[create-calendar-event] Created "${summary}" — ${created.id}`);
    // TEMP DIAGNOSTIC — capture the htmlLink Google returns so we can
    // diagnose why Linking.openURL is failing to open it on the phone.
    console.log(`[create-calendar-event][DIAG] htmlLink: ${created.htmlLink}`);

    // Save to Supabase calendar_events table with priority flag.
    // Store the coerced (date-only) form when applicable so the home brief
    // and any other reader of calendar_events sees the same all-day shape
    // we sent to Google.
    await adminClient.from('calendar_events').upsert({
      user_id: user.id,
      google_event_id: created.id,
      title: summary,
      description: description ?? '',
      start_time: normalisedStart,
      end_time:   normalisedEnd,
      is_priority: is_priority || false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'google_event_id' });

    return new Response(JSON.stringify({ success: true, eventId: created.id, htmlLink: created.htmlLink }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[create-calendar-event] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
