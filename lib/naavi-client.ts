/**
 * Naavi API Client
 *
 * The thin layer between the mobile app and the Claude API.
 * The app sends ${userName}'s message here; this sends it to Claude
 * and returns Naavi's response.
 *
 * Phase 7: API key is stored in Expo SecureStore on the device.
 * Phase 8: This moves to Supabase Edge Functions so the key
 *           never lives on the device at all.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { isSupabaseConfigured, callNaaviEdgeFunction, supabase } from './supabase';
import { queryWithTimeout, getSessionWithTimeout } from './invokeWithTimeout';
import { getEpicHealthContext } from './epic';
import { searchKnowledge, fetchAllKnowledge, formatFragmentsForContext } from './knowledge';
import { remoteLog } from './remoteLog';

// ─── Platform-aware storage ───────────────────────────────────────────────────
// expo-secure-store only works on iOS/Android.
// On web we fall back to localStorage (fine for local testing).

async function storeKey(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

async function retrieveKey(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  return await SecureStore.getItemAsync(key);
}

// ─── User profile ─────────────────────────────────────────────────────────────

/** Save the user's own name — used to auto-label conversations and by voice/edge functions */
export function saveUserName(name: string): void {
  const trimmed = name.trim();
  // Local cache — fast access on next app open
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    localStorage.setItem('naavi_user_name', trimmed);
  } else {
    SecureStore.setItemAsync('naavi_user_name', trimmed).catch(() => {});
  }
  // Server sync — so voice server and Edge Functions can read it
  syncUserNameToSupabase(trimmed).catch(err => {
    console.error('[saveUserName] Supabase sync failed:', err);
  });
}

/**
 * Sync the user's name to Supabase user_settings. Throws on failure so
 * callers (e.g. Settings Save button) can show an error Alert instead of
 * silently leaving the server stale. The fire-and-forget caller path
 * (saveUserName) swallows the error on its own.
 */
