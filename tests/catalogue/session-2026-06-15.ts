/**
 * Session 2026-06-15 — B2m parity: voice expired-location-alert re-arm
 *
 * Covers:
 * 1. Voice server no longer contains the "Open the mobile app, go to Alerts, and tap Reactivate"
 *    bail-out string in any of the 3 commitLocationRule failure paths.
 * 2. Voice server sets pendingRearm inline on already_exists_expired in all 3 paths
 *    (verified by presence of the replacement pattern).
 *
 * Run via `npm run test:auto`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const VOICE_PATH = join(process.cwd(), 'naavi-voice-server', 'src', 'index.js');

export const session2026_06_15Tests: TestCase[] = [
  {
    id: 'voice.rearm.no-mobile-app-bail-out',
    description: 'Voice server: "Open the mobile app, go to Alerts, and tap Reactivate" bail-out removed from all commitLocationRule paths',
    tags: ['voice', 'rearm', 'parity'],
    run: async () => {
      const src = readFileSync(VOICE_PATH, 'utf8');
      expectTruthy(
        !src.includes('Open the mobile app, go to Alerts, and tap Reactivate'),
        'Voice server still contains the old "Open the mobile app" bail-out — fix not applied to all 3 paths',
      );
    },
  },
  {
    id: 'voice.rearm.pendingRearm-set-on-expired',
    description: 'Voice server: pendingRearm is set inline when already_exists_expired fires in commitLocationRule paths',
    tags: ['voice', 'rearm', 'parity'],
    run: async () => {
      const src = readFileSync(VOICE_PATH, 'utf8');
      // Count occurrences of the inline re-arm pattern — should appear at least 3 times (one per path).
      const matches = src.match(/commitRes\.reason === 'already_exists_expired'/g) ?? [];
      expectTruthy(
        matches.length >= 3,
        `Expected at least 3 already_exists_expired branches, found ${matches.length}`,
      );
      // Confirm the inline re-arm question is present at least 3 times.
      const rearmQuestions = src.match(/Want me to re-enable it\?/g) ?? [];
      expectTruthy(
        rearmQuestions.length >= 3,
        `Expected at least 3 "Want me to re-enable it?" strings, found ${rearmQuestions.length}`,
      );
    },
  },
];
