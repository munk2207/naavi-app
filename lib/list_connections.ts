/**
 * Mobile mirror of the voice-server's F1a list-connection helpers.
 *
 * Voice surface uses thin raw-fetch wrappers (`_f1aResolve`,
 * `_f1aPickMatch`, `_f1aManageConnections`, `_f1aDescribe`) in
 * `naavi-voice-server/src/index.js`. This module re-expresses the
 * same logic for the mobile orchestrator, using `invokeWithTimeout`
 * so it follows the established mobile pattern (JWT auth, timeouts,
 * error shapes) instead of raw fetch + service-role.
 *
 * Single source of truth on the mobile side — `useOrchestrator.ts`
 * imports these for LIST_CONNECT / LIST_DISCONNECT /
 * LIST_CONNECTION_QUERY / LIST_DELETE. Keeps the resolver scoring +
 * ambiguity rule in one place so it can't drift between calls.
 */

import { invokeWithTimeout } from './invokeWithTimeout';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ResolverMatch {
  entity_type: string;
  entity_id:   string;
  label:       string;
  hint?:       string | null;
  score:       number;
}

export interface PickResultNone      { kind: 'none' }
export interface PickResultOne       { kind: 'one'; match: ResolverMatch }
export interface PickResultAmbiguous { kind: 'ambiguous'; tied: ResolverMatch[] }
export type   PickResult = PickResultNone | PickResultOne | PickResultAmbiguous;

export interface ConnectionRow {
  entity_type: string;
  entity_id:   string;
  label?:      string;
  hint?:       string | null;
}

// Wave 2.5 M:N — what_list_is_on returns an array (can be 0, 1, or many).
// `list` (singular) kept as a back-compat alias = lists[0] when present.
export interface AttachedList { id: string; name: string; category?: string }

export type ConnectionQueryResult =
  | { success: true;  mode: 'where_is_list';     list_label: string;     connections: ConnectionRow[] }
  | { success: true;  mode: 'what_list_is_on';   entity_label: string;   lists: AttachedList[]; list: AttachedList | null }
  | { success: false; error: string };

// ─── Low-level wrappers (mirror voice `_f1a*`) ─────────────────────────────

async function resolveEntityRef(entityType: string, entityRef: string): Promise<any> {
  const { data, error } = await invokeWithTimeout('resolve-entity-ref', {
    body: { type: 'RESOLVE', entity_type: entityType, entity_ref: entityRef },
  }, 15_000);
  if (error) return { error: error.message };
  return data ?? {};
}

async function describeEntity(entityType: string, entityId: string): Promise<any> {
  const { data, error } = await invokeWithTimeout('resolve-entity-ref', {
    body: { type: 'DESCRIBE', entity_type: entityType, entity_id: entityId },
  }, 15_000);
  if (error) return { error: error.message };
  return data ?? {};
}

async function manageConnections(payload: any): Promise<any> {
  const { data, error } = await invokeWithTimeout('manage-list-connections', {
    body: payload,
  }, 20_000);
  if (error) return { success: false, error: error.message };
  return data ?? { success: false, error: 'empty response' };
}

// pickResolverResult — mirror of voice `_f1aPickMatch`. The resolver
// returns matches ranked by score (desc). Top-score TIE = ambiguous;
// otherwise the top match wins even if lower-scored ones exist.
export function pickResolverMatch(matches: ResolverMatch[] | undefined | null): PickResult {
  if (!matches || matches.length === 0) return { kind: 'none' };
  const topScore = matches[0].score;
  const tied = matches.filter(m => m.score === topScore);
  if (tied.length > 1) return { kind: 'ambiguous', tied };
  return { kind: 'one', match: matches[0] };
}

// ─── High-level action helpers (one per LIST_* mobile action) ──────────────

export interface ConnectResult {
  success:        boolean;
  error?:         string;
  listLabel?:     string;
  entityLabel?:   string;
  candidates?:    ResolverMatch[];
}

