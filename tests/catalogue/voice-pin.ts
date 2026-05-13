/**
 * voice-pin tests — manage-voice-pin Edge Function (Wael 2026-05-13).
 *
 * Covers the 4-digit caller PIN flow used by the voice server to
 * identify users calling from unregistered phones. Spec:
 * project_naavi_caller_pin_chosen_over_biometric.md.
 *
 * Verified:
 *   - SET with service-role + body.user_id (voice server path)
 *   - SET rejects without auth (401)
 *   - SET rejects non-4-digit PIN (400)
 *   - VERIFY with correct PIN → match:true
 *   - VERIFY with wrong PIN → match:false
 *   - VERIFY when user has no PIN → match:false (same shape, no enumeration)
 *   - VERIFY without service-role → 401
 *
 * Test isolation: each test uses ctx.testUserId; SET overrides the
 * stored hash and the teardown step nulls voice_pin_hash so other
 * tests don't see leftover state.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectEqual, expectTruthy } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

async function clearVoicePin(ctx: TestContext): Promise<void> {
  await fetch(
    `${ctx.supabaseUrl}/rest/v1/user_settings?user_id=eq.${ctx.testUserId}`,
    {
      method: 'PATCH',
      headers: {
        apikey: ctx.serviceRoleKey,
        Authorization: `Bearer ${ctx.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ voice_pin_hash: null, voice_pin_set_at: null }),
    },
  );
}

async function callSet(ctx: TestContext, args: { pin: string; user_id?: string }, opts: { asService?: boolean; raw?: boolean } = {}) {
  const body: any = { op: 'set', pin: args.pin };
  if (args.user_id) body.user_id = args.user_id;
  return adapters.call(ctx, 'manage-voice-pin', body, { asService: opts.asService ?? true });
}

async function callVerify(ctx: TestContext, args: { user_id: string; pin: string }, opts: { asService?: boolean } = {}) {
  return adapters.call(ctx, 'manage-voice-pin', {
    op: 'verify',
    user_id: args.user_id,
    pin: args.pin,
  }, { asService: opts.asService ?? true });
}

// No-auth call — bypass adapter to send WITHOUT any Authorization header.
async function callNoAuth(ctx: TestContext, body: any): Promise<{ status: number; data: any }> {
  const res = await fetch(`${ctx.supabaseUrl}/functions/v1/manage-voice-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

export const voicePinTests: TestCase[] = [
  {
    id: 'voice-pin.set-with-service-role-succeeds',
    category: 'voice-pin',
    description: 'SET — service-role + body.user_id writes the hash',
    timeoutMs: 15_000,
    async run(ctx) {
      try {
        const res = await callSet(ctx, { pin: '1234', user_id: ctx.testUserId });
        expect2xx(res.status, 'SET');
        expectEqual((res.data as any)?.success, true, 'success=true');
      } finally {
        await clearVoicePin(ctx);
      }
    },
  },

  {
    id: 'voice-pin.set-rejects-non-4-digit-pin',
    category: 'voice-pin',
    description: 'SET — rejects PIN that isn\'t exactly 4 digits',
    timeoutMs: 10_000,
    async run(ctx) {
      const badPins = ['123', '12345', 'abcd', '12a4', '', '1.34'];
      for (const pin of badPins) {
        const res = await callSet(ctx, { pin, user_id: ctx.testUserId });
        expectEqual(res.status, 400, `pin="${pin}" should return 400, got ${res.status}`);
        expectEqual((res.data as any)?.error, 'pin_must_be_4_digits', `error message for pin="${pin}"`);
      }
    },
  },

  {
    id: 'voice-pin.set-without-auth-returns-401',
    category: 'voice-pin',
    description: 'SET — no Authorization header → 401 auth_required',
    timeoutMs: 10_000,
    async run(ctx) {
      const res = await callNoAuth(ctx, { op: 'set', pin: '1234' });
      expectEqual(res.status, 401, `expected 401, got ${res.status}`);
      expectEqual((res.data as any)?.error, 'auth_required', 'error=auth_required');
    },
  },

  {
    id: 'voice-pin.verify-correct-pin-returns-match-true',
    category: 'voice-pin',
    description: 'VERIFY — correct PIN returns match:true',
    timeoutMs: 15_000,
    async run(ctx) {
      try {
        await callSet(ctx, { pin: '4242', user_id: ctx.testUserId });
        const res = await callVerify(ctx, { user_id: ctx.testUserId, pin: '4242' });
        expect2xx(res.status, 'VERIFY');
        expectEqual((res.data as any)?.success, true, 'success=true');
        expectEqual((res.data as any)?.match,   true, 'match=true');
      } finally {
        await clearVoicePin(ctx);
      }
    },
  },

  {
    id: 'voice-pin.verify-wrong-pin-returns-match-false',
    category: 'voice-pin',
    description: 'VERIFY — wrong PIN returns match:false',
    timeoutMs: 15_000,
    async run(ctx) {
      try {
        await callSet(ctx, { pin: '4242', user_id: ctx.testUserId });
        const res = await callVerify(ctx, { user_id: ctx.testUserId, pin: '0000' });
        expect2xx(res.status, 'VERIFY');
        expectEqual((res.data as any)?.success, true,  'success=true');
        expectEqual((res.data as any)?.match,   false, 'match=false');
      } finally {
        await clearVoicePin(ctx);
      }
    },
  },

  {
    id: 'voice-pin.verify-no-pin-set-returns-match-false',
    category: 'voice-pin',
    description: 'VERIFY — user with no PIN returns match:false (same shape, no enumeration)',
    timeoutMs: 10_000,
    async run(ctx) {
      // Make sure no PIN is set.
      await clearVoicePin(ctx);
      const res = await callVerify(ctx, { user_id: ctx.testUserId, pin: '4242' });
      expect2xx(res.status, 'VERIFY');
      expectEqual((res.data as any)?.success, true,  'success=true');
      expectEqual((res.data as any)?.match,   false, 'match=false (no PIN should not 404)');
      // Same response shape as wrong-PIN — caller cannot distinguish.
      expectTruthy(!('error' in (res.data ?? {})), 'no error field present (would leak PIN-not-set vs wrong-PIN)');
    },
  },

  {
    id: 'voice-pin.verify-without-service-role-returns-401',
    category: 'voice-pin',
    description: 'VERIFY — anon-key call → 401 service_role_required (no PIN enumeration via JWT)',
    timeoutMs: 10_000,
    async run(ctx) {
      // anon-key, NOT service-role — should be rejected.
      const res = await fetch(`${ctx.supabaseUrl}/functions/v1/manage-voice-pin`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${ctx.anonKey}`,
        },
        body: JSON.stringify({ op: 'verify', user_id: ctx.testUserId, pin: '1234' }),
      });
      const text = await res.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      expectEqual(res.status, 401, `expected 401, got ${res.status}`);
      expectEqual((data as any)?.error, 'service_role_required', 'error=service_role_required');
    },
  },
];
