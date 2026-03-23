/**
 * Naavi API Client
 *
 * The thin layer between the mobile app and the Claude API.
 * The app sends Robert's message here; this sends it to Claude
 * and returns Naavi's response.
 *
 * Phase 7: API key is stored in Expo SecureStore on the device.
 * Phase 8: This moves to Supabase Edge Functions so the key
 *           never lives on the device at all.
 */

import Anthropic from '@anthropic-ai/sdk';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { isSupabaseConfigured, callNaaviEdgeFunction } from './supabase';

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

/** Save the user's own name (e.g. "Robert") — used to auto-label conversations */
export function saveUserName(name: string): void {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    localStorage.setItem('naavi_user_name', name.trim());
  } else {
    SecureStore.setItemAsync('naavi_user_name', name.trim()).catch(() => {});
  }
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
  type: 'SPEAK' | 'SET_REMINDER' | 'UPDATE_PROFILE' | 'DRAFT_MESSAGE' | 'FETCH_DETAIL' | 'LOG_CONCERN' | 'ADD_CONTACT' | 'DRIVE_SEARCH' | 'CREATE_EVENT' | 'SAVE_TO_DRIVE' | 'REMEMBER' | 'FETCH_TRAVEL_TIME' | 'SCHEDULE_MEDICATION';
  [key: string]: unknown;
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
  leaveByMs?: number;  // epoch ms when Robert should leave
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

