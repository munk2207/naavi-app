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

  if (result.mode === 'where_is_list') {
    const listLabel = result.list_label || fallback.listName || 'that list';
    const conns = result.connections || [];
    if (conns.length === 0) return `Your ${listLabel} list isn't attached to anything.`;
    if (conns.length === 1) return `Your ${listLabel} list is attached to ${conns[0].label}.`;
    const numbered = conns.map((c, i) => `${i + 1}. ${c.label}.`).join(' ');
    return `Your ${listLabel} list is attached to ${conns.length} items. ${numbered}`;
  }

  // mode === 'what_list_is_on'
  const entityLabel = result.entity_label || fallback.entityRef || 'that';
  const lists = result.lists || [];
  if (lists.length === 0) return `There's no list on ${entityLabel}.`;
  if (lists.length === 1) return `${entityLabel} has your ${lists[0].name} list on it.`;
  const numbered = lists.map((l, i) => `${i + 1}. ${l.name}.`).join(' ');
  return `${entityLabel} has ${lists.length} lists attached. ${numbered}`;
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
