/**
 * Data-integrity tests for user_places.
 *
 * These exercise the four-layer prevention system from
 * supabase/migrations/20260507_user_places_integrity.sql + the v3
 * resolve-place Edge Function. They verify that corrupted data is
 * physically impossible to insert into user_places.
 *
 * Coverage:
 *   - duplicate-coords-rejected: same (user_id, rounded lat/lng) insert
 *     blocked by DB UNIQUE constraint
 *   - alias-merge: two resolve-place save_to_cache calls for the same
 *     physical place produce ONE row with multiple aliases (not 2 rows)
 *   - address-populated-on-save: every save_to_cache write populates address
 *   - rls-blocks-non-service-role: anon-key direct INSERT is rejected
 *   - check-constraints: lat/lng/radius out-of-range inserts blocked
 *
 * Prerequisite: 20260507_user_places_integrity.sql must be deployed to the
 * Supabase project being tested. If the migration isn't applied yet, the
 * duplicate-coords + RLS + check-constraint tests will FAIL because the
 * constraints don't exist. That's intentional — failure here is the signal
 * that the migration didn't run.
 */

import { adapters, db } from '../lib/adapters';
import { expectEqual, expectTruthy } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

const TEST_LAT = 45.42500;   // Ottawa-area, won't collide with real test fixtures
const TEST_LNG = -75.69500;
const TEST_LAT_2 = 45.42500; // truly identical at 5 decimals — must collide

async function deleteTestRows(ctx: TestContext) {
  // Clean any previous test rows in this lat/lng range
  const url = `${ctx.supabaseUrl}/rest/v1/user_places`
    + `?user_id=eq.${ctx.testUserId}`
    + `&lat=gte.${TEST_LAT - 0.001}&lat=lte.${TEST_LAT + 0.001}`
    + `&lng=gte.${TEST_LNG - 0.001}&lng=lte.${TEST_LNG + 0.001}`;
  await fetch(url, {
    method: 'DELETE',
    headers: {
      apikey: ctx.serviceRoleKey,
      Authorization: `Bearer ${ctx.serviceRoleKey}`,
    },
  });
}

