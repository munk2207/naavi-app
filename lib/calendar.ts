/**
 * Google Calendar integration — Phase 8
 *
 * Fetches today's events from Robert's primary Google Calendar
 * using the OAuth access token stored in the Supabase session.
 *
 * Robert connects once via Settings → Connect Google Calendar.
 * After that, his real events appear in the morning brief automatically.
 */

import { supabase } from './supabase';
import type { BriefItem } from './naavi-client';

export async function isCalendarConnected(): Promise<boolean> {
  if (!supabase) return false;
  const { data: { session } } = await supabase.auth.getSession();
  return Boolean(session?.provider_token);
}

export async function connectGoogleCalendar(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: 'https://www.googleapis.com/auth/calendar.readonly',
      redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });
}

export async function disconnectGoogleCalendar(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function fetchTodayEvents(): Promise<BriefItem[]> {
  if (!supabase) return [];

  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.provider_token;

  if (!accessToken) return [];

  const now = new Date();
  const startOfDay = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0
  ).toISOString();
  const endOfDay = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59
  ).toISOString();

  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
      `?maxResults=5&orderBy=startTime&singleEvents=true` +
      `&timeMin=${encodeURIComponent(startOfDay)}&timeMax=${encodeURIComponent(endOfDay)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (res.status === 401) {
      // Token expired — sign out so user can reconnect
      await supabase.auth.signOut();
      return [];
    }

    if (!res.ok) throw new Error(`Calendar API ${res.status}`);

    const data = await res.json();
    const events: CalendarEvent[] = data.items ?? [];

    if (events.length === 0) return [];

    return events.map((event, i) => {
      const startRaw = event.start?.dateTime ?? event.start?.date ?? '';
      const isAllDay = !event.start?.dateTime;

      const timeLabel = isAllDay
        ? 'All day'
        : new Date(startRaw).toLocaleTimeString('en-CA', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });

      const title = `${event.summary ?? 'Event'} at ${timeLabel}`;
      const detail = event.location ?? event.description ?? '';

      // Flag events within the next 2 hours as urgent
      const urgent = !isAllDay && (new Date(startRaw).getTime() - Date.now()) < 2 * 60 * 60 * 1000;

      return {
        id: event.id ?? `cal-${i}`,
        category: 'calendar' as const,
        title,
        detail,
        urgent,
      };
    });
  } catch (err) {
    console.error('[Calendar] Failed to fetch events:', err);
    return [];
  }
}

interface CalendarEvent {
  id?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
}
