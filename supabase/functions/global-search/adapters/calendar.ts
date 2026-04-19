/**
 * Calendar adapter — queries Google Calendar LIVE via the user's OAuth token.
 *
 * No Supabase cache, no sync delay. When Robert creates an event in Google
 * Calendar and asks Naavi about it a minute later, the next search call
 * fetches it directly from Google and returns it.
 *
 * Pattern:
 *   1. Read refresh_token from user_tokens (same row sync-google-calendar uses).
 *   2. Exchange for a fresh access_token (Google OAuth).
 *   3. List all the user's calendars.
 *   4. Parallel events.list with `q=<query>` across every calendar — Google
 *      searches title, description, location, attendees natively.
 *   5. Aggregate, score, return.
 *
 * Latency budget: ~1-2s (one token refresh + a few API calls, parallelised
 * across calendars). This runs in parallel with Claude thinking, so most of
 * it is hidden from the user's perceived response time.
 *
 * If Google is unreachable or the token is missing/broken, returns [] — no
 * stale-cache fallback, because stale data would violate the "Naavi sees
 * Robert's real data" principle.
 */

import type { SearchAdapter, SearchContext, SearchResult } from './_interface.ts';

const GOOGLE_TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const CALENDAR_LIST_API   = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const CALENDAR_EVENTS_API = 'https://www.googleapis.com/calendar/v3/calendars';

// How far back and forward we search. 6 months past covers "when was my last
// cardiologist visit?"; 12 months ahead covers "when is my next dentist?".
const SEARCH_WINDOW_DAYS_PAST   = 180;
const SEARCH_WINDOW_DAYS_FUTURE = 365;

type GoogleEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  attendees?: Array<{ email?: string; displayName?: string }>;
  start?: { dateTime?: string; date?: string };
  end?:   { dateTime?: string; date?: string };
  htmlLink?: string;
  organizer?: { email?: string; displayName?: string };
};

async function getAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')     ?? '',
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    const data = await res.json();
    return typeof data.access_token === 'string' ? data.access_token : null;
  } catch (err) {
    console.error('[calendar-adapter] token refresh failed:', err);
    return null;
  }
}

function attendeesToText(attendees: GoogleEvent['attendees']): string {
  if (!attendees?.length) return '';
  return attendees
    .map(a => [a.displayName, a.email].filter(Boolean).join(' '))
    .join(' ');
}

export const calendarAdapter: SearchAdapter = {
  name: 'calendar',
  label: 'Calendar',
  icon: 'calendar',
  privacyTag: 'general',

  // Connected means the user has a Google refresh_token stored.
  isConnected: async (ctx: SearchContext) => {
    const { data } = await ctx.supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', ctx.userId)
      .eq('provider', 'google')
      .maybeSingle();
    return !!data?.refresh_token;
  },

  search: async (ctx: SearchContext): Promise<SearchResult[]> => {
    const q = ctx.query.trim();
    if (!q) return [];

    // ── 1. Refresh token → access token ─────────────────────────────────────
    const { data: tokenRow } = await ctx.supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', ctx.userId)
      .eq('provider', 'google')
      .maybeSingle();

    const refreshToken = tokenRow?.refresh_token;
    if (!refreshToken) {
      console.warn('[calendar-adapter] no Google refresh token for user', ctx.userId);
      return [];
    }

    const accessToken = await getAccessToken(refreshToken);
    if (!accessToken) {
      console.warn('[calendar-adapter] could not refresh access token for user', ctx.userId);
      return [];
    }

    // ── 2. List the user's calendars ────────────────────────────────────────
    let calendarIds: string[] = [];
    try {
      const calListRes = await fetch(CALENDAR_LIST_API, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!calListRes.ok) {
        console.warn('[calendar-adapter] calendarList failed:', calListRes.status);
        calendarIds = ['primary'];
      } else {
        const calListData = await calListRes.json();
        const items = calListData?.items as Array<{ id: string }> | undefined;
        calendarIds = items?.map(c => c.id).filter(Boolean) ?? ['primary'];
      }
    } catch (err) {
      console.error('[calendar-adapter] calendarList error:', err);
      calendarIds = ['primary'];
    }

    // ── 3. Parallel events.list with Google's built-in `q` search ──────────
    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() - SEARCH_WINDOW_DAYS_PAST);
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + SEARCH_WINDOW_DAYS_FUTURE);

    const perCalendarResults = await Promise.all(
      calendarIds.map(async (calId): Promise<GoogleEvent[]> => {
        try {
          const url =
            `${CALENDAR_EVENTS_API}/${encodeURIComponent(calId)}/events` +
            `?maxResults=25&singleEvents=true&orderBy=startTime` +
            `&q=${encodeURIComponent(q)}` +
            `&timeMin=${encodeURIComponent(timeMin.toISOString())}` +
            `&timeMax=${encodeURIComponent(timeMax.toISOString())}`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!res.ok) {
            console.warn(`[calendar-adapter] events.list ${calId} returned ${res.status}`);
            return [];
          }
          const data = await res.json();
          return (data?.items ?? []) as GoogleEvent[];
        } catch (err) {
          console.error(`[calendar-adapter] events.list ${calId} error:`, err);
          return [];
        }
      }),
    );

    // ── 4. Merge, dedupe, score ─────────────────────────────────────────────
    const seen = new Set<string>();
    const merged: GoogleEvent[] = [];
    for (const list of perCalendarResults) {
      for (const ev of list) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        merged.push(ev);
      }
    }

    const qLower = q.toLowerCase();

    // Score: title match = 1.0, attendee match = 0.8, location = 0.7,
    // description-only = 0.6. Matches the scoring the old cached adapter used
    // so mobile UI grouping stays consistent.
    const hits: SearchResult[] = [];
    for (const e of merged) {
      const title       = (e.summary     ?? '').toLowerCase();
      const description = (e.description ?? '').toLowerCase();
      const location    = (e.location    ?? '').toLowerCase();
      const attendeeText = attendeesToText(e.attendees).toLowerCase();

      let score = 0;
      if      (title.includes(qLower))        score = 1.0;
      else if (attendeeText.includes(qLower)) score = 0.8;
      else if (location.includes(qLower))     score = 0.7;
      else if (description.includes(qLower))  score = 0.6;
      // Google's `q` hit the event even if our string-check missed (e.g. it
      // matched organizer email) — still include it, at the floor.
      if (score === 0) score = 0.5;

      const startISO = e.start?.dateTime ?? e.start?.date ?? undefined;
      const endISO   = e.end?.dateTime   ?? e.end?.date   ?? undefined;
      const dateStr = startISO
        ? new Date(startISO).toLocaleDateString('en-US', {
            month: 'short',
            day:   'numeric',
            year:  'numeric',
          })
        : '';
      const snippetParts = [
        dateStr,
        e.location ? `at ${e.location}` : '',
      ].filter(Boolean);

      hits.push({
        source: 'calendar',
        title:  e.summary ?? 'Event',
        snippet: snippetParts.join(' · '),
        score,
        createdAt: startISO,
        url: e.htmlLink,
        metadata: {
          google_event_id: e.id,
          start_time: startISO,
          end_time:   endISO,
          location:   e.location ?? null,
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, ctx.limit);
  },
};
