/**
 * Imperative controller for the location prominent-disclosure modal.
 *
 * Google Play policy requires apps requesting background location to show
 * an in-app disclosure — in the normal flow of using the feature, not
 * behind a Settings menu — immediately before the OS permission dialog.
 * app/permission-location.tsx already had this copy, but was only reachable
 * via Settings, so it never actually intercepted any of the real
 * permission-request moments (chat-driven "alert me when I arrive at X",
 * the geofence "Fix" banner, the Alerts screen banner). This lets those
 * call sites show the same disclosure in place, without navigating away.
 *
 * ensureBackgroundLocationPermission() in lib/location.ts is the actual
 * entry point callers should use — this file is just the modal plumbing.
 */

type Listener = (visible: boolean) => void;

let listener: Listener | null = null;
let pendingResolve: ((agreed: boolean) => void) | null = null;

export function registerLocationDisclosureListener(l: Listener): void {
  listener = l;
}

export function unregisterLocationDisclosureListener(): void {
  listener = null;
}

/** Shows the modal and resolves once the user taps Agree or Not Now. */
export function showLocationDisclosure(): Promise<boolean> {
  return new Promise((resolve) => {
    pendingResolve = resolve;
    listener?.(true);
  });
}

export function resolveLocationDisclosure(agreed: boolean): void {
  listener?.(false);
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(agreed);
}
