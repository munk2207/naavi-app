/**
 * Location helpers — permissions, current position, and device timezone sync.
 *
 * The timezone sync writes the device's IANA timezone to user_settings.timezone
 * on every signin + foreground event. Ensures the global-first rule holds: no
 * user ever has a stale Toronto default. Future GPS-derived timezone (from the
 * full location trigger) will also write here — single source of truth for all
 * "when" gating (weather rules, future morning-call scheduling, etc.).
 */

import * as Location from 'expo-location';
import { supabase } from './supabase';
import { queryWithTimeout } from './invokeWithTimeout';
import { showLocationDisclosure } from './locationDisclosure';

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

/** Foreground-only permission status. */
export async function getForegroundPermission(): Promise<PermissionStatus> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status as PermissionStatus;
}

/** Background "Always allow" permission status. */
export async function getBackgroundPermission(): Promise<PermissionStatus> {
  const { status } = await Location.getBackgroundPermissionsAsync();
  return status as PermissionStatus;
}

/**
 * Request foreground first, then background. Android requires this order —
 * you can't ask for background without first getting foreground.
 * Returns the final background status.
 */
export async function requestLocationPermissions(): Promise<{
  foreground: PermissionStatus;
  background: PermissionStatus;
}> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
    return { foreground: fgStatus as PermissionStatus, background: 'denied' };
  }
  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  return {
    foreground: fgStatus as PermissionStatus,
    background: bgStatus as PermissionStatus,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/**
 * The one entry point every location-permission request should go through.
 * Shows the in-app prominent-disclosure modal (Google Play policy — must
 * appear in the normal flow of the feature, right before the OS dialog)
 * ONLY when background permission isn't already granted; skips it entirely
 * on repeat requests since there's nothing new to disclose or request.
 *
 * 2026-08-13 — replaces direct requestForegroundPermissionsAsync/
 * requestBackgroundPermissionsAsync calls that were scattered across
 * useOrchestrator.ts, useGeofencePermissions.ts, and app/alerts.tsx with no
 * disclosure step before them — the Play Console rejection this fixes
 * ("Prominent Disclosure and Consent Requirement: Missing Prominent
 * Disclosure") was because none of those real request moments showed one;
 * app/permission-location.tsx had the right copy but was only reachable via
 * Settings, so it never actually intercepted them.
 */
export async function ensureBackgroundLocationPermission(opts?: {
  timeoutMs?: number;
}): Promise<{ foreground: PermissionStatus; background: PermissionStatus; declined?: boolean }> {
  const bgInitial = await getBackgroundPermission();
  if (bgInitial === 'granted') {
    return { foreground: 'granted', background: 'granted' };
  }

  const agreed = await showLocationDisclosure();
  if (!agreed) {
    return { foreground: 'undetermined', background: 'undetermined', declined: true };
  }

  const timeoutMs = opts?.timeoutMs;
  let fgStatus: PermissionStatus = 'undetermined';
  try {
    const fgReq = timeoutMs
      ? await withTimeout(Location.requestForegroundPermissionsAsync(), timeoutMs, 'fg-permission-timeout')
      : await Location.requestForegroundPermissionsAsync();
    fgStatus = fgReq.status as PermissionStatus;
  } catch {
    fgStatus = await getForegroundPermission();
  }
  if (fgStatus !== 'granted') {
    return { foreground: fgStatus, background: 'denied' };
  }

  let bgStatus: PermissionStatus = 'undetermined';
  try {
    const bgReq = timeoutMs
      ? await withTimeout(Location.requestBackgroundPermissionsAsync(), timeoutMs, 'bg-permission-timeout')
      : await Location.requestBackgroundPermissionsAsync();
    bgStatus = bgReq.status as PermissionStatus;
  } catch {
    bgStatus = await getBackgroundPermission();
  }
  // Re-check final state — Android 11+ opens Settings for background instead
  // of a dialog, and the request promise can resolve before the user
  // finishes choosing there.
  const bgFinal = await getBackgroundPermission().catch(() => bgStatus);
  return { foreground: fgStatus, background: bgFinal };
}

/** Read current GPS coordinates (foreground). Returns null on any failure. */
export async function getCurrentCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const fg = await getForegroundPermission();
    if (fg !== 'granted') return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch (err) {
    console.error('[location] getCurrentCoords failed:', err);
    return null;
  }
}

/**
 * Detect the device's IANA timezone (e.g., "America/Toronto", "Europe/London").
 * Always returns a valid string — falls back to "America/Toronto" only if the
 * Intl API is somehow unavailable (shouldn't happen on Expo).
 */
export function detectDeviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || 'America/Toronto';
  } catch {
    return 'America/Toronto';
  }
}

/**
 * Write the device's current timezone to user_settings.timezone.
 * Fire-and-forget — a network failure should never block the signin flow.
 *
 * Idempotent: skips the write if the server value already matches.
 */
export async function syncDeviceTimezone(userId: string): Promise<void> {
  if (!userId || !supabase) return;
  const deviceTz = detectDeviceTimezone();

  try {
    // Read current server value
    const { data } = await queryWithTimeout(
      supabase
        .from('user_settings')
        .select('timezone')
        .eq('user_id', userId)
        .maybeSingle(),
      15_000,
      'select-user-timezone',
    );

    const serverTz = data?.timezone ?? null;
    if (serverTz === deviceTz) {
      return; // already in sync
    }

    await queryWithTimeout(
      supabase
        .from('user_settings')
        .upsert(
          { user_id: userId, timezone: deviceTz, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        ),
      15_000,
      'upsert-user-timezone',
    );

    console.log(`[location] synced device timezone: ${deviceTz} (was ${serverTz ?? 'null'})`);
  } catch (err) {
    console.error('[location] syncDeviceTimezone failed:', err);
  }
}
