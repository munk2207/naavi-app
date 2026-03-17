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
}

interface CalendarEntry {
  title: string;
  date: string;
  time?: string;
}

// ─── Person lookup ────────────────────────────────────────────────────────────

export async function getPersonContext(name: string): Promise<PersonContext | null> {
  if (!supabase) return null;

  const nameLower = name.toLowerCase();

  // Search contacts table
  const { data: contacts } = await supabase
    .from('contacts')
    .select('*')
    .ilike('name', `%${nameLower}%`)
    .limit(1);

  // Search people table
  const { data: people } = await supabase
    .from('people')
    .select('*')
    .ilike('name', `%${nameLower}%`)
    .limit(1);

  // Search interactions
  const { data: interactions } = await supabase
    .from('interactions')
    .select('*')
    .ilike('person_name', `%${nameLower}%`)
    .order('interaction_date', { ascending: false })
    .limit(20);

  // Search topics/notes about this person
  const { data: topics } = await supabase
    .from('topics')
    .select('*')
    .ilike('subject', `%${nameLower}%`)
    .order('created_at', { ascending: false })
    .limit(10);

  // Fetch Google Calendar events mentioning this person
  const calendarEvents = await getCalendarEventsForPerson(name);

  const contact = contacts?.[0] ?? people?.[0];

  // Nothing found at all
  if (!contact && (!interactions || interactions.length === 0) && calendarEvents.length === 0 && (!topics || topics.length === 0)) {
    return null;
  }

  const now = new Date();

  const upcoming = calendarEvents.filter(e => new Date(e.date) >= now);
  const past = calendarEvents.filter(e => new Date(e.date) < now);

  return {
    name: contact?.name ?? name,
    relationship: contact?.relationship,
    email: contact?.email,
    phone: contact?.phone,
    notes: contact?.notes ?? people?.[0]?.notes,
    lastContactDate: contact?.last_contact_date,
    upcomingMeetings: upcoming,
    pastMeetings: past,
    savedNotes: topics?.map((t: { note: string }) => t.note) ?? [],
  };
}

// ─── Calendar search ──────────────────────────────────────────────────────────

async function getCalendarEventsForPerson(name: string): Promise<CalendarEntry[]> {
  if (!supabase) return [];

  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.provider_token;
  if (!accessToken) return [];

  // Search past 6 months + next 3 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const threeMonthsAhead = new Date();
  threeMonthsAhead.setMonth(threeMonthsAhead.getMonth() + 3);

  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
      `?maxResults=50&orderBy=startTime&singleEvents=true` +
      `&q=${encodeURIComponent(name)}` +
      `&timeMin=${encodeURIComponent(sixMonthsAgo.toISOString())}` +
      `&timeMax=${encodeURIComponent(threeMonthsAhead.toISOString())}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!res.ok) return [];

    const data = await res.json();
    const events = data.items ?? [];

    return events.map((event: { summary?: string; start?: { dateTime?: string; date?: string } }) => {
      const startRaw = event.start?.dateTime ?? event.start?.date ?? '';
      const date = new Date(startRaw);
      return {
        title: event.summary ?? 'Meeting',
        date: startRaw,
        time: event.start?.dateTime
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
    /what(?:'s| is| do you have) (?:on|about) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    /tell me about ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    /give me (?:everything|what you have|all) (?:on|about) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    /(?:status|update) (?:on|with|for) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
    /(?:meetings?|notes?|history) (?:with|for|on) ([A-Z][a-z]+(?: [A-Z][a-z.]+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return match[1];
  }

  return null;
}
