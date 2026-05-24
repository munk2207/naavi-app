/**
 * Naavi Chat — Supabase Edge Function
 *
 * Proxies requests to the Anthropic API using a server-side key.
 * The key never lives on Robert's device.
 *
 * Also intercepts email alert requests server-side so Claude's
 * model refusal never reaches the user.
 *
 * Contact disambiguation:
 *   - 0 contacts match → save rule with from_name (broad)
 *   - 1 contact matches → save rule with exact from_email
 *   - 2+ contacts match → ask Robert which one, save pending_disambig,
 *     resolve on next message
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.79.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { NAAVI_TOOLS, TOOL_NAME_TO_ACTION_TYPE } from '../_shared/anthropic_tools.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Phone numbers are looked up per-user from user_settings.phone — no hardcoding.

function formatPhoneForSpeech(phone: string): string {
  // Convert "+16137697957" → "+1 613 769 7957" so TTS reads it correctly
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return phone;
}

async function getUserPhone(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<string> {
  try {
    const { data } = await supabase
      .from('user_settings')
      .select('phone')
      .eq('user_id', userId)
      .single();
    if (data?.phone) return data.phone;
  } catch (_) { /* ignore */ }
  return ''; // empty — callers handle gracefully
}

/**
 * Extract the embedded JSON object from Claude's rawText. Haiku is
 * non-deterministic about response shape — sometimes returns pure JSON,
 * sometimes wraps it in ```json fences, sometimes prepends preamble
 * text before the JSON. This helper finds and parses the first
 * top-level JSON object regardless of what surrounds it. Returns the
 * parsed object + a "reconstructor" that can produce the equivalent
 * rawText for any modified parsed object.
 */
function extractAndParseJson(rawText: string): {
  parsed: any | null;
  reconstruct: (modified: any) => string;
} {
  if (typeof rawText !== 'string' || rawText.length === 0) {
    return { parsed: null, reconstruct: () => rawText };
  }

  // Find a ```json fenced block first; if absent, find the first '{' and
  // walk the string to its matching '}' (brace-depth counter — handles
  // nested objects in actions[]).
  let jsonStart = -1;
  let jsonEnd = -1;
  let fenced = false;

  const fenceMatch = rawText.match(/```(?:json)?\s*/i);
  if (fenceMatch && fenceMatch.index !== undefined) {
    jsonStart = fenceMatch.index + fenceMatch[0].length;
    fenced = true;
  } else {
    jsonStart = rawText.indexOf('{');
  }

  if (jsonStart < 0) return { parsed: null, reconstruct: () => rawText };

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = jsonStart; i < rawText.length; i++) {
    const ch = rawText[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { jsonEnd = i + 1; break; }
    }
  }
  if (jsonEnd < 0) return { parsed: null, reconstruct: () => rawText };

  const jsonSlice = rawText.slice(jsonStart, jsonEnd);
  let parsed: any;
  try { parsed = JSON.parse(jsonSlice); }
  catch { return { parsed: null, reconstruct: () => rawText }; }

  const preamble = rawText.slice(0, jsonStart);
  const trailer = rawText.slice(jsonEnd);
  const reconstruct = (modified: any) => preamble + JSON.stringify(modified) + trailer;
  return { parsed, reconstruct };
}

/**
 * Normalize Claude's rawText output so downstream callers (mobile
 * client, voice server, auto-tester) always see a clean JSON string
 * with no preamble or trailing prose. If the raw output has a parseable
 * JSON object embedded, this returns just that object stringified.
 * Falls through unchanged if nothing parseable is found.
 */
function normalizeRawText(rawText: string): string {
  const { parsed } = extractAndParseJson(rawText);
  if (!parsed) return rawText;
  return JSON.stringify(parsed);
}

// ── Phase 3.5 location-tool converter ─────────────────────────────────────────
//
// The two split location tools (`set_location_rule_chain`,
// `set_location_rule_address`) have FLAT input shapes — direction,
// dwell_minutes, expiry, action_type, action_config, label, one_shot all at
// top level. Downstream consumers (orchestrator, tests) still expect the
// legacy SET_ACTION_RULE shape with trigger_type='location' and a nested
// trigger_config object. This helper bridges the two shapes.
//
// For chain tool: place_name = `${chain_brand}` if no suffix supplied, else
// the user-spoken suffix verbatim (which already contains the brand).
function convertLocationToolToActionRule(
  toolName: 'set_location_rule_chain' | 'set_location_rule_address',
  input: Record<string, any>,
): any {
  let placeName: string;
  if (toolName === 'set_location_rule_chain') {
    const brand = typeof input.chain_brand === 'string' ? input.chain_brand.trim() : '';
    const suffix = typeof input.place_name === 'string' ? input.place_name.trim() : '';
    if (suffix && suffix.toLowerCase() !== brand.toLowerCase()) {
      // User said "Costco Merivale" — Haiku returned chain_brand='Costco',
      // place_name='Costco Merivale' (or 'Merivale'). Prefer the longer
      // string when it already contains the brand; otherwise concatenate.
      placeName = suffix.toLowerCase().includes(brand.toLowerCase())
        ? suffix
        : `${brand} ${suffix}`.trim();
    } else {
      placeName = brand;
    }
  } else {
    placeName = typeof input.place_name === 'string' ? input.place_name : '';
  }

  const triggerConfig: Record<string, any> = {
    place_name: placeName,
    direction: input.direction,
  };
  // V57.16 — only set dwell_minutes when Claude explicitly emitted one.
  // Previously we defaulted to 2 minutes here, which overrode the server's
  // new 30s default in report-location-event. Now: if the user / Claude
  // didn't specify, the field is omitted and the server uses its 30s default.
  if (typeof input.dwell_minutes === 'number') triggerConfig.dwell_minutes = input.dwell_minutes;
  if (typeof input.expiry === 'string' && input.expiry) triggerConfig.expiry = input.expiry;

  const result: Record<string, any> = {
    type: 'SET_ACTION_RULE',
    trigger_type: 'location',
    trigger_config: triggerConfig,
    action_type: input.action_type,
    action_config: input.action_config,
    label: input.label,
    one_shot: typeof input.one_shot === 'boolean' ? input.one_shot : true,
  };
  return result;
}

// ── Fallback speech for tool-only Claude responses (Bug E fix, V57.12.1) ─────
//
// Phase 2 structured outputs migration revealed that Anthropic Haiku
// occasionally emits ONLY tool_use blocks without any companion text block,
// for certain tool types (DELETE_RULE, DELETE_EVENT, SET_REMINDER,
// SET_ACTION_RULE non-location). The orchestrator then renders an empty
// chat turn and the user gets no feedback that the action succeeded.
//
// This helper synthesises a brief, action-specific confirmation when
// `speechBlocks` is empty but `actions[]` is non-empty. The bubble always
// shows SOMETHING, even if Claude itself failed to narrate.
//
// Templates intentionally short — the cards already convey specifics
// (event title, rule label, etc.). Speech is just confirmation that
// something happened.
function buildFallbackSpeech(actions: any[]): string {
  if (!Array.isArray(actions) || actions.length === 0) return '';
  // Pick the first action's type for the headline. If a turn carries
  // multiple actions (e.g. REMEMBER + CREATE_EVENT date-fact fanout) the
  // first is usually the most user-meaningful.
  const first = actions[0];
  const type = String(first?.type ?? '');
  switch (type) {
    case 'SET_ACTION_RULE': return 'Alert set.';
    case 'DELETE_RULE':     return actions.length > 1 ? 'Done — deleted those alerts.' : 'Alert deleted.';
    case 'CREATE_EVENT':    return 'Added to your calendar.';
    case 'DELETE_EVENT':    return 'Calendar event deleted.';
    case 'SET_REMINDER':    return 'Reminder set.';
    case 'REMEMBER':        return "Got it. I'll remember that.";
    case 'DELETE_MEMORY':   return "I've removed that.";
    case 'DRAFT_MESSAGE':   return "I've drafted that. Say yes to send, or tell me what to change.";
    case 'LIST_RULES':      return 'Here are your alerts.';
    case 'LIST_READ':       return 'Here it is.';
    case 'LIST_CREATE':     return 'List created.';
    case 'LIST_ADD':        return 'Added to the list.';
    case 'LIST_REMOVE':     return 'Removed from the list.';
    case 'GLOBAL_SEARCH':   return 'Looking that up.';
    case 'DRIVE_SEARCH':    return 'Searching your Drive.';
    case 'SAVE_TO_DRIVE':   return 'Saved to your Drive.';
    case 'ADD_CONTACT':     return 'Contact added.';
    case 'SCHEDULE_MEDICATION': return 'Medication schedule added.';
    case 'FETCH_TRAVEL_TIME':   return 'Looking up travel time.';
    case 'SPEND_SUMMARY':       return 'Calculating that for you.';
    case 'UPDATE_MORNING_CALL': return 'Morning call updated.';
    case 'START_CALL_RECORDING':return 'Recording started.';
    default:                return 'Got it.';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function speechResponse(speech: string, extra: Record<string, unknown> = {}) {
  return jsonResponse({
    rawText: JSON.stringify({ speech, actions: [], pendingThreads: [], ...extra }),
  });
}

// ── Email alert detection ─────────────────────────────────────────────────────

function detectEmailAlert(msg: string): { fromName: string | null; subjectKeyword: string | null } | null {
  // 2026-05-24 (Wael) — B4y. Hard create-intent gate. The legacy isAlert
  // regex below requires "alert" + "email" within 80 chars; that's far too
  // permissive — it can fire on benign sentences that happen to contain
  // both words ("Find McDonald alert" + a prior turn mentioning email
  // would NOT match — but a longer dictation could). Worse, the mobile
  // SET_EMAIL_ALERT path (Claude-emitted action in useOrchestrator.ts:2226)
  // has the SAME no-confirmation gap, so a Haiku misclassification was
  // enough to land a fabricated rule on Wael's account 2026-05-24 15:32
  // EST. The HAS_CREATE_INTENT gate requires an EXPLICIT command-shape
  // phrase ("alert me", "notify me", "let me know", "remind me",
  // "set up an alert", "create an alert") before any write-bypass fires.
  // See holding-list B4y for the full incident + fix history.
  const HAS_CREATE_INTENT = /\b(alert|notify|tell|let|remind|text|email|message|ping)\s+me\b|\b(set\s+up|create|make)\s+(an?\s+)?alert\b|\blet\s+me\s+know\b/i;
  if (!HAS_CREATE_INTENT.test(msg)) return null;

  const isAlert = /\b(alert|notify|text|sms|let me know|send me)\b.{0,80}\bemail/i.test(msg);
  if (!isAlert) return null;

  const subjectMatch =
    msg.match(/\b(?:subject|title)\b.{0,25}?\b([a-z0-9_\-]+)\b/i) ??
    msg.match(/\bwith\b\s+['"]?([a-z0-9_\-]+)['"]?\s+in\s+(?:the\s+)?(?:subject|title)\b/i) ??
    msg.match(/\b(?:containing|contains|saying|about|word)\b\s+['"]?([a-z0-9_\-]+)['"]?/i);
  const subjectKeyword = subjectMatch ? subjectMatch[1] : null;

  const fromMatch = msg.match(/\bfrom\b\s+([A-Za-z0-9][A-Za-z0-9\s._@-]{1,50}?)(?:\s*$|\s+(?:or|and|with|about|when|if|that|in))/i);
  const fromName = fromMatch ? fromMatch[1].trim() : null;

  if (!subjectKeyword && !fromName) return null;
  return { fromName, subjectKeyword };
}

// ── Calendar PDF ask-time reader ──────────────────────────────────────────────
//
// When Robert asks a calendar-shaped question ("when is the first day of
// school", "next PA day", etc.) AND he has a document_type='calendar' PDF
// harvested, we download that PDF binary at ask-time and pass it to Claude
// as a `document` content block so Claude reads the actual calendar grid
// and answers with the specific date.
//
// Only fires when the regex matches AND a calendar PDF exists. No cost
// otherwise.

const CALENDAR_INTENT_RE =
  /\b(when|what\s+(date|day|time)|how\s+many\s+days|next|first|last|upcoming)\b[\s\S]{0,80}\b(school|pa\s*day|holiday|break|semester|term|class|practice|game|tournament|match|concert|report\s*card|parent\s*teacher|exam|final)\b/i;

// B1c — email instant-search live-overlay intent detection (Wael 2026-05-08).
// When the user asks about recent email, sync-gmail's hourly cron may not have
// caught emails that arrived in the last 60 minutes. This regex detects email-
// query intent so we trigger fetchLiveRecentEmails only when needed (cost-tuned).
// Tuning is iterative — false negatives mean the user sees the bug; false
// positives waste a Gmail API call.
const EMAIL_QUERY_INTENT_RE =
  /\b(email|emails|inbox|new\s*mail|mailbox|did\s+\w+\s+(email|mail|message|write|send)|any\s+(messages?|mail|emails?)|new\s+messages?|unread|just\s+(got|received)|did\s+i\s+(get|receive))\b/i;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function fetchCalendarPdfBlock(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  userText: string,
): Promise<{ type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } } | null> {
  if (!CALENDAR_INTENT_RE.test(userText)) return null;

  // Find the user's most recent calendar PDF.
  const { data: calDoc } = await supabase
    .from('documents')
    .select('drive_file_id, file_name, size_bytes, mime_type')
    .eq('user_id', userId)
    .eq('document_type', 'calendar')
    .eq('mime_type', 'application/pdf')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!calDoc?.drive_file_id) return null;
  // 20 MB guard — Claude PDF input cap is around 32 MB; leave headroom.
  if (typeof calDoc.size_bytes === 'number' && calDoc.size_bytes > 20 * 1024 * 1024) return null;

  // Exchange refresh token for access token
  const { data: tokenRow } = await supabase
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .single();
  if (!tokenRow?.refresh_token) return null;

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        refresh_token: tokenRow.refresh_token,
        grant_type:    'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return null;

    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(calDoc.drive_file_id)}?alt=media`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    );
    if (!dlRes.ok) return null;
    const bytes = new Uint8Array(await dlRes.arrayBuffer());
    if (bytes.length === 0) return null;

    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: bytesToBase64(bytes) },
    };
  } catch (err) {
    console.error('[naavi-chat] calendar pdf fetch failed:', err);
    return null;
  }
}

