/**
 * invokeWithTimeout — central wrapper for `supabase.functions.invoke()`.
 *
 * Why this exists (V57.4):
 *   The Supabase JS SDK's `.functions.invoke()` does NOT impose a client-side
 *   timeout. When an Edge Function stalls (third-party API hang — Google
 *   People, Whisper, Anthropic, Vision — or a temporary network blip), the
 *   awaiting promise hangs INDEFINITELY. We hit this repeatedly in V57.3
 *   testing: 2-3 minute hangs on transcribe-memo, lookup-contact, naavi-chat,
 *   text-to-speech, etc. Each one independently.
 *
 *   This helper wraps every invoke call in a `Promise.race` against a timer.
 *   On timeout, the call resolves with `{ data: null, error: 'timeout' }` so
 *   callers can fall through to a fallback (next contact source, friendly
 *   error message) instead of leaving the user staring at a frozen UI.
 *
 * Default 30s — most Edge Functions return in < 5s. Anything past 30s is a
 * stall. Pass `timeoutMs` explicitly for slow operations (uploads, OCR).
 *
 * Recommended timeouts per operation type:
 *   - lookups (contacts, knowledge, search):   15s
 *   - chat / Claude round-trip:                60s
 *   - TTS / STT (audio generation):            30s
 *   - file uploads / Drive writes:             60s
 *   - background fire-and-forget (push, log):  10s
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// V57.9.3 — persist last-known user_id to AsyncStorage so it survives
// force-stop and fresh launches. Without this, the very first chat send
// after a force-stop hits the anon-key path with no body.user_id, and
// naavi-chat returns 401 (V57.7 multi-user safety). Combined with the
// 60 KB request body taking ~60 s to upload on a sluggish network, this
// is the headline cold-start hang we're shipping V57.9.3 to fix.
const USER_ID_STORAGE_KEY = 'naavi_last_known_user_id';

export interface InvokeResult<T> {
  data: T | null;
  error: any;
}

/** Wrap supabase.functions.invoke() with a hard timeout cap. */
export async function invokeWithTimeout<T = any>(
  fnName: string,
  options: { body?: any; headers?: Record<string, string> } = {},
  timeoutMs: number = 30_000,
): Promise<InvokeResult<T>> {
  if (!supabase) {
    return { data: null, error: 'no-supabase-client' };
  }

  const invokePromise: Promise<InvokeResult<T>> = supabase.functions
    .invoke(fnName, options)
    .then((res) => res as InvokeResult<T>);

  const timeoutPromise: Promise<InvokeResult<T>> = new Promise((resolve) => {
    setTimeout(() => {
      console.warn(`[invokeWithTimeout] ${fnName} timed out after ${timeoutMs}ms`);
      resolve({ data: null, error: { name: 'TimeoutError', message: `${fnName} timed out after ${timeoutMs}ms` } });
    }, timeoutMs);
  });

  return Promise.race([invokePromise, timeoutPromise]);
}

/**
 * queryWithTimeout — wraps a Postgrest query (supabase.from(...).select/insert/
 * update/delete) with a hard timeout cap.
 *
 * Why this exists (V57.5):
 *   The Supabase JS SDK's PostgrestBuilder also has NO client-side timeout.
 *   V57.4 audited and wrapped every supabase.functions.invoke() call, but
 *   missed direct .from() queries. The LocationRuleCard toggle hung for 4+
 *   minutes because supabase.from('action_rules').update(...).eq('id', x)
 *   stalled with no fallback. Same bug class.
 *
 * Usage:
 *   const { data, error } = await queryWithTimeout(
 *     supabase.from('action_rules').update({ one_shot: true }).eq('id', ruleId),
 *     15_000,
 *     'update-rule-one-shot',
 *   );
 *
 * Default 15s — reads/writes typically return in < 2s. 15s is comfortable
 * headroom. On timeout the call resolves with `{ data: null, error: 'timeout' }`
 * so callers can show an error instead of leaving the user staring at a frozen
 * UI.
 *
 * Recommended timeouts per query type:
 *   - select / read:                10-15s
 *   - insert / update / delete:     15s
 *   - bulk insert (>50 rows):       30s
 */
