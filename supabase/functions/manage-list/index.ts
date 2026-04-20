/**
 * manage-list Edge Function
 *
 * Handles all list operations: LIST_CREATE, LIST_ADD, LIST_REMOVE, LIST_READ
 * Lists are stored as Google Drive documents, mapped via the `lists` table.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Standard 3-step user_id resolution per CLAUDE.md rule:
// (a) JWT auth, (b) body.user_id, (c) user_tokens fallback
async function resolveUserId(
  supabase: ReturnType<typeof createClient>,
  authHeader: string | null,
  bodyUserId: string | null
): Promise<string | null> {
  // Attempt 1: JWT auth (mobile app)
  if (authHeader) {
    try {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) return user.id;
    } catch (_) { /* ignore */ }
  }

  // Attempt 2: explicit user_id from request body (voice server / server-side)
  if (bodyUserId) return bodyUserId;

  // Attempt 3: single-user fallback via user_tokens
  try {
    const { data } = await supabase
      .from('user_tokens')
      .select('user_id')
      .eq('provider', 'google')
      .limit(1)
      .single();
    if (data) return data.user_id;
  } catch (_) { /* ignore */ }

  return null;
}

async function getGoogleAccessToken(supabase: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data: tokenRow } = await supabase
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .single();

  if (!tokenRow?.refresh_token) return null;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: tokenRow.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json();
  return tokenData.access_token ?? null;
}

async function findList(supabase: ReturnType<typeof createClient>, userId: string, name: string) {
  // Try exact match first
  const { data: exact } = await supabase
    .from('lists')
    .select('id, name, category, drive_file_id, web_view_link')
    .eq('user_id', userId)
    .ilike('name', name)
    .maybeSingle();
  if (exact) return exact;

  // Try stripping trailing "list"/"lists" — Claude often appends the word
  // (e.g. "Costco list" → "Costco") when the stored name doesn't include it.
  const stripped = name.replace(/\s+lists?$/i, '').trim();
  if (stripped && stripped !== name) {
    const { data: strippedMatch } = await supabase
      .from('lists')
      .select('id, name, category, drive_file_id, web_view_link')
      .eq('user_id', userId)
      .ilike('name', stripped)
      .maybeSingle();
    if (strippedMatch) return strippedMatch;
  }

  return null;
}

async function readDriveDoc(accessToken: string, fileId: string): Promise<string> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return '';
  return await res.text();
}

async function updateDriveDoc(accessToken: string, fileId: string, content: string): Promise<boolean> {
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'text/plain',
    },
    body: content,
  });
  return res.ok;
}

