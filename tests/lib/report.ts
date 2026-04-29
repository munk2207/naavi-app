/**
 * Report — turns SuiteReport into human-readable markdown + JSON files.
 *
 * Output goes to tests/results/{ISO-timestamp}.md and .json so a history
 * builds up. Latest run is always also written to tests/results/latest.md
 * for easy linking.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { SuiteReport, TestResult } from './types';

const RESULTS_DIR = join(process.cwd(), 'tests', 'results');

function statusGlyph(s: TestResult['status']): string {
  switch (s) {
    case 'passed':    return '✓ PASS  ';
    case 'failed':    return '✗ FAIL  ';
    case 'errored':   return '⨯ ERROR ';
    case 'timed-out': return '⧗ TIMEOUT';
    case 'skipped':   return '○ SKIP  ';
  }
}

export function renderMarkdown(report: SuiteReport): string {
  const lines: string[] = [];
  lines.push(`# Naavi Auto-Tester — ${report.startedAt}`);
  lines.push('');
  lines.push('────────────────────────────────────────────────────────');
  lines.push(`Total: **${report.total}**   Passed: **${report.passed}** ✓   Failed: **${report.failed}** ✗   Errored: **${report.errored}** ⨯   Timed out: **${report.timedOut}** ⧗   Skipped: **${report.skipped}** ○`);
  lines.push(`Duration: ${(report.durationMs / 1000).toFixed(1)}s`);
  lines.push('');

  // Group by category for readability.
  const byCategory: Record<string, TestResult[]> = {};
  for (const r of report.results) {
    if (!byCategory[r.category]) byCategory[r.category] = [];
    byCategory[r.category].push(r);
  }
  for (const [cat, rs] of Object.entries(byCategory)) {
    lines.push(`## ${cat}`);
    lines.push('');
    for (const r of rs) {
      const dur = r.durationMs.toFixed(0).padStart(5);
      lines.push(`- ${statusGlyph(r.status)}  \`${r.id}\`  (${dur}ms)`);
      lines.push(`  ${r.description}`);
      if (r.errorMessage) {
        lines.push(`  > ${r.errorMessage}`);
      }
    }
    lines.push('');
  }

  // Detail block — all logs from non-passing tests, for debugging.
  const failures = report.results.filter(r => r.status !== 'passed' && r.status !== 'skipped');
  if (failures.length > 0) {
    lines.push('## Failures — diagnostic detail');
    lines.push('');
    for (const r of failures) {
      lines.push(`### \`${r.id}\` — ${r.status}`);
      lines.push('');
      lines.push('```');
      if (r.errorMessage) lines.push(`Error: ${r.errorMessage}`);
      if (r.log.length > 0) {
        lines.push('--- log ---');
        for (const line of r.log) lines.push(line);
      }
      if (r.errorStack) {
        lines.push('--- stack ---');
        lines.push(r.errorStack);
      }
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function writeReport(report: SuiteReport): { markdownPath: string; jsonPath: string; latestPath: string } {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = report.startedAt.replace(/:/g, '-').replace(/\./g, '-');
  const markdownPath = join(RESULTS_DIR, `${stamp}.md`);
  const jsonPath = join(RESULTS_DIR, `${stamp}.json`);
  const latestPath = join(RESULTS_DIR, 'latest.md');
  const md = renderMarkdown(report);
  writeFileSync(markdownPath, md, 'utf8');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(latestPath, md, 'utf8');
  return { markdownPath, jsonPath, latestPath };
}

export function renderConsoleSummary(report: SuiteReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('────────────────────────────────────────────────────────');
  lines.push(`Naavi Auto-Tester — ${report.total} tests`);
  lines.push(`✓ ${report.passed} passed   ✗ ${report.failed} failed   ⨯ ${report.errored} errored   ⧗ ${report.timedOut} timed out   ○ ${report.skipped} skipped`);
  lines.push(`Duration: ${(report.durationMs / 1000).toFixed(1)}s`);
  lines.push('────────────────────────────────────────────────────────');
  for (const r of report.results) {
    if (r.status === 'passed') continue;
    lines.push(`${statusGlyph(r.status)}  ${r.id}`);
    if (r.errorMessage) lines.push(`         ${r.errorMessage}`);
  }
  lines.push('');
  return lines.join('\n');
}