// ── Google Contacts lookup ────────────────────────────────────────────────────

async function lookupContactsByName(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  name: string
): Promise<{ name: string; email: string }[]> {
  try {
    // Get Google refresh token
    const { data: tokenRow } = await supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .single();

    if (!tokenRow?.refresh_token) return [];

    // Exchange refresh token for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        refresh_token: tokenRow.refresh_token,
        grant_type:    'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return [];

    const accessToken = tokenData.access_token;

    // Search Google Contacts
    const url = new URL('https://people.googleapis.com/v1/people:searchContacts');
    url.searchParams.set('query', name.trim());
    url.searchParams.set('readMask', 'names,emailAddresses');
    url.searchParams.set('pageSize', '5');

    const peopleRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!peopleRes.ok) return [];

    const peopleData = await peopleRes.json();
    let results = peopleData.results ?? [];

    // Fallback: other contacts (people emailed before)
    if (results.length === 0) {
      const url2 = new URL('https://people.googleapis.com/v1/otherContacts:search');
      url2.searchParams.set('query', name.trim());
      url2.searchParams.set('readMask', 'names,emailAddresses');
      url2.searchParams.set('pageSize', '5');
      const res2 = await fetch(url2.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res2.ok) results = (await res2.json()).results ?? [];
    }

    return results
      .map((r: { person: { names?: { displayName: string }[]; emailAddresses?: { value: string }[] } }) => ({
        name:  r.person.names?.[0]?.displayName ?? '',
        email: r.person.emailAddresses?.[0]?.value ?? '',
      }))
      .filter((c: { name: string; email: string }) => c.name && c.email);

  } catch (err) {
    console.error('[naavi-chat] Google Contacts lookup failed:', err);
    return [];
  }
}

// ── V57.9.3 server-side prompt assembly ──────────────────────────────────────
//
// Mobile V57.9.3+ sends a lean body without the system prompt to avoid
// shipping 57 KB of text over the wire on every turn (caused 60 s body-
// upload stalls on sluggish networks). When `system` is missing we
// assemble the prompt here using:
//   1. user_settings (server-side DB lookup) for user_name + user_phone
//   2. get-naavi-prompt Edge Function (in-region, fast, prompt cached)
//   3. The mobile-supplied context (brief items, health, knowledge)
//
// Output mirrors what mobile sendToNaavi previously assembled — same
// CACHE_BOUNDARY / END_STABLE_RULES markers preserved so the prompt-cache
// 3-block split below still works.

