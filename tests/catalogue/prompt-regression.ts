/**
 * Prompt-behavior regression tests — V57.11.7 (Wael 2026-05-06).
 *
 * Catches the prompt-drift cycle: every time we add or change a rule for
 * one bug, Claude's behavior on a previously-fixed scenario regresses.
 *
 * Each test here LOCKS IN a previously-working behavior. When a future
 * prompt edit dilutes a rule, this suite fails LOUDLY before the AAB
 * ships. End-of-loop: regressions are caught in CI, not on Wael's phone.
 *
 * Source — bugs from the V57.11.x test cycle:
 *   1. Multi-location picker regression (chain-store rule diluted by v58)
 *   2. LIST_RULES → wrong action (GLOBAL_SEARCH instead of LIST_RULES)
 *   3. Calendar invite scope (Bob auto-invited when user didn't ask)
 *   4. Naavi estimating travel time (prompt v58 should have stopped this)
 *   5. Personal-keyword rule (home / office) must not ask for clarification
 *
 * If any of these starts failing, the prompt change should be reverted
 * or refined before deploy. Run via `npm run test:auto`.
 */

import { adapters } from '../lib/adapters';
import {
  expect2xx,
  expectTruthy,
  expectActionType,
  findActionInRawText,
  extractSpeech,
  expectSpeechNotMatch,
  TestSkippedError,
} from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const promptRegressionTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // CHAIN-STORE RULE — bare-brand input must trigger SET_ACTION_RULE,
  // not a "Which X?" clarification question.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'prompt-regression.chain-store-walmart',
    category: 'prompt-regression',
    description: 'V57.11.6 regression — "alert me at Walmart" must emit SET_ACTION_RULE with bare brand and NOT ask "Which Walmart?"',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'alert me at Walmart' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 250)}…`);

      const action = findActionInRawText(data?.rawText ?? '', 'SET_ACTION_RULE');
      expectTruthy(action, 'SET_ACTION_RULE action — chain rule must emit, not ask');
      expectActionType(action, 'SET_ACTION_RULE');

      expectSpeechNotMatch(
        data?.rawText ?? '',
        /which walmart\?|give me a street|give me a neighborhood/i,
        'chain-store walmart',
      );
    },
  },

  {
    id: 'prompt-regression.chain-store-tim-hortons',
    category: 'prompt-regression',
    description: '"alert me at Tim Hortons" must emit SET_ACTION_RULE with bare brand "Tim Hortons" — no clarification question',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'alert me at Tim Hortons' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 250)}…`);

      const action = findActionInRawText(data?.rawText ?? '', 'SET_ACTION_RULE');
      expectTruthy(action, 'SET_ACTION_RULE action');

      expectSpeechNotMatch(
        data?.rawText ?? '',
        /which tim hortons\?|give me a street|give me a neighborhood/i,
        'chain-store tim hortons',
      );
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // LIST_RULES — "what alerts do I have" must emit LIST_RULES, not just
  // GLOBAL_SEARCH on the query string.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'prompt-regression.list-rules-emits-action',
    category: 'prompt-regression',
    description: 'V57.11.6 regression — "what alerts do I have?" must emit LIST_RULES action',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'what alerts do I have?' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 250)}…`);

      const action = findActionInRawText(data?.rawText ?? '', 'LIST_RULES');
      expectTruthy(action, 'LIST_RULES action — must emit, not just GLOBAL_SEARCH');
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // CALENDAR INVITE SCOPE — "schedule a meeting with Bob" without explicit
  // invite request must NOT auto-add Bob as attendee. (V57.11.6 prompt v58
  // bug: Naavi auto-invited.)
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'prompt-regression.calendar-no-auto-invite',
    category: 'prompt-regression',
    description: 'V57.11.6 regression — "schedule a meeting with Bob on Friday at 4 PM" must emit CREATE_EVENT with empty attendees (no auto-invite)',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'schedule a meeting with Bob on Friday at 4 PM' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 300)}…`);

      const action = findActionInRawText(data?.rawText ?? '', 'CREATE_EVENT');
      expectTruthy(action, 'CREATE_EVENT action');

      // attendees should be empty OR absent. "with Bob" is descriptive,
      // not a directive to invite.
      const attendees = action.attendees;
      if (Array.isArray(attendees) && attendees.length > 0) {
        throw new Error(
          `expected empty attendees (descriptive "with Bob"), got: ${JSON.stringify(attendees)}`
        );
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // TRAVEL-TIME ESTIMATE — Claude must not invent a duration in speech.
  // Card has the truth from Google Maps. (V57.11.5 prompt v57+ rule.)
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'prompt-regression.navigate-no-claude-estimate',
    category: 'prompt-regression',
    description: 'V57.11.5 — "navigate to my next meeting" must NOT include a hallucinated duration ("about N minutes from here") in speech',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'navigate to my next meeting' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`speech: ${extractSpeech(data?.rawText ?? '').slice(0, 200)}…`);

      // Claude must defer travel duration to the orchestrator's card.
      expectSpeechNotMatch(
        data?.rawText ?? '',
        /\babout\s+\d+\s+minutes?\s+(?:from\s+here|away|drive)\b/i,
        'navigate-claude-estimate',
      );
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // PERSONAL KEYWORDS — "home" / "office" must emit SET_ACTION_RULE with
  // the keyword as place_name, no clarification.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'prompt-regression.home-no-clarification',
    category: 'prompt-regression',
    description: '"alert me when I arrive home" must emit SET_ACTION_RULE with place_name="home" (or trigger_config), NOT ask "which home?"',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'alert me when I arrive home' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 250)}…`);

      const action = findActionInRawText(data?.rawText ?? '', 'SET_ACTION_RULE');
      expectTruthy(action, 'SET_ACTION_RULE action');

      expectSpeechNotMatch(
        data?.rawText ?? '',
        /which home\?|whose home\?|give me an address/i,
        'home-clarification',
      );
    },
  },

  {
    id: 'prompt-regression.office-no-clarification',
    category: 'prompt-regression',
    description: '"alert me when I arrive at the office" must emit SET_ACTION_RULE for office, NOT ask "which office?"',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'alert me when I arrive at the office' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 250)}…`);

      const action = findActionInRawText(data?.rawText ?? '', 'SET_ACTION_RULE');
      expectTruthy(action, 'SET_ACTION_RULE action');

      expectSpeechNotMatch(
        data?.rawText ?? '',
        /which office\?|whose office\?/i,
        'office-clarification',
      );
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // REMEMBER — "remember that I take Lipitor at 8 AM" must emit REMEMBER
  // (regression baseline for memory write).
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'prompt-regression.remember-medication',
    category: 'prompt-regression',
    description: '"remember that I take Lipitor at 8 AM" must emit REMEMBER action',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'remember that I take Lipitor at 8 AM' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 250)}…`);

      const action = findActionInRawText(data?.rawText ?? '', 'REMEMBER');
      expectTruthy(action, 'REMEMBER action');
    },
  },
];
