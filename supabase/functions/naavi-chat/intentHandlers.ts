/**
 * intentHandlers.ts — Deterministic intent handlers for Naavi
 *
 * Each handler takes verified inputs (from the intent classifier) and returns
 * a { speech, display, actions } object. Claude is never called — the answer
 * comes from a real data source (DB, Google API). Same result every time.
 *
 * Adding a new handler:
 *   1. Add the handler function here.
 *   2. Add the intent name to HANDLED_INTENTS below.
 *   3. Wire it in naavi-chat/index.ts Layer 2 router.
 *   4. Add a regression test in tests/catalogue/.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

export type HandlerResult = {
  speech: string;
  display: string;
  actions: unknown[];
};

// Intent names this module owns. Checked by the Layer 2 router.
export const HANDLED_INTENTS = new Set([
  'LIST_RULES',
  'LOOKUP_CONTACT',
  'CALENDAR_SEARCH',
  'PERSON_LOOKUP',
  'LIST_READ',
  'REMINDER_READ',
  'MEMORY_SEARCH',
]);

// ── LIST_RULES ────────────────────────────────────────────────────────────────
// Returns every active alert for the user, as a numbered list.
// Disabled rules are included with a "(disabled)" suffix so the user can
// see their full picture — mirrors what the alerts context in the prompt shows.

export async function handleListRules(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<HandlerResult> {
  const { data: rows, error } = await supabase
    .from('action_rules')
    .select('id, label, trigger_type, trigger_config, enabled, one_shot, last_fired_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[handleListRules] DB error:', error.message);
    return {
      speech: "I couldn't retrieve your alerts right now. Please try again.",
      display: "I couldn't retrieve your alerts right now. Please try again.",
      actions: [],
    };
  }

  const allRows = (rows ?? []) as Array<{
    id: string;
    label: string;
    trigger_type: string;
    trigger_config: Record<string, unknown> | null;
    enabled: boolean;
    one_shot: boolean;
    last_fired_at: string | null;
  }>;

  if (allRows.length === 0) {
    const empty = "You don't have any alerts set up yet. Say something like \"alert me when I arrive at Costco\" to create one.";
    return { speech: empty, display: empty, actions: [] };
  }

  const lines = allRows.map((r, i) => {
    const place = (r.trigger_config as any)?.place_name;
    const label = r.label || `${r.trigger_type} alert`;
    const where = place && !label.includes(place) ? ` (at ${place})` : '';
    const isExpired = r.one_shot && r.last_fired_at != null;
    const status = isExpired ? ' — expired' : (!r.enabled ? ' — disabled' : '');
    return `${i + 1}. ${label}${where}${status}`;
  });

  const intro = `You have ${allRows.length} alert${allRows.length === 1 ? '' : 's'}`;
  const speech  = `${intro}: ${lines.join('. ')}.`;
  const display = `${intro}:\n\n${lines.join('\n')}`;

  return { speech, display, actions: [] };
}

// ── LOOKUP_CONTACT ────────────────────────────────────────────────────────────
// Searches Google People API for the given name. Returns:
//   - 0 results → honest "not found"
//   - 1 result  → name + email/phone
//   - 2+ results → numbered disambiguation list (Robert picks)

export type ContactResult = {
  name: string;
  email: string;
  phone?: string;
  resourceName?: string;
};

export async function handleLookupContact(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  name: string,
): Promise<HandlerResult & { contacts?: ContactResult[] }> {
  const contacts = await _lookupContactsFromGoogle(supabase, userId, name);

  if (contacts.length === 0) {
    const msg = `I couldn't find anyone named "${name}" in your contacts.`;
    return { speech: msg, display: msg, actions: [], contacts: [] };
  }

  if (contacts.length === 1) {
    const c = contacts[0];
    const detail = c.email || c.phone || '';
    const msg = detail ? `${c.name} — ${detail}` : c.name;
    return { speech: msg, display: msg, actions: [], contacts };
  }

  // 2+ results — disambiguation. Naavi stops. Robert picks.
  const lines = contacts.slice(0, 5).map((c, i) => {
    const detail = c.email || c.phone || '';
    return `${i + 1}. ${c.name}${detail ? ` — ${detail}` : ''}`;
  });
  const intro = `I found ${contacts.length} contacts named "${name}". Which one?`;
  return {
    speech:  `${intro} ${lines.join('. ')}.`,
    display: `${intro}\n\n${lines.join('\n')}`,
    actions: [],
    contacts,
  };
}

async function _lookupContactsFromGoogle(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  name: string,
): Promise<ContactResult[]> {
  try {
    const { data: tokenRow } = await supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .maybeSingle();
    const refreshToken = (tokenRow as any)?.refresh_token;
    if (!refreshToken) return [];

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData?.access_token;
    if (!accessToken) return [];

    const url = new URL('https://people.googleapis.com/v1/people:searchContacts');
    url.searchParams.set('query', name.trim());
    url.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers');
    url.searchParams.set('pageSize', '5');

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];

    const data = await res.json();
    let results = (data?.results ?? []) as any[];

    if (results.length === 0) {
      const url2 = new URL('https://people.googleapis.com/v1/otherContacts:search');
      url2.searchParams.set('query', name.trim());
      url2.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers');
      url2.searchParams.set('pageSize', '5');
      const res2 = await fetch(url2.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res2.ok) results = ((await res2.json())?.results ?? []) as any[];
    }

    return results
      .map((r: any) => ({
        name:         r.person?.names?.[0]?.displayName ?? '',
        email:        r.person?.emailAddresses?.[0]?.value ?? '',
        phone:        r.person?.phoneNumbers?.[0]?.value ?? '',
        resourceName: r.person?.resourceName ?? '',
      }))
      .filter((c: ContactResult) => c.name);
  } catch (err) {
    console.error('[handleLookupContact] Google API error:', (err as Error)?.message);
    return [];
  }
}

// ── CALENDAR_SEARCH ───────────────────────────────────────────────────────────
// Filters the user's next-7-days calendar for events matching a keyword.
// Uses the same fetchLiveCalendarEvents helper the B6e bypass uses —
// imported as a parameter so this file has no circular dependency on index.ts.

export type CalendarItem = {
  id?: string;
  category?: string;
  title?: string;
  detail?: string;
};

// Words that are too generic to use as search terms — strip them before
// word-level matching so "family doctor appointment" finds "Family Doctor".
const CALENDAR_STOP_WORDS = new Set([
  'appointment', 'appointments', 'meeting', 'meetings', 'event', 'events',
  'schedule', 'scheduled', 'time', 'session', 'visit', 'do', 'i', 'have',
  'a', 'an', 'the', 'my', 'any', 'is', 'there', 'find', 'show', 'get',
]);

export async function handleCalendarSearch(
  liveEvents: CalendarItem[],
  keyword: string,
): Promise<HandlerResult> {
  const kw = keyword.trim().toLowerCase();

  // Split keyword into meaningful words, drop stop words.
  // Then match an event if ANY search word appears in its title or detail.
  // This handles "family doctor" → finds "Family Doctor" or "Dr. Smith".
  const searchWords = kw
    .split(/\s+/)
    .filter(w => w.length >= 2 && !CALENDAR_STOP_WORDS.has(w));

  const matchEvent = (e: CalendarItem): boolean => {
    const haystack = `${(e.title ?? '').toLowerCase()} ${(e.detail ?? '').toLowerCase()}`;
    // Full phrase match first (most precise).
    if (haystack.includes(kw)) return true;
    // Word-level OR match: any search word present.
    return searchWords.length > 0 && searchWords.some(w => haystack.includes(w));
  };

  const matched = liveEvents.filter(matchEvent);

  if (matched.length === 0) {
    const msg = `I don't see anything matching "${keyword}" on your calendar in the next 7 days.`;
    return { speech: msg, display: msg, actions: [] };
  }

  const lines = matched.map((e, i) => {
    const title  = (e.title ?? 'Event').trim();
    const detail = (e.detail ?? '').trim();
    return {
      speech:  detail ? `${i + 1}. ${title}, ${detail}` : `${i + 1}. ${title}`,
      display: detail ? `${i + 1}. **${title}** — ${detail}` : `${i + 1}. **${title}**`,
    };
  });

  const intro = matched.length === 1
    ? `Yes — here's what I found for "${keyword}"`
    : `I found ${matched.length} events matching "${keyword}"`;

  return {
    speech:  `${intro}. ${lines.map(l => l.speech).join('. ')}.`,
    display: `${intro}:\n\n${lines.map(l => l.display).join('\n')}`,
    actions: [],
  };
}

// ── PERSON_LOOKUP ─────────────────────────────────────────────────────────────
// "What do we have about Hussein?" — calls global-search with the entity name
// and formats the ranked results. Always fetches from real sources regardless
// of conversation context, so the answer is the same every time.
//
// supabaseUrl + serviceKey are passed in from index.ts so this file stays
// free of Deno.env reads (easier to test).

export async function handlePersonLookup(
  query: string,
  userId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<HandlerResult> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/global-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query, user_id: userId, limit: 10 }),
    });

    if (!res.ok) {
      console.warn('[handlePersonLookup] global-search returned', res.status);
      const msg = `I couldn't search your records right now. Please try again.`;
      return { speech: msg, display: msg, actions: [] };
    }

    const data = await res.json();
    const ranked: Array<{ title: string; snippet: string; source: string; label: string }> =
      Array.isArray(data?.ranked) ? data.ranked : [];

    if (ranked.length === 0) {
      const msg = `I didn't find anything about "${query}" in your contacts, calendar, emails, or saved memories.`;
      return { speech: msg, display: msg, actions: [] };
    }

    // Group by source for a readable summary.
    const bySource = new Map<string, string[]>();
    for (const r of ranked.slice(0, 8)) {
      const src = r.label || r.source || 'Records';
      if (!bySource.has(src)) bySource.set(src, []);
      const detail = r.snippet
        ? `${r.title} — ${r.snippet.slice(0, 80)}`
        : r.title;
      bySource.get(src)!.push(detail);
    }

    const sections = [...bySource.entries()].map(([src, items]) => ({
      src,
      speech:  `${src}: ${items.join(', ')}`,
      display: `**${src}**\n${items.map(i => `- ${i}`).join('\n')}`,
    }));

    const intro = `Here's what I found about "${query}"`;
    return {
      speech:  `${intro}. ${sections.map(s => s.speech).join('. ')}.`,
      display: `${intro}:\n\n${sections.map(s => s.display).join('\n\n')}`,
      actions: [],
    };
  } catch (err) {
    console.error('[handlePersonLookup] error:', (err as Error)?.message);
    const msg = `I couldn't search your records right now. Please try again.`;
    return { speech: msg, display: msg, actions: [] };
  }
}

// ── LIST_READ ─────────────────────────────────────────────────────────────────
// "What lists do I have?" / "What's on my grocery list?" — reads the lists table
// and optionally fetches items from the named list. Always from the DB; never guesses.

export async function handleListRead(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  listName?: string,
): Promise<HandlerResult> {
  try {
    if (listName) {
      // User asked about a specific list — fetch its items
      const kw = listName.trim().toLowerCase();
      const { data: lists } = await supabase
        .from('lists')
        .select('id, name, items')
        .eq('user_id', userId);

      const match = (lists ?? []).find((l: any) =>
        (l.name ?? '').toLowerCase().includes(kw)
      );

      if (!match) {
        const msg = `I don't see a list called "${listName}". Say "what lists do I have" to see your full list.`;
        return { speech: msg, display: msg, actions: [] };
      }

      const items: string[] = Array.isArray(match.items) ? match.items : [];
      if (items.length === 0) {
        const msg = `Your ${match.name} list is empty.`;
        return { speech: msg, display: msg, actions: [] };
      }

      const lines = items.map((it: string, i: number) => `${i + 1}. ${it}`);
      const intro = `Your ${match.name} list has ${items.length} item${items.length === 1 ? '' : 's'}`;
      return {
        speech:  `${intro}: ${lines.join('. ')}.`,
        display: `${intro}:\n\n${lines.join('\n')}`,
        actions: [],
      };
    }

    // No specific list — return all list names
    const { data: rows, error } = await supabase
      .from('lists')
      .select('name, items')
      .eq('user_id', userId)
      .order('name', { ascending: true });

    if (error) {
      console.error('[handleListRead] DB error:', error.message);
      const msg = `I couldn't retrieve your lists right now. Please try again.`;
      return { speech: msg, display: msg, actions: [] };
    }

    const allLists = (rows ?? []) as Array<{ name: string; items: unknown[] }>;
    if (allLists.length === 0) {
      const msg = `You don't have any lists yet. Say "create a grocery list" to start one.`;
      return { speech: msg, display: msg, actions: [] };
    }

    const lines = allLists.map((l, i) => {
      const count = Array.isArray(l.items) ? l.items.length : 0;
      return `${i + 1}. ${l.name} (${count} item${count === 1 ? '' : 's'})`;
    });
    const intro = `You have ${allLists.length} list${allLists.length === 1 ? '' : 's'}`;
    return {
      speech:  `${intro}: ${lines.join('. ')}.`,
      display: `${intro}:\n\n${lines.join('\n')}`,
      actions: [],
    };
  } catch (err) {
    console.error('[handleListRead] error:', (err as Error)?.message);
    const msg = `I couldn't retrieve your lists right now. Please try again.`;
    return { speech: msg, display: msg, actions: [] };
  }
}

// ── REMINDER_READ ─────────────────────────────────────────────────────────────
// "What reminders do I have?" — reads upcoming (unfired) reminders from the DB.
// Returns a chronological list. Always from the DB; never guesses.

export async function handleReminderRead(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<HandlerResult> {
  try {
    const now = new Date().toISOString();
    const { data: rows, error } = await supabase
      .from('reminders')
      .select('id, title, datetime, is_priority')
      .eq('user_id', userId)
      .eq('fired', false)
      .gte('datetime', now)
      .order('datetime', { ascending: true })
      .limit(20);

    if (error) {
      console.error('[handleReminderRead] DB error:', error.message);
      const msg = `I couldn't retrieve your reminders right now. Please try again.`;
      return { speech: msg, display: msg, actions: [] };
    }

    const reminders = (rows ?? []) as Array<{
      id: string; title: string; datetime: string; is_priority: boolean;
    }>;

    if (reminders.length === 0) {
      const msg = `You don't have any upcoming reminders.`;
      return { speech: msg, display: msg, actions: [] };
    }

    const lines = reminders.map((r, i) => {
      const dt = new Date(r.datetime);
      const label = dt.toLocaleString('en-CA', {
        timeZone: 'America/Toronto',
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
      const priority = r.is_priority ? ' ⚡' : '';
      return {
        speech:  `${i + 1}. ${r.title}, ${label}${priority}`,
        display: `${i + 1}. **${r.title}** — ${label}${priority}`,
      };
    });

    const intro = `You have ${reminders.length} upcoming reminder${reminders.length === 1 ? '' : 's'}`;
    return {
      speech:  `${intro}: ${lines.map(l => l.speech).join('. ')}.`,
      display: `${intro}:\n\n${lines.map(l => l.display).join('\n')}`,
      actions: [],
    };
  } catch (err) {
    console.error('[handleReminderRead] error:', (err as Error)?.message);
    const msg = `I couldn't retrieve your reminders right now. Please try again.`;
    return { speech: msg, display: msg, actions: [] };
  }
}

// ── MEMORY_SEARCH ─────────────────────────────────────────────────────────────
// "What did I tell you about X?" / "What do you remember about X?" —
// searches knowledge_fragments via global-search (which uses pgvector embeddings).
// Routes through global-search rather than querying directly so the same
// ranking logic applies as in PERSON_LOOKUP.

export async function handleMemorySearch(
  query: string,
  userId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<HandlerResult> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/global-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query, user_id: userId, limit: 8, sources: ['knowledge'] }),
    });

    if (!res.ok) {
      const msg = `I couldn't search your memories right now. Please try again.`;
      return { speech: msg, display: msg, actions: [] };
    }

    const data = await res.json();
    const ranked: Array<{ title: string; snippet: string }> =
      Array.isArray(data?.ranked) ? data.ranked : [];

    if (ranked.length === 0) {
      const msg = `I don't have anything saved about "${query}". Say "remember that…" to save something.`;
      return { speech: msg, display: msg, actions: [] };
    }

    const lines = ranked.slice(0, 6).map((r, i) => {
      const detail = r.snippet ? r.snippet.slice(0, 100) : r.title;
      return {
        speech:  `${i + 1}. ${detail}`,
        display: `${i + 1}. ${detail}`,
      };
    });

    const intro = `Here's what I have saved about "${query}"`;
    return {
      speech:  `${intro}: ${lines.map(l => l.speech).join('. ')}.`,
      display: `${intro}:\n\n${lines.map(l => l.display).join('\n')}`,
      actions: [],
    };
  } catch (err) {
    console.error('[handleMemorySearch] error:', (err as Error)?.message);
    const msg = `I couldn't search your memories right now. Please try again.`;
    return { speech: msg, display: msg, actions: [] };
  }
}
