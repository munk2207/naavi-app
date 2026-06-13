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
import { computeContactHash, COMMUNITY_PERSON_FIELDS } from '../_shared/community_hash.ts';
import { HANDLED_INTENTS, handleListRules, handleLookupContact, handleCalendarSearch, handleGmailSearch, handlePersonLookup, handleListRead, handleReminderRead, handleMemorySearch, handleCreateTicket, HANDLED_ACTION_INTENTS, handleSetReminderExec, handleCreateEventExec, handleRememberExec, handleDeleteRuleExec, handleDeleteMemoryExec, handleAddContactExec, handleDeleteEventExec } from './intentHandlers.ts';

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
    case 'ADD_TO_COMMUNITY': return 'Added to your MyNaavi community.';
    case 'ADD_CONTACT':     return 'Contact added.';
    case 'SCHEDULE_MEDICATION': return 'Medication schedule added.';
    case 'FETCH_TRAVEL_TIME':   return 'Looking up travel time.';
    case 'SPEND_SUMMARY':       return 'Calculating that for you.';
    case 'UPDATE_MORNING_CALL': return 'Morning call updated.';
    case 'START_CALL_RECORDING':return 'Recording started.';
    default:                return 'Got it.';
  }
}

// ── MyNaavi Community helpers ─────────────────────────────────────────────────
// ADD_TO_COMMUNITY executes server-side in naavi-chat (not deferred to the
// mobile orchestrator) because it requires a Google write-scope access token.
// Pattern mirrors the inline token-refresh blocks elsewhere in this file.

const PEOPLE_GROUPS_API = 'https://people.googleapis.com/v1/contactGroups';
const COMMUNITY_GROUP_NAME = 'MyNaavi';

async function _communityGetOrCreateGroupId(accessToken: string): Promise<string | null> {
  try {
    // 1. List existing groups, look for "MyNaavi".
    const listRes = await fetch(`${PEOPLE_GROUPS_API}?pageSize=200`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (listRes.ok) {
      const listData = await listRes.json();
      const groups = (listData?.contactGroups ?? []) as Array<{ resourceName?: string; name?: string }>;
      const existing = groups.find(g => (g.name ?? '').toLowerCase() === COMMUNITY_GROUP_NAME.toLowerCase());
      if (existing?.resourceName) {
        return existing.resourceName.split('/').pop() ?? null;
      }
    }
    // 2. Group not found — create it.
    const createRes = await fetch(PEOPLE_GROUPS_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactGroup: { name: COMMUNITY_GROUP_NAME } }),
    });
    if (!createRes.ok) {
      console.warn('[community] create group failed:', createRes.status, await createRes.text());
      return null;
    }
    const created = await createRes.json();
    return (created?.resourceName as string | undefined)?.split('/')?.pop() ?? null;
  } catch (err) {
    console.error('[community] _communityGetOrCreateGroupId error:', err);
    return null;
  }
}

