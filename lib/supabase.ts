/**
 * Supabase client — Phase 8
 *
 * Handles two things:
 * 1. Calling the naavi-chat Edge Function (Anthropic key lives server-side)
 * 2. Saving contacts and reminders to the database
 */

import { createClient } from '@supabase/supabase-js';
import { Platform, AppState } from 'react-native';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { queryWithTimeout, getSessionWithTimeout, getCachedUserId } from './invokeWithTimeout';

const SUPABASE_URL     = process.env.EXPO_PUBLIC_SUPABASE_URL     ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Supabase client with the canonical Expo-compatible auth options.
//
// The session is persisted in AsyncStorage so it survives app restarts, and
// autoRefreshToken keeps the access token valid for the lifetime of the
// session. Without this config on React Native, the client held the session
// in memory only, auto-refresh didn't run reliably when the app backgrounded,
// and after ~1 hour the JWT expired silently — breaking every `functions.invoke`
// including text-to-speech. Symptom: "voice stops working mid-session, only
// logout/login restores it." (Session 20, V54.1 build 102.)
export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: Platform.OS === 'web'
        ? {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
          }
        : {
            storage: AsyncStorage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false,
          },
    })
  : null;

// On native, tell Supabase to restart the refresh timer every time the app
// foregrounds and stop it when backgrounded. Without this, the timer can
// drift or die during long backgrounded periods, letting the JWT expire.
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// ─── Google Sign-In ───────────────────────────────────────────────────────────

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');

  const redirectTo = Platform.OS === 'web'
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`
    : Linking.createURL('auth/callback');

  if (Platform.OS === 'web') {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    return;
  }

  // Native: open system browser — app handles callback via deep link in _layout.tsx
  // access_type=offline + prompt=consent ensures Google returns a refresh token
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      scopes: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/tasks.readonly https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly',
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });
  if (error || !data.url) throw new Error(error?.message ?? 'No auth URL');
  await Linking.openURL(data.url);
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

// ─── Edge Function call ────────────────────────────────────────────────────────

export async function callNaaviEdgeFunction(
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const url = `${SUPABASE_URL}/functions/v1/naavi-chat`;

  // Use the user's JWT if logged in, otherwise fall back to anon key.
  // V57.9 — wrapped in a 5s timeout because getSession() can hang indefinitely
  // on a stuck JWT refresh; without this the 60s AbortController below never
  // gets a chance to fire and the user's turn waits forever.
  const session = await getSessionWithTimeout();
  const authToken = session?.access_token ?? SUPABASE_ANON_KEY;
  // V57.9.1 — when the session times out we still want naavi-chat to
  // succeed via the server-side body-fallback (user_id in body). Pull from
  // the live session if available; otherwise fall back to the cached
  // user_id from the last successful getSession in this app session.
  // Without this, anon-key requests get 401 from naavi-chat and the user
  // sees a 60-90s thinking spinner that never produces a reply (Wael
  // testing 2026-04-30).
  const userIdForBody = session?.user?.id ?? getCachedUserId();

  // Hard timeout on the main Claude round-trip. V57.1 testing reproduced
  // requests that hung indefinitely with no error — without an AbortController
  // the JS process never recovers. 60s covers Claude's worst-case latency
  // with comfortable margin; a real Claude reply is 5-15s. After 60s we
  // throw so the orchestrator can show an error instead of "Thinking..." forever.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        system,
        messages,
        max_tokens: 2048,
        ...(userIdForBody ? { user_id: userIdForBody } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Edge Function error ${res.status}: ${body}`);
    }

    const { rawText, error } = await res.json();
    if (error) throw new Error(`Edge Function returned error: ${error}`);
    return rawText as string;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('AbortError')) {
      throw new Error('Naavi took too long to respond. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(abortTimer);
  }
}

// ─── Database helpers ──────────────────────────────────────────────────────────

