/**
 * whoami-google-diag — TEMPORARY, read-only diagnostic. Not part of any
 * product surface. Exchanges the stored Google refresh token for a user and
 * asks Google's userinfo endpoint which account it actually is, to answer
 * "which Google account is connected to this Naavi user" definitively
 * instead of guessing from auth.users' sign-in email (which can differ).
 * Delete after use.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const { user_id } = await req.json();
  if (!user_id) {
    return new Response(JSON.stringify({ error: 'user_id required' }), { status: 400 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: tokenRow, error: tokenError } = await admin
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id', user_id)
    .eq('provider', 'google')
    .single();

  if (tokenError || !tokenRow?.refresh_token) {
    return new Response(JSON.stringify({ error: 'no token', detail: tokenError?.message }), { status: 400 });
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: tokenRow.refresh_token,
      grant_type:    'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return new Response(JSON.stringify({ error: 'token refresh failed', detail: tokenData }), { status: 400 });
  }

  const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const info = await infoRes.json();

  // Also check what scopes this token actually has, in case contacts scope
  // was never granted (a different explanation than "wrong account").
  const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${tokenData.access_token}`);
  const tokenInfo = await tokenInfoRes.json();

  return new Response(JSON.stringify({
    connected_google_email: info.email ?? null,
    email_verified: info.verified_email ?? null,
    scopes: tokenInfo.scope ?? null,
  }), { headers: { 'Content-Type': 'application/json' } });
});
