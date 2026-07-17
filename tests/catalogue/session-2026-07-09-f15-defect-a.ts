/**
 * Session 2026-07-09 — F15 Defect A: self-alert with an explicit literal
 * destination override ("email me at X when I arrive at Y") was silently
 * dropped, and — once the extraction gap was closed — was found to
 * misclassify as a third-party alert at fire time (losing fan-out and
 * per-channel preferences) because the fire-time dispatcher classifies
 * self vs. third-party purely by address-matching against the user's own
 * registered contact info.
 *
 * Root cause, corrected design, and live evidence:
 * docs/F15_PHASE2_CHANGE_PLAN_2026-07-09.md §1 (sixth/seventh/eighth
 * revisions), §1.7 (canonical behavioral contract this test file validates
 * against).
 *
 * Fix touches four files across two independent extraction surfaces (Layer 2
 * classifier + buildActionConfirm in naavi-chat/index.ts; the Claude+tools
 * schema/prompt in anthropic_tools.ts + get-naavi-prompt/index.ts) and two
 * independent dispatch surfaces (report-location-event for location alerts;
 * evaluate-rules for time/email/weather/contact_silence alerts) — see Phase
 * 2 §1.6's required parity matrix, partially covered here.
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a rather than silently
 * absorbed: naavi-chat/index.ts and both dispatcher functions are Deno Edge
 * Functions (report-location-event and evaluate-rules both call
 * `serve(...)`/`Deno.serve(...)` at module scope) and cannot be safely
 * imported into this Node/tsx test runner without a structural refactor
 * outside this fix's scope — the same limitation already disclosed and
 * accepted for the F15 Defect B test file. These are source-pattern
 * assertions, verifying the guard clauses and classification-ordering exist
 * with the correct shape, not live execution. The stronger, live-data
 * confirmation for the location case was done manually this session (Phase
 * 2 §1.3.1, §8) — the non-location (`evaluate-rules`) half of the parity
 * matrix has NOT been independently live-tested (Phase 2 §1.5 flags this
 * explicitly) and remains an open item before Phase 8 merge.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const NAAVI_CHAT_PATH            = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');
const ANTHROPIC_TOOLS_PATH       = join(process.cwd(), 'supabase', 'functions', '_shared', 'anthropic_tools.ts');
const GET_NAAVI_PROMPT_PATH      = join(process.cwd(), 'supabase', 'functions', 'get-naavi-prompt', 'index.ts');
const REPORT_LOCATION_EVENT_PATH = join(process.cwd(), 'supabase', 'functions', 'report-location-event', 'index.ts');
const EVALUATE_RULES_PATH        = join(process.cwd(), 'supabase', 'functions', 'evaluate-rules', 'index.ts');

export const session2026_07_09_f15DefectATests: TestCase[] = [
  {
    id: 'f15a.layer2-classifier-extracts-self-override-fields',
    category: 'rules',
    description: 'naavi-chat Layer 2 classifier prompt documents self_override_email/self_override_phone extraction for location alerts, distinct from the third-party to_name field',
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      for (const field of ['self_override_email', 'self_override_sms', 'self_override_whatsapp', 'self_override_voice']) {
        expectTruthy(src.includes(field), `classifier prompt must mention ${field}`);
      }
      expectTruthy(
        src.includes('self_override_email:"jane@example.com"') || src.includes('self_override_email:"[address]"'),
        'classifier prompt must include a worked example producing self_override_email',
      );
      expectTruthy(
        src.includes('self_override_sms:"+16135551234"'),
        'classifier prompt must include a worked example producing self_override_sms (not a shared self_override_phone)',
      );
    },
  },
  {
    id: 'f15a.location-branch-forwards-self-override-into-action-config',
    category: 'rules',
    description: "buildActionConfirm's location branch reads all four params.self_override_* fields into action_config, guarded per-field and kept separate from the third-party `to` forwarding — one override per channel, not a shared phone field",
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      const locBranchStart = src.indexOf("if (tt === 'location') {");
      const locBranchEnd = src.indexOf('\n      }', locBranchStart);
      const locBranch = src.slice(locBranchStart, locBranchEnd);

      expectTruthy(
        locBranch.includes("['self_override_email', 'self_override_sms', 'self_override_whatsapp', 'self_override_voice']"),
        'location branch must forward all four independent self_override_* fields, not a shared self_override_phone',
      );
      expectTruthy(
        /if\s*\(\s*_val\s*&&\s*!baseActionConfig\[_selfField\]\s*\)/.test(locBranch),
        'each self_override_* assignment must be guarded (additive only, never unconditional)',
      );
    },
  },
  {
    id: 'f15a.report-location-event-checks-self-override-before-address-matching',
    category: 'rules',
    description: 'report-location-event treats any of the four self-override fields as unconditionally self, checked before address-matching, and substitutes only its own channel — SMS override must not also redirect WhatsApp/voice',
    async run() {
      const src = readFileSync(REPORT_LOCATION_EVENT_PATH, 'utf8');
      for (const field of ['selfOverrideEmail', 'selfOverrideSms', 'selfOverrideWhatsapp', 'selfOverrideVoice']) {
        expectTruthy(src.includes(field), `must read ${field} from action_config`);
      }
      expectTruthy(src.includes('hasSelfOverride'), 'must compute a hasSelfOverride flag');

      const isSelfAlertIdx = src.indexOf('const isSelfAlert = Boolean(hasSelfOverride');
      expectTruthy(isSelfAlertIdx >= 0, 'isSelfAlert must be computed with hasSelfOverride as the first (short-circuiting) condition');

      // Channel-scoped substitution: each override replaces only its own
      // channel's target — no shared "phone" variable spanning SMS/WhatsApp/voice.
      expectTruthy(
        src.includes('const selfSmsTarget      = selfOverrideSms      || userPhone') &&
        src.includes('const selfWhatsappTarget = selfOverrideWhatsapp || userPhone') &&
        src.includes('const selfVoiceTarget    = selfOverrideVoice    || userPhone'),
        'SMS, WhatsApp, and voice must each resolve their own independent target — a shared selfPhoneTarget would silently couple them',
      );
    },
  },
  {
    id: 'f15a.evaluate-rules-checks-self-override-before-address-matching',
    category: 'rules',
    description: 'evaluate-rules mirrors the same per-channel self-override classification and substitution as report-location-event, for non-location trigger types',
    async run() {
      const src = readFileSync(EVALUATE_RULES_PATH, 'utf8');
      for (const field of ['selfOverrideEmail', 'selfOverrideSms', 'selfOverrideWhatsapp', 'selfOverrideVoice']) {
        expectTruthy(src.includes(field), `must read ${field} from action_config`);
      }
      expectTruthy(src.includes('hasSelfOverride'), 'must compute a hasSelfOverride flag');
      expectTruthy(
        src.includes('const isSelfAlert   = Boolean(hasSelfOverride'),
        'isSelfAlert must be computed with hasSelfOverride as the first (short-circuiting) condition',
      );
      expectTruthy(
        src.includes('const selfSmsTarget      = selfOverrideSms      || userPhone') &&
        src.includes('const selfWhatsappTarget = selfOverrideWhatsapp || userPhone') &&
        src.includes('const selfVoiceTarget    = selfOverrideVoice    || userPhone'),
        'SMS, WhatsApp, and voice must each resolve their own independent target, preserving channelEnabled() gating per channel',
      );
      // Regression guard: the existing per-channel preference checks
      // (F2g Phase 1) must still gate the substituted targets, not bypass them.
      expectTruthy(
        src.includes("channelEnabled('sms'))           sends.push(callSMS('sms', selfSmsTarget))"),
        'channel preference gating must still apply to the substituted SMS target, not be bypassed by the override',
      );
    },
  },
  {
    id: 'f15a.action-config-schema-has-self-override-fields',
    category: 'rules',
    description: 'the Claude+tools ACTION_CONFIG schema declares all four self_override_* fields as legal, independent fields (not a shared self_override_phone), for the compound/multi-action path that does not route through Layer 2',
    async run() {
      const src = readFileSync(ANTHROPIC_TOOLS_PATH, 'utf8');
      const configStart = src.indexOf('const ACTION_CONFIG = {');
      const configEnd = src.indexOf('\n};', configStart);
      const configBlock = src.slice(configStart, configEnd);
      for (const field of ['self_override_email', 'self_override_sms', 'self_override_whatsapp', 'self_override_voice']) {
        expectTruthy(configBlock.includes(field), `ACTION_CONFIG schema must declare ${field}`);
      }
      expectTruthy(
        !configBlock.includes('self_override_phone'),
        'ACTION_CONFIG schema must NOT retain the retired shared self_override_phone field',
      );
    },
  },
  {
    id: 'f15a.shared-prompt-carves-self-override-exception',
    category: 'rules',
    description: 'get-naavi-prompt (the shared Claude+tools prompt) documents the four independent self-override fields distinctly from the plain self-alert rule and the third-party rule',
    async run() {
      const src = readFileSync(GET_NAAVI_PROMPT_PATH, 'utf8');
      for (const field of ['self_override_email', 'self_override_sms', 'self_override_whatsapp', 'self_override_voice']) {
        expectTruthy(src.includes(field), `prompt must instruct setting ${field} for its matching channel's explicit self-destination override`);
      }
      expectTruthy(
        src.includes('matching the channel word used'),
        'prompt must explicitly tie each self_override_* field to the specific channel word the user said, not apply broadly',
      );
    },
  },
  {
    id: 'f15a.draft-message-rule-excludes-self-addressed-requests',
    category: 'rules',
    description: 'RULE 1 (draft_message trigger) explicitly excludes "email/text me at X" before its general pattern-match, fixing a live-confirmed misclassification where Claude chose draft_message (immediate third-party send) instead of set_action_rule (self-alert with override) for this exact phrasing',
    async run() {
      const src = readFileSync(GET_NAAVI_PROMPT_PATH, 'utf8');
      const rule1Idx = src.indexOf('RULE 1 — EMAIL / MESSAGE / WHATSAPP:');
      expectTruthy(rule1Idx >= 0, 'RULE 1 must exist');
      const exclusionIdx = src.indexOf('EXCLUSION, CHECK THIS FIRST', rule1Idx);
      expectTruthy(exclusionIdx >= 0, 'the self-addressed exclusion must exist inside/immediately after RULE 1');
      const draftTriggerIdx = src.indexOf('you MUST call the draft_message tool', rule1Idx);
      expectTruthy(
        exclusionIdx > 0 && draftTriggerIdx > 0 && exclusionIdx < draftTriggerIdx,
        'the exclusion must appear BEFORE the general draft_message trigger sentence, so it is checked first, not as an afterthought the model may not reach',
      );
      expectTruthy(
        src.includes('sending something to a person OTHER than themselves'),
        'the general draft_message trigger condition itself must be narrowed to exclude the user, not rely solely on a separate carve-out paragraph',
      );
    },
  },
];
