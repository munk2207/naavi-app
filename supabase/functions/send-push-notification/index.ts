/**
 * send-push-notification Edge Function
 *
 * Sends notifications to all of a user's registered devices.
 * Supports two platforms in one pass:
 *  - Web:     Web Push via VAPID (existing browser subscriptions)
 *  - Android: Firebase Cloud Messaging (FCM) V1 API
 *
 * Required Supabase secrets:
 *  VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  (web push)
 *  FIREBASE_SERVICE_ACCOUNT_JSON                        (FCM V1)
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webPush from 'https://esm.sh/web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// FCM V1 — get a short-lived access token from the Firebase service account
// ---------------------------------------------------------------------------
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes  = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

function b64url(input: string | ArrayBuffer): string {
  const str =
    typeof input === 'string'
      ? input
      : String.fromCharCode(...new Uint8Array(input));
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getFCMAccessToken(serviceAccountJson: string): Promise<string> {
  const sa  = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${b64url(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`FCM token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function sendFCM(
  fcmToken: string,
  title: string,
  body: string,
  url: string,
  projectId: string,
  accessToken: string
): Promise<void> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          notification: { title, body },
          android: {
            priority: 'high',
            notification: { channel_id: 'mynaavi', sound: 'default' },
          },
          data: { url },
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FCM send failed (${res.status}): ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders,
    });
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Parse body first — may contain user_id for server-side callers
  const { title, body, url = '/', user_id: bodyUserId } = await req.json();
  if (!title || !body) {
    return new Response(JSON.stringify({ error: 'Missing title or body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Standard 3-step user_id resolution (see CLAUDE.md rule 4):
  // (a) JWT auth (mobile app), (b) body.user_id (voice server), (c) user_tokens fallback
  let userId: string | null = null;
  try {
    const { data: { user } } = await userClient.auth.getUser();
    if (user) userId = user.id;
  } catch (_) { /* ignore */ }

  if (!userId && bodyUserId) userId = bodyUserId;

  if (!userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders,
    });
  }

  // Use adminClient to read subs (service role key bypasses RLS — fine, we just checked auth)
  const { data: subs } = await adminClient
    .from('push_subscriptions')
    .select('platform, endpoint, p256dh, auth, fcm_token')
    .eq('user_id', userId);

  if (!subs?.length) {
    return new Response(JSON.stringify({ sent: 0, message: 'No subscriptions found' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Set up web push VAPID
  webPush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );

  // Get FCM access token once for all Android subs in this batch
  const androidSubs = subs.filter((s) => s.platform === 'android' && s.fcm_token);
  let fcmAccessToken: string | null = null;
  let fcmProjectId: string | null   = null;

  if (androidSubs.length > 0) {
    const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (serviceAccountJson) {
      try {
        fcmAccessToken = await getFCMAccessToken(serviceAccountJson);
        fcmProjectId   = JSON.parse(serviceAccountJson).project_id;
      } catch (err) {
        console.error('[send-push] FCM auth failed:', err);
      }
    }
  }

  let sent = 0;

  for (const sub of subs) {
    try {
      if (sub.platform === 'android' && sub.fcm_token && fcmAccessToken && fcmProjectId) {
        await sendFCM(sub.fcm_token, title, body, url, fcmProjectId, fcmAccessToken);
        sent++;
        console.log(`[send-push] FCM sent to ${sub.fcm_token.slice(0, 20)}...`);
      } else if (sub.platform === 'web' && sub.endpoint) {
        const payload = JSON.stringify({ title, body, url });
        await webPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sent++;
        console.log(`[send-push] Web push sent to ${sub.endpoint.slice(0, 40)}...`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[send-push] Failed for ${sub.platform}:`, msg);
      // Remove expired/invalid web subscriptions
      if (sub.platform === 'web' && (msg.includes('410') || msg.includes('404'))) {
        await userClient.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        console.log('[send-push] Removed stale web subscription');
      }
    }
  }

  console.log(`[send-push] Sent ${sent}/${subs.length} for user ${userId}`);
  return new Response(JSON.stringify({ success: true, sent }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
