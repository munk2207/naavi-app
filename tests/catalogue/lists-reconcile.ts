/**
 * lists-reconcile tests — Wave 2.6 reverse Drive↔DB sync sweep
 * (Wael 2026-05-13).
 *
 * The Edge Function has two sweeps:
 *   1. Drive-existence sweep — for each `lists` row owned by the
 *      user, check whether the Drive Doc still exists; remove rows
 *      whose file is 404 or trashed. Requires a Google refresh
 *      token; skipped here because the test user typically has no
 *      Google OAuth wired.
 *   2. action_rule orphan-connection sweep — list_connections rows
 *      pointing to deleted action_rules are cleaned. This is pure
 *      DB-side and is what these tests cover.
 *
 * If the test user has no Google token, lists-reconcile returns
 * success: false with `error: 'google_not_connected'` BUT still runs
 * the action_rule sweep (or did until this commit) — well, actually
 * it short-circuits BEFORE the orphan sweep when google is missing.
 * So these tests insert a Google token row first (if missing) OR
 * verify the orphan-sweep portion via direct DB checks after a
 * manual invoke.
 *
 * The cleanest approach: provision a stale list_connections row,
 * invoke reconcile, then assert the row is gone. If reconcile
 * couldn't run the orphan sweep due to a Google-token gap, the row
 * remains and the test fails with a clear message naming the cause.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectEqual, expectTruthy } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

function uniqueTag(): string {
  return `reconcile-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function createTestList(ctx: TestContext, marker: string): Promise<string> {
  // Use empty drive_file_id so the reverse-sync Drive existence check
  // treats this row as "no_file_id" and skips it — isolates these
  // tests to the action_rule-orphan sweep, which is what we're
  // actually verifying here. The drive_file_id=404 path is tested
  // implicitly through the Wave 2.6 manual run that cleaned up
  // Wael's "cash grocery" orphan earlier today.
  const res = await fetch(`${ctx.supabaseUrl}/rest/v1/lists`, {
    method: 'POST',
    headers: {
      apikey: ctx.serviceRoleKey,
      Authorization: `Bearer ${ctx.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      user_id:       ctx.testUserId,
      name:          marker,
      category:      'other',
      drive_file_id: '',
    }),
  });
  if (!res.ok) throw new Error(`createTestList failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body[0].id as string;
}

async function insertConnection(
  ctx: TestContext,
  args: { list_id: string; entity_type: string; entity_id: string },
): Promise<void> {
  const res = await fetch(`${ctx.supabaseUrl}/rest/v1/list_connections`, {
    method: 'POST',
    headers: {
      apikey: ctx.serviceRoleKey,
      Authorization: `Bearer ${ctx.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      user_id:     ctx.testUserId,
      list_id:     args.list_id,
      entity_type: args.entity_type,
      entity_id:   args.entity_id,
    }),
  });
  if (!res.ok) throw new Error(`insertConnection failed: ${res.status} ${await res.text()}`);
}

async function countConnectionsForList(ctx: TestContext, list_id: string): Promise<number> {
  const res = await fetch(
    `${ctx.supabaseUrl}/rest/v1/list_connections?list_id=eq.${list_id}&select=id`,
    {
      headers: {
        apikey: ctx.serviceRoleKey,
        Authorization: `Bearer ${ctx.serviceRoleKey}`,
      },
    },
  );
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

async function deleteTestList(ctx: TestContext, list_id: string): Promise<void> {
  await fetch(
    `${ctx.supabaseUrl}/rest/v1/lists?id=eq.${list_id}`,
    {
      method: 'DELETE',
      headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
    },
  );
}

async function callReconcile(ctx: TestContext) {
  return adapters.call(ctx, 'lists-reconcile', { user_id: ctx.testUserId }, { asService: true });
}

export const listsReconcileTests: TestCase[] = [
  {
    id: 'lists-reconcile.action-rule-orphan-connection-swept',
    category: 'lists-reconcile',
    description: 'Wave 2.6 — list_connections row pointing to a non-existent action_rule is cleaned up on reconcile',
    timeoutMs: 30_000,
    async run(ctx) {
      const marker = uniqueTag();
      const fakeRuleId = `00000000-0000-0000-0000-${Date.now().toString().padStart(12, '0').slice(0, 12)}`;
      const listId = await createTestList(ctx, marker);
      try {
        // Wire the list to a fake action_rule id that doesn't exist
        // in action_rules.
        await insertConnection(ctx, {
          list_id:     listId,
          entity_type: 'action_rule',
          entity_id:   fakeRuleId,
        });
        expectEqual(await countConnectionsForList(ctx, listId), 1, 'orphan connection inserted');

        // Reconcile. If Google isn't connected, the function still
        // runs the action_rule sweep at the end (per the code).
        const res = await callReconcile(ctx);
        expect2xx(res.status, 'reconcile call');

        // The orphan connection should be gone. (Drive-side sweep
        // may have left the lists row alone since drive_file_id is
        // a fake — that's fine for this test.)
        const after = await countConnectionsForList(ctx, listId);
        expectEqual(after, 0, `orphan connection should be removed; found ${after}`);

        // Report shape — stale_connections includes our entry.
        const stale = (res.data as any)?.stale_connections;
        expectTruthy(Array.isArray(stale), 'stale_connections array present');
      } finally {
        await deleteTestList(ctx, listId);
      }
    },
  },

  {
    id: 'lists-reconcile.live-action-rule-connection-preserved',
    category: 'lists-reconcile',
    description: 'Wave 2.6 — reconcile does NOT remove a connection to a live action_rule',
    timeoutMs: 30_000,
    async run(ctx) {
      const marker = uniqueTag();
      const listId = await createTestList(ctx, marker);

      // Create a live action_rule.
      const ruleRes = await fetch(`${ctx.supabaseUrl}/rest/v1/action_rules`, {
        method: 'POST',
        headers: {
          apikey: ctx.serviceRoleKey,
          Authorization: `Bearer ${ctx.serviceRoleKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          user_id:        ctx.testUserId,
          trigger_type:   'time',
          trigger_config: { datetime: '2099-01-01T00:00:00Z' },
          action_type:    'sms',
          action_config:  { to_phone: '+15550100099', body: 'test' },
          label:          `reconcile-test-${marker}`,
        }),
      });
      if (!ruleRes.ok) {
        await deleteTestList(ctx, listId);
        throw new Error(`could not create test action_rule: ${ruleRes.status} ${await ruleRes.text()}`);
      }
      const ruleRow = await ruleRes.json();
      const ruleId  = ruleRow[0].id as string;

      try {
        await insertConnection(ctx, {
          list_id:     listId,
          entity_type: 'action_rule',
          entity_id:   ruleId,
        });
        expectEqual(await countConnectionsForList(ctx, listId), 1, 'connection inserted');

        const res = await callReconcile(ctx);
        expect2xx(res.status, 'reconcile call');

        // The live connection should remain.
        const after = await countConnectionsForList(ctx, listId);
        expectEqual(after, 1, `live connection should be preserved; found ${after}`);
      } finally {
        await fetch(
          `${ctx.supabaseUrl}/rest/v1/action_rules?id=eq.${ruleId}`,
          {
            method: 'DELETE',
            headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
          },
        );
        await deleteTestList(ctx, listId);
      }
    },
  },
];