// V57.11.2 — fetch the user's calendar events live from Google so Claude
// always sees the current schedule. Wael 2026-05-04: changed an event in
// Google Calendar and Naavi kept reporting the old time because the brief
// passed by mobile was loaded at app launch and only refreshed every 60s.
// Pulling per-request adds ~500ms latency but eliminates the staleness.
async function fetchLiveCalendarEvents(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<MobileBriefItem[]> {
  try {
    const { data: tokenRow } = await supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .maybeSingle();
    const refreshToken = (tokenRow as { refresh_token?: string } | null)?.refresh_token;
    if (!refreshToken) return [];

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = typeof tokenData?.access_token === 'string' ? tokenData.access_token : null;
    if (!accessToken) return [];

    const timeMin = new Date();
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 7);
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events`
      + `?singleEvents=true&orderBy=startTime&maxResults=50`
      + `&timeMin=${encodeURIComponent(timeMin.toISOString())}`
      + `&timeMax=${encodeURIComponent(timeMax.toISOString())}`;
    // V57.11.6 — explicit Cache-Control: no-cache + Pragma: no-cache so
    // Google Calendar API bypasses its CDN cache and returns fresh data.
    // Without this, recently-edited event fields (e.g., the location
    // field the user just changed) can read stale for up to ~30s.
    // Wael 2026-05-05: changed Hussein meeting location in Google
    // Calendar, asked Naavi "navigate to my next meeting" → Naavi read
    // the OLD location.
    const eventsRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });
    if (!eventsRes.ok) return [];
    const eventsData = await eventsRes.json();
    const items = (eventsData?.items ?? []) as Array<{
      id?: string;
      summary?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;

    // V57.11.2 — drop events whose start time has already passed. Without
    // this, Claude treats a meeting that started 27 minutes ago as "next"
    // because the prompt rule about past-event filtering isn't reliably
    // followed by Haiku. Doing it server-side makes "next meeting" answers
    // deterministic. The trade-off: an in-progress meeting won't appear in
    // the brief; if the user asks about it explicitly the global-search
    // calendar adapter still surfaces it (that adapter searches by keyword).
    //
    // 2026-05-22 — B4q fix. All-day events use a date-only string
    // (YYYY-MM-DD) for start.date / end.date. `new Date("2026-05-22")`
    // parses as midnight UTC = 8 PM EST May 21 — i.e., in the past
    // relative to "now" on May 22 EST. The original .getTime() filter
    // then dropped today's and tomorrow's all-day events because they
    // looked "past" in UTC. For all-day events, compare DATE STRINGS
    // (YYYY-MM-DD) against today's date in America/Toronto; never call
    // .getTime() on a date-only string (Rule 18 — never reformat a fact
    // to fit a column it doesn't have). Same Victoria Day bug class as
    // B3i shipped for assistant-fulfillment.
    const now = Date.now();
    const todayTorontoStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Toronto' });
    return items
      .map(e => {
        const isAllDay = !e.start?.dateTime && !!e.start?.date;
        const start = e.start?.dateTime ?? e.start?.date ?? '';
        const startDate = start ? new Date(start) : new Date();
        const isValid = !Number.isNaN(startDate.getTime());
        return { e, startDate, isAllDay, isValid };
      })
      .filter(({ e, startDate, isAllDay, isValid }) => {
        if (!isValid) return false;
        if (isAllDay) {
          // Keep if event still in progress: start.date <= today AND end.date > today (Google end.date is exclusive)
          // OR event starts today / in the future.
          const startStr = e.start?.date ?? '';
          const endStr = e.end?.date ?? '';
          if (startStr && startStr >= todayTorontoStr) return true;
          if (endStr && endStr > todayTorontoStr) return true;
          return false;
        }
        return startDate.getTime() > now;
      })
      .map(({ e, startDate, isAllDay }) => {
        const timeStr = !isAllDay
          ? startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Toronto' })
          : 'all day';
        // For all-day events, parse start.date as local-noon so the date
        // label doesn't shift back to yesterday in EST (Rule 18).
        const dateForLabel = isAllDay && e.start?.date
          ? new Date(`${e.start.date}T12:00:00`)
          : startDate;
        const dateStr = dateForLabel.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' });
        const detailParts = [isAllDay ? `${dateStr} all day` : `${dateStr} at ${timeStr}`];
        if (e.location) detailParts.push(`at ${e.location}`);
        return {
          id: e.id ?? '',
          category: 'calendar',
          title: e.summary ?? 'Event',
          detail: detailParts.join(' '),
        } as MobileBriefItem;
      });
  } catch (err) {
    console.error('[fetchLiveCalendarEvents] failed:', (err as Error)?.message);
    return [];
  }
}

// B1c — email instant-search live-overlay (Wael 2026-05-08).
// Mirrors fetchLiveCalendarEvents shape but for Gmail. Fires only when
// EMAIL_QUERY_INTENT_RE matched the user's question (cost-tuned: not every turn).
// Returns the last hour of email metadata so Claude can answer "did Bob email
// me?" / "any new bills?" without waiting for the next sync-gmail cron tick.
// Bounded to 10 messages max to keep cost predictable. Body is intentionally
// not fetched — too expensive in the hot path; full content stays with the
// hourly sync.
async function fetchLiveRecentEmails(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ id: string; sender: string; subject: string; snippet: string; receivedAt: string }[]> {
  try {
    const { data: tokenRow } = await supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .maybeSingle();
    const refreshToken = (tokenRow as { refresh_token?: string } | null)?.refresh_token;
    if (!refreshToken) return [];

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = typeof tokenData?.access_token === 'string' ? tokenData.access_token : null;
    if (!accessToken) return [];

    // B2e fix (Wael 2026-05-09): widened from newer_than:1h to newer_than:1d.
    // The 1h window matched the sync-gmail cron cadence in theory, but in
    // practice emails arriving 1-2h before a query (after the last sync ran)
    // sat in a gap where neither path saw them. 24h covers a full day of
    // arrivals, the natural cadence for "did anyone email me today" queries.
    //
    // Part B of B1d fix (Wael 2026-05-10): raised maxResults from 10 to 30.
    // The original "10 covers typical inbox" assumption was wrong for users
    // with newsletter subscriptions — Wael's deep test showed his Birthday
    // Party email at position #11 of 31 messages in the 24h window, which
    // pushed it OUT of the live-overlay. 30 covers a busier inbox without
    // adding meaningful per-call cost (Gmail metadata fetch is parallel).
    // Wael 2026-05-10: Primary tab only — Naavi treats other Gmail
    // categories (Promotions / Updates / Social / Forums) as irrelevant.
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than:1d+category:primary&maxResults=30`;
    const listRes = await fetch(listUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });
    if (!listRes.ok) return [];
    const listData = await listRes.json();
    const messageIds = ((listData?.messages ?? []) as Array<{ id?: string }>)
      .map(m => m.id)
      .filter((id): id is string => typeof id === 'string');
    if (messageIds.length === 0) return [];

    // For each message, metadata-only fetch (From / Subject / Date headers + snippet).
    // Cap matches the Gmail list maxResults (30 — see comment on listUrl above).
    const messages = await Promise.all(messageIds.slice(0, 30).map(async (id) => {
      try {
        const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`
          + `?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`;
        const msgRes = await fetch(msgUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
        });
        if (!msgRes.ok) return null;
        const msg = await msgRes.json();
        const headers = (msg?.payload?.headers ?? []) as Array<{ name: string; value: string }>;
        const fromHdr = headers.find(h => h.name === 'From')?.value ?? '';
        const subjectHdr = headers.find(h => h.name === 'Subject')?.value ?? '';
        const dateHdr = headers.find(h => h.name === 'Date')?.value ?? '';
        return {
          id: typeof msg?.id === 'string' ? msg.id : id,
          sender: fromHdr,
          subject: subjectHdr,
          snippet: String(msg?.snippet ?? '').slice(0, 200),
          receivedAt: dateHdr,
        };
      } catch {
        return null;
      }
    }));

    return messages.filter((m): m is NonNullable<typeof m> => m !== null);
  } catch (err) {
    console.error('[fetchLiveRecentEmails] failed:', (err as Error)?.message);
    return [];
  }
}

interface MobileBriefItem {
  id?: string;
  category?: string;
  title?: string;
  detail?: string;
  urgent?: boolean;
}

async function assembleSystemPromptServerSide(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  opts: {
    channel: string;
    language: 'en' | 'fr';
    briefItems: MobileBriefItem[];
    healthContext: string;
    knowledgeContext: string;
  },
): Promise<string | null> {
  // 1. user_settings → user name + phone + home/work addresses (drives
  //    prompt personalization). V57.11.2 — include home/work addresses
  //    so Claude can answer "what's my home address" directly. Wael
  //    2026-05-04: Naavi was saying "I don't have your home address"
  //    despite the value being in user_settings — Claude never saw it.
  let userName = 'there';
  let userPhone = '';
  let userHomeAddress = '';
  let userWorkAddress = '';
  try {
    const { data } = await supabase
      .from('user_settings')
      .select('name, phone, home_address, work_address')
      .eq('user_id', userId)
      .single();
    if (data?.name)         userName         = String(data.name);
    if (data?.phone)        userPhone        = String(data.phone);
    if (data?.home_address) userHomeAddress  = String(data.home_address);
    if (data?.work_address) userWorkAddress  = String(data.work_address);
  } catch (err) {
    console.warn('[assembleSystemPrompt] user_settings lookup failed:', (err as Error)?.message);
  }

  // 2. get-naavi-prompt → base canonical prompt (channel-tailored)
  let base: string | null = null;
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const promptRes = await fetch(`${supaUrl}/functions/v1/get-naavi-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        channel: opts.channel === 'voice' ? 'voice' : 'app',
        userName,
        userPhone,
      }),
    });
    if (promptRes.ok) {
      const promptData = await promptRes.json();
      if (typeof promptData?.prompt === 'string' && promptData.prompt.length > 100) {
        base = promptData.prompt;
      }
    } else {
      console.warn('[assembleSystemPrompt] get-naavi-prompt non-200:', promptRes.status);
    }
  } catch (err) {
    console.error('[assembleSystemPrompt] get-naavi-prompt fetch failed:', (err as Error)?.message);
  }

  if (!base) return null;

  // 3. Append mobile-supplied per-query context (brief / health / knowledge).
  //    Layout mirrors the previous mobile-side assembly so the prompt-cache
  //    3-block split downstream still finds the END_STABLE marker (it's
  //    embedded in the base) and partitions correctly.
  const languageNote = opts.language === 'fr'
    ? `\n${userName} speaks French. Respond in Canadian French.`
    : '';

  // V57.11.2 — replace mobile's calendar items with live Google Calendar
  // fetch so Claude never sees a stale schedule. Non-calendar items (emails,
  // birthdays, weather) still come from mobile (they don't have the same
  // staleness problem).
  const liveCalendar = await fetchLiveCalendarEvents(supabase, userId);
  const nonCalendarMobile = (opts.briefItems ?? []).filter(item => item.category !== 'calendar');
  const mergedBrief: MobileBriefItem[] = [...liveCalendar, ...nonCalendarMobile];

  const briefContext = mergedBrief.length > 0
    ? `\n\n## ${userName}'s upcoming schedule (next 7 days)\n` +
      mergedBrief
        .map(item => `- [${item.category ?? 'task'}] ${item.title ?? ''}${item.detail ? ` — ${item.detail}` : ''}`)
        .join('\n')
    : `\n\n## ${userName}'s upcoming schedule (next 7 days)\n- No events found for the next 7 days.`;

  // V57.11.2 — User reference section. Authoritative facts that Claude
  // should answer directly when asked, no search needed.
  const userRefParts: string[] = [];
  if (userHomeAddress) userRefParts.push(`- Home address: ${userHomeAddress}`);
  if (userWorkAddress) userRefParts.push(`- Work / office address: ${userWorkAddress}`);
  const userRefSection = userRefParts.length > 0
    ? `\n\n## ${userName}'s reference info (answer these directly when asked, no search needed)\n${userRefParts.join('\n')}`
    : '';

  const healthSuffix    = opts.healthContext    ? `\n\n${opts.healthContext}`    : '';
  const knowledgeSuffix = opts.knowledgeContext ? `\n\n${opts.knowledgeContext}` : '';

  // 2026-05-23 (Wael) — inject the user's lists by name. Without this,
  // Claude saw the assembled prompt (home/work address + brief items
  // + health + knowledge) and concluded "no shopping list is mentioned
  // in this user's profile" — then HALLUCINATED "I don't have a shopping
  // list" without calling list_read at all (verified live for Wael's
  // user_id 788fe85c on V57.22.1 build 197). Adding the actual list names
  // gives Claude direct evidence so it either correctly calls list_read
  // OR honestly reports it has no list of that name.
  let listsContext = '';
  try {
    const { data: listRows } = await supabase
      .from('lists')
      .select('name, category')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (Array.isArray(listRows) && listRows.length > 0) {
      const listLines = listRows.map((r: any) =>
        `- ${r.name}${r.category ? ` (${r.category})` : ''}`
      );
      listsContext =
        `\n\n## ${userName}'s lists (when asked to read/add to/remove from a list, call the matching list_* tool — do NOT answer from this section alone, the items are in Drive)\n` +
        listLines.join('\n');
    }
  } catch (err) {
    console.warn('[assembleSystemPrompt] lists lookup failed:', (err as Error)?.message);
  }

  // 2026-05-24 (Wael) — B4x. Inject BOTH active and disabled alerts.
  // The prior version (2026-05-23) showed only enabled=true rows; this
  // hid disabled alerts from Claude entirely and caused a Rule 18
  // violation: a user with a disabled "McDonald's" alert visible on
  // their Alerts screen (greyed-out / Expired per F2e closure 2026-05-23)
  // asked to attach a list, and Naavi replied "I don't have a McDonald's
  // alert" — false from the user's perspective. With both lists in
  // context, Naavi can offer reactivation when the only match is in
  // the disabled list. RLS lockdown: action_rules is service-role-only
  // for writes; this is a service-role SELECT so it's allowed.
  let alertsContext = '';
  try {
    const { data: alertRows } = await supabase
      .from('action_rules')
      .select('label, trigger_type, trigger_config, enabled')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (Array.isArray(alertRows) && alertRows.length > 0) {
      const formatRow = (r: any) => {
        const label = r.label || `${r.trigger_type} alert`;
        const place = r.trigger_config?.place_name || '';
        return place && !label.includes(place)
          ? `- ${label} (at ${place})`
          : `- ${label}`;
      };
      const enabledRows = (alertRows as any[]).filter((r) => r.enabled);
      const disabledRows = (alertRows as any[]).filter((r) => !r.enabled);
      if (enabledRows.length > 0 || disabledRows.length > 0) {
        let sections = '';
        if (enabledRows.length > 0) {
          sections += `\nACTIVE:\n` + enabledRows.map(formatRow).join('\n');
        }
        if (disabledRows.length > 0) {
          sections += `\n\nDISABLED (can be reactivated):\n` + disabledRows.map(formatRow).join('\n');
        }
        alertsContext =
          `\n\n## ${userName}'s alerts (active + disabled)\n` +
          `When ${userName} references "the X alert", match against BOTH lists below. Reply rules:\n` +
          `- Match in ACTIVE only → proceed as normal (use the standard "I'll … Say yes to confirm" shape for connect/disconnect).\n` +
          `- Match in DISABLED only (exactly 1 row). Two-turn flow:\n` +
          `    (a) If your IMMEDIATELY PREVIOUS reply did NOT contain "Want me to reactivate it and" for this alert → say "You have a disabled X alert at Y. Want me to reactivate it and [original intent]? Say yes to confirm, no to cancel, or tell me what to change." Do NOT emit a connect/disconnect action this turn. Wait for the user's yes/no.\n` +
          `    (b) If your IMMEDIATELY PREVIOUS reply DID contain "Want me to reactivate it and" for this alert AND the user just replied with yes/yeah/yep/confirm/sure/ok/please → EMIT the LIST_CONNECT (or LIST_DISCONNECT) action NOW with this disabled rule as entityRef. The server auto-reactivates the rule before executing the connect. Do NOT repeat the combined ask — that's an infinite loop.\n` +
          `- Match in multiple DISABLED rows → ask "You have N disabled X alerts — at A, B, …. Which one?" Wait for the answer.\n` +
          `- Match in BOTH ACTIVE and DISABLED → ask "You have an active X alert at A. You also have a disabled one at B. Which one?" Wait for the answer.\n` +
          `- No match in either list → say plainly "I don't have a [name] alert" and offer to create one.\n` +
          `NEVER agree to attach/disconnect/change an alert that isn't in either list.\n` +
          sections;
      }
    }
  } catch (err) {
    console.warn('[assembleSystemPrompt] alerts lookup failed:', (err as Error)?.message);
  }

  return base + languageNote + userRefSection + briefContext + listsContext + alertsContext + healthSuffix + knowledgeSuffix;
}