async function executeAddToCommunity(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  contactResourceName: string,
  contactName: string,
): Promise<string> {
  try {
    // 1. Get refresh token.
    const { data: tokenRow } = await supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .maybeSingle();
    if (!tokenRow?.refresh_token) return `I couldn't add ${contactName} — Google account not connected.`;

    // 2. Exchange for access token (needs contacts write scope).
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')  ?? '',
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
        refresh_token: tokenRow.refresh_token,
        grant_type:    'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken: string | undefined = tokenData?.access_token;
    if (!accessToken) return `I couldn't add ${contactName} — token refresh failed.`;

    // 3. Find or create the MyNaavi group.
    const groupId = await _communityGetOrCreateGroupId(accessToken);
    if (!groupId) return `I couldn't add ${contactName} — couldn't access the MyNaavi group.`;

    // 4. Add the contact to the group.
    const modifyRes = await fetch(
      `${PEOPLE_GROUPS_API}/${groupId}/members:modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceNamesToAdd: [contactResourceName] }),
      },
    );
    if (!modifyRes.ok) {
      const errText = await modifyRes.text();
      console.warn(`[community] modify failed for ${contactResourceName}:`, modifyRes.status, errText);
      return `I couldn't add ${contactName} to your community — ${modifyRes.status === 403 ? 'contacts write permission not granted yet (sign out and back in)' : 'Google returned an error'}.`;
    }
    console.log(`[community] added ${contactResourceName} (${contactName}) to MyNaavi group ${groupId}`);

    // 5. Fetch contact data and write to community_members DB (synchronous).
    // Must await before returning — fire-and-forget is killed when Edge Function
    // sends the response in Deno Deploy. DB write failure is non-fatal (logged only).
    try {
      const personRes = await fetch(
        `https://people.googleapis.com/v1/${contactResourceName}?personFields=${COMMUNITY_PERSON_FIELDS}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!personRes.ok) {
        console.warn('[community] person fetch failed:', personRes.status);
      } else {
        const person = await personRes.json();
        const contactData = {
          names:          person.names          ?? [],
          emailAddresses: person.emailAddresses ?? [],
          phoneNumbers:   person.phoneNumbers   ?? [],
        };
        const hash  = await computeContactHash(contactData);
        const name  = (person.names?.[0]?.displayName ?? contactName).trim();
        const email = person.emailAddresses?.[0]?.value ?? null;
        const phone = person.phoneNumbers?.[0]?.value   ?? null;
        const { error } = await supabase.from('community_members').upsert({
          user_id: userId, resource_name: contactResourceName,
          name, email, phone, contact_data: contactData, contact_hash: hash,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,resource_name' });
        if (error) console.warn('[community] community_members upsert error:', error.message);
        else console.log(`[community] community_members row upserted for ${contactResourceName}`);
      }
    } catch (e: any) {
      console.warn('[community] community_members write failed:', e?.message);
    }

    return `Done. ${contactName} is now in your MyNaavi community.`;
  } catch (err: any) {
    console.error('[community] executeAddToCommunity error:', err);
    return `I couldn't add ${contactName} — unexpected error: ${err?.message ?? String(err)}.`;
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

// F5c — billing intent regex. "How much did X charge me", "what did X bill me",
// "how much have I spent on X" — triggers a pipeline sync fire-and-forget so
// spend_summary finds documents on the next ask even if receipts just arrived.
const BILLING_INTENT_RE =
  /\b(how\s+much|what\s+did|what\s+has|how\s+have|how\s+many\s+dollars?).{0,40}(charge|bill|cost|invoice|receipt|charged|billed|spent|pay|paid)\b/i;

// ── B6e — calendar-read pre-Claude bypass ─────────────────────────────────────
// Discovered 2026-05-26 (Wael) via b6e-diag capture. Haiku at a 111 KB prompt
// reliably misroutes "what is on my calendar this week?" to LIST_READ /
// LIST_RULES — diag confirmed three explicit prompt rules (:958, :1012, :1251
// of get-naavi-prompt) all instructing "calendar queries → read the Schedule
// section" were ignored when the lists/alerts contexts sit at the tail of the
// prompt. Two captured reproductions of the same query against the same
// prompt yielded list_read(naavi) and list_rules(alert) — non-deterministic
// at temperature=0, classic Haiku attention loss on a long context.
//
// Fix: detect list-form calendar-read queries server-side and answer
// deterministically from fetchLiveCalendarEvents. Same pattern as
// detectEmailAlert: regex gate + intent-specific bypass. Claude is never
// called for these queries → impossible to misroute.
const CALENDAR_READ_INTENT_RE =
  /\b(?:what(?:'?s| is) (?:on |in )?(?:my|the) (?:calendar|schedule|agenda)|what (?:meetings?|events?|appointments?) do i have|show (?:me )?(?:my|the) (?:calendar|schedule|agenda)|any (?:meetings?|events?|appointments?))/i;

// Negative guard: imperative create/delete/alert verbs at the START of the
// message mean this is NOT a read intent even if the positive regex matches.
// Examples: "Schedule a lunch tomorrow", "Add Victoria Day to my calendar",
// "Delete my dentist meeting", "Alert me before my dentist meeting" — all
// have a "calendar" or "schedule" word but are not list-reads.
const CALENDAR_READ_IMPERATIVE_PREFIX_RE =
  /^(?:please\s+|hey\s+naavi[,\s]+|naavi[,\s]+)?(?:add|create|book|put|schedule\s+(?:a|an|my|the)?|set\s+up|delete|cancel|remove|alert|notify|remind|text|message|invite|forget|drop|clear)\b/i;

function isCalendarReadIntent(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (!CALENDAR_READ_INTENT_RE.test(text)) return false;
  if (CALENDAR_READ_IMPERATIVE_PREFIX_RE.test(text)) return false;
  return true;
}

type CalendarWindow = 'today' | 'tomorrow' | 'this week' | 'next week' | 'this month' | 'next 7 days';

function detectCalendarWindow(text: string): CalendarWindow {
  const lower = text.toLowerCase();
  if (/\btoday\b|\btonight\b/.test(lower))                          return 'today';
  if (/\btomorrow\b/.test(lower))                                    return 'tomorrow';
  if (/\bnext\s+week\b/.test(lower))                                 return 'next week';
  if (/\bthis\s+week\b/.test(lower))                                 return 'this week';
  if (/\bthis\s+month\b/.test(lower))                                return 'this month';
  return 'next 7 days';
}

// Filter calendar items in the brief by the requested window. The brief items
// already cover next-7-days (fetchLiveCalendarEvents fetches a 7-day window).
// For "this week" / "this month" / "next 7 days" we return everything (the
// 7-day window IS "this week" for most users — a Monday→Sunday slice would
// be more precise but the fetch helper doesn't support it, and the simpler
// behavior is honest about the window we have data for).
function filterCalendarBriefByWindow(
  items: MobileBriefItem[],
  window: CalendarWindow,
): MobileBriefItem[] {
  const cal = items.filter(i => i.category === 'calendar');
  if (window === 'today' || window === 'tomorrow') {
    // Brief detail format: "<MMM> <D> [at H:MM AM/PM | all day][ at <address>]"
    // E.g. "May 27 all day", "May 28 at 11:30 AM at 1053 Carling Avenue ..."
    // We compare the leading "MMM D" against today's / tomorrow's Toronto date.
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'America/Toronto',
    });
    const tomorrowStr = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' });
    const target = window === 'today' ? todayStr : tomorrowStr;
    return cal.filter(item => {
      const detail = item.detail ?? '';
      const m = detail.match(/^(\w+\s+\d+)/);
      return !!m && m[1] === target;
    });
  }
  // 'this week' / 'next week' / 'this month' / 'next 7 days' — return all.
  // The 7-day fetch window covers "this week" for any day-of-week the user
  // asks; "next week" / "this month" within 7 days are honestly reported.
  return cal;
}

function buildCalendarReadResponse(
  items: MobileBriefItem[],
  window: CalendarWindow,
): { speech: string; display: string; actions: any[] } {
  if (items.length === 0) {
    const whenLabel =
      window === 'today'      ? 'for today'
    : window === 'tomorrow'   ? 'for tomorrow'
    : window === 'this week'  ? 'this week'
    : window === 'next week'  ? 'next week'
    : window === 'this month' ? 'this month'
    : 'in the next 7 days';
    const empty = `Your calendar is clear ${whenLabel}.`;
    return { speech: empty, display: empty, actions: [] };
  }
  const introBase =
    window === 'today'      ? "Here's your schedule for today"
  : window === 'tomorrow'   ? "Here's what's on for tomorrow"
  : window === 'this week'  ? "Here's your schedule for this week"
  : window === 'next week'  ? "Here's your schedule for the upcoming 7 days"
  : window === 'this month' ? "Here's your schedule for the upcoming 7 days"
  : "Here's your schedule for the next 7 days";

  // Per RULE 13 + the "2+ items → numbered list" prompt rule, format as
  // numbered list. Speech uses ". " separation so TTS pauses; display uses
  // markdown numbered list.
  const speechItems = items.map((it, i) => {
    const title  = (it.title ?? 'Event').trim();
    const detail = (it.detail ?? '').trim();
    return detail ? `${i + 1}. ${title}, ${detail}` : `${i + 1}. ${title}`;
  }).join('. ');
  const speech = `${introBase}. ${speechItems}.`;

  const displayItems = items.map((it, i) => {
    const title  = (it.title ?? 'Event').trim();
    const detail = (it.detail ?? '').trim();
    return detail ? `${i + 1}. **${title}** — ${detail}` : `${i + 1}. **${title}**`;
  }).join('\n');
  const display = `${introBase}:\n\n${displayItems}`;

  return { speech, display, actions: [] };
}

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
      url2.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers');
      url2.searchParams.set('pageSize', '5');
      const res2 = await fetch(url2.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res2.ok) results = (await res2.json()).results ?? [];
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
          name:  person.names?.[0]?.displayName ?? '',
          email: person.emailAddresses?.[0]?.value ?? '',
          phone: person.phoneNumbers?.[0]?.value ?? '',
        };
      })
      .filter((c: { name: string; email: string; phone: string }) => c.name && c.email);

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

    // Fetch all user calendars first — fall back to primary on failure.
    // Previously hardcoded to primary only, which missed events on family /
    // shared / subscribed calendars (e.g. "Pick up Lila" on a family cal).
    let calendarIds: string[] = [];
    try {
      const calListRes = await fetch(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (calListRes.ok) {
        const calListData = await calListRes.json();
        const calItems = (calListData?.items ?? []) as Array<{ id: string }>;
        calendarIds = calItems.map(c => c.id).filter(Boolean);
      }
    } catch { /* ignore — fall through to primary */ }
    if (!calendarIds.length) calendarIds = ['primary'];

    // V57.11.6 — Cache-Control: no-cache so recently-edited fields aren't stale.
    const calEventArrays = await Promise.all(
      calendarIds.map(async (calId) => {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`
          + `?singleEvents=true&orderBy=startTime&maxResults=50`
          + `&timeMin=${encodeURIComponent(timeMin.toISOString())}`
          + `&timeMax=${encodeURIComponent(timeMax.toISOString())}`;
        try {
          const res = await fetch(url, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
            },
          });
          if (!res.ok) return [];
          const data = await res.json();
          return (data?.items ?? []) as Array<{
            id?: string; summary?: string; location?: string;
            start?: { dateTime?: string; date?: string };
            end?: { dateTime?: string; date?: string };
          }>;
        } catch { return []; }
      }),
    );

    // Deduplicate by event ID (same event may appear on multiple calendars).
    // Re-sort by start time since parallel fetches interleave calendars.
    const seen = new Set<string>();
    const items: Array<{
      id?: string; summary?: string; location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }> = [];
    for (const arr of calEventArrays) {
      for (const e of arr) {
        const key = e.id ?? JSON.stringify(e);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(e);
      }
    }
    items.sort((a, b) => {
      const aTime = new Date(a.start?.dateTime ?? a.start?.date ?? '').getTime();
      const bTime = new Date(b.start?.dateTime ?? b.start?.date ?? '').getTime();
      return aTime - bTime;
    });

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
    // Sync both Primary and Updates tabs — billing receipts (Anthropic, Stripe,
    // etc.) land in Updates, not Primary. Promotions/Social/Forums still excluded.
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than:1d+(category:primary+OR+category:updates)&maxResults=30`;
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

    // F5c — pipeline trigger for newly-surfaced emails.
    // Check which IDs are not yet in gmail_messages. For any that are new,
    // fire-and-forget a targeted sync-gmail so the full pipeline runs
    // (extract-email-actions → harvest-attachment → extract-document-text)
    // in the background. The current question uses the metadata below;
    // follow-up billing/document questions will find the processed results.
    try {
      const { data: existingRows } = await supabase
        .from('gmail_messages')
        .select('gmail_message_id')
        .eq('user_id', userId)
        .in('gmail_message_id', messageIds);
      const existingIds = new Set((existingRows ?? []).map((r: { gmail_message_id: string }) => r.gmail_message_id));
      const newIds = messageIds.filter(id => !existingIds.has(id));
      if (newIds.length > 0) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        fetch(`${supabaseUrl}/functions/v1/sync-gmail`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ target_user_id: userId, days_back: 1 }),
        }).catch((e: Error) => console.warn('[fetchLiveRecentEmails] pipeline trigger failed:', e?.message ?? e));
        console.log(`[fetchLiveRecentEmails] triggered pipeline for ${newIds.length} new email(s)`);
      }
    } catch (pipelineErr) {
      console.warn('[fetchLiveRecentEmails] pipeline check failed:', (pipelineErr as Error)?.message ?? pipelineErr);
    }

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
      } catch (msgErr) {
        console.warn('[fetchLiveRecentEmails] per-message fetch failed:', (msgErr as Error)?.message ?? msgErr);
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

// ─── Prompt cache ─────────────────────────────────────────────────────────────
// get-naavi-prompt is fetched on every message — ~150-250ms per call.
// Cache the result per channel for 5 minutes. Deno isolates share module-level
// memory across requests on the same instance, so most requests hit the cache.
// TTL is short enough that prompt changes (deployed via supabase functions deploy)
// take effect within one cache window without a restart.
const PROMPT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const promptCache = new Map<string, { prompt: string; fetchedAt: number }>();

async function fetchBasePrompt(
  channel: 'app' | 'voice',
  userName: string,
  userPhone: string,
): Promise<string | null> {
  // Cache key: channel only (userName/userPhone vary per user but the base
  // prompt template is the same — user-specific values are injected server-side
  // by get-naavi-prompt itself, so they don't affect cacheability here).
  const cacheKey = channel;
  const cached = promptCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < PROMPT_CACHE_TTL_MS) {
    return cached.prompt;
  }
  const supaUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  try {
    const res = await fetch(`${supaUrl}/functions/v1/get-naavi-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ channel, userName, userPhone }),
    });
    if (!res.ok) {
      console.warn('[promptCache] get-naavi-prompt non-200:', res.status);
      return null;
    }
    const data = await res.json();
    if (typeof data?.prompt === 'string' && data.prompt.length > 100) {
      promptCache.set(cacheKey, { prompt: data.prompt, fetchedAt: Date.now() });
      return data.prompt;
    }
  } catch (err) {
    console.error('[promptCache] fetch failed:', (err as Error)?.message);
  }
  return null;
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

  // 2. get-naavi-prompt → base canonical prompt (channel-tailored).
  //    fetchBasePrompt caches the result for 5 min — saves ~150-250ms on
  //    every warm request (most requests in a session).
  const base = await fetchBasePrompt(
    opts.channel === 'voice' ? 'voice' : 'app',
    userName,
    userPhone,
  );

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

// ── Layer 2 — Intent classifier ───────────────────────────────────────────────
//
// Regex gate: only classify messages that look like they could be a handled
// intent (LIST_RULES, LOOKUP_CONTACT, CALENDAR_SEARCH). Intentionally tight —
// a false negative (misses a candidate) just falls through to Claude; a false
// positive (wrongly intercepts) breaks a user-facing query. Err toward tight.
//
// LIST_RULES:      "list my alerts", "show my rules", "what alerts do I have"
// CALENDAR_SEARCH: "do I have a dentist appointment", "is my dentist on my calendar"
// LOOKUP_CONTACT:  "find Bob", "look up Hussein"
// PATH B (no handler, disclosed as best-effort):
//   "when is my next X", "how far/long to X", "what did I spend on X",
//   "what time is my X", "is X on my calendar"
const LAYER2_CANDIDATE_RE =
  /\b(list|show)\s+(me\s+)?my\s+(alerts?|rules?|notifications?)\b|\bwhat\s+(alerts?|rules?|notifications?)\s+do\s+i\s+have\b|\bwhat\s+are\s+my\s+(alerts?|rules?|notifications?)\b|\bdo\s+i\s+have\s+(a[n]?\s+)?\w[\w\s]{0,30}(appointment|meeting|event)\b|\b(find|look\s+up)\s+(?!all\b|any\b|my\b|the\b|some\b|more\b|out\b|a\b|an\b|this\b|that\b)[A-Za-z][\w\s]{1,30}(in\s+my\s+contacts|contact)?\b|\bwhen\s+is\s+my\s+(next\s+)?\w[\w\s]{0,20}\b|\bhow\s+(far|long|much\s+time)\b.{0,40}\b(to|from|until)\b|\bwhat\s+(time|day|date)\s+is\s+my\b|\bwhat\s+did\s+i\s+(spend|pay|buy|order)\b|\bis\s+.{0,30}(on\s+my\s+calendar|in\s+my\s+contacts)\b|\bwhat\s+do\s+(we|you)\s+(have|know)\s+(about|on)\s+[A-Za-z]\w*\b|\btell\s+me\s+(everything\s+)?about\s+[A-Za-z]\w*\b|\bwho\s+is\s+[A-Za-z]\w[\w\s]{0,30}\b|\bdo\s+you\s+know\s+anything\s+about\s+[A-Za-z]\w*\b|\bwhat\s+(lists?|list\s+do)\s+(do\s+i\s+have|i\s+have|have)\b|\bwhat('?s|\s+is)\s+on\s+my\s+\w[\w\s]{0,20}list\b|\bshow\s+(me\s+)?my\s+(grocery|shopping|to.?do|todo|\w+)\s+list\b|\bwhat\s+reminders?\s+do\s+i\s+have\b|\bshow\s+(me\s+)?my\s+reminders?\b|\bwhat\s+am\s+i\s+(being\s+)?reminded\b|\bwhat\s+did\s+i\s+(tell|save|remember|ask)\s+(you|naavi)?\s*(about|to\s+remember)?\b|\bwhat\s+do\s+you\s+remember\s+about\b|\bwhat'?s\s+[A-Za-z]\w[\w\s]{0,20}'?s?\s+(email|phone|number|address|contact)\b|\bdoes\s+[A-Za-z]\w[\w\s]{0,20}have\s+(a\s+)?(phone|email|number|address)\b|\bwhat\s+is\s+[A-Za-z]\w[\w\s]{0,20}'?s?\s+(email|phone|number|address)\b/i;

type IntentClassification = {
  level: 'A' | 'B' | 'action' | 'chat';
  intent: string;
  confidence: 'high' | 'low';
  params: Record<string, string>;
};

async function classifyIntent(
  client: Anthropic,
  userText: string,
): Promise<IntentClassification | null> {
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      temperature: 0,
      system: `Classify the message. JSON only. No fences.
Today (America/Toronto): ${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })}. Use to resolve "tomorrow", "next Friday", etc. into ISO8601 with Toronto offset (e.g. "2026-06-14T15:00:00-04:00").

Levels:
A = answerable from user's real data (calendar, contacts, alerts, lists, reminders, memories, email). Use intents: LIST_RULES, LOOKUP_CONTACT, CALENDAR_SEARCH, GMAIL_SEARCH, PERSON_LOOKUP, LIST_READ, REMINDER_READ, MEMORY_SEARCH, CREATE_TICKET
B = data question Claude must reason about (no real source)
action = creating/updating/deleting data (reminder, alert, event, memory, list item)
chat = conversational, no data question

Level A params: CALENDAR_SEARCH→keyword (core noun only, strip "appointment/meeting"). CALENDAR_SEARCH ONLY for calendar/schedule/appointment queries — NEVER for email queries. GMAIL_SEARCH→keyword (sender name, subject word, or topic). GMAIL_SEARCH for any query about receiving/checking email: "Did I get email from X", "Did I receive email from X", "Any email from X", "Check my email for X" → GMAIL_SEARCH. LOOKUP_CONTACT/PERSON_LOOKUP→name. LIST_READ→listName. MEMORY_SEARCH→topic. CREATE_TICKET→reporter_email, body.

Level action intents and params (extract what's present, empty string if not mentioned):
SET_REMINDER → title (what to remember), datetime (ISO8601 Toronto). ONLY use for "remind me at [specific time]" — user must state an explicit time/date. e.g. "remind me to call John tomorrow at 3pm".
CREATE_EVENT → summary (event name), start (ISO8601 Toronto), end (ISO8601 Toronto, default start+1h)
REMEMBER → text (exact statement to save). Use for "remember that X", "note that X", "my wife is Sarah" — no time component.
DELETE_RULE → match (keyword describing the alert to delete), all ("true" only if user says delete all alerts)
DELETE_MEMORY → keyword (what to forget)
ADD_CONTACT → name, phone (E.164 if given), email (if given)
DRAFT_MESSAGE → to_name (recipient name), body (message text), to_phone (E.164 if known)
DELETE_EVENT → query (event name/keyword to find and delete)
SET_ACTION_RULE → location/email/time/contact-silence alerts. Params: trigger_type (email|location|time|contact_silence), from (email sender name/address), subject_keyword (keyword in subject line, e.g. "board meeting"), location (place name for location trigger), direction (arrive|leave). e.g. "alert me when I arrive at X" → {trigger_type:"location",location:"X",direction:"arrive"}; "alert me when email from Bob about board meeting" → {trigger_type:"email",from:"Bob",subject_keyword:"board meeting"}. NOT a reminder — no time param needed.
LIST_CONNECTION_QUERY → connecting/disconnecting a list to an alert. e.g. "add my X list to my Y alert", "connect my grocery list to Costco alert".

Output: {"level":"A","intent":"LIST_RULES","confidence":"high","params":{}}
Use "low" confidence when ambiguous.`,
      messages: [{ role: 'user', content: userText }],
    });

    const text = res.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => String(b.text ?? ''))
      .join('');

    const clean = text.replace(/```(?:json)?/gi, '').trim();
    const start = clean.indexOf('{');
    const end   = clean.lastIndexOf('}');
    if (start < 0 || end < 0) return null;

    const parsed = JSON.parse(clean.slice(start, end + 1));
    if (typeof parsed?.intent !== 'string') return null;
    const validLevels = ['A', 'B', 'action', 'chat'];
    return {
      level:      validLevels.includes(parsed.level) ? parsed.level as 'A'|'B'|'action'|'chat' : 'B',
      intent:     String(parsed.intent),
      confidence: parsed.confidence === 'low' ? 'low' : 'high',
      params:     typeof parsed.params === 'object' && parsed.params !== null ? parsed.params : {},
    };
  } catch (err) {
    console.warn('[classifyIntent] failed:', (err as Error)?.message);
    return null;
  }
}

