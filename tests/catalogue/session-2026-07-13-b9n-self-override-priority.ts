/**
 * Session 2026-07-13 — B9n: two related bugs found live in production,
 * both stemming from a self-override request also carrying stray
 * contamination in `to`/`to_name` or triggering the wrong pre-search path.
 *
 * Bug 1 — self_override vs. to_name priority: Claude/Haiku can populate
 * BOTH a self_override_* field AND to_name in the same params, even though
 * the classifier prompt explicitly forbids it. Confirmed live twice:
 * B9g (contaminated match to an unrelated contact "Laura") and again with
 * a genuinely real contact ("Fatma Elmehelmy") whose phone happened to
 * equal the self-override number — Claude then framed the confirm speech
 * around the third party instead of the self-override, and the stray
 * to_name would have survived into the stored action_config, confusing
 * app/alerts.tsx's detectIsSelf display logic. Fix: hooks/useOrchestrator.ts's
 * SET_ACTION_RULE handler now skips resolve-recipient entirely and strips
 * `to`/`to_name` whenever any self_override_* field is present — self-override
 * always wins.
 *
 * Bug 2 — pre-search false positive on action commands: any message with a
 * 7+ digit run (a phone number) was treated as a retrieval/lookup query
 * (`isRetrievalQuery`), even for clear action commands like "send WhatsApp
 * to +X in 3 minutes say Y". Confirmed live in production: this ran a
 * contact search against the raw action-command text and surfaced an
 * unrelated contact ("Mario Venditti") as a "Results for..." card, even
 * though the actual confirm-ask response was correct. Fix: an
 * isMessageSendAction check (matching the existing isTicketCreation/
 * isEmailAlertCreation false-positive exclusions) now excludes send/text/
 * WhatsApp/message/email + time/location-trigger phrasing from
 * isRetrievalQuery.
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a: hooks/useOrchestrator.ts
 * is a React Native hook with Expo/RN imports that cannot be safely
 * imported into this Node/tsx test runner. These are source-pattern
 * assertions verifying the guards exist with the correct shape and are
 * positioned correctly; they do not execute the real function. Both fixes
 * were live-verified in production before this test was written (Fatma
 * case and Mario Venditti case), but a fresh end-to-end retest of both
 * fixes together has not yet been done — that's a manual follow-up, not
 * covered by this automated test.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const USE_ORCHESTRATOR_PATH = join(process.cwd(), 'hooks', 'useOrchestrator.ts');

export const session2026_07_13_b9nSelfOverridePriorityTests: TestCase[] = [
  {
    id: 'b9n.self-override-skips-recipient-resolution',
    category: 'rules',
    description: 'SET_ACTION_RULE handler skips resolve-recipient (to_name resolution) entirely whenever any self_override_* field is present',
    async run() {
      const src = readFileSync(USE_ORCHESTRATOR_PATH, 'utf8');
      const handlerIdx = src.indexOf("action.type === 'SET_ACTION_RULE'", src.indexOf("action.type === 'SET_ACTION_RULE'") + 1);
      expectTruthy(handlerIdx !== -1, 'SET_ACTION_RULE handler (second occurrence, the action-execution branch) not found');

      const hasSelfOverrideIdx = src.indexOf('const hasSelfOverride = Boolean(', handlerIdx);
      expectTruthy(hasSelfOverrideIdx !== -1, 'B9n fix: hasSelfOverride guard not found in SET_ACTION_RULE handler');

      const guardLineIdx = src.indexOf('if (!hasSelfOverride && toName && !actionConfig.to_phone && !actionConfig.to_email)', hasSelfOverrideIdx);
      expectTruthy(guardLineIdx !== -1, 'B9n fix: the recipient-resolution if-condition must check !hasSelfOverride, otherwise a contaminated to_name still gets resolved even when self_override_* is present');
    },
  },
  {
    id: 'b9n.self-override-strips-stray-to-name',
    category: 'rules',
    description: 'a stray to/to_name is deleted from action_config whenever any self_override_* field is present, so it cannot survive into the stored rule and confuse app/alerts.tsx\'s detectIsSelf display logic',
    async run() {
      const src = readFileSync(USE_ORCHESTRATOR_PATH, 'utf8');
      const stripIdx = src.indexOf('delete actionConfig.to;');
      expectTruthy(stripIdx !== -1, 'B9n fix: delete actionConfig.to not found');

      const stripBlockStart = src.lastIndexOf('if (', stripIdx);
      const stripBlock = src.slice(stripBlockStart, stripIdx + 60);
      expectTruthy(
        stripBlock.includes('actionConfig.self_override_email') && stripBlock.includes('actionConfig.self_override_whatsapp'),
        'B9n fix: the to/to_name strip must be gated on self_override_* presence (all four channel fields), not run unconditionally',
      );
      expectTruthy(
        src.slice(stripIdx, stripIdx + 200).includes('delete actionConfig.to_name;'),
        'B9n fix: both actionConfig.to AND actionConfig.to_name must be deleted, not just one',
      );
    },
  },
  {
    id: 'b9n.pre-search-excludes-message-send-actions',
    category: 'rules',
    description: 'isRetrievalQuery excludes action commands like "send WhatsApp to +X in 3 minutes say Y", matching the existing isTicketCreation/isEmailAlertCreation false-positive exclusions',
    async run() {
      const src = readFileSync(USE_ORCHESTRATOR_PATH, 'utf8');
      const isMessageSendActionIdx = src.indexOf('const isMessageSendAction =');
      expectTruthy(isMessageSendActionIdx !== -1, 'B9n fix: isMessageSendAction check not found');

      const isRetrievalQueryIdx = src.indexOf('const isRetrievalQuery =', isMessageSendActionIdx);
      expectTruthy(isRetrievalQueryIdx !== -1, 'isRetrievalQuery definition not found after isMessageSendAction');

      const isRetrievalQueryLine = src.slice(isRetrievalQueryIdx, src.indexOf(';', isRetrievalQueryIdx));
      expectTruthy(
        isRetrievalQueryLine.includes('!isMessageSendAction'),
        'B9n fix: isRetrievalQuery must exclude !isMessageSendAction, otherwise any action command containing a phone number (7+ digit run) still triggers a false pre-search',
      );

      // Sanity-check the regex actually matches the two live-reproduced phrasings.
      const regexMatch = src.slice(isMessageSendActionIdx, src.indexOf(';', isMessageSendActionIdx) + 1).match(/\/(.+)\/i\.test/);
      expectTruthy(!!regexMatch, 'could not extract the isMessageSendAction regex source for a live sanity check');
      if (regexMatch) {
        const re = new RegExp(regexMatch[1], 'i');
        expectTruthy(
          re.test('send whatsapp esage to +16179746  thee mintes say hel'),
          'B9n regex must match the live-reproduced garbled message ("send whatsapp esage to +X thee mintes say hel")',
        );
        expectTruthy(
          re.test('WhatsApp me at +16137976746 in 3 minutes say hello'),
          'B9n regex must match a clean "WhatsApp me at +X in N minutes say Y" phrasing',
        );
      }
    },
  },
];
