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
import type { TestCase } from '../lib/types';

function voiceUrl(): string {
  return process.env.VOICE_SERVER_URL || '';
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
    id: 's1.identify-unknown-suffix-refuses-without-disclosure',
    category: 's1-voice-pin-scoping',
    platform: 'voice',
    description:
      'A last-4 that matches no account must be refused WITHOUT revealing whether an account exists. ' +
      'Saying "that number is not registered" would turn the phone line into an account-existence oracle ' +
      '(S1 Phase 3 §5 item 8).',
    timeoutMs: 20_000,
    async run(ctx) {
      const r = await postTwiml('/voice/identify-result?attempt=1&len=4&from=%2B15005550006', {
        From: '+15005550006', Digits: '0000',
      });
      if (!r) { ctx.log(SKIP); return; }

      expectTruthy(r.status === 200, `expected 200 TwiML, got ${r.status}`);
      expectTruthy(/<Hangup\s*\/>/.test(r.body), 'an unknown suffix must end the call');
      // Must NOT confirm or deny existence.
      for (const leak of ['not registered', 'no account', "doesn't exist", 'unknown number']) {
        expectTruthy(
          !r.body.toLowerCase().includes(leak),
          `refusal must not disclose account existence — found "${leak}"`,
        );
      }
      // Must NOT fall through to asking for a PIN.
      expectTruthy(!/\/voice\/pin\b/.test(r.body), 'an unknown suffix must never reach the PIN step');
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
];
