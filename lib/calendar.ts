/**
 * Google Calendar integration — Phase 9
 *
 * Robert connects once. The refresh token is stored server-side.
 * A scheduled Edge Function syncs his Calendar every 6 hours.
 * All lookups query the Supabase cache — no token expiry issues.
 */

import { supabase } from './supabase';
import type { BriefItem } from './naavi-client';

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL      ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// ─── Connection status ────────────────────────────────────────────────────────

const CONNECTED_FLAG = 'naavi_google_calendar_connected';

export function markCalendarConnected(): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(CONNECTED_FLAG, '1');
}

export function markCalendarDisconnected(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(CONNECTED_FLAG);
}

export async function isCalendarConnected(): Promise<boolean> {
  // Fast check — flag set when token was stored server-side
  if (typeof localStorage !== 'undefined' && localStorage.getItem(CONNECTED_FLAG)) return true;
  // Fallback — check user_tokens table (provider_token is always set while logged in, so don't use it)
  if (!supabase) return false;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return false;
  const { data } = await supabase
    .from('user_tokens')
    .select('id')
    .eq('user_id', session.user.id)
    .eq('provider', 'google')
    .limit(1);
  const connected = Boolean(data && data.length > 0);
  if (connected) markCalendarConnected(); // sync localStorage flag
  return connected;
}

// ─── OAuth connect ────────────────────────────────────────────────────────────

export async function connectGoogleCalendar(): Promise<void> {
  if (!supabase) return;
  // Mark that we intentionally started an OAuth flow — captureAndStoreGoogleToken checks this
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('naavi_google_oauth_pending', '1');
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      scopes: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/contacts.readonly',
        'https://www.googleapis.com/auth/contacts.other.readonly',
      ].join(' '),
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });
}

export async function disconnectGoogleCalendar(): Promise<void> {
  if (!supabase) return;
  // Only remove the stored Google token — do NOT sign Robert out of Supabase.
  // Signing out clears the entire session and breaks all DB queries until reconnect.
  const { data: { session } } = await supabase.auth.getSession();
  console.log('[Calendar] Disconnecting — session user:', session?.user?.id ?? 'none');
  if (session?.user) {
    const { error } = await supabase
      .from('user_tokens')
      .delete()
      .eq('user_id', session.user.id)
      .eq('provider', 'google');
    if (error) console.error('[Calendar] Disconnect delete error:', error.message, error.code);
    else console.log('[Calendar] Token deleted successfully');
  }
  markCalendarDisconnected();
  // Clear the OAuth pending flag so captureAndStoreGoogleToken won't re-store on next load
  if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('naavi_google_oauth_pending');
}

// ─── Token capture — called on auth state change after OAuth ──────────────────

/**
 * Called when Supabase fires SIGNED_IN after Google OAuth.
 * Stores the refresh token server-side and triggers the first sync.
 * After this, Robert never needs to reconnect.
 */
