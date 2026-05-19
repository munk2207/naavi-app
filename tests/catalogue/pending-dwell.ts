/**
 * pending_dwell_fires integrity + report-location-event behavior
 * (Wael 2026-05-11).
 *
 * Covers the server-side dwell timer that defers location-rule fires by
 * trigger_config.dwell_seconds (default 120 s) so we can widen geofence
 * radius without false-firing on drive-through traffic.
 *
 * Tests:
 *   - Migration: CHECK on fire_at > entered_at; partial UNIQUE on active
 *     rule_id; cancelled rows don't block new actives.
 *   - report-location-event: ENTER on arrive rule defers (inserts row),
 *     does NOT immediately log to action_rule_log; EXIT on arrive rule
 *     cancels active pending row.
 */

import { adapters, db } from '../lib/adapters';
import { expect2xx, expectEqual, expectTruthy } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

const TEST_LAT = 45.41111;
const TEST_LNG = -75.71111;

// 2026-05-19 — ENTER events must report coords near the geofence boundary
// to pass the cold-start phantom guard in report-location-event (rejects
// first ENTER if reported coords are within 70% of radius from center —
// real arrivals fire when the phone crosses the boundary, not at the
// geometric center). For the 500 m radius test rule, the boundary lies
// ~500 m from center; we offset latitude by ~0.0036° (≈400 m at 45° N)
// so the reported coords sit comfortably past the 350 m threshold.
const ENTER_LAT = TEST_LAT + 0.0036;
const ENTER_LNG = TEST_LNG;

async function deleteTestRules(ctx: TestContext) {
  await fetch(
    `${ctx.supabaseUrl}/rest/v1/action_rules`
      + `?user_id=eq.${ctx.testUserId}`
      + `&label=ilike.pending-dwell-test-*`,
    {
      method: 'DELETE',
      headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
    },
  );
}

async function deleteTestPending(ctx: TestContext, ruleId: string) {
  await fetch(
    `${ctx.supabaseUrl}/rest/v1/pending_dwell_fires?rule_id=eq.${ruleId}`,
    {
      method: 'DELETE',
      headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
    },
  );
}

async function deleteActionLog(ctx: TestContext, ruleId: string) {
  await fetch(
    `${ctx.supabaseUrl}/rest/v1/action_rule_log?rule_id=eq.${ruleId}`,
    {
      method: 'DELETE',
      headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
    },
  );
}

