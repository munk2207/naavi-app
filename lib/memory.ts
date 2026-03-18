/**
 * Naavi Memory — Cognitive Profile engine
 *
 * When Robert asks about a person or topic, this module:
 * 1. Searches Supabase for known contacts, interactions, and notes
 * 2. Queries Google Calendar for past and upcoming events
 * 3. Returns a structured context summary ready to inject into the system prompt
 *
 * It also handles saving new people, interactions, and notes
 * as Naavi learns from conversations.
 */

import { supabase } from './supabase';
import { fetchNotionNotesForPerson } from './notion';
import { fetchEmailsFromPerson } from './gmail';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PersonContext {
  name: string;
  relationship?: string;
  email?: string;
  phone?: string;
  notes?: string;
  lastContactDate?: string;
  upcomingMeetings: CalendarEntry[];
  pastMeetings: CalendarEntry[];
  savedNotes: string[];
  recentEmails: { subject: string; snippet: string; received_at: string; is_unread: boolean }[];
}

interface CalendarEntry {
  title: string;
  date: string;
  time?: string;
}

// ─── Person lookup ────────────────────────────────────────────────────────────

export async function getPersonContext(name: string): Promise<PersonContext | null> {
  console.log('[Memory] Looking up person context for:', name);
  if (!supabase) {
    console.warn('[Memory] Supabase not configured — skipping person lookup');
    return null;
  }

  const nameLower = name.toLowerCase();

  // Use only calendar_events (reliable) + Notion for now
  // contacts/people/interactions/topics queries are added when RLS is verified
  const sessionRace = await Promise.race([
    supabase.auth.getSession(),
    new Promise<{ data: { session: null } }>((resolve) =>
      setTimeout(() => resolve({ data: { session: null } }), 5000)
    ),
  ]);
  const userId = sessionRace.data.session?.user?.id;

  const [calendarEvents, notionNotes, emails] = await Promise.all([
    getCalendarEventsForPerson(name),
    fetchNotionNotesForPerson(name),
    userId ? fetchEmailsFromPerson(name, userId) : Promise.resolve([]),
  ]);

  console.log('[Memory] Results for', name, '— calendar:', calendarEvents.length, 'notion:', notionNotes.length, 'emails:', emails.length);

  if (calendarEvents.length === 0 && notionNotes.length === 0 && emails.length === 0) {
    console.log('[Memory] No data found for', name);
    return null;
  }

  const now = new Date();
  const upcoming = calendarEvents.filter(e => new Date(e.date) >= now);
  const past = calendarEvents.filter(e => new Date(e.date) < now);

  return {
    name,
    upcomingMeetings: upcoming,
    pastMeetings: past,
    savedNotes: notionNotes,
    recentEmails: emails,
  };
}

// ─── Calendar search — queries Supabase cache (no Google API call) ────────────

async function getCalendarEventsForPerson(name: string): Promise<CalendarEntry[]> {
  if (!supabase) return [];

  // getSession() can make a slow refresh network call — cap it at 2s
  const sessionRace = await Promise.race([
    supabase.auth.getSession(),
    new Promise<{ data: { session: null } }>((resolve) =>
      setTimeout(() => resolve({ data: { session: null } }), 5000)
    ),
  ]);
  const userId = sessionRace.data.session?.user?.id;
  if (!userId) {
    console.log('[Memory] No session — skipping calendar lookup');
    return [];
  }

  const nameLower = name.toLowerCase();

  // Search past 6 months + next 3 months from the cached calendar_events table
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const threeMonthsAhead = new Date();
  threeMonthsAhead.setMonth(threeMonthsAhead.getMonth() + 3);

  try {
    const { data: events, error } = await supabase
      .from('calendar_events')
      .select('title, start_time, location')
      .eq('user_id', userId)
      .gte('start_time', sixMonthsAgo.toISOString())
      .lte('start_time', threeMonthsAhead.toISOString())
      .or(`title.ilike.%${nameLower}%,description.ilike.%${nameLower}%,location.ilike.%${nameLower}%,attendees.cs.[{"displayName":"${name}"}]`)
      .order('start_time', { ascending: true })
      .limit(50);

    if (error || !events) return [];

    return events.map(event => {
      const startRaw = event.start_time ?? '';
      const date = new Date(startRaw);
      const isAllDay = !startRaw.includes('T');
      return {
        title: event.title ?? 'Meeting',
        date: startRaw,
        time: !isAllDay
          ? date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true })
          : undefined,
      };
    });
  } catch {
    return [];
  }
}

