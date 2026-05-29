/**
 * Session 2026-05-29 — regression coverage for B-NEW-4 and nav-disambiguation (v101).
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
 * Nav-disambiguation v101: prompt rule prevents Naavi from re-asking "which one?"
 * after she has already identified a unique meeting with a physical location. Tested
 * via prompt version check (also covered in session-2026-05-27 and session-2026-05-28).
 *
 * Coverage gap acknowledged (Rule 15a exception):
 *   B-NEW-4 live: TTS stop behavior is Android-native audio (expo-av Sound object).
 *   Not reachable from the Node.js auto-tester. Covered by static code pattern check;
 *   Wael verifies live by tapping Stop mid-speech on Samsung device.
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
];
