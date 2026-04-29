/**
 * Push notification helpers — web and Android native
 *
 * Web (browser):  uses Web Push API + VAPID + service worker
 * Android native: uses expo-notifications + Firebase Cloud Messaging (FCM)
 *
 * Call registerPushNotifications() once when the user grants permission.
 * The function automatically picks the right path based on the platform.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';
import { invokeWithTimeout } from './invokeWithTimeout';

const VAPID_PUBLIC_KEY = 'BLFs0BQ3pY83UL4XsckjlG3CUDJEVuN8c2H1g5hRIf-lp_5rpn2Cj0LfOCTCWHrCdZrueFldikCuFUZm862niW0';

// ---------------------------------------------------------------------------
// Foreground notification behaviour (Android/iOS)
// Show the alert even when the app is open
// ---------------------------------------------------------------------------
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ---------------------------------------------------------------------------
// Web push helpers (browser only)
// ---------------------------------------------------------------------------
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function registerWebPush(): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    console.log('[Push] Web Push not supported');
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    if (!supabase) return false;
    const { error } = await invokeWithTimeout('save-push-subscription', {
      body: { platform: 'web', subscription: subscription.toJSON() },
    }, 10_000);

    if (error) {
      console.error('[Push] Failed to save web subscription:', error.message);
      return false;
    }

    console.log('[Push] Web push registered');
    return true;
  } catch (err) {
    console.error('[Push] Web registration failed:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Native push helpers (Android)
// ---------------------------------------------------------------------------
async function registerNativePush(): Promise<boolean> {
  try {
    // Request permission (Android 13+ requires explicit runtime permission)
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Push] Native permission denied');
      return false;
    }

    // Set up the Android notification channel (required for Android 8+)
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('mynaavi', {
        name: 'MyNaavi',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        sound: 'default',
        showBadge: false,
      });
    }

    // Get the raw FCM device token (reads from google-services.json in the build)
    const tokenData = await Notifications.getDevicePushTokenAsync();
    const fcmToken  = tokenData.data as string;

    if (!supabase) return false;
    const { error } = await invokeWithTimeout('save-push-subscription', {
      body: { platform: 'android', fcm_token: fcmToken },
    }, 10_000);

    if (error) {
      console.error('[Push] Failed to save FCM token:', error.message);
      return false;
    }

    console.log('[Push] Android FCM token registered');
    return true;
  } catch (err) {
    console.error('[Push] Native registration failed:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register for push notifications.
 * Automatically uses Web Push on browser and FCM on Android.
 */
export async function registerPushNotifications(): Promise<boolean> {
  if (Platform.OS === 'web') return registerWebPush();
  return registerNativePush();
}

/**
 * Trigger a push notification to all of the user's registered devices.
 * Called from anywhere in the app (e.g. after setting a reminder).
 */
export async function sendPushNotification(
  title: string,
  body: string,
  url = '/'
): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await invokeWithTimeout('send-push-notification', {
      body: { title, body, url },
    }, 10_000);
    if (error) {
      console.error('[Push] Send failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Push] Send exception:', err);
    return false;
  }
}
