/**
 * Location resolution tests.
 */

import { adapters, db } from '../lib/adapters';
import { expect2xx, expectEqual, expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

// Helper: upsert home_address for the test user.
async function setHomeAddress(ctx: Parameters<typeof locationTests[0]['run']>[0], address: string | null) {
  const url = `${ctx.supabaseUrl}/rest/v1/user_settings?user_id=eq.${ctx.testUserId}`;
  await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: ctx.serviceRoleKey,
      Authorization: `Bearer ${ctx.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ home_address: address }),
  });
}

export const locationTests: TestCase[] = [
  {
    // Test 1: routing logic only — no Google Places call needed.
    // When home_address is NOT set, resolve-place must return personal_unset (not_found
    // or ok would mean it tried Google without a valid address — routing bug).
    id: 'location.home-unset-returns-personal-unset',
    category: 'location',
    description: '"home" with no home_address set returns personal_unset — not a Google lookup',
    timeoutMs: 20_000,
    async setup(ctx) {
      await setHomeAddress(ctx, null);
    },
    async run(ctx) {
      const { status, data } = await adapters.resolvePlace(ctx, { place_name: 'home' });
      expect2xx(status, 'resolve-place');
      ctx.log(`resolve-place data=${JSON.stringify(data)}`);
      expectEqual(data?.status, 'personal_unset', 'resolve-place status');
    },
    async teardown(ctx) {
      // Restore — leave home_address null (test account has no real home).
      await setHomeAddress(ctx, null);
    },
  },
  {
    // Test 2: routing logic with address set — verifies resolve-place reads home_address
    // from user_settings and forwards it to Google Places (routing worked).
    // Does NOT assert status=ok because Google Places geocoding of a test address
    // is outside our control. Asserts only that routing happened (status !== personal_unset).
    id: 'location.home-set-routes-to-google',
    category: 'location',
    description: '"home" with home_address set routes to Google — not personal_unset',
    timeoutMs: 20_000,
    async setup(ctx) {
      await setHomeAddress(ctx, '100 Wellington St, Ottawa, Ontario');
    },
    async run(ctx) {
      const { status, data } = await adapters.resolvePlace(ctx, { place_name: 'home' });
      expect2xx(status, 'resolve-place');
      ctx.log(`resolve-place data=${JSON.stringify(data)}`);
      // Routing test: must NOT return personal_unset — that would mean home_address was ignored.
      expectTruthy(
        data?.status !== 'personal_unset',
        `resolve-place must route to Google when home_address is set, got status=${data?.status}`,
      );
    },
    async teardown(ctx) {
      await setHomeAddress(ctx, null);
    },
  },
];
