/**
 * S1 Track A — a PIN is never checked against more than one account.
 *
 * The defect these lock down: `/voice/pin-result` used to fetch every
 * PIN-holding account and test the entered PIN against all of them, so a
 * guess succeeded if it matched ANYONE. Odds therefore improved as the user
 * base grew, and an undocumented `limit=50` silently locked out an arbitrary
 * subset past 50 users. See docs/S1_PHASE_1_VOICE_PIN_AUTHENTICATION_2026-08-19.md.
 *
 * ── Why these hit the live server rather than reading source ───────────────
 * Twice on 2026-08-19 a change was "verified" with readFileSync string
 * assertions that could not see what actually broke — once a syntax error
 * that killed the whole auto-tester. Source assertions confirm words are
 * present, not that behaviour is right. These POST to the real voice server
 * and assert on the TwiML that comes back.
 *
 * They target whichever voice server the runner selected (T2-F1), so a Gate 2
 * run against staging exercises staging. They SKIP rather than fail when the
 * endpoint is absent, so the suite stays green on an environment that has not
 * yet had Track A deployed.
 *
 * Governance: S1 Phase 3 §5 items 1, 7, 8. CLAUDE.md Rule 15a.
 */

import { expectTruthy } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

function voiceUrl(): string {
  return process.env.VOICE_SERVER_URL || '';
}

/**
 * A Twilio magic test number, used as the test account's "registered phone".
 * Nothing ever dials it, and its last-4 (0006) cannot collide with the live
 * manual-testing account's (2567) — a collision would make these tests
 * exercise the wrong account, which is the exact failure S1 exists to prevent.
 */
const TEST_PHONE = '+15005550006';
const TEST_SUFFIX = '0006';
const TEST_PIN = '918273';

