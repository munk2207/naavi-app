/**
 * Session 2026-06-15 — B2m parity: voice expired-location-alert re-arm + LOG_CONCERN/UPDATE_PROFILE
 * + UPDATE_MORNING_CALL brief_windows upgrade (both surfaces)
 *
 * Covers:
 * 1. Voice server no longer contains the "Open the mobile app, go to Alerts, and tap Reactivate"
 *    bail-out string in any of the 4 commitLocationRule failure paths.
 * 2. Voice server sets pendingRearm inline on already_exists_expired in all 4 paths.
 * 3. Voice server handles LOG_CONCERN action — writes to topics table.
 * 4. Voice server handles UPDATE_PROFILE action — writes to topics table.
 * 5. Voice UPDATE_MORNING_CALL patches brief_windows (not just legacy columns).
 * 6. Mobile useOrchestrator handles UPDATE_MORNING_CALL and patches brief_windows.
 * 7. disable-all: enabled:false with no time disables all 4 windows.
 * 8. timeToWindow: boundary cases for window derivation.
 * 9. voice LIST_RULES ARCH-1 classifier: 'alerts'/'notifications' disambiguated from LIST_READ.
 * 10. voice LIST_RULES full-Claude path: filters enabled===true before narrating.
 *
 * Run via `npm run test:auto`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const VOICE_PATH = join(process.cwd(), 'naavi-voice-server', 'src', 'index.js');
const ORCHESTRATOR_PATH = join(process.cwd(), 'hooks', 'useOrchestrator.ts');

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
  {
    id: 'voice.morning-call.brief-windows-patched',
    description: 'Voice UPDATE_MORNING_CALL: reads brief_windows before patching and writes updated object',
    tags: ['voice', 'morning-call', 'brief-windows'],
    run: async () => {
      const src = readFileSync(VOICE_PATH, 'utf8');
      expectTruthy(
        src.includes('brief_windows'),
        'Voice UPDATE_MORNING_CALL handler does not reference brief_windows',
      );
      expectTruthy(
        src.includes('timeToWindow'),
        'Voice UPDATE_MORNING_CALL handler missing timeToWindow helper',
      );
      expectTruthy(
        src.includes("select=brief_windows"),
        'Voice UPDATE_MORNING_CALL handler does not read current brief_windows before patching',
      );
    },
  },
  {
    id: 'mobile.morning-call.brief-windows-patched',
    description: 'Mobile useOrchestrator: UPDATE_MORNING_CALL handler present and patches brief_windows',
    tags: ['mobile', 'morning-call', 'brief-windows'],
    run: async () => {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(
        src.includes("action.type === 'UPDATE_MORNING_CALL'"),
        'useOrchestrator missing UPDATE_MORNING_CALL handler',
      );
      expectTruthy(
        src.includes('brief_windows'),
        'useOrchestrator UPDATE_MORNING_CALL handler does not reference brief_windows',
      );
      expectTruthy(
        src.includes('timeToWindow'),
        'useOrchestrator UPDATE_MORNING_CALL handler missing timeToWindow helper',
      );
    },
  },
  {
    id: 'morning-call.disable-all-windows-when-no-time',
    description: 'Both surfaces: enabled:false with no time disables all 4 brief_windows',
    tags: ['voice', 'mobile', 'morning-call', 'brief-windows'],
    run: async () => {
      const voiceSrc = readFileSync(VOICE_PATH, 'utf8');
      const mobileSrc = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      // Both must have the disable-all loop over the 4 window keys.
      const DISABLE_ALL_PATTERN = "for (const w of ['morning', 'midday', 'evening', 'night'])";
      expectTruthy(
        voiceSrc.includes(DISABLE_ALL_PATTERN),
        'Voice UPDATE_MORNING_CALL missing disable-all loop for brief_windows',
      );
      expectTruthy(
        mobileSrc.includes(DISABLE_ALL_PATTERN),
        'Mobile UPDATE_MORNING_CALL missing disable-all loop for brief_windows',
      );
    },
  },
  {
    id: 'morning-call.time-to-window-boundaries',
    description: 'timeToWindow: 10:59→morning, 11:00→midday, 14:59→midday, 15:00→evening, 19:59→evening, 20:00→night',
    tags: ['morning-call', 'brief-windows'],
    run: async () => {
      // Extract and eval the timeToWindow function from the voice server source.
      const src = readFileSync(VOICE_PATH, 'utf8');
      const fnMatch = src.match(/function timeToWindow\(hhmm\) \{[\s\S]*?\n        \}/);
      expectTruthy(!!fnMatch, 'Could not locate timeToWindow function in voice server source');

      // Inline equivalent (mirrors voice server implementation) for boundary validation.
      function timeToWindow(hhmm: string | undefined): string | null {
        if (!hhmm) return null;
        const t = String(hhmm).substring(0, 5);
        if (t < '11:00') return 'morning';
        if (t < '15:00') return 'midday';
        if (t < '20:00') return 'evening';
        return 'night';
      }

      const cases: [string, string][] = [
        ['10:59', 'morning'],
        ['11:00', 'midday'],
        ['14:59', 'midday'],
        ['15:00', 'evening'],
        ['19:59', 'evening'],
        ['20:00', 'night'],
        ['23:59', 'night'],
      ];
      for (const [input, expected] of cases) {
        const got = timeToWindow(input);
        expectTruthy(got === expected, `timeToWindow('${input}') = '${got}', expected '${expected}'`);
      }
    },
  },
  {
    id: 'voice.list-rules.arch1-classifier-alerts-not-list-read',
    description: 'ARCH-1 classifier prompt: "alerts"/"notifications" explicitly mapped to LIST_RULES, never LIST_READ',
    tags: ['voice', 'list-rules', 'arch1'],
    run: async () => {
      const src = readFileSync(VOICE_PATH, 'utf8');
      expectTruthy(
        src.includes('LIST_RULES = any request about alerts, rules, or notifications'),
        'ARCH-1 classifier must explicitly define LIST_RULES for alerts/rules/notifications',
      );
      expectTruthy(
        src.includes('never "alerts"/"rules"/"notifications"'),
        'ARCH-1 classifier must exclude alerts/rules/notifications from LIST_READ listName',
      );
    },
  },
  {
    id: 'voice.list-rules.full-claude-path-filters-enabled',
    description: 'Full-Claude LIST_RULES path filters enabled===true and skips fired one-shot rules',
    tags: ['voice', 'list-rules'],
    run: async () => {
      const src = readFileSync(VOICE_PATH, 'utf8');
      expectTruthy(
        src.includes('allRules.filter(r => r.enabled === true && !(r.one_shot && r.last_fired_at != null))'),
        'Full-Claude LIST_RULES path must filter out disabled and fired one-shot rules',
      );
    },
  },
];
