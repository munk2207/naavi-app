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
import * as SecureStore from 'expo-secure-store';
import { queryWithTimeout, getSessionWithTimeout, getCachedUserId } from './invokeWithTimeout';
import { remoteLog } from './remoteLog';

const SUPABASE_URL     = process.env.EXPO_PUBLIC_SUPABASE_URL     ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// V57.9.7 — dual-write storage adapter.
//
// Why: the internal-test install path appears to wipe app data in
// /data/data/<app>/ even when the user doesn't formally uninstall.
// AsyncStorage lives there, so each install effectively logged the user
// out — Wael had to sign in again every time. SecureStore lives in the
// Android Keystore (a separate, more durable store designed for keys
// that should survive app updates).
//
// Strategy:
//   - WRITE goes to AsyncStorage (fast) AND SecureStore (durable).
//   - READ tries AsyncStorage first; if empty, falls back to SecureStore
//     and back-fills AsyncStorage so subsequent reads are fast.
//   - REMOVE clears both.
//
// SecureStore failures are swallowed so the app keeps working even on
// edge cases (oversized value, Keystore unavailable). Worst case = same
// as today (re-sign-in needed).
//
// SecureStore key naming: only [A-Za-z0-9._-] allowed on iOS Keychain,
// so we sanitize Supabase's raw key (which uses ":" and similar).
const sanitizeKey = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');

const dualAuthStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const fromAsync = await AsyncStorage.getItem(key);
      if (fromAsync != null) return fromAsync;
    } catch { /* ignore */ }
    // AsyncStorage missing — try SecureStore backup.
    try {
      const fromSecure = await SecureStore.getItemAsync(sanitizeKey(key));
      if (fromSecure != null) {
        // Back-fill AsyncStorage for next read (fast path).
        AsyncStorage.setItem(key, fromSecure).catch(() => {});
        return fromSecure;
      }
    } catch { /* ignore */ }
    return null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try { await AsyncStorage.setItem(key, value); } catch { /* ignore */ }
    // Also persist to SecureStore. Don't await — fire-and-forget so it
    // doesn't block the auth flow. Errors are swallowed (e.g. iOS 2 KB
    // Keychain limit on rare oversized session blobs).
    SecureStore.setItemAsync(sanitizeKey(key), value).catch(() => {});
  },
  removeItem: async (key: string): Promise<void> => {
    try { await AsyncStorage.removeItem(key); } catch { /* ignore */ }
    SecureStore.deleteItemAsync(sanitizeKey(key)).catch(() => {});
  },
};