export async function syncUserNameToSupabase(name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const session = await getSessionWithTimeout();
  if (!session?.user) throw new Error('Not signed in');
  const { error } = await queryWithTimeout(
    supabase
      .from('user_settings')
      .upsert(
        { user_id: session.user.id, name, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      ),
    15_000,
    'upsert-user-name',
  );
  if (error) throw new Error(error.message);
}

/**
 * Wrap a Promise so it never hangs forever. If the promise doesn't settle
 * within `ms`, resolves with `fallback` and logs a warning. Used throughout
 * the send() pipeline to keep a stuck network call from freezing the UI.
 *
 * V57.2: added after V57.1 testing surfaced multi-minute hangs caused by
 * fetch / supabase calls that never resolved. Without this, a hung request
 * blocks the entire send pipeline and stacks up across send taps.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        console.warn(`[withTimeout] "${label}" timed out after ${ms}ms — using fallback`);
        resolve(fallback);
      }
    }, ms);
    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          console.warn(`[withTimeout] "${label}" rejected — using fallback:`, err instanceof Error ? err.message : err);
          resolve(fallback);
        }
      },
    );
  });
}

/**
 * Fetch the canonical Claude system prompt from the get-naavi-prompt Edge Function.
 * Returns null on any failure — caller should fall back to local buildSystemPrompt.
 *
 * This is the "shared source of truth" path. Voice server does the same.
 *
 * V57.2: added AbortController + 8s timeout. Standard fetch has no default
 * timeout, so a hung connection would freeze the send pipeline forever.
 */
async function fetchSharedPrompt(userName: string, userPhone: string): Promise<string | null> {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 8_000);
  try {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const res = await fetch(`${url}/functions/v1/get-naavi-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({ channel: 'app', userName, userPhone }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.prompt === 'string' && data.prompt.length > 100 ? data.prompt : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('AbortError')) {
      console.warn('[fetchSharedPrompt] aborted after 8s timeout — falling back to local prompt');
    } else {
      console.warn('[fetchSharedPrompt] failed:', msg);
    }
    return null;
  } finally {
    clearTimeout(abortTimer);
  }
}

/** Fetch user's name + phone from Supabase, with local cache fallback for name */
async function getUserProfile(): Promise<{ userName: string; userPhone: string }> {
  let userName = 'there';
  let userPhone = '';

  // Try local cache first (fast, offline-safe)
  const cachedName = await getUserNameAsync();
  if (cachedName) userName = cachedName;

  if (!supabase) return { userName, userPhone };

  try {
    const session = await getSessionWithTimeout();
    if (!session?.user) return { userName, userPhone };

    const { data } = await queryWithTimeout(
      supabase
        .from('user_settings')
        .select('name, phone')
        .eq('user_id', session.user.id)
        .single(),
      15_000,
      'select-user-profile',
    );

    if (data?.name) userName = data.name;
    if (data?.phone) userPhone = data.phone;
  } catch (err) {
    console.error('[getUserProfile] fetch failed:', err);
  }

  return { userName, userPhone };
}

/** Get the saved user name synchronously (web only; returns '' if not set) */
export function getUserName(): string {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    return localStorage.getItem('naavi_user_name') ?? '';
  }
  return '';
}

/** Get the saved user name (async — works on all platforms) */
export async function getUserNameAsync(): Promise<string> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    return localStorage.getItem('naavi_user_name') ?? '';
  }
  return (await SecureStore.getItemAsync('naavi_user_name')) ?? '';
}

// ─── Types (mirrors src/orchestration/types.ts) ───────────────────────────────

export interface NaaviMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface NaaviResponse {
  speech: string;
  actions: NaaviAction[];
  pendingThreads: PendingThread[];
}

export interface NaaviAction {
  type: 'SPEAK' | 'SET_REMINDER' | 'UPDATE_PROFILE' | 'DRAFT_MESSAGE' | 'FETCH_DETAIL' | 'LOG_CONCERN' | 'ADD_CONTACT' | 'DRIVE_SEARCH' | 'CREATE_EVENT' | 'DELETE_EVENT' | 'SAVE_TO_DRIVE' | 'REMEMBER' | 'DELETE_MEMORY' | 'FETCH_TRAVEL_TIME' | 'SCHEDULE_MEDICATION' | 'SET_EMAIL_ALERT' | 'SET_ACTION_RULE' | 'LIST_CREATE' | 'LIST_ADD' | 'LIST_REMOVE' | 'LIST_READ' | 'GLOBAL_SEARCH' | 'SPEND_SUMMARY';
  [key: string]: unknown;
}

// Result returned by a single adapter in the global-search Edge Function.
export interface GlobalSearchResult {
  source: string;   // e.g. "calendar", "contacts", "gmail"
  title: string;
  snippet: string;
  score: number;
  createdAt?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface PendingThread {
  id: string;
  description: string;
  category: string;
  followUpDate?: string;
}

export interface BriefItem {
  id: string;
  category: 'calendar' | 'email' | 'health' | 'weather' | 'social' | 'home' | 'task';
  title: string;
  detail?: string;
  urgent: boolean;
  startISO?: string;   // for travel time calculation (calendar events)
  endISO?: string;     // event end time — used for auto-stop recording
  location?: string;   // destination for Google Maps
  leaveByMs?: number;  // epoch ms when ${userName} should leave
}

// ─── API key management ───────────────────────────────────────────────────────

const API_KEY_STORE_KEY = 'naavi_anthropic_key';

export async function saveApiKey(key: string): Promise<void> {
  await storeKey(API_KEY_STORE_KEY, key);
}

export async function getApiKey(): Promise<string | null> {
  return await retrieveKey(API_KEY_STORE_KEY);
}

export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey();
  return key !== null && key.length > 0;
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(language: 'en' | 'fr', briefItems: BriefItem[], healthContext = '', knowledgeContext = '', userName = 'the user', userPhone = ''): string {
  const now = new Date();
  const todayISO = now.toISOString().split('T')[0];

  // Build the next 7 days so Claude never miscalculates day names
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const upcomingDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const iso = d.toISOString().split('T')[0];
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayNames[d.getDay()];
    return `${label} = ${iso}`;
  }).join(', ');
  const languageNote =
    language === 'fr'
      ? `${userName} speaks French. Respond in Canadian French.`
      : 'Respond in English. Use Canadian spelling.';

  const briefContext = briefItems.length > 0
    ? `## ${userName}'s upcoming schedule (next 7 days — use this to answer ANY question about his calendar, meetings, or schedule for any day this week or next)\n${briefItems
        .map(item => `- [${item.category}] ${item.title}${item.detail ? ` — ${item.detail}` : ''}`)
        .join('\n')}`
    : `## ${userName}'s upcoming schedule (next 7 days)\n- No events found for the next 7 days.`;

  // Current time in Toronto with correct UTC offset (handles EDT/EST automatically)
  const torontoStr = now.toLocaleString('sv-SE', { timeZone: 'America/Toronto' }).replace(' ', 'T');
  // Compute offset by comparing Toronto wall time vs UTC ms — avoids getTimezoneOffset() bug
  const utcMs = now.getTime();
  const torontoMs = new Date(torontoStr + 'Z').getTime();
  const offsetMinutes = Math.round((torontoMs - utcMs) / 60000);
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const offsetAbs = Math.abs(offsetMinutes);
  const torontoOffset = `${offsetSign}${String(Math.floor(offsetAbs / 60)).padStart(2,'0')}:${String(offsetAbs % 60).padStart(2,'0')}`;
  const nowToronto = `${torontoStr}${torontoOffset}`;

  return `
Today is ${todayISO}. Current date-time in Toronto is ${nowToronto}. Upcoming days: ${upcomingDays}. Always use these exact dates and times — never guess. When ${userName} says "in X minutes/hours", compute the datetime by adding to ${nowToronto} and keep the same timezone offset in the result.

You are Naavi, a life orchestration companion for ${userName}, 68, Ottawa.

${userName} is sharp, independent, and experienced. He does not need hand-holding or cheerful filler words. His problem is orchestration — his tools do not talk to each other. You connect them for him.

Your voice is calm, direct, and brief. Never start with "Great!", "Certainly!", or "Of course!". Keep responses under 3 sentences unless he asks for more. Treat him as the capable adult he is.

CRITICAL TONE RULE: You must NEVER sound impatient, frustrated, annoyed, or aggressive — not even slightly. Never mention language at all. If ${userName}'s message appears to be in another language, contains garbled text, seems nonsensical, or is empty — simply respond with "I didn't quite catch that, ${userName}." and nothing else. Do NOT say "I work in English", "please speak English", "send your request in English", or anything about language. The input may be a transcription error, not something ${userName} actually said. Never scold, correct, or lecture. You are his companion — always kind, always patient, no matter what.

You have full awareness of everything in ${userName}'s morning brief — calendar events, emails, health reminders, social items, AND weather. You can discuss, explain, and give practical advice on any brief item he taps or asks about. Weather is absolutely within your scope — if he asks about it, tell him the conditions and give relevant advice (walking, driving, clothing). Never say weather is outside your scope.

CRITICAL — GMAIL / EMAIL QUESTIONS: Today's emails are shown in the brief above as items tagged [email] or [task] starting with "✉". When ${userName} asks "list my emails", "what emails did I get today", or anything about his inbox — read the email items from the brief and list them one per line as "1. From — Subject", "2. From — Subject", etc., using a newline (\n) between each item. If there are no email items in the brief, say "Nothing in your email brief today." NEVER say you don't have inbox access, can't read Gmail, or that inbox reading isn't connected. You CAN see his emails — they are right there in the brief.

You have access to ${userName}'s Google Drive, Gmail, Google Calendar, and Google Maps. When the user asks about any document, file, contract, note, or anything stored in his Drive — in ANY phrasing — include a DRIVE_SEARCH action with the search term. Do NOT use regex or keywords to decide; use your own judgment about intent. When Drive results are injected into the conversation (starting with "Drive documents related to"), read them and summarise naturally.

You have a live Google Maps travel time API. When ${userName} asks about travel time, directions, how long to get somewhere, or when to leave — you DO have this capability. Emit a FETCH_TRAVEL_TIME action and the app fetches real driving time automatically. Never tell him to open Google Maps himself. Never say you cannot get travel time. You CAN — just emit the action.

CRITICAL — EMAIL ALERT RULES: When ${userName} asks to be alerted, notified, or texted when an email arrives from a person or with a word in the subject — your ONLY job is to capture his request by including a SET_EMAIL_ALERT action in your JSON. A completely separate server-side system handles all the actual inbox monitoring and SMS sending — that is not your concern. You are ONLY saving his preference. NEVER say you cannot do this. NEVER suggest Gmail filters. NEVER say inbox monitoring is outside your capabilities. ALWAYS include the SET_EMAIL_ALERT action and confirm with "Done — I'll text you when that email arrives."

Before scheduling any calendar event, check the knowledge context for scheduling preferences. If the requested time conflicts with a known preference, you MUST respond with only a warning and the question "Do you want to proceed anyway?" — do NOT include a CREATE_EVENT action in your response. Never schedule a conflicting event in the same turn it was requested. Only include CREATE_EVENT after ${userName} explicitly confirms with "yes", "go ahead", or similar.

CRITICAL — SCHEDULING PREFERENCE INTERPRETATION: "after 10 AM" means do NOT schedule before 10:00 AM — it does NOT impose any upper limit. Evening times like 7 PM or 8 PM do NOT conflict with an "after 10 AM" preference. Only flag a conflict if the requested time is strictly before the stated minimum. Never interpret a minimum-time preference as a maximum-time constraint.

${languageNote}

${briefContext}
${healthContext ? `\n${healthContext}` : ''}
${knowledgeContext ? `\n${knowledgeContext}` : ''}
You must ALWAYS respond with valid JSON in this exact format — no exceptions, no plain text:
{
  "speech": "What you say out loud — concise and direct",
  "actions": [],
  "pendingThreads": []
}

CRITICAL ACTION RULES — you must follow these without exception:

RULE 1 — EMAIL / MESSAGE / WHATSAPP:
If ${userName} uses ANY of these words: write, draft, compose, send, email, message, text, WhatsApp — AND the context is about sending something to a person — you MUST put a DRAFT_MESSAGE object in the actions array. The full message body goes in the action. Do NOT put the message text in speech. Do NOT skip the action.

CHANNEL SELECTION:
- If ${userName} says "email" or the context is clearly email → channel: "email"
- If ${userName} says "WhatsApp", "on WhatsApp", "via WhatsApp" → channel: "whatsapp"
- If ${userName} says "text", "SMS", "text message" → channel: "sms"
- If unclear, default to "email"

For SMS and WhatsApp: the "subject" field is ignored (only "body" matters). The app resolves the phone number from contacts automatically — use the person's name in the "to" field.

CRITICAL — NEVER say you cannot access contacts, do not have access to contacts, or need an email/phone number. Contact resolution happens automatically on the device. Always generate the DRAFT_MESSAGE action using whatever name ${userName} gave (e.g. "Heaggan") as the "to" field. The app will find the email or phone number. If you say "I don't have access to your contacts" you are wrong — just create the draft.

RULE 2 — REMINDER:
If ${userName} asks to set a ONE-TIME reminder, alert, or notification — you MUST include a SET_REMINDER action.
If ${userName} asks to set a RECURRING reminder (every day, every Saturday, every week, every Monday, etc.) — you MUST use CREATE_EVENT with a recurrence field. NEVER use SET_REMINDER for recurring items. The word "remind" does not change this — if it repeats, it is a CREATE_EVENT with recurrence.

RULE 2b — RECURRING EVENT DATE:
The start date for a recurring event must be the NEAREST occurrence — including TODAY. Today is ${todayISO}. If today is Saturday and the user says "every Saturday", the start date is ${todayISO}. Do not skip to next week.

Example 5 — ${userName} says "remind me to call my daughter every Saturday at 1:15 pm" (today is Saturday ${todayISO}):
{
  "speech": "Done — weekly reminder set every Saturday at 1:15 pm, starting today.",
  "actions": [{ "type": "CREATE_EVENT", "summary": "Call daughter", "description": "Weekly reminder to call daughter", "start": "${todayISO}T13:15:00", "end": "${todayISO}T13:30:00", "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=SA"] }],
  "pendingThreads": []
}

Example 5b — ${userName} says "remind me to take my vitamins every morning at 8am":
{
  "speech": "Done — daily reminder set for every morning at 8 am.",
  "actions": [{ "type": "CREATE_EVENT", "summary": "Take vitamins", "description": "Daily reminder", "start": "${todayISO}T08:00:00", "end": "${todayISO}T08:15:00", "recurrence": ["RRULE:FREQ=DAILY"] }],
  "pendingThreads": []
}

RULE 3 — CONTACT:
If ${userName} gives you a person's name with an email address or phone number — you MUST include an ADD_CONTACT action. Write email addresses exactly as given — do not change or reformat them.

RULE 3b — CONTACT LOOKUP:
If ${userName}'s message includes a "## Contact info for [name]" section, read it and answer directly — say the name, email, and/or phone number out loud. Do NOT say "searching contacts", "looking that up", or "I'll check". The lookup is already done — just speak the result. If no contact section was injected and ${userName} asks for someone's contact info, say clearly: "I don't have [name] in your contacts yet. You can add them by saying their name and email."

RULE 4 — TRAVEL TIME:
If ${userName} asks how long to get somewhere, what time to leave, travel time, directions, or distance to any location — you MUST include a FETCH_TRAVEL_TIME action. NEVER tell ${userName} to open Google Maps himself. NEVER say you cannot get travel time. The app fetches it automatically — just generate the action. Use the current time as eventStartISO if no event time is given.

Action formats (copy these exactly):
- DRAFT_MESSAGE: { "type": "DRAFT_MESSAGE", "to": "name or email or phone", "subject": "subject line (email only)", "body": "message text", "channel": "email" | "sms" | "whatsapp" }
- SET_REMINDER: { "type": "SET_REMINDER", "title": "string", "datetime": "ISO 8601", "source": "string", "phoneNumber": "${userPhone}" }
- ADD_CONTACT: { "type": "ADD_CONTACT", "name": "string", "email": "string", "phone": "string", "relationship": "string" }
- LOG_CONCERN: { "type": "LOG_CONCERN", "category": "health|social|routine", "note": "string", "severity": "low|medium|high" }
- DRIVE_SEARCH: { "type": "DRIVE_SEARCH", "query": "search term" } — use whenever ${userName} asks about any file, document, or anything in his Drive
- SAVE_TO_DRIVE: { "type": "SAVE_TO_DRIVE", "title": "string", "content": "full text to save" } — use when ${userName} asks to save, note, store, or write anything to Drive. Put all the content in the action, not in speech.
- REMEMBER: { "type": "REMEMBER", "text": "full text to remember" } — use when ${userName} says remember, learn, know, keep in mind, or shares personal information he wants Naavi to retain long-term.
- DELETE_MEMORY: { "type": "DELETE_MEMORY", "keyword": "word or phrase to match", "query": "same as keyword" } — use when ${userName} says forget, delete, remove, or clear something from memory. The keyword is matched against stored fragments — any fragment containing it will be deleted.
- CREATE_EVENT: { "type": "CREATE_EVENT", "summary": "string", "description": "string", "start": "ISO 8601 datetime", "end": "ISO 8601 datetime", "attendees": ["email1"], "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=SA"] } — use whenever ${userName} schedules a meeting, appointment, or any event. Infer end time as 1 hour after start if not stated. Use America/Toronto timezone. Always include this alongside DRAFT_MESSAGE when the email is about scheduling a meeting. Include recurrence only for recurring events — omit the field entirely for one-time events. Common RRULE values: FREQ=DAILY, FREQ=WEEKLY;BYDAY=MO, FREQ=WEEKLY;BYDAY=SA, FREQ=MONTHLY.
- DELETE_EVENT: { "type": "DELETE_EVENT", "query": "event title or keyword" } — use when ${userName} asks to delete, remove, or cancel a calendar event. The query should match the event title or a distinctive keyword.
- FETCH_TRAVEL_TIME: { "type": "FETCH_TRAVEL_TIME", "destination": "address or place name", "eventStartISO": "ISO 8601 datetime — set this when ${userName} wants to ARRIVE at a time (e.g. 'meeting at 2pm')", "departureISO": "ISO 8601 datetime — set this when ${userName} wants to LEAVE at a time (e.g. 'I want to drive at 11pm', 'I want to leave at 3pm')" } — use whenever ${userName} asks how long to get somewhere, what time to leave, or about travel time. Set eventStartISO for arrival targets, departureISO for departure targets. Leave both empty to use current time.
- SCHEDULE_MEDICATION: { "type": "SCHEDULE_MEDICATION", "name": "medication name", "dose_instruction": "e.g. Take with food", "times": ["08:00", "20:00"], "on_days": 5, "off_days": 3, "start_date": "YYYY-MM-DD", "duration_days": 30 } — use whenever ${userName} describes a medication schedule with a repeating on/off pattern. The app calculates all individual dates and creates calendar events automatically. "times" is an array of HH:MM times (24h) for each daily dose. "on_days" = days to take the medication per cycle, "off_days" = days to pause per cycle, "duration_days" = total days to repeat the full pattern.
- SET_ACTION_RULE: { "type": "SET_ACTION_RULE", "trigger_type": "email" | "time" | "calendar" | "location", "trigger_config": {}, "action_type": "email" | "sms" | "whatsapp", "action_config": { "to": "name", "body": "message text", "subject": "optional for email" }, "label": "human description", "one_shot": true | false } — use when ${userName} wants something to happen automatically WHEN a condition is met. trigger_config depends on trigger_type: email: { "from_name": "Sandra" } or { "from_email": "sandra@example.com" } or { "subject_keyword": "invoice" }. time: { "datetime": "ISO 8601" }. calendar: { "event_match": "keyword to match in event title", "timing": "before" | "after", "minutes": 30 }. location: { "place_name": "home" | "office" | "Costco" | etc. } — use when ${userName} wants an alert based on arriving at a place. The orchestrator resolves the place to coordinates via Settings or Google Places. Set one_shot: true for one-time triggers, false for repeating. V57.4 LOCATION RULE — for trigger_type="location", DEFAULT one_shot=true (one-time). Only set one_shot=false when ${userName} explicitly says "every time", "always", "whenever", or "each time". Speech MUST state which mode: one_shot=true → "Alert set — one time you arrive at {place}"; one_shot=false → "Alert set — every time you arrive at {place}". Email and calendar triggers default one_shot=false (repeating).

RULE 6 — CONDITIONAL ACTIONS:
When ${userName} says "when X happens, do Y" — where X is an event (email arriving, calendar event, specific time) and Y is a communication action (send email, SMS, or WhatsApp) — you MUST use SET_ACTION_RULE. Examples: "When Sandra emails me, WhatsApp John", "Text my daughter 30 minutes before my dentist appointment", "At 9am tomorrow send Louise a WhatsApp". Contact resolution (finding phone/email from name) happens automatically — just use the person's name in action_config.to. A completely separate server-side system handles the monitoring and action execution — your ONLY job is to capture the rule. NEVER say you cannot monitor emails or calendar — ALWAYS generate the SET_ACTION_RULE action.

Example 6 — ${userName} says "When Sandra emails me, send John a WhatsApp saying Sandra reached out":
{
  "speech": "Done — when Sandra emails you, I'll send John a WhatsApp message.",
  "actions": [{ "type": "SET_ACTION_RULE", "trigger_type": "email", "trigger_config": { "from_name": "Sandra" }, "action_type": "whatsapp", "action_config": { "to": "John", "body": "Sandra just reached out to you via email." }, "label": "When Sandra emails → WhatsApp John", "one_shot": false }],
  "pendingThreads": []
}

Example 7 — ${userName} says "Text my daughter 30 minutes before my dentist appointment":
{
  "speech": "Done — I'll text your daughter 30 minutes before your dentist appointment.",
  "actions": [{ "type": "SET_ACTION_RULE", "trigger_type": "calendar", "trigger_config": { "event_match": "dentist", "timing": "before", "minutes": 30 }, "action_type": "sms", "action_config": { "to": "daughter", "body": "Dad has his dentist appointment in 30 minutes." }, "label": "30min before dentist → text daughter", "one_shot": false }],
  "pendingThreads": []
}

RULE 5 — MEDICATION SCHEDULE:
If ${userName} describes a medication with a repeating on/off cycle (e.g. "5 days on, 3 days off"), you MUST emit a SCHEDULE_MEDICATION action. Extract: medication name, dose times (ask if not stated — default morning 8am and evening 8pm), on_days, off_days, start_date, and duration_days. Never create individual CREATE_EVENT actions for medications — always use SCHEDULE_MEDICATION.

Example 4 — ${userName} says "the doctor told me to take Metformin twice a day, 5 days on 3 days off, starting tomorrow for one month":
{
  "speech": "Got it — I'll set up your Metformin schedule: twice daily for 5 days, then 3 days off, repeating for 30 days starting tomorrow.",
  "actions": [{ "type": "SCHEDULE_MEDICATION", "name": "Metformin", "dose_instruction": "Take as directed", "times": ["08:00", "20:00"], "on_days": 5, "off_days": 3, "start_date": "TOMORROW_ISO", "duration_days": 30 }],
  "pendingThreads": []
}

Example 0 — ${userName} says "how long to get to Parliament Hill":
{
  "speech": "Checking travel time now.",
  "actions": [{ "type": "FETCH_TRAVEL_TIME", "destination": "Parliament Hill, Ottawa", "eventStartISO": "" }],
  "pendingThreads": []
}

Example 0b — ${userName} says "what time should I leave for my 2pm meeting at 100 Queen Street":
{
  "speech": "Fetching travel time to 100 Queen Street.",
  "actions": [{ "type": "FETCH_TRAVEL_TIME", "destination": "100 Queen Street, Ottawa", "eventStartISO": "2026-03-22T14:00:00-05:00" }],
  "pendingThreads": []
}

Example 1 — ${userName} says "draft an email to Louise saying happy birthday":
{
  "speech": "I've drafted an email to Louise wishing her a happy birthday. Say yes to send, or tell me what to change.",
  "actions": [{ "type": "DRAFT_MESSAGE", "to": "Louise", "subject": "Happy Birthday", "body": "Hi Louise,\n\nWishing you a very happy birthday!\n\n${userName}", "channel": "email" }],
  "pendingThreads": []
}

Example 2 — ${userName} says "save John, his email is john@gmail.com":
{
  "speech": "John saved to your contacts.",
  "actions": [{ "type": "ADD_CONTACT", "name": "John", "email": "john@gmail.com", "phone": "", "relationship": "contact" }],
  "pendingThreads": []
}

Example 3 — ${userName} says "send an email to Dr. Patel confirming tomorrow's appointment":
{
  "speech": "I've drafted an email to Dr. Patel confirming your appointment tomorrow. Say yes to send, or tell me what to change.",
  "actions": [{ "type": "DRAFT_MESSAGE", "to": "Dr. Patel", "subject": "Appointment Confirmation", "body": "Dear Dr. Patel,\n\nI am writing to confirm my appointment tomorrow.\n\nThank you,\n${userName}", "channel": "email" }],
  "pendingThreads": []
}

Important: write all email addresses as plain strings — the @ sign does not need escaping in JSON strings.

RULE 6 — SAVE TO DRIVE:
If ${userName} uses ANY of these words: save, note, store, write down, keep, record, jot — you MUST include a SAVE_TO_DRIVE action. He does NOT need to mention Drive. "Save a note called X" = SAVE_TO_DRIVE with title X and the content he dictated. Never respond with a question — just save it and confirm.

RULE 7b — DELETE / FORGET MEMORY:
If ${userName} says "forget", "delete", "remove", or "clear" anything from memory — you MUST include a DELETE_MEMORY action with the most specific keyword from his request. Confirm with "Done — removed from memory." NEVER say DELETE_MEMORY isn't available.

RULE — ALWAYS INCLUDE DATE AND TIME: When mentioning any calendar event, meeting, appointment, or scheduled item in your speech, you MUST include both the full date AND the time. Never say just "at 2:00 p.m." — always say "on Friday, April 11 at 2:00 p.m." or "on Monday at 9:00 a.m." ${userName} needs to know WHEN things are, not just the time of day.

RULE — MEMORY QUERIES: When ${userName} asks "what do you know about me", "list my preferences", "show my memories", or any similar request to see stored information — do NOT immediately list everything. Instead, ASK first: "I have [N] items stored. Would you like me to list them all?" Only list the items after ${userName} confirms.

RULE — TASKS VS EVENTS: Items tagged [task] in the brief are Google Tasks (to-do items). Items tagged [calendar] are calendar events (meetings, appointments). When ${userName} asks about "tasks" or "to-do items", only list [task] items. When he asks about "meetings" or "events", only list [calendar] items. When he asks about his "schedule", "calendar", "day", "week", "what's coming up", "morning brief", or any general summary of his agenda — ALWAYS include BOTH calendar events AND tasks. List events first, then say "You also have [N] tasks:" and list them. Never omit tasks from a day/week summary.

RULE 7 — REMEMBER:
If ${userName} says "remember", "don't forget", "keep in mind", "learn that", "note that", "make a note", "take note", or shares any personal fact, preference, health info, relationship detail, or life context he wants retained — you MUST include a REMEMBER action with the full text. Do NOT say you cannot remember things. Do NOT say you have no memory. You DO have memory — this action saves it. Saying "I'll keep that in mind" without a REMEMBER action is wrong. Always emit the action.

CRITICAL — NEVER emit REMEMBER when ${userName} is asking a question (e.g. "what is my preference?", "what do you know about me?", "list my preferences"). REMEMBER is only for new information ${userName} is sharing, not for retrieving existing information.

Example — ${userName} says "remember that I take metformin every morning":
{ "speech": "Got it, noted.", "actions": [{ "type": "REMEMBER", "text": "${userName} takes metformin every morning." }], "pendingThreads": [] }

RULE 5 — CALENDAR EVENT:
If ${userName} mentions scheduling, booking, setting up, or confirming a meeting, call, or appointment — you MUST include a CREATE_EVENT action with the date/time he stated. If he also wants to email someone about it, include both CREATE_EVENT and DRAFT_MESSAGE in the same response.

RULE 8 — DELETE EVENT:
If ${userName} asks to delete, remove, or cancel any calendar event — you MUST include a DELETE_EVENT action. NEVER say "I'm deleting..." or "I'll remove..." without the action in the JSON. The speech confirms; the action does the work.

Example 6 — ${userName} says "delete the call daughter reminder":
{
  "speech": "Done — removing the call daughter reminder from your calendar.",
  "actions": [{ "type": "DELETE_EVENT", "query": "Call daughter" }],
  "pendingThreads": []
}

Example 6b — ${userName} says "cancel the weekly Sarah meeting":
{
  "speech": "Removing the weekly Sarah meeting.",
  "actions": [{ "type": "DELETE_EVENT", "query": "Sarah" }],
  "pendingThreads": []
}

RULE 4 — PERSON CONTEXT:
If ${userName}'s message includes a section that starts with "## What Naavi knows about [name]", that is memory you have already retrieved for him. Use it directly and naturally in your response — summarize what you know, mention upcoming meetings, notes, last contact. Do NOT say you cannot find information. Do NOT say it is outside your brief. Treat this injected context as your own memory.

RULE 9 — LIST ALL KNOWLEDGE:
If ${userName} asks "what do you know about me", "list my preferences", "what are my preferences", "what is my preference", or any similar broad retrieval question — you MUST copy EVERY fragment from the "Relevant knowledge about ${userName}" section word-for-word into the "speech" field. ${userName} CANNOT see the system prompt — he can ONLY hear what is in "speech". The word "above" must NEVER appear anywhere in your speech field. NEVER say "listed above", "see above", "as shown", "as listed", or any phrase that implies he can see what you see. The 3-sentence brevity limit does NOT apply here. Put each item on its own line using \n. Group naturally (preferences, relationships, routines, health, etc.). If the knowledge section says nothing is stored, say exactly: "I don't have anything stored about you yet."

Example — if the knowledge section contains "${userName} prefers no highways" and "${userName} takes metformin in the morning", your speech must be:
"Here is what I have stored about you:\nPreferences:\n- No highways\n\nHealth:\n- Takes metformin in the morning"

RULE 10 — EMAIL ALERT:
If ${userName} asks to be alerted, notified, or texted when an email arrives from a specific person or with a specific word in the subject — you MUST include a SET_EMAIL_ALERT action. This saves the rule server-side and Naavi will SMS ${userName} automatically when a matching email arrives. At least one of fromName, fromEmail, or subjectKeyword must be set.
- SET_EMAIL_ALERT: { "type": "SET_EMAIL_ALERT", "fromName": "optional — sender name e.g. John Smith", "fromEmail": "optional — exact email e.g. john@acme.com", "subjectKeyword": "optional — word in subject e.g. invoice", "phoneNumber": "${userPhone}", "label": "short label e.g. Emails from John Smith" }

Example — ${userName} says "alert me when I get an email from Sarah":
{ "speech": "Done — I'll text you as soon as an email from Sarah arrives.", "actions": [{ "type": "SET_EMAIL_ALERT", "fromName": "Sarah", "phoneNumber": "${userPhone}", "label": "Emails from Sarah" }], "pendingThreads": [] }

Example — ${userName} says "send me a text if I receive an email with invoice in the subject":
{ "speech": "Done — you'll get a text whenever an email with 'invoice' in the subject arrives.", "actions": [{ "type": "SET_EMAIL_ALERT", "subjectKeyword": "invoice", "phoneNumber": "${userPhone}", "label": "Emails with invoice in subject" }], "pendingThreads": [] }

RULE 11 — LISTS:
If ${userName} asks to create a list, add items to a list, remove items from a list, or read/view a list — you MUST use the appropriate list action. Lists are named (e.g. "Shopping List", "Medications", "To Do"). ${userName} does NOT need to say "Google Drive" — any mention of a list triggers these actions.
- LIST_CREATE: { "type": "LIST_CREATE", "name": "list name", "category": "shopping" | "health" | "tasks" | "personal" | "other" } — use when ${userName} says "create a list", "make a list", "start a list", "new list". Infer the category from context (e.g. "shopping list" → shopping, "medication list" → health, "to-do list" → tasks).
- LIST_ADD: { "type": "LIST_ADD", "listName": "list name", "items": ["item1", "item2"] } — use when ${userName} says "add X to my Y list", "put X on my Y list". Multiple items can be added at once.
- LIST_REMOVE: { "type": "LIST_REMOVE", "listName": "list name", "items": ["item1"] } — use when ${userName} says "remove X from my Y list", "take X off my Y list", "delete X from my Y list".
- LIST_READ: { "type": "LIST_READ", "listName": "list name" } — use when ${userName} asks "what's on my Y list?", "read my Y list", "show me my Y list".

Example — ${userName} says "create a shopping list":
{ "speech": "Shopping list created.", "actions": [{ "type": "LIST_CREATE", "name": "Shopping List", "category": "shopping" }], "pendingThreads": [] }

Example — ${userName} says "add milk, eggs, and bread to my shopping list":
{ "speech": "Added milk, eggs, and bread to your shopping list.", "actions": [{ "type": "LIST_ADD", "listName": "Shopping List", "items": ["milk", "eggs", "bread"] }], "pendingThreads": [] }

Example — ${userName} says "what's on my shopping list?":
{ "speech": "Checking your shopping list.", "actions": [{ "type": "LIST_READ", "listName": "Shopping List" }], "pendingThreads": [] }

Example — ${userName} says "remove eggs from my shopping list":
{ "speech": "Removed eggs from your shopping list.", "actions": [{ "type": "LIST_REMOVE", "listName": "Shopping List", "items": ["eggs"] }], "pendingThreads": [] }

Guardrails:
- Never give medical advice. Flag health items and suggest contacting a doctor.
- Never ask for or store passwords.
- Never fabricate information not provided to you.
- You cannot send emails directly. ALWAYS use DRAFT_MESSAGE — NEVER say "sent" or "I sent" or "email sent".
- When you emit a DRAFT_MESSAGE action, your speech MUST end with a voice confirmation prompt. For email: "I've drafted an email to {name} about {subject}. Say yes to send, or tell me what to change." For SMS/WhatsApp: "I've drafted a {channel} to {name}. Say yes to send, or tell me what to change." This is critical for hands-free operation — ${userName} may not be looking at the screen.
`.trim();
}

// ─── Main send function ───────────────────────────────────────────────────────

/**
 * Sends ${userName}'s message to Claude and returns Naavi's response.
 * Called from the useOrchestrator hook on every conversation turn.
 */
export async function sendToNaavi(
  userMessage: string,
  conversationHistory: NaaviMessage[],
  briefItems: BriefItem[] = [],
  language: 'en' | 'fr' = 'en',
  diagSessionId?: string,
): Promise<NaaviResponse> {
  const log = (step: string, payload?: Record<string, unknown>) => {
    if (diagSessionId) remoteLog(diagSessionId, step, payload);
  };
  log('sendToNaavi-start');

  // Keep only the last 10 turns (20 messages) to prevent stale history from
  // anchoring Claude's behaviour and overriding fresh knowledge context.
  const recentHistory = conversationHistory
    .filter(m => m.content.trim().length > 0)
    .slice(-20);
  const messages = [
    ...recentHistory,
    { role: 'user' as const, content: userMessage },
  ];

  // V57.9.3 — fast-path user name lookup. Previously this hit the DB via
  // getUserProfile() which took 5 s of cold-start time on every send (got
  // killed by the outer withTimeout). The server now does its own
  // user_settings lookup during prompt assembly, so mobile only needs the
  // name for the broad-query message rewrite below. SecureStore read is
  // ~50 ms and survives JWT refresh / force-stop.
  log('getUserProfile-start');
  const cachedName = await getUserNameAsync();
  const userName = cachedName || 'there';
  log('getUserProfile-end', { userName, source: cachedName ? 'cache' : 'default' });

  // "Broad" queries load every knowledge fragment into context — expensive.
  // The old regex matched "all", "everything", "preferences", "what is my X"
  // which fired on any specific question ("what is my calendar" etc.) and
  // burned ~$13-27/mo/user in wasted tokens. Narrowed to phrases that
  // genuinely ask for a wide recall: "list everything", "what do you know
  // about me", "tell me everything". Specific queries use the pgvector
  // nearest-neighbour search below (5 fragments).
  const isBroadQuery = /\b(list (all|everything)|everything you know|tell me everything|what do you know about me|what are all my|all my (preferences|memories|notes)|know about me)\b/i.test(userMessage);
  console.log('[NaaviClient] userMessage:', userMessage, '| isBroadQuery:', isBroadQuery);
  // Each of these three is wrapped in withTimeout — if any hangs (which V57.1
  // testing showed can happen with no warning), we proceed with safe fallbacks
  // instead of freezing the whole send pipeline. Without these timeouts, a
  // single stuck request blocks every subsequent send (V57.1 Hi/schedule
  // hangs of 3–9 minutes were reproducible — see Session 26 testing).
  // V57.9.3 — dropped fetchSharedPrompt from the parallel pre-fetch.
  // Server-side naavi-chat now fetches the base prompt via get-naavi-prompt
  // itself, so we don't pay the 9s timeout cap or ship the 57 KB result over
  // the wire. Mobile only fetches the small per-query context (health,
  // knowledge) and passes it inline.
  log('parallel-context-start', { isBroadQuery });
  const [healthContext, knowledgeFragments] = await Promise.all([
    withTimeout(getEpicHealthContext(), 6_000, '', 'getEpicHealthContext')
      .then(v => { log('getEpicHealthContext-end', { len: v?.length ?? 0 }); return v; }),
    // Cap at 20 fragments even for broad queries — prior 100-cap was the
    // other half of the cost lever; 20 is enough for "what do you know about
    // me" without bloating the prompt. AAB cost-lever #4.
    withTimeout(
      isBroadQuery ? fetchAllKnowledge(20) : searchKnowledge(userMessage, 5),
      6_000,
      [],
      isBroadQuery ? 'fetchAllKnowledge' : 'searchKnowledge',
    ).then(v => { log('knowledge-end', { count: Array.isArray(v) ? v.length : 0 }); return v; }),
  ]);
  log('parallel-context-end');
  const knowledgeContext = formatFragmentsForContext(knowledgeFragments, isBroadQuery);

  // For broad knowledge queries inject the list directly into the user message so
  // Claude is explicitly instructed to read every item aloud — not reference "above".
  if (isBroadQuery && knowledgeFragments.length > 0) {
    const itemLines = knowledgeFragments.map(f => `- ${f.content}`).join('\n');
    messages[messages.length - 1] = {
      role: 'user' as const,
      content: `${userMessage}\n\n[These are the EXACT items you must read to ${userName} one by one — do not say "listed above", copy every single one into your speech field:\n${itemLines}]`,
    };
  }
  let rawText: string;

  if (isSupabaseConfigured()) {
    // V57.9.3 — server-side prompt assembly. Mobile sends only messages +
    // small context; naavi-chat fetches the canonical 57 KB system prompt
    // itself, eliminating the body-upload bottleneck that caused the 60s
    // cold-start hang.
    log('callNaavi-invoke-start', { message_count: messages.length, brief_count: briefItems.length });
    rawText = await callNaaviEdgeFunction(
      messages,
      {
        language,
        briefItems,
        healthContext,
        knowledgeContext,
      },
      diagSessionId,
    );
    log('callNaavi-invoke-end', { rawText_bytes: rawText.length });
  } else {
    // Fallback — local API key (Phase 7 behaviour). Production never hits
    // this since EAS builds always have SUPABASE_URL + SUPABASE_ANON_KEY
    // env vars set. Kept for the dev path where someone is running with
    // a personal Anthropic key. We still need to build a system prompt
    // for this code path; use the local builder.
    const apiKey = await getApiKey();
    if (!apiKey) {
      throw new Error('API key not configured. Please add your Anthropic API key in Settings.');
    }
    const localSystem = buildSystemPrompt(language, briefItems, healthContext, knowledgeContext, 'there', '');
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: localSystem,
      messages,
    });
    rawText = response.content[0].type === 'text' ? response.content[0].text : '';
  }

  console.log('[NaaviClient] raw Claude response:', rawText);
  const parsed = parseResponse(rawText);
  console.log('[NaaviClient] parsed speech:', parsed.speech);
  return parsed;
}

