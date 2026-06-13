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
  'GMAIL_SEARCH',
  'PERSON_LOOKUP',
  'LIST_READ',
  'REMINDER_READ',
  'MEMORY_SEARCH',
  'CREATE_TICKET',
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
    .eq('enabled', true)
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

  const active = allRows.filter(r => !(r.one_shot && r.last_fired_at != null));

  if (active.length === 0) {
    const empty = "You don't have any active alerts right now.";
    return { speech: empty, display: empty, actions: [] };
  }

  const lines = active.map((r, i) => {
    const place = (r.trigger_config as any)?.place_name;
    const label = r.label || `${r.trigger_type} alert`;
    const where = place && !label.includes(place) ? ` (at ${place})` : '';
    return `${i + 1}. ${label}${where}`;
  });

  const intro = `You have ${active.length} active alert${active.length === 1 ? '' : 's'}`;
  return {
    speech:  `${intro}: ${lines.join('. ')}.`,
    display: `${intro}:\n\n${lines.join('\n')}`,
    actions: [],
  };
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

    // searchContacts does not reliably return phoneNumbers — fetch full records via batchGet.
    const resourceNames = results.map((r: any) => r.person?.resourceName).filter(Boolean);
    const fullPersonMap: Record<string, any> = {};
    if (resourceNames.length > 0) {
      try {
        const batchUrl = new URL('https://people.googleapis.com/v1/people:batchGet');
        for (const rn of resourceNames) batchUrl.searchParams.append('resourceNames', rn);
        batchUrl.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers');
        const batchRes = await fetch(batchUrl.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
        if (batchRes.ok) {
          const batchData = await batchRes.json();
          for (const entry of batchData.responses ?? []) {
            const p = entry.person;
            if (p?.resourceName) fullPersonMap[p.resourceName] = p;
          }
        }
      } catch (e) { /* fall back to searchContacts data */ }
    }

    return results
      .map((r: any) => {
        const rn = r.person?.resourceName ?? '';
        const person = fullPersonMap[rn] ?? r.person ?? {};
        return {
          name:         person.names?.[0]?.displayName ?? '',
          email:        person.emailAddresses?.[0]?.value ?? '',
          phone:        person.phoneNumbers?.[0]?.value ?? '',
          resourceName: rn,
        };
      })
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

// ── GMAIL_SEARCH ──────────────────────────────────────────────────────────────
// "Did I receive email from Bob?" — calls global-search gmail adapter and
// returns whether matching emails exist. Deterministic: same query → same
// real-data answer. Never routes to calendar.

export async function handleGmailSearch(
  keyword: string,
  userId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<HandlerResult> {
  // Trigger sync-gmail first so the answer reflects the current inbox, not just
  // what was cached at the last cron run. Fire-and-await with 6s cap — if it
  // times out we still search whatever is in the cache.
  try {
    const syncCtrl = new AbortController();
    const syncTimer = setTimeout(() => syncCtrl.abort(), 6000);
    await fetch(`${supabaseUrl}/functions/v1/sync-gmail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ user_id: userId }),
      signal: syncCtrl.signal,
    });
    clearTimeout(syncTimer);
  } catch (_) { /* non-fatal — proceed with cached data */ }

  // Trash cleanup: remove any stale DB rows whose messages the user has deleted.
  // Done here (not in sync-gmail) because the 6s sync timeout may expire before
  // the cleanup step runs, leaving old trashed emails in the DB.
  try {
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: tokenRow } = await adminClient
      .from('user_tokens')
      .select('access_token, refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .single();
    if (tokenRow?.access_token) {
      const cutoff = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
      const trashUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
      trashUrl.searchParams.set('maxResults', '100');
      trashUrl.searchParams.set('q', `in:trash after:${cutoff}`);
      const trashRes = await fetch(trashUrl.toString(), {
        headers: { Authorization: `Bearer ${tokenRow.access_token}` },
      });
      if (trashRes.ok) {
        const trashData = await trashRes.json();
        const trashIds: string[] = (trashData.messages ?? []).map((m: { id: string }) => m.id);
        if (trashIds.length > 0) {
          await adminClient.from('gmail_messages')
            .delete()
            .eq('user_id', userId)
            .in('gmail_message_id', trashIds);
        }
      }
    }
  } catch (e) {
    console.warn('[handleGmailSearch] trash cleanup failed:', e);
  }

  // Direct DB query without signal_strength filter — explicit user queries should
  // search ALL emails (including 'ambient' senders not yet in contacts).
  // The global-search gmail adapter excludes ambient emails; that filter is right
  // for automatic triage but wrong when the user directly asks about an email.
  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const kw = keyword.trim().toLowerCase();

    // Temporal/generic words ("new", "any", "recent", "latest", "email") are not
    // content keywords — they mean "show me what arrived recently." In that case
    // return the latest emails unfiltered instead of searching for those words.
    const GENERIC_KEYWORDS = new Set(['new', 'any', 'recent', 'latest', 'email', 'emails', 'mail', '']);
    const isGeneric = GENERIC_KEYWORDS.has(kw);

    let query = supabase
      .from('gmail_messages')
      .select('id, subject, sender_name, sender_email, snippet, received_at')
      .eq('user_id', userId)
      .not('labels', 'cs', '{"TRASH"}')
      .order('received_at', { ascending: false })
      .limit(5);

    if (!isGeneric) {
      const pat = `%${kw}%`;
      query = query.or([
        `subject.ilike.${pat}`,
        `sender_name.ilike.${pat}`,
        `sender_email.ilike.${pat}`,
        `snippet.ilike.${pat}`,
        `body_text.ilike.${pat}`,
      ].join(','));
    }

    const { data, error } = await query;

    if (error) {
      console.error('[handleGmailSearch] DB error:', error.message);
      const msg = `I had trouble checking your email. Try again in a moment.`;
      return { speech: msg, display: msg, actions: [] };
    }

    const rows = data ?? [];

    if (rows.length === 0) {
      const msg = isGeneric
        ? `I don't see any recent emails in your synced inbox. If something just arrived, it may not have synced yet.`
        : `I don't see any emails matching "${keyword}" in your synced inbox. If it just arrived, it may not have synced yet.`;
      return { speech: msg, display: msg, actions: [] };
    }

    const lines = rows.slice(0, 3).map((r: any, i: number) => {
      const subject = r.subject ?? 'Email';
      const sender  = r.sender_name ?? r.sender_email ?? '';
      const when    = r.received_at
        ? new Date(r.received_at).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
        : '';
      const detail  = [sender, when].filter(Boolean).join(', ');
      return {
        speech:  detail ? `${i + 1}. ${subject} from ${detail}` : `${i + 1}. ${subject}`,
        display: detail ? `${i + 1}. **${subject}** — ${detail}` : `${i + 1}. **${subject}**`,
      };
    });

    const intro = isGeneric
      ? (rows.length === 1 ? `Yes, you have 1 new email` : `Yes, you have ${rows.length} recent emails`)
      : (rows.length === 1 ? `Yes, you have an email matching "${keyword}"` : `Yes, you have ${rows.length} emails matching "${keyword}"`);

    return {
      speech:  `${intro}. ${lines.map(l => l.speech).join('. ')}.`,
      display: `${intro}:\n\n${lines.map(l => l.display).join('\n')}`,
      actions: [],
    };
  } catch (e) {
    console.error('[handleGmailSearch] error:', (e as Error).message);
    const msg = `I had trouble checking your email. Try again in a moment.`;
    return { speech: msg, display: msg, actions: [] };
  }
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
        .select('id, name')
        .eq('user_id', userId)
        .eq('enabled', true);

      const match = (lists ?? []).find((l: any) =>
        (l.name ?? '').toLowerCase().includes(kw)
      );

      if (!match) {
        const msg = `I don't see an active list called "${listName}". Say "what lists do I have" to see your lists.`;
        return { speech: msg, display: msg, actions: [] };
      }

      // Items live in the Drive file — tell the user the list exists and how to see it
      const msg = `You have a list called ${match.name}. Open your lists from the menu to see its contents.`;
      return { speech: msg, display: msg, actions: [] };
    }

    // No specific list — return active list names only
    const { data: rows, error } = await supabase
      .from('lists')
      .select('name, category')
      .eq('user_id', userId)
      .eq('enabled', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('[handleListRead] DB error:', error.message);
      const msg = `I couldn't retrieve your lists right now. Please try again.`;
      return { speech: msg, display: msg, actions: [] };
    }

    const allLists = (rows ?? []) as Array<{ name: string; category?: string }>;
    if (allLists.length === 0) {
      const msg = `You don't have any active lists right now.`;
      return { speech: msg, display: msg, actions: [] };
    }

    const lines = allLists.map((l, i) => `${i + 1}. ${l.name}`);
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
// searches ONLY knowledge_fragments via the search-knowledge Edge Function
// (OpenAI embedding + pgvector cosine similarity, min score 0.5).
// Deliberately narrow: no emails, no calendar, no contacts — only what
// Robert explicitly told Naavi to remember.

export async function handleMemorySearch(
  query: string,
  userId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<HandlerResult> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/search-knowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ q: query, user_id: userId, top_k: 6 }),
    });

    if (!res.ok) {
      const msg = `I couldn't search your memories right now. Please try again.`;
      return { speech: msg, display: msg, actions: [] };
    }

    const data = await res.json();
    const results: Array<{ content: string; similarity?: number }> =
      Array.isArray(data?.results) ? data.results : [];

    if (results.length === 0) {
      const msg = `I don't have anything saved about "${query}". Say "remember that…" to save something.`;
      return { speech: msg, display: msg, actions: [] };
    }

    const lines = results.slice(0, 6).map((r, i) => {
      const text = (r.content ?? '').slice(0, 120);
      return {
        speech:  `${i + 1}. ${text}`,
        display: `${i + 1}. ${text}`,
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

// ── CREATE_TICKET ─────────────────────────────────────────────────────────────
// Staff-only: creates a support ticket on behalf of a user via internal-relay.
// Called on turn 2 after staff confirmed the ticket details.
// Turn 1 (confirmation ask) is handled inline in naavi-chat/index.ts.

export async function handleCreateTicket(
  params: { reporter_email: string; body: string; staff_email: string },
  supabaseUrl: string,
  serviceKey: string,
): Promise<HandlerResult> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/ingest-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        source_channel: 'internal-relay',
        reporter_email: params.reporter_email,
        body:           params.body,
        subject:        params.body.slice(0, 80),
        created_by:     params.staff_email,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = `I couldn't create the ticket. ${(err as any).error ?? res.status}`;
      return { speech: msg, display: msg, actions: [] };
    }

    const data = await res.json() as { ticket_number: number };
    const msg = `Done. Ticket #${data.ticket_number} created for ${params.reporter_email}.`;
    return { speech: msg, display: msg, actions: [] };
  } catch (err) {
    console.error('[handleCreateTicket] error:', (err as Error)?.message);
    const msg = `I couldn't create the ticket right now. Please try again.`;
    return { speech: msg, display: msg, actions: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION HANDLERS — deterministic writes (Turn 2 execution after user confirms)
//
// Pattern (see ARCH-1 / project_naavi_deterministic_design.md):
//   Turn 1 — Level action routing in index.ts validates params, generates
//             templated confirm speech, embeds PENDING_INTENT marker.
//   Turn 2 — Step 1.4 resolver sees "yes" + PENDING_INTENT, calls the matching
//             handler below to execute deterministically. No Claude call on
//             either turn.
//
// Same params → same result every time. This is the fix for LLM variability.
// ─────────────────────────────────────────────────────────────────────────────

export const HANDLED_ACTION_INTENTS = new Set([
  'SET_REMINDER',
  'CREATE_EVENT',
  'REMEMBER',
  'DELETE_RULE',
  'DELETE_MEMORY',
  'ADD_CONTACT',
  'DELETE_EVENT',
  'DRAFT_MESSAGE',
  'SET_ACTION_RULE',
]);

// Format ISO datetime to human-readable EST string.
function fmtDatetime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// Correct naive datetimes (no TZ suffix) to America/Toronto offset.
// Mirrors lib/supabase.ts::saveReminder — keeps behaviour consistent.
export function correctDatetime(raw: string): string {
  if (!raw || /[Zz]|[+-]\d{2}:\d{2}$/.test(raw)) return raw;
  try {
    const datePart = raw.includes('T') ? raw.split('T')[0] : raw;
    const timePart = raw.includes('T') ? raw.split('T')[1] : '00:00:00';
    const testDate = new Date(`${datePart}T12:00:00Z`);
    const offset   = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto', timeZoneName: 'shortOffset',
    }).formatToParts(testDate).find(p => p.type === 'timeZoneName')?.value ?? 'GMT-4';
    const sign  = offset.includes('-') ? '-' : '+';
    const hours = offset.replace('GMT', '').replace(/[+-]/, '').padStart(2, '0');
    return `${datePart}T${timePart}${sign}${hours}:00`;
  } catch {
    return raw;
  }
}

// ── SET_REMINDER (exec) ───────────────────────────────────────────────────────
export async function handleSetReminderExec(
  params: { title: string; datetime: string },
  userId: string,
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
): Promise<HandlerResult> {
  const { data: settingsRow } = await supabase
    .from('user_settings')
    .select('phone')
    .eq('user_id', userId)
    .maybeSingle();
  const phoneNumber = (settingsRow as any)?.phone ?? null;

  const safeDateTime = correctDatetime(params.datetime);

  const { error } = await supabase.from('reminders').insert({
    user_id:      userId,
    title:        params.title,
    datetime:     safeDateTime,
    source:       'chat',
    phone_number: phoneNumber,
    fired:        false,
    is_priority:  false,
  });

  if (error) {
    console.error('[handleSetReminderExec] DB error:', error.message);
    const msg = `I couldn't save that reminder. Please try again.`;
    return { speech: msg, display: msg, actions: [] };
  }

  try {
    const end = new Date(new Date(safeDateTime).getTime() + 15 * 60000).toISOString();
    await fetch(`${supabaseUrl}/functions/v1/create-calendar-event`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body:    JSON.stringify({ summary: params.title, description: params.title, start: safeDateTime, end, attendees: [], user_id: userId, suppress_reminders: true }),
    });
  } catch (e) {
    console.warn('[handleSetReminderExec] calendar event failed (non-fatal):', (e as Error).message);
  }

  const label = fmtDatetime(safeDateTime);
  const msg   = `Done. Reminder set: ${params.title} on ${label}.`;
  return { speech: msg, display: msg, actions: [] };
}

