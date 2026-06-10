/**
 * Session 2026-06-09 — regression coverage for B4w mobile parity.
 *
 * B4w (mobile): naavi-chat had no bypass for contact attribute-search queries.
 * "Find a contact with postal code K1C5M3" would reach Claude (Haiku), which
 * fabricated contact names. The voice server had the bypass since 2026-05-27;
 * this session ports the same pattern to naavi-chat (Step 1.6).
 *
 * Fix: naavi-chat Step 1.6 — detect Canadian postal-code contact queries,
 * call global-search contacts adapter server-side, return canonical honest-out
 * if 0 results. Zero LLM = zero confabulation.
 *
 * Coverage gaps acknowledged (Rule 15a exception):
 *   B4w live round-trip: the bypass calls global-search which calls Google
 *   People API with the test user's token. A live test would need a contact
 *   with a known postal code. Covered here by static code check verifying
 *   the bypass block exists in naavi-chat; Wael verifies live on mobile.
 *
 * Run via `npm run test:auto`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const NAAVI_CHAT_PATH = join(
  process.cwd(),
  'supabase', 'functions', 'naavi-chat', 'index.ts',
);

export const session2026_06_09Tests: TestCase[] = [
  // ─── B4w mobile: bypass block exists in naavi-chat ─────────────────────────
  {
    id: 'b4w.mobile-naavi-chat-has-postal-bypass',
    description: 'naavi-chat has B4w contact postal-code bypass (Step 1.6)',
    tags: ['b4w', 'trust', 'mobile-parity'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('B4w') && src.includes('POSTAL_RE') && src.includes('isContactAttrQuery'),
        'naavi-chat must contain B4w postal-code bypass with POSTAL_RE + isContactAttrQuery'
      );
      expectTruthy(
        src.includes("I don't have a contact with postal code"),
        'naavi-chat must contain the canonical honest-out phrase for 0-result postal search'
      );
    },
  },

  // ─── B4w mobile: bypass fires before Claude (Step 1.6 ordering) ─────────────
  {
    id: 'b4w.mobile-bypass-before-claude',
    description: 'naavi-chat B4w bypass is placed before the Claude call',
    tags: ['b4w', 'trust', 'mobile-parity'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      // The main chat Claude call is at the second client.messages.create
      // (first is classifyIntent helper). We verify the bypass string appears
      // before the naavi-chat main handler's Claude call by checking it comes
      // before the Step 2 comment that immediately precedes the main call.
      const bypassIdx = src.indexOf('B4w 2026-06-09');
      // Step 2 is the label just before the main Claude messages.create block
      const step2Idx = src.indexOf('Step 2');
      expectTruthy(
        bypassIdx > 0 && step2Idx > 0 && bypassIdx < step2Idx,
        'B4w bypass block must appear before Step 2 (main Claude call) in naavi-chat'
      );
    },
  },
];
