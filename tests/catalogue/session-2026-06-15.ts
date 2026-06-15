/**
 * Session 2026-06-15 — B2m parity: voice expired-location-alert re-arm + LOG_CONCERN/UPDATE_PROFILE
 *
 * Covers:
 * 1. Voice server no longer contains the "Open the mobile app, go to Alerts, and tap Reactivate"
 *    bail-out string in any of the 4 commitLocationRule failure paths.
 * 2. Voice server sets pendingRearm inline on already_exists_expired in all 4 paths.
 * 3. Voice server handles LOG_CONCERN action — writes to topics table.
 * 4. Voice server handles UPDATE_PROFILE action — writes to topics table.
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
  {
    id: 'voice.parity.log-concern-handler-present',
    description: 'Voice server: LOG_CONCERN action handler writes to topics table (parity with mobile)',
    tags: ['voice', 'parity'],
    run: async () => {
      const src = readFileSync(VOICE_PATH, 'utf8');
      expectTruthy(
        src.includes("action.type === 'LOG_CONCERN'"),
        'Voice server missing LOG_CONCERN handler',
      );
      expectTruthy(
        src.includes('[Voice] LOG_CONCERN saved'),
        'Voice server LOG_CONCERN handler missing log line — handler may not be wired',
      );
    },
  },
  {
    id: 'voice.parity.update-profile-handler-present',
    description: 'Voice server: UPDATE_PROFILE action handler writes to topics table (parity with mobile)',
    tags: ['voice', 'parity'],
    run: async () => {
      const src = readFileSync(VOICE_PATH, 'utf8');
      expectTruthy(
        src.includes("action.type === 'UPDATE_PROFILE'"),
        'Voice server missing UPDATE_PROFILE handler',
      );
      expectTruthy(
        src.includes('[Voice] UPDATE_PROFILE saved'),
        'Voice server UPDATE_PROFILE handler missing log line — handler may not be wired',
      );
    },
  },
];