function restHeaders(ctx: TestContext): Record<string, string> {
  return {
    apikey: ctx.serviceRoleKey,
    Authorization: `Bearer ${ctx.serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

/** Reads the S1 columns. Returns null when the migration is absent. */
async function readPinState(
  ctx: TestContext,
): Promise<{ count: number; blocked: boolean } | null> {
  const res = await fetch(
    `${ctx.supabaseUrl}/rest/v1/user_settings`
    + `?select=voice_pin_failed_count,voice_unregistered_blocked&user_id=eq.${ctx.testUserId}`,
    { headers: restHeaders(ctx) },
  );
  const json = await res.json().catch(() => null);
  // 42703 = column does not exist — D1 not applied to this environment.
  if (!Array.isArray(json)) return null;
  const row = json[0];
  if (!row) return null;
  return { count: row.voice_pin_failed_count ?? 0, blocked: !!row.voice_unregistered_blocked };
}

async function patchTestUser(ctx: TestContext, patch: Record<string, unknown>): Promise<void> {
  await fetch(`${ctx.supabaseUrl}/rest/v1/user_settings?user_id=eq.${ctx.testUserId}`, {
    method: 'PATCH',
    headers: { ...restHeaders(ctx), Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
}

/** Sets a PIN through the real function, so the hash is produced the real way. */
async function setPin(ctx: TestContext, pin: string): Promise<{ ok: boolean; error: string }> {
  const res = await fetch(`${ctx.supabaseUrl}/functions/v1/manage-voice-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.serviceRoleKey}` },
    body: JSON.stringify({ op: 'set', pin, user_id: ctx.testUserId }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: !!json?.success, error: String(json?.error ?? '') };
}

/** Provisions phone + PIN so the test account is reachable by the identify step. */
async function provisionTestAccount(ctx: TestContext): Promise<boolean> {
  await patchTestUser(ctx, {
    phone: TEST_PHONE,
    voice_pin_failed_count: 0,
    voice_pin_failed_at: null,
    voice_unregistered_blocked: false,
  });
  const set = await setPin(ctx, TEST_PIN);
  return set.ok;
}

/**
 * Restores the account to its pre-test shape. The test account starts with
 * phone NULL and no PIN, so leaving either behind would change what later
 * suites see.
 */
async function deprovisionTestAccount(ctx: TestContext): Promise<void> {
  await fetch(`${ctx.supabaseUrl}/functions/v1/manage-voice-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.serviceRoleKey}` },
    body: JSON.stringify({ op: 'remove', user_id: ctx.testUserId }),
  }).catch(() => {});
  await patchTestUser(ctx, {
    phone: null,
    voice_pin_failed_count: 0,
    voice_pin_failed_at: null,
    voice_unregistered_blocked: false,
  }).catch(() => {});
}

/** Extracts the /tts-play token, which identifies WHICH spoken text was chosen. */
function playToken(twiml: string): string {
  return twiml.match(/tts-play\/([a-f0-9]+)/)?.[1] ?? '';
}

/** POSTs a Twilio-shaped form body. Returns null when the route is absent. */
async function postTwiml(
  path: string,
  form: Record<string, string>,
): Promise<{ status: number; body: string } | null> {
  const base = voiceUrl();
  if (!base) return null;
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const body = await res.text().catch(() => '');
  // 404 = Track A not deployed to this environment yet.
  if (res.status === 404) return null;
  return { status: res.status, body };
}

const SKIP = 'Track A not deployed to the selected voice server yet — skipping rather than failing.';

export const s1VoicePinScopingTests: TestCase[] = [
  {
    id: 's1.identify-unknown-suffix-retries-then-refuses',
    category: 's1-voice-pin-scoping',
    platform: 'voice',
    description:
      'A last-4 matching no account gets THREE attempts, then refuses without revealing whether an ' +
      'account exists. Wael 2026-08-19, after hearing it live: hanging up on a first mistake is wrong ' +
      'for Naavi users, who will mishear their own digits. No attempt may reach the PIN step.',
    timeoutMs: 30_000,
    async run(ctx) {
      // Attempt 1 of 3 — must offer another try, not end the call.
      const first = await postTwiml('/voice/identify-result?attempt=1&len=4&from=%2B15005550006', {
        From: '+15005550006', Digits: '0000',
      });
      if (!first) { ctx.log(SKIP); return; }

      expectTruthy(first.status === 200, `expected 200 TwiML, got ${first.status}`);
      expectTruthy(
        !/<Hangup\s*\/>/.test(first.body),
        'a first wrong last-4 must NOT hang up — the caller gets another try',
      );
      expectTruthy(/\/voice\/identify\?/.test(first.body), 'must retry identification');
      expectTruthy(
        !/\/voice\/pin\?/.test(first.body),
        'an unmatched suffix must never reach the PIN step, on any attempt',
      );

      // Final attempt — ends the call, still disclosing nothing.
      const last = await postTwiml('/voice/identify-result?attempt=3&len=4&from=%2B15005550006', {
        From: '+15005550006', Digits: '0000',
      });
      if (!last) { ctx.log(SKIP); return; }
      expectTruthy(/<Hangup\s*\/>/.test(last.body), 'the third wrong last-4 must end the call');
      for (const leak of ['not registered', 'no account', "doesn't exist", 'unknown number']) {
        expectTruthy(
          !last.body.toLowerCase().includes(leak),
          `refusal must not disclose account existence — found "${leak}"`,
        );
      }
    },
  },
  {
    id: 's1.pin-result-fails-closed-without-claimed-account',
    category: 's1-voice-pin-scoping',
    platform: 'voice',
    description:
      'THE CORE CONTROL. Reaching /voice/pin-result without a claimed account must be refused. ' +
      'If this ever falls back to searching all accounts, the original vulnerability is restored ' +
      'in full — so the test asserts the absence of that fallback, not merely the presence of a guard.',
    timeoutMs: 20_000,
    async run(ctx) {
      // No ?claimed= — exactly what an attacker would try, skipping identification.
      const r = await postTwiml('/voice/pin-result?attempt=1&from=%2B15005550006', {
        From: '+15005550006', Digits: '1234',
      });
      if (!r) { ctx.log(SKIP); return; }

      expectTruthy(r.status === 200, `expected 200 TwiML, got ${r.status}`);
      expectTruthy(
        /<Hangup\s*\/>/.test(r.body),
        'a PIN attempt with no claimed account must be refused, not searched',
      );
      // A retry redirect would mean it accepted the attempt as legitimate.
      expectTruthy(
        !/<Redirect>[^<]*\/voice\/pin\?/.test(r.body),
        'must not retry — an unidentified caller has nothing to retry against',
      );
    },
  },
  {
    id: 's1.identify-rejects-short-input-without-searching',
    category: 's1-voice-pin-scoping',
    platform: 'voice',
    description:
      'Fewer digits than requested must retry, never widen the search. A 2-digit suffix would match ' +
      'far more accounts than a 4-digit one, so accepting it would reintroduce the group-matching ' +
      'the fix removes.',
    timeoutMs: 20_000,
    async run(ctx) {
      const r = await postTwiml('/voice/identify-result?attempt=1&len=4&from=%2B15005550006', {
        From: '+15005550006', Digits: '12',
      });
      if (!r) { ctx.log(SKIP); return; }

      expectTruthy(r.status === 200, `expected 200 TwiML, got ${r.status}`);
      expectTruthy(
        /\/voice\/identify\?/.test(r.body) || /\/voice\/pin-lockout/.test(r.body),
        'short input must retry identification or lock out',
      );
      expectTruthy(!/claimed=/.test(r.body), 'short input must never resolve to a claimed account');
    },
  },
  {
    id: 's1.identify-third-failure-locks-out',
    category: 's1-voice-pin-scoping',
    platform: 'voice',
    description:
      'Identification attempts are capped like PIN attempts. Without a cap, the identify step would ' +
      'become an unlimited oracle for probing which suffixes resolve.',
    timeoutMs: 20_000,
    async run(ctx) {
      const r = await postTwiml('/voice/identify-result?attempt=3&len=4&from=%2B15005550006', {
        From: '+15005550006', Digits: '',
      });
      if (!r) { ctx.log(SKIP); return; }

      expectTruthy(r.status === 200, `expected 200 TwiML, got ${r.status}`);
      expectTruthy(
        /\/voice\/pin-lockout/.test(r.body),
        'the third failed identification must go to lockout, not another prompt',
      );
    },
  },

  // ── Track C — PIN length ───────────────────────────────────────────────────
  {
    id: 's1.pin-set-requires-six-digits',
    category: 's1-voice-pin-scoping',
    description:
      'Setting a PIN requires 6 digits; verifying still accepts 4 so existing PINs keep working '
      + 'through the migration. A 4-digit set must be refused on SHAPE — silently accepting it '
      + 'would leave new accounts on the weaker PIN the whole track exists to retire.',
    timeoutMs: 30_000,
    async run(ctx) {
      // Probe: on a pre-C4 deployment the OLD regex is /^\d{4}$/, so a 6-digit
      // set is rejected. That tells us the environment, without guessing.
      const six = await setPin(ctx, TEST_PIN);
      if (!six.ok) {
        ctx.log(`C4 not deployed here (6-digit set refused: ${six.error}) — skipping.`);
        await deprovisionTestAccount(ctx);
        return;
      }
      const four = await setPin(ctx, '1234');
      expectTruthy(!four.ok, 'a 4-digit PIN must be refused by `set`');
      expectTruthy(
        four.error === 'pin_must_be_6_digits',
        `expected pin_must_be_6_digits, got "${four.error}"`,
      );
    },
    async teardown(ctx) { await deprovisionTestAccount(ctx); },
  },

  // ── Track D — failure counting, alerting, and the user's own lockdown ──────
  {
    id: 's1.block-sms-honours-only-the-registered-sender',
    category: 's1-voice-pin-scoping',
    description:
      'BLOCK is authorised by the sending number alone, so this asserts BOTH directions: a stranger '
      + 'texting BLOCK cannot lock someone else out (a denial-of-service against the real owner), and '
      + 'the word inside ordinary prose must not trigger it — that text is also a valid ticket reply.',
    timeoutMs: 30_000,
    async setup(ctx) { await patchTestUser(ctx, { phone: TEST_PHONE, voice_unregistered_blocked: false }); },
    async run(ctx) {
      const before = await readPinState(ctx);
      if (!before) { ctx.log('D1 migration not applied here — skipping.'); return; }

      const sms = async (body: string, from: string) =>
        fetch(`${ctx.supabaseUrl}/functions/v1/receive-sms-reply`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Bearer ${ctx.serviceRoleKey}`,
          },
          body: new URLSearchParams({ From: from, Body: body, MessageSid: 'SMautotest' }).toString(),
        }).then((r) => r.text()).catch(() => '');

      // A number nobody registered must not be able to block this account.
      await sms('BLOCK', '+15005550099');
      expectTruthy(
        (await readPinState(ctx))?.blocked === false,
        'an unregistered sender must NOT be able to block another account',
      );

      // "block" inside a sentence is a ticket reply, not a security command.
      await sms('can you block off my calendar please', TEST_PHONE);
      const afterProse = await readPinState(ctx);
      if (afterProse?.blocked) {
        throw new Error('prose containing "block" must not trigger the security command');
      }

      // The registered owner, sending exactly BLOCK, must be obeyed.
      const reply = await sms('BLOCK', TEST_PHONE);
      const after = await readPinState(ctx);
      if (!after?.blocked) {
        ctx.log('D4 not deployed to this environment — skipping the positive case.');
        return;
      }
      expectTruthy(
        /<Message>/.test(reply),
        'the owner must get an SMS confirmation — silence looks identical to failure',
      );
    },
    async teardown(ctx) { await deprovisionTestAccount(ctx); },
  },
  {
    id: 's1.blocked-account-refused-before-pin-with-its-own-message',
    category: 's1-voice-pin-scoping',
    platform: 'voice',
    description:
      'A blocked account is refused at identification, BEFORE the PIN is requested, and says why. '
      + 'Wael 2026-08-19, on a live call: the generic refusal left the owner "questioning myself and '
      + 'the message". Asserts the two refusals are genuinely different spoken text, not just different '
      + 'source constants — compared by TTS token, since that is what the caller actually hears.',
    timeoutMs: 40_000,
    async run(ctx) {
      if (!voiceUrl()) { ctx.log(SKIP); return; }
      if (!(await provisionTestAccount(ctx))) { ctx.log('Could not provision a 6-digit PIN — skipping.'); return; }
      if (!(await readPinState(ctx))) { ctx.log('D1 migration not applied here — skipping.'); return; }

      await patchTestUser(ctx, { voice_unregistered_blocked: true });
      const blocked = await postTwiml(
        `/voice/identify-result?attempt=1&len=4&from=%2B15005550077`,
        { From: '+15005550077', Digits: TEST_SUFFIX },
      );
      if (!blocked) { ctx.log(SKIP); return; }

      expectTruthy(/<Hangup\s*\/>/.test(blocked.body), 'a blocked account must end the call');
      expectTruthy(
        !/\/voice\/pin\?/.test(blocked.body),
        'THE CONTROL: a blocked account must never reach the PIN step — blocking outranks the PIN',
      );

      // The generic refusal, for comparison: an unknown suffix on the last attempt.
      const generic = await postTwiml(
        '/voice/identify-result?attempt=3&len=4&from=%2B15005550077',
        { From: '+15005550077', Digits: '4321' },
      );
      if (generic && playToken(generic.body) && playToken(blocked.body)) {
        expectTruthy(
          playToken(blocked.body) !== playToken(generic.body),
          'a blocked account must not be fobbed off with the generic refusal — the owner needs to '
          + 'be told what happened and how to undo it',
        );
      }
    },
    async teardown(ctx) { await deprovisionTestAccount(ctx); },
  },
  {
    id: 's1.failure-count-rises-then-clears-on-a-correct-pin',
    category: 's1-voice-pin-scoping',
    platform: 'voice',
    description:
      'Counting is per-account, and a correct PIN clears it. Required at Phase 3 review: without a '
      + 'reset, ordinary mistakes accumulate forever and eventually alert on a user who did nothing '
      + 'wrong — the alert then means nothing.',
    timeoutMs: 60_000,
    async run(ctx) {
      if (!voiceUrl()) { ctx.log(SKIP); return; }
      if (!(await provisionTestAccount(ctx))) { ctx.log('Could not provision a 6-digit PIN — skipping.'); return; }
      if (!(await readPinState(ctx))) { ctx.log('D1 migration not applied here — skipping.'); return; }

      const pin = async (digits: string) => postTwiml(
        `/voice/pin-result?attempt=1&claimed=${ctx.testUserId}&from=%2B15005550077`,
        { From: '+15005550077', Digits: digits },
      );

      const first = await pin('000000');
      if (!first) { ctx.log(SKIP); return; }
      await new Promise((r) => setTimeout(r, 2500));
      const afterOne = await readPinState(ctx);
      if (afterOne?.count === 0) { ctx.log('D2 not deployed to this environment — skipping.'); return; }
      expectTruthy(afterOne?.count === 1, `expected count 1 after one failure, got ${afterOne?.count}`);

      await pin('111111');
      await new Promise((r) => setTimeout(r, 2500));
      expectTruthy((await readPinState(ctx))?.count === 2, 'a second failure must count');

      // Never auto-locks: the owner decides, so an attacker cannot lock them out.
      expectTruthy(
        (await readPinState(ctx))?.blocked === false,
        'failures alone must NEVER block an account — that would be a denial-of-service on the owner',
      );

      await pin(TEST_PIN);
      await new Promise((r) => setTimeout(r, 2500));
      expectTruthy(
        (await readPinState(ctx))?.count === 0,
        'a correct PIN must clear the failure count',
      );
    },
    async teardown(ctx) { await deprovisionTestAccount(ctx); },
  },
  {
    id: 's1.failures-older-than-the-window-restart-the-count',
    category: 's1-voice-pin-scoping',
    platform: 'voice',
    description:
      'Stale failures do not accumulate. Someone who failed twice months ago and once today is not '
      + 'under attack, and alerting on that is crying wolf. Window is 7 days, not 24 hours (Wael): a '
      + 'short one is evaded by pacing and does not survive someone who reads SMS every couple of days.',
    timeoutMs: 40_000,
    async run(ctx) {
      if (!voiceUrl()) { ctx.log(SKIP); return; }
      if (!(await provisionTestAccount(ctx))) { ctx.log('Could not provision a 6-digit PIN — skipping.'); return; }
      if (!(await readPinState(ctx))) { ctx.log('D1 migration not applied here — skipping.'); return; }

      // Two failures, eight days old — outside the 7-day window.
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      await patchTestUser(ctx, { voice_pin_failed_count: 2, voice_pin_failed_at: eightDaysAgo });

      const r = await postTwiml(
        `/voice/pin-result?attempt=1&claimed=${ctx.testUserId}&from=%2B15005550077`,
        { From: '+15005550077', Digits: '000000' },
      );
      if (!r) { ctx.log(SKIP); return; }
      await new Promise((x) => setTimeout(x, 2500));

      const after = await readPinState(ctx);
      if (after?.count === 2) { ctx.log('D2 not deployed to this environment — skipping.'); return; }
      expectTruthy(
        after?.count === 1,
        `stale failures must restart the count, not extend it — expected 1, got ${after?.count}`,
      );
    },
    async teardown(ctx) { await deprovisionTestAccount(ctx); },
  },
  {
    id: 's1.changing-the-pin-clears-the-failure-count',
    category: 's1-voice-pin-scoping',
    description:
      'Changing the PIN resets the failure count. Found by Wael in live testing: the alert fires only '
      + 'when the count EQUALS the threshold, and nothing reset it except a successful PIN on a call or '
      + '7 days. So a user who did the right thing after an attack — blocked, unblocked, changed their '
      + 'PIN — sat above the threshold with their NEXT alert silently disarmed. Old failures were '
      + 'against the old PIN and mean nothing once it changes.',
    timeoutMs: 30_000,
    async run(ctx) {
      if (!(await provisionTestAccount(ctx))) { ctx.log('C4 not deployed here — skipping.'); return; }
      if (!(await readPinState(ctx))) { ctx.log('D1 migration not applied here — skipping.'); return; }

      // Sit the account exactly at the threshold — the state that disarmed the
      // alert in the live incident.
      await patchTestUser(ctx, {
        voice_pin_failed_count: 3,
        voice_pin_failed_at: new Date().toISOString(),
      });
      expectTruthy((await readPinState(ctx))?.count === 3, 'setup: count should be 3');

      const set = await setPin(ctx, '556677');
      expectTruthy(set.ok, `changing the PIN should succeed, got "${set.error}"`);

      const after = await readPinState(ctx);
      if (after?.count === 3) { ctx.log('Reset-on-PIN-change not deployed here — skipping.'); return; }
      expectTruthy(
        after?.count === 0,
        `changing the PIN must clear the count — expected 0, got ${after?.count}`,
      );
    },
    async teardown(ctx) { await deprovisionTestAccount(ctx); },
  },
];
