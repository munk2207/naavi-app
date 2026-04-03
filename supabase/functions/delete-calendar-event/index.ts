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
  const { query } = body;

  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing query' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: tokenRow, error: tokenError } = await userClient
    .from('user_tokens')
    .select('refresh_token')
    .eq('provider', 'google')
    .single();

  if (tokenError || !tokenRow?.refresh_token) {
    return new Response(JSON.stringify({ error: 'No Google token found' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const accessToken = await getNewAccessToken(tokenRow.refresh_token);

    // Search for events matching the query (look back 1 day, forward 1 year)
    const now = new Date();
    const timeMin = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

    const searchUrl = `${CALENDAR_BASE}/events?q=${encodeURIComponent(query)}&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=false&maxResults=25`;

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
    const events = searchData.items ?? [];

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
