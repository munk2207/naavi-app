/**
 * Session 2026-06-14 — v115 fixes
 *
 * Covers:
 * 1. Sarah disambig label fix — label set before disambig branch, refined after pick
 * 2. fmtDtLocal long format — weekday + month use 'long' not 'short'
 * 3. Path B wrapper only fires on genuine uncertainty, not direct answers
 * 4. normalizeActionSeparators lowercase — period-separated lowercase sentences both fire
 * 5. MAKE_CALL pre-Claude bypass and outbound-call Edge Function present
 *
 * Run via `npm run test:auto`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const INDEX_PATH = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');
const OC_PATH    = join(process.cwd(), 'supabase', 'functions', 'outbound-call', 'index.ts');

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
];
