/**
 * B11f — pause/resume: the WIRING, which the voice server's own suite cannot see.
 *
 * The voice repo already has 14 behavioural tests on `src/voice/resumePoint.js`
 * (test/resumePoint.test.js) and they are not duplicated here. They prove the
 * arithmetic. What they cannot prove is that `index.js` still calls it, and
 * still passes the right four values — and that gap is not hypothetical:
 *
 *   Phase 6 (2026-08-21) accepted the extraction on exactly one condition,
 *   that a live call be made, because a transposed property in the state
 *   object — `lastTtsBytes` where `preGenTotalBytes` belongs — would
 *   type-check, lint clean, and pass all 133 of the voice suite's tests.
 *
 * A live call discharged it once. Nothing repeats that on every run. These do.
 *
 * ── Why this class of test matters for B11f specifically ───────────────────
 * B11f shipped broken once already, on 2026-08-19, and was reverted. TWO root
 * causes, and BOTH were wiring rather than logic:
 *   1. `isPauseCommand()` was called twice and never written — a ReferenceError
 *      on the line before the transcript handler.
 *   2. `processUserMessage` forks, and the first implementation instrumented
 *      only the `speak()` branch while most answers take the pre-generated
 *      `sendAudioToTwilio` branch — which is why it looked intermittent.
 *
 * It passed four governance gates, 102 tests and two external reviews before
 * that. Tests of the arithmetic would not have caught either one.
 *
 * ── Coverage gaps acknowledged (Rule 15a) ──────────────────────────────────
 * These are source-level. They prove the module is loadable, correct, and
 * referenced with the right names. They CANNOT prove the values held by those
 * names are the right ones at runtime — that still needs a live call, and the
 * Phase 7 record says so. What they catch is removal, re-inlining, and rename
 * drift, which is what actually happened to this feature.
 */

import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import type { TestCase } from '../lib/types';
import { expectTruthy } from '../lib/assertions';

const VOICE = join(process.cwd(), 'naavi-voice-server');

/**
 * Read a file from the voice server's `staging` branch, NOT from its working
 * tree.
 *
 * B11f exists ONLY on `staging` — it is deliberately held back from `main`
 * (production) pending a promotion decision. The voice repo is legitimately
 * checked out on either branch at any time; it was on `main` when these tests
 * were first run, and they failed for that reason alone rather than because
 * anything was wrong. Asserting against the working tree would make this suite
 * fail depending on where someone happened to leave a branch pointer, which is
 * noise, not signal.
 *
 * Reading the branch directly also tests the right thing: what will ship if
 * B11f is promoted.
 */
