/**
 * Session 2026-07-21 — B10q: an email-trigger alert with no from_name/
 * from_email/subject_keyword matched every incoming email instead of none,
 * on two independent implementations (mobile/Shared-Core's manage-rules and
 * voice's SET_EMAIL_ALERT), confirmed via the Architecture Scope Rule
 * (Phase 1A) that the "Action Rules — creation" capability is documented as
 * Duplicated, two independent implementations.
 *
 * docs/B10Q_PHASE1_PROBLEM_DEFINITION_2026-07-21.md (root cause, both
 * implementations) → docs/B10Q_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-07-21.md
 * (found voice's independent instance) → docs/B10Q_PHASE2_CHANGE_PLAN_2026-07-21.md
 * (fix: matching validation on both surfaces, per ADR 0001's accepted
 * duplication pattern) → docs/B10Q_PHASE3_TECHNICAL_REVIEW_2026-07-21.md
 * (implementation boundaries, resolved the multi-action-queue wording).
 *
 * manage-rules tests are live (real Edge Function calls, requires the fix
 * deployed to the target environment). naavi-chat and voice-server tests are
 * source-level (string checks against the actual shipped code) — voice's
 * classifier routing (Layer 2 vs Path B) is not reliably forceable via a
 * live prompt for this specific gap, matching the established pattern for
 * this kind of structural check (see session-2026-07-17-b10j's
 * alerts-screen/readback tests for precedent).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapters, db } from '../lib/adapters';
import { expectTruthy, expectEqual } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const NAAVI_CHAT_PATH = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');
const VOICE_SERVER_PATH = join(process.cwd(), 'naavi-voice-server', 'src', 'index.js');

export const session2026_07_21_b10qEmailAlertValidationTests: TestCase[] = [
  {
    id: 'b10q.manage-rules-rejects-unscoped-email-alert',
    category: 'rules',
    description: 'manage-rules op:create with trigger_type=email and empty trigger_config must be rejected with error=email_alert_unscoped, not written to the database.',
    async run(ctx) {
      const { status, data } = await adapters.call(ctx, 'manage-rules', {
        op: 'create',
        user_id: ctx.testUserId,
        trigger_type: 'email',
        trigger_config: {},
        action_type: 'sms',
        action_config: {},
        label: 'b10q test — should be rejected',
        one_shot: true,
      }, { asService: true });
      expectEqual(status, 400, 'manage-rules should reject an unscoped email alert with 400');
      expectEqual(data?.error, 'email_alert_unscoped', 'error code must be email_alert_unscoped');
      // Confirm nothing was actually written.
      const rows = await db.select(ctx, 'action_rules', `user_id=eq.${ctx.testUserId}&label=eq.${encodeURIComponent('b10q test — should be rejected')}`);
      expectEqual(Array.isArray(rows) ? rows.length : -1, 0, 'no row should exist for the rejected unscoped request');
    },
  },
  {
    id: 'b10q.manage-rules-still-creates-scoped-email-alert',
    category: 'rules',
    description: 'Negative control — an email alert WITH a from_name must still create successfully, proving the fix does not over-block legitimate requests.',
    async run(ctx) {
      const { status, data } = await adapters.call(ctx, 'manage-rules', {
        op: 'create',
        user_id: ctx.testUserId,
        trigger_type: 'email',
        trigger_config: { from_name: 'B10q Test Sender' },
        action_type: 'sms',
        action_config: {},
        label: 'b10q test — should succeed',
        one_shot: true,
      }, { asService: true });
      expectTruthy(status >= 200 && status < 300, `manage-rules should accept a scoped email alert, got status ${status} body=${JSON.stringify(data)}`);
      expectTruthy(!data?.error, `no error expected for a scoped request, got ${data?.error}`);
    },
    async teardown(ctx) {
      // Clean up the row this test creates.
      await db.delete(ctx, 'action_rules', `user_id=eq.${ctx.testUserId}&label=eq.${encodeURIComponent('b10q test — should succeed')}`);
    },
  },
  {
    id: 'b10q.naavi-chat-commit-handler-speaks-decline-wording',
    category: 'rules',
    description: 'The pending-confirmation commit handler must recognize email_alert_unscoped and speak the agreed decline wording, not the generic "I had trouble saving that alert" fallback.',
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes(`insErr === 'email_alert_unscoped'`),
        'commit handler must check for the specific email_alert_unscoped error before falling back to the generic message',
      );
      expectTruthy(
        src.includes(`I can't set an alert for every email — that's what your email app is already for. Who should it be from, or what should it be about?`),
        'commit handler must speak the exact agreed decline wording',
      );
    },
  },
  {
    id: 'b10q.naavi-chat-classifier-wording-matches-agreed-phrasing',
    category: 'rules',
    description: 'Layer-2-classifier missingParam text at the email trigger_type check must match the same agreed decline+clarify wording as the commit-handler path, so the user gets the identical sentence regardless of which stage blocks the request.',
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      const idx = src.indexOf(`if (!params.from && !params.subject_keyword)`);
      expectTruthy(idx > -1, 'the classifier email-filter check must still exist');
      const nearby = src.slice(idx, idx + 400);
      expectTruthy(
        nearby.includes(`I can't set an alert for every email`),
        'classifier missingParam text must use the same agreed wording, not the old bare clarifying question',
      );
    },
  },
  {
    id: 'b10q.voice-set-email-alert-rejects-unscoped',
    category: 'rules',
    description: 'Voice\'s independent SET_EMAIL_ALERT implementation must reject an empty-filter request with the same error code, before ever reaching the raw action_rules insert.',
    async run() {
      const src = readFileSync(VOICE_SERVER_PATH, 'utf8');
      const caseIdx = src.indexOf(`case 'SET_EMAIL_ALERT':`);
      expectTruthy(caseIdx > -1, 'SET_EMAIL_ALERT case must still exist');
      const rejectIdx = src.indexOf(`error: 'email_alert_unscoped'`, caseIdx);
      const insertIdx = src.indexOf(`trigger_type:   'email'`, caseIdx);
      expectTruthy(rejectIdx > caseIdx, 'validation rejecting an unscoped request must exist inside the SET_EMAIL_ALERT case');
      expectTruthy(insertIdx > rejectIdx, 'the validation must run BEFORE the insert, not after');
    },
  },
  {
    id: 'b10q.voice-primary-path-awaits-set-email-alert',
    category: 'rules',
    description: 'Voice\'s primary single-action dispatcher must await SET_EMAIL_ALERT and speak the decline wording on rejection, rather than falling into the fire-and-forget backgroundActions bucket (which runs after speech is already dispatched to Twilio).',
    async run() {
      const src = readFileSync(VOICE_SERVER_PATH, 'utf8');
      const branchIdx = src.indexOf(`action.type === 'SET_EMAIL_ALERT'`);
      expectTruthy(branchIdx > -1, 'an explicit SET_EMAIL_ALERT branch must exist in the primary dispatcher');
      const nearby = src.slice(branchIdx, branchIdx + 900);
      expectTruthy(nearby.includes('await executeAction(action, userId)'), 'the branch must await execution, not defer it');
      expectTruthy(
        nearby.includes(`I can't set an alert for every email`),
        'the branch must speak the agreed decline wording on email_alert_unscoped',
      );
    },
  },
  {
    id: 'b10q.voice-multi-action-queue-specific-decline',
    category: 'rules',
    description: 'Voice\'s multi-action queue must give the specific terse decline for email_alert_unscoped, not the generic "That one failed — I\'ll move on" — resolved deferred decision from Phase 3.',
    async run() {
      const src = readFileSync(VOICE_SERVER_PATH, 'utf8');
      const idx = src.indexOf(`result?.error === 'email_alert_unscoped'`);
      expectTruthy(idx > -1, 'multi-action queue must special-case email_alert_unscoped');
      const nearby = src.slice(idx, idx + 400);
      expectTruthy(
        nearby.includes(`Couldn't set that email alert — needs a sender or subject.`),
        'multi-action queue must use the agreed terse decline wording',
      );
    },
  },
];
