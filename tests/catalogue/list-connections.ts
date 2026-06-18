/**
 * F1a list_connections — integrity + Edge Function behavior (Wael 2026-05-11).
 *
 * Covers the four CLAUDE.md data-integrity layers for list_connections +
 * the manage-list-connections Edge Function CRUD:
 *
 *   - DB constraints: partial-style UNIQUE on (entity_type, entity_id);
 *     entity_type CHECK; FK ON DELETE CASCADE behavior.
 *   - Single write entry point: manage-list-connections is the only path
 *     for connect/disconnect; anon-key direct REST insert blocked.
 *   - RLS lockdown: anon cannot INSERT/UPDATE/DELETE; only service role.
 *   - Behavior: CONNECT replaces prior row on same entity; DISCONNECT
 *     removes; LIST_CONNECTIONS_FOR_LIST returns wirings;
 *     DELETE_LIST_AND_CONNECTIONS soft-disables and preserves connections (2026-05-25).
 *
 * Spec: docs/F1A_LISTS_AND_CONNECTIONS_SPEC.md.
 */

import { adapters, db } from '../lib/adapters';
import { expect2xx, expectEqual, expectTruthy } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

function uniqueTag(): string {
  return `f1atest-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function deleteTestLists(ctx: TestContext, marker: string): Promise<void> {
  await fetch(
    `${ctx.supabaseUrl}/rest/v1/lists`
      + `?user_id=eq.${ctx.testUserId}`
      + `&name=ilike.*${marker}*`,
    {
      method: 'DELETE',
      headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
    },
  );
}

async function createTestList(ctx: TestContext, marker: string): Promise<string> {
  const row = {
    user_id:        ctx.testUserId,
    name:           `f1a-${marker}`,
    category:       'other',
    drive_file_id:  `fake-drive-${marker}`, // not a real Drive doc — fine for connection tests
  };
  const res = await fetch(`${ctx.supabaseUrl}/rest/v1/lists`, {
    method: 'POST',
    headers: {
      apikey: ctx.serviceRoleKey,
      Authorization: `Bearer ${ctx.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`createTestList failed: status=${res.status} body=${await res.text()}`);
  const body = await res.json();
  return body[0].id as string;
}

async function callConnect(
  ctx: TestContext,
  args: { list_id: string; entity_type: string; entity_id: string },
) {
  return adapters.call(ctx, 'manage-list-connections', {
    type: 'CONNECT',
    user_id: ctx.testUserId,
    ...args,
  }, { asService: true });
}

async function callDisconnect(
  ctx: TestContext,
  args: { entity_type: string; entity_id: string },
) {
  return adapters.call(ctx, 'manage-list-connections', {
    type: 'DISCONNECT',
    user_id: ctx.testUserId,
    ...args,
  }, { asService: true });
}

async function callListForList(ctx: TestContext, list_id: string) {
  return adapters.call(ctx, 'manage-list-connections', {
    type: 'LIST_CONNECTIONS_FOR_LIST',
    user_id: ctx.testUserId,
    list_id,
  }, { asService: true });
}

async function callListForEntity(
  ctx: TestContext,
  args: { entity_type: string; entity_id: string },
) {
  return adapters.call(ctx, 'manage-list-connections', {
    type: 'LIST_CONNECTIONS_FOR_ENTITY',
    user_id: ctx.testUserId,
    ...args,
  }, { asService: true });
}

async function callDeleteList(ctx: TestContext, list_id: string) {
  return adapters.call(ctx, 'manage-list-connections', {
    type: 'DELETE_LIST_AND_CONNECTIONS',
    user_id: ctx.testUserId,
    list_id,
  }, { asService: true });
}

