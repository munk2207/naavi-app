/**
 * Voice media buffering — the caller's first words must not be discarded.
 *
 * ⭐ THE DEFECT THIS LOCKS OUT (found and fixed 2026-08-30).
 *
 * On the Twilio 'start' event the server awaits fetchKnownNames() and then
 * fetchVoiceKeyterms() before calling connectDeepgram(), because the keyterms
 * are baked into the connection URL. Both are database round-trips. For that
 * entire window `deepgramWs` is null — and the media branch used to read:
 *
 *     if (deepgramWs && readyState === OPEN)          send
 *     else if (deepgramWs && readyState === CONNECTING) buffer
 *     // If deepgramWs is null or CLOSED/CLOSING, drop — same as before.
 *
 * So every frame arriving before the socket existed was thrown away. Whatever
 * the caller said in their first seconds was never sent and never transcribed.
 *
 * MEASURED, production, 2026-08-30, three consecutive calls, all identical:
 *   [FrameIn] First frame at +108ms
 *   [Context] Known names (80): …          <- DB round-trip 1
 *   [Context] Voice keyterms (10): …       <- DB round-trip 2
 *   [FrameIn] #100 at +1885ms (DG state: CONNECTING)
 *   [B10m-diag] Audio level over last 100 frames: avg amplitude 1561   <- SPEAKING
 *   [Deepgram] WebSocket connected                                     <- too late
 *   ...no transcript ever... watchdog exhausted ... Twilio disconnected at ~25s
 *
 * Twilio's own <Gather> had transcribed the same caller correctly seconds
 * earlier in the same call ("Eastern Time.", "yes."), which is what proved the
 * handset and carrier were fine and the loss was ours.
 *
 * Why it read as intermittent for months: it is a race between how fast the
 * database answers and how soon the caller starts talking. A staging call the
 * same night succeeded on the same code, only because the caller did not speak
 * until after the socket was open.
 *
 * COVERAGE GAP, ACKNOWLEDGED (Rule 15a). These are source-anchored assertions
 * plus a behavioural check of the cap semantics. The full path needs a live
 * Twilio media WebSocket, which the harness cannot stand up. What is asserted
 * here is precisely the condition that was wrong, so a regression to the old
 * `deepgramWs && ...CONNECTING` shape fails the suite.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const VOICE_PATH = join(process.cwd(), 'naavi-voice-server', 'src', 'index.js');
const src = () => readFileSync(VOICE_PATH, 'utf8');

export const voiceMediaBufferTests: TestCase[] = [
  {
    id: 'voice.media.buffers-before-the-socket-exists',
    platform: 'voice',
    category: 'voice-media',
    description: 'Inbound frames are buffered while deepgramWs is still null, not dropped',
    tags: ['voice', 'audio', 'regression'],
    run: async () => {
      const s = src();

      expectTruthy(
        /else if \(!deepgramWs \|\| deepgramWs\.readyState === WebSocket\.CONNECTING\)/.test(s),
        'the media branch must buffer when deepgramWs is NULL as well as CONNECTING — the null window is ' +
          'the two DB round-trips before connectDeepgram(), and dropping there discards the caller\'s first words',
      );

      expectTruthy(
        !/else if \(deepgramWs && deepgramWs\.readyState === WebSocket\.CONNECTING\)/.test(s),
        'the old buffer condition required deepgramWs to be truthy, which is exactly the bug — it must not return',
      );

      expectTruthy(
        !/If deepgramWs is null or CLOSED\/CLOSING, drop/.test(s),
        'the comment asserting that a null socket drops frames must be gone — it documented the defect as intended behaviour',
      );
    },
  },

  {
    id: 'voice.media.buffer-stays-bounded',
    platform: 'voice',
    category: 'voice-media',
    description: 'The buffer keeps a cap and evicts oldest-first, so a never-connecting Deepgram cannot grow it without bound',
    tags: ['voice', 'audio', 'regression'],
    run: async () => {
      const s = src();

      const capMatch = s.match(/const MEDIA_BUFFER_MAX = (\d+);/);
      expectTruthy(capMatch !== null, 'MEDIA_BUFFER_MAX must still exist — buffering from frame 1 is only safe because it is capped');
      const cap = Number(capMatch![1]);
      expectTruthy(cap > 0 && cap <= 1000, `MEDIA_BUFFER_MAX must be a sane bound — got ${cap}`);

      expectTruthy(
        /pendingMediaFrames\.length > MEDIA_BUFFER_MAX\)\s*\{\s*pendingMediaFrames\.shift\(\);/.test(s),
        'eviction must still be oldest-first (shift) — the newest audio is the caller\'s actual question',
      );

      // Behavioural: the semantics the fix depends on. Oldest out, newest kept.
      const buf: number[] = [];
      let evicted = 0;
      for (let frame = 1; frame <= cap + 50; frame++) {
        buf.push(frame);
        if (buf.length > cap) { buf.shift(); evicted++; }
      }
      expectTruthy(buf.length === cap, `buffer must hold at most ${cap} frames — held ${buf.length}`);
      expectTruthy(evicted === 50, `50 frames should have been evicted — got ${evicted}`);
      expectTruthy(buf[buf.length - 1] === cap + 50, 'the newest frame must survive eviction');
      expectTruthy(buf[0] === 51, 'the oldest surviving frame must be the 51st — oldest-first eviction');
    },
  },

  {
    id: 'voice.media.flush-counters-reset',
    platform: 'voice',
    category: 'voice-media',
    description: 'Buffer counters reset per flush, so the drop figure is not a running-total artefact',
    tags: ['voice', 'audio', 'diagnostics'],
    run: async () => {
      const s = src();

      expectTruthy(
        /bufferedFrameCount = 0;\s*\n\s*bufferedDroppedCount = 0;/.test(s),
        'both buffer counters must reset on flush — as running totals they reported evictions that never happened, ' +
          'which misdirected the 2026-08-30 investigation twice',
      );

      expectTruthy(
        /bufferedDroppedCount\+\+;/.test(s),
        'evictions must be counted where they occur (at the shift), not derived by subtracting flush count from a running total',
      );
    },
  },

  {
    id: 'voice.media.deepgram-connect-does-not-wait-on-the-database',
    platform: 'voice',
    category: 'voice-media',
    description: 'Keyterm lookups run in parallel and are bounded, so a slow database cannot delay the Deepgram connection',
    tags: ['voice', 'audio', 'regression', 'latency'],
    run: async () => {
      const s = src();

      // The buffering fix alone was not enough. Production, 2026-08-30, real call:
      //   [FrameIn] #1000 at +19729ms (DG state: null)
      //   [Context] Known names (80): …      <- ~20s for one query
      //   [Context] Voice keyterms (10): …   <- ~10s more
      //   [Deepgram] WebSocket connected     <- +32 SECONDS
      //   Flushed 250 … 1352 evicted by the 250-frame cap
      // A ~5s buffer cannot absorb a 32s stall. The connection itself had to
      // stop depending on the database.

      expectTruthy(
        !/const knownNames = userId \? await fetchKnownNames\(userId\) : \[\];\s*\n\s*const customKeyterms = userId \? await fetchVoiceKeyterms\(userId\) : \[\];/.test(s),
        'the two keyterm lookups must not run sequentially with connectDeepgram waiting on both — that is the 32-second stall',
      );

      expectTruthy(
        /Promise\.all\(\[\s*\n\s*userId \? fetchKnownNames\(userId\) : \[\],\s*\n\s*userId \? fetchVoiceKeyterms\(userId\) : \[\],/.test(s),
        'the two independent lookups must run in parallel',
      );

      const budget = s.match(/const KEYTERM_BUDGET_MS = Number\(process\.env\.KEYTERM_BUDGET_MS\) \|\| (\d+);/);
      expectTruthy(budget !== null, 'a keyterm budget constant must exist — an unbounded wait here costs the whole call');
      expectTruthy(
        Number(budget![1]) <= 5000,
        `the budget must be shorter than the media buffer can cover (~5s) — got ${budget![1]}ms`,
      );

      expectTruthy(
        /Promise\.race\(\[[\s\S]{0,400}KEYTERM_BUDGET_MS\)\),?\s*\n?\s*\]\)/.test(s),
        'the keyterm work must be raced against the budget so the socket opens regardless of database health',
      );

      // Only one socket, ever. The budget path and the catch path can both reach
      // connectDeepgram, and two sockets means the first one's audio goes nowhere.
      expectTruthy(
        (s.match(/if \(!keytermsSettled\)/g) || []).length >= 2,
        'every connectDeepgram fallback on the start path must be guarded by keytermsSettled, or a late failure opens a duplicate socket',
      );

      // Assert on the ARTEFACT, not on the phrase. An earlier version of this
      // test forbade the string "dropped due to cap" anywhere in the file, and
      // then errored — because the comment explaining the fix quotes that very
      // phrase. Forbidding a word also forbids describing it.
      expectTruthy(
        !/totalBuffered - flushCount/.test(s),
        'the drop figure must not be derived as (running total − flush count) — that subtraction across reconnects ' +
          'invented evictions that never occurred',
      );
    },
  },
];