export async function queryWithTimeout<T = any>(
  query: PromiseLike<{ data: T | null; error: any }>,
  timeoutMs: number = 15_000,
  label?: string,
): Promise<{ data: T | null; error: any }> {
  const queryPromise: Promise<{ data: T | null; error: any }> = Promise.resolve(query);

  const timeoutPromise: Promise<{ data: null; error: any }> = new Promise((resolve) => {
    setTimeout(() => {
      const msg = `${label ?? 'query'} timed out after ${timeoutMs}ms`;
      console.warn(`[queryWithTimeout] ${msg}`);
      resolve({ data: null, error: { name: 'TimeoutError', message: msg } });
    }, timeoutMs);
  });

  return Promise.race([queryPromise, timeoutPromise]);
}

/**
 * getSessionWithTimeout — wraps supabase.auth.getSession() with a hard timeout.
 *
 * Why this exists (V57.9):
 *   The Supabase JS SDK's getSession() can hang indefinitely when the JWT is
 *   expired and the refresh attempt stalls (network blip, slow DNS, captive
 *   portal). The V57.4 timeout audit covered functions.invoke() and the V57.5
 *   audit covered .from() queries, but auth.getSession() was missed and quietly
 *   blocks every code path that needs the user's session — including
 *   callNaaviEdgeFunction, where it runs BEFORE the 60s AbortController on the
 *   actual fetch. A stuck refresh hangs the whole turn with no recovery.
 *
 * On timeout returns null (same shape as "no session"). Callers that already
 * branch on session?.user being absent will fall through to their existing
 * fallback path (anon key, server-side body user_id resolution, etc.).
 *
 * V57.9.1 — also caches the resolved user_id at module scope. Callers that
 * have a server-side body-fallback (notably callNaaviEdgeFunction) can use
 * `getCachedUserId()` to include user_id in the request body even when this
 * call times out. Without that, the anon-key fallback gets 401 from
 * naavi-chat (which requires JWT or body user_id per the V57.7 multi-user
 * safety fix) and the user sees a spinner that never resolves.
 *
 * Default 5s — a healthy refresh completes in < 1s. Anything past 5s is a
 * stall and we should not wait further.
 */
let lastKnownUserId: string | null = null;

// On module load, kick off an async read from AsyncStorage to seed the
// cache. The first chat send may race this — that's fine. If the read
// finishes first, callNaaviEdgeFunction will see the persisted user_id
// in the body and reach naavi-chat with a valid identity (200) instead
// of the anon path (401 → 60 s wait). Subsequent sends are fast either
// way because getSession populates the cache from memory once it
// resolves.
(async () => {
  try {
    const stored = await AsyncStorage.getItem(USER_ID_STORAGE_KEY);
    if (stored && !lastKnownUserId) {
      lastKnownUserId = stored;
      console.log('[invokeWithTimeout] seeded cached user_id from AsyncStorage');
    }
  } catch {
    // AsyncStorage is best-effort; failures don't break anything.
  }
})();

/** Read the last successfully-resolved user_id. V57.9.3 — backed by
 *  AsyncStorage so it survives force-stop. Returns null only on the
 *  very first launch before any session has ever resolved. */
export function getCachedUserId(): string | null {
  return lastKnownUserId;
}

async function persistUserId(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(USER_ID_STORAGE_KEY, userId);
  } catch {
    // Best-effort; in-memory cache still works for the rest of the session.
  }
}

export async function getSessionWithTimeout(timeoutMs: number = 5_000) {
  if (!supabase) return null;

  const sessionPromise = supabase.auth.getSession().then(r => {
    const session = r.data.session;
    if (session?.user?.id) {
      lastKnownUserId = session.user.id;
      // Fire-and-forget write — never blocks the caller.
      void persistUserId(session.user.id);
    }
    return session;
  });
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => {
      console.warn(`[getSessionWithTimeout] timed out after ${timeoutMs}ms — falling back to no session`);
      resolve(null);
    }, timeoutMs);
  });

  return Promise.race([sessionPromise, timeoutPromise]);
}