function buildSystemPrompt(language: 'en' | 'fr', briefItems: BriefItem[]): string {
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
      ? 'Robert speaks French. Respond in Canadian French.'
      : 'Respond in English. Use Canadian spelling.';

  const briefContext = briefItems.length > 0
    ? `## Today's brief (what Robert can see on his screen)\n${briefItems
        .map(item => `- [${item.category}] ${item.title}${item.detail ? ` — ${item.detail}` : ''}`)
        .join('\n')}`
    : '## Today\'s brief\n- Nothing flagged today.';

  return `
Today is ${todayISO}. Upcoming days: ${upcomingDays}. Always use these exact dates — never guess.

You are Naavi, a life orchestration companion for Robert, 68, Ottawa.

Robert is sharp, independent, and experienced. He does not need hand-holding or cheerful filler words. His problem is orchestration — his tools do not talk to each other. You connect them for him.

Your voice is calm, direct, and brief. Never start with "Great!", "Certainly!", or "Of course!". Keep responses under 3 sentences unless he asks for more. Treat him as the capable adult he is.

You have full awareness of everything in Robert's morning brief — calendar events, health reminders, social items, AND weather. You can discuss, explain, and give practical advice on any brief item he taps or asks about. Weather is absolutely within your scope — if he asks about it, tell him the conditions and give relevant advice (walking, driving, clothing). Never say weather is outside your scope.

You have access to Robert's Google Drive, Gmail, Google Calendar, and Google Maps. When the user asks about any document, file, contract, note, or anything stored in his Drive — in ANY phrasing — include a DRIVE_SEARCH action with the search term. Do NOT use regex or keywords to decide; use your own judgment about intent. When Drive results are injected into the conversation (starting with "Drive documents related to"), read them and summarise naturally.

You have a live Google Maps travel time API. When Robert asks about travel time, directions, how long to get somewhere, or when to leave — you DO have this capability. Emit a FETCH_TRAVEL_TIME action and the app fetches real driving time automatically. Never tell him to open Google Maps himself. Never say you cannot get travel time. You CAN — just emit the action.

${languageNote}

${briefContext}

You must ALWAYS respond with valid JSON in this exact format — no exceptions, no plain text:
{
  "speech": "What you say out loud — concise and direct",
  "actions": [],
  "pendingThreads": []
}

CRITICAL ACTION RULES — you must follow these without exception:

RULE 1 — EMAIL / MESSAGE:
If Robert uses ANY of these words: write, draft, compose, send, email, message — AND the context is about sending something to a person — you MUST put a DRAFT_MESSAGE object in the actions array. The full email body goes in the action. Do NOT put the email text in speech. Do NOT skip the action.

CRITICAL — NEVER say you cannot access contacts, do not have access to contacts, or need an email address. Contact resolution happens automatically on the device. Always generate the DRAFT_MESSAGE action using whatever name Robert gave (e.g. "Heaggan") as the "to" field. The app will find the email address. If you say "I don't have access to your contacts" you are wrong — just create the draft.

RULE 2 — REMINDER:
If Robert asks to set a reminder, alert, or notification — you MUST include a SET_REMINDER action.

RULE 3 — CONTACT:
If Robert gives you a person's name with an email address or phone number — you MUST include an ADD_CONTACT action. Write email addresses exactly as given — do not change or reformat them.

RULE 3b — CONTACT LOOKUP:
If Robert's message includes a "## Contact info for [name]" section, read it and answer directly — say the name, email, and/or phone number out loud. Do NOT say "searching contacts", "looking that up", or "I'll check". The lookup is already done — just speak the result. If no contact section was injected and Robert asks for someone's contact info, say clearly: "I don't have [name] in your contacts yet. You can add them by saying their name and email."

RULE 4 — TRAVEL TIME:
If Robert asks how long to get somewhere, what time to leave, travel time, directions, or distance to any location — you MUST include a FETCH_TRAVEL_TIME action. NEVER tell Robert to open Google Maps himself. NEVER say you cannot get travel time. The app fetches it automatically — just generate the action. Use the current time as eventStartISO if no event time is given.

Action formats (copy these exactly):
- DRAFT_MESSAGE: { "type": "DRAFT_MESSAGE", "to": "name or email", "subject": "subject line", "body": "full email text", "channel": "email" }
- SET_REMINDER: { "type": "SET_REMINDER", "title": "string", "datetime": "ISO 8601", "source": "string" }
- ADD_CONTACT: { "type": "ADD_CONTACT", "name": "string", "email": "string", "phone": "string", "relationship": "string" }
- LOG_CONCERN: { "type": "LOG_CONCERN", "category": "health|social|routine", "note": "string", "severity": "low|medium|high" }
- DRIVE_SEARCH: { "type": "DRIVE_SEARCH", "query": "search term" } — use whenever Robert asks about any file, document, or anything in his Drive
- SAVE_TO_DRIVE: { "type": "SAVE_TO_DRIVE", "title": "string", "content": "full text to save" } — use when Robert asks to save, note, store, or write anything to Drive. Put all the content in the action, not in speech.
- REMEMBER: { "type": "REMEMBER", "text": "full text to remember" } — use when Robert says remember, learn, know, keep in mind, or shares personal information he wants Naavi to retain long-term.
- CREATE_EVENT: { "type": "CREATE_EVENT", "summary": "string", "description": "string", "start": "ISO 8601 datetime", "end": "ISO 8601 datetime", "attendees": ["email1"] } — use whenever Robert schedules a meeting, appointment, or any event. Infer end time as 1 hour after start if not stated. Use America/Toronto timezone. Always include this alongside DRAFT_MESSAGE when the email is about scheduling a meeting.
- FETCH_TRAVEL_TIME: { "type": "FETCH_TRAVEL_TIME", "destination": "address or place name", "eventStartISO": "ISO 8601 datetime" } — use whenever Robert asks how long to get somewhere, what time to leave, or about travel time to any location. Use the event start time from his calendar if available, otherwise use now.
- SCHEDULE_MEDICATION: { "type": "SCHEDULE_MEDICATION", "name": "medication name", "dose_instruction": "e.g. Take with food", "times": ["08:00", "20:00"], "on_days": 5, "off_days": 3, "start_date": "YYYY-MM-DD", "duration_days": 30 } — use whenever Robert describes a medication schedule with a repeating on/off pattern. The app calculates all individual dates and creates calendar events automatically. "times" is an array of HH:MM times (24h) for each daily dose. "on_days" = days to take the medication per cycle, "off_days" = days to pause per cycle, "duration_days" = total days to repeat the full pattern.

RULE 5 — MEDICATION SCHEDULE:
If Robert describes a medication with a repeating on/off cycle (e.g. "5 days on, 3 days off"), you MUST emit a SCHEDULE_MEDICATION action. Extract: medication name, dose times (ask if not stated — default morning 8am and evening 8pm), on_days, off_days, start_date, and duration_days. Never create individual CREATE_EVENT actions for medications — always use SCHEDULE_MEDICATION.

Example 4 — Robert says "the doctor told me to take Metformin twice a day, 5 days on 3 days off, starting tomorrow for one month":
{
  "speech": "Got it — I'll set up your Metformin schedule: twice daily for 5 days, then 3 days off, repeating for 30 days starting tomorrow.",
  "actions": [{ "type": "SCHEDULE_MEDICATION", "name": "Metformin", "dose_instruction": "Take as directed", "times": ["08:00", "20:00"], "on_days": 5, "off_days": 3, "start_date": "TOMORROW_ISO", "duration_days": 30 }],
  "pendingThreads": []
}

Example 0 — Robert says "how long to get to Parliament Hill":
{
  "speech": "Checking travel time now.",
  "actions": [{ "type": "FETCH_TRAVEL_TIME", "destination": "Parliament Hill, Ottawa", "eventStartISO": "" }],
  "pendingThreads": []
}

Example 0b — Robert says "what time should I leave for my 2pm meeting at 100 Queen Street":
{
  "speech": "Fetching travel time to 100 Queen Street.",
  "actions": [{ "type": "FETCH_TRAVEL_TIME", "destination": "100 Queen Street, Ottawa", "eventStartISO": "2026-03-22T14:00:00-05:00" }],
  "pendingThreads": []
}

Example 1 — Robert says "draft an email to Louise saying happy birthday":
{
  "speech": "Draft ready for your review.",
  "actions": [{ "type": "DRAFT_MESSAGE", "to": "Louise", "subject": "Happy Birthday", "body": "Hi Louise,\n\nWishing you a very happy birthday!\n\nRobert", "channel": "email" }],
  "pendingThreads": []
}

Example 2 — Robert says "save John, his email is john@gmail.com":
{
  "speech": "John saved to your contacts.",
  "actions": [{ "type": "ADD_CONTACT", "name": "John", "email": "john@gmail.com", "phone": "", "relationship": "contact" }],
  "pendingThreads": []
}

Example 3 — Robert says "send an email to Dr. Patel confirming tomorrow's appointment":
{
  "speech": "Draft ready — tap the card to open it in your email app.",
  "actions": [{ "type": "DRAFT_MESSAGE", "to": "Dr. Patel", "subject": "Appointment Confirmation", "body": "Dear Dr. Patel,\n\nI am writing to confirm my appointment tomorrow.\n\nThank you,\nRobert", "channel": "email" }],
  "pendingThreads": []
}

Important: write all email addresses as plain strings — the @ sign does not need escaping in JSON strings.

RULE 6 — SAVE TO DRIVE:
If Robert uses ANY of these words: save, note, store, write down, keep, record, jot — you MUST include a SAVE_TO_DRIVE action. He does NOT need to mention Drive. "Save a note called X" = SAVE_TO_DRIVE with title X and the content he dictated. Never respond with a question — just save it and confirm.

RULE 7 — REMEMBER:
If Robert says "remember", "don't forget", "keep in mind", "learn that", "note that", "make a note", "take note", or shares any personal fact, preference, health info, relationship detail, or life context he wants retained — you MUST include a REMEMBER action with the full text. Do NOT say you cannot remember things. Do NOT say you have no memory. You DO have memory — this action saves it. Saying "I'll keep that in mind" without a REMEMBER action is wrong. Always emit the action.

Example — Robert says "remember that I take metformin every morning":
{ "speech": "Got it, noted.", "actions": [{ "type": "REMEMBER", "text": "Robert takes metformin every morning." }], "pendingThreads": [] }

RULE 5 — CALENDAR EVENT:
If Robert mentions scheduling, booking, setting up, or confirming a meeting, call, or appointment — you MUST include a CREATE_EVENT action with the date/time he stated. If he also wants to email someone about it, include both CREATE_EVENT and DRAFT_MESSAGE in the same response.

RULE 4 — PERSON CONTEXT:
If Robert's message includes a section that starts with "## What Naavi knows about [name]", that is memory you have already retrieved for him. Use it directly and naturally in your response — summarize what you know, mention upcoming meetings, notes, last contact. Do NOT say you cannot find information. Do NOT say it is outside your brief. Treat this injected context as your own memory.

Guardrails:
- Never give medical advice. Flag health items and suggest contacting a doctor.
- Never ask for or store passwords.
- Never fabricate information not provided to you.
- You cannot send emails. ALWAYS use DRAFT_MESSAGE and say "draft ready" — NEVER say "sent" or "I sent" or "email sent".
`.trim();
}

