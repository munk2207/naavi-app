/**
 * delete-contact Edge Function
 *
 * Deletes a contact from the user's Google Contacts via People API.
 * Mirrors create-contact's auth pattern (JWT or body.user_id).
 *
 * Auth: RLS-based. verify_jwt = false in config.toml.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getNewAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  const body = await req.json();
  const { resourceName, user_id: bodyUserId } = body;

  if (!resourceName?.trim()) {
    return new Response(JSON.stringify({ error: 'Missing resourceName' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let userId: string | null = null;
  if (authHeader) {
    try {
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user } } = await userClient.auth.getUser();
      if (user) userId = user.id;
    } catch (_) { /* fall through */ }
  }
  if (!userId && typeof bodyUserId === 'string' && bodyUserId.length > 0) {
    userId = bodyUserId;
  }
  if (!userId) {
    return new Response(JSON.stringify({ error: 'No user found — provide JWT or user_id in body' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: tokenRow, error: tokenError } = await adminClient
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .single();

  if (tokenError || !tokenRow?.refresh_token) {
    return new Response(JSON.stringify({ error: 'No Google token found' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const accessToken = await getNewAccessToken(tokenRow.refresh_token);
    const res = await fetch(
      `https://people.googleapis.com/v1/${resourceName}:deleteContact`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `People API failed: ${err}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ success: true, resourceName }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