// ── CREATE_EVENT (exec) ───────────────────────────────────────────────────────
export async function handleCreateEventExec(
  params: { summary: string; start: string; end?: string; description?: string },
  userId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<HandlerResult> {
  const safeStart = correctDatetime(params.start);
  const safeEnd   = params.end
    ? correctDatetime(params.end)
    : new Date(new Date(safeStart).getTime() + 60 * 60000).toISOString();

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/create-calendar-event`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body:    JSON.stringify({ summary: params.summary, description: params.description ?? '', start: safeStart, end: safeEnd, attendees: [], user_id: userId }),
    });
    if (!res.ok) {
      console.error('[handleCreateEventExec] create-calendar-event HTTP', res.status);
      const msg = `I couldn't add that to your calendar. Please try again.`;
      return { speech: msg, display: msg, actions: [] };
    }
    const label = fmtDatetime(safeStart);
    const msg   = `Done. Added "${params.summary}" to your calendar on ${label}.`;
    return { speech: msg, display: msg, actions: [] };
  } catch (e) {
    console.error('[handleCreateEventExec] error:', (e as Error).message);
    const msg = `I couldn't add that to your calendar. Please try again.`;
    return { speech: msg, display: msg, actions: [] };
  }
}

// ── REMEMBER (exec) ───────────────────────────────────────────────────────────
export async function handleRememberExec(
  params: { text: string },
  userId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<HandlerResult> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/ingest-note`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body:    JSON.stringify({ text: params.text, source: 'chat', user_id: userId }),
    });
    if (!res.ok) {
      console.error('[handleRememberExec] ingest-note HTTP', res.status);
      const msg = `I couldn't save that. Please try again.`;
      return { speech: msg, display: msg, actions: [] };
    }
    const snippet = params.text.slice(0, 80);
    const msg = `Got it. I've saved: "${snippet}"`;
    return { speech: msg, display: msg, actions: [] };
  } catch (e) {
    console.error('[handleRememberExec] error:', (e as Error).message);
    const msg = `I couldn't save that. Please try again.`;
    return { speech: msg, display: msg, actions: [] };
  }
}

