/**
 * Session 2026-06-14 — v115/v116/v117/v118/v119 fixes
 *
 * Covers:
 * 1. Sarah disambig label fix — label set before disambig branch, refined after pick
 * 2. fmtDtLocal long format — weekday + month use 'long' not 'short'
 * 3. Path B wrapper only fires on genuine uncertainty, not direct answers
 * 4. normalizeActionSeparators lowercase — period-separated lowercase sentences both fire
 * 5. MAKE_CALL pre-Claude bypass and outbound-call Edge Function present
 * 6. v116: RULE 3 — SET_REMINDER retired; "remind me at X" → set_action_rule(trigger_type='time')
 * 7. v116: RULE 26 — time anchor extends to both actions unless user says "now/right now/immediately"
 * 8. v117: Calendar attendee names — People API contacts lookup for emails without displayName
 * 9. v117: RULE 3 — combined self-reminder + participant SMS in ONE set_action_rule with task_actions
 * 10. v118: RULE 3 — single-result search must not show disambiguation list (use directly)
 * 11. v118: RULE 3 — after multi-result disambiguation pick, call set_action_rule in same turn as confirm prompt
 * 12. v119: Past-check uses ISO timestamp comparison — fixes false "already past" for times near midnight (e.g. 1:00 AM vs 12:55 AM)
 *
 * Run via `npm run test:auto`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const INDEX_PATH   = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');
const OC_PATH      = join(process.cwd(), 'supabase', 'functions', 'outbound-call', 'index.ts');
const PROMPT_PATH  = join(process.cwd(), 'supabase', 'functions', 'get-naavi-prompt', 'index.ts');

export const session2026_06_14Tests: TestCase[] = [
  // ── 1. Sarah disambig label fix ──────────────────────────────────────────
  {
    id: 'v115.disambig-label-set-before-branch',
    description: 'v115: _ftPendingParams.label is set before the multi-contact disambig branch (not only on single-contact path)',
    tags: ['v115', 'disambig'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      // The label must appear before the "if (_ftWithPhone.length > 1)" block.
      // We verify by checking label is set with generic name AND refined after pick.
      expectTruthy(
        src.includes("_ftPendingParams.label = `Text ${_ftToName} at ${_ftDtLabel}`"),
        'label not set with generic name before disambig branch',
      );
      expectTruthy(
        src.includes("_ftPendingParams.label = `Text ${_ftBest.name} at ${_ftDtLabel}`"),
        'label not refined after contact pick',
      );
    },
  },
  {
    id: 'v115.disambig-email-label-set-before-branch',
    description: 'v115: email branch also sets label before disambig and refines after pick',
    tags: ['v115', 'disambig'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(
        src.includes("_ftEmailParams.label = `Email ${_ftToName} at ${_ftDtLabel}`"),
        'email label not set before disambig branch',
      );
      expectTruthy(
        src.includes("_ftEmailParams.label = `Email ${_ftEmailBest.name} at ${_ftDtLabel}`"),
        'email label not refined after contact pick',
      );
    },
  },

  // ── 2. fmtDtLocal long format ─────────────────────────────────────────────
  {
    id: 'v115.fmtDtLocal-long-weekday',
    description: 'v115: fmtDtLocal uses weekday: long (not short) to avoid Deepgram misreads',
    tags: ['v115', 'tts'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      // Must have long, must NOT have short for weekday
      expectTruthy(src.includes("weekday: 'long'"), "fmtDtLocal must use weekday: 'long'");
      expectTruthy(src.includes("month: 'long'"), "fmtDtLocal must use month: 'long'");
    },
  },
  {
    id: 'v115.fmtDtLocal-no-short',
    description: 'v115: fmtDtLocal does NOT use short weekday or month (regression guard)',
    tags: ['v115', 'tts'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      // Locate the fmtDtLocal function block and check it doesn't contain 'short'
      const fnStart = src.indexOf('function fmtDtLocal(');
      const fnEnd   = src.indexOf('\n}', fnStart) + 2;
      const fnSrc   = src.slice(fnStart, fnEnd);
      expectTruthy(!fnSrc.includes("'short'"), "fmtDtLocal must not use 'short' for weekday or month");
    },
  },

  // ── 3. Path B — only wrap on genuine uncertainty ──────────────────────────
  {
    id: 'v115.path-b-genuine-uncertainty-guard',
    description: 'v115: Path B wrapper only fires when Claude response contains genuine uncertainty phrases',
    tags: ['v115', 'path-b'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(
        src.includes('_genuinelyUncertain'),
        '_genuinelyUncertain guard variable missing',
      );
      expectTruthy(
        src.includes("don'?t|cannot|can'?t|am\\s+not\\s+sure"),
        'uncertainty regex must cover common hedging phrases',
      );
      expectTruthy(
        src.includes('if (_genuinelyUncertain)'),
        'Path B wrapper must be conditional on _genuinelyUncertain',
      );
    },
  },
  {
    id: 'v115.path-b-no-unconditional-wrap',
    description: 'v115: Path B does NOT unconditionally prepend "Here\'s my best reading" for every Path B response',
    tags: ['v115', 'path-b'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      // The old unconditional wrap was: speech = `Here's my best reading: ${speech}...`
      // without any guard. After fix, it's inside if (_genuinelyUncertain).
      // Verify by checking the log line for the skip case exists.
      expectTruthy(
        src.includes('Layer3 Path B skipped — Claude gave a direct answer'),
        'skip log line missing — Path B may still be unconditionally wrapping',
      );
    },
  },

  // ── 4. normalizeActionSeparators — lowercase fix ──────────────────────────
  {
    id: 'v115.normalize-action-separators-no-uppercase-lookahead',
    description: 'v115: normalizeActionSeparators actual split regex does NOT have (?=[A-Z]) lookahead (voice dictation fix)',
    tags: ['v115', 'multi-action'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      // Locate the function body and check the split() call itself.
      // Note: the comment inside the function mentions (?=[A-Z]) as the old broken
      // behavior — we only check the actual split() call line, not the whole file.
      const fnStart = src.indexOf('function normalizeActionSeparators(');
      const fnEnd   = src.indexOf('\n}', fnStart) + 2;
      const fnSrc   = src.slice(fnStart, fnEnd);
      // The active split line must NOT have the uppercase lookahead
      const splitLine = fnSrc.split('\n').find(l => l.includes('.split('));
      expectTruthy(!!splitLine, 'normalizeActionSeparators has no .split() call');
      expectTruthy(
        !splitLine!.includes('(?=[A-Z])'),
        `split() call must not have (?=[A-Z]) lookahead; got: ${splitLine}`,
      );
    },
  },
  {
    id: 'v115.normalize-action-separators-verb-check',
    description: 'v115: normalizeActionSeparators still requires 2+ action-verb sentences (avoids normalizing ordinary prose)',
    tags: ['v115', 'multi-action'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(src.includes('MULTI_ACTION_VERB_RE'), 'MULTI_ACTION_VERB_RE missing');
      expectTruthy(src.includes('actionCount < 2'), 'guard for fewer than 2 action verbs missing');
    },
  },

  // ── Calendar attendees in fetchLiveCalendarEvents ────────────────────────
  {
    id: 'v115.calendar-fetch-includes-attendees-type',
    description: 'v115: fetchLiveCalendarEvents event type includes attendees field (so Google API attendees are not stripped)',
    tags: ['v115', 'calendar'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      // Both the fetch-result type and the dedup-array type must declare attendees
      const fetchTypeCount  = (src.match(/attendees\?\s*:\s*Array<\{[^}]*self\?\s*:\s*boolean/g) ?? []).length;
      expectTruthy(fetchTypeCount >= 2, `attendees field with self?: boolean must appear in at least 2 type declarations; found ${fetchTypeCount}`);
    },
  },
  {
    id: 'v115.calendar-fetch-appends-guests-to-detail',
    description: 'v115: fetchLiveCalendarEvents appends "with [guests]" to detail string (so Claude sees attendees)',
    tags: ['v115', 'calendar'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(src.includes('guestNames'), 'guestNames extraction missing from fetchLiveCalendarEvents');
      expectTruthy(src.includes('!a.self'), 'self-filter missing — calendar owner would appear in their own guest list');
      expectTruthy(src.includes('`with ${guestNames.join'), 'guestNames not appended to detailParts');
    },
  },

  // ── 5. MAKE_CALL bypass + outbound-call EF ───────────────────────────────
  {
    id: 'v115.make-call-pre-claude-bypass',
    description: 'v115: MAKE_CALL intent has a pre-Claude regex bypass in naavi-chat',
    tags: ['v115', 'make-call'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(src.includes('MAKE_CALL_BYPASS_RE'), 'MAKE_CALL pre-Claude bypass regex missing');
      expectTruthy(src.includes("intent: 'MAKE_CALL'"), "MAKE_CALL intent string missing from bypass path");
    },
  },
  {
    id: 'v115.make-call-outbound-call-ef-exists',
    description: 'v115: outbound-call Edge Function index.ts exists',
    tags: ['v115', 'make-call'],
    run: async () => {
      const src = readFileSync(OC_PATH, 'utf8');
      expectTruthy(src.length > 100, 'outbound-call/index.ts is empty or missing');
      expectTruthy(src.includes('Deno.serve') || src.includes('serve('), 'outbound-call must be a Deno serve function');
    },
  },
  {
    id: 'v115.make-call-step14-resolver',
    description: 'v115: Step 1.4 resolver in naavi-chat handles MAKE_CALL pending intent',
    tags: ['v115', 'make-call'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(
        src.includes("pending.intent === 'MAKE_CALL'"),
        "Step 1.4 resolver missing MAKE_CALL case",
      );
    },
  },

  // ── 6. v116: RULE 3 — set_reminder retired ───────────────────────────────
  {
    id: 'v116.rule3-no-set-reminder-in-rule3',
    description: 'v116: RULE 3 in get-naavi-prompt no longer routes "remind me at X" to set_reminder tool',
    tags: ['v116', 'reminder'],
    run: async () => {
      const src = readFileSync(PROMPT_PATH, 'utf8');
      // Find the RULE 3 block
      const start = src.indexOf('RULE 3 — REMINDER:');
      const end   = src.indexOf('RULE 4 —', start);
      const rule3 = src.slice(start, end);
      expectTruthy(
        !rule3.includes('set_reminder tool') || rule3.includes('Do NOT use the set_reminder tool'),
        'RULE 3 still routes to set_reminder without the deprecation notice',
      );
      expectTruthy(
        rule3.includes("trigger_type='time'"),
        "RULE 3 must instruct Claude to use set_action_rule(trigger_type='time')",
      );
    },
  },
  {
    id: 'v116.lookup-contact-empty-name-falls-through',
    description: 'v116: LOOKUP_CONTACT with empty name (pronoun "their"/"them") falls through to Claude instead of showing broken confirmation',
    tags: ['v116', 'contact-lookup'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      // The guard must null-out classification when name is empty
      expectTruthy(
        src.includes("classification.intent === 'LOOKUP_CONTACT'") &&
        src.includes("!classification.params.name?.trim()") &&
        src.includes('classification = null;'),
        'Pronoun guard for empty LOOKUP_CONTACT name missing from naavi-chat',
      );
    },
  },
  {
    id: 'v116.rule26-time-anchor-extends',
    description: 'v116: RULE 26 now says time anchor extends to both actions unless "now/right now/immediately" is present',
    tags: ['v116', 'rule26'],
    run: async () => {
      const src = readFileSync(PROMPT_PATH, 'utf8');
      const start = src.indexOf('RULE 26 —');
      const end   = src.indexOf('RULE 24 —', start);
      const rule26 = src.slice(start, end);
      expectTruthy(
        rule26.includes('time anchor EXTENDS') || rule26.includes('EXTENDS to both'),
        'RULE 26 must state that the time anchor extends to both actions',
      );
      expectTruthy(
        rule26.includes('"now"') || rule26.includes("'now'"),
        'RULE 26 must list "now" as the immediacy signal that triggers a split',
      );
    },
  },

  // ── 8. v117: calendar attendee names — People API lookup ─────────────────
  {
    id: 'v117.calendar-attendee-names-people-api-lookup',
    description: 'v117: fetchLiveCalendarEvents looks up attendee emails without displayName via Google People API searchContacts',
    tags: ['v117', 'calendar', 'attendees'],
    run: async () => {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(
        src.includes('emailsNeedingNames') && src.includes('emailNameMap'),
        'naavi-chat index.ts must have emailsNeedingNames + emailNameMap contacts lookup for calendar attendees',
      );
      expectTruthy(
        src.includes('people:searchContacts'),
        'naavi-chat must call Google People API searchContacts for attendee name resolution',
      );
      expectTruthy(
        src.includes('emailNameMap[a.email?.toLowerCase()'),
        'attendee name resolution must use emailNameMap as fallback before a.email',
      );
    },
  },

  // ── 10. v118: RULE 3 — single-result search must not show disambiguation ──
  {
    id: 'v118.rule3-single-result-no-disambiguation',
    description: 'v118: RULE 3 PRE-EMIT CHECK — if global_search returns exactly 1 result, use it directly; no numbered list',
    tags: ['v118', 'rule3', 'disambiguation'],
    run: async () => {
      const src = readFileSync(PROMPT_PATH, 'utf8');
      const start = src.indexOf('PRE-EMIT CHECKS');
      const end   = src.indexOf('RULE 4 —', start);
      const block = src.slice(start, end);
      expectTruthy(
        block.includes('exactly ONE') && block.includes('use it directly'),
        'RULE 3 PRE-EMIT CHECK must say: 1 global_search result → use it directly, no disambiguation list',
      );
    },
  },

  // ── 11. v118: RULE 3 — post-disambiguation tool call in same turn ─────────
  {
    id: 'v118.rule3-post-disambiguation-tool-call-same-turn',
    description: 'v118: RULE 3 PRE-EMIT CHECK — after user picks from 2+ results, call set_action_rule in same turn as confirm prompt',
    tags: ['v118', 'rule3', 'disambiguation'],
    run: async () => {
      const src = readFileSync(PROMPT_PATH, 'utf8');
      const start = src.indexOf('PRE-EMIT CHECKS');
      const end   = src.indexOf('RULE 4 —', start);
      const block = src.slice(start, end);
      expectTruthy(
        block.includes('After the user picks') && block.includes('THAT SAME RESPONSE'),
        'RULE 3 PRE-EMIT CHECK must say: after user picks from disambiguation, call tool in THAT SAME RESPONSE',
      );
    },
  },

  // ── 12. v119: past-check uses ISO comparison, not 12-hour string ──────────
  {
    id: 'v119.rule3-past-check-uses-iso-comparison',
    description: 'v119: RULE 3 past-check must reference ISO timestamp and warn against comparing 12-hour strings numerically',
    tags: ['v119', 'rule3', 'timezone'],
    run: async () => {
      const src = readFileSync(PROMPT_PATH, 'utf8');
      const start = src.indexOf('PRE-EMIT CHECKS');
      const end   = src.indexOf('RULE 4 —', start);
      const block = src.slice(start, end);
      expectTruthy(
        block.includes('ISO8601 value') && block.includes('nowISO'),
        'RULE 3 past-check must reference ISO8601 value and nowISO variable for comparison',
      );
      expectTruthy(
        block.includes('12-hour clock strings'),
        'RULE 3 past-check must warn against comparing 12-hour clock strings numerically',
      );
    },
  },

  // ── 13. v125: self-alert primary rule — "alert me AND send to Bob" must not put Bob as primary ──
  {
    id: 'v125.self-alert-primary-rule',
    description: 'v125: prompt must have SELF-ALERT PRIMARY RULE forbidding third-party to_phone when user said "alert me"',
    tags: ['v125', 'time-alert', 'self-alert'],
    run: async () => {
      const src = readFileSync(PROMPT_PATH, 'utf8');
      const start = src.indexOf('RULE 3 — REMINDER:');
      const end   = src.indexOf('RULE 4 —', start);
      const rule3 = src.slice(start, end);
      expectTruthy(
        rule3.includes('SELF-ALERT PRIMARY RULE'),
        'RULE 3 must contain SELF-ALERT PRIMARY RULE section',
      );
      expectTruthy(
        rule3.includes('NEVER put a third-party phone number'),
        'SELF-ALERT PRIMARY RULE must say NEVER put a third-party phone number as primary to_phone',
      );
    },
  },

  // ── 9. v117: RULE 3 combined self-reminder + participant SMS ─────────────
  {
    id: 'v117.rule3-combined-reminder-and-participant-sms',
    description: 'v117: RULE 3 includes example showing "remind me AND send to participants" → ONE set_action_rule with task_actions',
    tags: ['v117', 'rule3', 'task-actions'],
    run: async () => {
      const src = readFileSync(PROMPT_PATH, 'utf8');
      const start = src.indexOf('RULE 3 — REMINDER:');
      const end   = src.indexOf('RULE 4 —', start);
      const rule3 = src.slice(start, end);
      expectTruthy(
        rule3.includes('task_actions') && rule3.includes('ONE'),
        'RULE 3 must have a combined self-reminder + task_actions example with "ONE" alert instruction',
      );
      expectTruthy(
        src.includes('Remind me at') && src.includes('send SMS') && src.includes('task_actions'),
        'TIME ALERT EXAMPLES must include combined remind+send example with task_actions',
      );
    },
  },
];