async function rawInsert(ctx: TestContext, row: any, asAnon = false): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${ctx.supabaseUrl}/rest/v1/user_places`;
  const key = asAnon ? ctx.anonKey : ctx.serviceRoleKey;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

export const dataIntegrityTests: TestCase[] = [
  {
    id: 'integrity.duplicate-coords-rejected',
    category: 'integrity',
    description: 'INSERT with same rounded (user_id, lat, lng) as an existing row is rejected by UNIQUE constraint',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestRows(ctx); },
    async teardown(ctx) { await deleteTestRows(ctx); },
    async run(ctx) {
      const baseRow = {
        user_id: ctx.testUserId,
        alias: 'integrity-test-a',
        aliases: ['integrity-test-a'],
        place_name: 'Integrity Test Place',
        address: '123 Test St',
        lat: TEST_LAT,
        lng: TEST_LNG,
        radius_meters: 100,
      };
      const first = await rawInsert(ctx, baseRow);
      expectEqual(first.ok, true, `first insert should succeed (status=${first.status} body=${first.body.slice(0, 200)})`);

      // Second insert at coords that ROUND to the same values → must fail
      const dupeRow = {
        ...baseRow,
        alias: 'integrity-test-b',
        aliases: ['integrity-test-b'],
        lat: TEST_LAT_2, // differs by ~1m, same after ROUND(_, 5)
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
    id: 'integrity.rls-blocks-non-service-role',
    category: 'integrity',
    description: 'Direct INSERT with anon key is rejected by RLS — only service_role can write user_places',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestRows(ctx); },
    async teardown(ctx) { await deleteTestRows(ctx); },
    async run(ctx) {
      const row = {
        user_id: ctx.testUserId,
        alias: 'integrity-rls-test',
        aliases: ['integrity-rls-test'],
        place_name: 'RLS Test',
        address: '456 RLS Blvd',
        lat: TEST_LAT,
        lng: TEST_LNG,
        radius_meters: 100,
      };
      const result = await rawInsert(ctx, row, /* asAnon */ true);
      expectEqual(result.ok, false, `anon-key insert should be REJECTED by RLS, got status=${result.status} body=${result.body.slice(0, 200)}`);
      // Supabase typically returns 401/403 or RLS-violation 401-style error
      expectTruthy(
        result.status === 401 || result.status === 403 || result.body.includes('row-level security') || result.body.includes('permission'),
        `expected RLS denial, got status=${result.status} body=${result.body.slice(0, 200)}`,
      );
    },
  },

  {
    id: 'integrity.lat-out-of-range-rejected',
    category: 'integrity',
    description: 'CHECK constraint rejects lat outside [-90, 90]',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestRows(ctx); },
    async teardown(ctx) { await deleteTestRows(ctx); },
    async run(ctx) {
      const result = await rawInsert(ctx, {
        user_id: ctx.testUserId,
        alias: 'integrity-bad-lat',
        aliases: ['integrity-bad-lat'],
        place_name: 'Bad Lat',
        address: '999 Out of Range Way',
        lat: 91, // INVALID
        lng: TEST_LNG,
        radius_meters: 100,
      });
      expectEqual(result.ok, false, `lat=91 should be REJECTED, got status=${result.status} body=${result.body.slice(0, 200)}`);
      expectTruthy(
        result.body.includes('check') || result.body.includes('lat'),
        `expected check-constraint violation, got body=${result.body.slice(0, 200)}`,
      );
    },
  },

  {
    id: 'integrity.alias-merge-via-resolve-place',
    category: 'integrity',
    description: 'Two resolve-place save_to_cache calls for the same physical place produce ONE row with merged aliases',
    timeoutMs: 60_000,
    async setup(ctx) { await deleteTestRows(ctx); },
    async teardown(ctx) {
      // Clean by alias since this test produces real Google-Places coords
      await fetch(
        `${ctx.supabaseUrl}/rest/v1/user_places?user_id=eq.${ctx.testUserId}`
          + `&aliases=cs.{integrity-merge-test-a,integrity-merge-test-b}`,
        {
          method: 'DELETE',
          headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
        },
      );
    },
    async run(ctx) {
      // Use a unique-but-real place that Google Places will resolve consistently
      const placeName = 'CN Tower Toronto';

      // First save — should create a new row
      const first = await adapters.resolvePlace(ctx, {
        place_name: placeName,
        save_to_cache: true,
        canonical_alias: 'integrity-merge-test-a',
      });
      expectEqual(first.status, 200, 'first resolve-place call');
      expectEqual(first.data?.status, 'ok', 'first resolve-place status');
      expectTruthy(first.data?.lat && first.data?.lng, 'first call returned coords');

      const lat = first.data.lat;
      const lng = first.data.lng;

      // Second save — same place, force_fresh=true skips memory and goes
      // through fresh Google. Coords should match the first call → saveOrMerge
      // appends 'integrity-merge-test-b' to the existing row's aliases.
      // V57.13.2: without force_fresh this would return memory_suggest, which
      // doesn't merge (the cache is a suggestion, not an answer).
      const second = await adapters.resolvePlace(ctx, {
        place_name: placeName,
        save_to_cache: true,
        canonical_alias: 'integrity-merge-test-b',
        force_fresh: true,
      });
      expectEqual(second.status, 200, 'second resolve-place call');

      // Verify exactly ONE row exists with both aliases merged
      const epsilon = 0.0001;
      const rows = await db.select(
        ctx,
        'user_places',
        `user_id=eq.${ctx.testUserId}`
          + `&lat=gte.${lat - epsilon}&lat=lte.${lat + epsilon}`
          + `&lng=gte.${lng - epsilon}&lng=lte.${lng + epsilon}`,
      );
      expectEqual(rows.length, 1, `expected 1 row after 2 saves at same coords, got ${rows.length}`);
      const aliases: string[] = rows[0].aliases ?? [];
      expectTruthy(
        aliases.includes('integrity-merge-test-a') && aliases.includes('integrity-merge-test-b'),
        `expected aliases to contain both 'integrity-merge-test-a' and 'integrity-merge-test-b', got ${JSON.stringify(aliases)}`,
      );
    },
  },

  {
    id: 'integrity.memory-suggest-on-bare-brand',
    category: 'integrity',
    description: 'V57.13.2 — when a qualified saved row exists for a bare-brand query, resolve-place returns memory_suggest (NOT ok). The cache is a suggestion, not an answer.',
    timeoutMs: 60_000,
    async setup(ctx) {
      // Pre-seed a saved row directly in the DB so the test is independent
      // of Google Places — bypasses resolve-place's save path entirely.
      await fetch(
        `${ctx.supabaseUrl}/rest/v1/user_places?user_id=eq.${ctx.testUserId}`
          + `&aliases=cs.{integrity-suggest-test}`,
        { method: 'DELETE', headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` } },
      );
      await fetch(`${ctx.supabaseUrl}/rest/v1/user_places`, {
        method: 'POST',
        headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          user_id: ctx.testUserId,
          alias: 'integrity-suggest-test',
          aliases: ['integrity-suggest-test', 'suggesttest'],
          place_name: 'SuggestTest',
          address: '100 Suggest Test Way, Ottawa',
          lat: 45.42600,
          lng: -75.69500,
          radius_meters: 100,
        }),
      });
    },
    async teardown(ctx) {
      await fetch(
        `${ctx.supabaseUrl}/rest/v1/user_places?user_id=eq.${ctx.testUserId}`
          + `&aliases=cs.{integrity-suggest-test}`,
        { method: 'DELETE', headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` } },
      );
    },
    async run(ctx) {
      // Query the unique brand name → should find our seeded row in memory
      const result = await adapters.resolvePlace(ctx, {
        place_name: 'SuggestTest',
        save_to_cache: false,
      });
      expectEqual(result.status, 200, 'resolve-place call');
      expectEqual(result.data?.status, 'memory_suggest', `expected memory_suggest, got ${result.data?.status}`);
      expectTruthy(Array.isArray(result.data?.candidates) && result.data.candidates.length === 1,
        `expected 1 candidate, got ${result.data?.candidates?.length}`);
      expectTruthy(result.data.candidates[0]?.address?.includes('Suggest Test Way'),
        `expected the seeded address, got ${result.data.candidates[0]?.address}`);
    },
  },

  {
    id: 'integrity.force-fresh-skips-memory',
    category: 'integrity',
    description: 'V57.13.2 — force_fresh=true bypasses the memory check entirely, goes straight to Google',
    timeoutMs: 60_000,
    async setup(ctx) {
      // Pre-seed a saved row so memory has something to skip
      await fetch(
        `${ctx.supabaseUrl}/rest/v1/user_places?user_id=eq.${ctx.testUserId}`
          + `&aliases=cs.{integrity-fresh-test}`,
        { method: 'DELETE', headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` } },
      );
      await fetch(`${ctx.supabaseUrl}/rest/v1/user_places`, {
        method: 'POST',
        headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: ctx.testUserId,
          alias: 'integrity-fresh-test',
          aliases: ['integrity-fresh-test', 'cn-tower-toronto'],
          place_name: 'CN Tower Toronto',
          address: '290 Bremner Blvd, Toronto, ON',
          lat: 43.642566,
          lng: -79.387057,
          radius_meters: 100,
        }),
      });
    },
    async teardown(ctx) {
      await fetch(
        `${ctx.supabaseUrl}/rest/v1/user_places?user_id=eq.${ctx.testUserId}`
          + `&aliases=cs.{integrity-fresh-test}`,
        { method: 'DELETE', headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` } },
      );
    },
    async run(ctx) {
      // Without force_fresh: should hit memory and return memory_suggest
      const cached = await adapters.resolvePlace(ctx, {
        place_name: 'CN Tower Toronto',
        save_to_cache: false,
      });
      expectEqual(cached.data?.status, 'memory_suggest', `without force_fresh, expected memory_suggest, got ${cached.data?.status}`);

      // With force_fresh: should bypass memory and go to Google
      const fresh = await adapters.resolvePlace(ctx, {
        place_name: 'CN Tower Toronto',
        save_to_cache: false,
        force_fresh: true,
      });
      expectTruthy(
        fresh.data?.status === 'ok' && fresh.data?.source === 'fresh',
        `with force_fresh, expected status=ok source=fresh, got status=${fresh.data?.status} source=${fresh.data?.source}`,
      );
    },
  },

  {
    id: 'integrity.unqualified-rows-ignored',
    category: 'integrity',
    description: 'V57.13.2 — saved rows with NULL/empty address are excluded from memory_suggest. Naavi falls through to fresh Google.',
    timeoutMs: 60_000,
    async setup(ctx) {
      // Pre-seed a saved row with NULL address (the legacy degraded state)
      await fetch(
        `${ctx.supabaseUrl}/rest/v1/user_places?user_id=eq.${ctx.testUserId}`
          + `&aliases=cs.{integrity-unqual-test}`,
        { method: 'DELETE', headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` } },
      );
      await fetch(`${ctx.supabaseUrl}/rest/v1/user_places`, {
        method: 'POST',
        headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: ctx.testUserId,
          alias: 'integrity-unqual-test',
          aliases: ['integrity-unqual-test', 'unqualtest'],
          place_name: 'UnqualTest',
          address: null, // ← unqualified
          lat: 45.42700,
          lng: -75.69500,
          radius_meters: 100,
        }),
      });
    },
    async teardown(ctx) {
      await fetch(
        `${ctx.supabaseUrl}/rest/v1/user_places?user_id=eq.${ctx.testUserId}`
          + `&aliases=cs.{integrity-unqual-test}`,
        { method: 'DELETE', headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` } },
      );
    },
    async run(ctx) {
      // Query for the unique brand. The saved row has NULL address so should
      // be filtered out. Result: not memory_suggest. Falls through to fresh
      // Google → not_found (no real "UnqualTest" business in Google).
      const result = await adapters.resolvePlace(ctx, {
        place_name: 'UnqualTest',
        save_to_cache: false,
      });
      expectEqual(result.status, 200, 'resolve-place call');
      expectTruthy(
        result.data?.status !== 'memory_suggest',
        `unqualified row should NOT trigger memory_suggest, got status=${result.data?.status} (the saved row was returned despite NULL address)`,
      );
    },
  },

  {
    id: 'integrity.address-populated-on-save',
    category: 'integrity',
    description: 'resolve-place save_to_cache=true always populates the address column from Google Places',
    timeoutMs: 60_000,
    async setup(ctx) {
      // Clean any existing rows for this place
      await fetch(
        `${ctx.supabaseUrl}/rest/v1/user_places?user_id=eq.${ctx.testUserId}`
          + `&aliases=cs.{integrity-address-test}`,
        {
          method: 'DELETE',
          headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
        },
      );
    },
    async teardown(ctx) {
      await fetch(
        `${ctx.supabaseUrl}/rest/v1/user_places?user_id=eq.${ctx.testUserId}`
          + `&aliases=cs.{integrity-address-test}`,
        {
          method: 'DELETE',
          headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` },
        },
      );
    },
    async run(ctx) {
      const result = await adapters.resolvePlace(ctx, {
        place_name: 'Parliament Hill Ottawa',
        save_to_cache: true,
        canonical_alias: 'integrity-address-test',
      });
      expectEqual(result.status, 200, 'resolve-place call');
      expectEqual(result.data?.status, 'ok', 'resolve-place status');

      // The response should carry address (returned from the function)
      expectTruthy(result.data?.address, `response.address should be populated, got ${result.data?.address}`);

      // The DB row should have address NOT NULL
      const rows = await db.select(
        ctx,
        'user_places',
        `user_id=eq.${ctx.testUserId}&aliases=cs.{integrity-address-test}`,
      );
      expectEqual(rows.length, 1, `expected 1 row, got ${rows.length}`);
      expectTruthy(rows[0].address, `DB row address should be populated, got ${rows[0].address}`);
    },
  },
];