// ── DELETE_RULE (exec) ────────────────────────────────────────────────────────
export async function handleDeleteRuleExec(
  params: { match: string; all?: string },
  userId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<HandlerResult> {
  try {
    const listRes = await fetch(`${supabaseUrl}/functions/v1/manage-rules`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body:    JSON.stringify({ op: 'list', user_id: userId }),
    });
    if (!listRes.ok) throw new Error(`manage-rules list ${listRes.status}`);
    const listData = await listRes.json();
    const allRules: Array<Record<string, any>> = Array.isArray((listData as any)?.rules) ? (listData as any).rules : [];

    const deleteAll = params.all === 'true';
    const match     = (params.match ?? '').trim().toLowerCase();
    const needles   = match ? match.split(/\s+/).filter(Boolean) : [];
    const haystackFor = (r: Record<string, any>) => {
      const parts: string[] = [r.trigger_type ?? '', r.label ?? ''];
      for (const v of Object.values(r.trigger_config ?? {})) if (v != null) parts.push(String(v));
      for (const v of Object.values(r.action_config ?? {})) if (v != null) parts.push(String(v));
      return parts.join(' ').toLowerCase();
    };
    const matched = deleteAll
      ? allRules
      : allRules.filter(r => needles.length === 0 || needles.every(n => haystackFor(r).includes(n)));

    if (matched.length === 0) {
      const msg = `I couldn't find an alert matching "${match}".`;
      return { speech: msg, display: msg, actions: [] };
    }

    if (matched.length > 1 && !deleteAll) {
      const lines = matched.slice(0, 5).map((r, i) => `${i + 1}. ${r.label || r.trigger_type}`);
      const intro = `I found ${matched.length} alerts matching "${match}". Which one?`;
      return {
        speech:  `${intro} ${lines.join('. ')}.`,
        display: `${intro}\n\n${lines.join('\n')}`,
        actions: [],
      };
    }

    let deleted = 0;
    for (const r of matched) {
      const delRes = await fetch(`${supabaseUrl}/functions/v1/manage-rules`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body:    JSON.stringify({ op: 'delete', user_id: userId, rule_id: r.id }),
      });
      if ((delRes as any).ok) deleted++;
      else console.warn('[handleDeleteRuleExec] delete failed for rule:', r.id);
    }

    const msg = deleted > 1
      ? `Done — deleted ${deleted} alerts.`
      : `Done. Alert deleted: ${matched[0]?.label ?? 'that alert'}.`;
    return { speech: msg, display: msg, actions: [] };
  } catch (e) {
    console.error('[handleDeleteRuleExec] error:', (e as Error).message);
    const msg = `I couldn't delete that alert. Please try again.`;
    return { speech: msg, display: msg, actions: [] };
  }
}

