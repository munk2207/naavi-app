/**
 * assistant-fulfillment Edge Function
 *
 * Called by the three Google Assistant App Action deep link screens.
 * Accepts: { intent: 'brief' | 'calendar' | 'contacts', date?: string, name?: string }
 * Returns: { ssml: string, plainText: string }
 *
 * Auth: RLS-based (verify_jwt = false in config.toml; manual auth check inside).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PEOPLE_API       = 'https://people.googleapis.com/v1/people:searchContacts';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getGoogleAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function wrap(text: string): { ssml: string; plainText: string } {
  return { ssml: `<speak>${text}</speak>`, plainText: text };
}

// Strip "<addr@x.com>" + quotes from a Gmail "From" header → display name.
function senderDisplayName(rawFrom: string): string {
  if (!rawFrom) return '';
  const stripped = rawFrom.replace(/<[^>]+>/g, '').replace(/"/g, '').trim();
  if (stripped) return stripped;
  const m = /([A-Za-z0-9._%+-]+)@/.exec(rawFrom);
  return m ? m[1] : rawFrom;
}

// Fetch unread email senders from Gmail. Returns up to `limit` display
// names of unread email senders, most recent first. Empty array on any
// error (graceful) — the brief continues without an email count rather
// than failing entirely.
//
// Wael 2026-05-10: brief moved off email_actions to a descriptive
// unread count + sender list. Naavi reports facts; user decides what
// needs attention.
async function fetchUnreadEmailSenders(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  limit = 10,
): Promise<{ senders: string[]; count: number }> {
  try {
    const { data: tokenRow } = await adminClient
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .maybeSingle();
    const refreshToken = (tokenRow as { refresh_token?: string } | null)?.refresh_token;
    if (!refreshToken) return { senders: [], count: 0 };

    const accessToken = await getGoogleAccessToken(refreshToken);

    // Wael 2026-05-10: Primary tab only — Promotions / Updates / Social
    // / Forums unread don't count for the brief.
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread+category:primary&maxResults=${limit}`;
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listRes.ok) return { senders: [], count: 0 };
    const listData = await listRes.json();
    const ids = ((listData?.messages ?? []) as Array<{ id?: string }>)
      .map(m => m.id)
      .filter((id): id is string => typeof id === 'string');
    if (ids.length === 0) return { senders: [], count: 0 };

    const messages = await Promise.all(ids.slice(0, limit).map(async (id) => {
      try {
        const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!r.ok) return null;
        const msg = await r.json();
        const hdrs = (msg?.payload?.headers ?? []) as Array<{ name: string; value: string }>;
        const fromHdr = hdrs.find(h => h.name === 'From')?.value ?? '';
        return senderDisplayName(fromHdr);
      } catch { return null; }
    }));
    const senders = messages.filter((s): s is string => typeof s === 'string' && s.length > 0);
    return { senders, count: ids.length };
  } catch (err) {
    console.error('[assistant-fulfillment] fetchUnreadEmailSenders error:', (err as Error)?.message);
    return { senders: [], count: 0 };
  }
}

// ---------------------------------------------------------------------------
// Intent handlers
// ---------------------------------------------------------------------------

interface CalendarEvent {
  title: string;
  start_time: string;
  end_time: string;
  location: string | null;
}

interface EmailAction {
  action_type: string;
  title: string;
  vendor: string;
  due_date: string | null;
  urgency: string;
  summary: string;
  created_at: string | null;
}

async function handleBrief(
  adminClient: ReturnType<typeof createClient>,
  userId: string
): Promise<{ ssml: string; plainText: string }> {
  const now      = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const sevenDays  = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [{ data: events }, unreadResult] = await Promise.all([
    adminClient
      .from('calendar_events')
      .select('title, start_time, end_time, location')
      .eq('user_id', userId)
      .gte('start_time', todayStart.toISOString())
      .lte('start_time', todayEnd.toISOString())
      .order('start_time')
      .limit(5),
    // Wael 2026-05-10: brief reports unread email count + sender list,
    // descriptively. Naavi cannot truthfully claim "items needing
    // attention" — that's the user's judgment. The previous email_actions
    // filter is no longer used for the brief (still populated by
    // extract-email-actions for other surfaces).
    fetchUnreadEmailSenders(adminClient, userId, 10),
  ]);

  const sentences: string[] = [];
  sentences.push(`Good morning. Here is your brief for ${formatDate(now.toISOString())}.`);

  const evList = (events as CalendarEvent[] | null) ?? [];
  if (evList.length > 0) {
    sentences.push(
      `You have ${evList.length} event${evList.length > 1 ? 's' : ''} today.`
    );
    for (const ev of evList.slice(0, 3)) {
      const time = formatTime(ev.start_time);
      sentences.push(
        `${ev.title} at ${time}${ev.location ? `, at ${ev.location}` : ''}.`
      );
    }
    if (evList.length > 3) {
      sentences.push(`Plus ${evList.length - 3} more.`);
    }
  } else {
    sentences.push('Your calendar is clear today.');
  }

  // Email — descriptive count + senders. No "needing attention" claim.
  const { count: unreadCount, senders } = unreadResult;
  if (unreadCount > 0) {
    const noun = unreadCount === 1 ? 'unread email' : 'unread emails';
    if (senders.length > 0) {
      const top = senders.slice(0, 3).join(', ');
      const tail = unreadCount > senders.length || senders.length > 3 ? ', and others' : '';
      sentences.push(`You have ${unreadCount} ${noun}, from ${top}${tail}.`);
    } else {
      sentences.push(`You have ${unreadCount} ${noun}.`);
    }
  } else {
    sentences.push('You have 0 unread emails.');
  }

  return wrap(sentences.join(' '));
}

async function handleCalendar(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  dateParam: string
): Promise<{ ssml: string; plainText: string }> {
  let target: Date;
  try {
    target = new Date(dateParam);
    if (isNaN(target.getTime())) throw new Error('invalid');
  } catch {
    target = new Date();
  }

  const dayStart = new Date(target); dayStart.setHours(0, 0, 0, 0);
  const dayEnd   = new Date(target); dayEnd.setHours(23, 59, 59, 999);

  const { data: events } = await adminClient
    .from('calendar_events')
    .select('title, start_time, end_time, location')
    .eq('user_id', userId)
    .gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString())
    .order('start_time')
    .limit(10);

  const evList = (events as CalendarEvent[] | null) ?? [];
  const label  = formatDate(target.toISOString());

  if (evList.length === 0) {
    return wrap(`Your calendar is clear on ${label}.`);
  }

  const sentences: string[] = [
    `You have ${evList.length} event${evList.length > 1 ? 's' : ''} on ${label}.`,
  ];
  for (const ev of evList) {
    const time = formatTime(ev.start_time);
    sentences.push(`${ev.title} at ${time}${ev.location ? `, at ${ev.location}` : ''}.`);
  }

  return wrap(sentences.join(' '));
}

async function handleContacts(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  name: string
): Promise<{ ssml: string; plainText: string }> {
  const { data: tokenRow } = await adminClient
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .single();

  if (!tokenRow?.refresh_token) {
    return wrap(`I could not look up ${name} because your Google account is not connected.`);
  }

  const accessToken = await getGoogleAccessToken(tokenRow.refresh_token);

  const url = new URL(PEOPLE_API);
  url.searchParams.set('query', name.trim());
  url.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers');
  url.searchParams.set('pageSize', '5');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    return wrap(`I was unable to look up ${name} right now.`);
  }

  const data = await res.json();
  let results = data.results ?? [];

  // Fallback to otherContacts
  if (results.length === 0) {
    const url2 = new URL('https://people.googleapis.com/v1/otherContacts:search');
    url2.searchParams.set('query', name.trim());
    url2.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers');
    url2.searchParams.set('pageSize', '5');
    const res2 = await fetch(url2.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res2.ok) results = (await res2.json()).results ?? [];
  }

  if (results.length === 0) {
    return wrap(`I could not find a contact named ${name} in your Google contacts.`);
  }

  const person  = results[0].person;
  const fullName = person.names?.[0]?.displayName ?? name;
  const email    = person.emailAddresses?.[0]?.value;
  const phone    = person.phoneNumbers?.[0]?.value;

  const parts: string[] = [`Here is ${fullName}.`];
  if (email) parts.push(`Email: ${email}.`);
  if (phone) parts.push(`Phone: ${phone}.`);
  if (!email && !phone) parts.push('No email or phone number on file.');

  return wrap(parts.join(' '));
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const { intent, date, name, user_id: bodyUserId } = body as {
    intent?: string;
    date?: string;
    name?: string;
    user_id?: string;
  };

  if (!['brief', 'calendar', 'contacts'].includes(intent ?? '')) {
    return new Response(
      JSON.stringify({ error: `Unknown intent: ${intent}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // CLAUDE.md Rule 4 user-id resolution chain:
  //   1) JWT auth (mobile app path)
  //   2) Body user_id (voice server / server-side / test path)
  //   3) Reject — no anon-only fallback (would leak data across users)
  //
  // Wael 2026-05-10: added body user_id fallback so the auto-tester (and
  // future server-side callers) can hit this function without a real
  // user JWT. Mobile app continues to auth via JWT; nothing changes for
  // existing callers.
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  let userId: string | null = null;
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (!userError && user?.id) userId = user.id;
  }
  if (!userId && typeof bodyUserId === 'string' && bodyUserId.length > 0) {
    userId = bodyUserId;
  }
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    let result: { ssml: string; plainText: string };

    if (intent === 'brief') {
      result = await handleBrief(adminClient, userId);
    } else if (intent === 'calendar') {
      result = await handleCalendar(adminClient, userId, date ?? new Date().toISOString());
    } else {
      // contacts
      if (!name?.trim()) {
        return new Response(
          JSON.stringify({ error: 'Missing name parameter' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      result = await handleContacts(adminClient, userId, name.trim());
    }

    console.log(`[assistant-fulfillment] intent=${intent} user=${userId}`);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[assistant-fulfillment] error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