export async function connectList(
  listName: string, entityRef: string, entityType: string,
): Promise<ConnectResult> {
  if (!listName || !entityRef || !entityType) {
    return { success: false, error: 'listName, entityRef, and entityType all required' };
  }

  const listRes  = await resolveEntityRef('list', listName);
  if (listRes?.error) return { success: false, error: `list_resolve_failed: ${listRes.error}` };
  const listPick = pickResolverMatch(listRes?.matches);
  if (listPick.kind === 'none')      return { success: false, error: 'list_not_found' };
  if (listPick.kind === 'ambiguous') return { success: false, error: 'list_ambiguous', candidates: listPick.tied };

  const entRes  = await resolveEntityRef(entityType, entityRef);
  if (entRes?.unsupported_in_v1) return { success: false, error: 'entity_type_unsupported_in_v1' };
  if (entRes?.error)             return { success: false, error: `entity_resolve_failed: ${entRes.error}` };
  const entPick = pickResolverMatch(entRes?.matches);
  if (entPick.kind === 'none')      return { success: false, error: 'entity_not_found' };
  if (entPick.kind === 'ambiguous') return { success: false, error: 'entity_ambiguous', candidates: entPick.tied };

  const data = await manageConnections({
    type:        'CONNECT',
    list_id:     listPick.match.entity_id,
    entity_type: entityType,
    entity_id:   entPick.match.entity_id,
  });
  if (!data?.success) return { success: false, error: data?.error || 'manage_connections_failed' };
  return { success: true, listLabel: listPick.match.label, entityLabel: entPick.match.label };
}

export interface DisconnectResult {
  success:      boolean;
  error?:       string;
  entityLabel?: string;
  removed?:     number;
  candidates?:  ResolverMatch[];
}

// disconnectEntityById — UI-side detach when we already know the
// entity_id (e.g. row in list-detail screen, or X button in alert-
// detail). Wave 2.5 M:N: `listId` is now REQUIRED (entity can have
// multiple lists, so we must name which one to remove). UI code
// always knows the listId — it rendered the row that's being X'd.
export async function disconnectEntityById(
  listId: string, entityType: string, entityId: string,
): Promise<DisconnectResult> {
  if (!listId)     return { success: false, error: 'listId required' };
  if (!entityType) return { success: false, error: 'entityType required' };
  if (!entityId)   return { success: false, error: 'entityId required' };
  const data = await manageConnections({
    type:        'DISCONNECT',
    list_id:     listId,
    entity_type: entityType,
    entity_id:   entityId,
  });
  if (!data?.success) return { success: false, error: data?.error || 'manage_connections_failed' };
  return { success: true, removed: Number(data.removed ?? 0) };
}

// disconnectEntity — orchestrator path. Claude emits natural-language
// listName + entityRef; we resolve both and call manage-list-connections
// with the resolved list_id (Wave 2.5 — entity can carry multiple lists,
// so list_id is now part of the disambiguation key). listName is
// REQUIRED per prompt v73; the Edge Function still has a back-compat
// path for entity-with-single-connection callers.
export async function disconnectEntity(
  listName: string, entityRef: string, entityType: string,
): Promise<DisconnectResult & { listLabel?: string }> {
  if (!entityRef || !entityType) {
    return { success: false, error: 'entityRef and entityType required' };
  }
  const entRes  = await resolveEntityRef(entityType, entityRef);
  if (entRes?.unsupported_in_v1) return { success: false, error: 'entity_type_unsupported_in_v1' };
  if (entRes?.error)             return { success: false, error: `entity_resolve_failed: ${entRes.error}` };
  const entPick = pickResolverMatch(entRes?.matches);
  if (entPick.kind === 'none')      return { success: false, error: 'entity_not_found' };
  if (entPick.kind === 'ambiguous') return { success: false, error: 'entity_ambiguous', candidates: entPick.tied };

  let listId: string | null = null;
  let listLabel: string | undefined;
  if (listName) {
    const listRes  = await resolveEntityRef('list', listName);
    if (listRes?.error) return { success: false, error: `list_resolve_failed: ${listRes.error}` };
    const listPick = pickResolverMatch(listRes?.matches);
    if (listPick.kind === 'none')      return { success: false, error: 'list_not_found' };
    if (listPick.kind === 'ambiguous') return { success: false, error: 'list_ambiguous', candidates: listPick.tied };
    listId    = listPick.match.entity_id;
    listLabel = listPick.match.label;
  }

  const payload: any = {
    type:        'DISCONNECT',
    entity_type: entityType,
    entity_id:   entPick.match.entity_id,
  };
  if (listId) payload.list_id = listId;

  const data = await manageConnections(payload);
  if (!data?.success) return { success: false, error: data?.error || 'manage_connections_failed' };
  return {
    success:     true,
    entityLabel: entPick.match.label,
    listLabel,
    removed:     Number(data.removed ?? 0),
  };
}

