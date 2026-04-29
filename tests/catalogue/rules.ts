/**
 * Action rules tests — direct DB inserts + manage-rules op.
 */

import { adapters, db } from '../lib/adapters';
import { expect2xx, expectTruthy, expectArrayMinLength } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const rulesTests: TestCase[] = [
  {
    id: 'rules.insert-and-list',
    category: 'rules',
    description: 'Insert a location rule directly, then verify manage-rules op=list returns it',
    timeoutMs: 20_000,
    async run(ctx) {
      // Insert directly via service role.
      const inserted = await db.insert(ctx, 'action_rules', {
        user_id: ctx.testUserId,
        trigger_type: 'location',
        trigger_config: { place_name: 'test-home', resolved_lat: 45.42, resolved_lng: -75.69 },
        action_type: 'sms',
        action_config: { to_phone: '+10000000000', body: 'test' },
        label: 'Tester rule',
        one_shot: true,
      });
      const insertedId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
      expectTruthy(insertedId, 'insert returned id');
      ctx.log(`inserted rule id=${insertedId}`);

      // Now list via manage-rules and verify it shows up.
      const listed = await adapters.manageRules(ctx, { op: 'list' });
      expect2xx(listed.status, 'manage-rules list');
      const rules = Array.isArray(listed.data?.rules) ? listed.data.rules : [];
      expectArrayMinLength(rules, 1, 'rules array');

      const found = rules.find((r: any) => r.id === insertedId);
      expectTruthy(found, `inserted rule ${insertedId} present in list`);
      if (found.one_shot !== true) {
        throw new Error(`expected one_shot=true, got ${JSON.stringify(found.one_shot)}`);
      }
    },
  },
];
