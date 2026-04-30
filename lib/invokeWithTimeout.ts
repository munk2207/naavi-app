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

import { supabase } from './supabase';

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
 * Default 5s — a healthy refresh completes in < 1s. Anything past 5s is a
 * stall and we should not wait further.
 */
export async function getSessionWithTimeout(timeoutMs: number = 5_000) {
  if (!supabase) return null;

  const sessionPromise = supabase.auth.getSession().then(r => r.data.session);
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => {
      console.warn(`[getSessionWithTimeout] timed out after ${timeoutMs}ms — falling back to no session`);
      resolve(null);
    }, timeoutMs);
  });

  return Promise.race([sessionPromise, timeoutPromise]);
}