export async function queryListConnections(args: {
  mode: 'where_is_list' | 'what_list_is_on';
  listName?:   string;
  entityRef?:  string;
  entityType?: string;
}): Promise<ConnectionQueryResult> {
  if (args.mode === 'where_is_list') {
    if (!args.listName) return { success: false, error: 'listName required for where_is_list' };
    const listRes  = await resolveEntityRef('list', args.listName);
    if (listRes?.error) return { success: false, error: `list_resolve_failed: ${listRes.error}` };
    const listPick = pickResolverMatch(listRes?.matches);
    if (listPick.kind === 'none')      return { success: false, error: 'list_not_found' };
    if (listPick.kind === 'ambiguous') return { success: false, error: 'list_ambiguous' };

    const data = await manageConnections({
      type:    'LIST_CONNECTIONS_FOR_LIST',
      list_id: listPick.match.entity_id,
    });
    const rows: ConnectionRow[] = data?.connections ?? [];
    // Resolve human labels in parallel — mirrors voice `_f1aDescribe` loop.
    const described = await Promise.all(rows.map(async (c) => {
      const d = await describeEntity(c.entity_type, c.entity_id);
      return {
        entity_type: c.entity_type,
        entity_id:   c.entity_id,
        label:       d?.label || `(${c.entity_type})`,
        hint:        d?.hint || null,
      };
    }));
    return { success: true, mode: 'where_is_list', list_label: listPick.match.label, connections: described };
  }

  if (args.mode === 'what_list_is_on') {
    if (!args.entityRef || !args.entityType) {
      return { success: false, error: 'entityRef and entityType required for what_list_is_on' };
    }
    const entRes  = await resolveEntityRef(args.entityType, args.entityRef);
    if (entRes?.unsupported_in_v1) return { success: false, error: 'entity_type_unsupported_in_v1' };
    if (entRes?.error)             return { success: false, error: `entity_resolve_failed: ${entRes.error}` };
    const entPick = pickResolverMatch(entRes?.matches);
    if (entPick.kind === 'none')      return { success: false, error: 'entity_not_found' };
    if (entPick.kind === 'ambiguous') return { success: false, error: 'entity_ambiguous' };

    const data = await manageConnections({
      type:        'LIST_CONNECTIONS_FOR_ENTITY',
      entity_type: args.entityType,
      entity_id:   entPick.match.entity_id,
    });
    // Wave 2.5 M:N — `lists: [...]` is canonical; `list` back-compat field.
    const lists: AttachedList[] = Array.isArray(data?.lists)
      ? data.lists.map((l: any) => ({ id: String(l.id), name: String(l.name ?? ''), category: l.category ? String(l.category) : undefined }))
      : (data?.list ? [{ id: String(data.list.id), name: String(data.list.name ?? ''), category: data.list.category ? String(data.list.category) : undefined }] : []);
    return {
      success:      true,
      mode:         'what_list_is_on',
      entity_label: entPick.match.label,
      lists,
      list:         lists[0] ?? null,
    };
  }

  return { success: false, error: `unknown mode: ${(args as any).mode}` };
}

export interface DeleteListResult {
  success:           boolean;
  error?:            string;
  listLabel?:        string;
  cascadedCount?:    number;
  candidates?:       ResolverMatch[];
}

