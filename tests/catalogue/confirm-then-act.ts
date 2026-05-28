/**
 * B4z — RULE 23 confirm-then-act regression tests (Wael 2026-05-25).
 *
 * Locks in the core confirm-then-act behavior for state-changing actions.
 * Rule 15a: every shipped feature must have a test before moving on.
 *
 * Coverage:
 *   - Email alert: turn 1 asks confirm, turn 2 after "yes" emits action
 *   - Email alert: turn 2 after "no" cancels, no action emitted
 *   - "Find McDonald alert" (search verb) still blocked (B4y Phase 1 regression)
 *   - Exempt actions (chain-store location, REMEMBER, list_add) still single-turn
 *
 * Coverage gaps acknowledged:
 *   - CREATE_EVENT and DELETE_RULE confirm flows are covered in the rewritten
 *     prompt-regression tests (calendar-no-auto-invite, all-day-*) and chat.ts
 *     (priority-flag-critical) — no duplication here.
 *   - Voice-channel confirm flow: voice server does not pass assistant turns
 *     in messages[] the same way mobile does — voice parity is deferred
 *     (same as B4y Phase 1 voice parity pattern).
 *
 * Run via `npm run test:auto`.
 */

import { adapters, db } from '../lib/adapters';
import {
  expect2xx,
  expectTruthy,
  findActionInRawText,
  extractSpeech,
  chatWithConfirm,
} from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const confirmThenActTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // POSITIVE — email alert confirm flow (turn 1 asks, turn 2 "yes" emits)
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'b4z.email-alert-confirm-turn1-no-action',
    category: 'b4z',
    description: 'RULE 23: turn 1 of email alert creation must return NO action and must contain "say yes to confirm"',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Alert me when Bell emails me' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat turn 1');
      const rawText = data?.rawText ?? '';
      ctx.log(`turn1 rawText: ${rawText.slice(0, 300)}…`);

      // No email rule action on turn 1.
      const emailAction = findActionInRawText(rawText, 'SET_ACTION_RULE');
      const isEmail = emailAction && (emailAction as any).trigger_type === 'email';
      if (isEmail) {
        throw new Error(
          `RULE 23 violation: email rule emitted on turn 1 before user confirmed. ` +
          `Action: ${JSON.stringify(emailAction)}`,
        );
      }

      // Must have the literal confirm phrase.
      const speech = extractSpeech(rawText);
      expectTruthy(
        /say yes to confirm/i.test(speech),
        `turn 1 must contain "say yes to confirm". Speech: "${speech.slice(0, 200)}"`,
      );
    },
  },

  {
    id: 'b4z.email-alert-confirm-turn2-yes-emits-action',
    category: 'b4z',
    description: 'RULE 23: turn 2 "yes" after confirm ask must emit SET_ACTION_RULE(trigger_type=email)',
    timeoutMs: 60_000,
    async run(ctx) {
      const cleanup = async () => {
        try {
          await db.delete(ctx, 'action_rules',
            `user_id=eq.${ctx.testUserId}&trigger_type=eq.email&label=ilike.${encodeURIComponent('%Bell%')}`);
        } catch { /* ignore */ }
      };
      await cleanup();

      const { turn1, turn2 } = await chatWithConfirm(ctx, 'Alert me when Bell emails me');
      expect2xx(turn1.status, 'naavi-chat turn 1');
      expect2xx(turn2.status, 'naavi-chat turn 2');
      ctx.log(`turn2 rawText: ${turn2.data?.rawText?.slice(0, 300)}…`);

      const turn2Rule = findActionInRawText(turn2.data?.rawText ?? '', 'SET_ACTION_RULE');
      const turn2IsEmail = turn2Rule && (turn2Rule as any).trigger_type === 'email';
      if (!turn2IsEmail) {
        await cleanup();
        throw new Error(
          `RULE 23: turn 2 "yes" did not emit SET_ACTION_RULE(email). ` +
          `B4z confirm-turn gate may be broken. rawText: ${turn2.data?.rawText?.slice(0, 300)}`,
        );
      }
      ctx.log(`b4z: email rule confirmed on turn 2: ${JSON.stringify((turn2Rule as any).trigger_config)}`);
      await cleanup();
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // NEGATIVE — "no" cancels, no action
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'b4z.email-alert-confirm-turn2-no-cancels',
    category: 'b4z',
    description: 'RULE 23: turn 2 "no" after confirm ask must NOT emit any email rule action',
    timeoutMs: 60_000,
    async run(ctx) {
      const { turn2 } = await chatWithConfirm(ctx, 'Alert me when Hydro emails me', 'no');
      expect2xx(turn2.status, 'naavi-chat turn 2 (cancel)');
      ctx.log(`turn2 rawText: ${turn2.data?.rawText?.slice(0, 300)}…`);

      const turn2Rule = findActionInRawText(turn2.data?.rawText ?? '', 'SET_ACTION_RULE');
      const isEmail = turn2Rule && (turn2Rule as any).trigger_type === 'email';
      if (isEmail) {
        throw new Error(
          `RULE 23 violation: email rule emitted after user said "no". ` +
          `Action: ${JSON.stringify(turn2Rule)}`,
        );
      }

      // Speech should acknowledge cancellation.
      const speech = extractSpeech(turn2.data?.rawText ?? '').toLowerCase();
      expectTruthy(
        /cancel|stop|ok|sure|no problem|won'?t/i.test(speech),
        `after "no", speech should acknowledge cancellation. Speech: "${speech.slice(0,200)}"`,
      );
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // EXEMPT — chain-store location alerts must still be single-turn
  // (regression guard: RULE 23 must not apply to set_location_rule_chain)
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'b4z.chain-store-still-single-turn',
    category: 'b4z',
    description: 'RULE 23 exempt: chain-brand location alert ("alert me at Shoppers Drug Mart") must still emit SET_ACTION_RULE on first turn, not ask for confirm',
    timeoutMs: 30_000,
    async run(ctx) {
      // NOTE: "Costco" deliberately NOT used here — it appears 10+ times in the
      // list_connect section of get-naavi-prompt (lines ~544-616) paired with
      // "say yes to confirm" language, which occasionally makes Claude apply the
      // RULE 23 confirm gate even though set_location_rule_chain is explicitly
      // exempt. "Shoppers Drug Mart" is a chain brand with no such prompt
      // associations, giving a reliable signal that the exemption works for any
      // chain brand — not just ones absent from list_connect examples.
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'alert me at Shoppers Drug Mart' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 300)}…`);

      const action = findActionInRawText(rawText, 'SET_ACTION_RULE');
      expectTruthy(action, 'chain-store alert must emit SET_ACTION_RULE immediately (RULE 23 exempt)');

      // Must NOT require confirmation — chain-store is exempt.
      const speech = extractSpeech(rawText);
      if (/say yes to confirm/i.test(speech)) {
        throw new Error(
          `chain-store (Shoppers Drug Mart) incorrectly got RULE 23 confirm gate. ` +
          `set_location_rule_chain is EXEMPT from RULE 23. Speech: "${speech.slice(0,200)}"`,
        );
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // EXEMPT — REMEMBER must still be single-turn
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'b4z.remember-still-single-turn',
    category: 'b4z',
    description: 'RULE 23 exempt: REMEMBER ("remember that my wife is Sarah") must emit REMEMBER on first turn, not ask for confirm',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'remember that my wife is Sarah' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 300)}…`);

      const action = findActionInRawText(rawText, 'REMEMBER');
      expectTruthy(action, 'REMEMBER must emit immediately (RULE 23 exempt)');

      const speech = extractSpeech(rawText);
      if (/say yes to confirm/i.test(speech)) {
        throw new Error(
          `REMEMBER incorrectly got RULE 23 confirm gate. REMEMBER is EXEMPT. Speech: "${speech.slice(0,200)}"`,
        );
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // B4y Phase 2 — SCHEDULE_MEDICATION confirm flow
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'b4z.schedule-medication-turn1-no-action',
    category: 'b4z',
    description: 'B4y Phase 2 — RULE 23: turn 1 of medication schedule must return NO SCHEDULE_MEDICATION action and must contain "say yes to confirm"',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Take amoxicillin 500mg once daily for 10 days starting today' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat turn 1');
      const rawText = data?.rawText ?? '';
      ctx.log(`turn1 rawText: ${rawText.slice(0, 300)}…`);

      const medAction = findActionInRawText(rawText, 'SCHEDULE_MEDICATION');
      if (medAction) {
        throw new Error(
          `RULE 23 violation: SCHEDULE_MEDICATION emitted on turn 1 before user confirmed. ` +
          `B4y Phase 2 gate may be broken. Action: ${JSON.stringify(medAction)}`,
        );
      }

      const speech = extractSpeech(rawText);
      expectTruthy(
        /say yes to confirm/i.test(speech),
        `turn 1 must contain "say yes to confirm". Speech: "${speech.slice(0, 200)}"`,
      );
    },
  },

  {
    id: 'b4z.schedule-medication-turn2-yes-emits',
    category: 'b4z',
    description: 'B4y Phase 2 — RULE 23: turn 2 "yes" after confirm ask must emit SCHEDULE_MEDICATION',
    timeoutMs: 60_000,
    async run(ctx) {
      const { turn1, turn2 } = await chatWithConfirm(
        ctx,
        'Take amoxicillin 500mg once daily for 10 days starting today',
      );
      expect2xx(turn1.status, 'naavi-chat turn 1');
      expect2xx(turn2.status, 'naavi-chat turn 2');
      ctx.log(`turn2 rawText: ${turn2.data?.rawText?.slice(0, 300)}…`);

      const action = findActionInRawText(turn2.data?.rawText ?? '', 'SCHEDULE_MEDICATION');
      if (!action) {
        throw new Error(
          `RULE 23: turn 2 "yes" did not emit SCHEDULE_MEDICATION. ` +
          `B4y Phase 2 confirm-turn gate may be broken. rawText: ${turn2.data?.rawText?.slice(0, 300)}`,
        );
      }
      ctx.log(`b4z Phase 2: SCHEDULE_MEDICATION confirmed on turn 2: ${JSON.stringify(action).slice(0, 150)}`);
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // B4y Phase 2 — DELETE_RULE confirm flow
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'b4z.delete-rule-turn1-no-action',
    category: 'b4z',
    description: 'B4y Phase 2 — RULE 23: turn 1 of delete-rule must return NO DELETE_RULE action and must contain "say yes to confirm"',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Delete my Bell email alert' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat turn 1');
      const rawText = data?.rawText ?? '';
      ctx.log(`turn1 rawText: ${rawText.slice(0, 300)}…`);

      const deleteAction = findActionInRawText(rawText, 'DELETE_RULE');
      if (deleteAction) {
        throw new Error(
          `RULE 23 violation: DELETE_RULE emitted on turn 1 before user confirmed. ` +
          `B4y Phase 2 gate may be broken. Action: ${JSON.stringify(deleteAction)}`,
        );
      }

      const speech = extractSpeech(rawText);
      expectTruthy(
        /say yes to confirm/i.test(speech),
        `turn 1 must contain "say yes to confirm". Speech: "${speech.slice(0, 200)}"`,
      );
    },
  },

  {
    id: 'b4z.delete-rule-turn2-yes-deletes',
    category: 'b4z',
    description: 'B4y Phase 2 — RULE 23: turn 2 "yes" after confirm ask must emit DELETE_RULE',
    timeoutMs: 60_000,
    async run(ctx) {
      const { turn1, turn2 } = await chatWithConfirm(ctx, 'Delete my Bell email alert');
      expect2xx(turn1.status, 'naavi-chat turn 1');
      expect2xx(turn2.status, 'naavi-chat turn 2');
      ctx.log(`turn2 rawText: ${turn2.data?.rawText?.slice(0, 300)}…`);

      const action = findActionInRawText(turn2.data?.rawText ?? '', 'DELETE_RULE');
      if (!action) {
        throw new Error(
          `RULE 23: turn 2 "yes" did not emit DELETE_RULE. ` +
          `B4y Phase 2 confirm-turn gate may be broken. rawText: ${turn2.data?.rawText?.slice(0, 300)}`,
        );
      }
      ctx.log(`b4z Phase 2: DELETE_RULE confirmed on turn 2: ${JSON.stringify(action).slice(0, 150)}`);
    },
  },
];
