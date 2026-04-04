/**
 * save-push-subscription Edge Function
 *
 * Stores a push subscription for the authenticated user.
 * Handles two platforms:
 *  - 'web':     browser Web Push subscription (endpoint + keys)
 *  - 'android': FCM device token from expo-notifications
 *
 * Auth: RLS-based. verify_jwt = false in config.toml.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
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

  const body = await req.json();
  const { platform = 'web', subscription, fcm_token } = body;

  if (platform === 'android') {
    // Save FCM device token
    if (!fcm_token) {
      return new Response(JSON.stringify({ error: 'Missing fcm_token' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error } = await userClient
      .from('push_subscriptions')
      .upsert({
        user_id:   user.id,
        platform:  'android',
        fcm_token,
        endpoint:  fcm_token, // reuse endpoint as unique key for upsert
        p256dh:    '',
        auth:      '',
      }, { onConflict: 'endpoint' });

    if (error) {
      console.error('[save-push] FCM insert error:', error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[save-push] FCM token saved for user ${user.id}`);
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Web push subscription
  if (!subscription?.endpoint) {
    return new Response(JSON.stringify({ error: 'Missing subscription' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { error } = await userClient
    .from('push_subscriptions')
    .upsert({
      user_id:  user.id,
      platform: 'web',
      endpoint: subscription.endpoint,
      p256dh:   subscription.keys?.p256dh ?? '',
      auth:     subscription.keys?.auth   ?? '',
    }, { onConflict: 'endpoint' });

  if (error) {
    console.error('[save-push] Web push insert error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[save-push] Web subscription saved for user ${user.id}`);
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
