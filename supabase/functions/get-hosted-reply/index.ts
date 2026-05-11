/**
 * get-hosted-reply Edge Function — F1d step 2 read path.
 *
 * The `mynaavi.com/r/<token>` web page calls this to fetch the saved
 * response content for a given token. The token IS the auth — no JWT
 * required. Anyone with the link can read; expired rows return a
 * friendly "this reply has expired" payload instead of the content.
 *
 * Wael 2026-05-11. Spec: docs/F1D_USER_CONTROLLED_MUTE_SPEC.md.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

interface HostedReplyRow {
  token: string;
  question: string;
  content: string;
  created_at: string;
  expires_at: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Accept token from either ?token= query string (GET) or body (POST).
  let token: string | null = null;
  const url = new URL(req.url);
  token = url.searchParams.get('token');
  if (!token && req.method === 'POST') {
    try {
      const body = await req.json();
      if (typeof body?.token === 'string') token = body.token;
    } catch { /* ignore */ }
  }

  if (!token || token.length < 16 || token.length > 64) {
    return json({ error: 'invalid token' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data, error } = await supabase
    .from('hosted_replies')
    .select('token, question, content, created_at, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    console.error('[get-hosted-reply] DB error:', error.message);
    return json({ error: 'lookup failed' }, 500);
  }

  if (!data) {
    return json({ found: false, expired: false });
  }

  const row = data as HostedReplyRow;
  const now = Date.now();
  const expiresAt = Date.parse(row.expires_at);
  if (Number.isFinite(expiresAt) && expiresAt <= now) {
    return json({ found: true, expired: true });
  }

  return json({
    found: true,
    expired: false,
    question: row.question,
    content:  row.content,
    created_at: row.created_at,
    expires_at: row.expires_at,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