// 2026-05-23 (Wael) — normalize a string for entity-existence matching.
// Used by naavi-chat's server-side validation to compare user-spoken
// entity names against the user's actual alerts/lists. Strips:
//   - case (lowercase)
//   - apostrophes (curly + straight + backtick), because Deepgram STT
//     sometimes transcribes "Loblaws" as "Loblaw's" and naive substring
//     comparison fails
//   - hyphens, dots, slashes (other punctuation Deepgram or typing
//     variation may introduce)
//   - extra whitespace
function normalizeForEntityMatch(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[''`'.\-/]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 2026-05-24 (Wael) — B4x. Look up action_rules by name, partitioned
// into enabled + disabled matches. Used by alerts context injection,
// 3 validators, and the auto-reactivate preprocessor.
//
// Background: when the user references a disabled alert by name
// (e.g., "attach my list to McDonald's alert" where the McDonald's
// alert is in their Alerts UI as greyed-out / Expired), Naavi must
// surface the disabled match — not deny the alert exists. Denial
// violates CLAUDE.md Rule 18 (truth-at-user-layer): the user can see
// the alert on their Alerts screen, so Naavi cannot say "I don't have
// one." The lookup includes both enabled and disabled rows; callers
// decide the reply shape via buildAlertMatchMessage below.
type AlertRow = {
  id: string;
  label: string;
  place: string;
  enabled: boolean;
  last_fired_at: string | null;
};

async function matchAlertByName(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  ref: string,
): Promise<{ enabledMatches: AlertRow[]; disabledMatches: AlertRow[] }> {
  const refLower = ref.toLowerCase();
  const core = refLower
    .replace(/\b(alert|alerts|notification|notifications|arrival|reminder|reminders)\b/g, '')
    .trim();
  const normCore = normalizeForEntityMatch(core);
  if (normCore.length < 2) {
    return { enabledMatches: [], disabledMatches: [] };
  }
  const { data: rows } = await supabase
    .from('action_rules')
    .select('id, label, trigger_config, enabled, last_fired_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  const all: AlertRow[] = ((rows ?? []) as any[]).map((r) => ({
    id: String(r.id),
    label: String(r.label || ''),
    place: String(r.trigger_config?.place_name || ''),
    enabled: !!r.enabled,
    last_fired_at: r.last_fired_at ?? null,
  }));
  const matched = all.filter((r) =>
    normalizeForEntityMatch(r.label).includes(normCore) ||
    (r.place && normalizeForEntityMatch(r.place).includes(normCore))
  );
  return {
    enabledMatches: matched.filter((m) => m.enabled),
    disabledMatches: matched.filter((m) => !m.enabled),
  };
}

// 2026-05-24 (Wael) — B4x. Build the standardized server-override
// message for the alert-name-match result. Returns null when the
// match is "enabled only" — caller should proceed as normal.
//
// originalIntent is a short verb phrase ("attach your list",
// "disconnect your list", "show what's attached") used to compose
// the combined reactivate-and-do-X ask for single-disabled matches.
function buildAlertMatchMessage(
  entityRef: string,
  result: { enabledMatches: AlertRow[]; disabledMatches: AlertRow[] },
  originalIntent: string,
): string | null {
  const { enabledMatches, disabledMatches } = result;
  // Match in ACTIVE only — proceed as normal.
  if (enabledMatches.length > 0 && disabledMatches.length === 0) {
    return null;
  }
  // Single disabled match — combined ask (Decision 1 — Option A).
  if (enabledMatches.length === 0 && disabledMatches.length === 1) {
    const d = disabledMatches[0];
    const where = d.place || d.label;
    return `You have a disabled ${entityRef} at ${where}. Want me to reactivate it and ${originalIntent}? Say yes to confirm, no to cancel, or tell me what to change.`;
  }
  // Multiple disabled matches — disambiguation (Decision 2 — Option A).
  if (enabledMatches.length === 0 && disabledMatches.length > 1) {
    const items = disabledMatches.map((m) => m.place || m.label).join(', ');
    return `You have ${disabledMatches.length} disabled ${entityRef}s — at ${items}. Which one?`;
  }
  // Both active and disabled match — mention both (Decision 3 — Option B).
  if (enabledMatches.length > 0 && disabledMatches.length > 0) {
    const activeWhere = enabledMatches[0].place || enabledMatches[0].label;
    const disabledWhere = disabledMatches[0].place || disabledMatches[0].label;
    return `You have an active ${entityRef} at ${activeWhere}. You also have a disabled one at ${disabledWhere}. Which one?`;
  }
  // No match anywhere — existing rejection shape.
  return `You don't have a ${entityRef}. Want to create one, or attach to a different alert?`;
}

// 2026-05-24 (Wael) — B4x. Detect confirmation turns ("yes" / "confirm"
// / etc.) so the auto-reactivate preprocessor only fires when the user
// is responding to a previous combined-ask, NEVER on a fresh request
// (where Haiku might emit LIST_CONNECT on turn 1 ignoring the prompt
// rule — that case must still show the combined ask, not silently
// reactivate). Conservative match: only accept clean affirmatives at
// the start of the message.
function isAffirmativeConfirmTurn(userText: string): boolean {
  const t = String(userText || '').trim().toLowerCase();
  if (!t) return false;
  return /^(yes|yeah|yep|yup|confirm|confirmed|sure|please|go ahead|do it|ok|okay)\b/.test(t);
}

// ── Resolve user ID ───────────────────────────────────────────────────────────

async function resolveUserId(
  supabase: ReturnType<typeof createClient>,
  token: string,
  bodyUserId?: string | null,
): Promise<string | null> {
  // Attempt 1: JWT (mobile app path)
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) return user.id;
  } catch (_) { /* ignore */ }

  // Attempt 2: explicit body user_id (voice server / server-side caller path).
  // CLAUDE.md Rule 4 — required step (b) in the user-resolution chain.
  if (bodyUserId && typeof bodyUserId === 'string' && bodyUserId.length > 0) {
    return bodyUserId;
  }

  // V57.7 — REMOVED the user_tokens "first-google-user" fallback.
  // CLAUDE.md Rule 4 calls it "last resort, single-user apps only".
  // Naavi is multi-user; the fallback was a safety hole that bound any
  // unauthenticated caller (external webhook, attacker, broken test) to
  // whoever happened to be first in user_tokens. The auto-tester multi-
  // user matrix caught this 2026-04-29.
  return null;
}

