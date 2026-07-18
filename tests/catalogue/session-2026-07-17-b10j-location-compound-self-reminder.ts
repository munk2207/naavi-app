/**
 * Session 2026-07-17 — B10j: a natural, compound location-alert request
 * ("remind me to X when I arrive at Y AND text/email Z W") silently drops
 * the user's own reminder — the third party becomes the alert's sole
 * primary recipient and the user's reminder text is merged into the third
 * party's message instead, with no task_actions ever created.
 *
 * docs/B10J_PHASE1_PROBLEM_DEFINITION_2026-07-17.md (root cause: naavi-chat's
 * Layer 2 classifier force-routes ALL location phrasing through a single-
 * action path, unlike the identical time-trigger shape which correctly
 * diverts to chat/Path B) → docs/B10J_PHASE2_CHANGE_PLAN_2026-07-17.md (fix:
 * narrow the classifier exception + add a location-specific self-alert-
 * primary rule to get-naavi-prompt, mirroring the time-trigger one) →
 * docs/B10J_PHASE3_TECHNICAL_REVIEW_2026-07-17.md (final wording, empirically
 * validated against 15 real single-action phrasings before implementation;
 * found live classifier calls are not perfectly reproducible call-to-call,
 * so positive controls must run multiple trials, not once).
 *
 * These are live-classifier tests (real naavi-chat calls), matching the
 * established pattern in tests/catalogue/prompt-regression.ts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapters } from '../lib/adapters';
import {
  expect2xx,
  expectTruthy,
  findActionInRawText,
  chatWithConfirm,
} from '../lib/assertions';
import type { TestCase } from '../lib/types';

const ALERTS_SCREEN_PATH = join(process.cwd(), 'app', 'alerts.tsx');
const ORCHESTRATOR_PATH = join(process.cwd(), 'hooks', 'useOrchestrator.ts');

// True only when the alert stayed self-primary (no third-party to/to_name/
// to_phone/to_email on the primary action_config) AND the third party's
// send landed in task_actions — the shape B10j's fix requires.
function isSelfPrimaryWithTaskActions(action: any): boolean {
  if (!action || action.trigger_type !== 'location') return false;
  const cfg = action.action_config ?? {};
  const hasThirdPartyPrimary = Boolean(cfg.to || cfg.to_name || cfg.to_phone || cfg.to_email);
  const hasTaskActions = Array.isArray(cfg.task_actions) && cfg.task_actions.length > 0;
  return !hasThirdPartyPrimary && hasTaskActions;
}

// Runs a compound phrasing through the 2-turn confirm flow 3 times (per
// Phase 3's non-determinism finding — a single call is not sufficient
// evidence) and requires a majority (>=2/3) to produce the correct shape.
async function expectMajoritySelfPrimary(ctx: any, phrase: string, testLabel: string): Promise<void> {
  const outcomes: boolean[] = [];
  for (let i = 1; i <= 3; i++) {
    const { turn2 } = await chatWithConfirm(ctx, phrase, 'yes');
    expect2xx(turn2.status, `${testLabel} trial ${i}`);
    const action = findActionInRawText(turn2.data?.rawText ?? '', 'SET_ACTION_RULE');
    const ok = isSelfPrimaryWithTaskActions(action);
    outcomes.push(ok);
    ctx.log(`${testLabel} trial ${i}: ${ok ? 'PASS (self-primary + task_actions)' : 'FAIL'} — action=${JSON.stringify(action)}`);
  }
  const passCount = outcomes.filter(Boolean).length;
  expectTruthy(
    passCount >= 2,
    `${testLabel}: expected majority (>=2/3) trials to produce self-primary + task_actions, got ${passCount}/3 — distribution: ${outcomes.join(',')}`,
  );
}

const NEGATIVE_CONTROLS: Array<{ id: string; phrase: string }> = [
  { id: 'costco-self', phrase: 'Alert me when I arrive at Costco' },
  { id: 'text-bob-50-elm', phrase: 'Text Bob when I arrive at 50 Elm Street' },
  { id: 'email-bob-50-elm', phrase: 'Email Bob when I arrive at 50 Elm Street' },
  { id: 'text-self-override-50-elm', phrase: 'Text me at +16135551234 when I arrive at 50 Elm Street' },
  { id: 'call-self-override-50-elm', phrase: 'Call me at +16135551234 when I arrive at 50 Elm Street' },
  { id: 'remind-bob-kid-sam', phrase: "Remind me with Bob's kid Sam when I arrive at Bob's home" },
  { id: 'alert-office', phrase: 'Alert me when I arrive at the office' },
  { id: 'text-sarah-leave-home', phrase: 'Text Sarah when I leave home' },
  { id: 'notify-shoppers', phrase: 'Notify me when I arrive at Shoppers Drug Mart' },
  { id: 'let-me-know-gym', phrase: 'Let me know when I get to the gym' },
  { id: 'text-wife-work', phrase: 'Text my wife when I arrive at work' },
  { id: 'alert-leave-office', phrase: 'Alert me when I leave the office' },
  { id: 'email-sarah-work', phrase: 'Email Sarah when I reach work' },
  { id: 'text-bob-home', phrase: 'Text Bob when I arrive home' },
  { id: 'whatsapp-costco', phrase: 'WhatsApp me when I arrive at Costco' },
];

export const session2026_07_17_b10jLocationCompoundSelfReminderTests: TestCase[] = [
  ...NEGATIVE_CONTROLS.map((c): TestCase => ({
    id: `b10j.negative-control-${c.id}`,
    category: 'prompt-regression',
    description: `Regression guard — "${c.phrase}" is a genuine single-action location alert (no separate self-reminder component) and must stay classified as a single action, unaffected by B10j's classifier change`,
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: c.phrase }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const action = findActionInRawText(data?.rawText ?? '', 'SET_ACTION_RULE');
      expectTruthy(action, `"${c.phrase}" must still emit an immediate SET_ACTION_RULE action, not be routed to chat`);
      expectTruthy(action?.trigger_type === 'location', `"${c.phrase}" action must have trigger_type='location', got '${action?.trigger_type}'`);
    },
  })),
  {
    id: 'b10j.positive-control-remind-lock-door-and-sms-bob',
    category: 'prompt-regression',
    description: 'The exact phrase reproduced live in Phase 1 ("Remind me when I arrive home to lock the door AND send SMS to Bob") must now produce a self-primary alert with task_actions for Bob, not Bob-as-primary. Run 3x per Phase 3\'s non-determinism finding — majority must pass.',
    timeoutMs: 60_000,
    async run(ctx) {
      await expectMajoritySelfPrimary(ctx, 'Remind me when I arrive home to lock the door AND send SMS to Bob', 'positive-control-1');
    },
  },
  {
    id: 'b10j.positive-control-natural-phrasing-lock-door-sms-bob',
    category: 'prompt-regression',
    description: 'The second Phase 1 reproduction phrasing ("When I arrive home remind me to lock the door and send sms to bob saying i\'m home") must also now produce a self-primary alert with task_actions for Bob. Run 3x per Phase 3\'s non-determinism finding.',
    timeoutMs: 60_000,
    async run(ctx) {
      await expectMajoritySelfPrimary(ctx, "When I arrive home remind me to lock the door and send sms to bob saying i'm home", 'positive-control-2');
    },
  },
  {
    id: 'b10j.alerts-screen-recognizes-send-sms-task-actions',
    category: 'rules',
    description:
      'Found live during B10j manual testing: app/alerts.tsx\'s "Also notifies" section filtered task_actions for type==="sms", but every task_actions entry ever produced by naavi-chat/get-naavi-prompt uses type="send_sms" — the filter never matched anything, making the section permanently dead code regardless of B10j. Fixed to match the real value. Bob\'s alert still fires correctly either way (this is display-only); the bug was that the Alerts screen never showed he was being notified.',
    async run() {
      const src = readFileSync(ALERTS_SCREEN_PATH, 'utf8');
      expectTruthy(
        src.includes("ta?.type === 'send_sms' && ta?.to_name"),
        'the "Also notifies" filter must match the real task_actions type value (send_sms), not the never-produced "sms"',
      );
      expectTruthy(
        !src.includes("ta?.type === 'sms' && ta?.to_name"),
        'the old, always-false filter condition must not remain alongside the fix',
      );
    },
  },
  {
    id: 'b10j.readback-names-task-actions-recipient-pending-commit-path',
    category: 'rules',
    description:
      'Rule 12 follow-on gap, found live during manual trials 1-2: the B10h readback fix only checked top-level to_name/to, so a self-primary alert whose third party lives in task_actions got a bare "Alert set" with no mention of Bob at all, even though he was correctly notified underneath. Fixed to also name task_actions recipients when no top-level recipient exists.',
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      const commitBlockIdx = src.indexOf("if (isYes && pending.resolved) {");
      const taskActionsVarIdx = src.indexOf('const speechTaskActions = Array.isArray(speechActionConfig.task_actions)', commitBlockIdx);
      expectTruthy(commitBlockIdx > -1, 'the pendingLocationRef "yes" commit block must exist');
      expectTruthy(taskActionsVarIdx > commitBlockIdx, 'the commit path must read task_actions for the readback fallback');
      expectTruthy(
        src.includes('return taBody ? ` ${taName} will get "${taBody}".` : ` ${taName} will be notified.`;'),
        'the task_actions readback fallback must name the recipient and their message, matching the existing to_name/to phrasing',
      );
    },
  },
  {
    id: 'b10j.readback-names-task-actions-recipient-memory-hit-path',
    category: 'rules',
    description: 'same Rule 12 follow-on fix applied to the second, independent memory-hit insert path.',
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      const memoryHitTaskActionsIdx = src.indexOf('const memoryHitTaskActions = Array.isArray((actionConfig as any).task_actions)');
      expectTruthy(memoryHitTaskActionsIdx > -1, 'the memory-hit path must read task_actions for the readback fallback');
    },
  },
  {
    id: 'b10j.novel-compound-phrasing-not-in-validation-corpus',
    category: 'prompt-regression',
    description: 'Phase 3 §4 required a compound phrasing NOT used during wording validation, to guard against overfitting to the exact tested examples.',
    timeoutMs: 60_000,
    async run(ctx) {
      await expectMajoritySelfPrimary(
        ctx,
        'Remind me to take my pills when I get to the office and text my daughter I made it in',
        'novel-compound',
      );
    },
  },
];
