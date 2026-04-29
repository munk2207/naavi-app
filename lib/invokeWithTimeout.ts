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