// ── Save email alert rule ─────────────────────────────────────────────────────

async function saveAlertRule(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  phone: string,
  opts: { fromName?: string | null; fromEmail?: string | null; subjectKeyword?: string | null }
) {
  const label = opts.fromName
    ? `Emails from ${opts.fromName}`
    : `Emails with "${opts.subjectKeyword}" in subject`;

  // Writes go to action_rules (unified trigger/action framework).
  // email_watch_rules has been retired; evaluate-rules cron reads action_rules.
  const triggerConfig: Record<string, string> = {};
  if (opts.fromName)       triggerConfig.from_name = opts.fromName;
  if (opts.fromEmail)      triggerConfig.from_email = opts.fromEmail;
  if (opts.subjectKeyword) triggerConfig.subject_keyword = opts.subjectKeyword;

  const { error } = await supabase.from('action_rules').insert({
    user_id:        userId,
    trigger_type:   'email',
    trigger_config: triggerConfig,
    action_type:    'sms',
    action_config:  { to_phone: phone, body: `New email alert: ${label}` },
    label,
    one_shot:       false,
    enabled:        true,
  });

  if (error) console.error('[naavi-chat] action_rules insert error:', error.message);
  else       console.log('[naavi-chat] Alert rule saved to action_rules:', label);
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // ── Timing diagnostics (Session 16) — remove once chat latency root cause is found.
  const t0 = Date.now();
  const elapsed = () => `${Date.now() - t0}ms`;

  try {
    const body = await req.json();
    const {
      system: rawSystem,
      messages,
      max_tokens: rawMaxTokens,
      user_id: bodyUserId,
      // V57.9.3 — new lean-body fields. Mobile no longer ships the 57 KB
      // system prompt over the wire (caused 60 s upload stall on slow
      // networks). Instead it sends user_id + channel + small mobile
      // context, and naavi-chat assembles the prompt server-side via
      // an in-region call to get-naavi-prompt.
      channel: bodyChannel,
      language: bodyLanguage,
      brief_items: bodyBriefItems,
      health_context: bodyHealthContext,
      knowledge_context: bodyKnowledgeContext,
    } = body;
    // V57.7 cost audit — cap output at 1024 tokens (was 2048). Naavi
    // replies are short by design ("3 sentences unless asked for more"),
    // so 1024 is plenty. 2048 was unused headroom inflating cost.
    // 100 beta users × 50 chat turns/day × 2x output = $$ savings.
    const max_tokens = Math.min(rawMaxTokens ?? 1024, 1024);

    const messageCount = Array.isArray(messages) ? messages.length : 0;
    const hasInlineSystem = typeof rawSystem === 'string' && rawSystem.length > 0;
    console.log(
      `[timing] ${elapsed()} | request parsed | inline_system=${hasInlineSystem ? rawSystem.length : 0} chars | ` +
      `lean_body=${!hasInlineSystem} | messages=${messageCount}`
    );

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase    = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get('Authorization') ?? '';
    const token      = authHeader.replace('Bearer ', '').trim();

    const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === 'user');
    const userText    = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
    const userPreview = userText.slice(0, 80).replace(/\s+/g, ' ');
    console.log(`[timing] ${elapsed()} | userText preview: "${userPreview}"`);
    console.log(`[TRACE-3 naavi-chat] userText full:`, JSON.stringify(userText), `length:`, userText.length);

    // ── Step 1: check for pending disambiguation ──────────────────────────────
    const userId = await resolveUserId(supabase, token, bodyUserId);
    console.log(`[timing] ${elapsed()} | resolveUserId done | userId=${userId ?? 'null'}`);

    // V57.7 — reject unauthenticated calls. Without this, naavi-chat acted
    // as a free Claude proxy for any unauthenticated caller (the attacker
    // surface auto-tester multi-user matrix surfaced 2026-04-29).
    if (!userId) {
      return jsonResponse({ error: 'Unauthorized — provide a JWT or user_id' }, 401);
    }

    if (userId) {
      const { data: pending } = await supabase
        .from('pending_disambig')
        .select('*')
        .eq('user_id', userId)
        .eq('action', 'email_alert')
        .gt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      console.log(`[timing] ${elapsed()} | pending_disambig check done | pending=${pending ? 'yes' : 'no'}`);

      if (pending) {
        const options: { name: string; email: string }[] = pending.payload.options;
        const reply = userText.toLowerCase();

        // Match "John Smith", "Smith", "the first", "1", etc.
        const numberWords = ['one','two','three','four','five'];
        const chosen = options.find((opt, i) => {
          const firstName = opt.name.split(' ')[0].toLowerCase();
          const lastName  = opt.name.split(' ').slice(1).join(' ').toLowerCase();
          const num       = String(i + 1);
          const word      = numberWords[i];
          return (
            reply.includes(opt.name.toLowerCase()) ||
            reply.includes(firstName) ||
            (lastName && reply.includes(lastName)) ||
            reply.includes(opt.email.toLowerCase()) ||
            reply === num ||
            reply === word ||
            reply.includes(`number ${num}`) ||
            reply.includes(`number ${word}`) ||
            (reply.includes('first')  && i === 0) ||
            (reply.includes('second') && i === 1) ||
            (reply.includes('third')  && i === 2) ||
            (reply.includes('fourth') && i === 3) ||
            (reply.includes('fifth')  && i === 4)
          );
        });

        if (chosen) {
          // Delete pending record and save confirmed rule
          await supabase.from('pending_disambig').delete().eq('id', pending.id);
          const userPhone = await getUserPhone(supabase, userId);
          await saveAlertRule(supabase, userId, userPhone, {
            fromName:  chosen.name,
            fromEmail: chosen.email,
          });

          const phoneSpeak = userPhone ? ` at ${formatPhoneForSpeech(userPhone)}` : '';
          return speechResponse(
            `Done — I'll text you${phoneSpeak} as soon as an email from ${chosen.name} arrives.`
          );
        }

        // Could not match — re-ask
        const names = options.map(o => o.name).join(' or ');
        return speechResponse(`I didn't catch that — which one: ${names}?`);
      }
    }

    // ── Step 2: detect new email alert intent ─────────────────────────────────
    const alertRule = detectEmailAlert(userText);
    console.log(`[timing] ${elapsed()} | detectEmailAlert done | alert=${alertRule ? 'yes' : 'no'}`);

    if (alertRule && userId) {
      let fromName  = alertRule.fromName;
      let fromEmail: string | null = null;

      // Contact lookup via Google Contacts when a name was given
      if (fromName) {
        const contacts = await lookupContactsByName(supabase, userId, fromName);

        if (contacts.length === 1) {
          const c = contacts[0];
          // Only accept the resolved email if the contact name or email actually contains
          // the search term — prevents false positives from Google's fuzzy matching
          const isGenuineMatch =
            c.name.toLowerCase().includes(fromName.toLowerCase()) ||
            c.email.toLowerCase().includes(fromName.toLowerCase());
          if (isGenuineMatch) {
            fromEmail = c.email;
            console.log('[naavi-chat] Contact resolved:', c.name, fromEmail);
          } else {
            console.log('[naavi-chat] Contact fuzzy match rejected:', c.name, c.email, '— saving name-only rule');
          }

        } else if (contacts.length > 1) {
          // Multiple matches — ask Robert to pick
          const nameList = contacts.map(c => c.name).join(', or ');

          await supabase.from('pending_disambig').insert({
            user_id: userId,
            action:  'email_alert',
            payload: { fromName, options: contacts },
          });

          const numberedList = contacts.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
          return speechResponse(
            `I found ${contacts.length} contacts named ${fromName}:\n${numberedList}\n\nJust say the number.`
          );
        }
        // 0 matches → fall through, save with from_name only (broad match)
      }

      const userPhone = await getUserPhone(supabase, userId);
      await saveAlertRule(supabase, userId, userPhone, {
        fromName:       fromName,
        fromEmail:      fromEmail,
        subjectKeyword: alertRule.subjectKeyword,
      });

      const confirmLabel = fromName
        ? `an email from ${fromName}`
        : `an email with "${alertRule.subjectKeyword}" in the subject`;

      const phoneSpeak = userPhone ? ` at ${formatPhoneForSpeech(userPhone)}` : '';
      return speechResponse(
        `Done — I'll text you${phoneSpeak} as soon as ${confirmLabel} arrives.`
      );
    }

    // ── Step 3: forward to Claude ─────────────────────────────────────────────

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

    const client   = new Anthropic({ apiKey });

    // V57.9.3 lean-body path — when mobile didn't ship `system` over the wire,
    // build it here from user_settings + get-naavi-prompt + the small mobile
    // context. Falls through with `system = rawSystem` (legacy V57.9.2 mobile
    // and any voice-server-style caller that already builds the prompt).
    let system: any = rawSystem;
    if (!hasInlineSystem) {
      const assembled = await assembleSystemPromptServerSide(supabase, userId, {
        channel: typeof bodyChannel === 'string' ? bodyChannel : 'app',
        language: bodyLanguage === 'fr' ? 'fr' : 'en',
        briefItems: Array.isArray(bodyBriefItems) ? bodyBriefItems : [],
        healthContext: typeof bodyHealthContext === 'string' ? bodyHealthContext : '',
        knowledgeContext: typeof bodyKnowledgeContext === 'string' ? bodyKnowledgeContext : '',
      });
      if (!assembled) {
        console.error('[naavi-chat] server-side prompt assembly failed; cannot proceed');
        return jsonResponse({ error: 'Prompt assembly failed; try again' }, 503);
      }
      system = assembled;
      console.log(`[timing] ${elapsed()} | server-assembled system | len=${assembled.length}`);
    }

    // B1c — Email instant-search live-overlay (Wael 2026-05-08). Fires only
    // when the user is asking an email-shaped question. Pulls the last hour
    // of Gmail metadata directly so Claude sees emails the cron sync hasn't
    // indexed yet. Falls back gracefully on any error (live fetch returns []
    // → no overlay added → Claude proceeds same as before fix). Lands in
    // the system prompt's no-cache tail so cache hits aren't broken.
    if (userId && EMAIL_QUERY_INTENT_RE.test(userText)) {
      console.log(`[timing] ${elapsed()} | B1c — email intent detected, fetching last hour live`);
      const liveEmails = await fetchLiveRecentEmails(supabase, userId);
      console.log(`[timing] ${elapsed()} | B1c — live email fetch returned ${liveEmails.length} message(s)`);
      if (liveEmails.length > 0 && typeof system === 'string') {
        const liveEmailSection = '\n\n## Recent emails (last 24 hours, fetched live just now)\n'
          + liveEmails.map(e => {
              // From header often arrives as "Display Name <addr@domain>" — strip the
              // address for readability while keeping the display name.
              const senderShort = e.sender.replace(/<[^>]+>/g, '').replace(/"/g, '').trim() || e.sender;
              const subject = e.subject || '(no subject)';
              const tail = e.snippet ? ` — ${e.snippet}` : '';
              let when = '';
              const t = e.receivedAt ? Date.parse(e.receivedAt) : NaN;
              if (Number.isFinite(t)) {
                // Hardcoded America/Toronto matches calendarContext upstream;
                // replace with user_settings.timezone when global-first lands.
                // Wael 2026-05-10: include "today"/"yesterday" — with the 24h
                // window (B2e fix), emails can span across midnight. Without
                // the day label Claude defaults to assuming "today" and gets
                // it wrong.
                const tDate = new Date(t);
                const todayStr = new Date().toLocaleDateString('en-US', { timeZone: 'America/Toronto' });
                const tStr = tDate.toLocaleDateString('en-US', { timeZone: 'America/Toronto' });
                const dayLabel = (tStr === todayStr) ? 'today' : 'yesterday';
                const clock = tDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
                when = ` [arrived ${dayLabel} at ${clock}]`;
              }
              return `- From ${senderShort}: ${subject}${when}${tail}`;
            }).join('\n');
        system = system + liveEmailSection;
      }
    }

    // Calendar ask-time PDF injection — when the user asks a date question
    // and has a calendar-typed PDF harvested, pass that PDF to Claude as a
    // document block so Claude reads the actual calendar grid and answers.
    // Only fires for calendar-shaped queries; otherwise no-op.
    let augmentedMessages = messages;
    if (userId) {
      const calBlock = await fetchCalendarPdfBlock(supabase, userId, userText);
      if (calBlock) {
        console.log(`[timing] ${elapsed()} | calendar PDF attached for Claude`);
        // Append the PDF to the last user message's content. If content is a
        // plain string, upgrade to an array so we can mix text + document.
        const copy = [...messages];
        const lastIdx = copy.map((m: { role: string }) => m.role).lastIndexOf('user');
        if (lastIdx !== -1) {
          const lastMsg = copy[lastIdx];
          const existingContent = typeof lastMsg.content === 'string'
            ? [{ type: 'text', text: lastMsg.content }]
            : (Array.isArray(lastMsg.content) ? lastMsg.content : [{ type: 'text', text: String(lastMsg.content) }]);
          copy[lastIdx] = { ...lastMsg, content: [calBlock, ...existingContent] };
          augmentedMessages = copy;
        }
      }
    }

    const claudeStart = Date.now();
    // V57.7 — kept on Haiku 4.5. We briefly switched to Sonnet to chase
    // the OCLCC phantom-action bug, but it turned out the bug was a
    // multi-user resolution issue in resolveUserId() (missing body
    // user_id fallback). Once user resolution was fixed, Haiku works
    // fine — naavi-chat's server-side saveAlertRule() pipeline handles
    // "alert me when X" without going through Claude at all.
    console.log(`[timing] ${elapsed()} | Claude call starting | model=claude-haiku-4-5-20251001 | max_tokens=${max_tokens ?? 2048}`);
    // Prompt caching — the system prompt has two markers from get-naavi-prompt:
    //   CACHE_BOUNDARY  — separates dynamic prefix (date/time, per-request) from stable rules.
    //   END_STABLE      — separates the cacheable rules from mobile-appended per-query
    //                     context (brief items, knowledge fragments, health). That per-query
    //                     context is attached by the client AFTER the end-marker.
    //
    // We build a 3-block system array:
    //   [ dynamic, stable-with-cache_control, mobile-context-no-cache ]
    // Only the middle block is cached. Repeat calls within 5 min hit the cache for
    // the 6K+ token rules, while clock drift and per-query context don't break it.
    const CACHE_BOUNDARY = '\n---CACHE_BOUNDARY---\n';
    const END_STABLE     = '\n---END_STABLE_RULES---\n';
    let cachedSystem: any;
    if (typeof system === 'string' && system.includes(CACHE_BOUNDARY)) {
      const idx = system.indexOf(CACHE_BOUNDARY);
      const dynamicPart = system.slice(0, idx);
      const afterBoundary = system.slice(idx + CACHE_BOUNDARY.length);
      const endIdx = afterBoundary.indexOf(END_STABLE);
      let stablePart: string;
      let tailPart = '';
      if (endIdx !== -1) {
        stablePart = afterBoundary.slice(0, endIdx);
        tailPart   = afterBoundary.slice(endIdx + END_STABLE.length);
      } else {
        stablePart = afterBoundary;
      }
      // IMPORTANT: put the cached block FIRST. Anthropic's cache key includes
      // every content block preceding the cache_control breakpoint — so if the
      // dynamic prefix (which changes every minute) sits in front of the stable
      // rules, each call produces a new cache key and never hits. By putting the
      // stable rules as block 0, cache hits become order-independent of the
      // time/context that follows. Claude reads the blocks in order as one
      // system message; rules-first-then-date is semantically fine.
      cachedSystem = [
        { type: 'text', text: stablePart, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: dynamicPart },
      ];
      if (tailPart.length > 0) cachedSystem.push({ type: 'text', text: tailPart });
      console.log(`[timing] ${elapsed()} | cache split | stable=${stablePart.length} | dynamic=${dynamicPart.length} | tail=${tailPart.length}`);
    } else {
      // Legacy fallback: cache the whole string. Effective only if caller's prompt is stable.
      cachedSystem = typeof system === 'string'
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : system;
    }
    // V57.11.9 Phase 2 — Anthropic Structured Outputs migration.
    // Switch from "JSON-in-prose" parsing to schema-constrained tool use.
    // temperature=0 + tool schemas eliminate the prompt-drift cycle. Claude
    // emits tool_use blocks for actions and a separate text block for speech.
    // We synthesize the legacy { speech, actions, pendingThreads } rawText
    // shape so existing downstream consumers (orchestrator, voice server,
    // auto-tester) keep working unchanged. Phase 4 will remove the synthesis.
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: max_tokens ?? 2048,
      system: cachedSystem as any,
      messages: augmentedMessages,
      tools: NAAVI_TOOLS as any,
      temperature: 0,
    });
    const claudeMs = Date.now() - claudeStart;

    // Extract speech (text blocks) and actions (tool_use blocks) from the
    // structured response. Multiple text blocks (rare) are concatenated; tool
    // calls preserve order so REMEMBER+CREATE_EVENT fanouts arrive in sequence.
    const speechBlocks = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => String(b.text ?? ''))
      .join('');
    const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use');

    let actions = toolUseBlocks.map((b: any) => {
      const actionType = TOOL_NAME_TO_ACTION_TYPE[b.name];
      if (!actionType) {
        console.warn(`[naavi-chat] Unknown tool name from Claude: ${b.name}`);
        return null;
      }
      // Phase 3.5 — the two location tools have a flat input shape. Wrap them
      // back into the SET_ACTION_RULE shape (trigger_type='location' +
      // trigger_config={...}) the orchestrator and tests expect.
      if (b.name === 'set_location_rule_chain' || b.name === 'set_location_rule_address') {
        return convertLocationToolToActionRule(b.name, b.input ?? {});
      }
      return { type: actionType, ...(b.input ?? {}) };
    }).filter((a: any) => a !== null);

    // 2026-05-23 (Wael) — server-side entity-existence validation for
    // list_connect / list_disconnect / list_connection_query actions
    // targeting action_rule entities. Haiku has repeatedly ignored prompt
    // rules instructing it to verify the entity exists before agreeing
    // (v90/v91/v92 prompt strengthening all failed). Code-layer validation
    // is deterministic: we check Claude's emitted entityRef against the
    // user's actual action_rules; if no match, we drop the action and
    // override Claude's speech with an honest rejection that names the
    // user's real alerts. This prevents the "I'll attach to your Costco
    // alert" → user says yes → "entity not found" error-card sequence
    // that broke trust on V57.22.2 build 198 live testing.
    let serverRejectionMessage: string | null = null;

    // 2026-05-24 (Wael) — B4x. Auto-reactivate preprocessor for the
    // SECOND turn of the combined reactivate-and-attach flow. When the
    // user replies "yes" to a prior B4x ask, Claude emits LIST_CONNECT
    // / LIST_DISCONNECT targeting the disabled rule. We reactivate it
    // here BEFORE the entity-existence validator runs, so the validator
    // sees the rule as enabled and lets the action proceed. Gated by
    // isAffirmativeConfirmTurn so a fresh turn-1 request (where Haiku
    // wrongly emits the action ignoring the prompt rule) still falls
    // through to the validator and gets the combined ask shown.
    {
      const lastUserMsg = [...(messages ?? [])].reverse().find((m: any) => m.role === 'user');
      const lastUserText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      if (
        userId
        && isAffirmativeConfirmTurn(lastUserText)
        && actions.some((a: any) =>
          (a.type === 'LIST_CONNECT' || a.type === 'LIST_DISCONNECT')
          && a.entityType === 'action_rule'
          && typeof a.entityRef === 'string')
      ) {
        for (const action of actions) {
          if (
            (action.type !== 'LIST_CONNECT' && action.type !== 'LIST_DISCONNECT')
            || action.entityType !== 'action_rule'
            || typeof action.entityRef !== 'string'
          ) continue;
          try {
            const result = await matchAlertByName(supabase, userId, action.entityRef);
            if (result.disabledMatches.length === 1 && result.enabledMatches.length === 0) {
              const target = result.disabledMatches[0];
              const { error: upErr } = await supabase
                .from('action_rules')
                .update({ enabled: true, last_fired_at: null })
                .eq('id', target.id);
              if (upErr) {
                console.warn(`[naavi-chat] B4x auto-reactivate failed for "${action.entityRef}":`, upErr.message);
              } else {
                console.log(`[naavi-chat] B4x auto-reactivated disabled rule "${target.label}" (id=${target.id}) for ${action.type}`);
              }
            }
          } catch (err) {
            console.warn(`[naavi-chat] B4x auto-reactivate exception for "${action.entityRef}":`, (err as Error)?.message);
          }
        }
      }
    }

    // 2026-05-24 (Wael) — B4x. Entity-existence validator updated to
    // surface disabled-only matches as a combined reactivate-and-do-X
    // ask, multiple-disabled as disambiguation, and active+disabled
    // as disambiguation. See matchAlertByName + buildAlertMatchMessage.
    // Original 2026-05-23 logic (drop action when no enabled match)
    // is preserved as the no-match-anywhere fall-through.
    if (userId && actions.some((a: any) =>
      (a.type === 'LIST_CONNECT' || a.type === 'LIST_DISCONNECT' || a.type === 'LIST_CONNECTION_QUERY')
      && a.entityType === 'action_rule'
      && typeof a.entityRef === 'string'
    )) {
      const filtered: any[] = [];
      for (const a of actions) {
        const isEntityAction =
          (a.type === 'LIST_CONNECT' || a.type === 'LIST_DISCONNECT' || a.type === 'LIST_CONNECTION_QUERY')
          && a.entityType === 'action_rule'
          && typeof a.entityRef === 'string';
        if (isEntityAction) {
          try {
            const result = await matchAlertByName(supabase, userId, a.entityRef);
            const intentVerb = a.type === 'LIST_CONNECT' ? 'attach your list'
              : a.type === 'LIST_DISCONNECT' ? 'disconnect your list'
              : 'show what\'s attached';
            const msg = buildAlertMatchMessage(a.entityRef, result, intentVerb);
            if (msg === null) {
              // Match in ACTIVE only — proceed.
              filtered.push(a);
              continue;
            }
            // Disabled-only / multi-disabled / both-states / no-match —
            // override speech and drop the action.
            if (!serverRejectionMessage) serverRejectionMessage = msg;
            console.warn(`[naavi-chat] B4x entity-validation: dropping ${a.type} for entityRef="${a.entityRef}" (enabled=${result.enabledMatches.length}, disabled=${result.disabledMatches.length})`);
            continue;
          } catch (err) {
            console.warn('[naavi-chat] entity validation failed:', (err as Error)?.message);
            // Conservative: pass through on validation failure to avoid blocking the user.
            filtered.push(a);
            continue;
          }
        }
        filtered.push(a);
      }
      actions = filtered;
    }

    // 2026-05-23 (Wael, second pass) — USER-MESSAGE-pattern validation.
    // Live mobile test 12:25 PM showed Haiku producing contradictory
    // replies like "You have one Costco alert: 'Alert when arriving at
    // No Frills'. I don't have a Costco alert — …" — Claude fuzzy-matched
    // Costco to No Frills, then self-corrected. The earlier speech-pattern
    // validator only fires on "say yes to confirm" so it missed this shape.
    // This pre-check parses the user's message for connect/disconnect/query
    // intent + an "X alert" entity reference. If X doesn't exist in the
    // user's alerts, we override with a clean rejection — regardless of
    // what Claude said. Catches ALL malformed Claude replies for non-
    // existent entities, not just the "say yes" pattern.
    if (serverRejectionMessage === null && userId && messages?.length > 0) {
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
      const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      const CONNECT_INTENT_RE = /\b(attach|connect|detach|disconnect|what\s+lists?\s+(?:is|are)\s+on|where\s+is\s+(?:my|the))\b/i;
      if (CONNECT_INTENT_RE.test(userText)) {
        // Extract entity name: "[X] alert" — require a preposition prefix
        // (to/from/on/of) so we don't pick up "list to my Costco" as the
        // entity. Capture 1-3 short words (no embedded spaces in any
        // single word) before "alert".
        const m = userText.match(
          /\b(?:to|from|on|of)\s+(?:my|the|your)?\s*([\w'\-]+(?:\s+[\w'\-]+){0,3})\s+alert\b/i,
        );
        if (m && m[1]) {
          const entityName = m[1].trim();
          const entityLower = entityName.toLowerCase();
          const SKIP_WORDS = new Set(['arrival', 'arriving', 'location', 'new']);
          if (entityLower.length >= 2 && !SKIP_WORDS.has(entityLower)) {
            try {
              // 2026-05-24 (Wael) — B4x. Look up against both active +
              // disabled rules. If only-disabled / multi-disabled /
              // active+disabled match → override speech with combined ask
              // or disambiguation. If no match at all → existing rejection.
              const refLabel = `${entityName} alert`;
              const result = await matchAlertByName(supabase, userId, refLabel);
              const intentVerb = /\b(disconnect|detach)\b/i.test(userText) ? 'disconnect your list'
                : /\b(what\s+lists?\s+(?:is|are)\s+on|where\s+is)\b/i.test(userText) ? 'show what\'s attached'
                : 'attach your list';
              const msg = buildAlertMatchMessage(refLabel, result, intentVerb);
              if (msg !== null) {
                serverRejectionMessage = msg;
                console.warn(`[naavi-chat] B4x user-intent-validation: override for "${entityName}" (enabled=${result.enabledMatches.length}, disabled=${result.disabledMatches.length})`);
                // Drop any list_connect/disconnect/connection_query actions
                // Claude emitted for this entity — server-side ask supersedes.
                actions = actions.filter((a: any) => {
                  if (
                    (a.type === 'LIST_CONNECT' || a.type === 'LIST_DISCONNECT' || a.type === 'LIST_CONNECTION_QUERY')
                    && typeof a.entityRef === 'string'
                    && a.entityRef.toLowerCase().includes(entityLower)
                  ) return false;
                  return true;
                });
              }
            } catch (err) {
              console.warn('[naavi-chat] user-intent validation failed:', (err as Error)?.message);
            }
          }
        }
      }
    }

    // 2026-05-23 (Wael) — SPEECH-pattern validation for the wait-for-yes
    // pattern. The action-validator above only catches when Claude emits
    // a LIST_CONNECT/DISCONNECT/DELETE action. But the confirmation
    // pattern is "speech-only first turn, action on second turn" — so
    // when Claude says "I'll attach to your Costco alert. Say yes to
    // confirm…" without emitting an action, the action-validator never
    // fires. The lie persists until the user says yes and the action
    // executes (then errors). This block parses the speech for the
    // entity reference and validates against the user's actual alerts.
    if (
      serverRejectionMessage === null
      && userId
      && speechBlocks
      && /\bsay yes to confirm\b/i.test(speechBlocks)
    ) {
      // Match "(attach|connect|detach|disconnect|delete) ... to|from <entity>" pattern.
      // Anchored on the confirmation-phrase neighborhood — captures the
      // entity word(s) right before the period or the "say yes" phrase.
      const m = speechBlocks.match(
        /\b(?:attach|connect|detach|disconnect|delete)[^.,!?]*?\s+(?:to|from|of)\s+(?:your |the )?([^.,!?]+?)(?=\s*[.,?!]|\s+say yes)/i,
      );
      if (m) {
        const refRaw = m[1].trim();
        const refLower = refRaw.toLowerCase();
        const core = refLower
          .replace(/\b(alert|alerts|notification|notifications|arrival|reminder|reminders)\b/g, '')
          .trim();
        if (core.length >= 2) {
          try {
            // 2026-05-24 (Wael) — B4x. Look up against both active +
            // disabled. If Claude said "I'll attach to your <X> alert"
            // but X is only in the disabled list (or multiple disabled,
            // or both states), override with the appropriate B4x reply.
            const result = await matchAlertByName(supabase, userId, refRaw);
            const intentVerb = 'attach your list';
            const msg = buildAlertMatchMessage(refRaw, result, intentVerb);
            if (msg !== null) {
              serverRejectionMessage = msg;
              console.warn(`[naavi-chat] B4x speech-validation: override for "${refRaw}" (enabled=${result.enabledMatches.length}, disabled=${result.disabledMatches.length})`);
            }
          } catch (err) {
            console.warn('[naavi-chat] speech validation failed:', (err as Error)?.message);
          }
        }
      }
    }

    // 2026-05-24 (Wael) — B4y. Action-intent validator for SET_EMAIL_ALERT
    // and SET_ACTION_RULE(trigger_type='email'). Drops the action when
    // the user's latest message lacks an explicit create-intent phrase.
    // Defends against Claude/Haiku fabricating rules on search-shape
    // utterances ("Find McDonald alert" → unauthorized email rule with
    // keyword "you" landed in Wael's DB 2026-05-24 15:32 EST). Same
    // HAS_CREATE_INTENT pattern as detectEmailAlert above; single source
    // of truth in spirit, duplicated here because this runs after Claude
    // emission whereas detectEmailAlert runs before Claude.
    if (
      userId
      && actions.some((a: any) =>
        a.type === 'SET_EMAIL_ALERT'
        || (a.type === 'SET_ACTION_RULE' && a.trigger_type === 'email'))
    ) {
      const HAS_CREATE_INTENT_POST = /\b(alert|notify|tell|let|remind|text|email|message|ping)\s+me\b|\b(set\s+up|create|make)\s+(an?\s+)?alert\b|\blet\s+me\s+know\b/i;
      const lastUserMsgB4y = [...messages].reverse().find((m: any) => m.role === 'user');
      const userTextB4y = typeof lastUserMsgB4y?.content === 'string' ? lastUserMsgB4y.content : '';
      if (!HAS_CREATE_INTENT_POST.test(userTextB4y)) {
        const droppedCount = actions.filter((a: any) =>
          a.type === 'SET_EMAIL_ALERT'
          || (a.type === 'SET_ACTION_RULE' && a.trigger_type === 'email')).length;
        actions = actions.filter((a: any) =>
          !(a.type === 'SET_EMAIL_ALERT'
            || (a.type === 'SET_ACTION_RULE' && a.trigger_type === 'email')));
        console.warn(`[naavi-chat] B4y: dropping ${droppedCount} email-rule action(s) — user message lacks create-intent: "${userTextB4y.slice(0, 80)}"`);
        if (!serverRejectionMessage) {
          serverRejectionMessage =
            `I read that as a question, not an alert request. If you want an email alert, say something like: "Alert me when an email arrives about X."`;
        }
      }
    }

    // V57.12.1 Bug E fix — Haiku occasionally emits tool_use without a
    // companion text block, leaving speech empty and the chat blank.
    // When that happens, synthesize a short action-specific confirmation
    // so the user always gets feedback. Doesn't override Claude's own
    // narration when present.
    // 2026-05-23 — server-side rejection overrides Claude's speech when
    // an action was dropped due to entity-validation failure (see above).
    let speech = serverRejectionMessage
      ?? ((speechBlocks && speechBlocks.trim().length > 0)
            ? speechBlocks
            : buildFallbackSpeech(actions));
    if (!speechBlocks.trim() && actions.length > 0) {
      console.log(
        `[naavi-chat] Bug E fallback fired — empty speech, ${actions.length} actions, ` +
        `first=${actions[0]?.type ?? '?'} → "${speech}"`
      );
    }

    // Backward-compat rawText: orchestrator's phantom-action regex still reads
    // this. Synthesize a JSON-flavored representation so existing parsers
    // (findActionInRawText, extractSpeech, mobile parseResponse) keep working.
    let rawText = JSON.stringify({
      speech,
      actions,
      pendingThreads: [],
    });

    const usage = (response as any).usage ?? {};
    console.log(
      `[timing] ${elapsed()} | Claude call done | Claude=${claudeMs}ms | ` +
      `speech=${speech.length}c (raw=${speechBlocks.length}c) | tool_calls=${actions.length} | ` +
      `stop=${(response as any).stop_reason ?? '?'}`
    );
    console.log(`[cache-debug] usage=${JSON.stringify(usage)}`);

    // V57.9.8 normalizeRawText() was the legacy ```json fence stripper.
    // With Phase 2 we already produce clean JSON.stringify output, so the
    // pass-through is now a no-op for typical responses. Kept for safety.
    rawText = normalizeRawText(rawText);

    return jsonResponse({ rawText });

  } catch (err) {
    console.error('[naavi-chat] Error:', err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
