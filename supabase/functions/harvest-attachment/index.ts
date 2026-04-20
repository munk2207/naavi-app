/**
 * harvest-attachment Edge Function — Phase 1 of A2 (attachment harvesting).
 *
 * Given a tier-1 Gmail message id, walks its MIME parts, downloads any
 * eligible attachments (PDF / JPG / PNG / DOCX / XLSX within the size band),
 * and uploads them to the user's own Google Drive under
 *   MyNaavi/Documents/<document_type>/
 * A row is written to the `documents` table pointing back to both the email
 * and (when applicable) the email_actions row.
 *
 * Input: { user_id: string, gmail_message_id: string }
 * Output: { processed: [...], skipped: [...] }
 *
 * Phase 1 scope: stores the PDF as-is (no text extraction yet). Phase 2 adds
 * Claude-over-PDF for text-layer docs; Phase 3 adds OCR for images.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API        = 'https://gmail.googleapis.com/gmail/v1/users/me';
const DRIVE_FILES_URL  = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const NAAVI_FOLDER_NAME = 'MyNaavi';
const DOCUMENTS_FOLDER_NAME = 'Documents';

// Size limits — skip tiny files (signatures, logos, tracking pixels) and
// oversize ones (outside typical email attachment territory).
const MIN_BYTES = 10 * 1024;             // 10 KB
const MAX_BYTES = 25 * 1024 * 1024;      // 25 MB

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
]);

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')     ?? '',
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

// Folder helpers — findOrCreate inside a parent folder. Falls back to root
// when parentId is undefined (used for MyNaavi at Drive root).
async function findOrCreateFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const query = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`;
  const searchUrl = `${DRIVE_FILES_URL}?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`;
  const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (Array.isArray(data.files) && data.files.length > 0) {
      return data.files[0].id as string;
    }
  }

  const body: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];
  const createRes = await fetch(DRIVE_FILES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!createRes.ok) {
    throw new Error(`Failed to create folder ${name}: ${await createRes.text()}`);
  }
  const folder = await createRes.json();
  return folder.id as string;
}

// Walk a Gmail message part tree and collect every attachment leaf. Each
// returned entry has enough info to call the attachments.get endpoint.
type AttachmentLeaf = {
  part_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  attachment_id: string;
};
function collectAttachments(payload: any, out: AttachmentLeaf[] = []): AttachmentLeaf[] {
  if (!payload) return out;
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  if (payload.filename && payload.body?.attachmentId) {
    out.push({
      part_id: payload.partId ?? '',
      filename: payload.filename,
      mime_type: payload.mimeType ?? '',
      size_bytes: Number(payload.body?.size ?? 0),
      attachment_id: payload.body.attachmentId,
    });
  }
  for (const p of parts) collectAttachments(p, out);
  return out;
}

// Decode URL-safe base64 (Gmail encoding) into bytes.
function decodeGmailBase64(data: string): Uint8Array {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function uploadToDrive(
  accessToken: string,
  parentFolderId: string,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<{ id: string; webViewLink?: string }> {
  // Multipart upload — metadata + binary in one request.
  const boundary = `naavi${Date.now()}${Math.random().toString(16).slice(2)}`;
  const metadata = {
    name: fileName,
    parents: [parentFolderId],
    mimeType,
  };
  const head =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const headBytes = new TextEncoder().encode(head);
  const tailBytes = new TextEncoder().encode(tail);
  const body = new Uint8Array(headBytes.length + bytes.length + tailBytes.length);
  body.set(headBytes, 0);
  body.set(bytes, headBytes.length);
  body.set(tailBytes, headBytes.length + bytes.length);

  const url = `${DRIVE_UPLOAD_URL}&fields=id,webViewLink`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return { id: data.id, webViewLink: data.webViewLink };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user_id, gmail_message_id } = await req.json();
    if (!user_id || !gmail_message_id) {
      throw new Error('user_id and gmail_message_id required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // OAuth token
    const { data: tokenRow, error: tokenErr } = await supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', user_id)
      .eq('provider', 'google')
      .maybeSingle();
    if (tokenErr || !tokenRow?.refresh_token) {
      throw new Error('No Google refresh token for user');
    }
    const accessToken = await getAccessToken(tokenRow.refresh_token);

    // Fetch the email with full payload so attachment part metadata is
    // present. attachments.get still needs a separate call per leaf to pull
    // the binary.
    const msgRes = await fetch(`${GMAIL_API}/messages/${encodeURIComponent(gmail_message_id)}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!msgRes.ok) {
      throw new Error(`Gmail fetch failed: ${msgRes.status} ${await msgRes.text()}`);
    }
    const msg = await msgRes.json();

    const leaves = collectAttachments(msg.payload);
    if (leaves.length === 0) {
      return new Response(JSON.stringify({ processed: [], skipped: [], reason: 'no_attachments' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    // Look up any email_action row so we can pull document_type for folder
    // routing, and link the documents row back.
    const { data: actionRow } = await supabase
      .from('email_actions')
      .select('id, document_type')
      .eq('user_id', user_id)
      .eq('gmail_message_id', gmail_message_id)
      .maybeSingle();
    const documentTypeForFolder = actionRow?.document_type ?? 'other';
    const emailActionId = actionRow?.id ?? null;

    // Ensure folder path MyNaavi/Documents/<category>/
    const rootFolderId      = await findOrCreateFolder(accessToken, NAAVI_FOLDER_NAME);
    const docsFolderId      = await findOrCreateFolder(accessToken, DOCUMENTS_FOLDER_NAME, rootFolderId);
    const categoryFolderId  = await findOrCreateFolder(accessToken, documentTypeForFolder, docsFolderId);

    const processed: Array<Record<string, unknown>> = [];
    const skipped:   Array<Record<string, unknown>> = [];

    for (const leaf of leaves) {
      if (!ALLOWED_MIME.has(leaf.mime_type)) {
        skipped.push({ ...leaf, reason: 'mime_not_allowed' });
        continue;
      }
      if (leaf.size_bytes < MIN_BYTES) {
        skipped.push({ ...leaf, reason: 'too_small' });
        continue;
      }
      if (leaf.size_bytes > MAX_BYTES) {
        skipped.push({ ...leaf, reason: 'too_large' });
        continue;
      }

      // Skip email-signature / logo images. Outlook and Gmail embed HTML
      // signature images as auto-named parts (image001.jpg, image002.png…)
      // that Gmail's attachments endpoint returns just like real attachments.
      // Filter them out by filename pattern AND by size (small images are
      // almost always signature/logo/icon assets, not document scans).
      const isAutoSigName = /^image\d+\.(jpe?g|png|gif|bmp)$/i.test(leaf.filename);
      const isSmallImage  = leaf.mime_type.startsWith('image/') && leaf.size_bytes < 100 * 1024;
      if (isAutoSigName || isSmallImage) {
        skipped.push({ ...leaf, reason: 'likely_email_signature' });
        continue;
      }

      // Idempotency: if we've already harvested this attachment for this
      // email (same filename), skip. Drive issues a new file id on every
      // upload, so without this check repeated calls (backfill, retries,
      // cascade fires) create multiple physical copies in Drive.
      const { data: existing } = await supabase
        .from('documents')
        .select('drive_file_id, drive_web_view_link, document_type')
        .eq('user_id', user_id)
        .eq('gmail_message_id', gmail_message_id)
        .eq('file_name', leaf.filename)
        .maybeSingle();

      if (existing?.drive_file_id) {
        skipped.push({
          ...leaf,
          reason: 'already_harvested',
          drive_file_id: existing.drive_file_id,
          drive_web_view_link: existing.drive_web_view_link,
        });
        continue;
      }

      // Pull binary
      const attRes = await fetch(
        `${GMAIL_API}/messages/${encodeURIComponent(gmail_message_id)}/attachments/${encodeURIComponent(leaf.attachment_id)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!attRes.ok) {
        skipped.push({ ...leaf, reason: `gmail_get_${attRes.status}` });
        continue;
      }
      const attData = await attRes.json();
      const bytes = decodeGmailBase64(attData.data ?? '');
      if (bytes.length === 0) {
        skipped.push({ ...leaf, reason: 'empty_body' });
        continue;
      }

      // Upload to Drive
      let uploaded: { id: string; webViewLink?: string };
      try {
        uploaded = await uploadToDrive(accessToken, categoryFolderId, leaf.filename, leaf.mime_type, bytes);
      } catch (err) {
        skipped.push({ ...leaf, reason: `drive_upload_failed: ${err instanceof Error ? err.message : String(err)}` });
        continue;
      }

      // Record in documents table
      const { error: insertErr } = await supabase
        .from('documents')
        .upsert({
          user_id,
          gmail_message_id,
          email_action_id: emailActionId,
          file_name: leaf.filename,
          mime_type: leaf.mime_type,
          size_bytes: leaf.size_bytes,
          document_type: documentTypeForFolder,
          drive_file_id: uploaded.id,
          drive_web_view_link: uploaded.webViewLink ?? null,
          source: 'gmail_attachment',
        }, { onConflict: 'user_id,drive_file_id' });

      if (insertErr) {
        skipped.push({ ...leaf, reason: `db_insert_failed: ${insertErr.message}`, drive_file_id: uploaded.id });
        continue;
      }

      // Fire-and-forget text extraction. PDFs go through Claude's text-layer
      // reader; scanned PDFs fall back to Vision OCR inside extract-document-text.
      // Images (JPEG/PNG) go directly to Vision OCR (A3 Phase 2).
      if (
        leaf.mime_type === 'application/pdf' ||
        leaf.mime_type === 'image/jpeg' ||
        leaf.mime_type === 'image/png'
      ) {
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-document-text`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ user_id, drive_file_id: uploaded.id }),
        }).catch(err => console.error('[harvest-attachment] extract-document-text trigger failed:', err?.message ?? err));
      }

      processed.push({
        file_name: leaf.filename,
        mime_type: leaf.mime_type,
        size_bytes: leaf.size_bytes,
        drive_file_id: uploaded.id,
        drive_web_view_link: uploaded.webViewLink ?? null,
        document_type: documentTypeForFolder,
      });
    }

    return new Response(JSON.stringify({ processed, skipped }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[harvest-attachment] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});