async function createTestRule(ctx: TestContext, label: string, dwellSeconds = 120): Promise<string> {
  const row = {
    user_id: ctx.testUserId,
    trigger_type: 'location',
    trigger_config: {
      place_name: 'Test Place',
      address: '1 Test St',
      resolved_lat: TEST_LAT,
      resolved_lng: TEST_LNG,
      radius_meters: 500,
      direction: 'arrive',
      dwell_seconds: dwellSeconds,
    },
    action_type: 'sms',
    action_config: { to_phone: '+11234567890', body: 'test alert' },
    label,
    one_shot: false,
    enabled: true,
  };
  const res = await fetch(`${ctx.supabaseUrl}/rest/v1/action_rules`, {
    method: 'POST',
    headers: {
      apikey: ctx.serviceRoleKey,
      Authorization: `Bearer ${ctx.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  const body = await res.json();
  return body[0].id as string;
}

async function rawInsertPending(ctx: TestContext, row: any) {
  const res = await fetch(`${ctx.supabaseUrl}/rest/v1/pending_dwell_fires`, {
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

async function countPending(ctx: TestContext, ruleId: string, activeOnly = true): Promise<number> {
  let q = `${ctx.supabaseUrl}/rest/v1/pending_dwell_fires?rule_id=eq.${ruleId}&select=id`;
  if (activeOnly) q += '&cancelled_at=is.null&fired_at=is.null';
  const res = await fetch(q, {
    headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
  });
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

export const pendingDwellTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // CHECK constraint: fire_at must be > entered_at.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'pending-dwell.fire-at-must-be-after-entered',
    category: 'pending-dwell',
    description: 'CHECK constraint blocks fire_at <= entered_at',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestRules(ctx); },
    async teardown(ctx) { await deleteTestRules(ctx); },
    async run(ctx) {
      const ruleId = await createTestRule(ctx, 'pending-dwell-test-checks');
      try {
        const sameTs = new Date().toISOString();
        const res = await rawInsertPending(ctx, {
          rule_id: ruleId,
          user_id: ctx.testUserId,
          entered_at: sameTs,
          fire_at: sameTs, // equal — must fail
        });
        expectEqual(res.ok, false, `fire_at = entered_at should be rejected, got status=${res.status} body=${res.body.slice(0, 200)}`);
        expectTruthy(
          res.body.includes('fire_after_enter') || res.body.includes('check') || res.body.includes('violates'),
          `expected CHECK violation, got body=${res.body.slice(0, 200)}`,
        );
      } finally {
        await deleteTestPending(ctx, ruleId);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Partial UNIQUE: only one ACTIVE pending row per rule.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'pending-dwell.one-active-per-rule',
    category: 'pending-dwell',
    description: 'Partial UNIQUE index blocks second active pending row for same rule',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestRules(ctx); },
    async teardown(ctx) { await deleteTestRules(ctx); },
    async run(ctx) {
      const ruleId = await createTestRule(ctx, 'pending-dwell-test-unique');
      try {
        const now = new Date();
        const fireAt = new Date(now.getTime() + 60_000).toISOString();
        const first = await rawInsertPending(ctx, {
          rule_id: ruleId, user_id: ctx.testUserId,
          entered_at: now.toISOString(), fire_at: fireAt,
        });
        expectEqual(first.ok, true, `first active insert (status=${first.status} body=${first.body.slice(0, 200)})`);

        const second = await rawInsertPending(ctx, {
          rule_id: ruleId, user_id: ctx.testUserId,
          entered_at: now.toISOString(), fire_at: fireAt,
        });
        expectEqual(second.ok, false, `second active insert should be blocked, got status=${second.status} body=${second.body.slice(0, 200)}`);
        expectTruthy(
          second.status === 409 || second.body.includes('duplicate') || second.body.includes('unique'),
          `expected unique violation, got status=${second.status} body=${second.body.slice(0, 200)}`,
        );
      } finally {
        await deleteTestPending(ctx, ruleId);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Partial UNIQUE excludes cancelled rows — re-enter after cancel works.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'pending-dwell.cancelled-row-allows-new-active',
    category: 'pending-dwell',
    description: 'Cancelled pending row does not block a new active row (partial WHERE)',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestRules(ctx); },
    async teardown(ctx) { await deleteTestRules(ctx); },
    async run(ctx) {
      const ruleId = await createTestRule(ctx, 'pending-dwell-test-after-cancel');
      try {
        const now = new Date();
        const fireAt = new Date(now.getTime() + 60_000).toISOString();

        const r1 = await rawInsertPending(ctx, {
          rule_id: ruleId, user_id: ctx.testUserId,
          entered_at: now.toISOString(), fire_at: fireAt,
          cancelled_at: new Date().toISOString(), // already cancelled
        });
        expectEqual(r1.ok, true, `cancelled-from-the-start row insert (status=${r1.status} body=${r1.body.slice(0, 200)})`);

        const r2 = await rawInsertPending(ctx, {
          rule_id: ruleId, user_id: ctx.testUserId,
          entered_at: now.toISOString(), fire_at: fireAt,
        });
        expectEqual(r2.ok, true, `new active row after cancelled should succeed (status=${r2.status} body=${r2.body.slice(0, 200)})`);
      } finally {
        await deleteTestPending(ctx, ruleId);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // ENTER on arrive rule defers — no immediate fire, no action_rule_log row.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'pending-dwell.enter-defers-not-fires',
    category: 'pending-dwell',
    description: 'report-location-event ENTER on arrive rule with dwell > 0 inserts pending_dwell_fires row, does NOT log fire',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestRules(ctx); },
    async teardown(ctx) { await deleteTestRules(ctx); },
    async run(ctx) {
      const ruleId = await createTestRule(ctx, 'pending-dwell-test-defer');
      try {
        const res = await adapters.call(ctx, 'report-location-event', {
          user_id: ctx.testUserId,
          rule_id: ruleId,
          lat: ENTER_LAT, lng: ENTER_LNG,
          event: 'enter',
          timestamp: new Date().toISOString(),
        }, { asService: true });
        expect2xx(res.status, 'report-location-event');
        expectEqual((res.data as any)?.deferred, true, 'response should indicate deferred=true');

        const activeCount = await countPending(ctx, ruleId, true);
        expectEqual(activeCount, 1, `expected 1 active pending row, got ${activeCount}`);

        // No fire logged — dwell hasn't completed
        const logRes = await fetch(
          `${ctx.supabaseUrl}/rest/v1/action_rule_log?rule_id=eq.${ruleId}`,
          { headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` } },
        );
        const logRows = await logRes.json();
        expectEqual(Array.isArray(logRows) ? logRows.length : -1, 0, 'action_rule_log must be empty — fire is deferred');
      } finally {
        await deleteTestPending(ctx, ruleId);
        await deleteActionLog(ctx, ruleId);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // EXIT on arrive rule cancels any active pending row.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'pending-dwell.exit-cancels-active-pending',
    category: 'pending-dwell',
    description: 'report-location-event EXIT on arrive rule cancels active pending_dwell_fires row',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestRules(ctx); },
    async teardown(ctx) { await deleteTestRules(ctx); },
    async run(ctx) {
      const ruleId = await createTestRule(ctx, 'pending-dwell-test-cancel');
      try {
        // Defer via ENTER (boundary coords clear the cold-start guard)
        const enterRes = await adapters.call(ctx, 'report-location-event', {
          user_id: ctx.testUserId,
          rule_id: ruleId,
          lat: ENTER_LAT, lng: ENTER_LNG,
          event: 'enter',
          timestamp: new Date().toISOString(),
        }, { asService: true });
        expect2xx(enterRes.status, 'report-location-event ENTER');
        expectEqual(await countPending(ctx, ruleId, true), 1, 'should have 1 active pending after ENTER');

        // Cancel via EXIT (any coords — EXIT is not gated by the guard)
        const exitRes = await adapters.call(ctx, 'report-location-event', {
          user_id: ctx.testUserId,
          rule_id: ruleId,
          lat: TEST_LAT, lng: TEST_LNG,
          event: 'exit',
          timestamp: new Date().toISOString(),
        }, { asService: true });
        expect2xx(exitRes.status, 'report-location-event EXIT');
        expectEqual((exitRes.data as any)?.cancelled, true, 'response should indicate cancelled=true');
        expectEqual(await countPending(ctx, ruleId, true), 0, 'should have 0 active pending after EXIT');
      } finally {
        await deleteTestPending(ctx, ruleId);
        await deleteActionLog(ctx, ruleId);
      }
    },
  },
];