function readFromStaging(relPath: string): string {
  try {
    return execFileSync('git', ['show', `staging:${relPath}`],
      { cwd: VOICE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err: any) {
    throw new Error(
      `cannot read ${relPath} from the voice server's staging branch — `
      + `either the file is gone or the branch is missing: ${err.message?.split('\n')[0]}`);
  }
}

const readIndex = () => readFromStaging('src/index.js');

export const b11fResumePointWiringTests: TestCase[] = [
  {
    id: 'b11f.resume-module-exists-and-behaves',
    category: 'b11f-resume-point',
    platform: 'voice',
    description:
      'The extracted module loads and computes the resume point correctly — a spot-check that the '
      + 'voice suite covers in depth, run here so test:auto fails if the file is deleted or broken.',
    timeoutMs: 10_000,
    async run(ctx) {
      // Materialise staging's copy in a temp dir so it can be required and
      // actually executed — asserting on the source text would only prove the
      // words are present, which is the weaker check s1-voice-pin-scoping.ts
      // warns about in its own header.
      const src = readFromStaging('src/voice/resumePoint.js');
      const dir = mkdtempSync(join(tmpdir(), 'b11f-'));
      const file = join(dir, 'resumePoint.js');
      writeFileSync(file, src);

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(file);
      expectTruthy(typeof mod.bytesSpokenSoFar === 'function', 'bytesSpokenSoFar is not exported');
      expectTruthy(typeof mod.resumePointOf === 'function', 'resumePointOf is not exported');

      // The streaming path reports measured bytes; the pre-generated path
      // estimates from elapsed time and caps at the buffer. Root cause 2 of the
      // July revert was that second branch reporting nothing at all.
      expectTruthy(
        mod.bytesSpokenSoFar({ usingPreGenAudio: false, lastTtsBytes: 4321, audioDispatchedAt: 0, preGenTotalBytes: 0 }) === 4321,
        'streaming path must report its measured byte count',
      );
      const preGen = mod.bytesSpokenSoFar(
        { usingPreGenAudio: true, lastTtsBytes: 0, audioDispatchedAt: 10_000, preGenTotalBytes: 80_000 }, 13_000);
      expectTruthy(preGen === 24_000,
        `pre-generated path must estimate from elapsed time — got ${preGen}, expected 24000. `
        + 'This is the branch whose silence caused the 2026-08-19 revert.');

      // The deliberate one-sentence rewind: resuming mid-third-sentence must
      // land at the START of the second, not where the caller was cut off.
      const text = 'The dentist moved your appointment to Friday. Your prescription is ready for pickup. And Linda called.';
      const from = mod.resumePointOf({ text, bytesSent: Math.ceil((95 / 14) * 8000) });
      expectTruthy(
        text.slice(from).startsWith('Your prescription'),
        `resume must rewind one sentence — landed on "${text.slice(from, from + 28)}"`,
      );
      ctx.log('module loads; both playback paths and the one-sentence rewind behave');
    },
  },
  {
    id: 'b11f.index-still-wired-to-the-module',
    category: 'b11f-resume-point',
    platform: 'voice',
    description:
      'index.js imports the module and passes all four state values by name. Catches the failure that '
      + 'reverted B11f once: the arithmetic being right while nothing reaches it.',
    timeoutMs: 10_000,
    async run(ctx) {
      const src = readIndex();

      expectTruthy(
        /require\(['"]\.\/voice\/resumePoint\.js['"]\)/.test(src),
        'index.js no longer requires ./voice/resumePoint.js — the extraction has been undone or bypassed',
      );

      // All four must be handed over. A missing one is not a crash: it arrives
      // as undefined, the arithmetic silently degrades, and the caller resumes
      // in the wrong place with nothing logged.
      for (const field of ['usingPreGenAudio', 'lastTtsBytes', 'audioDispatchedAt', 'preGenTotalBytes']) {
        expectTruthy(
          new RegExp(`bytesSpokenSoFarOf\\(\\{[\\s\\S]{0,220}${field}`).test(src),
          `index.js does not pass ${field} into bytesSpokenSoFarOf — it would arrive undefined and the `
          + 'resume point would be wrong, silently',
        );
      }
      ctx.log('import present; all four state values passed by name');
    },
  },
  {
    id: 'b11f.arithmetic-not-reinlined-in-index',
    category: 'b11f-resume-point',
    platform: 'voice',
    description:
      'The resume arithmetic is not redefined inside index.js. Guards against someone re-inlining it '
      + 'during a future edit, which would put it back beyond the reach of any test.',
    timeoutMs: 10_000,
    async run(ctx) {
      const src = readIndex();
      expectTruthy(
        !/function\s+resumePointOf\s*\(/.test(src),
        'resumePointOf has been redefined inside index.js — it is untestable there, which is the '
        + 'condition B11f Phase 4 existed to remove',
      );
      // The wrapper is expected; a re-inlined BODY is not. The body's signature
      // is the mulaw byte-rate multiplication.
      expectTruthy(
        !/Math\.min\(\s*preGenTotalBytes\s*,\s*Math\.floor\(/.test(src),
        'the byte-position arithmetic has been re-inlined into index.js instead of calling the module',
      );
      ctx.log('arithmetic lives only in the module');
    },
  },
];