// ── DELETE_MEMORY (exec) ──────────────────────────────────────────────────────
export async function handleDeleteMemoryExec(
  params: { keyword: string },
  userId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<HandlerResult> {
  const kw = (params.keyword ?? '').trim().toLowerCase();
  const { data: rows, error: selectErr } = await supabase
    .from('knowledge_fragments')
    .select('id, content')
    .eq('user_id', userId)
    .ilike('content', `%${kw}%`)
    .limit(20);

  if (selectErr) {
    console.error('[handleDeleteMemoryExec] select error:', selectErr.message);
    const msg = `I couldn't search your memories right now. Please try again.`;
    return { speech: msg, display: msg, actions: [] };
  }

  const matches = (rows ?? []) as Array<{ id: string; content: string }>;
  if (matches.length === 0) {
    const msg = `I don't have anything saved about "${params.keyword}".`;
    return { speech: msg, display: msg, actions: [] };
  }

  const ids = matches.map(r => r.id);
  const { error: delErr } = await supabase
    .from('knowledge_fragments')
    .delete()
    .in('id', ids)
    .eq('user_id', userId);

  if (delErr) {
    console.error('[handleDeleteMemoryExec] delete error:', delErr.message);
    const msg = `I couldn't remove that memory. Please try again.`;
    return { speech: msg, display: msg, actions: [] };
  }

  const msg = matches.length > 1
    ? `Done. I've forgotten ${matches.length} items about "${params.keyword}".`
    : `Done. I've forgotten that.`;
  return { speech: msg, display: msg, actions: [] };
}

// ── ADD_CONTACT (exec) ────────────────────────────────────────────────────────
export async function handleAddContactExec(
  params: { name: string; phone?: string; email?: string },
  userId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<HandlerResult> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/create-contact`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body:    JSON.stringify({ name: params.name, phone: params.phone ?? '', email: params.email ?? '', user_id: userId }),
    });
    if (!res.ok) {
      console.error('[handleAddContactExec] create-contact HTTP', res.status);
      const msg = `I couldn't add that contact. Please try again.`;
      return { speech: msg, display: msg, actions: [] };
    }
    const detail = [params.phone, params.email].filter(Boolean).join(', ');
    const msg = detail
      ? `Done. Added ${params.name} (${detail}) to your contacts.`
      : `Done. Added ${params.name} to your contacts.`;
    return { speech: msg, display: msg, actions: [] };
  } catch (e) {
    console.error('[handleAddContactExec] error:', (e as Error).message);
    const msg = `I couldn't add that contact. Please try again.`;
    return { speech: msg, display: msg, actions: [] };
  }
}

// ── DELETE_EVENT (exec) ───────────────────────────────────────────────────────
export async function handleDeleteEventExec(
  params: { query: string },
  userId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<HandlerResult> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/delete-calendar-event`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body:    JSON.stringify({ query: params.query, user_id: userId }),
    });
    if (!res.ok) {
      console.error('[handleDeleteEventExec] delete-calendar-event HTTP', res.status);
      const msg = `I couldn't delete that event. Please try again.`;
      return { speech: msg, display: msg, actions: [] };
    }
    const data = await res.json() as { deleted?: number };
    const count = (data as any)?.deleted ?? 1;
    const msg = count > 1
      ? `Done. Deleted ${count} calendar events matching "${params.query}".`
      : `Done. Deleted "${params.query}" from your calendar.`;
    return { speech: msg, display: msg, actions: [] };
  } catch (e) {
    console.error('[handleDeleteEventExec] error:', (e as Error).message);
    const msg = `I couldn't delete that event. Please try again.`;
    return { speech: msg, display: msg, actions: [] };
  }
}
