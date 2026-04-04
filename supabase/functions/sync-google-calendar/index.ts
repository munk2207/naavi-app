/**
 * sync-google-calendar Edge Function
 *
 * Runs on a schedule (cron) every 6 hours.
 * Can also be triggered manually from the app on first connect.
 *
 * For every user who has a stored Google refresh token:
 * 1. Gets a fresh access token from Google
 * 2. Fetches Calendar events (past 7 days + next 30 days)
 * 3. Fetches Google Tasks (all incomplete tasks across all task lists)
 * 4. Upserts everything into the calendar_events Supabase table
 *    — events have item_type = 'event', tasks have item_type = 'task'
 *
 * After this runs, all Calendar and Task lookups query Supabase — no Google
 * API calls from the browser, no token expiry issues for Robert.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL  = 'https://oauth2.googleapis.com/token';
const CALENDAR_LIST_API = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const CALENDAR_EVENTS_API = 'https://www.googleapis.com/calendar/v3/calendars';
const TASKS_LISTS_API   = 'https://tasks.googleapis.com/tasks/v1/users/@me/lists';
const TASKS_ITEMS_API   = 'https://tasks.googleapis.com/tasks/v1/lists';

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

  const results: { user_id: string; events: number; tasks: number; error?: string }[] = [];

  for (const { user_id, refresh_token } of tokens) {
    try {
      const accessToken = await getNewAccessToken(refresh_token);

      // ── Sync window ─────────────────────────────────────────────────────────
      const timeMin = new Date();
      timeMin.setDate(timeMin.getDate() - 7);
      const timeMax = new Date();
      timeMax.setDate(timeMax.getDate() + 30);

      let eventCount = 0;
      let taskCount  = 0;
      const liveIds: string[] = [];

      // ── Calendar Events ──────────────────────────────────────────────────────
      const calListRes = await fetch(CALENDAR_LIST_API, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const calListData = await calListRes.json();
      const calendars: { id: string; summary: string }[] =
        calListData.items ?? [{ id: 'primary', summary: 'Primary' }];
      console.log(`[sync-calendar] Found ${calendars.length} calendars for user ${user_id}`);

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
          liveIds.push(event.id);
          const { error } = await adminClient
            .from('calendar_events')
            .upsert({
              user_id,
              google_event_id: event.id,
              item_type:   'event',
              title:       event.summary   ?? 'Event',
              start_time:  event.start?.dateTime ?? event.start?.date,
              end_time:    event.end?.dateTime   ?? event.end?.date,
              description: event.description ?? '',
              location:    event.location   ?? '',
              attendees:   event.attendees  ?? [],
              updated_at:  new Date().toISOString(),
            }, { onConflict: 'user_id,google_event_id' });

          if (!error) eventCount++;
        }
      }

      // ── Google Tasks ─────────────────────────────────────────────────────────
      const taskListsRes = await fetch(TASKS_LISTS_API, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (taskListsRes.ok) {
        const taskListsData = await taskListsRes.json();
        const taskLists: { id: string; title: string }[] = taskListsData.items ?? [];
        console.log(`[sync-calendar] Found ${taskLists.length} task lists for user ${user_id}`);

        for (const list of taskLists) {
          const tasksRes = await fetch(
            `${TASKS_ITEMS_API}/${encodeURIComponent(list.id)}/tasks` +
            `?showCompleted=false&maxResults=100`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );

          if (!tasksRes.ok) {
            console.warn(`[sync-calendar] Task list ${list.id} returned ${tasksRes.status} — skipping`);
            continue;
          }

          const tasksData = await tasksRes.json();
          const tasks: {
            id: string;
            title: string;
            due?: string;
            notes?: string;
            status: string;
          }[] = tasksData.items ?? [];

          for (const task of tasks) {
            if (!task.title?.trim()) continue;

            // Tasks use a due date (date only, not datetime)
            // Store as start_time = end_time = due date for consistent querying
            const dueDate = task.due ?? null;
            const taskId  = `task_${task.id}`;
            liveIds.push(taskId);

            const { error } = await adminClient
              .from('calendar_events')
              .upsert({
                user_id,
                google_event_id: taskId,
                item_type:   'task',
                title:       task.title.trim(),
                start_time:  dueDate,
                end_time:    dueDate,
                description: task.notes ?? '',
                location:    '',
                attendees:   [],
                updated_at:  new Date().toISOString(),
              }, { onConflict: 'user_id,google_event_id' });

            if (!error) taskCount++;
          }
        }
      } else {
        // Tasks scope not granted yet — skip silently
        console.log(`[sync-calendar] Tasks API returned ${taskListsRes.status} for user ${user_id} — scope may not be granted yet`);
      }

      // ── Prune deleted events and tasks within the sync window ────────────────
      if (liveIds.length > 0) {
        await adminClient
          .from('calendar_events')
          .delete()
          .eq('user_id', user_id)
          .gte('start_time', timeMin.toISOString())
          .lte('start_time', timeMax.toISOString())
          .not('google_event_id', 'in', `(${liveIds.map(id => `"${id}"`).join(',')})`);
        console.log(`[sync-calendar] Pruned deleted items for user ${user_id}`);
      }

      results.push({ user_id, events: eventCount, tasks: taskCount });
      console.log(`[sync-calendar] Synced ${eventCount} events + ${taskCount} tasks for user ${user_id}`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ user_id, events: 0, tasks: 0, error: msg });
      console.error(`[sync-calendar] Failed for user ${user_id}:`, msg);
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
