/**
 * useGeofencePermissions
 *
 * Checks all 4 permissions required for geofencing on every app launch
 * and whenever the app returns to the foreground (user may have changed
 * a permission in Android Settings).
 *
 * Returns the list of missing permissions so the UI can show only what
 * Robert still needs to fix — nothing more.
 *
 * Permissions checked:
 *   1. Notifications (POST_NOTIFICATIONS)
 *   2. Location — Allow all the time (ACCESS_BACKGROUND_LOCATION)
 *   3. Physical Activity (ACTIVITY_RECOGNITION)
 *   4. Battery — Unrestricted (isIgnoringBatteryOptimizations)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Linking, PermissionsAndroid, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import BackgroundGeolocation from 'react-native-background-geolocation';
import { newDiagSession, remoteLog, endDiagSession } from '@/lib/remoteLog';

export type GeofencePermKey = 'notifications' | 'location' | 'activity' | 'battery';

export interface GeofencePermItem {
  key: GeofencePermKey;
  label: string;
  detail: string;
}

export const PERM_META: Record<GeofencePermKey, GeofencePermItem> = {
  notifications: {
    key: 'notifications',
    label: 'Notifications',
    detail: 'Deliver alerts when you arrive or leave a place',
  },
  location: {
    key: 'location',
    label: 'Location — Allow all the time',
    detail: 'Detect arrivals and departures even when Naavi is in the background',
  },
  activity: {
    key: 'activity',
    label: 'Physical Activity',
    detail: 'Wake up Naavi when you start moving — saves battery',
  },
  battery: {
    key: 'battery',
    label: 'Battery — Unrestricted',
    detail: 'Keep Naavi running in the background without being paused by Android',
  },
};

// Resolved at runtime so staging (ca.naavi.app.staging) and production
// (ca.naavi.app) both get the correct package for Settings intents.
function getPackageId(): string {
  return (Constants.expoConfig?.android?.package as string | undefined)
    ?? 'ca.naavi.app';
}

// Opens Android Settings reliably using IntentLauncher. Fallback to
// Linking.openSettings() if the intent throws (e.g. older Android).
async function openAppSettings(diag?: string): Promise<void> {
  if (diag) remoteLog(diag, 'openAppSettings-start');
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.APPLICATION_DETAILS_SETTINGS',
      { data: `package:${getPackageId()}` },
    );
    if (diag) remoteLog(diag, 'openAppSettings-intent-resolved');
  } catch (err) {
    if (diag) remoteLog(diag, 'openAppSettings-intent-threw', { error: String(err) });
    await Linking.openSettings();
    if (diag) remoteLog(diag, 'openAppSettings-linking-fallback-resolved');
  }
}

// B9p fix (2026-07-13) — the generic app-info page (openAppSettings above)
// doesn't show the notification toggle directly; the user has to know to
// tap "Notifications" from there themselves. Once Android has already used
// up its one-time permission-dialog budget (see maybeAutoRegisterPush in
// app/_layout.tsx), this Settings fallback is the ONLY path left for the
// user, so it should land them exactly on the toggle they need. Falls back
// to the generic app-info page on Android versions that don't support this
// intent (added API 26 / Android 8.0).
//
// B9v diagnostic (2026-07-14) — Wael reported the Fix button producing NO
// visible reaction at all (3rd report of this symptom). Everything reads
// correctly against Android's documented API, so instead of guessing again,
// instrument every step to see exactly where it actually stops on his device.
async function openNotificationSettings(diag?: string): Promise<void> {
  if (diag) remoteLog(diag, 'openNotificationSettings-start', { packageId: getPackageId() });
  try {
    const result = await IntentLauncher.startActivityAsync(
      'android.settings.APP_NOTIFICATION_SETTINGS',
      { extra: { 'android.provider.extra.APP_PACKAGE': getPackageId() } },
    );
    if (diag) remoteLog(diag, 'openNotificationSettings-intent-resolved', { resultCode: result?.resultCode });
  } catch (err) {
    if (diag) remoteLog(diag, 'openNotificationSettings-intent-threw', { error: String(err) });
    await openAppSettings(diag);
  }
}

async function checkMissing(): Promise<GeofencePermKey[]> {
  if (Platform.OS !== 'android') return [];
  const missing: GeofencePermKey[] = [];

  // 1. Notifications
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') missing.push('notifications');
  } catch { missing.push('notifications'); }

  // 2. Location — background ("Allow all the time")
  try {
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status !== 'granted') missing.push('location');
  } catch { missing.push('location'); }

  // 3. Physical Activity (runtime permission on Android 10+)
  try {
    const granted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
    );
    if (!granted) missing.push('activity');
  } catch { missing.push('activity'); }

  // 4. Battery — Unrestricted
  try {
    const ignoring = await BackgroundGeolocation.deviceSettings.isIgnoringBatteryOptimizations();
    if (!ignoring) missing.push('battery');
  } catch { /* if check fails, don't block — SDK may not be ready yet */ }

  return missing;
}

