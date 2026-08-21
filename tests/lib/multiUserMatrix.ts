/**
 * multiUserMatrix — generator for the per-Edge-Function multi-user safety
 * test matrix described in docs/TEST_CATALOGUE.md Category 8.
 *
 * One call emits the canonical 4-test matrix (matrix tests a-d) for a single
 * Edge Function. Plus optional cross-user isolation tests when a second test
 * user is configured.
 *
 * Why this exists: writing 48 tests (12 Edge Functions × 4 tests) by hand
 * is tedious AND error-prone. The Hussein-routing bug we found 2026-04-29
 * survived for months partly because nobody had cycles to write 48
 * near-identical tests. With this helper, one line per function = full
 * coverage.
 *
 * Usage:
 *
 *   import { multiUserMatrix } from '../lib/multiUserMatrix';
 *
 *   export const manageRulesMatrix = multiUserMatrix({
 *     fnName: 'manage-rules',
 *     description: 'manage-rules op=list',
 *     body: { op: 'list' },
 *     validateOk: (data) => Array.isArray(data?.rules),
 *   });
 */

import { adapters } from './adapters';
import { expectEqual, expectTruthy } from './assertions';
import type { TestCase, TestContext } from './types';

export interface MatrixSpec {
  /** Edge Function name (without /functions/v1/ prefix). */
  fnName: string;
  /** Human-readable description of what this function does. */
  description: string;
  /** Request body shape (without `user_id` — generator adds/omits as needed). */
  body: Record<string, any>;
  /** Validator for a successful response. Receives the response data. */
  validateOk?: (data: any) => boolean;
  /**
   * Status codes that indicate "user resolution succeeded" even when the
   * function ultimately failed for non-auth reasons (e.g. Twilio rejected
   * a test phone number, OAuth token expired). The matrix's body-userid
   * test passes if the response status is in this set.
   * Default: [200..299].
   */
  userResolvedStatuses?: number[];
  /** If true, skip the "JWT for user A" tests (no JWT fixture available). */
  skipJwtTests?: boolean;
  /** Override timeout for slow functions (default 20_000 ms). */
  timeoutMs?: number;
}

/**
 * Helper — call an Edge Function with explicit auth control.
 * Bypasses adapters.call() so we can opt out of authorization headers.
 */
async function call(
  ctx: TestContext,
  fnName: string,
  body: any,
  opts: { mode: 'anon' | 'service' | 'none'; timeoutMs?: number },
): Promise<{ status: number; data: any }> {
  const url = `${ctx.supabaseUrl}/functions/v1/${fnName}`;
  const { mode, timeoutMs = 20_000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (mode === 'anon') {
    headers['Authorization'] = `Bearer ${ctx.anonKey}`;
  } else if (mode === 'service') {
    headers['Authorization'] = `Bearer ${ctx.serviceRoleKey}`;
    headers['apikey'] = ctx.serviceRoleKey;
  }
  // mode === 'none' → no Authorization header at all

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data: any = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate the 4-test matrix for one Edge Function.
 *
 * Tests produced (with category='multiuser'):
 *   a) jwt-resolves-to-A         (skipped if skipJwtTests:true)
 *   b) body-userid-resolves-to-A
 *   c) no-auth-no-body-rejects   (must NOT bind to first user — Hussein bug)
 *   d) jwt-overrides-body-userid (skipped if skipJwtTests:true)
 */
