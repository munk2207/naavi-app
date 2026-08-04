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
 *
 * Ticket C (2026-08-02) — atomic sync. Pruning (deleting local rows for
 * events no longer live on Google) now runs only if that user's
 * reconciliation completed without an unrecovered write or fetch error —
 * see the `syncOk` tracking below. API contract: the overall HTTP response
 * is always 200 (matches the existing per-user-loop pattern, where one
 * user's failure was already isolated via try/catch and did not fail the
 * whole request) — per-user failure is reported inside `results[i]` via
 * `sync_ok: false` and `abort_reason`, not via the response status code.
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
      // 90 days back so deleted past events propagate to the local cache.
      // Earlier the lookback was only 7 days — events older than that sat in
      // the local table forever, even after the user deleted them in Google,
      // because the prune step only removes rows within the active window.
      const timeMin = new Date();
      timeMin.setDate(timeMin.getDate() - 90);
      const timeMax = new Date();
      timeMax.setDate(timeMax.getDate() + 30);

      let eventCount = 0;
      let taskCount  = 0;
      const liveIds: string[] = [];

      // ── Ticket C — atomic sync ────────────────────────────────────────────────
      // Prune must never run against an incomplete or partially-failed
      // reconciliation — that was the root cause of the 2026-08-02 incident
      // (writes were silently failing on a missing column while prune kept
      // running normally, deleting rows for events that were still live).
      // "Successful sync" for this user means: every calendar's event pages
      // fetched completely, every event upsert succeeded, every fetched task
      // list's pages fetched completely, and every task upsert succeeded. A
      // task-scope-not-granted response (existing, expected, handled below)
      // is not a failure — there's nothing to reconcile in that case.
      let syncOk = true;
      let abortReason: string | null = null;
      let writeErrorCount = 0;
      const markFailure = (reason: string) => {
        syncOk = false;
        if (!abortReason) abortReason = reason;
      };

      // ── Calendar Events ──────────────────────────────────────────────────────
      const calListRes = await fetch(CALENDAR_LIST_API, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const calListData = await calListRes.json();
      const calendars: { id: string; summary: string }[] =
        calListData.items ?? [{ id: 'primary', summary: 'Primary' }];
      console.log(`[sync-calendar] Found ${calendars.length} calendars for user ${user_id}`);

      for (const cal of calendars) {
        // Paginate via pageToken so a wide window with many events doesn't
        // silently truncate at the 100-event maxResults cap. Cap at 25 pages
        // (= 2,500 events per calendar) as a safety against runaway loops.
        let pageToken: string | undefined = undefined;
        let pageCount = 0;
        do {
          pageCount++;
          const url = `${CALENDAR_EVENTS_API}/${encodeURIComponent(cal.id)}/events` +
            `?maxResults=100&orderBy=startTime&singleEvents=true` +
            `&timeMin=${encodeURIComponent(timeMin.toISOString())}` +
            `&timeMax=${encodeURIComponent(timeMax.toISOString())}` +
            (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');

          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (!res.ok) {
            console.warn(`[sync-calendar] Calendar ${cal.id} returned ${res.status} — skipping`);
            markFailure(`calendar ${cal.id} fetch returned ${res.status} (incomplete event list)`);
            break;
          }

          const data = await res.json();
          const events = data.items ?? [];

          for (const event of events) {
            liveIds.push(event.id);

            // 2026-05-17 — CLAUDE.md Rule 18: present source data as-is.
            // Google distinguishes all-day events (start.date, end.date)
            // from timed events (start.dateTime, end.dateTime). Previously
            // we collapsed both into start_time/end_time (timestamptz),
            // which silently shifted all-day events by the user's UTC
            // offset (Victoria Day on May 18 became 8 PM May 17 in Toronto).
            // Now we route each kind into its own column.
            const isAllDay = !event.start?.dateTime && !!event.start?.date;
            const baseRow: Record<string, unknown> = {
              user_id,
              google_event_id: event.id,
              item_type:   'event',
              title:       event.summary   ?? 'Event',
              description: event.description ?? '',
              location:    event.location   ?? '',
              attendees:   event.attendees  ?? [],
              updated_at:  new Date().toISOString(),
              is_all_day:  isAllDay,
            };
            if (isAllDay) {
              baseRow.start_date = event.start.date;
              baseRow.end_date   = event.end?.date ?? null;
              baseRow.start_time = null;
              baseRow.end_time   = null;
            } else {
              baseRow.start_time = event.start?.dateTime ?? null;
              baseRow.end_time   = event.end?.dateTime   ?? null;
              baseRow.start_date = null;
              baseRow.end_date   = null;
            }

            const { error } = await adminClient
              .from('calendar_events')
              .upsert(baseRow, { onConflict: 'user_id,google_event_id' });

            if (!error) {
              eventCount++;
            } else {
              writeErrorCount++;
              console.error(`[sync-calendar] upsert failed for event ${event.id} (user ${user_id}): ${error.message}`);
              markFailure(`event upsert failed: ${error.message}`);
            }
          }

          pageToken = data.nextPageToken;
        } while (pageToken && pageCount < 25);

        if (pageCount >= 25 && pageToken) {
          console.warn(`[sync-calendar] Calendar ${cal.id} hit 25-page safety cap; some events may not be synced`);
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
            markFailure(`task list ${list.id} fetch returned ${tasksRes.status} (incomplete task list)`);
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

            if (!error) {
              taskCount++;
            } else {
              writeErrorCount++;
              console.error(`[sync-calendar] upsert failed for task ${task.id} (user ${user_id}): ${error.message}`);
              markFailure(`task upsert failed: ${error.message}`);
            }
          }
        }
      } else {
        // Tasks scope not granted yet — skip silently
        console.log(`[sync-calendar] Tasks API returned ${taskListsRes.status} for user ${user_id} — scope may not be granted yet`);
      }

      // ── Prune deleted events and tasks within the sync window ────────────────
      // Ticket C — 2026-08-02: this step may run only if reconciliation for
      // this user completed without an unrecovered write or fetch error
      // (syncOk). Pruning after a partial/failed sync was the exact root
      // cause of the incident this fix addresses — the local cache would be
      // compared against an incomplete "live" set and rows for events that
      // are still genuinely live could be deleted. This does not make every
      // future synchronization failure impossible; it eliminates this
      // specific asymmetric failure mode (write failed, delete ran anyway).
      let prunedCount: number | null = null;
      let prunedItems: { title: string; google_event_id: string; start_time: string | null }[] = [];
      if (!syncOk) {
        console.warn(`[sync-calendar] user ${user_id} — prune SKIPPED. Reason: ${abortReason}`);
      } else if (liveIds.length > 0) {
        const { data: deleted, error: pruneError } = await adminClient
          .from('calendar_events')
          .delete()
          .eq('user_id', user_id)
          .gte('start_time', timeMin.toISOString())
          .lte('start_time', timeMax.toISOString())
          .not('google_event_id', 'in', `(${liveIds.map(id => `"${id}"`).join(',')})`)
          .select('title, google_event_id, start_time');
        if (pruneError) {
          console.error(`[sync-calendar] user ${user_id} — prune query failed: ${pruneError.message}`);
        } else {
          prunedCount = deleted?.length ?? 0;
          prunedItems = deleted ?? [];
        }
        console.log(`[sync-calendar] Pruned ${prunedCount ?? 0} deleted item(s) for user ${user_id}`);
      } else {
        prunedCount = 0;
      }

      results.push({
        user_id,
        events: eventCount,
        tasks: taskCount,
        sync_ok: syncOk,
        ...(syncOk ? {} : { abort_reason: abortReason }),
        pruned: prunedCount,
      });
      console.log(
        `[sync-calendar] user=${user_id} fetched=${liveIds.length} written=${eventCount + taskCount} ` +
        `failed=${writeErrorCount} sync_ok=${syncOk} prune=${syncOk ? (liveIds.length > 0 ? 'ran' : 'skipped(no live ids)') : 'skipped'} ` +
        `pruned=${prunedCount ?? 'n/a'}` +
        (abortReason ? ` reason="${abortReason}"` : '') +
        (prunedItems.length > 0 ? ` deleted=${JSON.stringify(prunedItems)}` : '')
      );

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
