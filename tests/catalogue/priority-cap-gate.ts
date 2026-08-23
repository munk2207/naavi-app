/**
 * The priority-list cap — is it enforced, and does it still refuse?
 *
 * Wael's rule, 2026-08-22: the priority list at the head of
 * HOLDING_LIST_CLASSIFICATION holds at most 5 items, and adding a sixth
 * requires moving one out first. "This will force us in cleaning and closing
 * items."
 *
 * ── Why the cap is a gate rather than a sentence ───────────────────────────
 * It replaced a priority queue that was correct on the day it was written and
 * never regenerated. By the time it was archived it carried nine closed or
 * struck-through items, an entire "Tier 2 — RESOLVED, kept for audit trail"
 * section, and an entry for a Voice Staging platform that had already shipped.
 *
 * The same session found an architecture reference four months stale, a parity
 * audit nobody had updated, and a work item (B4z) cited eight times inside the
 * shared prompt while appearing in no list at all. Every one of those was
 * knowledge recorded correctly with nothing forcing it to stay true.
 *
 * So the cap refuses a push instead of printing a warning — and these tests
 * exist because a gate nobody verifies decays exactly like the thing it
 * replaced.
 *
 * ── What the cap does NOT check, and must never be read as checking ────────
 * It counts rows. It cannot tell whether the five are the RIGHT five, whether
 * an item was MOVED rather than copied, or whether a row has gone stale. Those
 * are judgement. A counter mistaken for judgement is worse than no counter,
 * because it looks like oversight.
 *
 * ── Coverage gaps acknowledged (Rule 15a) ──────────────────────────────────
 * The negative control mutates the real holding-list document, runs the gate,
 * and restores it from an in-memory copy. It uses the real document because the
 * script resolves that path directly; a fixture elsewhere would not be read.
 * The restore is in a finally block. Nothing here touches a database.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { TestCase } from '../lib/types';
import { expectTruthy } from '../lib/assertions';

const REPO = process.cwd();
const SCRIPT = join(REPO, 'scripts', 'priority-cap-check.js');
const DOC = join(REPO, 'docs', 'HOLDING_LIST_CLASSIFICATION_2026-06-11.md');
const HOOK = join(REPO, '.githooks', 'pre-push');
const HEADING = '## ⭐⭐⭐ PRIORITY LIST';

function runGate(): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT], { encoding: 'utf8', cwd: REPO, timeout: 60_000 });
    return { code: 0, out };
  } catch (err: any) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

export const priorityCapGateTests: TestCase[] = [
  {
    id: 'priority-cap.passes-at-or-under-the-cap',
    category: 'priority-cap-gate',
    platform: 'shared',
    description:
      'The gate exits 0 on the current document. A failure means either the priority list genuinely '
      + 'exceeded 5 — in which case something must be moved out — or the gate broke.',
    timeoutMs: 70_000,
    async run(ctx) {
      expectTruthy(existsSync(SCRIPT), 'scripts/priority-cap-check.js is missing — the cap is no longer enforced');
      const { code, out } = runGate();
      expectTruthy(code === 0, `the cap check failed on the current document (exit ${code}):\n${out.slice(-600)}`);
      ctx.log(out.trim().split('\n').slice(-1)[0]);
    },
  },

  {
    id: 'priority-cap.refuses-at-six',
    category: 'priority-cap-gate',
    platform: 'shared',
    description:
      'Negative control. Adds two temporary rows to the priority table, asserts the gate exits non-zero, '
      + 'and restores the document. A cap that never refuses is decoration.',
    timeoutMs: 70_000,
    async run(ctx) {
      const original = readFileSync(DOC, 'utf8');
      try {
        const lines = original.split(/\r?\n/);
        const start = lines.findIndex((l) => l.startsWith(HEADING));
        expectTruthy(start !== -1, `no section starting "${HEADING}" — the priority list was renamed or removed`);

        // Insert after the last table row inside the section.
        let last = -1;
        for (let i = start + 1; i < lines.length; i++) {
          if (lines[i].startsWith('## ')) break;
          if (/^\|\s*[A-Za-z][A-Za-z0-9]*\s*\|/.test(lines[i])) last = i;
        }
        expectTruthy(last !== -1, 'the priority table has no rows at all — expected at least a header');

        lines.splice(last + 1, 0, '| ZZTEST1 | temporary | test | temporary |', '| ZZTEST2 | temporary | test | temporary |');
        writeFileSync(DOC, lines.join('\n'));

        const { code, out } = runGate();
        expectTruthy(code !== 0, 'the gate PASSED with six items on the priority list. The cap is not enforced.');
        expectTruthy(/cap is 5|The cap is/.test(out), `the gate refused but did not explain the cap:\n${out.slice(-400)}`);
        ctx.log(`gate exits ${code} at six items, as required`);
      } finally {
        writeFileSync(DOC, original);
      }
    },
  },

  {
    id: 'priority-cap.wired-into-pre-push',
    category: 'priority-cap-gate',
    platform: 'shared',
    description:
      'The cap is bound to pre-push, not left as a command someone must remember. Binding it to memory '
      + 'is what produced the stale queue this list replaced.',
    timeoutMs: 15_000,
    async run(ctx) {
      const hook = readFileSync(HOOK, 'utf8');
      expectTruthy(/priority-cap-check/.test(hook),
        'pre-push no longer runs the priority cap check. A rule enforced only by intention decays — that is '
        + 'the exact failure this gate exists to prevent.');
      expectTruthy(/PUSH REFUSED/.test(hook), 'pre-push no longer refuses the push when the cap is exceeded');
      ctx.log('cap check present in pre-push and fails closed');
    },
  },

  {
    id: 'priority-cap.items-live-in-exactly-one-place',
    category: 'priority-cap-gate',
    platform: 'shared',
    description:
      'Items MOVE to the priority list, never copy. A duplicated row means two descriptions of one item, '
      + 'which is precisely how the archived queue drifted from the tables it summarised.',
    timeoutMs: 15_000,
    async run(ctx) {
      const lines = readFileSync(DOC, 'utf8').split(/\r?\n/);
      const counts = new Map<string, number>();
      for (const line of lines) {
        const m = line.match(/^\|\s*([A-Za-z][A-Za-z0-9]*)\s*\|/);
        if (!m) continue;
        const id = m[1];
        if (id === 'ID' || /^ZZTEST/.test(id)) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} (${n})`);
      expectTruthy(dupes.length === 0,
        `these IDs appear in more than one table row: ${dupes.join(', ')}. An item belongs to the priority `
        + 'list OR the general list, never both — the two copies drift, which is what killed the old queue.');
      ctx.log(`${counts.size} unique item rows, no duplicates`);
    },
  },
];
