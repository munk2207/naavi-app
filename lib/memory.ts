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
import { searchDriveFiles, type DriveFile } from './drive';

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
  driveFiles: DriveFile[];
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

  // Use only calendar_events (reliable) + Notion for now
  // contacts/people/interactions/topics queries are added when RLS is verified
  const sessionRace = await Promise.race([
    supabase.auth.getSession(),
    new Promise<{ data: { session: null } }>((resolve) =>
      setTimeout(() => resolve({ data: { session: null } }), 5000)
    ),
  ]);
  const userId = sessionRace.data.session?.user?.id;

  const [calendarEvents, notionNotes, emails, driveFiles] = await Promise.all([
    getCalendarEventsForPerson(name),
    fetchNotionNotesForPerson(name),
    userId ? fetchEmailsFromPerson(name, userId) : Promise.resolve([]),
    searchDriveFiles(name),
  ]);

  console.log('[Memory] Results for', name, '— calendar:', calendarEvents.length, 'notion:', notionNotes.length, 'emails:', emails.length, 'drive:', driveFiles.length);

  if (calendarEvents.length === 0 && notionNotes.length === 0 && emails.length === 0 && driveFiles.length === 0) {
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
    driveFiles,
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

  if (ctx.driveFiles && ctx.driveFiles.length > 0) {
    lines.push(`\nDrive documents (${ctx.driveFiles.length}):`);
    ctx.driveFiles.slice(0, 5).forEach(f => {
      const modified = new Date(f.modifiedTime).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
      lines.push(`- ${f.name} (modified ${modified}) — ${f.webViewLink}`);
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
export function extractPersonQuery(rawMessage: string): string | null {
  // Join spaced-out letters: "w a e l" → "wael", "J o h n" → "John"
  const message = rawMessage.replace(/\b([a-zA-Z])\s(?=[a-zA-Z]\s|[a-zA-Z]\b)/g, '$1').replace(/\b([a-zA-Z])\s([a-zA-Z])\b/g, '$1$2');

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
    // "John's profile" / "John's history" / "John's email" / "John's phone" / "John's number"
    /([A-Z][a-z]+(?: [A-Z][a-z.]+)?)'s (?:profile|history|notes?|info|contact|details?|email|phone|number|address)/i,
    // "anything on John" / "anything about John"
    /anything (?:on|about) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "who is John" / "who's John"
    /who(?:'s| is) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "find John" / "find John in contacts" / "find John's contact"
    /\bfind\b(?:\s+me)?\s+([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "search contacts for John" / "search for John" / "search my contacts for John"
    /search(?:\s+(?:my\s+)?contacts?)?\s+for\s+([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "what is John's phone/email/number"
    /what(?:'s| is)\s+([A-Z][a-z]+(?: [A-Z][a-z.]+)?)'s\s+(?:phone|email|number|address|contact)/i,
    // "get me John's contact" / "get John's email"
    /get(?:\s+me)?\s+([A-Z][a-z]+(?: [A-Z][a-z.]+)?)'s\s+(?:phone|email|number|contact|info)/i,
    // "contact info for John" / "contact details for John"
    /contact\s+(?:info|details?|number|email)\s+(?:for|of)\s+([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "find the contact Robert" / "find contact first name Wael" / "find contact named Robert"
    /\bfind\b(?:\s+(?:the|a|my))?\s+contact\s+(?:(?:with\s+)?(?:first|last)?\s*name\s+|named\s+)?([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "contact with name John" / "contact named John"
    /contact\s+(?:with\s+name|named)\s+([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    // "name is John" / "his name is John"
    /\bname\s+is\s+([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
  ];

  const stopwords = new Set([
    'the', 'a', 'an', 'my', 'me', 'him', 'her', 'them', 'us', 'it',
    'this', 'that', 'contact', 'person', 'someone', 'anyone', 'everybody',
    'the contact', 'a contact', 'my contact', 'contact with', 'contact for',
    'contact named', 'the person', 'a person', 'first name', 'last name',
    'first', 'last',
  ]);

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const name = match[1].trim();
      if (!stopwords.has(name.toLowerCase())) return name;
    }
  }

  return null;
}

// ─── Travel query extraction ──────────────────────────────────────────────────

/**
 * Detects if Robert is asking about travel time and extracts the destination.
 * Returns the destination string, or null if no travel intent found.
 */
export function extractTravelQuery(message: string): string | null {
  const lower = message.toLowerCase();

  // Must contain a travel-intent keyword
  const travelKeywords = [
    'how long', 'travel time', 'drive time', 'driving time',
    'travel distance', 'distance to', 'how far', 'directions to',
    'drive to', 'driving to', 'get to', 'going to', 'how much time',
    'when should i leave', 'what time should i leave', 'time to get',
    'time to drive', 'time to reach', 'google map', 'google maps',
    'open map', 'navigate to', 'add to map', 'show on map',
    'display on map', 'start navigation', 'route to', 'way to', 'far is',
  ];
  const hasTravelIntent = travelKeywords.some(k => lower.includes(k));
  if (!hasTravelIntent) return null;

  // Extract destination — everything after the last "to" that precedes a place name
  const patterns = [
    /\bto\s+((?:[A-Z][a-zA-Z\s,]+|[0-9]+[^?]+))(?:\?|$)/,   // "to Parliament Hill" / "to 100 Queen St"
    /\bfor\s+((?:[A-Z][a-zA-Z\s,]+))(?:\?|$)/i,              // "leave for X"
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const dest = match[1].trim().replace(/[?.!]+$/, '');
      if (dest.length > 2) return dest;
    }
  }

  // Fallback: grab everything after the last "to "
  const lastTo = message.lastIndexOf(' to ');
  if (lastTo !== -1) {
    const dest = message.slice(lastTo + 4).trim().replace(/[?.!]+$/, '');
    if (dest.length > 2) return dest;
  }

  return null;
}
