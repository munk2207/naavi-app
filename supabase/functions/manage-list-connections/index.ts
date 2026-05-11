/**
 * manage-list-connections Edge Function — F1a (Wael 2026-05-11).
 *
 * CRUD over the list_connections table. Single write entry for the
 * cardinality rule "one list per entity, many entities per list."
 *
 * Operations:
 *   CONNECT — wire list_id ↔ entity. If the entity already has a connection,
 *             the prior row is replaced. Returns the new connection row.
 *   DISCONNECT — remove the connection by (entity_type, entity_id).
 *   LIST_CONNECTIONS_FOR_LIST — "where is my X list connected?" Returns the
 *             list of entity_type+entity_id rows (caller resolves names).
 *   LIST_CONNECTIONS_FOR_ENTITY — "what list is on my Y?" Returns the list
 *             (id+name+category) wired to a specific entity, or null.
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

  // Replace any existing connection on this entity (one-list-per-entity rule).
  // Same pattern as the pending-dwell-fires cancel-before-insert: cancels the
  // prior row, then inserts the new one. The DB UNIQUE index is the
  // final-line defense; the cancel-before-insert prevents user-visible
  // 409 errors when the orchestrator legitimately wants to swap.
  const { error: deleteErr } = await supabase
    .from('list_connections')
    .delete()
    .eq('entity_type', entityType)
    .eq('entity_id',   entityId);
  if (deleteErr) {
    console.error('[manage-list-connections] CONNECT delete-prior error:', deleteErr.message);
    return jsonResponse({ error: deleteErr.message }, 500);
  }

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
  const entityType = String(body?.entity_type ?? '').trim();
  const entityId   = String(body?.entity_id   ?? '').trim();

  if (!entityType) return jsonResponse({ error: 'entity_type required' }, 400);
  if (!entityId)   return jsonResponse({ error: 'entity_id required' }, 400);

  const { data: deleted, error } = await supabase
    .from('list_connections')
    .delete()
    .eq('user_id',     userId)
    .eq('entity_type', entityType)
    .eq('entity_id',   entityId)
    .select('id, list_id');
  if (error) {
    console.error('[manage-list-connections] DISCONNECT error:', error.message);
    return jsonResponse({ error: error.message }, 500);
  }

  const removed = Array.isArray(deleted) ? deleted.length : 0;
  return jsonResponse({ success: true, removed });
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

  const { data: conn, error: connErr } = await supabase
    .from('list_connections')
    .select('id, list_id, created_at')
    .eq('user_id', userId)
    .eq('entity_type', entityType)
    .eq('entity_id',   entityId)
    .maybeSingle();
  if (connErr) return jsonResponse({ error: connErr.message }, 500);
  if (!conn)   return jsonResponse({ success: true, list: null });

  const { data: list, error: listErr } = await supabase
    .from('lists')
    .select('id, name, category')
    .eq('id', (conn as any).list_id)
    .maybeSingle();
  if (listErr) return jsonResponse({ error: listErr.message }, 500);

  return jsonResponse({
    success: true,
    list: list ?? null,
    connection_id: (conn as any).id,
  });
}

async function handleDeleteList(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: any,
) {
  const listId = String(body?.list_id ?? '').trim();
  if (!listId) return jsonResponse({ error: 'list_id required' }, 400);

  // Capture connected entities BEFORE the cascade — return them so the
  // orchestrator's confirmation message can have listed them to the user
  // even though the cascade DELETE removes them at the DB layer.
  const { data: connections } = await supabase
    .from('list_connections')
    .select('entity_type, entity_id')
    .eq('user_id', userId)
    .eq('list_id', listId);

  // Delete the list. FK ON DELETE CASCADE on list_connections drops every
  // wiring for this list_id automatically.
  const { error: deleteErr, data: deleted } = await supabase
    .from('lists')
    .delete()
    .eq('id',      listId)
    .eq('user_id', userId)
    .select('id, name');
  if (deleteErr) return jsonResponse({ error: deleteErr.message }, 500);
  if (!Array.isArray(deleted) || deleted.length === 0) {
    return jsonResponse({ error: 'list not found or not owned by user' }, 404);
  }

  return jsonResponse({
    success: true,
    deleted_list: deleted[0],
    cascaded_connections: connections ?? [],
  });
}
