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

async function deleteLabelUniqueTestRules(ctx: TestContext) {
  await fetch(
    `${ctx.supabaseUrl}/rest/v1/action_rules`
      + `?user_id=eq.${ctx.testUserId}`
      + `&label=ilike.integrity-label-unique-*`,
    {
      method: 'DELETE',
      headers: {
        apikey: ctx.serviceRoleKey,
        Authorization: `Bearer ${ctx.serviceRoleKey}`,
      },
    },
  );
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
    id: 'integrity.action-rules-disabled-rule-now-blocks-new',
    category: 'integrity',
    description: 'B6a (2026-05-26) — a DISABLED rule at coords X NOW blocks a new INSERT at same coords. The broader partial UNIQUE index applies regardless of enabled state. Replaces the V57.13.3 "disabled allows new" test (which encoded the old behavior that accumulated duplicates).',
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

      // After B6a: inserting a NEW row at the same coords must FAIL — the
      // unique constraint applies whether the existing row is enabled or
      // disabled. The application path is to UPDATE the existing disabled
      // row (re-arm) instead of INSERTing a fresh one.
      const newAtSameCoords = {
        ...disabled,
        trigger_config: { ...disabled.trigger_config, place_name: 'New' },
        label: 'integrity-dedup-test-new-at-same',
        enabled: true,
      };
      const r2 = await rawInsert(ctx, newAtSameCoords);
      expectEqual(r2.ok, false, `new INSERT at same coords (existing disabled) should be REJECTED but got status=${r2.status} body=${r2.body.slice(0, 200)}`);
      expectTruthy(
        r2.status === 409 || r2.status === 400 || r2.body.includes('duplicate') || r2.body.includes('unique'),
        `expected unique-constraint violation, got status=${r2.status} body=${r2.body.slice(0, 200)}`,
      );
    },
  },

  {
    id: 'integrity.action-rules-re-arm-update-keeps-one-row',
    category: 'integrity',
    description: 'B6a (2026-05-26) — when an existing disabled rule exists at coords X, the orchestrator UPDATEs it (enabled=true, last_fired_at=null) instead of INSERTing a new row. Verify exactly one row at those coords after re-arm.',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestRules(ctx); },
    async teardown(ctx) { await deleteTestRules(ctx); },
    async run(ctx) {
      // 1. Seed a disabled, recently-fired row.
      const disabled = {
        user_id: ctx.testUserId,
        trigger_type: 'location',
        trigger_config: { place_name: 'Re-arm Test', address: '200', resolved_lat: TEST_LAT, resolved_lng: TEST_LNG, radius_meters: 100 },
        action_type: 'sms',
        action_config: { to_phone: '+11234567890', body: 'test' },
        label: 'integrity-dedup-test-rearm',
        one_shot: true,
        enabled: false,
        last_fired_at: new Date(Date.now() - 60_000).toISOString(),
      };
      const r1 = await rawInsert(ctx, disabled);
      expectEqual(r1.ok, true, `seed disabled rule insert (status=${r1.status})`);
      const seeded = JSON.parse(r1.body);
      const seededId = Array.isArray(seeded) ? seeded[0]?.id : seeded?.id;
      expectTruthy(seededId, 'seeded rule should have an id');

      // 2. Re-arm via UPDATE — same pattern reArmLocationRule() uses.
      const updateUrl = `${ctx.supabaseUrl}/rest/v1/action_rules?id=eq.${seededId}`;
      const updateRes = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          apikey: ctx.serviceRoleKey,
          Authorization: `Bearer ${ctx.serviceRoleKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ enabled: true, last_fired_at: null }),
      });
      expectEqual(updateRes.ok, true, `re-arm UPDATE should succeed (status=${updateRes.status})`);

      // 3. Verify exactly ONE row exists for this user at these coords.
      const listUrl = `${ctx.supabaseUrl}/rest/v1/action_rules`
        + `?user_id=eq.${ctx.testUserId}`
        + `&label=ilike.integrity-dedup-test-rearm*`
        + `&select=id,enabled,last_fired_at`;
      const listRes = await fetch(listUrl, {
        headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
      });
      const rows = await listRes.json();
      expectEqual(Array.isArray(rows) && rows.length, 1, `exactly one row expected, got ${Array.isArray(rows) ? rows.length : 'non-array'} (${JSON.stringify(rows).slice(0, 200)})`);
      expectEqual(rows[0].enabled, true, `re-armed row should be enabled=true (got ${rows[0].enabled})`);
      expectEqual(rows[0].last_fired_at, null, `re-armed row should have last_fired_at=null (got ${rows[0].last_fired_at})`);
    },
  },

  // B9z (2026-07-16) — action_rules_user_label_unique was live in production
  // with no enabled=true scoping and no git-tracked origin: a DISABLED row
  // permanently blocked any new row with the same label, even long after the
  // original alert had fired. Fixed by supabase/migrations/20260716000000_
  // scope_action_rules_label_unique.sql. See docs/B9Z_PHASE1_PROBLEM_
  // DEFINITION_2026-07-16.md for the root cause and docs/B9Z_PHASE5_
  // EVIDENCE_2026-07-16.md for the manual staging verification these tests
  // lock in as permanent regression coverage.

  {
    id: 'integrity.action-rules-label-unique-disabled-allows-reuse',
    category: 'integrity',
    description: 'B9z (2026-07-16) — a DISABLED row with label X no longer blocks a new row with the same label X. The over-block this ticket fixed.',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteLabelUniqueTestRules(ctx); },
    async teardown(ctx) { await deleteLabelUniqueTestRules(ctx); },
    async run(ctx) {
      const first = {
        user_id: ctx.testUserId,
        trigger_type: 'time',
        trigger_config: { datetime: new Date(Date.now() + 3 * 60_000).toISOString() },
        action_type: 'sms',
        action_config: { self_override_sms: '+15555550100', body: 'test' },
        label: 'integrity-label-unique-reuse-test',
        one_shot: true,
        enabled: true,
      };
      const r1 = await rawInsert(ctx, first);
      expectEqual(r1.ok, true, `first insert (status=${r1.status} body=${r1.body.slice(0, 200)})`);
      const inserted = JSON.parse(r1.body);
      const firstId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
      expectTruthy(firstId, 'first row should have an id');

      const disableRes = await fetch(`${ctx.supabaseUrl}/rest/v1/action_rules?id=eq.${firstId}`, {
        method: 'PATCH',
        headers: {
          apikey: ctx.serviceRoleKey,
          Authorization: `Bearer ${ctx.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: false }),
      });
      expectEqual(disableRes.ok, true, `disabling first row should succeed (status=${disableRes.status})`);

      const second = { ...first, action_config: { ...first.action_config, body: 'test recreated' } };
      const r2 = await rawInsert(ctx, second);
      expectEqual(r2.ok, true, `recreate with identical label after disable should SUCCEED but got status=${r2.status} body=${r2.body.slice(0, 200)}`);
    },
  },

  {
    id: 'integrity.action-rules-label-unique-active-blocks-duplicate',
    category: 'integrity',
    description: 'B9z (2026-07-16) — regression guard: an ENABLED row with label X still blocks a second ENABLED row with the same label X. True-duplicate prevention among active alerts must remain intact.',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteLabelUniqueTestRules(ctx); },
    async teardown(ctx) { await deleteLabelUniqueTestRules(ctx); },
    async run(ctx) {
      const baseRow = {
        user_id: ctx.testUserId,
        trigger_type: 'time',
        trigger_config: { datetime: new Date(Date.now() + 3 * 60_000).toISOString() },
        action_type: 'sms',
        action_config: { self_override_sms: '+15555550100', body: 'test' },
        label: 'integrity-label-unique-active-test',
        one_shot: true,
        enabled: true,
      };
      const first = await rawInsert(ctx, baseRow);
      expectEqual(first.ok, true, `first insert (status=${first.status})`);

      const dupe = {
        ...baseRow,
        // Distinct datetime — isolates this test to the label constraint
        // specifically. With the same datetime, action_rules_unique_enabled_
        // time (a separate constraint, keyed on (user_id, datetime) only)
        // would ALSO reject this insert, making it impossible to tell which
        // constraint actually fired. See the sibling different-label-allowed
        // test, which hit exactly this ambiguity live.
        trigger_config: { datetime: new Date(Date.now() + 4 * 60_000).toISOString() },
        action_config: { ...baseRow.action_config, body: 'test duplicate' },
      };
      const second = await rawInsert(ctx, dupe);
      expectEqual(second.ok, false, `duplicate label while first is still enabled should be REJECTED but got status=${second.status} body=${second.body.slice(0, 200)}`);
      expectTruthy(
        second.body.includes('action_rules_user_label_unique'),
        `expected the action_rules_user_label_unique constraint specifically (isolated by using a different datetime), got status=${second.status} body=${second.body.slice(0, 200)}`,
      );
    },
  },

  {
    id: 'integrity.action-rules-label-unique-different-label-allowed',
    category: 'integrity',
    description: 'B9z (2026-07-16) — two ENABLED rows for the same user with DIFFERENT labels both succeed — no cross-contamination between unrelated alerts.',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteLabelUniqueTestRules(ctx); },
    async teardown(ctx) { await deleteLabelUniqueTestRules(ctx); },
    async run(ctx) {
      const rowA = {
        user_id: ctx.testUserId,
        trigger_type: 'time',
        trigger_config: { datetime: new Date(Date.now() + 3 * 60_000).toISOString() },
        action_type: 'sms',
        action_config: { self_override_sms: '+15555550100', body: 'test A' },
        label: 'integrity-label-unique-diff-test-A',
        one_shot: true,
        enabled: true,
      };
      const rowB = {
        ...rowA,
        // Distinct datetime — action_rules_unique_enabled_time (a SEPARATE
        // constraint, keyed on (user_id, datetime) only) would otherwise
        // reject this insert regardless of label, since it's unrelated to
        // what this test is isolating. Confirmed live: identical datetimes
        // here produced a 409 against that other index, not the label one.
        trigger_config: { datetime: new Date(Date.now() + 4 * 60_000).toISOString() },
        label: 'integrity-label-unique-diff-test-B',
        action_config: { ...rowA.action_config, body: 'test B' },
      };
      const r1 = await rawInsert(ctx, rowA);
      const r2 = await rawInsert(ctx, rowB);
      expectEqual(r1.ok, true, `row A insert (status=${r1.status})`);
      expectEqual(r2.ok, true, `row B insert with different label (status=${r2.status} body=${r2.body.slice(0, 200)})`);
    },
  },

  {
    id: 'integrity.action-rules-label-unique-update-preserves-label',
    category: 'integrity',
    description: 'B9z (2026-07-16) — updating a field OTHER than label on an already-enabled row still succeeds. Guards against an unintended interaction between the new partial index and any UPDATE path.',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteLabelUniqueTestRules(ctx); },
    async teardown(ctx) { await deleteLabelUniqueTestRules(ctx); },
    async run(ctx) {
      const row = {
        user_id: ctx.testUserId,
        trigger_type: 'time',
        trigger_config: { datetime: new Date(Date.now() + 3 * 60_000).toISOString() },
        action_type: 'sms',
        action_config: { self_override_sms: '+15555550100', body: 'original body' },
        label: 'integrity-label-unique-update-test',
        one_shot: true,
        enabled: true,
      };
      const r1 = await rawInsert(ctx, row);
      expectEqual(r1.ok, true, `insert (status=${r1.status})`);
      const inserted = JSON.parse(r1.body);
      const id = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
      expectTruthy(id, 'inserted row should have an id');

      const updateRes = await fetch(`${ctx.supabaseUrl}/rest/v1/action_rules?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          apikey: ctx.serviceRoleKey,
          Authorization: `Bearer ${ctx.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action_config: { self_override_sms: '+15555550100', body: 'updated body' } }),
      });
      expectEqual(updateRes.ok, true, `updating action_config without touching label should succeed (status=${updateRes.status})`);
    },
  },
];
