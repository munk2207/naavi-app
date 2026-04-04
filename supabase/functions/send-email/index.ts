/**
 * send-email Edge Function
 *
 * Sends a plain text email via Gmail API on Robert's behalf.
 * Called when Robert taps "Send" on a draft message card.
 *
 * Auth: RLS-based (same pattern as send-drive-file).
 * verify_jwt = false in config.toml — auth is handled by RLS.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API       = 'https://gmail.googleapis.com/gmail/v1/users/me';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getNewAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * RFC 2047 — encode a header value that may contain non-ASCII characters.
 * Email clients cannot read raw UTF-8 in headers, so special characters
 * (em dashes, curly quotes, accented letters, etc.) must be wrapped in
 * the =?UTF-8?B?...?= format before being placed in the Subject line.
 */
function encodeEmailHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value; // pure ASCII — no encoding needed
  let binary = '';
  for (const b of new TextEncoder().encode(value)) binary += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function buildPlainEmail(to: string, subject: string, body: string): string {
  const nl = '\r\n';
  const raw = [
    `To: ${to}`,
    `Subject: ${encodeEmailHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].join(nl);

  return toBase64Url(new TextEncoder().encode(raw));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders,
    });
  }

  const body = await req.json();
  const { to, toName, subject, body: emailBody } = body;

  if (!to || !emailBody) {
    return new Response(JSON.stringify({ error: 'Missing to or body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Identify the calling user from their JWT
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Use service role to bypass RLS and fetch the token directly by user_id
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: tokenRow, error: tokenError } = await adminClient
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id', user.id)
    .eq('provider', 'google')
    .single();

  if (tokenError || !tokenRow?.refresh_token) {
    console.error('[send-email] Token lookup failed for user:', user.id, tokenError?.message);
    return new Response(JSON.stringify({ error: 'No Google token found' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const accessToken = await getNewAccessToken(tokenRow.refresh_token);

    // Format TO with display name if available: "Name <email>"
    const toHeader = toName ? `${toName} <${to}>` : to;

    const rawEmail = buildPlainEmail(
      toHeader,
      subject || '(no subject)',
      emailBody,
    );

    const sendRes = await fetch(`${GMAIL_API}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: rawEmail }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.text();
      return new Response(JSON.stringify({ error: `Gmail send failed: ${err}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[send-email] Sent "${subject}" to ${to}`);
    return new Response(JSON.stringify({ success: true, to }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[send-email] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
