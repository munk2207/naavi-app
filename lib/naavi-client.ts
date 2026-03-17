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
  type: 'SPEAK' | 'SET_REMINDER' | 'UPDATE_PROFILE' | 'DRAFT_MESSAGE' | 'FETCH_DETAIL' | 'LOG_CONCERN' | 'ADD_CONTACT';
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
You are Naavi, a life orchestration companion for Robert, 68, Ottawa.

Robert is sharp, independent, and experienced. He does not need hand-holding or cheerful filler words. His problem is orchestration — his tools do not talk to each other. You connect them for him.

Your voice is calm, direct, and brief. Never start with "Great!", "Certainly!", or "Of course!". Keep responses under 3 sentences unless he asks for more. Treat him as the capable adult he is.

${languageNote}

${briefContext}

You must ALWAYS respond with valid JSON in this exact format:
{
  "speech": "What you say out loud — concise and direct",
  "actions": [],
  "pendingThreads": []
}

Allowed action types:
- SET_REMINDER: { "type": "SET_REMINDER", "title": "string", "datetime": "ISO 8601", "source": "string" }
- DRAFT_MESSAGE: { "type": "DRAFT_MESSAGE", "to": "string", "subject": "string", "body": "string", "channel": "email" }
- ADD_CONTACT: { "type": "ADD_CONTACT", "name": "string", "email": "string", "phone": "string", "relationship": "string" }
- LOG_CONCERN: { "type": "LOG_CONCERN", "category": "health|social|routine", "note": "string", "severity": "low|medium|high" }

Important: email addresses must be written as plain strings inside JSON — do not escape the @ sign.

Guardrails:
- Never give medical advice. Flag health items and suggest contacting a doctor.
- Never ask for or store passwords.
- Never fabricate information not provided to you.
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
  const apiKey = await getApiKey();

  if (!apiKey) {
    throw new Error('API key not configured. Please add your Anthropic API key in Settings.');
  }

  // Build the message array for Claude
  const messages = [
    ...conversationHistory,
    { role: 'user' as const, content: userMessage },
  ];

  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemPrompt(language, briefItems),
    messages,
  });

  const rawText: string =
    response.content[0].type === 'text' ? response.content[0].text : '';

  return parseResponse(rawText);
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseResponse(rawText: string): NaaviResponse {
  // Strip markdown code blocks if present
  let cleaned = rawText
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  // If there's no JSON at all, treat the whole response as speech
  if (start === -1 || end === -1) {
    console.warn('[NaaviClient] No JSON in response — treating as plain speech:', rawText);
    return {
      speech: cleaned || 'I did not catch that — could you say it again?',
      actions: [],
      pendingThreads: [],
    };
  }

  const jsonSlice = cleaned.slice(start, end + 1);

  try {
    const json = JSON.parse(jsonSlice);
    return {
      speech: typeof json.speech === 'string' ? json.speech : 'I did not catch that — could you say it again?',
      actions: Array.isArray(json.actions) ? json.actions : [],
      pendingThreads: Array.isArray(json.pendingThreads) ? json.pendingThreads : [],
    };
  } catch (firstError) {
    // Second attempt: replace literal newlines inside string values, which
    // Claude occasionally emits and which break JSON.parse
    try {
      const sanitized = jsonSlice.replace(
        /"((?:[^"\\]|\\.)*)"/g,
        (_, inner) => `"${inner.replace(/\n/g, '\\n').replace(/\r/g, '')}"`
      );
      const json = JSON.parse(sanitized);
      return {
        speech: typeof json.speech === 'string' ? json.speech : 'I did not catch that — could you say it again?',
        actions: Array.isArray(json.actions) ? json.actions : [],
        pendingThreads: Array.isArray(json.pendingThreads) ? json.pendingThreads : [],
      };
    } catch {
      console.error('[NaaviClient] Failed to parse response after sanitization:', rawText);
      return {
        speech: 'I had trouble understanding that — could you rephrase it?',
        actions: [],
        pendingThreads: [],
      };
    }
  }
}
