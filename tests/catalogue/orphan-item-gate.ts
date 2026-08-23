/**
 * The orphan-item gate — is an item written about but missing from the list?
 *
 * Wael, 2026-08-23: "build a check for items written about but not in the list."
 *
 * ── The failure it catches, which surfaced four times in one session ────────
 *   T3    ranked Tier 1 in the priority queue, referenced twice by the
 *         Architecture Reference — and in no table at all.
 *   B4z   cited EIGHT times inside the shared Claude prompt as the authority
 *         for RULE 23, named in CLAUDE.md as queued work, tracked nowhere.
 *   S1    a P0 SECURITY item. No row, before or after it closed.
 *   B10x  ranked P1, above everything else open. No row.
 *
 * The priority cap counts what IS in the table. This is the other direction.
 *
 * ── Why it scans [[wiki-links]] and not every mention ──────────────────────
 * Measured before it was written. Scanning bare tokens across docs and Edge
 * Functions produced 216 orphans — almost all closed items legitimately living
 * in the closed archive, plus partial matches like `B10` inside `B10g`.
 * Requiring the deliberate wiki-link form AND the item-ID shape took it to 2,
 * and both were real. A gate that cries wolf gets switched off, and the absence
 * is then invisible — the worst outcome available.
 *
 * ── What it cannot do, and must never be read as doing ─────────────────────
 * It cannot see an item written about WITHOUT a wiki-link. B4z was cited eight
 * times in the prompt as plain text; this gate would not have caught it there,
 * and the tests below do not pretend otherwise. It also cannot judge whether a
 * row is good, current, or correctly classified.
 *
 * ── Coverage gaps acknowledged (Rule 15a) ──────────────────────────────────
 * The negative control writes a temporary markdown file containing a wiki-link
 * to an ID that cannot exist, runs the gate, and deletes the file in a finally
 * block. It writes inside docs/ because that is a scanned root; a fixture
 * outside the scan roots would prove nothing. Nothing here touches a database.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { TestCase } from '../lib/types';
import { expectTruthy } from '../lib/assertions';

const REPO = process.cwd();
const SCRIPT = join(REPO, 'scripts', 'orphan-item-check.js');
const HOOK = join(REPO, '.githooks', 'pre-push');
const CANARY = join(REPO, 'docs', 'ZZ_ORPHAN_GATE_CANARY.md');

function runGate(): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT], { encoding: 'utf8', cwd: REPO, timeout: 180_000 });
    return { code: 0, out };
  } catch (err: any) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

export const orphanItemGateTests: TestCase[] = [
  {
    id: 'orphan-item.passes-on-a-clean-tree',
    category: 'orphan-item-gate',
    platform: 'shared',
    description:
      'The gate exits 0 on the current tree. A failure means either an item is genuinely referenced with '
      + 'no row — give it one — or the gate itself broke.',
    timeoutMs: 200_000,
    async run(ctx) {
      expectTruthy(existsSync(SCRIPT), 'scripts/orphan-item-check.js is missing — the gate has been removed');
      const { code, out } = runGate();
      expectTruthy(code === 0, `the gate failed on a clean tree (exit ${code}):\n${out.slice(-800)}`);
      ctx.log(out.trim().split('\n').slice(-1)[0].trim());
    },
  },

  {
    id: 'orphan-item.actually-catches-an-unfiled-item',
    category: 'orphan-item-gate',
    platform: 'shared',
    description:
      'Negative control. Writes a doc referencing an item ID that has no row, asserts the gate refuses, '
      + 'then removes it. A gate that never refuses is decoration.',
    timeoutMs: 200_000,
    async run(ctx) {
      expectTruthy(!existsSync(CANARY), `${CANARY} already exists — a previous run did not clean up`);
      try {
        writeFileSync(CANARY,
          '# Orphan gate canary\n\nTemporary. References [[B99z]], which has no row anywhere.\n');
        const { code, out } = runGate();
        expectTruthy(code !== 0,
          'the gate PASSED while a document referenced an item with no row. It is not catching anything.');
        expectTruthy(/B99z/.test(out),
          `the gate refused but did not name the offending id:\n${out.slice(-500)}`);
        ctx.log('gate refuses and names the unfiled item');
      } finally {
        if (existsSync(CANARY)) unlinkSync(CANARY);
      }
    },
  },

  {
    id: 'orphan-item.wired-into-pre-push',
    category: 'orphan-item-gate',
    platform: 'shared',
    description:
      'Bound to pre-push rather than left as a command someone must remember. Every item this gate exists '
      + 'to catch was found by accident, which is precisely what relying on memory produces.',
    timeoutMs: 15_000,
    async run(ctx) {
      const hook = readFileSync(HOOK, 'utf8');
      expectTruthy(/orphan-item-check/.test(hook), 'pre-push no longer runs the orphan item check');
      expectTruthy(/PUSH REFUSED/.test(hook), 'pre-push no longer refuses the push when an item is unfiled');
      ctx.log('orphan gate present in pre-push and fails closed');
    },
  },

  {
    id: 'orphan-item.reads-both-holding-list-files',
    category: 'orphan-item-gate',
    platform: 'shared',
    description:
      'Closed items live in a SECOND file. A gate reading only the open list would report every closed '
      + 'item as an orphan — that was 216 false positives when first measured.',
    timeoutMs: 15_000,
    async run(ctx) {
      const src = readFileSync(SCRIPT, 'utf8');
      expectTruthy(/HOLDING_LIST_CLASSIFICATION/.test(src), 'the gate no longer reads the open holding list');
      expectTruthy(/HOLDING_LIST_CLOSED_ARCHIVE/.test(src),
        'the gate no longer reads the CLOSED archive. Without it every closed item reads as an orphan, the '
        + 'gate drowns in false positives, and it gets switched off.');
      ctx.log('both holding-list files are treated as sources of truth');
    },
  },
];
