/**
 * priority-cap-check — refuses a push when the priority list exceeds 5 items.
 *
 * Wael's rule, 2026-08-22: "Priority list Maximum items is 5. If you want to put
 * a new one, WE MUST deprioritise other. This will force us in cleaning and
 * closing items."
 *
 * ── Why this is a gate and not a sentence in a document ────────────────────
 * The list it protects replaced a priority queue that had been correct on the
 * day it was written and was never regenerated. By the time it was archived it
 * held nine closed items, an entire "RESOLVED, kept for audit trail" section,
 * and an entry for a platform that had already shipped. The same session found
 * an architecture reference stale for four months, a parity audit nobody
 * updated, and a work item (B4z) cited eight times inside the shared prompt and
 * tracked in no list at all.
 *
 * Every one of those was knowledge recorded correctly with nothing forcing it to
 * stay true. The cap is worth nothing if it decays the same way, so it refuses a
 * push instead of printing a warning.
 *
 * ── What it does NOT check ─────────────────────────────────────────────────
 * It counts rows. It cannot tell whether the five are the RIGHT five, whether an
 * item was moved rather than copied, or whether a row is stale. Those are
 * judgement, and a counter must not be mistaken for one.
 */

const fs = require('fs');
const path = require('path');

const DOC = path.join(__dirname, '..', 'docs', 'HOLDING_LIST_CLASSIFICATION_2026-06-11.md');
const HEADING = '## ⭐⭐⭐ PRIORITY LIST';
const MAX = 5;

function main() {
  if (!fs.existsSync(DOC)) {
    console.error(`Priority cap check could not run: ${path.basename(DOC)} not found.`);
    console.error('Failing closed — a gate that skips itself when it cannot check is not a gate.');
    return 2;
  }

  const lines = fs.readFileSync(DOC, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(HEADING));

  if (start === -1) {
    console.error(`Priority cap check could not run: no section starting "${HEADING}".`);
    console.error('Either the heading was renamed or the section was removed. Failing closed.');
    return 2;
  }

  // The section ends at the next top-level heading.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }

  const ids = [];
  for (const line of lines.slice(start, end)) {
    const m = line.match(/^\|\s*([A-Za-z][A-Za-z0-9]*)\s*\|/);
    if (!m) continue;
    const id = m[1];
    if (id === 'ID') continue;            // header row
    ids.push(id);
  }

  const stamp = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
  console.log(`Priority cap check — max ${MAX} items, ${stamp} EST`);

  if (ids.length > MAX) {
    console.error('');
    console.error(`  ${ids.length} items on the priority list. The cap is ${MAX}.`);
    console.error(`  ${ids.join(', ')}`);
    console.error('');
    console.error('  Move one back to the general list before adding another. That decision');
    console.error('  is the point of the rule — not paperwork around it.');
    return 1;
  }

  const free = MAX - ids.length;
  console.log(
    `  ${ids.length} of ${MAX}${free ? ` (${free} slot${free > 1 ? 's' : ''} free)` : ' — full'}` +
    `${ids.length ? ': ' + ids.join(', ') : ''}`,
  );
  return 0;
}

process.exit(main());