export function multiUserMatrix(spec: MatrixSpec): TestCase[] {
  const { fnName, description, body, validateOk, userResolvedStatuses, skipJwtTests = true, timeoutMs = 20_000 } = spec;
  const tests: TestCase[] = [];

  // Default: 200-299 means user resolved. Caller can extend (e.g. send-sms
  // returns 502 when Twilio rejects the test number — but the function
  // already resolved the user, which is what this matrix is testing).
  const acceptStatuses = userResolvedStatuses ?? Array.from({ length: 100 }, (_, i) => 200 + i);
  const isUserResolved = (status: number) => acceptStatuses.includes(status);

  // ── Test (b): body user_id resolves to caller's claimed user ──────────────
  // This is the path the voice server uses, and was broken in naavi-chat
  // until 2026-04-29 (Hussein-routing bug).
  tests.push({
    id: `multiuser.${fnName}.body-userid-resolves`,
    category: 'chat', // re-using existing category until we add 'multiuser' to the enum
    description: `[multi-user] ${description}: body user_id is honored`,
    timeoutMs,
    async run(ctx) {
      const { status, data } = await call(
        ctx,
        fnName,
        { ...body, user_id: ctx.testUserId },
        { mode: 'anon', timeoutMs },
      );
      ctx.log(`status=${status} data=${JSON.stringify(data).slice(0, 200)}`);

      if (!isUserResolved(status)) {
        throw new Error(`expected user-resolved status (default 2xx, or override), got ${status}: ${JSON.stringify(data).slice(0, 200)}`);
      }
      // Validator only runs on 2xx responses (where the function fully
      // succeeded). Non-2xx user-resolved statuses (502 etc.) skip it.
      if (status >= 200 && status < 300 && validateOk && !validateOk(data)) {
        throw new Error(`validateOk returned false. data=${JSON.stringify(data).slice(0, 200)}`);
      }
    },
  });

  // ── Test (c): no auth + no body user_id → MUST reject (NOT bind to anyone) ──
  // This is the Hussein bug guard. If this passes, the function is correctly
  // rejecting unauthenticated calls instead of silently picking "first user".
  tests.push({
    id: `multiuser.${fnName}.no-auth-no-body-rejects`,
    category: 'chat',
    description: `[multi-user] ${description}: rejects when no JWT and no body user_id (Hussein-bug guard)`,
    timeoutMs,
    async run(ctx) {
      const { status, data } = await call(
        ctx,
        fnName,
        { ...body }, // no user_id
        { mode: 'anon', timeoutMs },
      );
      ctx.log(`status=${status} data=${JSON.stringify(data).slice(0, 200)}`);

      // We accept 401 (preferred), 400, 200 with an explicit error, or a
      // staging outbound BLOCK.
      //
      // `blocked: true` added 2026-08-21. T2's outbound guard returns
      // 200 { success: false, blocked: true, … } — deliberately 200, so callers
      // do not read a staging block as a delivery failure and retry. Without
      // this clause the guard looks like success and the check below fires.
      //
      // ⚠️ Worth knowing WHY that mattered, because it says something about this
      // assertion rather than about the guard: on send-sms this test was never
      // demonstrating what its name claims. It passed because the payload uses a
      // fictional number (+15555550100) that TWILIO rejected, producing an error
      // status — not because send-sms refused an unauthenticated caller. The
      // guard simply intercepted before Twilio could, and removed the accident
      // that made it green.
      //
      // What this test genuinely proves for every function in the matrix is the
      // Hussein-bug guard: that no function falls back to "first user" when
      // given neither a JWT nor a body user_id. send-sms passes that on the
      // merits — resolveUserId returns null and nothing is attributed. Whether
      // an unauthenticated caller should be able to reach Twilio AT ALL on
      // production, where the guard is inert by design, is a different question
      // and is tracked separately as T11.
      const looksLikeError =
        (status >= 400 && status < 500) ||
        (data && typeof data.error === 'string' && data.error.length > 0) ||
        (data && data.blocked === true);

      if (!looksLikeError) {
        throw new Error(
          `SAFETY VIOLATION — function returned 2xx with data when no auth and no user_id provided. ` +
          `It may have bound to some user (the Hussein bug), or completed an action it should have refused. ` +
          `status=${status} data=${JSON.stringify(data).slice(0, 200)}`,
        );
      }
    },
  });

  // ── Tests (a) and (d) are skipped by default — require JWT minting ────────
  if (!skipJwtTests) {
    tests.push({
      id: `multiuser.${fnName}.jwt-resolves`,
      category: 'chat',
      description: `[multi-user] ${description}: JWT for user A resolves to A`,
      timeoutMs,
      async run(ctx) {
        // TODO: requires JWT fixture for ctx.testUserId. See
        // docs/TEST_CATALOGUE.md Category 8 setup notes.
        throw new Error('JWT fixture not yet implemented — set skipJwtTests:false when ready');
      },
    });

    tests.push({
      id: `multiuser.${fnName}.jwt-overrides-body-userid`,
      category: 'chat',
      description: `[multi-user] ${description}: JWT for A wins over body user_id=B`,
      timeoutMs,
      async run(ctx) {
        throw new Error('JWT fixture not yet implemented — set skipJwtTests:false when ready');
      },
    });
  }

  return tests;
}
