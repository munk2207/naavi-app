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
    description: 'V57.11.6 regression — "schedule a meeting with Bob tomorrow at 9 AM" must emit CREATE_EVENT with empty attendees (no auto-invite). 2026-05-15: date phrasing made wall-clock-agnostic — original "Friday at 4 PM" became ambiguous when run after 4 PM Eastern on a Friday.',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'schedule a meeting with Bob tomorrow at 9 AM' }],
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

  // ──────────────────────────────────────────────────────────────────────
  // F1a Session 2 — LIST_CONNECT / LIST_DISCONNECT / LIST_CONNECTION_QUERY
  // / LIST_DELETE prompt regressions (prompt v68 RULE 8b).
  // Spec: docs/F1A_LISTS_AND_CONNECTIONS_SPEC.md.
  //
  // Locks in:
  //   - Connect phrasings emit LIST_CONNECT with listName + entityRef + entityType
  //   - "Add my X list to Y" disambiguates as LIST_CONNECT, not LIST_ADD
  //   - Disconnect phrasings emit LIST_DISCONNECT
  //   - "Remove eggs from groceries" stays as LIST_REMOVE (item op, not
  //     connection op) — disambiguation regression baseline
  //   - "Where is my X list" emits LIST_CONNECTION_QUERY mode=where_is_list
  //   - "What list is on my Y" emits LIST_CONNECTION_QUERY mode=what_list_is_on
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'prompt-regression.list-connect-basic',
    category: 'prompt-regression',
    description: 'F1a — "Connect my groceries list to my Costco alert" speaks the confirmation phrase first AND does NOT emit LIST_CONNECT on first turn (per spec — Claude waits for "yes" before firing)',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Connect my groceries list to my Costco alert' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 300)}…`);

      const speech = extractSpeech(data?.rawText ?? '');
      // Claude must demonstrate it understood: speech mentions the action
      // (attach/connect) AND the entities (groceries + costco).
      expectTruthy(/attach|connect/i.test(speech),
        `expected speech to mention attach/connect; got: "${speech.slice(0,200)}"`);
      expectTruthy(/groceries/i.test(speech),
        `expected speech to mention "groceries"; got: "${speech.slice(0,200)}"`);
      expectTruthy(/costco/i.test(speech),
        `expected speech to mention "Costco"; got: "${speech.slice(0,200)}"`);
      // Standard 3-option confirmation phrase must be present.
      expectTruthy(/say yes to confirm/i.test(speech),
        `expected confirmation phrase; got: "${speech.slice(0,200)}"`);
      // Per spec, NO list_connect action on first turn — Claude waits for "yes".
      const action = findActionInRawText(data?.rawText ?? '', 'LIST_CONNECT');
      if (action) {
        throw new Error(`LIST_CONNECT must NOT be emitted on first turn — Claude must wait for user confirmation (got: ${JSON.stringify(action)})`);
      }
    },
  },

  {
    id: 'prompt-regression.list-connect-add-variant',
    category: 'prompt-regression',
    description: 'F1a — "Add my errands list to my Costco alert" must NOT emit LIST_ADD (item op). It either confirms a LIST_CONNECT or asks disambiguation when multiple Costco entities exist — both are spec-correct.',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Add my errands list to my Costco alert' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 300)}…`);

      // Hard requirement: must NOT be misinterpreted as an item add.
      const addAction = findActionInRawText(data?.rawText ?? '', 'LIST_ADD');
      if (addAction) {
        throw new Error(`LIST_ADD emitted — "add my X list to Y" is a connection, not an item add (got: ${JSON.stringify(addAction)})`);
      }
      // Soft requirement: speech must demonstrate connection-intent (attach/connect/list)
      // OR ask disambiguation when multiple Costco entities exist.
      const speech = extractSpeech(data?.rawText ?? '');
      const hasIntent = /attach|connect|which costco|i see two|multiple/i.test(speech);
      expectTruthy(hasIntent,
        `expected speech to show connection-intent or disambiguation; got: "${speech.slice(0,200)}"`);
    },
  },

  {
    id: 'prompt-regression.list-disconnect-basic',
    category: 'prompt-regression',
    description: 'F1a — "Disconnect my groceries list from my Costco alert" → LIST_DISCONNECT',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Disconnect my groceries list from my Costco alert' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 300)}…`);

      const action = findActionInRawText(data?.rawText ?? '', 'LIST_DISCONNECT');
      expectTruthy(action, 'LIST_DISCONNECT action');
      expectTruthy(/costco/i.test(String(action.entityRef ?? '')),
        `expected entityRef containing "Costco", got: ${JSON.stringify(action.entityRef)}`);
    },
  },

  {
    id: 'prompt-regression.list-remove-item-not-disconnect',
    category: 'prompt-regression',
    description: 'F1a disambiguation — "remove eggs from my groceries list" must emit LIST_REMOVE (item op), NOT LIST_DISCONNECT (connection op)',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'remove eggs from my groceries list' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 300)}…`);

      const removeAction     = findActionInRawText(data?.rawText ?? '', 'LIST_REMOVE');
      const disconnectAction = findActionInRawText(data?.rawText ?? '', 'LIST_DISCONNECT');
      expectTruthy(removeAction, 'LIST_REMOVE action — item op');
      if (disconnectAction) {
        throw new Error('LIST_DISCONNECT also emitted — should be LIST_REMOVE only (item op, not connection op)');
      }
    },
  },

  {
    id: 'prompt-regression.list-connection-query-where',
    category: 'prompt-regression',
    description: 'F1a — "Where is my groceries list connected?" → LIST_CONNECTION_QUERY mode=where_is_list',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Where is my groceries list connected?' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 300)}…`);

      const action = findActionInRawText(data?.rawText ?? '', 'LIST_CONNECTION_QUERY');
      expectTruthy(action, 'LIST_CONNECTION_QUERY action');
      expectTruthy(String(action.mode ?? '').toLowerCase() === 'where_is_list',
        `expected mode=where_is_list, got: ${JSON.stringify(action.mode)}`);
      expectTruthy(/groceries/i.test(String(action.listName ?? '')),
        `expected listName containing "groceries", got: ${JSON.stringify(action.listName)}`);
    },
  },

  {
    id: 'prompt-regression.list-connection-query-what',
    category: 'prompt-regression',
    description: 'F1a — "What list is on my Costco alert?" → LIST_CONNECTION_QUERY mode=what_list_is_on with entityRef + entityType',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'What list is on my Costco alert?' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 300)}…`);

      const action = findActionInRawText(data?.rawText ?? '', 'LIST_CONNECTION_QUERY');
      expectTruthy(action, 'LIST_CONNECTION_QUERY action');
      expectTruthy(String(action.mode ?? '').toLowerCase() === 'what_list_is_on',
        `expected mode=what_list_is_on, got: ${JSON.stringify(action.mode)}`);
      expectTruthy(/costco/i.test(String(action.entityRef ?? '')),
        `expected entityRef containing "Costco", got: ${JSON.stringify(action.entityRef)}`);
      // V57.15.4 live bug (Wael 2026-05-13): Claude was emitting the
      // action without entityType, mobile orchestrator rejects.
      expectTruthy(String(action.entityType ?? '').length > 0,
        `expected entityType to be present, got: ${JSON.stringify(action.entityType)}`);
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // V57.15.4 LIVE BUG (Wael 2026-05-13) — "What lists are on 688 Bayview
  // office?" Claude emitted LIST_CONNECTION_QUERY without entityType,
  // orchestrator rejected with "entityRef and entityType required". Prompt
  // v74 added explicit entityType inference rules + mandatory-field call-
  // out. This test locks in the fix.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'prompt-regression.list-connection-query-address-must-have-entitytype',
    category: 'prompt-regression',
    description: 'V57.15.4 regression — address-style entityRef must still carry entityType',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'What lists are on 688 Bayview office?' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 300)}…`);

      const action = findActionInRawText(data?.rawText ?? '', 'LIST_CONNECTION_QUERY');
      expectTruthy(action, 'LIST_CONNECTION_QUERY action');
      expectTruthy(String(action.mode ?? '').toLowerCase() === 'what_list_is_on',
        `expected mode=what_list_is_on, got: ${JSON.stringify(action.mode)}`);
      expectTruthy(/bayview/i.test(String(action.entityRef ?? '')),
        `expected entityRef containing "Bayview", got: ${JSON.stringify(action.entityRef)}`);
      expectTruthy(String(action.entityType ?? '').length > 0,
        `expected entityType present (likely action_rule), got: ${JSON.stringify(action.entityType)}`);
    },
  },
];
