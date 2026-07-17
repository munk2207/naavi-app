/**
 * Session 2026-07-17 — B10h: location-triggered "text NAME MESSAGE" alerts
 * (bare phrasing, no self-reminder, no "saying") silently dropped the
 * message content — the alert fired and sent a real third party the
 * generic fallback ("You've arrived at [place].") instead of what the user
 * actually asked to be sent, with no warning anywhere.
 *
 * docs/B10H_PHASE1_PROBLEM_DEFINITION_2026-07-17.md (root cause, 2
 * independent reproductions) → docs/B10H_PHASE2_CHANGE_PLAN_2026-07-17.md
 * (fail-closed guard at write-time + fire-time, defense-in-depth) →
 * docs/B10H_PHASE3_TECHNICAL_REVIEW_2026-07-17.md (implementation
 * boundaries; resolved both required conditions — no new shared validator
 * needed, conversational state via a "retry through Claude" mechanism
 * rather than a Claude-skipping resume).
 *
 * These are source-assertion tests confirming the fix is shaped correctly.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const ORCHESTRATOR_PATH = join(process.cwd(), 'hooks', 'useOrchestrator.ts');
const REPORT_LOCATION_EVENT_PATH = join(process.cwd(), 'supabase', 'functions', 'report-location-event', 'index.ts');
const EVALUATE_RULES_PATH = join(process.cwd(), 'supabase', 'functions', 'evaluate-rules', 'index.ts');

export const session2026_07_17_b10hLocationContentGuardTests: TestCase[] = [
  {
    id: 'b10h.write-time-guard-blocks-third-party-with-no-content',
    category: 'rules',
    description: 'Layer 2/3 — a resolved third-party recipient with no body/tasks/list_name blocks before any address-resolution work starts, asking the user what to say instead of saving an empty alert',
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      const guardIdx = src.indexOf('const hasThirdPartyRecipient = Boolean(actionConfig.to_phone || actionConfig.to_email);');
      const placeNameCheckIdx = src.indexOf("if (!placeName) {");
      const resolvePlaceIdx = src.indexOf('resolve-place', guardIdx);
      expectTruthy(guardIdx > -1, 'B10h content guard must exist in the location branch');
      expectTruthy(placeNameCheckIdx > -1 && placeNameCheckIdx < guardIdx, 'the content guard must run after the existing empty-placeName check');
      expectTruthy(resolvePlaceIdx > -1 && guardIdx < resolvePlaceIdx, 'the content guard must run before any resolve-place call — a blocked alert should cost nothing');
      expectTruthy(
        src.includes('turnSpeechOverride = `What should I tell ${clarifyToName}?`;'),
        'a blocked alert must ask the user what to say, not fail silently',
      );
    },
  },
  {
    id: 'b10h.write-time-guard-checks-same-three-fields-as-buildAlertBody',
    category: 'rules',
    description: 'the write-time guard checks exactly the three action_config fields buildAlertBody reads at write time (body, tasks, list_name) — the fourth source (list_connections) cannot exist pre-insert, so it is correctly excluded here',
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(src.includes("String(actionConfig.body ?? '').trim()"), 'guard must check body');
      expectTruthy(src.includes('Array.isArray(actionConfig.tasks) && actionConfig.tasks.length > 0'), 'guard must check tasks');
      expectTruthy(src.includes("String(actionConfig.list_name ?? '').trim()"), 'guard must check list_name');
    },
  },
  {
    id: 'b10h.pending-content-clarification-ref-exists-and-is-checked-early',
    category: 'rules',
    description: 'a dedicated pending-state ref (not reusing pendingLocationRef) stores the clarification context and is checked at the top of send(), mirroring the proven pendingLocationRef pattern',
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      const refDeclIdx = src.indexOf('const pendingContentClarificationRef = useRef<{');
      const refCheckIdx = src.indexOf('if (pendingContentClarificationRef.current) {');
      const pendingLocationCheckIdx = src.indexOf('if (pendingLocationRef.current && supabase) {');
      expectTruthy(refDeclIdx > -1, 'pendingContentClarificationRef must be declared, separate from pendingLocationRef');
      expectTruthy(refCheckIdx > -1, 'pendingContentClarificationRef must be checked in send()');
      expectTruthy(
        pendingLocationCheckIdx > -1 && refCheckIdx < pendingLocationCheckIdx,
        'the content-clarification check must run before (or independently of) the pendingLocationRef check, at the top of send()',
      );
    },
  },
  {
    id: 'b10h.clarification-reply-retries-through-claude-not-mid-flow-resume',
    category: 'rules',
    description: 'answering the clarification question rebuilds a complete sentence and retries through the normal Claude pipeline (via sendRef) rather than attempting a Claude-skipping resume — the corrected design from Phase 3, avoiding duplicating ~400 lines of address-resolution logic',
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(
        src.includes('const correctedMessage = `Text ${pendingContent.toName} saying ${contentMsg} when I ${directionWord} ${pendingContent.placeName}`;'),
        'the resume mechanism must rebuild a complete natural-language sentence including recipient and place',
      );
      expectTruthy(
        src.includes('if (sendRef.current) sendRef.current(correctedMessage);'),
        'the corrected message must be retried through the normal send()/Claude pipeline, not a hand-rolled mid-flow resume',
      );
    },
  },
  {
    id: 'b10h.fire-time-guard-separates-real-content-from-self-alert-fallback',
    category: 'rules',
    description: 'Layer 4 (report-location-event) — rawBody (before fallback) gates third-party sends; self-alert channels are unaffected and still use the fallback exactly as before',
    async run() {
      const src = readFileSync(REPORT_LOCATION_EVENT_PATH, 'utf8');
      const rawBodyIdx = src.indexOf('const rawBody = await buildAlertBody(config, rule.user_id, supabaseUrl, interFnKey, rule.id);');
      const fallbackIdx = src.indexOf("const body = rawBody || `You've arrived at");
      expectTruthy(rawBodyIdx > -1, 'rawBody must be captured before the fallback is applied');
      expectTruthy(fallbackIdx > rawBodyIdx, 'the fallback-applied body must be derived from rawBody, not computed independently');
      expectTruthy(
        src.includes("console.warn(`[report-location-event] B10h: SKIPPED third-party SMS/WhatsApp (no_content) rule=${rule.id} to=${toName || toPhone}`);"),
        'a skipped third-party SMS/WhatsApp send must be logged with a distinct, named reason',
      );
      expectTruthy(
        src.includes("console.warn(`[report-location-event] B10h: SKIPPED third-party email (no_content) rule=${rule.id} to=${toName || toEmail}`);"),
        'a skipped third-party email send must be logged with a distinct, named reason',
      );
    },
  },
  {
    id: 'b10h.fire-time-guard-self-alert-branch-unaffected',
    category: 'rules',
    description: 'regression guard — the self-alert send branch in report-location-event is untouched by this fix; only the third-party (toPhone/toEmail) branches gained the content check',
    async run() {
      const src = readFileSync(REPORT_LOCATION_EVENT_PATH, 'utf8');
      const selfAlertBlockIdx = src.indexOf('if (isSelfAlert) {');
      const selfAlertBlockEndIdx = src.indexOf('} else if (toPhone) {');
      expectTruthy(selfAlertBlockIdx > -1 && selfAlertBlockEndIdx > selfAlertBlockIdx, 'self-alert branch must still exist, immediately before the third-party branch');
      const selfAlertBlock = src.slice(selfAlertBlockIdx, selfAlertBlockEndIdx);
      expectTruthy(
        !selfAlertBlock.includes('rawBody') && !selfAlertBlock.includes('B10h'),
        'the self-alert branch must not reference rawBody or the B10h guard — self-alerts keep using the fallback unconditionally, exactly as before this fix',
      );
    },
  },
  {
    id: 'b10h.evaluate-rules-already-fail-closed-no-change-needed',
    category: 'rules',
    description: 'evaluate-rules already had an unconditional empty-body guard (return false before self/third-party branching) — confirmed during B10h implementation, no functional change was needed, documented rather than silently skipped',
    async run() {
      const src = readFileSync(EVALUATE_RULES_PATH, 'utf8');
      const guardIdx = src.indexOf('if (!body) {');
      const selfAlertBranchIdx = src.indexOf('if (isSelfAlert) {');
      expectTruthy(guardIdx > -1, 'the empty-body guard must still exist');
      expectTruthy(selfAlertBranchIdx > guardIdx, 'the empty-body guard must run before the self/third-party branch, blocking both unconditionally');
      expectTruthy(
        src.includes('B10h (2026-07-17) — confirmed during implementation that this existing'),
        'the finding (no change needed, already fail-closed) must be documented in the source, not silently absent',
      );
    },
  },
];
