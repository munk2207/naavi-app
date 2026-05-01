/**
 * batteryExemptionPrompt — one-time Android prompt to disable battery
 * optimization for MyNaavi.
 *
 * Why: Android Doze mode defers geofence callbacks 15-30+ minutes when
 * the phone is idle, even when "Allow all the time" location permission
 * is granted. Wael 2026-05-01: arrived home 7:45 PM, geofence alert
 * arrived 8:13 PM — 28 minutes late. Standard Android behaviour for any
 * location-based app.
 *
 * The fix the OS gives us: ask the user to add MyNaavi to the battery-
 * optimization-ignore list. From that point on, Android lets the app
 * wake on geofence transitions in real time.
 *
 * UX policy: ask ONCE, after the user creates a location alert. The
 * value of the prompt is obvious in that moment — "you just asked me
 * to alert you when you arrive somewhere, here's the one switch that
 * makes it actually work on time."
 *
 * Persistence: stored in AsyncStorage. If user dismisses, we don't
 * re-prompt. If they later wonder why arrival alerts are late, a
 * Settings page entry can re-trigger the flow.
 *
 * iOS: this entire flow is a no-op. iOS handles geofencing at the OS
 * level without an app-specific battery-optimization opt-out.
 */

import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PROMPTED_FLAG_KEY = 'naavi_battery_exemption_prompted';

export async function maybePromptBatteryExemption(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    const prompted = await AsyncStorage.getItem(PROMPTED_FLAG_KEY);
    if (prompted === 'true') return;
  } catch {
    // AsyncStorage unavailable — show the prompt anyway, worst case
    // user sees it twice.
  }

  Alert.alert(
    'One-time setting for arrival alerts',
    "Android delays alerts when the phone is idle to save battery — sometimes by 30 minutes or more. To make sure your arrival alerts fire on time, please tap 'Open Settings' below, find MyNaavi in the Battery list, and choose 'Don't optimize'.\n\nOnly takes 30 seconds. You only need to do this once.",
    [
      {
        text: 'Skip',
        style: 'cancel',
        onPress: () => { void markPrompted(); },
      },
      {
        text: 'Open Settings',
        onPress: () => {
          Linking.openSettings().catch(err =>
            console.error('[batteryExemptionPrompt] openSettings failed:', err)
          );
          void markPrompted();
        },
      },
    ],
    { cancelable: false },
  );
}

async function markPrompted(): Promise<void> {
  try {
    await AsyncStorage.setItem(PROMPTED_FLAG_KEY, 'true');
  } catch {
    // best-effort; if it fails the user might see the prompt again next time
  }
}

/** Allow the user to manually re-trigger the prompt from a Settings entry
 *  if they later realize their alerts are late. */
export async function resetBatteryExemptionPrompt(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PROMPTED_FLAG_KEY);
  } catch { /* ignore */ }
}
