/**
 * Data-integrity tests — V57.13.3 (memory cache removed).
 *
 * These verify the DB-level constraints on action_rules that prevent
 * duplicate location alerts. Wael 2026-05-07 dropped the user_places cache
 * entirely; alerts ARE the saved-place data now. The unique constraint:
 *
 *   UNIQUE on (user_id, trigger_type, ROUND(lat,5), ROUND(lng,5))
 *   WHERE trigger_type = 'location' AND enabled = true
 *
 * applies to action_rules. Two enabled location alerts at the same physical
 * place for one user become physically impossible at the DB layer.
 *
 * The pre-INSERT duplicate check in useOrchestrator.commitPending surfaces
 * the friendly "you already have an alert" prompt before the constraint
 * fires, but the constraint is the last-line defense if the application
 * code has a bug.
 *
 * (Old user_places integrity tests removed in V57.13.3 — the table itself
 * was dropped.)
 */

import { db } from '../lib/adapters';
import { expectEqual, expectTruthy } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

const TEST_LAT = 45.42500;
const TEST_LNG = -75.69500;

async function deleteTestRules(ctx: TestContext) {
  await fetch(
    `${ctx.supabaseUrl}/rest/v1/action_rules`
      + `?user_id=eq.${ctx.testUserId}`
      + `&label=ilike.integrity-dedup-*`,
    {
      method: 'DELETE',
      headers: {
        apikey: ctx.serviceRoleKey,
        Authorization: `Bearer ${ctx.serviceRoleKey}`,
      },
    },
  );
}

async function rawInsert(ctx: TestContext, row: any): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${ctx.supabaseUrl}/rest/v1/action_rules`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: ctx.serviceRoleKey,
      Authorization: `Bearer ${ctx.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

export const dataIntegrityTests: TestCase[] = [
  {
    id: 'integrity.action-rules-duplicate-location-rejected',
    category: 'integrity',
    description: 'V57.13.3 — INSERT a second enabled location rule at same coords for same user is rejected by UNIQUE constraint',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestRules(ctx); },
    async teardown(ctx) { await deleteTestRules(ctx); },
    async run(ctx) {
      const baseRow = {
        user_id: ctx.testUserId,
        trigger_type: 'location',
        trigger_config: {
          place_name: 'Test Place A',
          address: '100 Test St',
          resolved_lat: TEST_LAT,
          resolved_lng: TEST_LNG,
          radius_meters: 100,
        },
        action_type: 'sms',
        action_config: { to_phone: '+11234567890', body: 'test' },
        label: 'integrity-dedup-test-a',
        one_shot: false,
        enabled: true,
      };
      const first = await rawInsert(ctx, baseRow);
      expectEqual(first.ok, true, `first insert should succeed (status=${first.status} body=${first.body.slice(0, 200)})`);

      const dupeRow = {
        ...baseRow,
        trigger_config: {
          ...baseRow.trigger_config,
          place_name: 'Test Place B', // different name, same coords
          resolved_lat: TEST_LAT + 0.000001, // ~0.1m away — same after ROUND(_, 5)
        },
        label: 'integrity-dedup-test-b',
      };
      const second = await rawInsert(ctx, dupeRow);
      expectEqual(second.ok, false, `duplicate-coords insert should be REJECTED but got status=${second.status} body=${second.body.slice(0, 200)}`);
      expectTruthy(
        second.status === 409 || second.status === 400 || second.body.includes('duplicate') || second.body.includes('unique'),
        `expected unique-constraint violation, got status=${second.status} body=${second.body.slice(0, 200)}`,
      );
    },
  },

  {
    id: 'integrity.action-rules-different-coords-allowed',
    category: 'integrity',
    description: 'V57.13.3 — TWO enabled location rules at DIFFERENT coords for the same user both succeed',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestRules(ctx); },
    async teardown(ctx) { await deleteTestRules(ctx); },
    async run(ctx) {
      const rowA = {
        user_id: ctx.testUserId,
        trigger_type: 'location',
        trigger_config: { place_name: 'A', address: '1', resolved_lat: TEST_LAT, resolved_lng: TEST_LNG, radius_meters: 100 },
        action_type: 'sms',
        action_config: { to_phone: '+11234567890', body: 'test' },
        label: 'integrity-dedup-test-A',
        one_shot: false,
        enabled: true,
      };
      const rowB = {
        ...rowA,
        trigger_config: { ...rowA.trigger_config, place_name: 'B', resolved_lat: TEST_LAT + 0.01, resolved_lng: TEST_LNG + 0.01 },
        label: 'integrity-dedup-test-B',
      };
      const r1 = await rawInsert(ctx, rowA);
      const r2 = await rawInsert(ctx, rowB);
      expectEqual(r1.ok, true, `row A insert (status=${r1.status})`);
      expectEqual(r2.ok, true, `row B insert at different coords (status=${r2.status} body=${r2.body.slice(0, 200)})`);
    },
  },

  {
    id: 'integrity.action-rules-disabled-rule-allows-new',
    category: 'integrity',
    description: 'V57.13.3 — a DISABLED rule at coords X does not block a new enabled rule at same coords (constraint is partial WHERE enabled=true)',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestRules(ctx); },
    async teardown(ctx) { await deleteTestRules(ctx); },
    async run(ctx) {
      const disabled = {
        user_id: ctx.testUserId,
        trigger_type: 'location',
        trigger_config: { place_name: 'Old', address: '100', resolved_lat: TEST_LAT, resolved_lng: TEST_LNG, radius_meters: 100 },
        action_type: 'sms',
        action_config: { to_phone: '+11234567890', body: 'test' },
        label: 'integrity-dedup-test-disabled',
        one_shot: false,
        enabled: false, // disabled
      };
      const r1 = await rawInsert(ctx, disabled);
      expectEqual(r1.ok, true, `disabled rule insert (status=${r1.status})`);

      const enabled = {
        ...disabled,
        trigger_config: { ...disabled.trigger_config, place_name: 'New' },
        label: 'integrity-dedup-test-enabled',
        enabled: true,
      };
      const r2 = await rawInsert(ctx, enabled);
      expectEqual(r2.ok, true, `enabled rule at same coords (after disabled) should succeed (status=${r2.status} body=${r2.body.slice(0, 200)})`);
    },
  },
];