// Ensure the MyNaavi → Lists folder path exists under the user's Drive root
// and return the Lists folder ID. Idempotent: reuses existing folders when
// present, creates lazily on first call. Lists created before this function
// was introduced live at Drive root — step 4 migration moves them.
async function ensureListsFolder(accessToken: string): Promise<string> {
  const findFolder = async (name: string, parentId?: string): Promise<string | null> => {
    const parentClause = parentId ? ` and '${parentId}' in parents` : '';
    const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.files) && data.files.length > 0 ? data.files[0].id as string : null;
  };

  const createFolder = async (name: string, parentId?: string): Promise<string> => {
    const body: Record<string, unknown> = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) body.parents = [parentId];
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create folder ${name}: ${await res.text()}`);
    const d = await res.json();
    return d.id as string;
  };

  const rootId = (await findFolder('MyNaavi')) ?? (await createFolder('MyNaavi'));
  const listsId = (await findFolder('Lists', rootId)) ?? (await createFolder('Lists', rootId));
  return listsId;
}

async function createDriveDoc(accessToken: string, title: string): Promise<{ fileId: string; webViewLink: string } | null> {
  // Create the Lists folder lazily so new list Docs land under
  // MyNaavi/Lists/ rather than at the Drive root. Existing list Docs are
  // relocated by the step-4 migration.
  const listsFolderId = await ensureListsFolder(accessToken);

  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: title,
      mimeType: 'application/vnd.google-apps.document',
      parents: [listsFolderId],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    fileId: data.id,
    webViewLink: `https://docs.google.com/document/d/${data.id}/edit`,
  };
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const action = await req.json();
    const type = action.type;
    const authHeader = req.headers.get('Authorization');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const userId = await resolveUserId(supabase, authHeader, action.user_id ?? null);
    if (!userId) return jsonResponse({ success: false, error: 'No user found' }, 400);

    const accessToken = await getGoogleAccessToken(supabase, userId);
    if (!accessToken) return jsonResponse({ success: false, error: 'No Google access token' }, 400);

    // ── LIST_CREATE ─────────────────────────────────────────────────────────
    if (type === 'LIST_CREATE') {
      const name = String(action.name ?? 'My List');
      const category = String(action.category ?? 'other');

      // Check if already exists
      const existing = await findList(supabase, userId, name);
      if (existing) return jsonResponse({ success: true, list: existing });

      // Create Google Doc
      const doc = await createDriveDoc(accessToken, name);
      if (!doc) return jsonResponse({ success: false, error: 'Failed to create Drive doc' }, 500);

      // Save to lists table
      await supabase.from('lists').insert({
        user_id: userId,
        name,
        category,
        drive_file_id: doc.fileId,
        web_view_link: doc.webViewLink,
      });

      console.log(`[manage-list] Created "${name}" — ${doc.fileId}`);
      return jsonResponse({ success: true, list: { name, category, drive_file_id: doc.fileId, web_view_link: doc.webViewLink } });
    }

    // ── LIST_ADD ─────────────────────────────────────────────────────────────
    if (type === 'LIST_ADD') {
      const listName = String(action.listName ?? '');
      const items: string[] = Array.isArray(action.items) ? action.items.map(String) : [];

      const list = await findList(supabase, userId, listName);
      if (!list) return jsonResponse({ success: false, error: `List "${listName}" not found` });

      const current = await readDriveDoc(accessToken, list.drive_file_id);
      const lines = current.split('\n').filter((l: string) => l.trim());
      for (const item of items) {
        if (item.trim()) lines.push(item.trim());
      }

      const ok = await updateDriveDoc(accessToken, list.drive_file_id, lines.join('\n') + '\n');
      if (!ok) return jsonResponse({ success: false, error: 'Failed to update Drive doc' });

      console.log(`[manage-list] Added ${items.length} items to "${listName}"`);
      return jsonResponse({ success: true, items });
    }

    // ── LIST_REMOVE ──────────────────────────────────────────────────────────
    if (type === 'LIST_REMOVE') {
      const listName = String(action.listName ?? '');
      const items: string[] = Array.isArray(action.items) ? action.items.map(String) : [];

      const list = await findList(supabase, userId, listName);
      if (!list) return jsonResponse({ success: false, error: `List "${listName}" not found` });

      const current = await readDriveDoc(accessToken, list.drive_file_id);
      let lines = current.split('\n').filter((l: string) => l.trim());
      const removeSet = new Set(items.map((i: string) => i.trim().toLowerCase()));
      lines = lines.filter((l: string) => !removeSet.has(l.trim().toLowerCase()));

      const ok = await updateDriveDoc(accessToken, list.drive_file_id, lines.join('\n') + '\n');
      if (!ok) return jsonResponse({ success: false, error: 'Failed to update Drive doc' });

      console.log(`[manage-list] Removed ${items.length} items from "${listName}"`);
      return jsonResponse({ success: true });
    }

    // ── LIST_READ ────────────────────────────────────────────────────────────
    if (type === 'LIST_READ') {
      const listName = String(action.listName ?? '');

      const list = await findList(supabase, userId, listName);
      if (!list) return jsonResponse({ success: false, error: `List "${listName}" not found` });

      const content = await readDriveDoc(accessToken, list.drive_file_id);
      const allLines = content.split('\n').filter((l: string) => l.trim());
      const firstLineIsTitle = allLines.length > 0 && allLines[0].toLowerCase().trim() === listName.toLowerCase().trim();
      const items = firstLineIsTitle ? allLines.slice(1) : allLines;

      console.log(`[manage-list] Read "${listName}" — ${items.length} items`);
      return jsonResponse({ success: true, items });
    }

    return jsonResponse({ success: false, error: `Unknown action type: ${type}` }, 400);

  } catch (err) {
    console.error('[manage-list] Error:', err);
    return jsonResponse({ success: false, error: String(err) }, 500);
  }
});
