/**
 * T2-F1 — voice environment selection (`tests/lib/voice_env.ts`).
 *
 * Before T2 there was one voice server, so Gate 2 always tested production no
 * matter which Supabase project a run targeted. With a staging voice server
 * live, the runner must pick the voice URL from the SAME environment choice
 * that drives SUPABASE_URL, and refuse outright when the two disagree.
 *
 * ── Why these are unit tests and not "just run the suite" ──────────────────
 * The runner's fixtures perform live DELETEs before a single test executes,
 * so exercising this logic by running Gate 2 is not safe. Verifying it
 * through shell env vars is not reliable either — dotenv does not override an
 * already-set empty value, which silently defeated exactly that attempt on
 * 2026-08-19 and triggered an unintended live Gate 2 run. Hence a pure
 * function, tested directly.
 *
 * Governance: T2 follow-up T2-F1, CLAUDE.md Rule 15a.
 */

import { resolveVoiceTarget } from '../lib/voice_env';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const PROD    = 'https://naavi-voice-server-production.up.railway.app';
const STAGING = 'https://naavi-voice-staging-production.up.railway.app';

export const t2VoiceEnvTests: TestCase[] = [
  {
    id: 't2-f1.selects-staging-voice-when-supabase-is-staging',
    category: 't2-voice-env',
    description:
      'A STAGING Supabase target must select the staging voice server and allow the run. ' +
      'This is the capability T2-F1 adds — before it, Gate 2 always hit production.',
    timeoutMs: 1_000,
    async run() {
      const t = resolveVoiceTarget({ envLabel: 'STAGING', prodUrl: PROD, stagingUrl: STAGING });
      expectTruthy(t.url === STAGING, `expected the staging URL, got "${t.url}"`);
      expectTruthy(t.label === 'STAGING', `expected label STAGING, got "${t.label}"`);
      expectTruthy(t.refusal === null, `expected no refusal, got "${t.refusal}"`);
    },
  },
  {
    id: 't2-f1.selects-production-voice-when-supabase-is-production',
    category: 't2-voice-env',
    description:
      'A PRODUCTION Supabase target must still select the production voice server — T2-F1 ' +
      'must not change the pre-existing default behaviour for production runs.',
    timeoutMs: 1_000,
    async run() {
      const t = resolveVoiceTarget({ envLabel: 'PRODUCTION', prodUrl: PROD, stagingUrl: STAGING });
      expectTruthy(t.url === PROD, `expected the production URL, got "${t.url}"`);
      expectTruthy(t.label === 'PRODUCTION', `expected label PRODUCTION, got "${t.label}"`);
      expectTruthy(t.refusal === null, `expected no refusal, got "${t.refusal}"`);
    },
  },
  {
    id: 't2-f1.refuses-split-brain-staging-db-production-voice',
    category: 't2-voice-env',
    description:
      'THE CORE SAFETY CONTROL. Staging Supabase paired with the production voice server must ' +
      'be refused: Gate 2 makes live calls to the voice server while its fixtures write to ' +
      'Supabase, so a mismatch tests across two environments and can write to the wrong one.',
    timeoutMs: 1_000,
    async run() {
      const t = resolveVoiceTarget({ envLabel: 'STAGING', prodUrl: PROD, stagingUrl: PROD });
      expectTruthy(t.refusal !== null, 'a staging/production mismatch must be refused');
      expectTruthy(
        String(t.refusal).includes('split-brain'),
        `refusal should name the split-brain, got "${t.refusal}"`,
      );
    },
  },
  {
    id: 't2-f1.refuses-split-brain-production-db-staging-voice',
    category: 't2-voice-env',
    description:
      'The inverse mismatch must also be refused — production Supabase with the staging voice ' +
      'server. Guards against someone "fixing" a run by editing only one of the two values.',
    timeoutMs: 1_000,
    async run() {
      const t = resolveVoiceTarget({ envLabel: 'PRODUCTION', prodUrl: STAGING, stagingUrl: STAGING });
      expectTruthy(t.refusal !== null, 'a production/staging mismatch must be refused');
      expectTruthy(
        String(t.refusal).includes('split-brain'),
        `refusal should name the split-brain, got "${t.refusal}"`,
      );
    },
  },
  {
    id: 't2-f1.refuses-when-staging-voice-url-missing',
    category: 't2-voice-env',
    description:
      'A staging run with no STAGING_VOICE_SERVER_URL must refuse and name the variable to set — ' +
      'never silently fall back to the production voice server, which is the exact behaviour ' +
      'T2-F1 exists to remove.',
    timeoutMs: 1_000,
    async run() {
      const t = resolveVoiceTarget({ envLabel: 'STAGING', prodUrl: PROD, stagingUrl: '' });
      expectTruthy(t.refusal !== null, 'a missing staging voice URL must be refused');
      expectTruthy(
        String(t.refusal).includes('STAGING_VOICE_SERVER_URL'),
        `refusal should name the variable to set, got "${t.refusal}"`,
      );
      expectTruthy(t.url !== PROD, 'must NOT silently fall back to the production voice server');
    },
  },
  {
    id: 't2-f1.refuses-unrecognised-voice-host',
    category: 't2-voice-env',
    description:
      'An unrecognised host resolves to UNKNOWN and must be refused rather than assumed safe. ' +
      'A typo in the URL must fail loudly, not send live calls somewhere unintended.',
    timeoutMs: 1_000,
    async run() {
      const t = resolveVoiceTarget({
        envLabel: 'STAGING', prodUrl: PROD, stagingUrl: 'https://example.invalid/voice',
      });
      expectTruthy(t.label === 'UNKNOWN', `expected UNKNOWN, got "${t.label}"`);
      expectTruthy(t.refusal !== null, 'an unrecognised voice host must be refused');
    },
  },
  {
    id: 't2-f1.host-parsing-ignores-scheme-and-path',
    category: 't2-voice-env',
    description:
      'Host extraction must tolerate a trailing path or missing scheme, so a URL written with ' +
      '/voice on the end still matches its environment instead of falling through to UNKNOWN.',
    timeoutMs: 1_000,
    async run() {
      for (const variant of [
        'https://naavi-voice-staging-production.up.railway.app/voice',
        'naavi-voice-staging-production.up.railway.app',
        'http://naavi-voice-staging-production.up.railway.app/',
      ]) {
        const t = resolveVoiceTarget({ envLabel: 'STAGING', prodUrl: PROD, stagingUrl: variant });
        expectTruthy(t.label === 'STAGING', `"${variant}" should resolve STAGING, got "${t.label}"`);
        expectTruthy(t.refusal === null, `"${variant}" should not be refused`);
      }
    },
  },
];