export async function saveContact(contact: {
  name: string;
  email: string;
  phone?: string;
  relationship?: string;
}): Promise<void> {
  if (!supabase) return;
  const session = await getSessionWithTimeout();
  const userId = session?.user?.id;
  if (!userId) {
    console.error('[Supabase] Cannot save contact — no user session');
    return;
  }
  // Save name, email, and phone. Phone is new as of V52 — the contacts
  // table has a phone column (migration 20260419_contacts_phone.sql) and
  // the Global Search contacts adapter matches on it. `phone || null`
  // avoids inserting an empty string when Claude didn't extract one.
  const { error } = await queryWithTimeout(
    supabase.from('contacts').insert({
      user_id: userId,
      name: contact.name,
      email: contact.email || null,
      phone: contact.phone?.trim() || null,
    }),
    15_000,
    'insert-contact',
  );
  if (error) console.error('[Supabase] Failed to save contact:', error.message);
  else console.log('[Supabase] Contact saved:', contact.name);
}

export async function saveReminder(reminder: {
  title: string;
  datetime: string;
  source: string;
  phone_number?: string;
}): Promise<void> {
  if (!supabase) return;
  const session = await getSessionWithTimeout();
  const userId = session?.user?.id;
  const { error } = await queryWithTimeout(
    supabase.from('reminders').insert({
      ...reminder,
      user_id: userId ?? null,
    }),
    15_000,
    'insert-reminder',
  );
  if (error) console.error('[Supabase] Failed to save reminder:', error.message);
  else console.log('[Supabase] Reminder saved:', reminder.title);
}

// ─── Conversation persistence ──────────────────────────────────────────────────

export async function saveConversationTurn(turn: object): Promise<void> {
  if (!supabase) return;
  const session = await getSessionWithTimeout();
  const userId = session?.user?.id;
  if (!userId) return;

  const today = new Date().toISOString().split('T')[0];

  // Try to update today's existing session first
  const { data: existing } = await queryWithTimeout(
    supabase
      .from('conversations')
      .select('id, turns')
      .eq('user_id', userId)
      .eq('session_date', today)
      .maybeSingle(),
    15_000,
    'select-today-conversation',
  );

  if (existing) {
    const turns = Array.isArray(existing.turns) ? existing.turns : [];
    turns.push(turn);
    await queryWithTimeout(
      supabase
        .from('conversations')
        .update({ turns, updated_at: new Date().toISOString() })
        .eq('id', existing.id),
      15_000,
      'update-conversation-turns',
    );
  } else {
    await queryWithTimeout(
      supabase
        .from('conversations')
        .insert({ user_id: userId, session_date: today, turns: [turn] }),
      15_000,
      'insert-conversation',
    );
  }
}

export async function loadTodayConversation(): Promise<object[]> {
  if (!supabase) return [];
  const session = await getSessionWithTimeout();
  const userId = session?.user?.id;
  if (!userId) return [];

  const today = new Date().toISOString().split('T')[0];
  const { data } = await queryWithTimeout(
    supabase
      .from('conversations')
      .select('turns')
      .eq('user_id', userId)
      .eq('session_date', today)
      .maybeSingle(),
    15_000,
    'load-today-conversation',
  );

  return Array.isArray(data?.turns) ? data.turns : [];
}

export async function saveDriveNote(note: {
  title: string;
  webViewLink?: string;
}): Promise<void> {
  if (!supabase) return;
  const session = await getSessionWithTimeout();
  const userId = session?.user?.id;
  if (!userId) return;
  const { error } = await queryWithTimeout(
    supabase.from('naavi_notes').insert({
      user_id: userId,
      title: note.title,
      web_view_link: note.webViewLink ?? null,
    }),
    15_000,
    'insert-drive-note',
  );
  if (error) console.error('[Supabase] Failed to save drive note:', error.message);
  else console.log('[Supabase] Drive note saved:', note.title);
}