// Supabase client with the canonical Expo-compatible auth options.
//
// The session is persisted in dualAuthStorage (V57.9.7) — AsyncStorage
// for speed + SecureStore for durability across install paths that wipe
// AsyncStorage. autoRefreshToken keeps the access token valid for the
// lifetime of the session. Without persistence on React Native, the
// client held the session in memory only, auto-refresh didn't run
// reliably when the app backgrounded, and after ~1 hour the JWT expired
// silently — breaking every `functions.invoke` including text-to-speech.
// Symptom: "voice stops working mid-session, only logout/login restores
// it." (Session 20, V54.1 build 102.)
export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: Platform.OS === 'web'
        ? {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
          }
        : {
            storage: dualAuthStorage,
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
      scopes: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/tasks.readonly https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly https://www.googleapis.com/auth/contacts',
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

// ─── OAuth scope-version gate ─────────────────────────────────────────────────
//
// Increment REQUIRED_OAUTH_SCOPE_VERSION whenever the Google OAuth scopes
// requested at sign-in change. On app startup, if the version stored in
// AsyncStorage is behind, the user is signed out silently — the next sign-in
// goes through Google OAuth and presents the updated consent screen.
//
// Never decrement. History:
//   1 — initial scopes (calendar, gmail, drive, contacts.readonly)
//   2 — added contacts write scope for MyNaavi Community feature (2026-05-29)
export const REQUIRED_OAUTH_SCOPE_VERSION = 2;
const SCOPE_VERSION_KEY = 'naavi_oauth_scope_version';

/**
 * Call on startup after a session loads. Returns true if the stored scope
 * version is current. Returns false (and signs the user out) if their token
 * was issued under an older scope set — the next sign-in will request the
 * correct scopes via the Google consent screen.
 */
export async function checkOAuthScopeVersion(): Promise<boolean> {
  if (!supabase) return true;
  try {
    const stored = await AsyncStorage.getItem(SCOPE_VERSION_KEY);
    const storedVersion = stored != null ? parseInt(stored, 10) : 0;
    if (storedVersion >= REQUIRED_OAUTH_SCOPE_VERSION) return true;
    console.log(`[Auth] OAuth scope v${storedVersion} < required v${REQUIRED_OAUTH_SCOPE_VERSION} — signing out`);
    await supabase.auth.signOut();
    return false;
  } catch (err) {
    console.warn('[Auth] checkOAuthScopeVersion error:', err);
    return true;
  }
}

/**
 * Call after a successful SIGNED_IN event. Records that this session's token
 * was issued under the current scope set so the startup check passes next time.
 */
export async function markOAuthScopeVersionCurrent(): Promise<void> {
  try {
    await AsyncStorage.setItem(SCOPE_VERSION_KEY, String(REQUIRED_OAUTH_SCOPE_VERSION));
  } catch { /* ignore */ }
}

// ─── Edge Function call ────────────────────────────────────────────────────────

/**
 * Lean per-call context that mobile sends to naavi-chat. Server uses this
 * to assemble the full system prompt itself, so we don't ship 57 KB of
 * shared rules over the wire on every turn (V57.9.3).
 */
export interface NaaviCallContext {
  language: 'en' | 'fr';
  briefItems: any[];
  healthContext: string;
  knowledgeContext: string;
}

export async function callNaaviEdgeFunction(
  messages: { role: 'user' | 'assistant'; content: string }[],
  ctx: NaaviCallContext,
  diagSessionId?: string,
): Promise<string> {
  const url = `${SUPABASE_URL}/functions/v1/naavi-chat`;
  const log = (step: string, payload?: Record<string, unknown>) => {
    if (diagSessionId) remoteLog(diagSessionId, step, payload);
  };

  // Use the user's JWT if logged in, otherwise fall back to anon key.
  // V57.9 — wrapped in a 5s timeout because getSession() can hang indefinitely
  // on a stuck JWT refresh; without this the 60s AbortController below never
  // gets a chance to fire and the user's turn waits forever.
  log('callNaavi-getSession-start');
  const session = await getSessionWithTimeout();
  log('callNaavi-getSession-end', { hasSession: !!session, hasUser: !!session?.user });
  const authToken = session?.access_token ?? SUPABASE_ANON_KEY;
  // V57.9.1 — when the session times out we still want naavi-chat to
  // succeed via the server-side body-fallback (user_id in body). Pull from
  // the live session if available; otherwise fall back to the cached
  // user_id (V57.9.3 — backed by AsyncStorage so it survives force-stop).
  // Without this, anon-key requests get 401 from naavi-chat and the user
  // sees a 60-90s thinking spinner that never produces a reply.
  const userIdForBody = session?.user?.id ?? getCachedUserId();

  // V57.9.3 — hard timeout on the main Claude round-trip reduced from 60s
  // to 25s. Now that the body is ~3 KB instead of ~60 KB the upload time
  // on a sluggish connection is sub-second; Claude itself returns in
  // 1-15s. 25s covers worst-case Claude with comfortable margin; if a
  // request is still pending past 25s the network is too sluggish to be
  // worth waiting for and the user sees a clean error sooner.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 25_000);

  // V57.9.3 lean body — ship messages + small context. naavi-chat fetches
  // the canonical system prompt itself via get-naavi-prompt, so the 57 KB
  // shared rules never travel over the user's network. Drops body from
  // ~60 KB to ~3 KB, kills the 60-second cold-start hang.
  const reqBody = JSON.stringify({
    messages,
    max_tokens: 1024,
    channel: 'app',
    language: ctx.language,
    brief_items: ctx.briefItems,
    health_context: ctx.healthContext,
    knowledge_context: ctx.knowledgeContext,
    ...(userIdForBody ? { user_id: userIdForBody } : {}),
  });
  log('callNaavi-fetch-start', {
    body_bytes: reqBody.length,
    auth_kind: session?.access_token ? 'jwt' : 'anon',
    has_body_user_id: !!userIdForBody,
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: reqBody,
      signal: controller.signal,
    });
    log('callNaavi-fetch-headers', { status: res.status, ok: res.ok });

    if (!res.ok) {
      const body = await res.text();
      log('callNaavi-fetch-error-body', { status: res.status, body_snippet: body.slice(0, 200) });
      throw new Error(`Edge Function error ${res.status}: ${body}`);
    }

    const json = await res.json();
    log('callNaavi-fetch-json-parsed', { has_rawText: !!json?.rawText, has_error: !!json?.error });
    const { rawText, error } = json;
    if (error) throw new Error(`Edge Function returned error: ${error}`);
    return rawText as string;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('callNaavi-fetch-catch', { error: msg.slice(0, 200) });
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

  // V57.12.6 Bug P fix — always populate `phone_number` on the
  // reminders row. The check-reminders cron filters with
  // `.not('phone_number', 'is', null)` (see check-reminders/index.ts:46),
  // so a reminder with NULL phone is silently skipped EVERY minute and
  // never fires its fan-out (SMS / WhatsApp / Email / Push). Wael
  // 2026-05-07 found 8 such orphans accumulated since V57.12.0 — none
  // had ever fired despite being overdue by hours. Fix: when the caller
  // doesn't pass a phone (Claude usually doesn't for self-reminders),
  // fetch the user's number from user_settings.phone and stamp it on
  // the row before insert.
  let phoneNumber = reminder.phone_number?.trim() || '';
  if (!phoneNumber && userId) {
    try {
      const { data } = await queryWithTimeout(
        supabase.from('user_settings').select('phone').eq('user_id', userId).single(),
        5_000,
        'select-user-phone-for-reminder',
      );
      const settingsPhone = (data as any)?.phone;
      if (typeof settingsPhone === 'string' && settingsPhone.trim()) {
        phoneNumber = settingsPhone.trim();
      }
    } catch (err) {
      console.error('[Supabase] saveReminder: phone lookup failed:', err);
    }
  }

  const { error } = await queryWithTimeout(
    supabase.from('reminders').insert({
      title:        reminder.title,
      datetime:     reminder.datetime,
      source:       reminder.source,
      phone_number: phoneNumber || null,
      user_id:      userId ?? null,
    }),
    15_000,
    'insert-reminder',
  );
  if (error) {
    console.error('[Supabase] Failed to save reminder:', error.message);
  } else {
    console.log(`[Supabase] Reminder saved: "${reminder.title}" phone=${phoneNumber || '(none — will not fire via cron!)'}`);
  }
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
