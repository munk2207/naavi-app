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
    platform: 'voice',
    category: 'voice-pin',
    description: 'SET — service-role + body.user_id writes the hash',
    timeoutMs: 15_000,
    async run(ctx) {
      try {
        const res = await callSet(ctx, { pin: '123456', user_id: ctx.testUserId });
        expect2xx(res.status, 'SET');
        expectEqual((res.data as any)?.success, true, 'success=true');
      } finally {
        await clearVoicePin(ctx);
      }
    },
  },

  {
    id: 'voice-pin.set-rejects-non-6-digit-pin',
    platform: 'voice',
    category: 'voice-pin',
    description: 'SET — rejects PIN that isn\'t exactly 6 digits',
    timeoutMs: 10_000,
    async run(ctx) {
      // Updated 2026-08-29: S1 changed SET from 4 digits to 6
      // (manage-voice-pin PIN_SET_RE = /^\d{6}$/). '1234' is included
      // deliberately — a 4-digit PIN was valid before S1 and must now be
      // rejected, so it is the one input that actually covers the change.
      // VERIFY is unchanged and still accepts 4 or 6; only SET tightened.
      const badPins = ['123', '1234', '12345', '1234567', 'abcdef', '12a456', '', '1.3456'];
      for (const pin of badPins) {
        const res = await callSet(ctx, { pin, user_id: ctx.testUserId });
        expectEqual(res.status, 400, `pin="${pin}" should return 400, got ${res.status}`);
        expectEqual((res.data as any)?.error, 'pin_must_be_6_digits', `error message for pin="${pin}"`);
      }
    },
  },

  {
    id: 'voice-pin.set-without-auth-returns-401',
    platform: 'voice',
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
    platform: 'voice',
    category: 'voice-pin',
    description: 'VERIFY — correct PIN returns match:true',
    timeoutMs: 15_000,
    async run(ctx) {
      try {
        await callSet(ctx, { pin: '424242', user_id: ctx.testUserId });
        const res = await callVerify(ctx, { user_id: ctx.testUserId, pin: '424242' });
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
    platform: 'voice',
    category: 'voice-pin',
    description: 'VERIFY — wrong PIN returns match:false',
    timeoutMs: 15_000,
    async run(ctx) {
      try {
        // Updated 2026-08-29: the PIN was '4242', which SET has rejected since
        // S1 required 6 digits. The set silently failed, so no PIN was stored,
        // and verifying a wrong PIN returned match:false — the expected answer
        // reached by accident. The test reported green while exercising
        // nothing. The assertion below is the guard against that recurring:
        // if the setup stops working, the test now fails instead of passing.
        const setRes = await callSet(ctx, { pin: '424242', user_id: ctx.testUserId });
        expect2xx(setRes.status, 'SET (precondition)');
        const res = await callVerify(ctx, { user_id: ctx.testUserId, pin: '000000' });
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
    platform: 'voice',
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
    platform: 'voice',
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
