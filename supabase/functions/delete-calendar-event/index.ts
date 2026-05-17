/**
 * delete-calendar-event Edge Function
 *
 * Searches Google Calendar for events matching a query string and deletes them.
 * For recurring events, deletes all future instances (thisAndFollowingEvents).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_BASE    = 'https://www.googleapis.com/calendar/v3/calendars/primary';

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
  const { query, user_id: bodyUserId, diag } = body;

  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing query' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // V57.16 — dual auth path. Mirrors the multi-user pattern in
  // create-calendar-event. If body.user_id is provided, treat the request
  // as a service-role admin call (used by the test runner's teardown for
  // automated calendar cleanup). Otherwise use the caller's JWT to look
  // up THEIR tokens via RLS (production path — mobile app, Naavi voice).
  let refreshToken: string | undefined;
  if (bodyUserId) {
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: tokenRow } = await adminClient
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', bodyUserId)
      .eq('provider', 'google')
      .single();
    refreshToken = tokenRow?.refresh_token;
  } else {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: tokenRow } = await userClient
      .from('user_tokens')
      .select('refresh_token')
      .eq('provider', 'google')
      .single();
    refreshToken = tokenRow?.refresh_token;
  }

  if (!refreshToken) {
    return new Response(JSON.stringify({ error: 'No Google token found' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const accessToken = await getNewAccessToken(refreshToken);

    // 2026-05-17 — Diagnostic mode (read-only). When body.diag === true, list
    // EVERY calendar the user has access to and scan each one for events
    // matching `query`. Returns the full picture without deleting anything,
    // so we can diagnose why teardown's primary-calendar search misses real
    // events. Keep this branch — it doubles as an admin diagnostic for
    // future calendar-cleanup investigations.
    if (diag === true) {
      const calListRes = await fetch(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!calListRes.ok) {
        return new Response(JSON.stringify({ error: `calendarList failed: ${await calListRes.text()}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const calData = await calListRes.json();
      const cals = calData.items ?? [];
      const now = new Date();
      const timeMinDiag = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const timeMaxDiag = new Date(now.getTime() + 36500 * 24 * 60 * 60 * 1000).toISOString();
      const needle = String(query).toLowerCase();
      const perCalendar: Array<{
        id: string;
        summary: string;
        primary?: boolean;
        accessRole: string;
        total_events: number;
        matching: Array<{ id: string; summary: string; start: string }>;
      }> = [];
      for (const c of cals) {
        const calId = encodeURIComponent(c.id);
        const evRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?` +
          `timeMin=${encodeURIComponent(timeMinDiag)}&timeMax=${encodeURIComponent(timeMaxDiag)}` +
          `&singleEvents=false&maxResults=250`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!evRes.ok) {
          perCalendar.push({
            id: c.id, summary: c.summary, primary: c.primary,
            accessRole: c.accessRole, total_events: -1,
            matching: [],
          });
          continue;
        }
        const evData = await evRes.json();
        const items = evData.items ?? [];
        const matching = items
          .filter((e: any) => (e.summary ?? '').toLowerCase().includes(needle))
          .map((e: any) => ({
            id: e.id, summary: e.summary,
            start: e.start?.dateTime ?? e.start?.date ?? '',
          }));
        perCalendar.push({
          id: c.id, summary: c.summary, primary: c.primary,
          accessRole: c.accessRole, total_events: items.length,
          matching,
        });
      }
      return new Response(JSON.stringify({
        success: true,
        diag: true,
        query,
        user_id: bodyUserId,
        calendars: perCalendar,
      }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Search window for matching events.
    // User path: -1 day to +1 year (typical usage on mobile, uses q= filter).
    // Admin path (body.user_id present, server-side teardown/cleanup):
    // -1 year to +100 years AND lists without q= filter so just-created
    // events not yet in Google's freetext index can be deleted. Client-side
    // summary substring filter replaces the q= server filter.
    const now = new Date();
    const isAdmin = !!bodyUserId;
    const lookBackDays   = isAdmin ? 365   : 1;
    const lookForwardDays = isAdmin ? 36500 : 365;
    const timeMin = new Date(now.getTime() - lookBackDays * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + lookForwardDays * 24 * 60 * 60 * 1000).toISOString();

    // Admin: no q= (indexing lag misses fresh events). User: q= for speed.
    const searchUrl = isAdmin
      ? `${CALENDAR_BASE}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=false&maxResults=250`
      : `${CALENDAR_BASE}/events?q=${encodeURIComponent(query)}&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=false&maxResults=25`;

    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!searchRes.ok) {
      const err = await searchRes.text();
      return new Response(JSON.stringify({ error: `Calendar search failed: ${err}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const searchData = await searchRes.json();
    let events = searchData.items ?? [];

    if (isAdmin) {
      // Admin path: client-side filter by summary substring (case-insensitive).
      const needle = query.toLowerCase();
      events = events.filter((e: any) => (e.summary ?? '').toLowerCase().includes(needle));
    }

    if (events.length === 0) {
      return new Response(JSON.stringify({ success: true, deleted: 0, message: 'No matching events found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let deleted = 0;
    const titles: string[] = [];

    for (const event of events) {
      const deleteUrl = `${CALENDAR_BASE}/events/${event.id}`;
      const delRes = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (delRes.ok || delRes.status === 204 || delRes.status === 410) {
        deleted++;
        titles.push(event.summary ?? event.id);
        console.log(`[delete-calendar-event] Deleted "${event.summary}" (${event.id})`);
      } else {
        const err = await delRes.text();
        console.error(`[delete-calendar-event] Failed to delete ${event.id}: ${err}`);
      }
    }

    return new Response(JSON.stringify({ success: true, deleted, titles }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[delete-calendar-event] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
