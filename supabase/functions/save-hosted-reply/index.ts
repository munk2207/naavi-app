/**
 * save-hosted-reply Edge Function — F1d step 2 write path.
 *
 * Voice-server calls this when the user confirms "yes" to the
 * SMS-the-rest offer. Stores the response content under a random token
 * (TTL: 30 days per migration default) and returns the token. The
 * voice-server then sends an SMS with `mynaavi.com/r/<token>` link +
 * an email with the full content.
 *
 * Wael 2026-05-11. Spec: docs/F1D_USER_CONTROLLED_MUTE_SPEC.md.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 24-char URL-safe token = ~143 bits of entropy. Unguessable in practice;
// well above the 16-char minimum enforced by the migration's CHECK.
const TOKEN_BYTES = 18; // 18 bytes → 24-char base64url string

function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'POST required' }, 405);
  }

  // Service-role only — this endpoint is internal (voice-server → Edge
  // Function). No anon-key writes; protect against external content
  // injection.
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRole || token !== serviceRole) {
    return json({ error: 'service-role required' }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const userId   = String(body?.user_id ?? '').trim();
  const question = String(body?.question ?? '').trim();
  const content  = String(body?.content ?? '').trim();

  if (!userId)   return json({ error: 'user_id required' }, 400);
  if (!content)  return json({ error: 'content required' }, 400);
  // question is optional but recommended; default to empty string.

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceRole,
  );

  // Retry on the (vanishingly unlikely) PK collision. 24 char base64url is
  // ~143 bits; collision probability per insert is effectively zero at
  // any realistic table size, but a 3-attempt retry keeps the path
  // self-healing in the pathological case.
  for (let attempt = 0; attempt < 3; attempt++) {
    const generatedToken = generateToken();
    const { data, error } = await supabase
      .from('hosted_replies')
      .insert({
        token:    generatedToken,
        user_id:  userId,
        question: question,
        content:  content,
      })
      .select('token, expires_at')
      .single();

    if (!error && data) {
      return json({
        success:    true,
        token:      (data as { token: string }).token,
        expires_at: (data as { expires_at: string }).expires_at,
      });
    }

    // 23505 = unique_violation (PK collision)
    if (error && (error as { code?: string }).code === '23505') {
      console.warn(`[save-hosted-reply] token collision attempt ${attempt + 1}, retrying`);
      continue;
    }

    console.error('[save-hosted-reply] insert error:', error?.message);
    return json({ error: error?.message ?? 'insert failed' }, 500);
  }

  return json({ error: 'token collision exhausted retries' }, 500);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