// ── buildActionConfirm ────────────────────────────────────────────────────────
// Generates a deterministic confirm speech string from Haiku-extracted params.
// Returns { speech, display, actions, missingParam? }.
// missingParam is set when a required param is absent — caller asks for it instead.
// For DRAFT_MESSAGE, returns the action immediately (DraftCard is the confirm UI).

function fmtDtLocal(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-CA', {
      timeZone: 'America/Toronto', weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

function buildActionConfirm(
  intent: string,
  params: Record<string, string>,
): { speech: string; display: string; actions: unknown[]; missingParam?: string } {
  switch (intent) {
    case 'SET_REMINDER': {
      if (!params.title)    return { speech: '', display: '', actions: [], missingParam: "What should I remind you about?" };
      if (!params.datetime) return { speech: '', display: '', actions: [], missingParam: "When should I remind you?" };
      const label = fmtDtLocal(params.datetime);
      const s = `I'll remind you: ${params.title} on ${label}. Say yes to confirm, no to cancel.`;
      return { speech: s, display: s, actions: [] };
    }
    case 'CREATE_EVENT': {
      if (!params.summary) return { speech: '', display: '', actions: [], missingParam: "What's the event name?" };
      if (!params.start)   return { speech: '', display: '', actions: [], missingParam: "When is it?" };
      const label = fmtDtLocal(params.start);
      const s = `I'll add "${params.summary}" to your calendar on ${label}. Say yes to confirm, no to cancel.`;
      return { speech: s, display: s, actions: [] };
    }
    case 'REMEMBER': {
      if (!params.text) return { speech: '', display: '', actions: [], missingParam: "What would you like me to remember?" };
      const snippet = params.text.slice(0, 80);
      const s = `I'll save: "${snippet}". Say yes to confirm, no to cancel.`;
      return { speech: s, display: s, actions: [] };
    }
    case 'DELETE_RULE': {
      if (!params.match && params.all !== 'true') return { speech: '', display: '', actions: [], missingParam: "Which alert should I delete? Tell me the place, keyword, or contact it's for." };
      const s = params.all === 'true'
        ? `I'll delete all your alerts. Say yes to confirm, no to cancel.`
        : `I'll delete your "${params.match}" alert. Say yes to confirm, no to cancel.`;
      return { speech: s, display: s, actions: [] };
    }
    case 'DELETE_MEMORY': {
      if (!params.keyword) return { speech: '', display: '', actions: [], missingParam: "What should I forget? Give me a topic or keyword." };
      const s = `I'll forget everything I have about "${params.keyword}". Say yes to confirm, no to cancel.`;
      return { speech: s, display: s, actions: [] };
    }
    case 'ADD_CONTACT': {
      if (!params.name) return { speech: '', display: '', actions: [], missingParam: "What's the contact's name?" };
      const detail = [params.phone, params.email].filter(Boolean).join(', ');
      const s = detail
        ? `I'll add ${params.name} (${detail}) to your contacts. Say yes to confirm, no to cancel.`
        : `I'll add ${params.name} to your contacts. Say yes to confirm, no to cancel.`;
      return { speech: s, display: s, actions: [] };
    }
    case 'DELETE_EVENT': {
      if (!params.query) return { speech: '', display: '', actions: [], missingParam: "Which calendar event should I delete?" };
      const s = `I'll delete "${params.query}" from your calendar. Say yes to confirm, no to cancel.`;
      return { speech: s, display: s, actions: [] };
    }
    case 'DRAFT_MESSAGE': {
      if (!params.to_name) return { speech: '', display: '', actions: [], missingParam: "Who should I send the message to?" };
      if (!params.body)    return { speech: '', display: '', actions: [], missingParam: "What should the message say?" };
      const s = `Here's your draft to ${params.to_name}: "${params.body.slice(0, 100)}". Review it in the card below.`;
      const action = { type: 'DRAFT_MESSAGE', to: params.to_name, to_phone: params.to_phone ?? '', body: params.body };
      return { speech: s, display: s, actions: [action] };
    }
    case 'SET_ACTION_RULE': {
      const tt = String(params.trigger_type ?? '');
      if (tt === 'email') {
        if (!params.from && !params.subject_keyword) {
          return { speech: '', display: '', actions: [], missingParam: "Who should the email be from, or what keyword should be in the subject?" };
        }
        const fromPart = params.from ? `from ${params.from}` : '';
        const kwPart   = params.subject_keyword ? `about "${params.subject_keyword}"` : '';
        const desc     = [fromPart, kwPart].filter(Boolean).join(' ');
        const s = `I'll alert you when an email ${desc} arrives. Say yes to confirm, no to cancel, or tell me what to change.`;
        return { speech: s, display: s, actions: [] };
      }
      if (tt === 'location') {
        // Location requires mobile resolve-place flow — emit action immediately so
        // useOrchestrator handles place resolution before writing the rule.
        // V57.19: default one_shot=true unless user explicitly said "every time" / "recurring".
        const place    = String(params.location ?? params.place ?? '');
        const dir      = params.direction === 'leave' ? 'leave' : 'arrive at';
        const s        = place ? `Setting up an alert for when you ${dir} ${place}.` : '';
        const one_shot = params.one_shot === 'false' || params.recurring === 'true' ? false : true;
        return { speech: s, display: s, actions: [{ type: 'SET_ACTION_RULE', ...params, one_shot }] };
      }
      // Other trigger types (time, contact_silence, weather) — fall through to Claude
      return { speech: '', display: '', actions: [], missingParam: '__FALLTHROUGH__' };
    }
    default:
      return { speech: '', display: '', actions: [] };
  }
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

    // ── Step 1.5 (B6e 2026-05-26): pre-Claude calendar-read bypass ─────────────
    // Haiku at the 111 KB assembled prompt misroutes "what is on my calendar
    // this week?" to LIST_READ / LIST_RULES even when the brief contains the
    // correct calendar items and three explicit prompt rules say "read the
    // Schedule section." Bypass returns deterministic brief contents.
    if (isCalendarReadIntent(userText)) {
      console.log(`[timing] ${elapsed()} | B6e bypass — calendar-read intent detected`);
      const liveEvents = await fetchLiveCalendarEvents(supabase, userId);
      const window     = detectCalendarWindow(userText);
      const filtered   = filterCalendarBriefByWindow(liveEvents, window);
      const built      = buildCalendarReadResponse(filtered, window);
      console.log(`[timing] ${elapsed()} | B6e bypass — events=${liveEvents.length} | filtered=${filtered.length} | window=${window}`);
      return jsonResponse({
        rawText: JSON.stringify({
          speech:         built.speech,
          display:        built.display,
          actions:        built.actions,
          pendingThreads: [],
        }),
      });
    }

    // ── Step 1.4: Low-confidence intent confirmation resolver ─────────────────────
    // When the previous assistant turn asked "I think you're asking me to X — is that
    // right?" (low-confidence Layer 2), and Robert replies with yes or no, execute
    // or drop the pending intent without calling Claude.
    {
      const YES_RE = /^\s*(yes|yeah|yep|yup|correct|right|confirm|go ahead|do it|please|ok|okay|sure|absolutely|definitely|affirmative)\s*[.!]?\s*$/i;
      const NO_RE  = /^\s*(no|nope|nah|cancel|stop|never mind|nevermind|forget it|don't)\s*[.!]?\s*$/i;

      if (YES_RE.test(userText) || NO_RE.test(userText)) {
        const lastAssistant = [...(messages ?? [])]
          .reverse()
          .find((m: any) => m.role === 'assistant');
        const lastDisplay: string = (() => {
          const c = lastAssistant?.content;
          if (typeof c === 'string') return c;
          if (Array.isArray(c)) return c.filter((b: any) => b.type === 'text').map((b: any) => String(b.text ?? '')).join('');
          // Also check rawText if the last message is the structured naavi format
          return '';
        })();

        // Try to extract PENDING_INTENT from the display field
        const markerMatch = lastDisplay.match(/<!--PENDING_INTENT:(\{.*?\})-->/s);
        if (markerMatch) {
          if (NO_RE.test(userText)) {
            const msg = `No problem — just let me know what you need.`;
            console.log(`[timing] ${elapsed()} | Step1.4 — low-confidence intent cancelled`);
            return jsonResponse({ rawText: JSON.stringify({ speech: msg, display: msg, actions: [], pendingThreads: [] }) });
          }

          try {
            const pending: IntentClassification = JSON.parse(markerMatch[1]);
            console.log(`[timing] ${elapsed()} | Step1.4 — executing confirmed intent: ${pending.intent}`);

            if (pending.intent === 'LIST_RULES') {
              const result = await handleListRules(supabase, userId);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'LOOKUP_CONTACT' && pending.params.name) {
              const result = await handleLookupContact(supabase, userId, pending.params.name);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'CALENDAR_SEARCH' && pending.params.keyword) {
              const liveEvents = await fetchLiveCalendarEvents(supabase, userId);
              const result = await handleCalendarSearch(liveEvents, pending.params.keyword);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'PERSON_LOOKUP' && pending.params.name) {
              const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
              const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
              const result = await handlePersonLookup(pending.params.name, userId, supabaseUrl, serviceKey);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'LIST_READ') {
              const result = await handleListRead(supabase, userId, pending.params.listName);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'REMINDER_READ') {
              const result = await handleReminderRead(supabase, userId);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'MEMORY_SEARCH' && pending.params.topic) {
              const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
              const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
              const result = await handleMemorySearch(pending.params.topic, userId, supabaseUrl, serviceKey);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'CREATE_TICKET' && pending.params.reporter_email && pending.params.body) {
              const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
              const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
              const result = await handleCreateTicket(
                pending.params as { reporter_email: string; body: string; staff_email: string },
                supabaseUrl,
                serviceKey,
              );
              console.log(`[timing] ${elapsed()} | Level A CREATE_TICKET executed`);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            // ── Action intent executions (Turn 2 after user confirmed) ──────────
            if (pending.intent === 'SET_REMINDER' && pending.params.title && pending.params.datetime) {
              const _url = Deno.env.get('SUPABASE_URL') ?? '';
              const _key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
              const result = await handleSetReminderExec(
                pending.params as { title: string; datetime: string },
                userId, supabase, _url, _key,
              );
              console.log(`[timing] ${elapsed()} | SET_REMINDER executed`);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'CREATE_EVENT' && pending.params.summary && pending.params.start) {
              const _url = Deno.env.get('SUPABASE_URL') ?? '';
              const _key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
              const result = await handleCreateEventExec(
                pending.params as { summary: string; start: string; end?: string; description?: string },
                userId, _url, _key,
              );
              console.log(`[timing] ${elapsed()} | CREATE_EVENT executed`);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'REMEMBER' && pending.params.text) {
              const _url = Deno.env.get('SUPABASE_URL') ?? '';
              const _key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
              const result = await handleRememberExec(pending.params as { text: string }, userId, _url, _key);
              console.log(`[timing] ${elapsed()} | REMEMBER executed`);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'DELETE_RULE') {
              const _url = Deno.env.get('SUPABASE_URL') ?? '';
              const _key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
              const result = await handleDeleteRuleExec(
                pending.params as { match: string; all?: string },
                userId, _url, _key,
              );
              console.log(`[timing] ${elapsed()} | DELETE_RULE executed`);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'DELETE_MEMORY' && pending.params.keyword) {
              const result = await handleDeleteMemoryExec(
                pending.params as { keyword: string },
                userId, supabase,
              );
              console.log(`[timing] ${elapsed()} | DELETE_MEMORY executed`);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'ADD_CONTACT' && pending.params.name) {
              const _url = Deno.env.get('SUPABASE_URL') ?? '';
              const _key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
              const result = await handleAddContactExec(
                pending.params as { name: string; phone?: string; email?: string },
                userId, _url, _key,
              );
              console.log(`[timing] ${elapsed()} | ADD_CONTACT executed`);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'DELETE_EVENT' && pending.params.query) {
              const _url = Deno.env.get('SUPABASE_URL') ?? '';
              const _key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
              const result = await handleDeleteEventExec(
                pending.params as { query: string },
                userId, _url, _key,
              );
              console.log(`[timing] ${elapsed()} | DELETE_EVENT executed`);
              return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
            }
            if (pending.intent === 'SET_ACTION_RULE') {
              // Emit the action for mobile useOrchestrator to execute (writes action_rules row)
              const action = { type: 'SET_ACTION_RULE', ...pending.params };
              const tt = String(pending.params.trigger_type ?? '');
              const fromPart = pending.params.from ? `from ${pending.params.from}` : '';
              const kwPart   = pending.params.subject_keyword ? `about "${pending.params.subject_keyword}"` : '';
              const desc     = tt === 'email'
                ? `Email alert${[fromPart, kwPart].filter(Boolean).length ? ' ' + [fromPart, kwPart].filter(Boolean).join(' ') : ''} set.`
                : `Alert set.`;
              const speech = `Done. ${desc}`;
              console.log(`[timing] ${elapsed()} | SET_ACTION_RULE confirmed — action emitted for mobile`);
              return jsonResponse({ rawText: JSON.stringify({ speech, display: speech, actions: [action], pendingThreads: [] }) });
            }
          } catch (_) { /* fall through to Claude */ }
        }
      }
    }

    // ── Step 1.5: Disambiguation resolver ────────────────────────────────────────
    // When the previous assistant turn presented a numbered contact list ("Which one?"),
    // and Robert's reply is a pick ("# 2", "the second one", "number 2", "2"),
    // resolve it directly without calling Claude again.
    {
      const lastAssistant = [...(messages ?? [])]
        .reverse()
        .find((m: any) => m.role === 'assistant');
      const lastText: string = typeof lastAssistant?.content === 'string'
        ? lastAssistant.content
        : (lastAssistant?.content ?? [])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => String(b.text ?? ''))
            .join('');

      const isDisambig = lastText.includes('Which one?') && /\b\d+\.\s/.test(lastText);
      if (isDisambig) {
        // Parse a pick from the user: "# 2", "#2", "2", "number 2", "the second", "second one"
        const pickMatch = userText.match(
          /^#\s*(\d+)|^(\d+)\s*$|number\s+(\d+)|the\s+(\d+)(st|nd|rd|th)?|\bfirst\b|\bsecond\b|\bthird\b|\bfourth\b|\bfifth\b/i
        );
        const wordMap: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
        let pickIndex: number | null = null;
        if (pickMatch) {
          const digit = pickMatch[1] ?? pickMatch[2] ?? pickMatch[3] ?? pickMatch[4];
          if (digit) {
            pickIndex = parseInt(digit, 10);
          } else {
            const word = (userText.match(/\bfirst\b|\bsecond\b|\bthird\b|\bfourth\b|\bfifth\b/i) ?? [])[0]?.toLowerCase();
            if (word) pickIndex = wordMap[word] ?? null;
          }
        }

        if (pickIndex !== null) {
          // Extract numbered lines from the last assistant message
          const lineRe = /(\d+)\.\s+(.+?)(?=\n\d+\.|\n\n|$)/gs;
          const entries: Array<{ idx: number; text: string }> = [];
          let m: RegExpExecArray | null;
          while ((m = lineRe.exec(lastText)) !== null) {
            entries.push({ idx: parseInt(m[1], 10), text: m[2].trim() });
          }
          const chosen = entries.find(e => e.idx === pickIndex);
          if (chosen) {
            const speech  = `Got it — ${chosen.text}.`;
            const display = `Got it — **${chosen.text}**.`;
            console.log(`[timing] ${elapsed()} | Disambiguation resolved: pick=${pickIndex} → "${chosen.text}"`);
            return jsonResponse({
              rawText: JSON.stringify({ speech, display, actions: [], pendingThreads: [] }),
            });
          }
        }
      }
    }

    // ── Step 1.6: Universal gate — every message classified, no exceptions ────────
    // Every message is classified as Level A (answerable from Robert's real data),
    // Level B (Claude reasoning, disclosed as best-effort), Level action (state-
    // changing, RULE 23 handles confirmation), or Level chat (conversational,
    // Claude responds naturally). No message ever passes to Claude unclassified.
    //
    // Level A → deterministic handler → verified answer, no qualifier
    // Level B → Claude answers + Path B disclosure always wraps the response
    // Level action → Claude answers, no disclosure (RULE 23 confirm-then-act)
    // Level chat → Claude answers naturally, no disclosure
    //
    // ── CREATE_TICKET pre-classifier intercept ───────────────────────────────
    // "Open a ticket", "create a ticket", etc. are write operations — Haiku
    // misclassifies them as Level action (not Level A) because Level A is
    // described as "answerable from user's real data." Bypass Haiku entirely
    // and route straight to the CREATE_TICKET Level A handler.
    const CREATE_TICKET_RE = /\b(open|create|log|file|submit|raise)\s+(a\s+)?(support\s+)?(ticket|issue|report)\b/i;
    if (CREATE_TICKET_RE.test(userText)) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const adminClient = createClient(supabaseUrl, serviceKey);
      // Verify caller is authorized staff
      const { data: userData } = await adminClient.auth.admin.getUserById(userId);
      const staffEmail = userData?.user?.email ?? '';
      const { data: staffRow } = await adminClient
        .from('support_staff')
        .select('email')
        .eq('email', staffEmail)
        .eq('active', true)
        .maybeSingle();
      if (!staffRow) {
        const msg = `You're not authorized to create support tickets.`;
        console.log(`[timing] ${elapsed()} | CREATE_TICKET_RE — unauthorized: ${staffEmail}`);
        return jsonResponse({ rawText: JSON.stringify({ speech: msg, display: msg, actions: [], pendingThreads: [] }) });
      }
      // Extract reporter_email and body from message
      const emailMatch = userText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      const reporterEmail = emailMatch ? emailMatch[0].toLowerCase() : '';
      // Strip enrichment context before extracting body — everything from
      // "## Live search results" onwards is internal context, not user input.
      const cleanText = userText.split(/\n\n##\s+Live search results/i)[0];
      // Body = everything after the email, or after the ticket phrase if no email found
      const bodyRaw = cleanText
        .replace(CREATE_TICKET_RE, '')
        .replace(reporterEmail, '')
        .replace(/^\s*(for|to|about|re:?|:|-|—)\s*/i, '')
        .trim();
      const body = bodyRaw || '';
      if (!reporterEmail) {
        const msg = `I need the customer's email address to create a ticket. What's their email?`;
        return jsonResponse({ rawText: JSON.stringify({ speech: msg, display: msg, actions: [], pendingThreads: [] }) });
      }
      if (!body) {
        const msg = `What's the issue you'd like to log for ${reporterEmail}?`;
        return jsonResponse({ rawText: JSON.stringify({ speech: msg, display: msg, actions: [], pendingThreads: [] }) });
      }
      // Return confirmation ask — ticket created on turn 2
      // body is already stripped of enrichment context; safe to show to staff
      const pending = { intent: 'CREATE_TICKET', level: 'A', confidence: 'high', params: { reporter_email: reporterEmail, body, staff_email: staffEmail } };
      const confirmMsg = `I'll create a ticket for ${reporterEmail}: "${body.slice(0, 100)}". Say yes to confirm.`;
      const display    = `${confirmMsg}\n<!--PENDING_INTENT:${JSON.stringify(pending)}-->`;
      console.log(`[timing] ${elapsed()} | CREATE_TICKET_RE — awaiting confirmation from ${staffEmail}`);
      return jsonResponse({ rawText: JSON.stringify({ speech: confirmMsg, display, actions: [], pendingThreads: [] }) });
    }

    // Fast pre-filter: obvious conversational messages skip Haiku entirely.
    // Keeps the universal guarantee (nothing unclassified reaches Claude) while
    // eliminating the Haiku cost for greetings, thanks, and short follow-ups.
    // FAST_CHAT_RE — messages that skip the classifier (no Haiku pre-call).
    // Group A: short social/acknowledgement phrases.
    // Group B: common question patterns that are clearly conversational and
    //   never match a Level-A deterministic intent. Calendar/contact/list/
    //   reminder reads are intentionally NOT here — the classifier handles them.
    const FAST_CHAT_RE = /^\s*(hi|hello|hey|good\s*(morning|afternoon|evening|night)|thanks?|thank\s+you|ok|okay|great|perfect|sounds\s+good|got\s+it|understood|sure|bye|goodbye|see\s+you|later|awesome|nice|cool|wow|really|interesting|haha|lol|not\s+really|no\s+thanks|never\s+mind|that'?s\s+(ok|fine|great|all)|yes|yeah|yep|confirm|approved|go\s+ahead|do\s+it|please|no|nope|cancel|stop|what('?s|\s+is)\s+the\s+weather|how('?s|\s+is)\s+the\s+weather|what\s+should\s+i\s+wear|what\s+time\s+is\s+it|what\s+(is\s+the\s+time|time\s+is\s+it)(\s+now)?|what\s+day\s+is\s+(it|today)|what('?s|\s+is)\s+(today|the\s+date)|what\s+is\s+today\s+(date|day)|tell\s+me\s+(a\s+joke|something)|how\s+are\s+you|are\s+you\s+there)\s*[.!?]?\s*$/i;
    // List-connection queries ("where is my X list connected?", "what list is on my X alert?")
    // require Claude's LIST_CONNECTION_QUERY action — bypass the classifier entirely.
    const LIST_CONNECTION_RE = /\b(where\s+is\s+.{0,30}connected|what\s+list(s)?\s+is\s+on\s+my|what\s+list(s)?\s+are\s+on\s+.{0,40}|connected\s+to\s+my\s+(alert|rule))\b/i;
    let pathB = false;
    if (FAST_CHAT_RE.test(userText) || LIST_CONNECTION_RE.test(userText)) {
      // Instant pass-through — no Haiku call needed
      console.log(`[timing] ${elapsed()} | Fast pre-filter: ${FAST_CHAT_RE.test(userText) ? 'chat' : 'list-connection'} — skipping classifier`);
    } else {
      const apiKeyL2 = Deno.env.get('ANTHROPIC_API_KEY');
      if (apiKeyL2) {
        const clientL2 = new Anthropic({ apiKey: apiKeyL2 });
        const classification = await classifyIntent(clientL2, userText);
        console.log(`[timing] ${elapsed()} | Universal gate classification: ${JSON.stringify(classification)}`);

        if (classification) {
          // ── Level A — answer from Robert's real data ──────────────────────────
          if (classification.level === 'A') {
            if (classification.confidence === 'low') {
              const intentDesc =
                classification.intent === 'LIST_RULES'      ? 'see your alerts'
              : classification.intent === 'LOOKUP_CONTACT'  ? `find a contact named "${classification.params.name ?? ''}"`
              : classification.intent === 'CALENDAR_SEARCH' ? `find "${classification.params.keyword ?? ''}" on your calendar`
              : classification.intent === 'PERSON_LOOKUP'   ? `search everything I have about "${classification.params.name ?? ''}"`
              : classification.intent === 'LIST_READ'       ? (classification.params.listName ? `show your ${classification.params.listName} list` : 'show your lists')
              : classification.intent === 'REMINDER_READ'   ? 'show your upcoming reminders'
              : classification.intent === 'MEMORY_SEARCH'   ? `search your saved memories about "${classification.params.topic ?? ''}"`
              : 'help with that';
              const pendingMarker = `<!--PENDING_INTENT:${JSON.stringify({ intent: classification.intent, params: classification.params })}-->`;
              const confirmSpeech = `I think you're asking me to ${intentDesc} — is that right?`;
              return jsonResponse({
                rawText: JSON.stringify({
                  speech: confirmSpeech,
                  display: `${confirmSpeech}\n${pendingMarker}`,
                  actions: [],
                  pendingThreads: [],
                }),
              });
            }

            if (HANDLED_INTENTS.has(classification.intent)) {
              if (classification.intent === 'LIST_RULES') {
                const result = await handleListRules(supabase, userId);
                console.log(`[timing] ${elapsed()} | Level A LIST_RULES deterministic`);
                return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
              }
              if (classification.intent === 'LOOKUP_CONTACT' && classification.params.name) {
                const result = await handleLookupContact(supabase, userId, classification.params.name);
                console.log(`[timing] ${elapsed()} | Level A LOOKUP_CONTACT deterministic`);
                return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
              }
              if (classification.intent === 'CALENDAR_SEARCH' && classification.params.keyword) {
                const liveEventsL2 = await fetchLiveCalendarEvents(supabase, userId);
                const result = await handleCalendarSearch(liveEventsL2, classification.params.keyword);
                console.log(`[timing] ${elapsed()} | Level A CALENDAR_SEARCH deterministic`);
                return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
              }
              if (classification.intent === 'GMAIL_SEARCH' && classification.params.keyword) {
                const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
                const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
                const result = await handleGmailSearch(classification.params.keyword, userId, supabaseUrl, serviceKey);
                console.log(`[timing] ${elapsed()} | Level A GMAIL_SEARCH deterministic`);
                return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
              }
              if (classification.intent === 'PERSON_LOOKUP' && classification.params.name) {
                const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
                const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
                const result = await handlePersonLookup(classification.params.name, userId, supabaseUrl, serviceKey);
                console.log(`[timing] ${elapsed()} | Level A PERSON_LOOKUP deterministic`);
                return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
              }
              if (classification.intent === 'LIST_READ') {
                const result = await handleListRead(supabase, userId, classification.params.listName);
                console.log(`[timing] ${elapsed()} | Level A LIST_READ deterministic`);
                return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
              }
              if (classification.intent === 'REMINDER_READ') {
                const result = await handleReminderRead(supabase, userId);
                console.log(`[timing] ${elapsed()} | Level A REMINDER_READ deterministic`);
                return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
              }
              if (classification.intent === 'MEMORY_SEARCH' && classification.params.topic) {
                const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
                const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
                const result = await handleMemorySearch(classification.params.topic, userId, supabaseUrl, serviceKey);
                console.log(`[timing] ${elapsed()} | Level A MEMORY_SEARCH deterministic`);
                return jsonResponse({ rawText: JSON.stringify({ speech: result.speech, display: result.display, actions: result.actions, pendingThreads: [] }) });
              }
              if (classification.intent === 'CREATE_TICKET') {
                const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
                const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
                const adminClient = createClient(supabaseUrl, serviceKey);
                // Verify caller is authorized staff
                const { data: userData } = await adminClient.auth.admin.getUserById(userId);
                const staffEmail = userData?.user?.email ?? '';
                const { data: staffRow } = await adminClient
                  .from('support_staff')
                  .select('email')
                  .eq('email', staffEmail)
                  .eq('active', true)
                  .maybeSingle();
                if (!staffRow) {
                  const msg = `You're not authorized to create support tickets.`;
                  console.log(`[timing] ${elapsed()} | Level A CREATE_TICKET — unauthorized: ${staffEmail}`);
                  return jsonResponse({ rawText: JSON.stringify({ speech: msg, display: msg, actions: [], pendingThreads: [] }) });
                }
                // Validate required params
                const reporterEmail = String(classification.params.reporter_email ?? '').trim();
                const body          = String(classification.params.body ?? '').trim();
                if (!reporterEmail || !/@/.test(reporterEmail)) {
                  const msg = `I need the customer's email address to create a ticket. What's their email?`;
                  return jsonResponse({ rawText: JSON.stringify({ speech: msg, display: msg, actions: [], pendingThreads: [] }) });
                }
                if (!body) {
                  const msg = `What's the issue you'd like to log for ${reporterEmail}?`;
                  return jsonResponse({ rawText: JSON.stringify({ speech: msg, display: msg, actions: [], pendingThreads: [] }) });
                }
                // Return confirmation ask — ticket created on turn 2 after staff says yes
                const pending = { intent: 'CREATE_TICKET', level: 'A', confidence: 'high', params: { reporter_email: reporterEmail, body, staff_email: staffEmail } };
                const confirmMsg = `I'll create a ticket for ${reporterEmail}: "${body.slice(0, 100)}". Say yes to confirm.`;
                const display    = `${confirmMsg}\n<!--PENDING_INTENT:${JSON.stringify(pending)}-->`;
                console.log(`[timing] ${elapsed()} | Level A CREATE_TICKET — awaiting confirmation from ${staffEmail}`);
                return jsonResponse({ rawText: JSON.stringify({ speech: confirmMsg, display, actions: [], pendingThreads: [] }) });
              }
            }

            // Level A but no handler yet → honest-out + Path B
            pathB = true;
            console.log(`[timing] ${elapsed()} | Level A ${classification.intent} — no handler yet, Path B`);

          } else if (classification.level === 'B') {
            // Level B — Claude reasons, always disclosed as best-effort
            pathB = true;
            console.log(`[timing] ${elapsed()} | Level B — Claude best-effort, Path B disclosure`);

          } else if (classification.level === 'action' && HANDLED_ACTION_INTENTS.has(classification.intent)) {
            // ── Deterministic action — skip Claude entirely ───────────────────
            // Haiku extracted structured params. Validate completeness, then
            // generate templated confirm speech + embed PENDING_INTENT marker.
            // Turn 2: Step 1.4 resolver executes server-side. Same result every time.
            const confirmed = buildActionConfirm(classification.intent, classification.params);

            if (confirmed.missingParam === '__FALLTHROUGH__') {
              // SET_ACTION_RULE with unhandled trigger type — let Claude respond naturally
              console.log(`[timing] ${elapsed()} | Level action ${classification.intent} fallthrough to Claude (trigger_type=${(classification.params as any)?.trigger_type})`);
              // fall through — do not return; Claude handles below

            } else if (confirmed.missingParam) {
              // Required param missing — ask for it specifically, no Claude
              console.log(`[timing] ${elapsed()} | Level action ${classification.intent} — missing param, asking`);
              return jsonResponse({ rawText: JSON.stringify({ speech: confirmed.missingParam, display: confirmed.missingParam, actions: [], pendingThreads: [] }) });

            } else if (confirmed.actions.length > 0) {
              // Immediate-emit intents: DRAFT_MESSAGE, SET_ACTION_RULE(location)
              console.log(`[timing] ${elapsed()} | Level action ${classification.intent} — deterministic action emitted immediately`);
              return jsonResponse({ rawText: JSON.stringify({ speech: confirmed.speech, display: confirmed.display, actions: confirmed.actions, pendingThreads: [] }) });

            } else if (classification.intent === 'REMEMBER') {
              // REMEMBER is RULE 23 exempt — emit action immediately so mobile executes it.
              const text = (classification.params.text ?? '').trim();
              if (!text) {
                const msg = `What would you like me to remember?`;
                return jsonResponse({ rawText: JSON.stringify({ speech: msg, display: msg, actions: [], pendingThreads: [] }) });
              }
              const speech = `Got it. I'll remember that.`;
              console.log(`[timing] ${elapsed()} | Level action REMEMBER — deterministic action emitted immediately`);
              return jsonResponse({ rawText: JSON.stringify({ speech, display: speech, actions: [{ type: 'REMEMBER', text }], pendingThreads: [] }) });

            } else {
              // All other action intents: confirm turn + PENDING_INTENT for Step 1.4
              const pendingMarker = `<!--PENDING_INTENT:${JSON.stringify({ intent: classification.intent, level: 'action', confidence: 'high', params: classification.params })}-->`;
              console.log(`[timing] ${elapsed()} | Level action ${classification.intent} — awaiting confirm`);
              return jsonResponse({ rawText: JSON.stringify({ speech: confirmed.speech, display: `${confirmed.speech}\n${pendingMarker}`, actions: [], pendingThreads: [] }) });
            }

          } else {
            // Level action (unhandled) or chat — Claude responds naturally, no disclosure
            console.log(`[timing] ${elapsed()} | Level ${classification.level} — Claude natural response`);
          }
        } else {
          // Classification failed — treat as Level B to be safe
          pathB = true;
          console.log(`[timing] ${elapsed()} | Classification failed → Path B`);
        }
      } else {
        pathB = true; // no API key — treat as Level B
      }
    } // end else (not FAST_CHAT_RE)

    // ── Step 2 (B4z 2026-05-25): server-side email-alert bypass REMOVED ─────────
    // The old detectEmailAlert → saveAlertRule path was a single-turn write
    // that bypassed Claude entirely. B4z replaces it with RULE 23 confirm-
    // then-act: Claude asks for confirmation on turn 1, emits the action on
    // turn 2 after the user says "yes". The post-Claude validator (Step 4
    // below) enforces create-intent OR confirm-turn before allowing email-
    // rule actions to pass through. See RULE 23 in get-naavi-prompt.

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

    // F5c — Billing intent pipeline trigger. When the user asks a spending/
    // billing question, fire-and-forget a targeted sync-gmail so the pipeline
    // (extract-email-actions → harvest-attachment → extract-document-text)
    // runs in the background. spend_summary will find the documents on the
    // next ask even if receipts only just arrived in the inbox.
    if (userId && BILLING_INTENT_RE.test(userText)) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        fetch(`${supabaseUrl}/functions/v1/sync-gmail`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ target_user_id: userId, days_back: 1 }),
        }).catch((e: Error) => console.warn('[F5c] billing pipeline trigger failed:', e?.message ?? e));
        console.log(`[timing] ${elapsed()} | F5c — billing intent detected, pipeline sync triggered for user ${userId?.slice(0, 8)}`);
      } catch (e) {
        console.warn('[F5c] billing trigger error:', (e as Error)?.message ?? e);
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
        // alerts? — match singular AND plural; \balert\b alone misses
        // "alerts" because the trailing s is a word char (live caught
        // 2026-05-27 by Wael's voice test, B4s plural follow-up).
        const m = userText.match(
          /\b(?:to|from|on|of)\s+(?:my|the|your)?\s*([\w'\-]+(?:\s+[\w'\-]+){0,3})\s+alerts?\b/i,
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

    // 2026-05-24 (Wael) — B4y Phase 1. Updated 2026-05-25 B4z Phase 2.
    // Action-intent validator for SET_EMAIL_ALERT and
    // SET_ACTION_RULE(trigger_type='email'). Drops the action when the
    // user's latest message lacks an explicit create-intent phrase AND
    // this is not a turn-2 confirmation response following a prior
    // "say yes to confirm" ask (RULE 23 two-turn flow).
    //
    // Phase 1 defended against Claude fabricating rules on search-shape
    // utterances ("Find McDonald alert" → unauthorized email rule).
    // Phase 2 extends: the server-side email-bypass (Step 2) was removed;
    // Claude now handles email rules via RULE 23 confirm-then-act. On
    // turn-2 "yes" responses, the prior assistant message contains "say
    // yes to confirm" — that is a valid confirmation path and must pass.
    if (
      userId
      && actions.some((a: any) =>
        a.type === 'SET_EMAIL_ALERT'
        || (a.type === 'SET_ACTION_RULE' && a.trigger_type === 'email'))
    ) {
      const HAS_CREATE_INTENT_POST = /\b(alert|notify|tell|let|remind|text|email|message|ping)\s+me\b|\b(set\s+up|create|make)\s+(an?\s+)?alert\b|\blet\s+me\s+know\b/i;
      const lastUserMsgB4y = [...messages].reverse().find((m: any) => m.role === 'user');
      const userTextB4y = typeof lastUserMsgB4y?.content === 'string' ? lastUserMsgB4y.content : '';
      const hasCreateIntent = HAS_CREATE_INTENT_POST.test(userTextB4y);

      // B4z Phase 2: also allow action through when this is a turn-2 confirm
      // response (user said "yes" after a prior "say yes to confirm" ask).
      const IS_CONFIRM_REPLY = /^(yes|yeah|yep|confirm|approved|go\s+ahead|do\s+it|please|ok|okay|send)[\s\W]*$/i;
      const isConfirmReply = IS_CONFIRM_REPLY.test(userTextB4y.trim());
      const lastAssistantMsg = [...messages].reverse().find((m: any) => m.role === 'assistant');
      const assistantText = typeof lastAssistantMsg?.content === 'string' ? lastAssistantMsg.content : '';
      const priorTurnHadConfirmAsk = /say yes to confirm/i.test(assistantText);
      const isValidConfirmTurn = isConfirmReply && priorTurnHadConfirmAsk;

      if (!hasCreateIntent && !isValidConfirmTurn) {
        const droppedCount = actions.filter((a: any) =>
          a.type === 'SET_EMAIL_ALERT'
          || (a.type === 'SET_ACTION_RULE' && a.trigger_type === 'email')).length;
        actions = actions.filter((a: any) =>
          !(a.type === 'SET_EMAIL_ALERT'
            || (a.type === 'SET_ACTION_RULE' && a.trigger_type === 'email')));
        console.warn(`[naavi-chat] B4y/B4z: dropping ${droppedCount} email-rule action(s) — user message lacks create-intent and is not a valid confirm-turn: "${userTextB4y.slice(0, 80)}"`);
        if (!serverRejectionMessage) {
          serverRejectionMessage =
            `I read that as a question, not an alert request. If you want an email alert, say something like: "Alert me when an email arrives about X."`;
        }
      }
    }

    // 2026-05-28 (Wael) — B4y Phase 2. Universal RULE 23 gate for all other
    // scoped state-changing actions. Drops CREATE_EVENT, DELETE_EVENT,
    // DELETE_RULE, DELETE_MEMORY, UPDATE_MORNING_CALL, SCHEDULE_MEDICATION,
    // and SET_ACTION_RULE(trigger_type=time/calendar/weather/contact_silence)
    // when the current turn is NOT a valid confirm response (user said "yes"
    // after a prior "say yes to confirm" ask). This enforces RULE 23 at the
    // server layer — even if Claude violates the prompt and emits a scoped
    // action on turn 1, the gate drops it before it reaches the orchestrator.
    //
    // Exempt (no gate): set_location_rule_chain, set_location_rule_address,
    // list_connect/disconnect/delete (have their own gate in listGate),
    // list_create/add/remove, remember, save_to_drive, set_reminder,
    // draft_message, and all read-only tools.
    {
      const RULE23_UNIVERSAL_TYPES = new Set([
        'CREATE_EVENT', 'DELETE_EVENT', 'DELETE_RULE', 'DELETE_MEMORY',
        'UPDATE_MORNING_CALL', 'SCHEDULE_MEDICATION',
      ]);
      const RULE23_NONEMAIL_TRIGGERS = new Set(['time', 'calendar', 'weather', 'contact_silence']);

      const hasUniversalScoped = actions.some((a: any) =>
        RULE23_UNIVERSAL_TYPES.has(a.type)
        || (a.type === 'SET_ACTION_RULE' && RULE23_NONEMAIL_TRIGGERS.has(a.trigger_type))
      );

      if (userId && hasUniversalScoped) {
        const IS_CONFIRM_P2 = /^(yes|yeah|yep|confirm|approved|go\s+ahead|do\s+it|please|ok|okay|send)[\s\W]*$/i;
        const lastUserP2 = [...messages].reverse().find((m: any) => m.role === 'user');
        const userTextP2 = typeof lastUserP2?.content === 'string' ? lastUserP2.content : '';
        const isConfirmReplyP2 = IS_CONFIRM_P2.test(userTextP2.trim());
        const lastAsstP2 = [...messages].reverse().find((m: any) => m.role === 'assistant');
        const asstTextP2 = typeof lastAsstP2?.content === 'string' ? lastAsstP2.content : '';
        const priorHadConfirmAskP2 = /say yes to confirm/i.test(asstTextP2);
        const isValidConfirmP2 = isConfirmReplyP2 && priorHadConfirmAskP2;

        if (!isValidConfirmP2) {
          const droppedP2 = actions
            .filter((a: any) =>
              RULE23_UNIVERSAL_TYPES.has(a.type)
              || (a.type === 'SET_ACTION_RULE' && RULE23_NONEMAIL_TRIGGERS.has(a.trigger_type)))
            .map((a: any) => a.type);
          actions = actions.filter((a: any) =>
            !RULE23_UNIVERSAL_TYPES.has(a.type)
            && !(a.type === 'SET_ACTION_RULE' && RULE23_NONEMAIL_TRIGGERS.has(a.trigger_type))
          );
          console.warn(
            `[naavi-chat] B4y Phase 2: dropping [${droppedP2.join(', ')}] — ` +
            `not a valid confirm-turn. userText="${userTextP2.slice(0, 80)}"`
          );
          if (!serverRejectionMessage) {
            serverRejectionMessage =
              `I need your confirmation before I can make that change. Please say yes to confirm.`;
          }
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

    // ── Layer 3 — Path B disclosure ───────────────────────────────────────────
    // When the query matched LAYER2_CANDIDATE_RE (a data/information question)
    // but Layer 2 couldn't answer it deterministically, Claude is guessing.
    // Flag the response as best-effort so Robert knows it isn't a verified answer.
    // Only fires on spoken content (not fallback confirmations like "Alert set.").
    // Never overrides a server-side rejection message.
    // Don't apply Path B disclosure when Claude is asking a clarification
    // (speech ends with "?" — Claude is asking, not guessing).
    const isClarificationResponse = speech.trimEnd().endsWith('?');
    // When the orchestrator injected live search results into the context,
    // the answer IS from a live source — Path B disclosure is wrong here.
    const hasLiveSearchResults = /##\s*Live search results/i.test(userText);
    if (
      pathB
      && !serverRejectionMessage
      && !isClarificationResponse
      && !hasLiveSearchResults
      && speechBlocks.trim().length > 0
      && actions.every((a: any) => {
        // Don't add Path B disclosure if Claude is taking a state-changing action —
        // those have their own RULE 23 confirmation flow.
        const stateChanging = new Set([
          'CREATE_EVENT','DELETE_EVENT','SET_ACTION_RULE','DELETE_RULE',
          'SET_REMINDER','REMEMBER','DELETE_MEMORY','UPDATE_MORNING_CALL',
          'SCHEDULE_MEDICATION','ADD_CONTACT','SAVE_TO_DRIVE','LIST_CREATE',
          'LIST_ADD','LIST_REMOVE','DRAFT_MESSAGE',
          // Live-source read actions — results ARE verified; no disclosure needed
          'GLOBAL_SEARCH','SPEND_SUMMARY','LIST_RULES','LIST_READ',
          'LIST_CONNECTION_QUERY','DRIVE_SEARCH',
        ]);
        return !stateChanging.has(a?.type);
      })
    ) {
      speech = `Here's my best reading: ${speech} — I can't verify this from a live source right now. Does that work, or would you like me to try a different approach?`;
      console.log(`[timing] ${elapsed()} | Layer3 Path B disclosure applied`);
    }
    if (!speechBlocks.trim() && actions.length > 0) {
      console.log(
        `[naavi-chat] Bug E fallback fired — empty speech, ${actions.length} actions, ` +
        `first=${actions[0]?.type ?? '?'} → "${speech}"`
      );
    }

    // ── GLOBAL_SEARCH / DRIVE_SEARCH — strip filename narration from speech ──
    // Claude sometimes enumerates filenames in its text block after seeing
    // search results injected into the prompt (e.g. "In drive: 5597397956.pdf.
    // In drive: 5587057721.pdf."). The card already shows every result — the
    // speech must be a short headline only. Strip anything that looks like a
    // filename enumeration (starts with a known source label pattern).
    if (actions.some((a: any) => a?.type === 'GLOBAL_SEARCH' || a?.type === 'DRIVE_SEARCH')) {
      // Keep only the first sentence before any filename/source enumeration.
      // Pattern: "In drive:", "In email:", "In calendar:", "In contacts:", etc.
      const SOURCE_ENUM_RE = /\s*\bin\s+(?:drive|email(?:_actions)?|calendar|contacts|lists?|rules?|sent|reminders?)\s*:/i;
      const cutIdx = speech.search(SOURCE_ENUM_RE);
      if (cutIdx > 0) {
        speech = speech.slice(0, cutIdx).trim().replace(/[.,;]+$/, '') + '.';
        console.log(`[naavi-chat] Stripped filename enumeration from GLOBAL_SEARCH speech`);
      }
    }

    // ── ADD_TO_COMMUNITY — server-side execution ──────────────────────────
    // Google Contacts write must happen here (needs a server-held access token).
    // Execute, override speech with specific readback, remove from actions array
    // so the client doesn't try to handle it again.
    const communityAction = actions.find((a: any) => a?.type === 'ADD_TO_COMMUNITY');
    if (communityAction && userId) {
      const readback = await executeAddToCommunity(
        supabase,
        userId,
        String(communityAction.contact_resource_name ?? ''),
        String(communityAction.contact_name ?? 'that contact'),
      );
      speech = readback;
      actions = actions.filter((a: any) => a?.type !== 'ADD_TO_COMMUNITY');
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

    // ── Pending actions queue — cross-turn action preservation ───────────────
    // When Claude asks a clarification question (e.g. "Which Bob?") while
    // processing a multi-action request, some actions may not be emitted in
    // this turn. We save them to pending_actions so they survive across turns.
    //
    // Detection: speech ends with a question AND fewer actions were emitted
    // than the conversation history suggests were requested (multi-action turn).
    // Retrieval: on the NEXT turn, if speech resolves the clarification and
    // new actions arrive, merge the stored deferred actions.
    if (userId && supabase) {
      try {
        const parsedRaw = JSON.parse(rawText);
        const currentActions: any[] = parsedRaw.actions ?? [];
        const currentSpeech: string = parsedRaw.speech ?? '';

        // Step A: Retrieve any stored pending actions from a previous clarification turn
        const { data: pendingRow } = await supabase
          .from('pending_actions')
          .select('*')
          .eq('user_id', userId)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (pendingRow && currentActions.length > 0) {
          // User resolved the clarification — merge deferred actions with current ones
          const deferred: any[] = pendingRow.actions ?? [];
          // Dedupe by action type + key fields to avoid duplicates
          const currentTypes = new Set(currentActions.map((a: any) => `${a.type}:${a.summary ?? a.place_name ?? a.to ?? ''}`));
          const toAdd = deferred.filter((a: any) => {
            const key = `${a.type}:${a.summary ?? a.trigger_config?.place_name ?? a.to ?? ''}`;
            return !currentTypes.has(key);
          });
          if (toAdd.length > 0) {
            parsedRaw.actions = [...currentActions, ...toAdd];
            rawText = JSON.stringify(parsedRaw);
            console.log(`[pending_actions] restored ${toAdd.length} deferred action(s): ${toAdd.map((a: any) => a.type).join(', ')}`);
          }
          // Delete the stored record
          await supabase.from('pending_actions').delete().eq('id', pendingRow.id);
          console.log(`[pending_actions] cleared pending record ${pendingRow.id}`);
        } else if (!pendingRow && currentActions.length > 0 && currentSpeech.includes('?')) {
          // Step B: Claude asked a clarification question this turn — store actions for next turn
          // Only store if there are multiple actions (multi-action request) or speech asks which contact
          const isContactQuestion = /which (one|contact|bob|sarah|james|\w+)\??/i.test(currentSpeech) ||
                                    /i found \d+ contacts/i.test(currentSpeech) ||
                                    /need.*clarif/i.test(currentSpeech);
          const isMultiAction = currentActions.length >= 2;

          if (isContactQuestion || isMultiAction) {
            await supabase.from('pending_actions').upsert({
              user_id:    userId,
              actions:    currentActions,
              context:    userText.slice(0, 500),
              expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            });
            console.log(`[pending_actions] stored ${currentActions.length} action(s) for next clarification turn`);
          }
        }
      } catch (paErr) {
        console.warn('[pending_actions] non-fatal error:', paErr instanceof Error ? paErr.message : String(paErr));
      }
    }

    return jsonResponse({ rawText });

  } catch (err) {
    console.error('[naavi-chat] Error:', err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
