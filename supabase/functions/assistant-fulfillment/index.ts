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
}

async function handleBrief(
  adminClient: ReturnType<typeof createClient>,
  userId: string
): Promise<{ ssml: string; plainText: string }> {
  const now      = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const sevenDays  = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [{ data: events }, { data: actions }] = await Promise.all([
    adminClient
      .from('calendar_events')
      .select('title, start_time, end_time, location')
      .eq('user_id', userId)
      .gte('start_time', todayStart.toISOString())
      .lte('start_time', todayEnd.toISOString())
      .order('start_time')
      .limit(5),
    // Morning brief now pulls from structured email_actions (populated by
    // extract-email-actions), NOT raw gmail_messages. We surface only items
    // that are actually actionable for the user this week — no "you have
    // 237 unread" noise.
    adminClient
      .from('email_actions')
      .select('action_type, title, vendor, due_date, urgency, summary')
      .eq('user_id', userId)
      .eq('dismissed', false)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(20),
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

  // Filter email actions to things worth mentioning this morning:
  //   - due within 7 days (if due_date exists), OR
  //   - urgency is "today" or "this_week" (no date but still pressing).
  // "soon" (7-30 days) and "info" items are skipped — they belong in the app,
  // not in a spoken brief that should stay under ~30 seconds.
  const allActions = (actions as EmailAction[] | null) ?? [];
  const actionList = allActions.filter((a) => {
    if (a.urgency === 'today' || a.urgency === 'this_week') return true;
    if (a.due_date) {
      const due = new Date(a.due_date);
      return due >= now && due <= sevenDays;
    }
    return false;
  });

  if (actionList.length > 0) {
    const count = actionList.length;
    const noun = count === 1 ? 'item' : 'items';
    sentences.push(`You have ${count} email ${noun} needing attention.`);
    for (const a of actionList.slice(0, 3)) {
      const line = a.summary?.trim() || `${a.action_type} from ${a.vendor}`;
      // Ensure the line ends with a period for clean TTS pacing.
      sentences.push(line.endsWith('.') ? line : `${line}.`);
    }
    if (count > 3) {
      sentences.push(`Plus ${count - 3} more in your email.`);
    }
  }
  // If nothing actionable, stay silent about email — silence beats noise for
  // a senior user. The rest of the brief still plays.

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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));
  const { intent, date, name } = body as {
    intent?: string;
    date?: string;
    name?: string;
  };

  if (!['brief', 'calendar', 'contacts'].includes(intent ?? '')) {
    return new Response(
      JSON.stringify({ error: `Unknown intent: ${intent}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Resolve the user from the Supabase JWT
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    let result: { ssml: string; plainText: string };

    if (intent === 'brief') {
      result = await handleBrief(adminClient, user.id);
    } else if (intent === 'calendar') {
      result = await handleCalendar(adminClient, user.id, date ?? new Date().toISOString());
    } else {
      // contacts
      if (!name?.trim()) {
        return new Response(
          JSON.stringify({ error: 'Missing name parameter' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      result = await handleContacts(adminClient, user.id, name.trim());
    }

    console.log(`[assistant-fulfillment] intent=${intent} user=${user.id}`);
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
