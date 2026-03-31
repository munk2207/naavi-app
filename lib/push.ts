/**
 * Web Push client helpers
 *
 * - registerServiceWorker: registers sw.js and subscribes to push
 * - sendPushNotification: calls the Edge Function to push to all user devices
 */

import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = 'BLFs0BQ3pY83UL4XsckjlG3CUDJEVuN8c2H1g5hRIf-lp_5rpn2Cj0LfOCTCWHrCdZrueFldikCuFUZm862niW0';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

export async function registerPushNotifications(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('[Push] Not supported in this environment');
    return false;
  }

  try {
    // Register service worker
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('[Push] Permission denied');
      return false;
    }

    // Subscribe to push
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    // Save subscription to Supabase
    if (!supabase) return false;
    const { error } = await supabase.functions.invoke('save-push-subscription', {
      body: { subscription: subscription.toJSON() },
    });

    if (error) {
      console.error('[Push] Failed to save subscription:', error.message);
      return false;
    }

    console.log('[Push] Registered and subscription saved');
    return true;
  } catch (err) {
    console.error('[Push] Registration failed:', err);
    return false;
  }
}

export async function sendPushNotification(title: string, body: string, url = '/'): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.functions.invoke('send-push-notification', {
      body: { title, body, url },
    });
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
