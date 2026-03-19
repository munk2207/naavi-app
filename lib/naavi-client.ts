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
  type: 'SPEAK' | 'SET_REMINDER' | 'UPDATE_PROFILE' | 'DRAFT_MESSAGE' | 'FETCH_DETAIL' | 'LOG_CONCERN' | 'ADD_CONTACT' | 'DRIVE_SEARCH' | 'CREATE_EVENT' | 'SAVE_TO_DRIVE';
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
  category: 'calendar' | 'health' | 'weather' | 'social' | 'home' | 'task';
  title: string;
  detail?: string;
  urgent: boolean;
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

You have access to Robert's Google Drive, Gmail, and Google Calendar. When the user asks about any document, file, contract, note, or anything stored in his Drive — in ANY phrasing — include a DRIVE_SEARCH action with the search term. Do NOT use regex or keywords to decide; use your own judgment about intent. When Drive results are injected into the conversation (starting with "Drive documents related to"), read them and summarise naturally.

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
If Robert uses ANY of these words: write, draft, compose, send, email, message, note — you MUST put a DRAFT_MESSAGE object in the actions array. The full email body goes in the action. Do NOT put the email text in speech. Do NOT skip the action.

RULE 2 — REMINDER:
If Robert asks to set a reminder, alert, or notification — you MUST include a SET_REMINDER action.

RULE 3 — CONTACT:
If Robert gives you a person's name with an email address or phone number — you MUST include an ADD_CONTACT action. Write email addresses exactly as given — do not change or reformat them.

Action formats (copy these exactly):
- DRAFT_MESSAGE: { "type": "DRAFT_MESSAGE", "to": "name or email", "subject": "subject line", "body": "full email text", "channel": "email" }
- SET_REMINDER: { "type": "SET_REMINDER", "title": "string", "datetime": "ISO 8601", "source": "string" }
- ADD_CONTACT: { "type": "ADD_CONTACT", "name": "string", "email": "string", "phone": "string", "relationship": "string" }
- LOG_CONCERN: { "type": "LOG_CONCERN", "category": "health|social|routine", "note": "string", "severity": "low|medium|high" }
- DRIVE_SEARCH: { "type": "DRIVE_SEARCH", "query": "search term" } — use whenever Robert asks about any file, document, or anything in his Drive
- SAVE_TO_DRIVE: { "type": "SAVE_TO_DRIVE", "title": "string", "content": "full text to save" } — use when Robert asks to save, note, store, or write anything to Drive. Put all the content in the action, not in speech.
- CREATE_EVENT: { "type": "CREATE_EVENT", "summary": "string", "description": "string", "start": "ISO 8601 datetime", "end": "ISO 8601 datetime", "attendees": ["email1"] } — use whenever Robert schedules a meeting, appointment, or any event. Infer end time as 1 hour after start if not stated. Use America/Toronto timezone. Always include this alongside DRAFT_MESSAGE when the email is about scheduling a meeting.

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

function parseResponse(rawText: string): NaaviResponse {
  // Strip markdown code blocks if present
  const cleaned = rawText
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

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
