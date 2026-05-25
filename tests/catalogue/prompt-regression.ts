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

import { adapters, db } from '../lib/adapters';
import {
  expect2xx,
  expectTruthy,
  expectActionType,
  findActionInRawText,
  extractSpeech,
  expectSpeechNotMatch,
  chatWithConfirm,
  TestSkippedError,
} from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

// 2026-05-23 (Wael) — seed helpers for the entity-existence world.
// naavi-chat now validates that list_connect/disconnect/connection_query
// targets actually exist in the user's data. Before this, these prompt-
// regression tests assumed Claude would emit the right action regardless
// of data — but now the server intercepts and overrides if the entity
// doesn't exist. So every test that references "Costco alert" /
// "groceries list" / "688 Bayview office" must seed those entities up
// front and clean up after.
async function seedCostcoAlert(ctx: TestContext): Promise<void> {
  await db.insert(ctx, 'action_rules', {
    user_id:        ctx.testUserId,
    trigger_type:   'location',
    trigger_config: {
      place_name:    'Costco',
      direction:     'arrive',
      resolved_lat:  0,
      resolved_lng:  0,
      radius_meters: 300,
    },
    action_type:   'sms',
    action_config: { to_phone: '+10000000000', body: 'prompt-regression seed' },
    label:         'Alert when arriving at Costco',
    one_shot:      false,
    enabled:       true,
  });
}
async function deleteCostcoAlert(ctx: TestContext): Promise<void> {
  await db.delete(
    ctx,
    'action_rules',
    `user_id=eq.${ctx.testUserId}&label=eq.${encodeURIComponent('Alert when arriving at Costco')}`,
  );
}
async function seedGroceriesList(ctx: TestContext): Promise<void> {
  await db.insert(ctx, 'lists', {
    user_id:       ctx.testUserId,
    name:          'groceries',
    category:      'shopping',
    drive_file_id: 'prompt-regression-seed-groceries',
  });
}
async function deleteGroceriesList(ctx: TestContext): Promise<void> {
  await db.delete(
    ctx,
    'lists',
    `user_id=eq.${ctx.testUserId}&name=eq.groceries`,
  );
}
async function seedBayviewOfficeAlert(ctx: TestContext): Promise<void> {
  await db.insert(ctx, 'action_rules', {
    user_id:        ctx.testUserId,
    trigger_type:   'location',
    trigger_config: {
      place_name:    '688 Bayview office',
      direction:     'arrive',
      resolved_lat:  0,
      resolved_lng:  0,
      radius_meters: 300,
    },
    action_type:   'sms',
    action_config: { to_phone: '+10000000000', body: 'prompt-regression seed' },
    label:         'Alert when arriving at 688 Bayview office',
    one_shot:      false,
    enabled:       true,
  });
}
async function deleteBayviewOfficeAlert(ctx: TestContext): Promise<void> {
  await db.delete(
    ctx,
    'action_rules',
    `user_id=eq.${ctx.testUserId}&label=eq.${encodeURIComponent('Alert when arriving at 688 Bayview office')}`,
  );
}

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
    description: 'V57.11.6 regression — "schedule a meeting with Bob tomorrow at 9 AM" must emit CREATE_EVENT with empty attendees (no auto-invite). 2026-05-15: date phrasing wall-clock-agnostic. B4z 2026-05-25: updated to 2-turn confirm-then-act (RULE 23).',
    timeoutMs: 60_000,
    async run(ctx) {
      const { turn1, turn2 } = await chatWithConfirm(ctx, 'schedule a meeting with Bob tomorrow at 9 AM');
      expect2xx(turn1.status, 'naavi-chat turn 1');
      expect2xx(turn2.status, 'naavi-chat turn 2');

      ctx.log(`turn1 rawText: ${turn1.data?.rawText?.slice(0, 250)}…`);
      ctx.log(`turn2 rawText: ${turn2.data?.rawText?.slice(0, 300)}…`);

      // Turn 1: Claude must ask for confirmation, no action emitted.
      const turn1Action = findActionInRawText(turn1.data?.rawText ?? '', 'CREATE_EVENT');
      if (turn1Action) {
        throw new Error(`RULE 23 violation: CREATE_EVENT emitted on turn 1 (must wait for confirm). Action: ${JSON.stringify(turn1Action)}`);
      }
      const turn1Speech = extractSpeech(turn1.data?.rawText ?? '');
      expectTruthy(/say yes to confirm/i.test(turn1Speech),
        `turn 1 must contain "say yes to confirm" phrase. Speech: "${turn1Speech.slice(0,200)}"`);

      // Turn 2: CREATE_EVENT must be emitted.
      const action = findActionInRawText(turn2.data?.rawText ?? '', 'CREATE_EVENT');
      expectTruthy(action, 'CREATE_EVENT action on turn 2 (after yes)');

      // attendees should be empty OR absent. "with Bob" is descriptive, not a directive to invite.
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
  // CONTACT POSSESSIVE ADDRESS — "alert me when I arrive to [Name] office"
  // must emit SET_ACTION_RULE immediately. Must NOT ask for the address
  // (the address is on the contact card — server resolves via Google Contacts).
  // Regression for live bug caught 2026-05-25: Naavi asked "I need the address
  // of Dr. Ashraf Younan's office before I can set the alert."
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'prompt-regression.contact-possessive-no-address-question',
    category: 'prompt-regression',
    description: '"alert me when I arrive to dr. Ashraf Younan office" must emit SET_ACTION_RULE immediately — must NOT ask for the address',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'alert me when I arrive to dr. Ashraf Younan office' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 300)}…`);

      // Must emit action immediately — no address question, no confirm ask.
      const action = findActionInRawText(rawText, 'SET_ACTION_RULE');
      expectTruthy(action, 'SET_ACTION_RULE must be emitted immediately for contact possessive address');

      // Must NOT ask for the address.
      expectSpeechNotMatch(
        rawText,
        /i need the address|what.?s the (street )?address|give me the address|what is the address/i,
        'contact-possessive-address-question',
      );

      // Must NOT apply RULE 23 confirm gate (location alerts are exempt).
      expectSpeechNotMatch(
        rawText,
        /say yes to confirm/i,
        'contact-possessive-no-rule23-confirm',
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
    description: 'F1a — "Connect my groceries list to my Costco alert" speaks the confirmation phrase first AND does NOT emit LIST_CONNECT on first turn (per spec — Claude waits for "yes" before firing). Seeds groceries list + Costco alert so naavi-chat\'s server-side entity-existence validation accepts the intent.',
    timeoutMs: 30_000,
    async setup(ctx)    { await seedGroceriesList(ctx); await seedCostcoAlert(ctx); },
    async teardown(ctx) { await deleteCostcoAlert(ctx); await deleteGroceriesList(ctx); },
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
    description: 'F1a — "Disconnect my groceries list from my Costco alert" speaks the confirmation phrase first AND does NOT emit LIST_DISCONNECT on first turn (per spec — every connect/disconnect/delete-list confirms before firing, prompt v90 made the "say yes to confirm" gate mandatory). Seeds groceries + Costco for entity-existence validation.',
    timeoutMs: 30_000,
    async setup(ctx)    { await seedGroceriesList(ctx); await seedCostcoAlert(ctx); },
    async teardown(ctx) { await deleteCostcoAlert(ctx); await deleteGroceriesList(ctx); },
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Disconnect my groceries list from my Costco alert' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      ctx.log(`rawText: ${data?.rawText?.slice(0, 300)}…`);

      const speech = extractSpeech(data?.rawText ?? '');
      // Claude must demonstrate it understood: speech mentions the action
      // (detach/disconnect) AND the entities (groceries + costco).
      expectTruthy(/detach|disconnect/i.test(speech),
        `expected speech to mention detach/disconnect; got: "${speech.slice(0,200)}"`);
      expectTruthy(/groceries/i.test(speech),
        `expected speech to mention "groceries"; got: "${speech.slice(0,200)}"`);
      expectTruthy(/costco/i.test(speech),
        `expected speech to mention "Costco"; got: "${speech.slice(0,200)}"`);
      // Standard 3-option confirmation phrase must be present.
      expectTruthy(/say yes to confirm/i.test(speech),
        `expected confirmation phrase; got: "${speech.slice(0,200)}"`);
      // Per spec, NO list_disconnect action on first turn — Claude waits for "yes".
      const action = findActionInRawText(data?.rawText ?? '', 'LIST_DISCONNECT');
      if (action) {
        throw new Error(`LIST_DISCONNECT must NOT be emitted on first turn — Claude must wait for user confirmation (got: ${JSON.stringify(action)})`);
      }
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
    description: 'F1a — "What list is on my Costco alert?" → LIST_CONNECTION_QUERY mode=what_list_is_on with entityRef + entityType. Seeds Costco alert so naavi-chat entity-existence validation accepts the query.',
    timeoutMs: 30_000,
    async setup(ctx)    { await seedCostcoAlert(ctx); },
    async teardown(ctx) { await deleteCostcoAlert(ctx); },
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
    description: 'V57.15.4 regression — address-style entityRef must still carry entityType. Seeds 688 Bayview office alert so naavi-chat entity-existence validation accepts the query.',
    timeoutMs: 30_000,
    async setup(ctx)    { await seedBayviewOfficeAlert(ctx); },
    async teardown(ctx) { await deleteBayviewOfficeAlert(ctx); },
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

  // ──────────────────────────────────────────────────────────────────────
  // ALL-DAY EVENTS — must use date-only "YYYY-MM-DD" format.
  // Bug 2026-05-17: Huss saw "Today — Victoria Day at 8:00 p.m." for an
  // event meant for May 18. Claude was emitting "2026-05-18T00:00:00Z"
  // which renders as 8 PM EDT the PREVIOUS day in Toronto. Prompt v77
  // added explicit all-day rules + a critical warning. These two tests
  // lock the date-only-string requirement for holidays and the explicit
  // "all day" phrasing.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'prompt-regression.all-day-holiday-date-only-format',
    category: 'prompt-regression',
    description: 'V57 prompt v77 — holiday name + date must emit CREATE_EVENT with date-only start (YYYY-MM-DD), NEVER T00:00:00. B4z 2026-05-25: updated to 2-turn confirm-then-act (RULE 23).',
    timeoutMs: 60_000,
    async run(ctx) {
      const { turn1, turn2 } = await chatWithConfirm(ctx, 'Add Victoria Day to my calendar on May 18');
      expect2xx(turn1.status, 'naavi-chat turn 1');
      expect2xx(turn2.status, 'naavi-chat turn 2');
      ctx.log(`turn1: ${turn1.data?.rawText?.slice(0, 250)}…`);
      ctx.log(`turn2: ${turn2.data?.rawText?.slice(0, 300)}…`);

      // Turn 1: no action, must have confirm phrase.
      const turn1Action = findActionInRawText(turn1.data?.rawText ?? '', 'CREATE_EVENT');
      if (turn1Action) {
        throw new Error(`RULE 23 violation: CREATE_EVENT emitted on turn 1. Action: ${JSON.stringify(turn1Action)}`);
      }
      const turn1Speech = extractSpeech(turn1.data?.rawText ?? '');
      expectTruthy(/say yes to confirm/i.test(turn1Speech),
        `turn 1 must contain "say yes to confirm". Speech: "${turn1Speech.slice(0,200)}"`);

      // Turn 2: CREATE_EVENT must use date-only format.
      const action = findActionInRawText(turn2.data?.rawText ?? '', 'CREATE_EVENT');
      expectTruthy(action, 'CREATE_EVENT action on turn 2 — holiday must create an event');
      expectActionType(action, 'CREATE_EVENT');

      const start = String(action.start ?? '');
      const end   = String(action.end ?? '');
      ctx.log(`start=${start}  end=${end}`);

      expectTruthy(
        /^\d{4}-\d{2}-\d{2}$/.test(start),
        `start must be date-only "YYYY-MM-DD" for all-day holiday, got: ${JSON.stringify(start)}`,
      );
      expectTruthy(
        /^\d{4}-\d{2}-\d{2}$/.test(end),
        `end must be date-only "YYYY-MM-DD" for all-day holiday, got: ${JSON.stringify(end)}`,
      );
      expectTruthy(
        !/T00:00:00/i.test(start),
        `start must NOT contain T00:00:00 (renders as 8 PM EDT prior day): ${JSON.stringify(start)}`,
      );
    },
  },
  {
    id: 'prompt-regression.all-day-explicit-phrasing-date-only-format',
    category: 'prompt-regression',
    description: 'V57 prompt v77 — user explicitly says "all day" → CREATE_EVENT must use date-only format, never T00:00:00. B4z 2026-05-25: updated to 2-turn confirm-then-act (RULE 23).',
    timeoutMs: 60_000,
    async run(ctx) {
      const { turn1, turn2 } = await chatWithConfirm(ctx, 'Schedule a vacation day all day on Friday');
      expect2xx(turn1.status, 'naavi-chat turn 1');
      expect2xx(turn2.status, 'naavi-chat turn 2');
      ctx.log(`turn1: ${turn1.data?.rawText?.slice(0, 250)}…`);
      ctx.log(`turn2: ${turn2.data?.rawText?.slice(0, 300)}…`);

      // Turn 1: no action, must have confirm phrase.
      const turn1Action = findActionInRawText(turn1.data?.rawText ?? '', 'CREATE_EVENT');
      if (turn1Action) {
        throw new Error(`RULE 23 violation: CREATE_EVENT emitted on turn 1. Action: ${JSON.stringify(turn1Action)}`);
      }
      const turn1Speech = extractSpeech(turn1.data?.rawText ?? '');
      expectTruthy(/say yes to confirm/i.test(turn1Speech),
        `turn 1 must contain "say yes to confirm". Speech: "${turn1Speech.slice(0,200)}"`);

      // Turn 2: CREATE_EVENT with date-only format.
      const action = findActionInRawText(turn2.data?.rawText ?? '', 'CREATE_EVENT');
      expectTruthy(action, 'CREATE_EVENT action on turn 2 — explicit "all day" must create an event');
      expectActionType(action, 'CREATE_EVENT');

      const start = String(action.start ?? '');
      ctx.log(`start=${start}`);

      expectTruthy(
        /^\d{4}-\d{2}-\d{2}$/.test(start),
        `start must be date-only "YYYY-MM-DD" when user says "all day", got: ${JSON.stringify(start)}`,
      );
      expectTruthy(
        !/T00:00:00/i.test(start),
        `start must NOT contain T00:00:00 (renders as 8 PM EDT prior day): ${JSON.stringify(start)}`,
      );
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // RULE 21 — Speech must match actions (Wael 2026-05-21 trust-breach rule).
  // When the user asks to add nonsense / single-character items, Naavi must
  // either (a) emit list_add with the items, or (b) refuse with explicit
  // disclosure. NEVER say "Added" without the tool call.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'prompt-regression.rule21-list-add-single-letters',
    category: 'prompt-regression',
    description: 'V79 RULE 21 — "add A B C to my groceries list" must either emit LIST_ADD with those items OR say it didn\'t add. NEVER say "Added" without the tool call.',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'add A B C to my groceries list' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 400)}…`);

      const action = findActionInRawText(rawText, 'LIST_ADD');
      const speech = extractSpeech(rawText).toLowerCase();
      const claimsSuccess = /\b(added|done|got it|saved|i added|i've added|i have added)\b/.test(speech);
      const disclosesSkip = /(could you|do you mean|are you sure|i'm not sure|i don'?t|i didn'?t|clarify|confirm|skip|not going to|not adding|seems? like|looks? like)/i.test(speech);

      if (action) {
        // (a) Tool call emitted — that's a valid response. Verify items include the letters.
        const items = Array.isArray((action as any).items) ? (action as any).items.map(String) : [];
        ctx.log(`LIST_ADD emitted with items: ${JSON.stringify(items)}`);
        // No strict assertion on what items contains — Naavi may emit ["A","B","C"] or ["a","b","c"] or even ["A B C"]; what matters is the tool call ran.
      } else {
        // (b) No tool call — speech MUST explicitly disclose the skip.
        expectTruthy(
          !claimsSuccess,
          `Speech claims success ("Added" / "Done" / etc.) but no LIST_ADD tool call was emitted. This is the Rule 21 trust-breach. Speech: ${JSON.stringify(speech)}`,
        );
        expectTruthy(
          disclosesSkip,
          `No LIST_ADD emitted AND speech does not disclose the skip. Per Rule 21, must explicitly say "I didn't add" / "could you confirm" / etc. Speech: ${JSON.stringify(speech)}`,
        );
      }
    },
  },

  {
    id: 'prompt-regression.rule21-list-add-mixed-real-and-test',
    category: 'prompt-regression',
    description: 'V79 RULE 21 — "add milk eggs X to my groceries list" must NOT silently drop the X — either include all 3 in LIST_ADD or disclose the skip.',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'add milk eggs X to my groceries list' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 400)}…`);

      const action = findActionInRawText(rawText, 'LIST_ADD');
      const speech = extractSpeech(rawText).toLowerCase();
      const claimsSuccess = /\b(added|done|got it|saved)\b/.test(speech);
      const mentionsX = /\bx\b/i.test(speech);

      if (action) {
        const items = Array.isArray((action as any).items) ? (action as any).items.map(String) : [];
        ctx.log(`LIST_ADD items: ${JSON.stringify(items)}`);
        // If the tool call dropped X but kept milk and eggs, speech MUST mention the skip.
        const itemsLower = items.map(s => s.toLowerCase());
        const includesX = itemsLower.some(s => /\bx\b/.test(s));
        if (!includesX) {
          expectTruthy(
            mentionsX || /skip|didn'?t add|not sure|confirm/i.test(speech),
            `LIST_ADD dropped X silently and speech does not disclose. Rule 21 requires either all items in the tool call OR explicit disclosure. items=${JSON.stringify(items)} speech=${JSON.stringify(speech)}`,
          );
        }
      } else if (claimsSuccess) {
        throw new Error(`No LIST_ADD emitted but speech claims success. Rule 21 violation. Speech: ${JSON.stringify(speech)}`);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // RULE 22 — speech must use natural prose, never bullet glyphs (•) or
  // markdown bullets ("- " / "* "). Aura ignores those for pausing, so a
  // bulleted list reads as one run-on sentence. Verified manually on
  // Wael's phone 2026-05-22 — added v80 prompt rule. Test asks a
  // list-shaped question that historically produced bullets and asserts
  // the speech field is bullet-free.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'prompt-regression.rule22-speech-no-bullet-glyph',
    category: 'prompt-regression',
    description: 'V80 RULE 22 — schedule reply must not contain bullet glyph (•) in speech (Aura ignores it for pausing).',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'What is my schedule for today?' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 400)}…`);
      const speech = extractSpeech(rawText);
      ctx.log(`speech: ${JSON.stringify(speech)}`);
      expectTruthy(
        !/•/.test(speech),
        `Speech contains bullet glyph "•" — Rule 22 violation. Aura reads bulleted lists as one run-on sentence. Speech: ${JSON.stringify(speech)}`,
      );
    },
  },

  {
    id: 'prompt-regression.rule22-speech-no-markdown-bullets',
    category: 'prompt-regression',
    description: 'V80 RULE 22 — list-shaped reply must not contain markdown bullets ("- " or "* ") at line start in speech.',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'list my alerts' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 400)}…`);
      const speech = extractSpeech(rawText);
      ctx.log(`speech: ${JSON.stringify(speech)}`);
      const hasMarkdownBullet = /(^|\n)\s*[-*]\s+\S/.test(speech);
      expectTruthy(
        !hasMarkdownBullet,
        `Speech contains markdown bullet ("- " or "* ") at line start — Rule 22 violation. Speech: ${JSON.stringify(speech)}`,
      );
    },
  },
];
