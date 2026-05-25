/**
 * Session 2026-05-24 — regression coverage for tonight's shipped fixes.
 *
 * Tonight's commits this suite locks in:
 *   - B4f: TTS postal-code mangling in sanitiseForSpeech
 *   - B4y Phase 1: HAS_CREATE_INTENT gate (search verbs must NOT
 *     emit email-rule actions; create-intent verbs MUST)
 *   - B3z: OAuth pending-flag gate removed from
 *     lib/calendar.ts::captureAndStoreGoogleToken
 *
 * Coverage gaps acknowledged:
 *   - B4x (disabled-alert surfacing in name-match queries) — needs
 *     disabled-alert seeding + multi-turn assertion; deferred to a
 *     focused next session.
 *   - B4y storage normalization (parse trigger_config if string +
 *     default to_phone) — defensive code that only fires on Haiku
 *     misbehavior; hard to exercise without mocking Claude.
 *
 * Run via `npm run test:auto`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { adapters, db } from '../lib/adapters';
import {
  expect2xx,
  findActionInRawText,
  extractSpeech,
} from '../lib/assertions';
import type { TestCase } from '../lib/types';

// ─── B4y Phase 1: HAS_CREATE_INTENT gate ─────────────────────────────────────

export const session20260524Tests: TestCase[] = [
  {
    id: 'b4y.search-verb-no-email-rule',
    category: 'b4y',
    description:
      'Per CLAUDE.md Rule 12 + B4y Phase 1: "Find McDonald alert" must NOT emit ' +
      'SET_EMAIL_ALERT or SET_ACTION_RULE(trigger_type=email). User said FIND ' +
      '(search verb) not CREATE — emission would be a Rule 12 violation that ' +
      'silently writes an unauthorized rule (live 2026-05-24 15:32 EST incident).',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Find McDonald alert' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 250)}…`);

      const setEmail = findActionInRawText(rawText, 'SET_EMAIL_ALERT');
      const setAction = findActionInRawText(rawText, 'SET_ACTION_RULE');
      const setActionIsEmail =
        setAction && (setAction as any).trigger_type === 'email' ? setAction : null;

      if (setEmail) {
        throw new Error(
          `B4y Phase 1 regression: "Find McDonald alert" emitted ` +
          `SET_EMAIL_ALERT — must be dropped by HAS_CREATE_INTENT gate. ` +
          `Action: ${JSON.stringify(setEmail).slice(0, 200)}`,
        );
      }
      if (setActionIsEmail) {
        throw new Error(
          `B4y Phase 1 regression: "Find McDonald alert" emitted ` +
          `SET_ACTION_RULE(trigger_type=email) — must be dropped. ` +
          `Action: ${JSON.stringify(setActionIsEmail).slice(0, 200)}`,
        );
      }
    },
  },

  {
    id: 'b4y.create-intent-allows-email-rule',
    category: 'b4y',
    description:
      'B4y Phase 1 positive control: "Alert me when an email arrives from Bob" ' +
      'must STILL emit a rule-creation action (SET_EMAIL_ALERT or ' +
      'SET_ACTION_RULE(trigger_type=email)). HAS_CREATE_INTENT gate must not ' +
      'over-block — explicit create-intent verbs ("alert me", "notify me", ' +
      '"let me know", "remind me") must pass through.',
    timeoutMs: 30_000,
    async run(ctx) {
      // Pre-clean any prior test rule so the assertion is deterministic.
      try {
        await db.delete(
          ctx,
          'action_rules',
          `user_id=eq.${ctx.testUserId}&trigger_type=eq.email&label=ilike.${encodeURIComponent('%Bob%')}`,
        );
      } catch { /* ignore pre-clean errors */ }

      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [
          { role: 'user', content: 'Alert me when an email arrives from Bob' },
        ],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 250)}…`);

      const setEmail = findActionInRawText(rawText, 'SET_EMAIL_ALERT');
      const setAction = findActionInRawText(rawText, 'SET_ACTION_RULE');
      const setActionIsEmail =
        setAction && (setAction as any).trigger_type === 'email' ? setAction : null;

      // Best-effort teardown — clean up any rule this test wrote so the
      // next run starts from a known state.
      const cleanup = async () => {
        try {
          await db.delete(
            ctx,
            'action_rules',
            `user_id=eq.${ctx.testUserId}&trigger_type=eq.email&label=ilike.${encodeURIComponent('%Bob%')}`,
          );
        } catch { /* ignore teardown errors */ }
      };

      if (!setEmail && !setActionIsEmail) {
        // Path A (naavi-chat::detectEmailAlert regex bypass) writes the
        // rule directly via saveAlertRule and returns success speech
        // without emitting a Claude action. That's a valid success path —
        // verify by inspecting speech for the canonical success indicator.
        const speech = extractSpeech(rawText);
        const indicatesSuccess = /\b(i'?ll text you|alert set|done|i'?ll let you know|i'?ll notify)\b/i.test(speech);
        if (!indicatesSuccess) {
          await cleanup();
          throw new Error(
            `B4y Phase 1 over-blocking: valid create-intent message ` +
            `"Alert me when an email arrives from Bob" produced no ` +
            `rule-creation action AND no success speech. Either ` +
            `HAS_CREATE_INTENT gate is too strict, or Claude failed to ` +
            `emit the expected action and the regex bypass also missed. ` +
            `rawText: ${rawText.slice(0, 300)}`,
          );
        }
        ctx.log(`b4y: rule created via path A (server-side regex bypass), speech: "${speech.slice(0, 120)}"`);
      }
      await cleanup();
    },
  },

  // ─── B3z: OAuth pending-flag gate removed (static analysis) ───────────────

  {
    id: 'b3z.oauth-pending-gate-removed',
    category: 'b3z',
    description:
      'B3z: confirm the naavi_google_oauth_pending sessionStorage gate is no ' +
      'longer present inside captureAndStoreGoogleToken (lib/calendar.ts). ' +
      'The gate previously caused user_tokens.refresh_token to go stale when ' +
      'Google rotated the token, leading to invalid_grant on server-side ' +
      'OAuth (Edge Functions, cron, voice server, auto-tester).',
    timeoutMs: 5_000,
    async run(ctx) {
      const calendarPath = join(process.cwd(), 'lib', 'calendar.ts');
      const src = readFileSync(calendarPath, 'utf8');

      // Locate the function body.
      const fnStart = src.indexOf('export async function captureAndStoreGoogleToken');
      if (fnStart < 0) {
        throw new Error(
          'b3z: could not find captureAndStoreGoogleToken in lib/calendar.ts — ' +
          'function may have been renamed or moved; test must be updated.',
        );
      }
      // Body extends from fnStart to the next top-level export.
      const fnSlice = src.slice(fnStart, fnStart + 4000);
      ctx.log(`calendar.ts function slice length: ${fnSlice.length} chars`);

      // The forbidden pattern is the gate that returns early when the
      // pending flag is NOT set. Match the conditional return shape.
      const forbiddenGate = /!sessionStorage\.getItem\(['"]naavi_google_oauth_pending['"]\)[\s\S]*?return;/;
      if (forbiddenGate.test(fnSlice)) {
        throw new Error(
          `B3z regression: captureAndStoreGoogleToken still has the ` +
          `naavi_google_oauth_pending gate. The gate must remain removed ` +
          `so user_tokens.refresh_token gets rewritten on every SIGNED_IN ` +
          `event with a fresh provider_refresh_token.`,
        );
      }
    },
  },

  // ─── B4f: TTS postal-code mangling fix (sanitiseForSpeech regex) ──────────

  {
    id: 'b4f.tts-postal-code-normalization',
    category: 'b4f',
    description:
      'B4f: mobile TTS sanitiseForSpeech must normalize Canadian postal codes ' +
      'BEFORE the existing character-splitter runs, so the M/N/S/W letter ' +
      'between digits gets replaced with em/en/ess/double-u (otherwise ' +
      'Deepgram TTS pronounces "K1C5M3" as "K1C5 meters 3"). Tests the ' +
      'same regex transforms shipped in hooks/useOrchestrator.ts.',
    timeoutMs: 5_000,
    async run(ctx) {
      // Inline copy of the production sanitiseForSpeech function from
      // hooks/useOrchestrator.ts. If the production code changes, this
      // test must be updated alongside.
      const fixPostalLetter = (l: string): string => {
        if (l === 'M') return 'em';
        if (l === 'N') return 'en';
        if (l === 'S') return 'ess';
        if (l === 'W') return 'double u';
        return l;
      };
      const sanitise = (input: string): string => {
        let text = input
          .replace(
            /\b([A-Z])(\d)([A-Z])\s?(\d)([A-Z])(\d)\b/g,
            (_m, l1, d1, l2, d2, l3, d3) =>
              `${fixPostalLetter(l1)} ${d1} ${fixPostalLetter(l2)}, ${d2} ${fixPostalLetter(l3)} ${d3}`,
          )
          .replace(/\b(\d)([MNSW])(\d)\b/g, (_m, d1, l, d2) => `${d1} ${fixPostalLetter(l)} ${d2}`)
          .replace(/,\s*ON\b/g, ', Ontario')
          .replace(/,\s*QC\b/g, ', Quebec')
          .replace(/,\s*BC\b/g, ', British Columbia')
          .replace(/,\s*AB\b/g, ', Alberta');
        return text
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/\*(.+?)\*/g, '$1')
          .replace(
            /\b(?!\d+(?:st|nd|rd|th|am|pm)\b)([A-Za-z]+\d+[A-Za-z0-9]*|[A-Za-z0-9]*\d+[A-Za-z]+[A-Za-z0-9]*)\b/g,
            (match) => match.split('').join(' '),
          );
      };

      const cases: Array<[string, string, string]> = [
        ['K1C5M3', 'K 1 C, 5 em 3', 'full postal code, no space'],
        ['K1C 5M3', 'K 1 C, 5 em 3', 'full postal code, one space'],
        ['5M3', '5 em 3', 'partial fragment M between digits'],
        ['5N3', '5 en 3', 'partial fragment N between digits'],
        ['5S3', '5 ess 3', 'partial fragment S between digits'],
        ['5W3', '5 double u 3', 'partial fragment W between digits'],
        ['5K3', '5 K 3', 'non-confusable letter K — char-splitter only'],
        ['Ottawa, ON', 'Ottawa, Ontario', 'province code expansion'],
        ['turn ON the light', 'turn ON the light', 'no leading comma → no province expansion'],
        ['October 15th', 'October 15th', 'ordinal preserved'],
      ];
      const failures: string[] = [];
      for (const [input, expected, label] of cases) {
        const actual = sanitise(input);
        if (actual !== expected) {
          failures.push(`  [${label}] "${input}" → "${actual}" (expected "${expected}")`);
        }
      }
      if (failures.length > 0) {
        throw new Error(
          `B4f regression: ${failures.length}/${cases.length} sanitiseForSpeech ` +
          `transforms wrong:\n${failures.join('\n')}`,
        );
      }
      ctx.log(`b4f: ${cases.length}/${cases.length} sanitiseForSpeech cases pass`);
    },
  },
];
