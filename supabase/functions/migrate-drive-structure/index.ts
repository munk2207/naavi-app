/**
 * migrate-drive-structure Edge Function — one-off Drive tidy-up.
 *
 * Moves existing loose files under MyNaavi/ root AND list Docs at Drive root
 * into their proper subfolders (Briefs, Notes, Transcripts, Lists). Records
 * a `documents` row for each moved file (except lists, which have their own
 * table) so Global Search covers them via the drive adapter.
 *
 * Classification rules:
 *   1. file.id is in the user's `lists` table   → Lists/
 *   2. title starts with "Morning Brief"        → Briefs/
 *   3. other MyNaavi/ root file                 → Notes/     (safe default)
 *
 * Input:  { user_id: string, dry_run?: boolean }
 * Output: { moved, skipped, errors, plan }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES_URL  = 'https://www.googleapis.com/drive/v3/files';
const NAAVI_FOLDER     = 'MyNaavi';

type Category = 'list' | 'brief' | 'note';

const SUBFOLDER: Record<Category, string> = {
  list:  'Lists',
  brief: 'Briefs',
  note:  'Notes',
};

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
  } catch {
    return null;
  }
}

async function findFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string | null> {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`;
  const url = `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data.files) && data.files.length > 0 ? data.files[0].id as string : null;
}

async function createFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const body: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];
  const res = await fetch(DRIVE_FILES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Create folder ${name} failed: ${await res.text()}`);
  const d = await res.json();
  return d.id as string;
}

async function ensureFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string> {
  return (await findFolder(accessToken, name, parentId)) ?? (await createFolder(accessToken, name, parentId));
}

async function listChildren(accessToken: string, parentId: string): Promise<Array<{id: string; name: string; mimeType: string}>> {
  const q = `'${parentId}' in parents and trashed=false`;
  const out: Array<{id: string; name: string; mimeType: string}> = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(DRIVE_FILES_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('fields', 'nextPageToken, files(id,name,mimeType)');
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`list children failed: ${res.status}`);
    const data = await res.json();
    out.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

async function moveFile(
  accessToken: string,
  fileId: string,
  newParentId: string,
  oldParentId: string,
): Promise<void> {
  const url = `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?addParents=${newParentId}&removeParents=${oldParentId}&fields=id`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`move ${fileId} failed: ${res.status} ${await res.text()}`);
}

function classify(title: string, isList: boolean): Category {
  if (isList) return 'list';
  if (/^\s*Morning Brief\b/i.test(title)) return 'brief';
  return 'note';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user_id, dry_run = false } = await req.json();
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
    const accessToken = await getAccessToken(tokenRow.refresh_token);
    if (!accessToken) throw new Error('Token refresh failed');

    // Gather list file IDs (Docs backing the lists table — may live at root
    // or already under MyNaavi/ if created post-step-3).
    const { data: listRows } = await supabase
      .from('lists')
      .select('drive_file_id, name')
      .eq('user_id', user_id);
    const listFileIds = new Set<string>((listRows ?? []).map((r: { drive_file_id: string }) => r.drive_file_id));

    // Find MyNaavi root folder; create if missing.
    const myNaaviId = await ensureFolder(accessToken, NAAVI_FOLDER);

    // Candidate files to consider:
    //   (a) everything currently inside MyNaavi/ root
    //   (b) list Docs whose drive_file_id is NOT already a child of MyNaavi/
    const rootChildren = await listChildren(accessToken, myNaaviId);

    // Already-subfoldered children (Documents, Notes, Briefs, Transcripts,
    // Lists) are folders themselves — exclude from the move candidates.
    const candidates = rootChildren.filter(c => c.mimeType !== 'application/vnd.google-apps.folder');

    // Lists at Drive root (or anywhere else) need to be fetched individually
    // because they are NOT children of MyNaavi/. We check parents per list.
    const listsToMigrate: Array<{id: string; name: string}> = [];
    for (const r of (listRows ?? []) as Array<{drive_file_id: string; name: string}>) {
      // Quick parent check — if already under MyNaavi/, skip.
      try {
        const res = await fetch(
          `${DRIVE_FILES_URL}/${encodeURIComponent(r.drive_file_id)}?fields=id,name,parents`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) continue;
        const data = await res.json();
        const parents: string[] = data.parents ?? [];
        // If the list is already somewhere inside MyNaavi/Lists we skip.
        // Otherwise include it.
        if (!parents.includes(myNaaviId) && !rootChildren.some(c => c.id === data.id)) {
          // already outside MyNaavi — add it for migration
          listsToMigrate.push({ id: data.id, name: data.name });
        }
        // Also capture even if it's already inside MyNaavi root — the move
        // loop below will treat it as a list candidate via listFileIds.
      } catch {
        /* ignore */
      }
    }

    // Ensure destination subfolders exist (lazily created).
    const needsFolder = new Set<Category>();
    for (const c of candidates) {
      needsFolder.add(classify(c.name, listFileIds.has(c.id)));
    }
    for (const l of listsToMigrate) {
      needsFolder.add('list');
    }
    const folderIds: Partial<Record<Category, string>> = {};
    for (const cat of needsFolder) {
      folderIds[cat] = await ensureFolder(accessToken, SUBFOLDER[cat], myNaaviId);
    }

    const plan: Array<{
      file_id: string;
      file_name: string;
      from: 'MyNaavi_root' | 'Drive_root';
      to: string;
      category: Category;
    }> = [];

    for (const c of candidates) {
      const cat = classify(c.name, listFileIds.has(c.id));
      plan.push({
        file_id: c.id,
        file_name: c.name,
        from: 'MyNaavi_root',
        to: SUBFOLDER[cat],
        category: cat,
      });
    }
    for (const l of listsToMigrate) {
      plan.push({
        file_id: l.id,
        file_name: l.name,
        from: 'Drive_root',
        to: SUBFOLDER.list,
        category: 'list',
      });
    }

    if (dry_run) {
      return new Response(JSON.stringify({ dry_run: true, candidate_count: plan.length, plan }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    // Execute the moves + write documents rows.
    let moved = 0;
    const errors: Array<{file_id: string; reason: string}> = [];

    for (const p of plan) {
      const destId = folderIds[p.category];
      if (!destId) {
        errors.push({ file_id: p.file_id, reason: 'dest_folder_missing' });
        continue;
      }
      const oldParent = p.from === 'MyNaavi_root'
        ? myNaaviId
        : (await (async () => {
            // discover actual parent for root-level lists
            try {
              const res = await fetch(
                `${DRIVE_FILES_URL}/${encodeURIComponent(p.file_id)}?fields=parents`,
                { headers: { Authorization: `Bearer ${accessToken}` } },
              );
              if (!res.ok) return null;
              const data = await res.json();
              return (data.parents ?? [])[0] as string | null;
            } catch { return null; }
          })());
      if (!oldParent) {
        errors.push({ file_id: p.file_id, reason: 'no_current_parent' });
        continue;
      }

      try {
        await moveFile(accessToken, p.file_id, destId, oldParent);
      } catch (err) {
        errors.push({ file_id: p.file_id, reason: `move_failed: ${err instanceof Error ? err.message : String(err)}` });
        continue;
      }

      // Write documents row for non-list categories (lists already tracked
      // separately in the lists table + adapter).
      if (p.category !== 'list') {
        const webViewLink = `https://docs.google.com/document/d/${p.file_id}/edit`;
        const { error: docErr } = await supabase
          .from('documents')
          .upsert({
            user_id,
            file_name: p.file_name,
            mime_type: 'application/vnd.google-apps.document',
            drive_file_id: p.file_id,
            drive_web_view_link: webViewLink,
            source: p.category,
          }, { onConflict: 'user_id,drive_file_id' });
        if (docErr) {
          errors.push({ file_id: p.file_id, reason: `doc_upsert_failed: ${docErr.message}` });
          continue;
        }
      }

      moved++;
    }

    return new Response(JSON.stringify({
      dry_run: false,
      candidate_count: plan.length,
      moved,
      errors,
      plan,
    }), { headers: { ...corsHeaders, 'content-type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[migrate-drive-structure] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});