// formatConnectionQueryResult — mobile mirror of the voice server's
// _f1aFormatConnectionQuery. Turns a LIST_CONNECTION_QUERY result into
// the assistant chat-bubble text. V57.15.0 shipped the orchestrator
// handler but never injected the answer into chat — Claude said "I'll
// check..." and then went silent. V57.15.1 fix: orchestrator calls this
// and sets turnSpeechOverride to the returned string. Same numbered-
// list shape as the voice surface (Wave 2.5 / 2.6).
export function formatConnectionQueryResult(
  result: ConnectionQueryResult,
  fallback: { listName?: string; entityRef?: string } = {},
): string {
  if (!result.success) {
    if (result.error === 'list_not_found')   return `I don't see a ${fallback.listName || 'matching'} list.`;
    if (result.error === 'entity_not_found') return `I don't see ${fallback.entityRef || 'that'}.`;
    if (result.error === 'list_ambiguous')   return `You have more than one list called ${fallback.listName || 'that'}. Which one do you mean?`;
    if (result.error === 'entity_ambiguous') return `You have more than one match for ${fallback.entityRef || 'that'}. Which one do you mean?`;
    return `I couldn't check that.`;
  }

  // Wael 2026-05-13: multi-item answers use newlines between items, not
  // a single comma-paragraph. Two reasons:
  //   1. Visually clearer (each list name on its own line — matches the
  //      earlier voice-side feedback "should be a numbered list").
  //   2. Forces the bubble out of the Yoga truncation zone — content
  //      that's "longer than 1 line but doesn't fill line 2" was getting
  //      its tail clipped. Newlines make multi-item answers ALWAYS span
  //      3+ visible lines, escaping the truncation regime.
  // TTS works the same — Aura Hera pauses on '\n' just like on '.'.
  if (result.mode === 'where_is_list') {
    const listLabel = result.list_label || fallback.listName || 'that list';
    const conns = result.connections || [];
    if (conns.length === 0) return `Your ${listLabel} list isn't attached to anything.`;
    if (conns.length === 1) return `Your ${listLabel} list is attached to ${conns[0].label}.`;
    const numbered = conns.map((c, i) => `${i + 1}. ${c.label}`).join('\n');
    return `Your ${listLabel} list is attached to ${conns.length} items.\n${numbered}`;
  }

  // mode === 'what_list_is_on'
  const entityLabel = result.entity_label || fallback.entityRef || 'that';
  const lists = result.lists || [];
  if (lists.length === 0) return `There's no list on ${entityLabel}.`;
  if (lists.length === 1) return `${entityLabel} has your ${lists[0].name} list on it.`;
  const numbered = lists.map((l, i) => `${i + 1}. ${l.name}`).join('\n');
  return `${entityLabel} has ${lists.length} lists attached.\n${numbered}`;
}

export async function deleteListWithConnections(listName: string): Promise<DeleteListResult> {
  if (!listName) return { success: false, error: 'listName required' };

  const listRes  = await resolveEntityRef('list', listName);
  if (listRes?.error) return { success: false, error: `list_resolve_failed: ${listRes.error}` };
  const listPick = pickResolverMatch(listRes?.matches);
  if (listPick.kind === 'none')      return { success: false, error: 'list_not_found' };
  if (listPick.kind === 'ambiguous') return { success: false, error: 'list_ambiguous', candidates: listPick.tied };

  // Per F1a spec: Claude has ALREADY shown the cascade-warning and got
  // user confirmation before emitting this action. The mobile send-button
  // press IS the confirmation gate. We just execute.
  const data = await manageConnections({
    type:    'DELETE_LIST_AND_CONNECTIONS',
    list_id: listPick.match.entity_id,
  });
  if (!data?.success) return { success: false, error: data?.error || 'manage_connections_failed' };
  return {
    success:       true,
    listLabel:     listPick.match.label,
    cascadedCount: Array.isArray(data.cascaded_connections) ? data.cascaded_connections.length : 0,
  };
}

// permanentlyDeleteListById — UI path for hard-deleting an already-disabled
// list. Called from the "Delete permanently" button on a disabled list's
// detail screen. Calls the PERMANENTLY_DELETE_LIST op which:
//   - Trashes the Drive Doc
//   - Hard-deletes the lists row (FK cascade removes list_connections)
export interface PermanentDeleteResult {
  success:        boolean;
  error?:         string;
  listLabel?:     string;
  cascadedCount?: number;
}

export async function permanentlyDeleteListById(listId: string): Promise<PermanentDeleteResult> {
  if (!listId) return { success: false, error: 'listId required' };
  const data = await manageConnections({
    type:    'PERMANENTLY_DELETE_LIST',
    list_id: listId,
  });
  if (!data?.success) return { success: false, error: data?.error || 'manage_connections_failed' };
  return {
    success:       true,
    listLabel:     (data.deleted_list as any)?.name,
    cascadedCount: Array.isArray(data.cascaded_connections) ? data.cascaded_connections.length : 0,
  };
}

