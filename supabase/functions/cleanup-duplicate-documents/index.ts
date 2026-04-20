/**
 * cleanup-duplicate-documents Edge Function
 *
 * One-off maintenance: finds duplicate rows in the `documents` table —
 * defined as multiple rows with the same (user_id, gmail_message_id,
 * file_name) — and deletes the younger ones from both Google Drive and
 * Supabase, keeping the oldest row and its file.
 *
 * Caused by the non-idempotent version of harvest-attachment (shipped
 * earlier today). The idempotency guard added afterwards prevents new
 * duplicates; this function cleans up what was created before the guard.
 *
 * Input: { user_id: string, dry_run?: boolean }
 * Output: { groups_found, files_deleted, rows_deleted, errors }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES_URL  = 'https://www.googleapis.com/drive/v3/files';

async function getAccessToken(refreshToken: string): Promise<string | null> {
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
}

type DocRow = {
  id: string;
  gmail_message_id: string | null;
  file_name: string;
  drive_file_id: string | null;
  created_at: string;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user_id, dry_run = false, delete_signature_images = false } = await req.json();
    if (!user_id) throw new Error('user_id required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: tokenRow } = await supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', user_id)
      .eq('provider', 'google')
      .maybeSingle();
    if (!tokenRow?.refresh_token) throw new Error('No Google refresh token for user');

    const accessToken = dry_run ? null : await getAccessToken(tokenRow.refresh_token);

    // Fetch all rows for the user, sorted oldest first so the first row per
    // (gmail_message_id, file_name) group is the survivor.
    const { data: allDocs, error } = await supabase
      .from('documents')
      .select('id, gmail_message_id, file_name, drive_file_id, created_at')
      .eq('user_id', user_id)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);

    const docs = (allDocs ?? []) as DocRow[];

    // Group by (gmail_message_id, file_name)
    const groups = new Map<string, DocRow[]>();
    for (const d of docs) {
      if (!d.gmail_message_id || !d.file_name) continue;
      const key = `${d.gmail_message_id}||${d.file_name}`;
      const arr = groups.get(key) ?? [];
      arr.push(d);
      groups.set(key, arr);
    }

    const dupGroups = Array.from(groups.values()).filter(arr => arr.length > 1);

    // Signature images (Outlook/Gmail auto-embedded) match the imageNNN.*
    // naming pattern. When delete_signature_images=true we ALSO purge every
    // such row — not just the duplicates — since a single signature image
    // is just as useless as fifty.
    const sigRegex = /^image\d+\.(jpe?g|png|gif|bmp)$/i;
    const sigRows = delete_signature_images
      ? docs.filter(d => sigRegex.test(d.file_name))
      : [];

    let filesDeleted = 0;
    let rowsDeleted = 0;
    const errors: Array<{ id: string; reason: string }> = [];
    const groupSummaries: Array<{ file_name: string; kept: string; deleted: number }> = [];

    // Collect all rows to delete: duplicates (keep oldest) + all signature images
    const deletionIds = new Set<string>();

    for (const group of dupGroups) {
      const [keep, ...dupes] = group;
      groupSummaries.push({
        file_name: keep.file_name,
        kept: keep.id,
        deleted: dupes.length,
      });
      for (const dup of dupes) deletionIds.add(dup.id);
    }

    for (const s of sigRows) deletionIds.add(s.id);

    const toDelete = docs.filter(d => deletionIds.has(d.id));

    for (const dup of toDelete) {
        // Delete Drive file
        if (!dry_run && dup.drive_file_id && accessToken) {
          try {
            const driveRes = await fetch(
              `${DRIVE_FILES_URL}/${encodeURIComponent(dup.drive_file_id)}`,
              { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
            );
            // Drive returns 204 on success, 404 if already gone — both fine.
            if (driveRes.ok || driveRes.status === 404) {
              filesDeleted++;
            } else {
              errors.push({ id: dup.id, reason: `drive_delete_${driveRes.status}` });
              continue; // leave DB row in place so we can retry later
            }
          } catch (err) {
            errors.push({ id: dup.id, reason: `drive_delete_error: ${err instanceof Error ? err.message : String(err)}` });
            continue;
          }
        }

        // Delete documents row
        if (!dry_run) {
          const { error: delErr } = await supabase
            .from('documents')
            .delete()
            .eq('id', dup.id);
          if (delErr) {
            errors.push({ id: dup.id, reason: `db_delete_error: ${delErr.message}` });
            continue;
          }
          rowsDeleted++;
        }
      }

    return new Response(JSON.stringify({
      dry_run,
      total_rows: docs.length,
      groups_found: dupGroups.length,
      files_deleted: filesDeleted,
      rows_deleted: rowsDeleted,
      errors,
      group_summaries: groupSummaries,
    }), { headers: { ...corsHeaders, 'content-type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cleanup-duplicate-documents] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});
