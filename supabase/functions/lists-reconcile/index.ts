/**
 * lists-reconcile Edge Function — Wave 2.6 Phase G (Wael 2026-05-13).
 *
 * Reverse Drive↔DB sync. For every `lists` row the user owns, check
 * whether the underlying Drive Doc still exists (not trashed, not
 * deleted). If the Drive file is gone, delete the `lists` row (FK ON
 * DELETE CASCADE drops the `list_connections` rows pointing at it,
 * so the divergence heals atomically).
 *
 * Called by:
 *   - Mobile Lists screen on every load (cheap when in-sync — one
 *     batch Drive API call per session).
 *   - Daily cron (Phase I — TODO) as a safety net.
 *
 * Returns:
 *   {
 *     success: true,
 *     checked: N,           // lists rows examined
 *     orphaned: [ {id, name, drive_file_id, reason}, ... ],   // removed rows
 *   }
 *
 * Auth: standard CLAUDE.md Rule 4 user-id resolution chain. Caller
 * must be the owner (JWT) or a service-role call (cron + voice
 * server pass user_id in body).
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

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

async function getAccessToken(refreshToken: string): Promise<string | null> {
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
  return data.access_token ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return jsonResponse({ error: 'POST required' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is allowed */ }

  const userId = await resolveUserId(supabase, req.headers.get('Authorization'), body?.user_id ?? null);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  // Fetch every list this user owns.
  const { data: lists, error: listsErr } = await supabase
    .from('lists')
    .select('id, name, drive_file_id')
    .eq('user_id', userId);
  if (listsErr) return jsonResponse({ error: listsErr.message }, 500);

  // ── Pure-DB sweep first (action_rule orphan connections) ──────────
  // Runs regardless of Google connectivity. The Drive-existence sweep
  // below short-circuits when Google isn't connected, but this sweep
  // is the safety net that catches orphans introduced by ungated DB
  // operations (manual SQL cleanups, deleted action_rules, etc.) and
  // shouldn't be gated on an unrelated OAuth state. Order matters.
  let staleConnections: Array<{ id: string; entity_type: string; entity_id: string }> = [];
  try {
    const { data: arConns } = await supabase
      .from('list_connections')
      .select('id, entity_id')
      .eq('user_id',     userId)
      .eq('entity_type', 'action_rule');

    if (Array.isArray(arConns) && arConns.length > 0) {
      const arEntityIds = (arConns as any[]).map(r => String(r.entity_id));
      const { data: liveRules } = await supabase
        .from('action_rules')
        .select('id')
        .in('id', arEntityIds);
      const liveIds = new Set((Array.isArray(liveRules) ? liveRules : []).map((r: any) => String(r.id)));
      const stale = (arConns as any[]).filter(r => !liveIds.has(String(r.entity_id)));
      if (stale.length > 0) {
        const staleIds = stale.map(r => String(r.id));
        const { error: delConnErr } = await supabase
          .from('list_connections')
          .delete()
          .eq('user_id', userId)
          .in('id', staleIds);
        if (delConnErr) {
          console.error(`[lists-reconcile] action_rule orphan-connection delete failed: ${delConnErr.message}`);
        } else {
          staleConnections = stale.map(r => ({ id: String(r.id), entity_type: 'action_rule', entity_id: String(r.entity_id) }));
          console.log(`[lists-reconcile] user=${userId.slice(0,8)}… removed ${stale.length} stale action_rule connections`);
        }
      }
    }
  } catch (err) {
    console.error(`[lists-reconcile] action_rule sweep threw: ${(err as Error).message}`);
  }

  // No lists at all? Nothing to Drive-check; return early with just
  // the action_rule sweep results.
  if (!Array.isArray(lists) || lists.length === 0) {
    return jsonResponse({ success: true, checked: 0, orphaned: [], stale_connections: staleConnections });
  }

  // Need a Drive access token for the Drive-existence sweep. If Google
  // isn't connected, skip Drive but still return the action_rule sweep
  // results above (success: true, drive_sweep_skipped). Surface a clear
  // `reason` so the UI doesn't silently fail.
  const { data: tokenRow } = await supabase
    .from('user_tokens')
    .select('refresh_token')
    .eq('user_id',  userId)
    .eq('provider', 'google')
    .maybeSingle();
  if (!tokenRow || !(tokenRow as any).refresh_token) {
    return jsonResponse({
      success:            true,
      drive_sweep_skipped: 'google_not_connected',
      checked:            0,
      orphaned:           [],
      stale_connections:  staleConnections,
    }, 200);
  }
  const accessToken = await getAccessToken((tokenRow as any).refresh_token);
  if (!accessToken) {
    return jsonResponse({
      success:            true,
      drive_sweep_skipped: 'token_refresh_failed',
      checked:            0,
      orphaned:           [],
      stale_connections:  staleConnections,
    }, 200);
  }

  // Check each list's Drive file in parallel. One HEAD per file — small.
  // Drive's `files.get` with fields=trashed returns 200 + trashed flag,
  // OR 404 if the file is gone.
  const checks = await Promise.all((lists as any[]).map(async (l) => {
    const fileId = String(l.drive_file_id ?? '').trim();
    if (!fileId) {
      // No drive_file_id stored — can't reconcile, leave row alone.
      return { id: l.id, name: l.name, drive_file_id: fileId, exists: true, reason: 'no_file_id' };
    }
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } },
      );
      if (res.status === 404) {
        return { id: l.id, name: l.name, drive_file_id: fileId, exists: false, reason: 'drive_404' };
      }
      if (!res.ok) {
        // Permission denied or transient — don't delete on the basis
        // of a non-404 error; could be rate-limit or scope issue.
        return { id: l.id, name: l.name, drive_file_id: fileId, exists: true, reason: `drive_${res.status}` };
      }
      const meta = await res.json();
      if (meta?.trashed) {
        return { id: l.id, name: l.name, drive_file_id: fileId, exists: false, reason: 'drive_trashed' };
      }
      return { id: l.id, name: l.name, drive_file_id: fileId, exists: true, reason: 'ok' };
    } catch (err) {
      return { id: l.id, name: l.name, drive_file_id: fileId, exists: true, reason: `fetch_err: ${(err as Error).message}` };
    }
  }));

  const orphans = checks.filter((c) => !c.exists);

  // Delete orphaned `lists` rows. FK ON DELETE CASCADE on
  // list_connections cleans up wirings automatically.
  if (orphans.length > 0) {
    const orphanIds = orphans.map((o) => o.id);
    const { error: deleteErr } = await supabase
      .from('lists')
      .delete()
      .eq('user_id', userId)
      .in('id', orphanIds);
    if (deleteErr) {
      console.error(`[lists-reconcile] orphan delete failed: ${deleteErr.message}`);
      return jsonResponse({ success: false, error: deleteErr.message, checked: lists.length, orphaned: orphans }, 500);
    }
    console.log(`[lists-reconcile] user=${userId.slice(0,8)}… checked=${lists.length} removed=${orphans.length}`);
  }

  return jsonResponse({
    success:            true,
    checked:            lists.length,
    orphaned:           orphans,
    stale_connections:  staleConnections,
  });
});
