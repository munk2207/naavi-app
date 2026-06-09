/**
 * manage-list-connections Edge Function — F1a (Wael 2026-05-11).
 *
 * CRUD over the list_connections table.
 *
 * Cardinality (Wave 2.5, Wael 2026-05-13): M:N. Each entity can carry
 * multiple lists (an alert can have both a "groceries" list AND an
 * "errands" list). Same (list_id, entity_type, entity_id) pair can't
 * duplicate — enforced by UNIQUE(list_id, entity_type, entity_id) in
 * 20260513_list_connections_mn.sql.
 *
 * Operations:
 *   CONNECT — wire list_id ↔ entity. Additive: pre-existing connections
 *             on the same entity for OTHER lists stay. Returns 409
 *             ("already attached") if the same (list, entity) pair is
 *             attempted twice.
 *   DISCONNECT — remove ONE connection. `list_id` is required to identify
 *             which list to detach. Back-compat: if `list_id` is absent
 *             and the entity has exactly one connection, remove it (1:1
 *             mode). If absent and the entity has 2+ connections, return
 *             400 ("ambiguous, specify list_id"). New callers should
 *             always pass list_id.
 *   LIST_CONNECTIONS_FOR_LIST — "where is my X list connected?" Returns
 *             the list of entity_type+entity_id rows (caller resolves
 *             names).
 *   LIST_CONNECTIONS_FOR_ENTITY — "what lists are on my Y?" Returns
 *             `lists: [{id, name, category}, ...]` (array, possibly empty).
 *             Back-compat: also returns `list: lists[0] ?? null` so old
 *             callers that read `list` keep working through the transition.
 *   DELETE_LIST_AND_CONNECTIONS — atomic: delete the lists row; the FK
 *             ON DELETE CASCADE on list_connections cleans up all wirings.
 *             Returns the list of entities that WERE connected so the
 *             orchestrator's warning prompt can list them before calling.
 *             (Caller is expected to have already shown the warning + got
 *             user confirmation per spec; this endpoint just executes.)
 *
 * Auth: standard CLAUDE.md Rule 4 user-id resolution chain.
 *
 * Spec: docs/F1A_LISTS_AND_CONNECTIONS_SPEC.md (locked 2026-05-09).
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_ENTITY_TYPES = new Set([
  'action_rule', 'calendar_event', 'gmail_message', 'contact',
  'document', 'reminder', 'sent_message', 'knowledge_fragment', 'list',
]);

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Wave 2.6 — Drive↔DB hard sync. Trash the Drive Doc for a list
// BEFORE the DB row is deleted, so they never diverge. Pattern
// mirrors update-drive-file's auth + token-refresh flow.
//
// Returns { ok: true } if the file was trashed OR already gone
// (404 — treated as graceful no-op so orphan-cleanup deletes
// succeed). Returns { ok: false, reason } otherwise.
async function trashDriveFile(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  fileId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!fileId) return { ok: true };  // nothing to trash

  // Fetch Google refresh token for this user (service-role read).
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .maybeSingle();
  if (tokenErr) return { ok: false, reason: `token_lookup_failed: ${tokenErr.message}` };
  if (!tokenRow || !(tokenRow as any).refresh_token) {
    // No Google token — skip Drive trash, proceed with DB delete.
    // Drive file may become orphaned but user can't authenticate to clean it up anyway.
    console.warn(`[manage-list-connections] no Google token for user ${userId} — skipping Drive trash, proceeding with DB delete`);
    return { ok: true };
  }

  // Exchange refresh token for an access token.
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: (tokenRow as any).refresh_token,
      grant_type:    'refresh_token',
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    // Token expired/revoked — skip Drive trash, proceed with DB delete.
    // Orphaned Drive file is better than blocking list deletion.
    console.warn(`[manage-list-connections] Google token refresh failed for user ${userId} — skipping Drive trash, proceeding with DB delete: ${JSON.stringify(tokenJson).slice(0, 200)}`);
    return { ok: true };
  }

  // Drive API — files.update with trashed=true. Reversible from Drive
  // UI within 30 days. We deliberately don't hard-delete; user picked
  // trash for safety (Wave 2.6, Wael 2026-05-13).
  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`,
    {
      method:  'PATCH',
      headers: {
        'Authorization': `Bearer ${tokenJson.access_token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ trashed: true }),
    },
  );

  if (driveRes.ok) return { ok: true };

  // 404 — file already gone. Treat as success so the orphaned DB row
  // can still be cleaned up (the divergence is healing itself).
  if (driveRes.status === 404) return { ok: true };

  // 401/403 — token lacks Drive scope or file permission denied.
  // Orphaned Drive file is better than blocking list deletion.
  if (driveRes.status === 401 || driveRes.status === 403) {
    console.warn(`[manage-list-connections] Drive trash returned ${driveRes.status} for user ${userId} — skipping trash, proceeding with DB delete`);
    return { ok: true };
  }

  const errText = await driveRes.text();
  return { ok: false, reason: `drive_${driveRes.status}: ${errText.slice(0, 200)}` };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function resolveUserId(
  supabase: ReturnType<typeof createClient>,
  authHeader: string | null,
  bodyUserId: string | null,
): Promise<string | null> {
  if (authHeader) {
    try {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) return user.id;
    } catch (_) { /* ignore */ }
  }
  if (bodyUserId) return bodyUserId;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return jsonResponse({ error: 'POST required' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'invalid JSON' }, 400); }

  const userId = await resolveUserId(supabase, req.headers.get('Authorization'), body?.user_id ?? null);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const op = String(body?.type ?? body?.operation ?? '').toUpperCase();

  try {
    switch (op) {
      case 'CONNECT':                       return await handleConnect(supabase, userId, body);
      case 'DISCONNECT':                    return await handleDisconnect(supabase, userId, body);
      case 'LIST_CONNECTIONS_FOR_LIST':     return await handleListForList(supabase, userId, body);
      case 'LIST_CONNECTIONS_FOR_ENTITY':   return await handleListForEntity(supabase, userId, body);
      case 'DELETE_LIST_AND_CONNECTIONS':   return await handleDeleteList(supabase, userId, body);
      case 'PERMANENTLY_DELETE_LIST':       return await handlePermanentDeleteList(supabase, userId, body);
      default:
        return jsonResponse({ error: `unknown operation: ${op}` }, 400);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[manage-list-connections] ${op} error:`, msg);
    return jsonResponse({ error: msg }, 500);
  }
});

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleConnect(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: any,
) {
  const listId     = String(body?.list_id     ?? '').trim();
  const entityType = String(body?.entity_type ?? '').trim();
  const entityId   = String(body?.entity_id   ?? '').trim();

  if (!listId)     return jsonResponse({ error: 'list_id required' }, 400);
  if (!entityType) return jsonResponse({ error: 'entity_type required' }, 400);
  if (!entityId)   return jsonResponse({ error: 'entity_id required' }, 400);
  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    return jsonResponse({ error: `unknown entity_type: ${entityType}` }, 400);
  }

  // Verify the user owns the list.
  const { data: listRow, error: listErr } = await supabase
    .from('lists')
    .select('id')
    .eq('id', listId)
    .eq('user_id', userId)
    .maybeSingle();
  if (listErr || !listRow) {
    return jsonResponse({ error: 'list not found or not owned by user' }, 404);
  }

  // Wave 2.5 M:N — no delete-prior. Multiple lists can attach to the
  // same entity. UNIQUE(list_id, entity_type, entity_id) blocks the
  // accidental same-list-twice case; we catch the 23505 and return a
  // friendly "already attached" response instead of a 500.
  const { data: inserted, error: insertErr } = await supabase
    .from('list_connections')
    .insert({
      user_id:     userId,
      list_id:     listId,
      entity_type: entityType,
      entity_id:   entityId,
    })
    .select('id, list_id, entity_type, entity_id, created_at')
    .single();
  if (insertErr) {
    // 23505 = unique_violation. The (list, entity) pair is already wired.
    if ((insertErr as any).code === '23505') {
      return jsonResponse({ success: false, error: 'already_attached', list_id: listId, entity_type: entityType, entity_id: entityId }, 409);
    }
    console.error('[manage-list-connections] CONNECT insert error:', insertErr.message);
    return jsonResponse({ error: insertErr.message }, 500);
  }

  return jsonResponse({ success: true, connection: inserted });
}

async function handleDisconnect(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: any,
) {
  const listId     = String(body?.list_id     ?? '').trim();
  const entityType = String(body?.entity_type ?? '').trim();
  const entityId   = String(body?.entity_id   ?? '').trim();

  if (!entityType) return jsonResponse({ error: 'entity_type required' }, 400);
  if (!entityId)   return jsonResponse({ error: 'entity_id required' }, 400);

  // Wave 2.5 M:N — when list_id is provided, target exactly that
  // connection. Otherwise, back-compat: if the entity has exactly
  // one connection, remove it (matches old 1:1 behavior). If 2+
  // connections exist and list_id is absent, refuse and return
  // 400 with `attached_list_ids` so the caller can disambiguate
  // (re-prompt the user / pass the right list_id).
  if (listId) {
    const { data: deleted, error } = await supabase
      .from('list_connections')
      .delete()
      .eq('user_id',     userId)
      .eq('list_id',     listId)
      .eq('entity_type', entityType)
      .eq('entity_id',   entityId)
      .select('id, list_id');
    if (error) {
      console.error('[manage-list-connections] DISCONNECT (with list_id) error:', error.message);
      return jsonResponse({ error: error.message }, 500);
    }
    return jsonResponse({ success: true, removed: Array.isArray(deleted) ? deleted.length : 0 });
  }

  // No list_id given — count first.
  const { data: existing, error: countErr } = await supabase
    .from('list_connections')
    .select('id, list_id')
    .eq('user_id',     userId)
    .eq('entity_type', entityType)
    .eq('entity_id',   entityId);
  if (countErr) {
    console.error('[manage-list-connections] DISCONNECT count error:', countErr.message);
    return jsonResponse({ error: countErr.message }, 500);
  }
  const rows = Array.isArray(existing) ? existing : [];

  if (rows.length === 0) {
    // Nothing to remove — idempotent success.
    return jsonResponse({ success: true, removed: 0 });
  }
  if (rows.length > 1) {
    return jsonResponse({
      success:           false,
      error:             'ambiguous_disconnect_needs_list_id',
      attached_list_ids: rows.map(r => (r as any).list_id),
    }, 400);
  }

  // Exactly one connection — remove it (1:1 back-compat path).
  const { data: deleted, error: delErr } = await supabase
    .from('list_connections')
    .delete()
    .eq('user_id',     userId)
    .eq('entity_type', entityType)
    .eq('entity_id',   entityId)
    .select('id, list_id');
  if (delErr) {
    console.error('[manage-list-connections] DISCONNECT (back-compat) error:', delErr.message);
    return jsonResponse({ error: delErr.message }, 500);
  }
  return jsonResponse({ success: true, removed: Array.isArray(deleted) ? deleted.length : 0 });
}

async function handleListForList(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: any,
) {
  const listId = String(body?.list_id ?? '').trim();
  if (!listId) return jsonResponse({ error: 'list_id required' }, 400);

  const { data, error } = await supabase
    .from('list_connections')
    .select('id, entity_type, entity_id, created_at')
    .eq('user_id', userId)
    .eq('list_id', listId)
    .order('created_at', { ascending: false });
  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ success: true, connections: data ?? [] });
}

async function handleListForEntity(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: any,
) {
  const entityType = String(body?.entity_type ?? '').trim();
  const entityId   = String(body?.entity_id   ?? '').trim();
  if (!entityType) return jsonResponse({ error: 'entity_type required' }, 400);
  if (!entityId)   return jsonResponse({ error: 'entity_id required' }, 400);

  // Wave 2.5 M:N — return ALL lists attached to the entity (array,
  // not maybeSingle). Embedded select pulls each list's id/name/
  // category via the FK list_connections.list_id → lists.id in one
  // round-trip.
  const { data: rows, error: rowsErr } = await supabase
    .from('list_connections')
    .select('id, list_id, created_at, lists(id, name, category)')
    .eq('user_id',     userId)
    .eq('entity_type', entityType)
    .eq('entity_id',   entityId)
    .order('created_at', { ascending: true });
  if (rowsErr) return jsonResponse({ error: rowsErr.message }, 500);

  const lists = (Array.isArray(rows) ? rows : [])
    .map((r: any) => r?.lists ? { id: String(r.lists.id), name: String(r.lists.name ?? ''), category: String(r.lists.category ?? '') } : null)
    .filter((l: any) => l !== null);

  // Back-compat: also expose `list: lists[0] ?? null` so callers from
  // before Wave 2.5 keep working through the transition window. New
  // callers (mobile orchestrator + voice server post-2.5) read `lists`.
  return jsonResponse({
    success: true,
    lists,
    list:           lists[0] ?? null,
    connection_id: (Array.isArray(rows) && rows[0]) ? (rows[0] as any).id : null,
  });
}

// handleDeleteList — SOFT DISABLE (2026-05-25 B4z parity with action_rules).
//
// Sets enabled=false on the list row. Drive Doc and list_connections are
// preserved so the user can Reactivate later. This matches the lifecycle of
// disabled action_rules (fired one-shot alerts that are grayed out until
// Reactivated).
//
// For permanent deletion of an already-disabled list use PERMANENTLY_DELETE_LIST.
async function handleDeleteList(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: any,
) {
  const listId = String(body?.list_id ?? '').trim();
  if (!listId) return jsonResponse({ error: 'list_id required' }, 400);

  const { data: listRow, error: lookupErr } = await supabase
    .from('lists')
    .select('id, name, drive_file_id')
    .eq('id',      listId)
    .eq('user_id', userId)
    .maybeSingle();
  if (lookupErr) return jsonResponse({ error: lookupErr.message }, 500);
  if (!listRow)  return jsonResponse({ error: 'list not found or not owned by user' }, 404);

  // Capture connections for the informational return. They are NOT deleted —
  // preserved so Reactivate restores the full list + attachments.
  const { data: connections } = await supabase
    .from('list_connections')
    .select('entity_type, entity_id')
    .eq('user_id', userId)
    .eq('list_id', listId);

  // Soft-disable — flip enabled=false. No Drive trash. No cascade delete.
  const { error: updateErr } = await supabase
    .from('lists')
    .update({ enabled: false })
    .eq('id',      listId)
    .eq('user_id', userId);
  if (updateErr) {
    console.error(`[manage-list-connections] DELETE_LIST soft-disable error: ${updateErr.message}`);
    return jsonResponse({ success: false, error: updateErr.message }, 500);
  }

  console.log(`[manage-list-connections] Soft-disabled list "${(listRow as any).name}" (${listId}); ${(connections ?? []).length} connections preserved`);
  return jsonResponse({
    success: true,
    // Back-compat: callers that read deleted_list keep working.
    deleted_list:         listRow,
    disabled_list:        listRow,
    // Connections preserved (not cascaded) but returned for display.
    cascaded_connections: connections ?? [],
  });
}

// handlePermanentDeleteList — HARD DELETE (Drive trash + DB row + cascade).
//
// Called only when the user explicitly taps "Delete permanently" on an already-
// disabled list. Mirrors the old handleDeleteList behavior.
async function handlePermanentDeleteList(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: any,
) {
  const listId = String(body?.list_id ?? '').trim();
  if (!listId) return jsonResponse({ error: 'list_id required' }, 400);

  const { data: listRow, error: lookupErr } = await supabase
    .from('lists')
    .select('id, name, drive_file_id')
    .eq('id',      listId)
    .eq('user_id', userId)
    .maybeSingle();
  if (lookupErr) return jsonResponse({ error: lookupErr.message }, 500);
  if (!listRow)  return jsonResponse({ error: 'list not found or not owned by user' }, 404);

  const { data: connections } = await supabase
    .from('list_connections')
    .select('entity_type, entity_id')
    .eq('user_id', userId)
    .eq('list_id', listId);

  // Trash the Drive Doc first so DB and Drive stay aligned.
  const driveResult = await trashDriveFile(supabase, userId, String((listRow as any).drive_file_id ?? ''));
  if (!driveResult.ok) {
    console.error(`[manage-list-connections] PERMANENTLY_DELETE_LIST aborted — drive trash failed: ${driveResult.reason}`);
    return jsonResponse({
      success: false,
      error:   'drive_trash_failed',
      reason:  driveResult.reason,
      hint:    'Drive doc could not be trashed; list NOT deleted. Reconnect Google in Settings and retry.',
    }, 500);
  }

  // Hard delete. FK ON DELETE CASCADE removes list_connections.
  const { error: deleteErr, data: deleted } = await supabase
    .from('lists')
    .delete()
    .eq('id',      listId)
    .eq('user_id', userId)
    .select('id, name');
  if (deleteErr) {
    console.error(`[manage-list-connections] PERMANENTLY_DELETE_LIST DB error after Drive trash: ${deleteErr.message}`);
    return jsonResponse({ success: false, error: 'db_delete_failed_after_drive_trash', reason: deleteErr.message }, 500);
  }
  if (!Array.isArray(deleted) || deleted.length === 0) {
    return jsonResponse({ error: 'list not found or not owned by user' }, 404);
  }

  console.log(`[manage-list-connections] Permanently deleted list "${(deleted[0] as any).name}" (${listId})`);
  return jsonResponse({
    success: true,
    deleted_list:         deleted[0],
    cascaded_connections: connections ?? [],
  });
}
