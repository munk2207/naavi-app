/**
 * Google Calendar Adapter
 *
 * Implements CalendarAdapter using the existing calendar.ts lib functions.
 * Maps Google-specific / BriefItem data into the normalized CalendarEvent type.
 *
 * The rest of the system never imports from calendar.ts directly —
 * it always goes through this adapter.
 */

import {
  fetchUpcomingEvents as googleFetchEvents,
  fetchUpcomingBirthdays as googleFetchBirthdays,
  createCalendarEvent as googleCreateEvent,
  deleteCalendarEvent as googleDeleteEvent,
  triggerCalendarSync,
} from '../../../lib/calendar';

import type { CalendarAdapter } from '../interfaces';
import type { CalendarEvent } from '../../types';
import type { BriefItem } from '../../naavi-client';

// ─── Mapping ──────────────────────────────────────────────────────────────────

function briefItemToCalendarEvent(item: BriefItem): CalendarEvent {
  return {
    id:              `evt_${item.id}`,
    title:           item.title,
    startISO:        item.startISO ?? '',
    endISO:          item.endISO  ?? '',
    isAllDay:        !item.startISO?.includes('T'),
    location:        item.location,
    description:     item.detail,
    provider:        'google',
    providerEventId: item.id,
  };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class GoogleCalendarAdapter implements CalendarAdapter {

  async fetchEvents(userId: string, days: number): Promise<CalendarEvent[]> {
    const items = await googleFetchEvents(days, userId);
    return items
      .filter(i => i.category === 'calendar' && i.startISO)
      .map(briefItemToCalendarEvent);
  }

  async fetchBirthdays(userId: string): Promise<CalendarEvent[]> {
    const items = await googleFetchBirthdays(userId);
    return items.map(item => ({
      id:              `evt_${item.id}`,
      title:           item.title,
      startISO:        item.startISO ?? '',
      endISO:          item.endISO  ?? '',
      isAllDay:        true,
      provider:        'google' as const,
      providerEventId: item.id,
    }));
  }

  async createEvent(event: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const result = await googleCreateEvent({
      summary:     event.title ?? '',
      description: event.description,
      start:       event.startISO ?? '',
      end:         event.endISO   ?? '',
      attendees:   event.attendees?.map(a => a.email),
      recurrence:  event.recurrence,
    });
    return {
      id:              `evt_${result.eventId ?? Date.now()}`,
      title:           event.title ?? '',
      startISO:        event.startISO ?? '',
      endISO:          event.endISO   ?? '',
      isAllDay:        false,
      location:        event.location,
      provider:        'google',
      providerEventId: result.eventId ?? '',
      htmlLink:        result.htmlLink,
    };
  }

  async deleteEvent(query: string): Promise<{ deleted: number; titles: string[] }> {
    return googleDeleteEvent(query);
  }

  async sync(_userId: string): Promise<void> {
    await triggerCalendarSync();
  }
}
