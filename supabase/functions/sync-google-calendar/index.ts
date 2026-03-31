/**
 * sync-google-calendar Edge Function
 *
 * Runs on a schedule (cron) every 6 hours.
 * Can also be triggered manually from the app on first connect.
 *
 * For every user who has a stored Google refresh token:
 * 1. Gets a fresh access token from Google
 * 2. Fetches Calendar events (past 7 days + next 30 days)
 * 3. Upserts them into the calendar_events Supabase table
 *
 * After this runs, all Calendar lookups query Supabase — no Google
 * API calls from the browser, no token expiry issues for Robert.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_LIST_API = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const CALENDAR_EVENTS_API = 'https://www.googleapis.com/calendar/v3/calendars';

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
  if (!data.access_token) {
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Get all users with stored Google refresh tokens
  const { data: tokens, error: tokenError } = await adminClient
    .from('user_tokens')
    .select('user_id, refresh_token')
    .eq('provider', 'google');

  if (tokenError) {
    return new Response(JSON.stringify({ error: tokenError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!tokens || tokens.length === 0) {
    return new Response(JSON.stringify({ message: 'No Google tokens found' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const results: { user_id: string; events: number; error?: string }[] = [];

  for (const { user_id, refresh_token } of tokens) {
    try {
      const accessToken = await getNewAccessToken(refresh_token);

      // Get all calendars (includes primary, birthdays, holidays, etc.)
      const calListRes = await fetch(CALENDAR_LIST_API, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const calListData = await calListRes.json();
      const calendars: { id: string; summary: string }[] = calListData.items ?? [{ id: 'primary', summary: 'Primary' }];
      console.log(`[sync-calendar] Found ${calendars.length} calendars for user ${user_id}`);

      // Sync window: past 7 days + next 30 days
      const timeMin = new Date();
      timeMin.setDate(timeMin.getDate() - 7);
      const timeMax = new Date();
      timeMax.setDate(timeMax.getDate() + 30);

      let count = 0;
      for (const cal of calendars) {
        const res = await fetch(
          `${CALENDAR_EVENTS_API}/${encodeURIComponent(cal.id)}/events` +
          `?maxResults=100&orderBy=startTime&singleEvents=true` +
          `&timeMin=${encodeURIComponent(timeMin.toISOString())}` +
          `&timeMax=${encodeURIComponent(timeMax.toISOString())}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!res.ok) {
          console.warn(`[sync-calendar] Calendar ${cal.id} returned ${res.status} — skipping`);
          continue;
        }

        const data = await res.json();
        const events = data.items ?? [];

        for (const event of events) {
          const { error } = await adminClient
            .from('calendar_events')
            .upsert({
              user_id,
              google_event_id: event.id,
              title:       event.summary   ?? 'Event',
              start_time:  event.start?.dateTime ?? event.start?.date,
              end_time:    event.end?.dateTime   ?? event.end?.date,
              description: event.description ?? '',
              location:    event.location   ?? '',
              attendees:   event.attendees  ?? [],
              updated_at:  new Date().toISOString(),
            }, { onConflict: 'user_id,google_event_id' });

          if (!error) count++;
        }
      }

      results.push({ user_id, events: count });
      console.log(`[sync-calendar] Synced ${count} events across all calendars for user ${user_id}`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ user_id, events: 0, error: msg });
      console.error(`[sync-calendar] Failed for user ${user_id}:`, msg);
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
