/**
 * send-user-email Edge Function
 *
 * Server-side email sender. Unlike send-email (which requires the user's JWT
 * and sends on their behalf to a recipient), this function sends email TO the
 * user themselves for system summaries (conversation summaries, morning brief
 * follow-ups, etc).
 *
 * Auth: service role key (called from Railway voice server).
 * verify_jwt = false in config.toml — voice server carries service role.
 *
 * Uses the user's own Google refresh token to send via Gmail as themselves.
 * The email appears in their inbox from their own address.
 *
 * Request body:
 *   { user_id: "uuid", subject: "string", body: "string", to?: "override address" }
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API        = 'https://gmail.googleapis.com/gmail/v1/users/me';

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

function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  let binary = '';
  for (const b of new TextEncoder().encode(value)) binary += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function buildRawEmail(to: string, subject: string, body: string): string {
  const nl = '\r\n';
  const raw = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].join(nl);
  return toBase64Url(new TextEncoder().encode(raw));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user_id, subject, body, to: toOverride } = await req.json();
    if (!user_id || !subject || !body) {
      return new Response(JSON.stringify({ error: 'Missing user_id, subject, or body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Lookup user's Google refresh token
    const { data: tokenRow } = await adminClient
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', user_id)
      .eq('provider', 'google')
      .single();

    if (!tokenRow?.refresh_token) {
      return new Response(JSON.stringify({ error: 'No Google token for user' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine recipient email — override or user's own Google email
    let toEmail = toOverride;
    if (!toEmail) {
      const { data: settings } = await adminClient
        .from('user_settings')
        .select('email')
        .eq('user_id', user_id)
        .single();
      toEmail = settings?.email;
    }
    if (!toEmail) {
      return new Response(JSON.stringify({ error: 'No email address for user' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await getNewAccessToken(tokenRow.refresh_token);
    const raw = buildRawEmail(toEmail, subject, body);

    const sendRes = await fetch(`${GMAIL_API}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.text();
      console.error('[send-user-email] Gmail error:', err);
      return new Response(JSON.stringify({ error: `Gmail send failed: ${err}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[send-user-email] Sent "${subject}" to ${toEmail} for user ${user_id}`);
    return new Response(JSON.stringify({ success: true, to: toEmail }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[send-user-email] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
