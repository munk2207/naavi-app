/**
 * Session 2026-07-13 — B9q: the TTS "follow along as Naavi speaks" scroll
 * effect (app/index.tsx) computed its scroll target as a fraction of the
 * ENTIRE conversation's rendered height (`scrollContentHeight`), with the
 * first chunk hardcoded to `y: 0` — the absolute top of the whole chat.
 * That only ever landed on the current response near the very start of a
 * fresh conversation; for any later turn, every new spoken response caused
 * the screen to jump toward the top of the whole conversation instead of
 * following the response actually being read. Confirmed live: the jump
 * happened on ordinary single-answer queries (weather, time, calendar),
 * unrelated to the separate B9o (LIST_RULES/compound-plan) collision.
 *
 * Fix: track the latest turn's own on-screen position + height via
 * `onLayout` on its wrapper (`latestTurnLayoutRef`), and scroll relative to
 * that instead of the whole conversation — chunk 0 lands at the top of the
 * CURRENT response, later chunks track proportionally within it. This
 * preserves the "follow along" behavior (screen tracks speech pace, no
 * faster or slower) instead of removing it outright.
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a: app/index.tsx is a React
 * Native screen with Expo/RN imports and cannot be safely imported into
 * this Node/tsx test runner. These are source-pattern assertions verifying
 * the fix's shape — that scrollContentHeight is gone, latestTurnLayoutRef
 * exists and is populated via onLayout on the latest turn, and the chunk-
 * sync effect scrolls relative to it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const APP_INDEX_PATH = join(process.cwd(), 'app', 'index.tsx');

export const session2026_07_13_b9qTtsScrollSyncTests: TestCase[] = [
  {
    id: 'b9q.scroll-content-height-removed',
    category: 'rules',
    description: 'the whole-conversation-height scroll state (scrollContentHeight) is fully removed, not just unused, since it was the root cause of scrolling relative to the wrong content span',
    async run() {
      const src = readFileSync(APP_INDEX_PATH, 'utf8');
      expectTruthy(
        !src.includes('scrollContentHeight'),
        'B9q fix: scrollContentHeight must be fully removed (state, setter, and onContentSizeChange prop) — it computed scroll position against the ENTIRE conversation, not the current response',
      );
    },
  },
  {
    id: 'b9q.latest-turn-layout-tracked-via-onlayout',
    category: 'rules',
    description: 'the latest turn\'s wrapper View captures its own position and height via onLayout, scoped only to the latest turn (isLatest), not every turn',
    async run() {
      const src = readFileSync(APP_INDEX_PATH, 'utf8');
      const refIdx = src.indexOf('const latestTurnLayoutRef = useRef<{ y: number; height: number }>');
      expectTruthy(refIdx !== -1, 'B9q fix: latestTurnLayoutRef not found');

      const onLayoutIdx = src.indexOf('onLayout={isLatest ?');
      expectTruthy(onLayoutIdx !== -1, 'B9q fix: onLayout tracking must be conditional on isLatest, not attached to every turn (which would be wasteful and could race between turns)');

      const onLayoutBlock = src.slice(onLayoutIdx, src.indexOf('} : undefined}', onLayoutIdx) + 20);
      expectTruthy(
        onLayoutBlock.includes('latestTurnLayoutRef.current') && onLayoutBlock.includes('e.nativeEvent.layout'),
        'B9q fix: the onLayout handler must write the measured y/height into latestTurnLayoutRef from e.nativeEvent.layout',
      );
    },
  },
  {
    id: 'b9q.chunk-sync-scrolls-relative-to-latest-turn',
    category: 'rules',
    description: 'the chunk-sync scroll effect computes its target position relative to latestTurnLayoutRef, not an absolute y:0 or a fraction of the whole conversation',
    async run() {
      const src = readFileSync(APP_INDEX_PATH, 'utf8');
      const effectIdx = src.indexOf('Chunk-scroll sync');
      expectTruthy(effectIdx !== -1, 'chunk-scroll sync effect comment not found');

      const effectEnd = src.indexOf('}, [currentChunk]);', effectIdx);
      expectTruthy(effectEnd !== -1, 'B9q fix: chunk-sync effect must depend only on [currentChunk] now (scrollContentHeight removed from deps)');

      const effectBody = src.slice(effectIdx, effectEnd);
      expectTruthy(
        effectBody.includes('latestTurnLayoutRef.current'),
        'B9q fix: chunk-sync effect must read from latestTurnLayoutRef.current, not scrollContentHeight',
      );
      expectTruthy(
        /idx === 0\s*\n?\s*\?\s*turnY/.test(effectBody),
        'B9q fix: chunkIdx 0 must scroll to turnY (the latest turn\'s own top), not an absolute y:0 (the top of the whole conversation)',
      );
      expectTruthy(
        effectBody.includes('turnY + Math.round'),
        'B9q fix: later chunks must scroll to turnY PLUS the proportional offset within the latest turn\'s own height, not a fraction of the whole conversation\'s height',
      );
    },
  },
];
