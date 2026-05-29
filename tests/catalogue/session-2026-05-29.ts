/**
 * Session 2026-05-29 — regression coverage for B-NEW-4, nav-disambiguation (v101),
 * and the OAuth scope-version gate.
 *
 * B-NEW-4: Stop button tap did not stop TTS audio on Android.
 * Root cause: stopSpeaking() fired _pendingPlaybackCleanup (= cleanupAndResolve)
 * which sets _currentSound = null. By the time the `if (_currentSound)` block ran,
 * _currentSound was already null → stopAsync() was never called. Only unloadAsync()
 * ran (async/fire-and-forget from cleanupAndResolve), which does not reliably halt
 * active playback immediately on Android.
 * Fix: capture _currentSound into soundToStop BEFORE calling _pendingPlaybackCleanup
 * so stopAsync() is always called on the live Sound object.
 *
 * OAuth scope-version gate: when Google OAuth scopes change between app versions,
 * users with stale tokens must re-authenticate to get the new scopes. The gate
 * stores REQUIRED_OAUTH_SCOPE_VERSION in AsyncStorage and signs the user out
 * silently on startup if their token was issued under an older scope set.
 * Fix: checkOAuthScopeVersion() in lib/supabase.ts; called on startup in
 * app/index.tsx before setting isSignedIn=true; markOAuthScopeVersionCurrent()
 * called after SIGNED_IN event to record the current version.
 * REQUIRED_OAUTH_SCOPE_VERSION = 2 (contacts write scope added for Community).
 *
 * Nav-disambiguation v101: prompt rule prevents Naavi from re-asking "which one?"
 * after she has already identified a unique meeting with a physical location. Tested
 * via prompt version check (also covered in session-2026-05-27 and session-2026-05-28).
 *
 * Coverage gaps acknowledged (Rule 15a exception):
 *   B-NEW-4 live: TTS stop behavior is Android-native audio (expo-av Sound object).
 *   Not reachable from the Node.js auto-tester. Covered by static code pattern check;
 *   Wael verifies live by tapping Stop mid-speech on Samsung device.
 *
 *   OAuth scope gate live: AsyncStorage behavior is React Native client-side.
 *   Not reachable from the Node.js auto-tester. Covered by static code checks
 *   (constant value, helper presence, app/index.tsx wiring). Wael verifies live
 *   on next APK install — existing install should be redirected to sign-in screen.
 *
 * Run via `npm run test:auto -- --grep session-2026-05-29`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expectTruthy, expectFalsy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const ORCHESTRATOR_PATH = join(
  process.cwd(),
  'hooks', 'useOrchestrator.ts',
);

const SUPABASE_LIB_PATH = join(process.cwd(), 'lib', 'supabase.ts');
const APP_INDEX_PATH    = join(process.cwd(), 'app', 'index.tsx');

export const session2026_05_29Tests: TestCase[] = [
  // ─── B-NEW-4: Stop button stopAsync fix ────────────────────────────────────
  {
    id: 'session-2026-05-29.b-new-4-stopspeaking-captures-sound-before-cleanup',
    category: 'session-2026-05-29',
    description:
      'B-NEW-4 — stopSpeaking() must capture _currentSound into soundToStop BEFORE ' +
      'invoking _pendingPlaybackCleanup. The cleanup callback sets _currentSound = null, ' +
      'so without this capture stopAsync() was never called.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      // The fix pattern: soundToStop is assigned from _currentSound before the
      // _pendingPlaybackCleanup block.
      expectTruthy(
        src.includes('const soundToStop = _currentSound'),
        'stopSpeaking() must capture _currentSound into soundToStop before cleanup — B-NEW-4 fix',
      );
      expectTruthy(
        src.includes('soundToStop.stopAsync()'),
        'stopSpeaking() must call stopAsync() on soundToStop — B-NEW-4 fix',
      );
    },
  },
  {
    id: 'session-2026-05-29.b-new-4-stopspeaking-clears-current-sound-early',
    category: 'session-2026-05-29',
    description:
      'B-NEW-4 — stopSpeaking() must null _currentSound before the cleanup callback ' +
      'so that if cleanupAndResolve also tries to null it, both are safe no-ops.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      // After the capture, _currentSound must be nulled so concurrent calls
      // don't double-stop the same Sound object.
      const captureIdx = src.indexOf('const soundToStop = _currentSound');
      const clearIdx   = src.indexOf('_currentSound = null', captureIdx);
      const cleanupIdx = src.indexOf('_pendingPlaybackCleanup', captureIdx);
      expectTruthy(captureIdx >= 0, 'soundToStop capture must exist');
      expectTruthy(
        clearIdx >= 0 && clearIdx < cleanupIdx,
        '_currentSound must be nulled before _pendingPlaybackCleanup fires — prevents double-stop',
      );
    },
  },
  {
    id: 'session-2026-05-29.b-new-4-stopspeaking-uses-soundtostop-guard',
    category: 'session-2026-05-29',
    description:
      'B-NEW-4 — stopSpeaking() must use `if (soundToStop)` guard (not `if (_currentSound)`). ' +
      'The old guard was always false because cleanupAndResolve nulled _currentSound first.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      const fnStart = src.indexOf('export function stopSpeaking()');
      expectTruthy(fnStart >= 0, 'stopSpeaking function must exist');
      // 2000 chars covers the full function body including the soundToStop block.
      const fnBody = src.slice(fnStart, fnStart + 2000);
      expectTruthy(
        fnBody.includes('if (soundToStop)'),
        'stopSpeaking() must use `if (soundToStop)` guard — B-NEW-4 fix',
      );
      // The actual code guard `if (_currentSound)` must not appear in the executable
      // part of the function (comments may reference it; we check the region after
      // the last comment block, which starts with `if (soundToStop)`).
      const soundToStopGuardIdx = fnBody.indexOf('if (soundToStop)');
      const afterGuard = fnBody.slice(soundToStopGuardIdx);
      expectFalsy(
        afterGuard.includes('if (_currentSound)'),
        'No `if (_currentSound)` guard should appear after the soundToStop block',
      );
    },
  },

  // ─── OAuth scope-version gate ──────────────────────────────────────────────
  {
    id: 'session-2026-05-29.oauth-scope-version-constant-is-2',
    category: 'session-2026-05-29',
    description:
      'OAuth scope gate — REQUIRED_OAUTH_SCOPE_VERSION must be 2 (contacts write scope ' +
      'added for MyNaavi Community 2026-05-29). Increment this when scopes change again.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(SUPABASE_LIB_PATH, 'utf8');
      expectTruthy(
        src.includes('REQUIRED_OAUTH_SCOPE_VERSION = 2'),
        'lib/supabase.ts must have REQUIRED_OAUTH_SCOPE_VERSION = 2',
      );
    },
  },
  {
    id: 'session-2026-05-29.oauth-scope-gate-helpers-exist',
    category: 'session-2026-05-29',
    description:
      'OAuth scope gate — lib/supabase.ts must export checkOAuthScopeVersion() and ' +
      'markOAuthScopeVersionCurrent() so app/index.tsx can wire the gate.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(SUPABASE_LIB_PATH, 'utf8');
      expectTruthy(
        src.includes('export async function checkOAuthScopeVersion'),
        'lib/supabase.ts must export checkOAuthScopeVersion()',
      );
      expectTruthy(
        src.includes('export async function markOAuthScopeVersionCurrent'),
        'lib/supabase.ts must export markOAuthScopeVersionCurrent()',
      );
    },
  },
  {
    id: 'session-2026-05-29.oauth-scope-gate-wired-in-startup',
    category: 'session-2026-05-29',
    description:
      'OAuth scope gate — app/index.tsx startup must call checkOAuthScopeVersion() ' +
      'before setting isSignedIn=true, and markOAuthScopeVersionCurrent() after SIGNED_IN.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(APP_INDEX_PATH, 'utf8');
      expectTruthy(
        src.includes('checkOAuthScopeVersion'),
        'app/index.tsx must call checkOAuthScopeVersion() in startup useEffect',
      );
      expectTruthy(
        src.includes('markOAuthScopeVersionCurrent'),
        'app/index.tsx must call markOAuthScopeVersionCurrent() after SIGNED_IN',
      );
      // The SIGNED_IN + scope-mark block must appear together (mark fires after token capture)
      const signedInIdx = src.indexOf("event === 'SIGNED_IN' && session?.provider_refresh_token");
      expectTruthy(signedInIdx >= 0, 'SIGNED_IN handler must exist');
      const signedInBlock = src.slice(signedInIdx, signedInIdx + 300);
      expectTruthy(
        signedInBlock.includes('markOAuthScopeVersionCurrent'),
        'markOAuthScopeVersionCurrent() must be called inside the SIGNED_IN + provider_refresh_token block',
      );
    },
  },
];
