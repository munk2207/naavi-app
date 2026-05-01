/**
 * appLifecycle — tiny module that exposes the most-recent timestamp
 * the app was foregrounded.
 *
 * Why this exists (V57.9.8):
 *   When MyNaavi returns from a system Settings round-trip (e.g. the
 *   user grants background-location permission), Android often kills
 *   our process for memory pressure. On return, the Supabase JS SDK
 *   re-initialises and may briefly emit `SIGNED_OUT` while the
 *   AsyncStorage / SecureStore session is still loading. The app's
 *   `onAuthStateChange` handlers historically treated that as a real
 *   sign-out and cleared local state — which then caused chat sends
 *   to fall back to the anon-key path and get 401-rejected by
 *   naavi-chat. From the user's perspective, services "disconnect"
 *   after granting Location permission.
 *
 *   This module gives the auth handlers a way to detect that we just
 *   came back from background. They can then ignore (and re-verify)
 *   any `SIGNED_OUT` event that fires within a short grace window.
 *
 *   Module-level state. AppState listener attached on first import.
 */

import { AppState } from 'react-native';
import { remoteLog, newDiagSession } from './remoteLog';

let lastForegroundedAt = Date.now();

// V57.9.8 diagnostic — one persistent session id for the lifetime of the
// app process. Every lifecycle/auth event we log carries this id, so we
// can read the full timeline back from client_diagnostics and reconstruct
// what happened across foreground/background transitions.
const LIFECYCLE_SESSION = newDiagSession();
remoteLog(LIFECYCLE_SESSION, 'lifecycle-boot');

AppState.addEventListener('change', (state) => {
  remoteLog(LIFECYCLE_SESSION, 'lifecycle-appstate', { state });
  if (state === 'active') {
    lastForegroundedAt = Date.now();
  }
});

/** Used by callers (auth handlers, etc.) that want their own log
 *  entries to attach to the same lifecycle session. */
export function getLifecycleSession(): string {
  return LIFECYCLE_SESSION;
}

/** Milliseconds since the last AppState→active event. Returns 0 on first
 *  call before any foreground transition has been observed (the import
 *  initialises lastForegroundedAt to "now"). */
export function msSinceForeground(): number {
  return Date.now() - lastForegroundedAt;
}

/** True if AppState went 'active' within the last `windowMs` (default 5 s). */
export function justForegrounded(windowMs: number = 5_000): boolean {
  return msSinceForeground() < windowMs;
}
