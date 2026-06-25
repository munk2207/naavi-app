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
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import BackgroundGeolocation from 'react-native-background-geolocation';

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

const ANDROID_PACKAGE = 'ca.naavi.app';

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
  switch (key) {
    case 'notifications': {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') await Linking.openSettings();
      break;
    }
    case 'location': {
      // Must request foreground first, then background
      const { status: fg } = await Location.requestForegroundPermissionsAsync();
      if (fg !== 'granted') { await Linking.openSettings(); break; }
      const { status: bg } = await Location.requestBackgroundPermissionsAsync();
      if (bg !== 'granted') await Linking.openSettings();
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
      if (result !== PermissionsAndroid.RESULTS.GRANTED) await Linking.openSettings();
      break;
    }
    case 'battery': {
      // Open Android's specific battery optimization dialog for this app
      await IntentLauncher.startActivityAsync(
        'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
        { data: `package:${ANDROID_PACKAGE}` },
      );
      break;
    }
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