export async function captureAndStoreGoogleToken(): Promise<void> {
  if (!supabase) return;

  // Only capture token after an intentional OAuth connect — not on every page load
  if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem('naavi_google_oauth_pending')) {
    console.log('[Calendar] Skipping token capture — no pending OAuth flow');
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  const refreshToken = session?.provider_refresh_token;

  if (!refreshToken) {
    console.log('[Calendar] No refresh token in session — skipping store');
    return;
  }

  console.log('[Calendar] Storing Google refresh token server-side...');

  try {
    // Store refresh token in Supabase via Edge Function
    const res = await fetch(`${SUPABASE_URL}/functions/v1/store-google-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      console.error('[Calendar] Failed to store token:', await res.text());
      return;
    }

    markCalendarConnected();
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('naavi_google_oauth_pending');
    console.log('[Calendar] Token stored. Triggering first sync...');

    // Trigger an immediate sync so calendar data is available right away
    await triggerCalendarSync(session.access_token);

  } catch (err) {
    console.error('[Calendar] Error storing token:', err);
  }
}

// ─── Trigger sync ─────────────────────────────────────────────────────────────

export async function triggerCalendarSync(accessToken?: string): Promise<void> {
  try {
    let token = accessToken;
    if (!token) {
      const { data: { session } } = await supabase!.auth.getSession();
      token = session?.access_token;
    }
    if (!token) return;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-google-calendar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    const data = await res.json();
    console.log('[Calendar] Sync result:', JSON.stringify(data));
  } catch (err) {
    console.error('[Calendar] Sync trigger failed:', err);
  }
}

// ─── Shared session helper ────────────────────────────────────────────────────

async function getSessionUserId(): Promise<string | null> {
  if (!supabase) return null;
  const sessionRace = await Promise.race([
    supabase.auth.getSession(),
    new Promise<{ data: { session: null } }>((resolve) =>
      setTimeout(() => resolve({ data: { session: null } }), 5000)
    ),
  ]);
  const uid = sessionRace.data.session?.user?.id ?? null;
  console.log('[Calendar] getSessionUserId:', uid ?? 'null');
  return uid;
}

function mapEventToBriefItem(event: {
  google_event_id: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  description: string | null;
}, dayLabel?: string): BriefItem {
  const startRaw = event.start_time ?? '';
  const isAllDay = !startRaw.includes('T');

  const timeLabel = isAllDay
    ? 'All day'
    : new Date(startRaw).toLocaleTimeString('en-CA', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

  const urgent = !isAllDay &&
    (new Date(startRaw).getTime() - Date.now()) < 2 * 60 * 60 * 1000 &&
    new Date(startRaw).getTime() > Date.now();

  const prefix = dayLabel ? `${dayLabel} — ` : '';

  return {
    id: event.google_event_id,
    category: 'calendar' as const,
    title: `${prefix}${event.title} at ${timeLabel}`,
    detail: event.location || event.description || '',
    urgent,
    startISO: startRaw || undefined,
    endISO: event.end_time || undefined,
    location: event.location || undefined,
  };
}

// ─── Fetch today's events from Supabase cache ─────────────────────────────────

export async function fetchTodayEvents(): Promise<BriefItem[]> {
  const userId = await getSessionUserId();
  if (!userId || !supabase) return [];

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  try {
    const { data: events, error } = await supabase
      .from('calendar_events')
      .select('google_event_id, title, start_time, end_time, location, description')
      .eq('user_id', userId)
      .gte('start_time', startOfDay.toISOString())
      .lte('start_time', endOfDay.toISOString())
      .order('start_time', { ascending: true })
      .limit(10);

    if (error || !events) return [];
    return events.map(e => mapEventToBriefItem(e));
  } catch {
    return [];
  }
}

// ─── Fetch upcoming events (next N days) for the brief ────────────────────────

export async function fetchUpcomingEvents(days = 7, passedUserId?: string): Promise<BriefItem[]> {
  const userId = passedUserId ?? await getSessionUserId();
  if (!userId || !supabase) return [];

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const future = new Date();
  future.setDate(future.getDate() + days);

  try {
    const { data: events, error: evError } = await supabase
      .from('calendar_events')
      .select('google_event_id, title, start_time, end_time, location, description, item_type')
      .eq('user_id', userId)
      .gte('start_time', startOfDay.toISOString())
      .lte('start_time', future.toISOString())
      .order('start_time', { ascending: true })
      .limit(20);

    // Fetch all incomplete tasks — sync only stores incomplete tasks
    const { data: tasks, error: taskError } = await supabase
      .from('calendar_events')
      .select('google_event_id, title, start_time, end_time, location, description, item_type')
      .eq('user_id', userId)
      .eq('item_type', 'task')
      .order('start_time', { ascending: true, nullsFirst: false })
      .limit(20);

    console.log('[Calendar] fetchUpcomingEvents — events:', events?.length ?? 0, 'tasks:', tasks?.length ?? 0);
    if (evError) console.error('[Calendar] events error:', evError.message);
    if (taskError) console.error('[Calendar] tasks error:', taskError.message);

    const allItems = [...(events ?? []), ...(tasks ?? [])];

    return allItems.map(event => {
      const startRaw = event.start_time ?? '';
      const isTask = event.item_type === 'task';
      const date = startRaw ? new Date(startRaw) : null;
      const today = new Date();
      const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);

      let dayLabel: string;
      if (!date) {
        dayLabel = 'No due date';
      } else if (date.toDateString() === today.toDateString()) {
        dayLabel = 'Today';
      } else if (date.toDateString() === tomorrow.toDateString()) {
        dayLabel = 'Tomorrow';
      } else {
        dayLabel = date.toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' });
      }

      if (isTask) {
        const taskDateStr = date
          ? date.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
          : 'No due date';
        return {
          id: event.google_event_id,
          category: 'task' as const,
          title: `☑ ${event.title}`,
          detail: `Due: ${taskDateStr}`,
          urgent: false,
          startISO: event.start_time ?? '',
        } as BriefItem;
      }

      return mapEventToBriefItem(event, dayLabel);
    });
  } catch {
    return [];
  }
}

// ─── Create a calendar event ──────────────────────────────────────────────────

export async function createCalendarEvent(opts: {
  summary: string;
  description?: string;
  start: string;   // ISO 8601 datetime e.g. "2026-03-20T14:00:00"
  end: string;     // ISO 8601 datetime
  attendees?: string[]; // email addresses
  recurrence?: string[]; // e.g. ["RRULE:FREQ=WEEKLY;BYDAY=SA"]
}): Promise<{ success: boolean; eventId?: string; htmlLink?: string; error?: string }> {
  if (!supabase) return { success: false, error: 'Not configured' };

  try {
    const { data, error } = await supabase.functions.invoke('create-calendar-event', {
      body: opts,
    });
    if (error) return { success: false, error: error.message ?? 'Create failed' };
    return { success: true, eventId: data?.eventId, htmlLink: data?.htmlLink };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ─── Delete calendar events by search query ───────────────────────────────────

export async function deleteCalendarEvent(query: string): Promise<{ deleted: number; titles: string[] }> {
  if (!supabase) return { deleted: 0, titles: [] };
  try {
    const { data, error } = await supabase.functions.invoke('delete-calendar-event', {
      body: { query },
    });
    if (error) {
      console.error('[Calendar] deleteCalendarEvent error:', error.message);
      return { deleted: 0, titles: [] };
    }
    return { deleted: data?.deleted ?? 0, titles: data?.titles ?? [] };
  } catch (err) {
    console.error('[Calendar] deleteCalendarEvent exception:', err);
    return { deleted: 0, titles: [] };
  }
}

// ─── Fetch upcoming birthdays (next 30 days) ──────────────────────────────────

export async function fetchUpcomingBirthdays(passedUserId?: string): Promise<BriefItem[]> {
  const userId = passedUserId ?? await getSessionUserId();
  if (!userId || !supabase) return [];

  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + 30);

  try {
    const { data: events, error } = await supabase
      .from('calendar_events')
      .select('google_event_id, title, start_time, end_time, location, description')
      .eq('user_id', userId)
      .ilike('title', '%birthday%')
      .gte('start_time', now.toISOString())
      .lte('start_time', future.toISOString())
      .order('start_time', { ascending: true })
      .limit(10);

    if (error || !events) return [];

    return events.map(event => {
      const date = new Date(event.start_time ?? '');
      const dayLabel = date.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
      return {
        id: event.google_event_id,
        category: 'social' as const,
        title: `${event.title} — ${dayLabel}`,
        detail: '',
        urgent: false,
      };
    });
  } catch {
    return [];
  }
}
