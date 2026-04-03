/**
 * send-drive-file Edge Function
 *
 * Downloads a file from Google Drive and sends it as an email
 * attachment via Gmail API. Called when Robert taps "Send" on a
 * Drive file card.
 *
 * Google Docs/Sheets/Slides are exported as PDF.
 * All other files are sent in their native format.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API       = 'https://www.googleapis.com/drive/v3';
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

// Google Workspace types → export as PDF
const EXPORT_AS_PDF = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
]);

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildMimeEmail(opts: {
  to: string;
  subject: string;
  body: string;
  attachmentName: string;
  attachmentData: Uint8Array;
  attachmentMime: string;
}): string {
  const boundary = `naavi_${Date.now()}`;
  const nl = '\r\n';

  const header = [
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].join(nl);

  const textPart = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    opts.body,
  ].join(nl);

  const attachmentB64 = btoa(
    Array.from(opts.attachmentData).map(b => String.fromCharCode(b)).join('')
  );

  const attachmentPart = [
    `--${boundary}`,
    `Content-Type: ${opts.attachmentMime}`,
    `Content-Disposition: attachment; filename="${opts.attachmentName}"`,
    'Content-Transfer-Encoding: base64',
    '',
    attachmentB64.match(/.{1,76}/g)?.join(nl) ?? attachmentB64,
    `--${boundary}--`,
  ].join(nl);

  const raw = `${header}${nl}${nl}${textPart}${nl}${nl}${attachmentPart}`;

  // Encode full message as base64url for Gmail API
  const encoder = new TextEncoder();
  return toBase64Url(encoder.encode(raw));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Auth
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  const body = await req.json();
  const { fileId, fileName, mimeType, to, subject, message } = body;

  if (!fileId || !to) {
    return new Response(JSON.stringify({ error: 'Missing fileId or to' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

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
    console.error('[send-drive-file] Token lookup failed for user:', user.id, tokenError?.message);
    return new Response(JSON.stringify({ error: 'No Google token found' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const accessToken = await getNewAccessToken(tokenRow.refresh_token);

    // Download or export the file from Drive
    let fileUrl: string;
    let attachmentMime: string;
    let attachmentName: string;

    if (EXPORT_AS_PDF.has(mimeType)) {
      fileUrl = `${DRIVE_API}/files/${fileId}/export?mimeType=application/pdf`;
      attachmentMime = 'application/pdf';
      attachmentName = `${fileName}.pdf`;
    } else {
      fileUrl = `${DRIVE_API}/files/${fileId}?alt=media`;
      attachmentMime = mimeType || 'application/octet-stream';
      attachmentName = fileName;
    }

    const fileRes = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!fileRes.ok) {
      const err = await fileRes.text();
      return new Response(JSON.stringify({ error: `Drive download failed: ${err}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fileData = new Uint8Array(await fileRes.arrayBuffer());

    // Build and send email
    const emailBody = message || `Please find the document "${fileName}" attached.\n\nSent via Naavi.`;
    const emailSubject = subject || `${fileName}`;

    const rawEmail = buildMimeEmail({
      to,
      subject: emailSubject,
      body: emailBody,
      attachmentName,
      attachmentData: fileData,
      attachmentMime,
    });

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

    console.log(`[send-drive-file] Sent "${fileName}" to ${to}`);
    return new Response(JSON.stringify({ success: true, to, fileName: attachmentName }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[send-drive-file] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
