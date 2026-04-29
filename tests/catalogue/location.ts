/**
 * Location resolution tests.
 */

import { adapters, db } from '../lib/adapters';
import { expect2xx, expectEqual, expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const locationTests: TestCase[] = [
  {
    id: 'location.home-via-settings',
    category: 'location',
    description: '"home" resolves to settings_home when user_settings.home_address is set',
    timeoutMs: 20_000,
    async setup(ctx) {
      // Make sure the test user has a home_address in user_settings.
      await db.insert(ctx, 'user_settings', {
        user_id: ctx.testUserId,
        home_address: '962 Terranova Dr, Ottawa, Ontario',
      }).catch(async () => {
        // Row may already exist — fall back to update via PATCH.
        const url = `${ctx.supabaseUrl}/rest/v1/user_settings?user_id=eq.${ctx.testUserId}`;
        await fetch(url, {
          method: 'PATCH',
          headers: {
            'apikey': ctx.serviceRoleKey,
            'Authorization': `Bearer ${ctx.serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ home_address: '962 Terranova Dr, Ottawa, Ontario' }),
        });
      });
    },
    async run(ctx) {
      const { status, data } = await adapters.resolvePlace(ctx, { place_name: 'home' });
      expect2xx(status, 'resolve-place');
      ctx.log(`resolve-place data=${JSON.stringify(data)}`);
      expectEqual(data?.status, 'ok', 'resolve-place status');
      expectEqual(data?.source, 'settings_home', 'resolve-place source');
      expectTruthy(data?.lat && data?.lng, 'lat/lng populated');
    },
  },
];
