/**
 * Session 2026-07-10 — B9i fix: self-override time-trigger alerts ("WhatsApp/
 * text/email/call me at X in 3 minutes", no named third party) used to fall
 * through to raw Claude reasoning with no PENDING_INTENT marker embedded, so
 * the "yes" confirmation turn had nothing for Step 1.4 to deterministically
 * execute and the rule was silently never created — reproduced live 4+ times
 * (2026-07-10 05:30-05:55 AM EST), root-caused via client_diagnostics +
 * staging action_rules queries, holding list item B9i.
 *
 * Fix: naavi-chat/index.ts's time-trigger __FALLTHROUGH__ handler now detects
 * self_override_email/sms/whatsapp/voice before falling into the no-to_name
 * self-reminder branch, and — when present — builds the confirm speech and
 * embeds a PENDING_INTENT marker synchronously (no contact lookup needed,
 * the destination is already literal), so Step 1.4 can execute it on Turn 2.
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a: naavi-chat/index.ts is a
 * Deno Edge Function (calls Deno.serve(...) at module scope) and cannot be
 * safely imported into this Node/tsx test runner — same disclosed limitation
 * as the rest of the F15/F12 test catalogue (see
 * tests/catalogue/session-2026-07-06-f12-high-risk-wiring.ts). These are
 * source-pattern assertions verifying the new branch exists, is positioned
 * ahead of the self-reminder fallthrough it used to fall into, and embeds a
 * marker rather than silently falling through unmarked. They do not execute
 * the real function or hit the live staging endpoint. Live verification
 * (retest of the F15 test 2/3 scenarios against the deployed staging fix) is
 * a separate, manual step — see holding list item B9i for the plan.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const NAAVI_CHAT_PATH = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');

export const session2026_07_10_b9iSelfOverrideTimeTests: TestCase[] = [
  {
    id: 'b9i.time-fallthrough-detects-self-override-before-self-reminder-branch',
    category: 'rules',
    description: 'the time-trigger __FALLTHROUGH__ handler checks for self_override_* fields and handles them before falling into the no-to_name self-reminder branch that used to swallow them',
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');

      const ftBlockStart = src.indexOf("if (_ftTrigger === 'time' && userId) {");
      expectTruthy(ftBlockStart !== -1, 'time-trigger __FALLTHROUGH__ handler not found in naavi-chat');

      const selfOverrideLoopIdx = src.indexOf(
        "for (const _sf of ['self_override_email', 'self_override_sms', 'self_override_whatsapp', 'self_override_voice'])",
        ftBlockStart,
      );
      expectTruthy(selfOverrideLoopIdx !== -1, 'B9i fix: self_override_* detection loop not found in time-trigger fallthrough handler');

      const selfReminderBranchIdx = src.indexOf(
        "// Self-reminder (\"remind me to X\") — no recipient needed.",
        ftBlockStart,
      );
      expectTruthy(selfReminderBranchIdx !== -1, 'self-reminder fallthrough branch not found (unexpected — did the surrounding code change shape?)');

      expectTruthy(
        selfOverrideLoopIdx < selfReminderBranchIdx,
        'B9i fix: self-override detection must run BEFORE the no-to_name self-reminder branch, otherwise self-override requests (to_name empty) still fall into the unmarked Claude fallthrough that caused B9i',
      );
    },
  },
  {
    id: 'b9i.self-override-branch-embeds-pending-intent-marker-not-raw-fallthrough',
    category: 'rules',
    description: 'the self-override time-trigger branch returns synchronously with a PENDING_INTENT marker (for Step 1.4 to execute on "yes"), instead of setting pathB and falling through to Claude unmarked',
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');

      const loopIdx = src.indexOf(
        "for (const _sf of ['self_override_email', 'self_override_sms', 'self_override_whatsapp', 'self_override_voice'])",
      );
      expectTruthy(loopIdx !== -1, 'B9i self_override detection loop not found');

      const branchStart = src.indexOf('if (!_ftToName && _ftHasSelfOverride) {', loopIdx);
      expectTruthy(branchStart !== -1, 'B9i self-override branch (if (!_ftToName && _ftHasSelfOverride)) not found');

      const branchEnd = src.indexOf('\n                }', branchStart);
      const branch = src.slice(branchStart, branchEnd);

      expectTruthy(
        branch.includes('<!--PENDING_INTENT:'),
        'B9i self-override branch must embed a PENDING_INTENT marker so Step 1.4 can execute the alert on the "yes" turn — this is the exact gap that caused the silent creation failure',
      );
      expectTruthy(
        branch.includes("intent: 'SET_ACTION_RULE'"),
        'B9i self-override branch marker must declare intent: SET_ACTION_RULE so Step 1.4 (naavi-chat/index.ts:2235) routes it to the correct handler',
      );
      expectTruthy(
        branch.includes('action_config: { body: _ftBody, ..._ftSelfOverrides }'),
        'B9i self-override branch must forward the self_override_* fields into action_config — Step 1.4 passes action_config through untouched when to_name/to_email are empty, so this is what actually reaches manage-rules',
      );
      expectTruthy(
        !branch.includes('lookup-contact'),
        'B9i self-override branch must NOT call lookup-contact — the destination is already a literal address/number, unlike the third-party branch below it',
      );
    },
  },
];
