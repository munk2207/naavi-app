/**
 * T2 — outbound_guard behavioral tests.
 *
 * These are REAL behavioral tests, not source-string assertions. The guard
 * module is Deno code, but every `Deno.env.get` call sits inside a function
 * body (nothing at module scope), so stubbing `globalThis.Deno` before invoking
 * the exports exercises the actual shipped logic under Node.
 *
 * ── The test that matters most ─────────────────────────────────────────────
 * `guard-is-inert-when-secret-absent`. This module sits on the send path of
 * every alert channel the product has. If it ever blocks in production, the
 * failure is silent alert loss — which the Architecture Reference describes as
 * "invisible until the user notices it never happened." Production never sets
 * OUTBOUND_ALLOWLIST, so "no secret → allow" is the property that makes this
 * change safe to deploy at all. Everything else here is secondary to it.
 *
 * Governance: T2 Phase 2 §2 Track E, CLAUDE.md Rule 15a.
 */

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const GUARD_URL = pathToFileURL(
  join(process.cwd(), 'supabase', 'functions', '_shared', 'outbound_guard.ts'),
).href;

/** Loads the guard with a stubbed Deno env. Fresh import each time. */
async function loadGuard(env: Record<string, string>) {
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (k: string) => env[k] },
  };
  // Cache-bust so each case gets a module instance reading the current stub.
  return await import(`${GUARD_URL}?t=${Date.now()}${Math.random()}`);
}

const PROD_NUMBER = '+12495235394';