export const listConnectionsTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // RLS lockdown: anon-key direct REST insert is rejected.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'list-connections.anon-insert-blocked',
    category: 'list-connections',
    description: 'F1a — anon-key direct INSERT into list_connections is blocked by RLS',
    timeoutMs: 10_000,
    async run(ctx) {
      const res = await fetch(`${ctx.supabaseUrl}/rest/v1/list_connections`, {
        method: 'POST',
        headers: {
          apikey: ctx.anonKey,
          Authorization: `Bearer ${ctx.anonKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          user_id: ctx.testUserId,
          list_id: '00000000-0000-0000-0000-000000000000',
          entity_type: 'action_rule',
          entity_id: 'fake-rule-id',
        }),
      });
      expectEqual(res.ok, false, `anon INSERT should fail; got status=${res.status}`);
      expectTruthy(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Connect round-trip + LIST_CONNECTIONS_FOR_ENTITY returns the list.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'list-connections.connect-then-read-back',
    category: 'list-connections',
    description: 'F1a — CONNECT wires list↔entity; LIST_CONNECTIONS_FOR_ENTITY returns the list',
    timeoutMs: 15_000,
    async run(ctx) {
      const marker = uniqueTag();
      try {
        const listId = await createTestList(ctx, marker);
        const entityId = `fake-rule-${marker}`;

        const connRes = await callConnect(ctx, {
          list_id: listId,
          entity_type: 'action_rule',
          entity_id: entityId,
        });
        expect2xx(connRes.status, 'CONNECT');
        expectEqual((connRes.data as any)?.success, true, 'CONNECT success=true');

        const readRes = await callListForEntity(ctx, {
          entity_type: 'action_rule',
          entity_id: entityId,
        });
        expect2xx(readRes.status, 'LIST_CONNECTIONS_FOR_ENTITY');
        const list = (readRes.data as any)?.list;
        expectTruthy(list, 'list payload present');
        expectEqual(list?.id, listId, 'returned list.id matches');
      } finally {
        await deleteTestLists(ctx, marker);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Wave 2.5 M:N (Wael 2026-05-13) — two different lists CAN attach to the
  // same entity; second CONNECT does NOT replace, it adds. Same (list,
  // entity) pair attempted twice returns 409 already_attached.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'list-connections.connect-adds-not-replaces',
    category: 'list-connections',
    description: 'M:N — second CONNECT on same entity adds (both lists attached after); same pair twice → 200 idempotent',
    timeoutMs: 15_000,
    async run(ctx) {
      const marker = uniqueTag();
      try {
        const listA = await createTestList(ctx, `${marker}-A`);
        const listB = await createTestList(ctx, `${marker}-B`);
        const entityId = `fake-rule-${marker}`;

        const r1 = await callConnect(ctx, { list_id: listA, entity_type: 'action_rule', entity_id: entityId });
        expect2xx(r1.status, 'CONNECT A');

        const r2 = await callConnect(ctx, { list_id: listB, entity_type: 'action_rule', entity_id: entityId });
        expect2xx(r2.status, 'CONNECT B adds (M:N)');

        // LIST_CONNECTIONS_FOR_ENTITY returns lists[] (canonical) and
        // list (back-compat = lists[0]). Both A and B should be present.
        const readRes = await callListForEntity(ctx, { entity_type: 'action_rule', entity_id: entityId });
        expect2xx(readRes.status, 'read after second connect');
        const lists = (readRes.data as any)?.lists;
        expectTruthy(Array.isArray(lists), 'lists[] array returned');
        expectEqual(lists.length, 2, `expected 2 attached lists, got ${lists.length}`);
        const ids = new Set(lists.map((l: any) => l.id));
        expectTruthy(ids.has(listA), 'listA still attached');
        expectTruthy(ids.has(listB), 'listB attached too');

        // Same (list, entity) pair twice → 200 idempotent success (already_attached:true).
        const r3 = await callConnect(ctx, { list_id: listA, entity_type: 'action_rule', entity_id: entityId });
        expect2xx(r3.status, 'duplicate (list, entity) pair returns 200 idempotent');
        expectEqual((r3.data as any)?.already_attached, true, 'already_attached=true');
      } finally {
        await deleteTestLists(ctx, marker);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Wave 2.5 (Wael 2026-05-13) — DISCONNECT with explicit list_id
  // removes ONLY that specific (list, entity) row; other lists on the
  // same entity remain attached.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'list-connections.disconnect-by-list-id-targets-one',
    category: 'list-connections',
    description: 'M:N — DISCONNECT with list_id removes only that pair; other attached lists stay',
    timeoutMs: 15_000,
    async run(ctx) {
      const marker = uniqueTag();
      try {
        const listA = await createTestList(ctx, `${marker}-A`);
        const listB = await createTestList(ctx, `${marker}-B`);
        const entityId = `fake-rule-${marker}`;

        await callConnect(ctx, { list_id: listA, entity_type: 'action_rule', entity_id: entityId });
        await callConnect(ctx, { list_id: listB, entity_type: 'action_rule', entity_id: entityId });

        // DISCONNECT with list_id targeting only A.
        const dropA = await adapters.call(ctx, 'manage-list-connections', {
          type:        'DISCONNECT',
          user_id:     ctx.testUserId,
          list_id:     listA,
          entity_type: 'action_rule',
          entity_id:   entityId,
        }, { asService: true });
        expect2xx(dropA.status, 'DISCONNECT with list_id=A');
        expectEqual((dropA.data as any)?.removed, 1, 'removed=1');

        // Read back — only B should remain.
        const readRes = await callListForEntity(ctx, { entity_type: 'action_rule', entity_id: entityId });
        expect2xx(readRes.status, 'read after partial disconnect');
        const lists = (readRes.data as any)?.lists;
        expectEqual(lists?.length, 1, `expected 1 attached list, got ${lists?.length}`);
        expectEqual(lists?.[0]?.id, listB, 'remaining list is B');
      } finally {
        await deleteTestLists(ctx, marker);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Wave 2.5 — DISCONNECT without list_id when entity has 2+ connections
  // is ambiguous; Edge Function returns 400 with attached_list_ids so the
  // caller can disambiguate.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'list-connections.disconnect-without-list-id-ambiguous',
    category: 'list-connections',
    description: 'M:N — DISCONNECT without list_id on multi-attached entity returns 400 ambiguous_disconnect_needs_list_id',
    timeoutMs: 15_000,
    async run(ctx) {
      const marker = uniqueTag();
      try {
        const listA = await createTestList(ctx, `${marker}-A`);
        const listB = await createTestList(ctx, `${marker}-B`);
        const entityId = `fake-rule-${marker}`;
        await callConnect(ctx, { list_id: listA, entity_type: 'action_rule', entity_id: entityId });
        await callConnect(ctx, { list_id: listB, entity_type: 'action_rule', entity_id: entityId });

        // DISCONNECT with NO list_id — should be ambiguous.
        const res = await callDisconnect(ctx, { entity_type: 'action_rule', entity_id: entityId });
        expectEqual(res.status, 400, `expected 400, got ${res.status}`);
        expectEqual((res.data as any)?.error, 'ambiguous_disconnect_needs_list_id', 'specific error code');
        const ids = (res.data as any)?.attached_list_ids;
        expectTruthy(Array.isArray(ids) && ids.length === 2, 'attached_list_ids returns both list ids');
        expectTruthy(ids.includes(listA) && ids.includes(listB), 'both list ids present');
      } finally {
        await deleteTestLists(ctx, marker);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Wave 2.5 — DISCONNECT without list_id when entity has EXACTLY one
  // connection still works (back-compat path for callers from before
  // the M:N pivot).
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'list-connections.disconnect-without-list-id-single-works',
    category: 'list-connections',
    description: 'M:N back-compat — DISCONNECT without list_id removes the connection when only one exists',
    timeoutMs: 15_000,
    async run(ctx) {
      const marker = uniqueTag();
      try {
        const listId = await createTestList(ctx, marker);
        const entityId = `fake-rule-${marker}`;
        await callConnect(ctx, { list_id: listId, entity_type: 'action_rule', entity_id: entityId });

        const res = await callDisconnect(ctx, { entity_type: 'action_rule', entity_id: entityId });
        expect2xx(res.status, 'DISCONNECT (single-connection back-compat)');
        expectEqual((res.data as any)?.removed, 1, 'removed=1');

        const readRes = await callListForEntity(ctx, { entity_type: 'action_rule', entity_id: entityId });
        expect2xx(readRes.status, 'read after disconnect');
        const lists = (readRes.data as any)?.lists;
        expectEqual(lists?.length, 0, 'no lists remain');
      } finally {
        await deleteTestLists(ctx, marker);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // One list → many entities allowed.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'list-connections.one-list-many-entities',
    category: 'list-connections',
    description: 'F1a — same list can be connected to multiple entities',
    timeoutMs: 15_000,
    async run(ctx) {
      const marker = uniqueTag();
      try {
        const listId = await createTestList(ctx, marker);

        for (const suffix of ['a', 'b', 'c']) {
          const r = await callConnect(ctx, {
            list_id: listId,
            entity_type: 'action_rule',
            entity_id: `fake-rule-${marker}-${suffix}`,
          });
          expect2xx(r.status, `CONNECT to entity ${suffix}`);
        }

        const listRes = await callListForList(ctx, listId);
        expect2xx(listRes.status, 'LIST_CONNECTIONS_FOR_LIST');
        const conns = (listRes.data as any)?.connections;
        expectTruthy(Array.isArray(conns), 'connections array returned');
        expectEqual(conns.length, 3, `expected 3 connections, got ${conns.length}`);
      } finally {
        await deleteTestLists(ctx, marker);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // DISCONNECT removes the wiring.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'list-connections.disconnect-removes',
    category: 'list-connections',
    description: 'F1a — DISCONNECT removes the connection; subsequent read returns list=null',
    timeoutMs: 15_000,
    async run(ctx) {
      const marker = uniqueTag();
      try {
        const listId = await createTestList(ctx, marker);
        const entityId = `fake-rule-${marker}`;
        await callConnect(ctx, { list_id: listId, entity_type: 'action_rule', entity_id: entityId });

        const dropRes = await callDisconnect(ctx, { entity_type: 'action_rule', entity_id: entityId });
        expect2xx(dropRes.status, 'DISCONNECT');
        expectEqual((dropRes.data as any)?.removed, 1, 'removed=1');

        const readRes = await callListForEntity(ctx, { entity_type: 'action_rule', entity_id: entityId });
        expect2xx(readRes.status, 'read after disconnect');
        expectEqual((readRes.data as any)?.list, null, 'list now null');
      } finally {
        await deleteTestLists(ctx, marker);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // DELETE_LIST_AND_CONNECTIONS soft-disables the list and PRESERVES
  // connections (so Reactivate can restore full wiring).
  // Updated 2026-05-25 — old hard-delete → soft-disable parity with alerts.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'list-connections.delete-list-disables',
    category: 'list-connections',
    description:
      'F1a — DELETE_LIST_AND_CONNECTIONS soft-disables the list (enabled=false) ' +
      'and preserves connections so Reactivate can restore them',
    timeoutMs: 15_000,
    async run(ctx) {
      const marker = uniqueTag();
      try {
        const listId = await createTestList(ctx, marker);
        for (const suffix of ['a', 'b']) {
          await callConnect(ctx, {
            list_id: listId,
            entity_type: 'action_rule',
            entity_id: `fake-rule-${marker}-${suffix}`,
          });
        }

        const delRes = await callDeleteList(ctx, listId);
        expect2xx(delRes.status, 'DELETE_LIST_AND_CONNECTIONS');
        expectEqual((delRes.data as any)?.success, true, 'success=true');
        // Response must carry the connection list (may be under cascaded_connections).
        const reported = (delRes.data as any)?.cascaded_connections;
        expectTruthy(Array.isArray(reported), 'cascaded_connections array in response');

        // Soft-disable: connections are PRESERVED (not cascaded-deleted).
        const readRes = await callListForList(ctx, listId);
        expect2xx(readRes.status, 'read after soft-disable');
        const remaining = ((readRes.data as any)?.connections ?? []).length;
        expectEqual(remaining, 2, `connections must be preserved after soft-disable; got ${remaining}`);
      } finally {
        await deleteTestLists(ctx, marker);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // PERMANENTLY_DELETE_LIST hard-deletes the row and cascades connections.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'list-connections.permanently-delete-list-cascades',
    category: 'list-connections',
    description:
      'F1a — PERMANENTLY_DELETE_LIST removes the list row from DB and ' +
      'cascades (removes) all its list_connections rows',
    timeoutMs: 15_000,
    async run(ctx) {
      const marker = uniqueTag();
      try {
        const listId = await createTestList(ctx, marker);
        for (const suffix of ['a', 'b']) {
          await callConnect(ctx, {
            list_id: listId,
            entity_type: 'action_rule',
            entity_id: `fake-rule-${marker}-${suffix}`,
          });
        }

        const delRes = await adapters.call(ctx, 'manage-list-connections', {
          type: 'PERMANENTLY_DELETE_LIST',
          user_id: ctx.testUserId,
          list_id: listId,
        }, { asService: true });
        expect2xx(delRes.status, 'PERMANENTLY_DELETE_LIST');
        expectEqual((delRes.data as any)?.success, true, 'success=true');
        const cascaded = (delRes.data as any)?.cascaded_connections;
        expectTruthy(Array.isArray(cascaded), 'cascaded_connections array');
        expectEqual(cascaded.length, 2, `expected 2 cascaded, got ${cascaded.length}`);

        // Hard delete: the list row itself must be gone from the DB.
        const rows = await fetch(
          `${ctx.supabaseUrl}/rest/v1/lists?id=eq.${listId}&user_id=eq.${ctx.testUserId}`,
          { headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` } },
        ).then(r => r.json());
        expectEqual(
          Array.isArray(rows) ? rows.length : -1,
          0,
          'list row must be gone after PERMANENTLY_DELETE_LIST',
        );
      } finally {
        await deleteTestLists(ctx, marker);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // entity_type CHECK constraint — unknown types rejected.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'list-connections.unknown-entity-type-rejected',
    category: 'list-connections',
    description: 'F1a — CONNECT with unknown entity_type returns 400',
    timeoutMs: 10_000,
    async run(ctx) {
      const marker = uniqueTag();
      try {
        const listId = await createTestList(ctx, marker);
        const res = await callConnect(ctx, {
          list_id: listId,
          entity_type: 'bogus_thing',
          entity_id: `fake-${marker}`,
        });
        expectEqual(res.status >= 400 && res.status < 500, true,
          `expected 4xx for unknown entity_type, got ${res.status}`);
      } finally {
        await deleteTestLists(ctx, marker);
      }
    },
  },
];
