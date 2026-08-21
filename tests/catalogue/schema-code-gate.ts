/**
 * The schema/code gate — does it still work, and does it still catch things?
 *
 * `scripts/schema-code-check.js` answers a question nothing else in this
 * project asks: does deployed code reference database columns that do not
 * exist? The drift check compares the two DATABASES to each other; nothing
 * compared either to the CODE. A manual sweep for that on 2026-08-21 found
 * three live defects in one sitting, and the gate found three more on its
 * first run.
 *
 * ── Why the gate itself needs testing, not just running ────────────────────
 * It has already been wrong twice, both times in the direction that quietly
 * destroys a gate's usefulness:
 *
 *   1. Its first draft reported 95 findings, nearly all false — a greedy line
 *      window attached one query's columns to the previous query's table, and
 *      embedded resources like `email_actions(vendor, summary)` leaked their
 *      inner columns as if they belonged to the outer table.
 *   2. Its baseline keyed on file:line, so adding 54 lines of comment above a
 *      known finding shifted every entry and it reported them all as new.
 *
 * Neither made it fail to find real problems. Both made it cry wolf, and a
 * gate that cries wolf gets switched off — which is worse than no gate,
 * because the absence is then invisible.
 *
 * ── Coverage gaps acknowledged (Rule 15a) ──────────────────────────────────
 * The negative-control test below mutates a REAL source file, runs the gate,
 * and restores it. It uses the repo's own file rather than a fixture because
 * the gate scans fixed directories; a fixture outside them would not be seen,
 * and one inside them would be scanned by every other run too. The restore is
 * in a finally block and the test asserts the file came back byte-identical —
 * if that assertion ever fails, the test itself is the bug.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import type { TestCase } from '../lib/types';
import { expectTruthy } from '../lib/assertions';

const REPO = process.cwd();
const SCRIPT = join(REPO, 'scripts', 'schema-code-check.js');
const BASELINE = join(REPO, 'docs', 'schema_code_known_findings.json');
const VICTIM = join(REPO, 'supabase', 'functions', 'global-search', 'adapters', 'rules.ts');

/** Run the gate; return its exit code without throwing. */
function runGate(): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT], { encoding: 'utf8', cwd: REPO, timeout: 180_000 });
    return { code: 0, out };
  } catch (err: any) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

export const schemaCodeGateTests: TestCase[] = [
  {
    id: 'schema-gate.passes-on-a-clean-tree',
    category: 'schema-code-gate',
    platform: 'shared',
    description:
      'The gate exits 0 on the current tree. If this fails, either a NEW schema/code mismatch was '
      + 'introduced, or the gate itself broke — both worth stopping for.',
    timeoutMs: 200_000,
    async run(ctx) {
      expectTruthy(existsSync(SCRIPT), 'scripts/schema-code-check.js is missing — the gate has been removed');
      const { code, out } = runGate();
      expectTruthy(code === 0,
        `the gate failed on a clean tree (exit ${code}). Either new code references a column that does not `
        + `exist, or the check regressed:\n${out.slice(-900)}`);
      ctx.log('gate exits 0 on the current tree');
    },
  },
  {
    id: 'schema-gate.baseline-is-present-and-not-silently-emptied',
    category: 'schema-code-gate',
    platform: 'shared',
    description:
      'The baseline holds the known findings. An empty baseline would make the gate pass trivially while '
      + 'appearing healthy — the failure mode hardest to notice.',
    timeoutMs: 15_000,
    async run(ctx) {
      expectTruthy(existsSync(BASELINE), 'docs/schema_code_known_findings.json is missing');
      const b = JSON.parse(readFileSync(BASELINE, 'utf8'));
      expectTruthy(Array.isArray(b.known), 'baseline has no `known` array');
      expectTruthy(b.known.length > 0,
        'the baseline is EMPTY. Either every known finding was genuinely fixed — in which case update this '
        + 'test deliberately — or it was blanked, and the gate is now green over a backlog it can no longer see.');

      // Keys must not carry line numbers: that was the cry-wolf bug, where any
      // edit above a finding invalidated its baseline entry.
      const withLines = b.known.filter((k: string) => /:\d+$/.test(k));
      expectTruthy(withLines.length === 0,
        `baseline keys must not include line numbers (found ${withLines.length}). Keying on file:line makes `
        + 'the baseline decay on every unrelated edit — the exact regression fixed on 2026-08-21.');
      ctx.log(`baseline holds ${b.known.length} known finding(s), keyed without line numbers`);
    },
  },
  {
    id: 'schema-gate.actually-catches-a-new-mismatch',
    category: 'schema-code-gate',
    platform: 'shared',
    description:
      'NEGATIVE CONTROL. Injects a reference to a column that does not exist and asserts the gate fails. '
      + 'A gate that has only ever passed has not been tested.',
    timeoutMs: 200_000,
    async run(ctx) {
      const original = readFileSync(VICTIM, 'utf8');
      expectTruthy(/\.select\(\s*'/.test(original),
        'the fixture file no longer has a quoted .select() to mutate — point this test at another file');

      let restored = false;
      try {
        // A comment line first, so this also proves the baseline survives a
        // line shift — the second bug this gate had.
        const mutated = '// schema-gate negative control — removed by the test\n'
          + original.replace(/\.select\(\s*'([^']+)'/, (m, g) =>
            m.replace(g, `${g}, a_column_that_cannot_exist`));
        writeFileSync(VICTIM, mutated);

        const { code, out } = runGate();
        expectTruthy(code !== 0,
          'the gate PASSED while code referenced a column that does not exist. It is not protecting anything.');
        expectTruthy(/a_column_that_cannot_exist/.test(out),
          `the gate failed but did not name the offending column, which makes it unactionable:\n${out.slice(-600)}`);
        ctx.log('gate correctly refused, and named the column');
      } finally {
        writeFileSync(VICTIM, original);
        restored = true;
      }

      expectTruthy(restored, 'the fixture file was not restored');
      expectTruthy(readFileSync(VICTIM, 'utf8') === original,
        'the fixture file did not come back byte-identical — this test has damaged the repo, fix it before anything else');
      ctx.log('fixture restored byte-identical');
    },
  },
];
