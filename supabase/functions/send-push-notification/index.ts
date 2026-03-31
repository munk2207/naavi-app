/**
 * send-push-notification Edge Function
 *
 * Sends a Web Push notification to all subscriptions for the authenticated user.
 * Uses the web-push library for proper VAPID + AES-GCM payload encryption.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webPush from 'https://esm.sh/web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders,
    });
  }

  const { title, body, url } = await req.json();
  if (!title || !body) {
    return new Response(JSON.stringify({ error: 'Missing title or body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Configure VAPID details
  webPush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );

  const { data: subs, error } = await userClient
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', user.id);

  if (error || !subs?.length) {
    return new Response(JSON.stringify({ sent: 0, message: 'No subscriptions found' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const payload = JSON.stringify({ title, body, url: url ?? '/' });
  let sent = 0;

  for (const sub of subs) {
    try {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
      console.log(`[send-push] Sent to ${sub.endpoint.slice(0, 50)}...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[send-push] Failed for ${sub.endpoint.slice(0, 50)}: ${msg}`);
      // Remove expired/invalid subscriptions (410 Gone)
      if (msg.includes('410') || msg.includes('404')) {
        await userClient.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        console.log(`[send-push] Removed stale subscription`);
      }
    }
  }

  console.log(`[send-push-notification] Sent ${sent}/${subs.length} for user ${user.id}`);
  return new Response(JSON.stringify({ success: true, sent }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
