/**
 * closed-row-placement-check — refuses a push when a row sitting in an OPEN
 * table declares itself closed, done or superseded in its own text.
 *
 * ── The incident this exists for, 2026-08-23 ───────────────────────────────
 * Wael: "We said many times that T6 and Epic is not on the list, however I see
 * it now on the priority list! I'm really fed-up."
 *
 * T6 had been CLOSED since 2026-08-21. Its own row said so, and quoted him:
 * "there is no real work done on it, and it is confusing, you brought it 3
 * times in this session." The closure was written into the text. The row was
 * never moved. It then sat in the priority list for three days, and on
 * 2026-08-23 Claude read it and recommended it as the single highest priority
 * — above a stranger one keystroke from receiving a real message.
 *
 * ── Why the existing gates did not catch it, which is the real lesson ──────
 * Both ran that night and both passed.
 *
 *   priority-cap-check  counts ROWS. Not open rows. A closed row consumed one
 *                       of the five slots and the gate reported "5 of 5, full".
 *   orphan-item-check   verifies every referenced ID HAS a row. Not that the
 *                       row is in the right table.
 *
 * Two green gates, one wrong list. They measured what was easy to measure
 * rather than what actually fails. That is the failure mode to design against,
 * not "nobody follows the rules".
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * The holding list has always had it (governance rule 4: "If closing an item,
 * move the row to the correct Closed table — don't leave a stale duplicate in
 * the open table"). Nothing enforced it.
 *
 *     An item is not closed because its text says so.
 *     It is closed when it has MOVED.
 *
 * ── Baseline ───────────────────────────────────────────────────────────────
 * Eight rows were already in this state when the check was written. Blocking
 * every push until they are triaged would punish the wrong person, so they are
 * recorded in docs/closed_row_placement_baseline.json and the check fails only
 * on anything NEW. Same pattern as the T4 drift check.
 *
 * The baseline is a debt list, not an exemption. Triage shrinks it to zero:
 *     node scripts/closed-row-placement-check.js --write-baseline
 *
 * ── What it does NOT check ─────────────────────────────────────────────────
 * It reads text. It cannot tell whether an item SHOULD be closed, whether the
 * closure was correct, or whether a row that says nothing is quietly stale.
 * A row can be finished and say so nowhere — this catches the opposite case.
 */

const fs = require('fs');
const path = require('path');

const DOC = path.join(__dirname, '..', 'docs', 'HOLDING_LIST_CLASSIFICATION_2026-06-11.md');
const BASELINE = path.join(__dirname, '..', 'docs', 'closed_row_placement_baseline.json');

const writeBaseline = process.argv.includes('--write-baseline');

const stamp = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
console.log(`Closed-row placement check — is anything finished sitting in an open table? ${stamp} EST`);
console.log('');

if (!fs.existsSync(DOC)) {
  console.error(`  Cannot read ${DOC}. Refusing the push rather than passing blind.`);
  process.exit(1);
}

const lines = fs.readFileSync(DOC, 'utf8').split(/\r?\n/);

// A section counts as OPEN unless its heading marks it closed, archived or
// deferred. Defaulting to "open" is deliberate: a new section nobody taught
// this script about should be checked, not skipped.
const isClosedSection = (name) => /closed|archive|superseded|deferred/i.test(name);

// Phrases by which a row declares its own completion. Deliberately narrow —
// a row DISCUSSING another item's closure ("supersedes [[X]]") must not trip
// this, so possessive/second-person forms are excluded.
const CLOSURE_MARKERS = [
  /\bCLOSED\s+20\d\d-\d\d-\d\d/,
  /⭐+\s*CLOSED\b/,
  /\bDONE\s+20\d\d-\d\d-\d\d/,
  /\bsuperseded\s+by\s+\[\[/i,
];

let section = '(before first heading)';
const found = [];

lines.forEach((line, i) => {
  if (/^#{2,3}\s/.test(line)) { section = line.replace(/^#+\s*/, '').trim(); return; }
  if (!/^\|\s*[A-Z]+\d+[a-z]?\s*\|/.test(line)) return;
  if (isClosedSection(section)) return;

  const id = line.split('|')[1].trim();
  const markers = CLOSURE_MARKERS.filter(re => re.test(line)).map(re => re.source);
  if (markers.length) found.push({ id, line: i + 1, section, markers });
});

if (writeBaseline) {
  fs.writeFileSync(BASELINE, JSON.stringify({
    written: stamp,
    note: 'Rows in open tables that declare themselves closed. A DEBT LIST, not an exemption — triage shrinks it to zero.',
    ids: found.map(f => f.id).sort(),
  }, null, 2) + '\n');
  console.log(`  Baseline written: ${found.length} row(s) recorded as known.`);
  console.log('  This is debt, not permission. Every entry should end up moved.');
  process.exit(0);
}

let known = [];
if (fs.existsSync(BASELINE)) {
  try { known = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).ids || []; }
  catch (e) { console.error(`  Baseline unreadable (${e.message}). Refusing rather than passing blind.`); process.exit(1); }
}

const fresh = found.filter(f => !known.includes(f.id));
const stillKnown = found.filter(f => known.includes(f.id));
const fixed = known.filter(id => !found.some(f => f.id === id));

if (stillKnown.length) {
  console.log(`  ${stillKnown.length} known, already recorded: ${stillKnown.map(f => f.id).join(', ')}`);
  console.log('  Known is not fine. These are finished items presented as live work.');
  console.log('');
}
if (fixed.length) {
  console.log(`  ✅ ${fixed.length} cleared since the baseline: ${fixed.join(', ')}`);
  console.log('     Shrink the baseline to match:  node scripts/closed-row-placement-check.js --write-baseline');
  console.log('');
}

if (!fresh.length) {
  console.log('  Clean — no NEW row declaring itself closed while sitting in an open table.');
  process.exit(0);
}

console.log(`  ❌ ${fresh.length} NEW row(s) say they are finished but have not moved:`);
console.log('');
for (const f of fresh) {
  console.log(`     ${f.id.padEnd(6)} line ${String(f.line).padEnd(5)} in "${f.section}"`);
  console.log(`            matched: ${f.markers.join(' , ')}`);
}
console.log('');
console.log('  An item is not closed because its text says so. It is closed when it has MOVED.');
console.log('  Move the row to docs/HOLDING_LIST_CLOSED_ARCHIVE_2026-07-28.md.');
console.log('');
console.log('  If a row legitimately mentions closure without being closed, the marker list');
console.log('  in this script is too broad — narrow it rather than adding the row to the baseline.');
process.exit(1);
