/**
 * scan-drive-pdfs Edge Function
 *
 * Walks the user's Google Drive, finds PDFs that were NOT picked up by
 * the email-attachment harvest pipeline (i.e. not in the `documents`
 * table), and queues each one through `extract-document-text` so its
 * text content becomes searchable. This closes the gap for PDFs the
 * user uploaded directly to Drive (school calendars, manuals, etc.).
 *
 * Input (POST body):
 *   { user_id?: string, max_files?: number }
 *   - user_id   : multi-user safe; falls back to JWT then user_tokens.
 *   - max_files : cap per run (default 100). Lower for first-run safety.
 *
 * Output:
 *   {
 *     ok: boolean,
 *     scanned: number,        // PDFs found in Drive
 *     already_in_db: number,  // skipped (already in documents)
 *     queued: number,         // newly inserted + extract triggered
 *     skipped: Array<{ id, name, reason }>,
 *     error?: string,
 *   }
 *
 * Idempotent — onConflict on (user_id, drive_file_id) so re-runs are safe.
 * Fire-and-forget extract-document-text per file (no per-file await).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_LIST_URL   = 'https://www.googleapis.com/drive/v3/files';

// Drive query: PDFs only, not in trash, owned by or shared with user.
// We exclude folders. Order by recently modified so the most-relevant
// (recently used) PDFs get processed first if max_files caps the run.
const DRIVE_QUERY = "mimeType='application/pdf' and trashed=false";

const DEFAULT_MAX_FILES = 100;
const PAGE_SIZE = 100;

async function getAccessToken(refreshToken: string): Promise<string | null> {
  try {
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
    return typeof data.access_token === 'string' ? data.access_token : null;
  } catch (err) {
    console.error('[scan-drive-pdfs] token refresh failed:', err);
    return null;
  }
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  modifiedTime?: string;
}

async function listAllPdfs(accessToken: string, max: number): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  while (out.length < max) {
    const url = new URL(DRIVE_LIST_URL);
    url.searchParams.set('q', DRIVE_QUERY);
    url.searchParams.set('pageSize', String(Math.min(PAGE_SIZE, max - out.length)));
    url.searchParams.set('fields', 'nextPageToken, files(id, name, mimeType, size, webViewLink, modifiedTime)');
    url.searchParams.set('orderBy', 'modifiedTime desc');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[scan-drive-pdfs] Drive list failed:', res.status, errText);
      throw new Error(`Drive list failed: ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data.files)) out.push(...data.files);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out.slice(0, max);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const maxFiles: number = typeof body.max_files === 'number' ? body.max_files : DEFAULT_MAX_FILES;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ── User resolution (CLAUDE.md Rule 4) ─────────────────────────────────
    // (a) JWT  (b) request body user_id  (c) user_tokens fallback
    let userId: string | null = null;
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const supaForAuth = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: userData } = await supaForAuth.auth.getUser();
      if (userData?.user?.id) userId = userData.user.id;
    }
    if (!userId && typeof body.user_id === 'string') userId = body.user_id;

    if (!userId) {
      return new Response(JSON.stringify({ ok: false, error: 'user_id required (JWT or body)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Get the user's Google refresh token ────────────────────────────────
    const { data: tokenRow, error: tokenErr } = await supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .maybeSingle();

    if (tokenErr || !tokenRow?.refresh_token) {
      return new Response(JSON.stringify({ ok: false, error: 'no Google refresh token for user' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await getAccessToken(tokenRow.refresh_token);
    if (!accessToken) {
      return new Response(JSON.stringify({ ok: false, error: 'failed to refresh Google access token' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── List PDFs in Drive ─────────────────────────────────────────────────
    const pdfs = await listAllPdfs(accessToken, maxFiles);
    console.log(`[scan-drive-pdfs] user=${userId} — Drive returned ${pdfs.length} PDFs (cap ${maxFiles})`);

    // ── Fetch existing documents rows for this user (drive_file_id only) ──
    const { data: existing, error: existingErr } = await supabase
      .from('documents')
      .select('drive_file_id')
      .eq('user_id', userId);
    if (existingErr) {
      return new Response(JSON.stringify({ ok: false, error: `documents query failed: ${existingErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const knownIds = new Set((existing ?? []).map((r: { drive_file_id: string | null }) => r.drive_file_id).filter(Boolean));

    // ── Insert new rows + fire extract-document-text per new file ──────────
    let alreadyInDb = 0;
    let queued = 0;
    const skipped: Array<{ id: string; name: string; reason: string }> = [];

    for (const f of pdfs) {
      if (knownIds.has(f.id)) {
        alreadyInDb++;
        continue;
      }

      const sizeBytes = f.size ? parseInt(f.size, 10) : null;
      const { error: insertErr } = await supabase
        .from('documents')
        .upsert({
          user_id:             userId,
          file_name:           f.name,
          mime_type:           f.mimeType,
          size_bytes:          sizeBytes,
          document_type:       'other',           // extract-document-text reclassifies once content is read
          drive_file_id:       f.id,
          drive_web_view_link: f.webViewLink ?? null,
          source:              'drive_scan',
        }, { onConflict: 'user_id,drive_file_id' });

      if (insertErr) {
        skipped.push({ id: f.id, name: f.name, reason: `db_insert_failed: ${insertErr.message}` });
        continue;
      }

      // Fire-and-forget extraction (same pattern as harvest-attachment)
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-document-text`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ user_id: userId, drive_file_id: f.id }),
      }).catch(err => console.error('[scan-drive-pdfs] extract trigger failed:', err?.message ?? err));

      queued++;
    }

    console.log(`[scan-drive-pdfs] user=${userId} — scanned=${pdfs.length} already=${alreadyInDb} queued=${queued} skipped=${skipped.length}`);

    return new Response(JSON.stringify({
      ok: true,
      scanned: pdfs.length,
      already_in_db: alreadyInDb,
      queued,
      skipped,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[scan-drive-pdfs] fatal:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
