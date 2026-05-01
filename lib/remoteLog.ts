/**
 * remoteLog — fire-and-forget diagnostic logging to the `remote-log`
 * Edge Function. Used to instrument the chat send pipeline for the V57.9.x
 * 90-second hang investigation when adb logcat is unavailable.
 *
 * Design contract — DO NOT VIOLATE:
 *   1. NEVER block the caller. The whole point is diagnosing a hang;
 *      this helper must not introduce a new one.
 *   2. NEVER throw. All errors swallowed silently. The caller does not
 *      await the POST and does not handle errors.
 *   3. NEVER take more than 3 seconds. AbortController hard-caps the
 *      fetch even if the diagnostic endpoint itself is slow.
 *   4. Stay cheap. Each row is < 1 KB. The function is no-auth so we
 *      can log even when the JWT refresh is stuck.
 *
 * Usage:
 *   const session = newDiagSession();
 *   remoteLog(session, 'send-tap');
 *   ...
 *   remoteLog(session, 'fetch-start');
 *   const res = await fetch(...);
 *   remoteLog(session, 'fetch-end', { status: res.status });
 */

import Constants from 'expo-constants';
import { getCachedUserId } from './invokeWithTimeout';

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL      ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// Tracks the wall-clock millis when each session_id was first logged, so
// every later call for the same session reports ms_since_start automatically.
const sessionStartMs = new Map<string, number>();

const APP_VERSION   = Constants.expoConfig?.version             ?? '?';
const BUILD_CODE    = Constants.expoConfig?.android?.versionCode ?? '?';
const BUILD_VERSION = `v${APP_VERSION}-${BUILD_CODE}`;

/** Generate a short opaque id for one chat-send attempt. Not a UUID — diagnostic use only. */
export function newDiagSession(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Fire-and-forget. The returned promise resolves to void; callers should NOT await. */
export function remoteLog(
  sessionId: string,
  step: string,
  payload?: Record<string, unknown>,
): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  if (!sessionId || !step) return;

  // Compute ms_since_start in the *calling* tick so the timing reflects when
  // the event happened, not when the network stack got around to sending it.
  const now = Date.now();
  let startMs = sessionStartMs.get(sessionId);
  if (startMs === undefined) {
    startMs = now;
    sessionStartMs.set(sessionId, now);
  }
  const msSinceStart = now - startMs;

  const userId = getCachedUserId();

  // Fire without await. If anything throws synchronously we swallow it.
  // The .catch() on the promise covers async rejections (network errors,
  // AbortError, etc.) so an unhandled-rejection warning never bubbles up.
  //
  // V57.9.6 — CRITICAL: must consume the response body so the underlying
  // HTTP connection is released back to OkHttp's idle pool. RN's fetch
  // does NOT auto-release; the Response keeps the socket open until GC
  // eventually finalizes it. Each remoteLog call without body-consumption
  // leaked a connection — after ~30 calls the OkHttp pool (5 idle slots
  // by default) was full of stuck connections and the next chat-send
  // fetch could not get a slot. That's the "third call hangs" bug Wael
  // reported. We use res.body?.cancel() — a discard primitive that
  // releases the connection without paying for body-bytes-download.
  void (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3_000);
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/remote-log`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'apikey': SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            session_id: sessionId,
            step,
            user_id: userId,
            ms_since_start: msSinceStart,
            payload: payload ?? null,
            build_version: BUILD_VERSION,
          }),
          signal: controller.signal,
        });
        // Release the underlying socket back to the pool. Try cancel()
        // first (cheapest — discards the body without downloading it);
        // if not supported on this RN runtime, fall back to draining
        // the body via text(). Either way the connection is freed.
        try {
          if (res.body && typeof (res.body as any).cancel === 'function') {
            await (res.body as any).cancel();
          } else {
            await res.text();
          }
        } catch {
          // Body consumption itself failed — that's still OK; the
          // important guarantee is we attempted release. The Response
          // will GC eventually.
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // intentional: never let diagnostic logging affect the app
    }
  })();
}

/** Free the in-memory start timestamp for a session once it ends.
 *  Optional — leaving entries in the Map is harmless (a few bytes each). */
export function endDiagSession(sessionId: string): void {
  sessionStartMs.delete(sessionId);
}
