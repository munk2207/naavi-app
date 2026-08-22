/**
 * seed-demo-email-james Edge Function
 *
 * One-time seed tool: inserts a single real Gmail message into Robert
 * Sinclair's real staging inbox via the Gmail API's messages.import,
 * from James Okafor, so Demo 5 ("Tell me about James") has a real,
 * live-verifiable email to surface alongside his calendar and contact
 * info. Same technique as seed-demo-emails/index.ts (2026-07-23) —
 * this is a narrow, single-message variant, not idempotent, not meant
 * to be re-run.
 *
 * Requires the gmail.insert OAuth scope, same as seed-demo-emails.
 *
 * Hardcoded to Robert's staging user_id by design — one-off demo
 * seeding tool, not a general-purpose endpoint.
 *
 * Usage: POST with {} body.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const ROBERT_USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';
const ROBERT_EMAIL = 'robert.esm.2207@gmail.com';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_INSERT_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/import';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getAccessToken(refreshToken: string): Promise<string> {
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

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function textEncode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

interface EmailSpec {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  dayOffset: number;
  hour: number;
}

function buildRawMessage(spec: EmailSpec): string {
  const date = new Date();
  date.setDate(date.getDate() + spec.dayOffset);
  date.setHours(spec.hour, 0, 0, 0);
  const dateHeader = date.toUTCString();

  const headers = [
    `From: ${spec.fromName} <${spec.from}>`,
    `To: ${ROBERT_EMAIL}`,
    `Subject: ${spec.subject}`,
    `Date: ${dateHeader}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  return headers.join('\r\n') + '\r\n\r\n' + spec.body;
}

async function insertMessage(accessToken: string, spec: EmailSpec): Promise<{ ok: boolean; id?: string; error?: string }> {
  const raw = buildRawMessage(spec);
  const rawB64url = b64urlEncode(textEncode(raw));
  const res = await fetch(GMAIL_INSERT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: rawB64url, labelIds: ['INBOX'] }),
  });
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: err };
  }
  const data = await res.json();
  return { ok: true, id: data.id };
}

const MESSAGE: EmailSpec = {
  from: 'james.esm.2207@outlook.com',
  fromName: 'James Okafor',
  to: ROBERT_EMAIL,
  dayOffset: -1,
  hour: 16,
  subject: 'Riverside Development — site walkthrough this week',
  body: "Hey Robert,\n\nLooking forward to the walkthrough this week. Can you bring the updated floor plans?\n\nAlso wanted to confirm the timeline for the drywall phase — are we still on track for next month?\n\nThanks,\nJames",
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: tokenRow, error: tokenError } = await admin
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id', ROBERT_USER_ID)
    .eq('provider', 'google')
    .single();

  if (tokenError || !tokenRow?.refresh_token) {
    return new Response(JSON.stringify({ error: 'No Google token found for Robert' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(tokenRow.refresh_token);
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Diagnostic: report the token's actual granted scopes before attempting
  // the insert, so a scope-denial can be understood rather than guessed at.
  let scopes: string | null = null;
  try {
    const tokeninfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`);
    const tokeninfoData = await tokeninfoRes.json();
    scopes = tokeninfoData?.scope ?? JSON.stringify(tokeninfoData);
  } catch (e) {
    scopes = `tokeninfo check failed: ${String(e)}`;
  }

  const result = await insertMessage(accessToken, MESSAGE);
  return new Response(JSON.stringify({ ...result, granted_scopes: scopes }), {
    status: result.ok ? 200 : 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
