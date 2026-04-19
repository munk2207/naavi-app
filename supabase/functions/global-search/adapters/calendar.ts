/**
 * Calendar adapter — searches `calendar_events` (Google Calendar events and
 * Google Tasks synced into Supabase). Matches title, description, location,
 * and attendee names/emails.
 *
 * Covers queries like "when was my dentist appointment?", "anything with
 * Sarah on the calendar?", "meetings at the community center".
 */

import type { SearchAdapter, SearchContext, SearchResult } from './_interface.ts';

type EventRow = {
  id: string;
  google_event_id: string | null;
  item_type: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  attendees: unknown;
  start_time: string | null;
  end_time: string | null;
  is_priority: boolean | null;
};

function attendeesToText(attendees: unknown): string {
  if (!attendees) return '';
  try {
    if (typeof attendees === 'string') return attendees;
    return JSON.stringify(attendees);
  } catch {
    return '';
  }
}

export const calendarAdapter: SearchAdapter = {
  name: 'calendar',
  label: 'Calendar',
  icon: 'calendar',
  privacyTag: 'general',

  isConnected: async () => true, // every user has the table

  search: async (ctx: SearchContext): Promise<SearchResult[]> => {
    const q = ctx.query.trim();
    if (!q) return [];

    const pattern = `%${q}%`;
    // Search title, description, location directly; attendee search happens
    // in JS after the fetch because attendees is JSONB.
    const { data, error } = await ctx.supabase
      .from('calendar_events')
      .select(
        'id, google_event_id, item_type, title, description, location, attendees, start_time, end_time, is_priority',
      )
      .eq('user_id', ctx.userId)
      .or(
        `title.ilike.${pattern},description.ilike.${pattern},location.ilike.${pattern}`,
      )
      .order('start_time', { ascending: false })
      .limit(Math.max(ctx.limit * 2, 20));

    // Second query for attendee match — separate because it needs JSONB text
    // cast that Supabase's .or() chain doesn't support cleanly.
    const { data: attendeeMatches } = await ctx.supabase
      .from('calendar_events')
      .select(
        'id, google_event_id, item_type, title, description, location, attendees, start_time, end_time, is_priority',
      )
      .eq('user_id', ctx.userId)
      .filter('attendees::text', 'ilike', pattern)
      .order('start_time', { ascending: false })
      .limit(Math.max(ctx.limit, 10));

    if (error) {
      console.error('[calendar-adapter] fetch error:', error.message);
      // fall through — attendeeMatches may still have data
    }

    // Merge the two result sets, deduping by id.
    const seen = new Set<string>();
    const merged: EventRow[] = [];
    for (const row of [...(data ?? []), ...(attendeeMatches ?? [])] as EventRow[]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }

    const qLower = q.toLowerCase();

    // Score: title match = 1.0, attendee match = 0.8, location = 0.7,
    // description-only = 0.6. Priority events get a small bump.
    const hits: SearchResult[] = [];
    for (const e of merged) {
      const title = (e.title ?? '').toLowerCase();
      const description = (e.description ?? '').toLowerCase();
      const location = (e.location ?? '').toLowerCase();
      const attendeeText = attendeesToText(e.attendees).toLowerCase();

      let score = 0;
      if (title.includes(qLower)) score = 1.0;
      else if (attendeeText.includes(qLower)) score = 0.8;
      else if (location.includes(qLower)) score = 0.7;
      else if (description.includes(qLower)) score = 0.6;
      if (score === 0) continue;

      if (e.is_priority) score = Math.min(1.0, score + 0.05);

      const dateStr = e.start_time
        ? new Date(e.start_time).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : '';
      const snippetParts = [
        dateStr,
        e.location ? `at ${e.location}` : '',
      ].filter(Boolean);

      hits.push({
        source: 'calendar',
        title: e.title ?? 'Event',
        snippet: snippetParts.join(' · '),
        score,
        createdAt: e.start_time ?? undefined,
        metadata: {
          event_id: e.id,
          google_event_id: e.google_event_id,
          item_type: e.item_type,
          start_time: e.start_time,
          end_time: e.end_time,
          location: e.location,
          is_priority: e.is_priority,
        },
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, ctx.limit);
  },
};