export const t2OutboundGuardTests: TestCase[] = [
  {
    id: 't2.outbound-guard.inert-when-secret-absent',
    category: 't2-outbound-guard',
    description:
      'CRITICAL production-safety control. With OUTBOUND_ALLOWLIST unset, every send must be ' +
      'allowed and the guard must report itself not enforced. Production never sets this secret, ' +
      'so a regression here means silent alert loss for real users.',
    timeoutMs: 5_000,
    async run() {
      const { guardDestination } = await loadGuard({ SUPABASE_URL: '' });
      for (const [dest, ch] of [
        ['+16137697957', 'sms'],
        ['someone@example.com', 'email'],
        ['+14165551234', 'voice'],
        ['', 'sms'],                       // even a malformed destination must pass through
      ] as Array<[string, string]>) {
        const r = guardDestination(dest, ch, 'test');
        expectTruthy(r.allowed === true, `unset allowlist must allow ${ch} to "${dest}"`);
        expectTruthy(r.enforced === false, `unset allowlist must report enforced=false for "${dest}"`);
      }
    },
  },
  {
    id: 't2.outbound-guard.inert-when-secret-empty',
    category: 't2-outbound-guard',
    description:
      'An empty or whitespace-only OUTBOUND_ALLOWLIST must behave exactly like an absent one. ' +
      'A blank secret set by accident must not silently block every outbound message.',
    timeoutMs: 5_000,
    async run() {
      for (const val of ['', '   ', ',', ' , , ']) {
        const { guardDestination } = await loadGuard({ OUTBOUND_ALLOWLIST: val });
        const r = guardDestination('+16137697957', 'sms', 'test');
        expectTruthy(r.allowed === true, `allowlist "${val}" must allow (treated as inert)`);
        expectTruthy(r.enforced === false, `allowlist "${val}" must report enforced=false`);
      }
    },
  },
  {
    id: 't2.outbound-guard.allows-allowlisted-phone-any-format',
    category: 't2-outbound-guard',
    description:
      'A phone number on the allowlist must be allowed regardless of formatting — +1XXX, 1XXX, ' +
      'bare 10-digit, and punctuated forms all describe the same phone and must all match.',
    timeoutMs: 5_000,
    async run() {
      const { guardDestination } = await loadGuard({ OUTBOUND_ALLOWLIST: '+16137697957' });
      for (const form of ['+16137697957', '16137697957', '6137697957', '(613) 769-7957', '613-769-7957']) {
        const r = guardDestination(form, 'sms', 'test');
        expectTruthy(r.allowed === true, `"${form}" must match allowlisted +16137697957`);
        expectTruthy(r.enforced === true, `"${form}" must report enforced=true`);
      }
    },
  },
  {
    id: 't2.outbound-guard.blocks-non-allowlisted-phone',
    category: 't2-outbound-guard',
    description:
      'The core containment property: with the allowlist active, a phone number not on it must be ' +
      'blocked. This is what stops a staging test call from texting a real stranger.',
    timeoutMs: 5_000,
    async run() {
      const { guardDestination } = await loadGuard({ OUTBOUND_ALLOWLIST: '+16137697957' });
      for (const dest of ['+14165551234', '4165551234', '+15145550100']) {
        const r = guardDestination(dest, 'sms', 'test');
        expectTruthy(r.allowed === false, `"${dest}" must be blocked — not on the allowlist`);
        expectTruthy(r.enforced === true, `"${dest}" must report enforced=true`);
        expectTruthy(typeof r.reason === 'string' && r.reason.length > 0, 'a block must carry a reason');
      }
    },
  },
  {
    id: 't2.outbound-guard.email-matching-is-case-insensitive',
    category: 't2-outbound-guard',
    description:
      'Email destinations must match case-insensitively, and a non-allowlisted address must be ' +
      'blocked. Covers the send-user-email path, which has the widest caller set (8 call sites).',
    timeoutMs: 5_000,
    async run() {
      const { guardDestination } = await loadGuard({ OUTBOUND_ALLOWLIST: 'Test.User@Example.COM' });
      for (const ok of ['test.user@example.com', 'TEST.USER@EXAMPLE.COM', ' Test.User@Example.com ']) {
        expectTruthy(
          guardDestination(ok, 'email', 'test').allowed === true,
          `"${ok}" must match the allowlisted address case-insensitively`,
        );
      }
      expectTruthy(
        guardDestination('someone.else@example.com', 'email', 'test').allowed === false,
        'a non-allowlisted email must be blocked',
      );
    },
  },
  {
    id: 't2.outbound-guard.fails-closed-on-empty-destination-when-enforced',
    category: 't2-outbound-guard',
    description:
      'With the guard ACTIVE, an empty or unparseable destination must be blocked, not allowed. ' +
      'Under enforcement we are in a non-production environment, and "could not tell where this ' +
      'was going" must never resolve to "send it." Contrast with the inert case, which passes ' +
      'everything through unchanged.',
    timeoutMs: 5_000,
    async run() {
      const { guardDestination } = await loadGuard({ OUTBOUND_ALLOWLIST: '+16137697957' });
      for (const bad of ['', '   ', null as unknown as string, undefined as unknown as string]) {
        const r = guardDestination(bad, 'sms', 'test');
        expectTruthy(r.allowed === false, `empty destination "${String(bad)}" must fail closed when enforced`);
      }
    },
  },
  {
    id: 't2.outbound-guard.multi-entry-allowlist',
    category: 't2-outbound-guard',
    description:
      'A comma-separated allowlist mixing phones and emails must match any entry and block the rest.',
    timeoutMs: 5_000,
    async run() {
      const { guardDestination } = await loadGuard({
        OUTBOUND_ALLOWLIST: '+16137697957, +13433332567 , robert.esm.2207@gmail.com',
      });
      for (const ok of ['+16137697957', '+13433332567', 'robert.esm.2207@gmail.com']) {
        expectTruthy(guardDestination(ok, 'sms', 'test').allowed === true, `"${ok}" must be allowed`);
      }
      expectTruthy(
        guardDestination('+14165551234', 'sms', 'test').allowed === false,
        'an entry not on the multi-entry list must still be blocked',
      );
    },
  },
  {
    id: 't2.outbound-guard.caller-id-defaults-to-production-number',
    category: 't2-outbound-guard',
    description:
      'Track F production-safety control. With VOICE_CALL_FROM_NUMBER unset, resolveCallerId() must ' +
      `return the existing production number (${PROD_NUMBER}) so production caller ID is unchanged.`,
    timeoutMs: 5_000,
    async run() {
      for (const env of [{}, { VOICE_CALL_FROM_NUMBER: '' }, { VOICE_CALL_FROM_NUMBER: '   ' }]) {
        const { resolveCallerId } = await loadGuard(env as Record<string, string>);
        expectTruthy(
          resolveCallerId() === PROD_NUMBER,
          `unset/blank VOICE_CALL_FROM_NUMBER must return ${PROD_NUMBER}, got ${resolveCallerId()}`,
        );
      }
    },
  },
  {
    id: 't2.outbound-guard.caller-id-honors-staging-override',
    category: 't2-outbound-guard',
    description:
      'With VOICE_CALL_FROM_NUMBER set, resolveCallerId() must return it — so a staging outbound ' +
      'call never presents as production Naavi and a callback reaches staging, not production.',
    timeoutMs: 5_000,
    async run() {
      const { resolveCallerId } = await loadGuard({ VOICE_CALL_FROM_NUMBER: ' +18734462284 ' });
      expectTruthy(
        resolveCallerId() === '+18734462284',
        `override must be returned trimmed, got ${resolveCallerId()}`,
      );
    },
  },
  {
    id: 't2.outbound-guard.project-ref-resolved-at-runtime',
    category: 't2-outbound-guard',
    description:
      'Phase 0 Requirement 4: evidence must prove "this transaction executed in staging," not ' +
      '"the env var was configured for staging." resolveProjectRef() parses the ref from the ' +
      'SUPABASE_URL actually in effect at runtime.',
    timeoutMs: 5_000,
    async run() {
      const cases: Array<[string, string]> = [
        ['https://xugvnfudofuskxoknhve.supabase.co', 'xugvnfudofuskxoknhve'],
        ['https://hhgyppbxgmjrwdpdubcx.supabase.co', 'hhgyppbxgmjrwdpdubcx'],
        ['', 'unknown'],
        ['not-a-url', 'unknown'],
      ];
      for (const [url, expected] of cases) {
        const { resolveProjectRef } = await loadGuard({ SUPABASE_URL: url });
        expectTruthy(
          resolveProjectRef() === expected,
          `SUPABASE_URL "${url}" must resolve to "${expected}", got "${resolveProjectRef()}"`,
        );
      }
    },
  },
];