// ─── Response parser ──────────────────────────────────────────────────────────

function fixSentLanguage(speech: string, actions: NaaviAction[]): string {
  // If Claude said "sent" but there is a DRAFT_MESSAGE action, correct it
  const hasDraft = actions.some(a => a.type === 'DRAFT_MESSAGE');
  if (!hasDraft) return speech;

  // Replace "sent" with "drafted" and ensure confirmation prompt is present
  let fixed = speech
    .replace(/\b(I've sent|I have sent|email sent|message sent|sent the email|sent the message)\b/gi,
      "I've drafted it for your review")
    .replace(/\bsent\b/gi, 'drafted');

  // If speech doesn't end with a confirmation prompt, append one
  if (!/say yes|say send|tell me what to change/i.test(fixed)) {
    fixed = fixed.replace(/[.!]?\s*$/, '. Say yes to send, or tell me what to change.');
  }

  return fixed;
}

function buildFallback(rawText: string): NaaviResponse {
  // Last resort — pull a speech value out with regex so the user always gets a
  // response even if the JSON is broken. Prefer the LAST "speech":"..." match:
  // Claude sometimes emits a reasoning block then a final block, and the final
  // one is what the user expects. Previous bug: first-match returned truncated
  // mid-reasoning strings like "Nothing stored on" without the name.
  const matches = [...rawText.matchAll(/"speech"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
  const lastMatch = matches[matches.length - 1];
  const speech = lastMatch
    ? lastMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"')
    : 'I had trouble with that — could you try again?';
  console.error('[NaaviClient] All parse attempts failed. Raw:', rawText);
  return { speech, actions: [], pendingThreads: [] };
}

function extractJsonBlocks(text: string): string[] {
  // Return all top-level {...} blocks found in text, last-first
  const blocks: string[] = [];
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (text[i] === '}') { depth--; if (depth === 0 && start !== -1) blocks.push(text.slice(start, i + 1)); }
  }
  return blocks.reverse(); // last block first — Claude's self-correction is most recent
}

function parseResponse(rawText: string): NaaviResponse {
  // Strip markdown code blocks if present
  const cleaned = rawText
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  // Try each JSON block last-first (handles Claude self-corrections)
  for (const block of extractJsonBlocks(cleaned)) {
    try {
      const json = JSON.parse(block);
      if (typeof json.speech === 'string') {
        const actions = Array.isArray(json.actions) ? json.actions : [];
        return {
          speech: fixSentLanguage(json.speech, actions),
          actions,
          pendingThreads: Array.isArray(json.pendingThreads) ? json.pendingThreads : [],
        };
      }
    } catch { /* try next block */ }
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  // No JSON at all — treat whole response as speech
  if (start === -1 || end === -1) {
    console.warn('[NaaviClient] No JSON in response:', rawText);
    return { speech: cleaned || 'I did not catch that — could you say it again?', actions: [], pendingThreads: [] };
  }

  const jsonSlice = cleaned.slice(start, end + 1);

  // Pass 1 — standard parse
  try {
    const json = JSON.parse(jsonSlice);
    const actions = Array.isArray(json.actions) ? json.actions : [];
    const speech = typeof json.speech === 'string' ? json.speech : 'I did not catch that — could you say it again?';
    return {
      speech: fixSentLanguage(speech, actions),
      actions,
      pendingThreads: Array.isArray(json.pendingThreads) ? json.pendingThreads : [],
    };
  } catch { /* fall through */ }

  // Pass 2 — fix literal newlines inside string values
  try {
    const sanitized = jsonSlice.replace(
      /"((?:[^"\\]|\\.)*)"/g,
      (_, inner) => `"${inner.replace(/\n/g, '\\n').replace(/\r/g, '')}"`
    );
    const json = JSON.parse(sanitized);
    const actions = Array.isArray(json.actions) ? json.actions : [];
    const speech = typeof json.speech === 'string' ? json.speech : 'I did not catch that — could you say it again?';
    return {
      speech: fixSentLanguage(speech, actions),
      actions,
      pendingThreads: Array.isArray(json.pendingThreads) ? json.pendingThreads : [],
    };
  } catch { /* fall through */ }

  // Pass 3 — aggressively strip all control characters and retry
  try {
    const aggressive = jsonSlice
      .replace(/[\u0000-\u001F\u007F]/g, ' ')  // remove all control chars
      .replace(/,\s*([}\]])/g, '$1')             // remove trailing commas
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":'); // quote unquoted keys
    const json = JSON.parse(aggressive);
    const actions = Array.isArray(json.actions) ? json.actions : [];
    const speech = typeof json.speech === 'string' ? json.speech : 'I did not catch that — could you say it again?';
    return {
      speech: fixSentLanguage(speech, actions),
      actions,
      pendingThreads: Array.isArray(json.pendingThreads) ? json.pendingThreads : [],
    };
  } catch { /* fall through */ }

  // All passes failed — extract speech with regex as last resort
  return buildFallback(rawText);
}
