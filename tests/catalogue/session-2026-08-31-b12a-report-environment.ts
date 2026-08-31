/**
 * Session 2026-08-31 — B12a: the auto-tester prints which environment it
 * tested and then does not write it down, so every stored report is
 * unattributable.
 *
 * The runner has printed an environment banner since 2026-07-20. It was added
 * after a production AAB was built on a "green" run that had actually tested
 * production's stale, unfixed backend — see CLAUDE.md's CROSS-CUTTING CHANGE
 * PARITY CHECK and feedback_verify_test_env_before_trusting_gate. That fix
 * made the environment visible IN THE CONSOLE and stopped there, so the same
 * class of mistake survived in the artifact the console produces: once the
 * terminal scrollback is gone, no saved report can be trusted, because nobody
 * can tell what it was testing.
 *
 * Not hypothetical. Dating B11z required knowing whether the 2026-08-22 run
 * had targeted staging or production, and that answer is unrecoverable.
 *
 * Fix: SuiteReport carries `environment` and `projectRef`; the runner
 * populates them from the same values that produce the banner; renderMarkdown
 * prints them directly under the report title.
 *
 * ── Positive and negative control ─────────────────────────────────────────
 * Positive: a report carrying an environment renders it in the artifact.
 * Negative: a report WITHOUT one renders an explicit "not recorded" line
 * rather than silently omitting it. That second case is the one that matters —
 * silence is exactly how the original defect hid, and a report that simply
 * leaves the field out looks identical to one written before the field
 * existed. Saying so in the artifact is the difference between an unknown
 * that announces itself and an unknown that does not.
 *
 * These are pure rendering assertions against the real renderMarkdown — no
 * network, no fixtures, no environment of their own. They deliberately do NOT
 * assert which environment a run targets; that is the runner's job and
 * asserting it here would make the suite fail depending on where it was
 * pointed, which is the opposite of the point.
 */

import { renderMarkdown } from '../lib/report';
import { expectTruthy, expectMatch } from '../lib/assertions';
import type { SuiteReport, TestCase } from '../lib/types';

/** Minimal report shell — only the fields renderMarkdown reads. */
function reportWith(extra: Partial<SuiteReport>): SuiteReport {
  return {
    startedAt:  '2026-08-31T07:00:00.000Z',
    finishedAt: '2026-08-31T07:00:10.000Z',
    durationMs: 10_000,
    total: 0, passed: 0, failed: 0, errored: 0, timedOut: 0, skipped: 0,
    results: [],
    ...extra,
  };
}

export const session2026_08_31_b12aReportEnvironmentTests: TestCase[] = [
  {
    id: 'b12a.saved-report-records-the-environment-it-tested',
    category: 'rules',
    description: 'a rendered report states its environment and project ref under the title, so a stored result can be attributed after the scrollback is gone',
    async run() {
      const md = renderMarkdown(reportWith({
        environment: 'STAGING',
        projectRef: 'xugvnfudofuskxoknhve',
      }));

      expectMatch(md, /\*\*Environment: STAGING\*\*/, 'report must name the environment it tested');
      expectTruthy(
        md.includes('xugvnfudofuskxoknhve'),
        'report must record the resolved project ref — the label is a translation, the ref is the fact',
      );

      // It has to be near the top, where someone reading the file will meet
      // it, not buried under the per-category results.
      const envIdx = md.indexOf('**Environment:');
      const rulerIdx = md.indexOf('────');
      expectTruthy(
        envIdx !== -1 && rulerIdx !== -1 && envIdx < rulerIdx,
        'the environment line must sit above the totals ruler, not lower in the report',
      );
    },
  },
  {
    id: 'b12a.report-without-an-environment-says-so-out-loud',
    category: 'rules',
    description: 'a report carrying no environment renders an explicit "not recorded" line instead of silently omitting it',
    async run() {
      const md = renderMarkdown(reportWith({}));

      expectMatch(
        md,
        /\*\*Environment: not recorded\*\*/,
        'a report with no environment must SAY it cannot be attributed — silence is how the original defect hid',
      );
      expectTruthy(
        !/\*\*Environment: (STAGING|PRODUCTION|UNKNOWN)\*\*/.test(md),
        'a report with no environment must never render a concrete one',
      );
    },
  },
  {
    id: 'b12a.runner-populates-the-environment-from-the-banner-values',
    category: 'rules',
    description: 'the runner writes the same environment into the report that it prints in the banner, so the two can never disagree',
    async run() {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const src = readFileSync(join(process.cwd(), 'tests', 'runner.ts'), 'utf8');

      const start = src.indexOf('const report: SuiteReport = {');
      expectTruthy(start !== -1, 'SuiteReport construction not found in tests/runner.ts');
      const block = src.slice(start, src.indexOf('};', start));

      expectTruthy(
        /environment:\s*envLabel/.test(block),
        'the report must take its environment from envLabel — the SAME value the banner prints, not a second computation that can drift from it',
      );
      expectTruthy(
        /projectRef:\s*projectRef/.test(block),
        'the report must record projectRef alongside the label',
      );
    },
  },
];