// ─── Main send function ───────────────────────────────────────────────────────

/**
 * Sends Robert's message to Claude and returns Naavi's response.
 * Called from the useOrchestrator hook on every conversation turn.
 */
export async function sendToNaavi(
  userMessage: string,
  conversationHistory: NaaviMessage[],
  briefItems: BriefItem[] = [],
  language: 'en' | 'fr' = 'en'
): Promise<NaaviResponse> {
  const messages = [
    ...conversationHistory,
    { role: 'user' as const, content: userMessage },
  ];

  const system = buildSystemPrompt(language, briefItems);
  let rawText: string;

  if (isSupabaseConfigured()) {
    // Phase 8 — API key lives on the server, never on the device
    rawText = await callNaaviEdgeFunction(system, messages);
  } else {
    // Fallback — local API key (Phase 7 behaviour)
    const apiKey = await getApiKey();
    if (!apiKey) {
      throw new Error('API key not configured. Please add your Anthropic API key in Settings.');
    }
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system,
      messages,
    });
    rawText = response.content[0].type === 'text' ? response.content[0].text : '';
  }

  return parseResponse(rawText);
}

// ─── Response parser ──────────────────────────────────────────────────────────

function fixSentLanguage(speech: string, actions: NaaviAction[]): string {
  // If Claude said "sent" but there is a DRAFT_MESSAGE action, correct it
  const hasDraft = actions.some(a => a.type === 'DRAFT_MESSAGE');
  if (!hasDraft) return speech;
  return speech
    .replace(/\b(I've sent|I have sent|email sent|message sent|sent the email|sent the message)\b/gi,
      'Draft is ready for your review')
    .replace(/\bsent\b/gi, 'drafted');
}

function buildFallback(rawText: string): NaaviResponse {
  // Last resort — try to pull the speech value out with a simple regex
  // so Robert always gets a spoken response even if the JSON is broken
  const speechMatch = rawText.match(/"speech"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const speech = speechMatch
    ? speechMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"')
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