// ─── Context formatter ────────────────────────────────────────────────────────

export function formatPersonContext(ctx: PersonContext): string {
  const lines: string[] = [`## What Naavi knows about ${ctx.name}`];

  if (ctx.relationship) lines.push(`Relationship: ${ctx.relationship}`);
  if (ctx.email)        lines.push(`Email: ${ctx.email}`);
  if (ctx.phone)        lines.push(`Phone: ${ctx.phone}`);
  if (ctx.notes)        lines.push(`Notes: ${ctx.notes}`);

  if (ctx.upcomingMeetings.length > 0) {
    lines.push(`\nUpcoming meetings (${ctx.upcomingMeetings.length}):`);
    ctx.upcomingMeetings.slice(0, 5).forEach(m => {
      const d = new Date(m.date);
      const label = d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
      lines.push(`- ${m.title} on ${label}${m.time ? ' at ' + m.time : ''}`);
    });
  }

  if (ctx.pastMeetings.length > 0) {
    lines.push(`\nPast meetings (${ctx.pastMeetings.length} in last 6 months):`);
    ctx.pastMeetings.slice(0, 10).forEach(m => {
      const d = new Date(m.date);
      const label = d.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });
      lines.push(`- ${m.title} on ${label}${m.time ? ' at ' + m.time : ''}`);
    });
  }

  if (ctx.savedNotes.length > 0) {
    lines.push(`\nSaved notes:`);
    ctx.savedNotes.forEach(n => lines.push(`- ${n}`));
  }

  if (ctx.recentEmails && ctx.recentEmails.length > 0) {
    lines.push(`\nRecent emails (${ctx.recentEmails.length}):`);
    ctx.recentEmails.slice(0, 5).forEach(e => {
      const d = new Date(e.received_at);
      const label = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
      const unread = e.is_unread ? ' [unread]' : '';
      lines.push(`- ${label}${unread}: ${e.subject}`);
      if (e.snippet) lines.push(`  "${e.snippet.slice(0, 100)}"`);
    });
  }

  return lines.join('\n');
}

// ─── Save helpers ─────────────────────────────────────────────────────────────

export async function savePerson(person: {
  name: string;
  relationship?: string;
  email?: string;
  phone?: string;
  notes?: string;
}): Promise<void> {
  if (!supabase) return;

  // Upsert — update if exists, insert if not
  const { data: existing } = await supabase
    .from('people')
    .select('id')
    .ilike('name', person.name)
    .limit(1);

  if (existing && existing.length > 0) {
    await supabase
      .from('people')
      .update({ ...person, updated_at: new Date().toISOString() })
      .eq('id', existing[0].id);
  } else {
    await supabase.from('people').insert(person);
  }
}

export async function saveInteraction(interaction: {
  person_name: string;
  interaction_type: string;
  summary: string;
  interaction_date: string;
  source: string;
}): Promise<void> {
  if (!supabase) return;
  await supabase.from('interactions').insert(interaction);
}

export async function saveTopic(topic: {
  subject: string;
  note: string;
  category: string;
}): Promise<void> {
  if (!supabase) return;
  await supabase.from('topics').insert(topic);
}

// ─── Person name detector ─────────────────────────────────────────────────────

/**
 * Detects if the user's message is asking about a specific person.
 * Returns the person's name if found, null otherwise.
 *
 * Examples that match:
 * "What do you have on John?"
 * "Tell me about Louise"
 * "What's the status with Dr. Patel?"
 * "Give me everything on Sarah"
 */
export function extractPersonQuery(message: string): string | null {
  const patterns = [
    // "what do you have on John" / "what's on John" / "what do you have about John"
    /what(?:'s| is| do you have) (?:on|about) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "tell me about John"
    /tell me about ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "give me everything on John"
    /give me (?:everything|what you have|all) (?:on|about) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "status on John" / "update on John"
    /(?:status|update) (?:on|with|for) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "meetings with John" / "notes on John"
    /(?:meetings?|notes?|history) (?:with|for|on) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "what do you know about John" / "what do you have for John"
    /what (?:do you know|do you have|have you got|can you tell me) (?:on|about|for) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "pull up John" / "look up John" (not "find everything")
    /(?:pull up|look up|check on) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "John's profile" / "John's history"
    /([A-Z][a-z]+(?: [A-Z][a-z.]+)?)'s (?:profile|history|notes?|info|contact|details?)/i,
    // "anything on John" / "anything about John"
    /anything (?:on|about) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "who is John" / "who's John"
    /who(?:'s| is) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return match[1];
  }

  return null;
}