// 2026-05-20 (Wael / B4j fix) — eager list + connection creation for the
// legacy `action_config.list_name` pattern.
//
// Today the SET_ACTION_RULE handler in useOrchestrator.ts inserts a rule
// row with `action_config.list_name = "X"` whenever Claude emits that
// shape (instead of the F1a LIST_CONNECT path). The fan-out at fire time
// reads `list_name` and looks up the list — if the list doesn't exist,
// the alert says "Your X list is empty." even though X has no backing
// row to populate.
//
// Hussein's "work todo" arrival alert today (2026-05-20 08:50 AM EST)
// is the canonical instance: rule referenced a list called "work todo"
// that he had never created.
//
// This helper makes the legacy path self-consistent:
//   - Resolve list by name. If found, use that list_id.
//   - If not found, create an empty list with that name.
//   - Insert into list_connections (idempotent — uniqueness enforced by
//     the DB constraint added in 20260511_list_connections.sql).
//
// Idempotent at every step — safe to call multiple times for the same
// rule + list pair.
export interface EnsureListResult {
  success:    boolean;
  listId?:    string;
  listLabel?: string;
  created?:   boolean;
  error?:     string;
}
export async function ensureListAttachedToRule(
  ruleId:   string,
  listName: string,
): Promise<EnsureListResult> {
  const cleanName = String(listName ?? '').trim();
  if (!ruleId)    return { success: false, error: 'ruleId required' };
  if (!cleanName) return { success: false, error: 'listName required' };

  // 1. Try to resolve an existing list with this name.
  let listId: string | null = null;
  let listLabel = cleanName;
  let created = false;

  const listRes  = await resolveEntityRef('list', cleanName);
  if (!listRes?.error) {
    const listPick = pickResolverMatch(listRes?.matches);
    if (listPick.kind === 'one') {
      listId    = listPick.match.entity_id;
      listLabel = listPick.match.label;
    }
    // Ambiguous: take the top match by score; the resolver already sorts
    // descending. For an eager-create path we prefer "use the closest
    // match" over "block the rule creation" since the user said the
    // name and Naavi assumes good faith. Edge cases (two lists with
    // the exact same name) are vanishingly rare and the user can
    // re-attach via the Lists UI.
    if (listPick.kind === 'ambiguous' && listPick.tied[0]) {
      listId    = listPick.tied[0].entity_id;
      listLabel = listPick.tied[0].label;
    }
  }

  // 2. If no existing list, create one via manage-list LIST_CREATE.
  // manage-list creates the backing Drive doc + the metadata row in `lists`
  // (drive_file_id is NOT NULL so we cannot bypass Drive). If the user has
  // no Google token (revoked / never connected), this step fails with
  // "No Google access token" and we surface that to the caller — the rule
  // still got created above; the user just won't have an attached list
  // until they reconnect Google.
  if (!listId) {
    const { data: createRes, error: createErr } = await invokeWithTimeout('manage-list', {
      body: { type: 'LIST_CREATE', name: cleanName },
    }, 15_000);
    if (createErr) return { success: false, error: `list_create_failed: ${createErr.message}` };
    if ((createRes as any)?.success === false) {
      return { success: false, error: `list_create_failed: ${(createRes as any)?.error ?? 'unknown'}` };
    }
    listId    = String((createRes as any)?.list?.id ?? (createRes as any)?.id ?? '');
    listLabel = String((createRes as any)?.list?.name ?? cleanName);
    created   = true;
    if (!listId) {
      // manage-list LIST_CREATE returns the list metadata WITHOUT id in some
      // paths (the response shape includes name + drive_file_id + web_view_link
      // but not id when created fresh). Re-resolve to get the id.
      const reRes  = await resolveEntityRef('list', cleanName);
      const rePick = pickResolverMatch(reRes?.matches);
      if (rePick.kind === 'one') {
        listId = rePick.match.entity_id;
        listLabel = rePick.match.label;
      }
    }
    if (!listId) return { success: false, error: 'list_create_returned_no_id' };
  }

  // 3. Connect rule ↔ list. manage-list-connections CONNECT is idempotent
  // (unique constraint on (entity_type, entity_id, list_id)).
  const connectData = await manageConnections({
    type:        'CONNECT',
    list_id:     listId,
    entity_type: 'action_rule',
    entity_id:   ruleId,
  });
  if (!connectData?.success && connectData?.error && !/already|duplicate|unique|conflict/i.test(String(connectData.error))) {
    return { success: false, error: `connect_failed: ${connectData.error}`, listId, listLabel, created };
  }

  return { success: true, listId, listLabel, created };
}