async function fixPermission(key: GeofencePermKey): Promise<void> {
  // B9v diagnostic (2026-07-14) — see openNotificationSettings' comment.
  // Only instrumenting the 'notifications' case; the other three aren't
  // reported as broken.
  const diag = key === 'notifications' ? newDiagSession() : undefined;
  if (diag) remoteLog(diag, 'fixPermission-notifications-entry');
  try {
    switch (key) {
      case 'notifications': {
        if (diag) remoteLog(diag, 'requestPermissionsAsync-start');
        const { status } = await Notifications.requestPermissionsAsync();
        if (diag) remoteLog(diag, 'requestPermissionsAsync-resolved', { status });
        // B9p fix (2026-07-13) — was openAppSettings() (generic app-info
        // page). Once app/_layout.tsx's auto-register has already used up
        // Android's one-time permission dialog, requestPermissionsAsync
        // here silently returns the prior status with no dialog shown, so
        // this fallback is the only thing the user actually sees — send
        // them straight to the notification toggle, not the app-info page.
        if (status !== 'granted') {
          await openNotificationSettings(diag);
        } else if (diag) {
          remoteLog(diag, 'already-granted-no-action-taken');
        }
        if (diag) { remoteLog(diag, 'fixPermission-notifications-done'); endDiagSession(diag); }
        break;
      }
      case 'location': {
        // Must request foreground first, then background
        const { status: fg } = await Location.requestForegroundPermissionsAsync();
        if (fg !== 'granted') { await openAppSettings(); break; }
        const { status: bg } = await Location.requestBackgroundPermissionsAsync();
        if (bg !== 'granted') await openAppSettings();
        break;
      }
      case 'activity': {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
          {
            title: 'Physical Activity',
            message:
              'Naavi uses motion detection to wake up when you start moving, ' +
              'so location alerts fire at the right moment without draining your battery.',
            buttonPositive: 'Allow',
            buttonNegative: 'Not now',
          },
        );
        if (result !== PermissionsAndroid.RESULTS.GRANTED) await openAppSettings();
        break;
      }
      case 'battery': {
        try {
          await IntentLauncher.startActivityAsync(
            'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
            { data: `package:${getPackageId()}` },
          );
        } catch {
          // Fallback: open app details where user can find battery settings
          await openAppSettings();
        }
        break;
      }
    }
  } catch (err) {
    console.error('[useGeofencePermissions] fixPermission error:', key, err);
    if (diag) { remoteLog(diag, 'fixPermission-outer-catch', { error: String(err) }); endDiagSession(diag); }
    // Last-resort fallback — always opens something rather than silently failing
    try { await openAppSettings(diag); } catch { /* ignore */ }
  }
}

export function useGeofencePermissions() {
  const [missing, setMissing] = useState<GeofencePermKey[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const appState = useRef(AppState.currentState);

  const recheck = useCallback(async () => {
    const result = await checkMissing();
    setMissing(result);
    // If all fixed, auto-clear dismissed flag so card hides
    if (result.length === 0) setDismissed(false);
  }, []);

  // Check on mount
  useEffect(() => {
    recheck();
  }, [recheck]);

  // Re-check whenever app comes back to foreground (user may have changed settings)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        recheck();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [recheck]);

  const fix = useCallback(async (key: GeofencePermKey) => {
    await fixPermission(key);
    // Re-check after fix attempt (AppState listener also catches this on return)
    await recheck();
  }, [recheck]);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  const visible = missing.length > 0 && !dismissed;

  return { missing, visible, fix, dismiss, recheck };
}
