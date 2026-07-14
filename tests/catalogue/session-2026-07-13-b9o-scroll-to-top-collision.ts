/**
 * Session 2026-07-13 — B9o: the chat screen's auto-scroll logic
 * (app/index.tsx) used `assistantSpeech?.startsWith('Here are your')` to
 * detect the compound-plan breakdown response and scroll to the top instead
 * of the bottom. This loose prefix match also matched LIST_RULES's speech
 * template ('Here are your alerts.', naavi-chat/index.ts:217) — so viewing
 * the alerts list (or any future response starting with the same words)
 * incorrectly scrolled the screen to the top instead of staying on the
 * latest answer.
 *
 * Fix: match the server's own compound-plan regex
 * (naavi-chat/index.ts:4126, `/^Here are your \d+ actions:/`) instead of a
 * loose `startsWith`, so only a genuine compound-plan breakdown (which
 * requires a digit count and "actions:") triggers scroll-to-top.
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a: app/index.tsx is a React
 * Native screen with Expo/RN imports and cannot be safely imported into
 * this Node/tsx test runner. These are source-pattern assertions verifying
 * the regex is used (not the old loose prefix) and that it correctly
 * distinguishes the two colliding speech templates found live.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const APP_INDEX_PATH = join(process.cwd(), 'app', 'index.tsx');
const NAAVI_CHAT_PATH = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');

export const session2026_07_13_b9oScrollToTopCollisionTests: TestCase[] = [
  {
    id: 'b9o.compound-plan-check-no-longer-uses-loose-prefix',
    category: 'rules',
    description: 'the client no longer uses assistantSpeech.startsWith(\'Here are your\') to detect a compound plan, since that string also matches LIST_RULES\'s speech template',
    async run() {
      const src = readFileSync(APP_INDEX_PATH, 'utf8');
      expectTruthy(
        !src.includes("assistantSpeech?.startsWith('Here are your')"),
        'B9o fix: the loose startsWith(\'Here are your\') check must be removed — it false-positive-matches LIST_RULES\'s "Here are your alerts." speech',
      );
    },
  },
  {
    id: 'b9o.compound-plan-check-matches-server-regex',
    category: 'rules',
    description: 'the client\'s isCompoundPlan check uses the same specific regex as the server\'s own compound-plan detection, and correctly distinguishes the two live-colliding speech templates',
    async run() {
      const src = readFileSync(APP_INDEX_PATH, 'utf8');
      const idx = src.indexOf('const isCompoundPlan =');
      expectTruthy(idx !== -1, 'isCompoundPlan definition not found in app/index.tsx');

      const line = src.slice(idx, src.indexOf(';', idx) + 1);
      const regexMatch = line.match(/\/(\^Here are your[^/]+)\/\.test/);
      expectTruthy(!!regexMatch, 'B9o fix: isCompoundPlan must use a regex.test(...) pattern, not a loose startsWith');

      if (regexMatch) {
        const re = new RegExp(regexMatch[1]);
        expectTruthy(
          re.test('Here are your 3 actions:'),
          'B9o fix: the regex must still match a genuine compound-plan speech template',
        );
        expectTruthy(
          !re.test('Here are your alerts.'),
          'B9o fix: the regex must NOT match LIST_RULES\'s "Here are your alerts." speech — this was the actual collision found live',
        );
      }

      // Cross-check against the server's own template to catch future drift.
      const serverSrc = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        serverSrc.includes("case 'LIST_RULES':      return 'Here are your alerts.';") ||
        serverSrc.includes("'Here are your alerts.'"),
        'naavi-chat/index.ts no longer contains the LIST_RULES "Here are your alerts." template — if this changed, re-verify the collision this test guards against is still the right one',
      );
    },
  },
];
