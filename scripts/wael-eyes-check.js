#!/usr/bin/env node
/**
 * wael-eyes-check — refuses a push when the FOR WAEL'S EYES summary at the top
 * of the holding list has drifted from the open tables below it, or when a
 * summary line has stopped being a summary.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Wael, 2026-08-31: "My intention in building the Holding list is to have a
 * simple list that can help me review the different bugs, features, etc, then
 * I have control on what we have. Today it is becoming so complex and long it
 * loses for me the major reason of creating it."
 *
 * He had asked for this summary BEFORE. Each previous attempt was lost the same
 * way, in his words: "they impeded in the long text." Nobody deleted it. It
 * filled up with detail one well-meaning addition at a time until it was no
 * longer readable at a glance, which is the only thing it was for.
 *
 * ── The two failure modes, and why the second one is the dangerous one ─────
 *
 *   COVERAGE  — an item is added below and no line is added above. Slow,
 *               visible, and easy to fix once noticed.
 *
 *   FORMAT    — a line grows a file path, a line number, a backtick, a
 *               paragraph. Nothing breaks. Nobody notices on the day. This is
 *               what actually killed every previous attempt, and it is why
 *               this script checks shape and not only presence.
 *
 * ── What it CANNOT do, stated here so nobody mistakes a pass for the truth ─
 * It checks that a line EXISTS and is still SHORT AND PLAIN. It cannot check
 * that the line is still TRUE.
 *
 * On the night this was written, four rows in this same file were each wrong
 * about something — a shipped item recorded as pending, a defect recorded as
 * milder than it had become, counts taken from the wrong environment, and
 * citations pointing at lines that no longer existed. Every one was
 * well-formed. This gate would have passed all four without a murmur.
 *
 * A green run here means the summary is readable. It does not mean it is right.
 *
 * ── No baseline, deliberately ─────────────────────────────────────────────
 * The sibling gates carry a baseline file because they inherited real debt.
 * This one started clean — 59 open rows, 59 summary lines, every one inside the
 * format — so there is nothing to grandfather. A baseline here would only ever
 * be used to park a line somebody could not be bothered to shorten, and the
 * fix is always the same and always small: write one short sentence.
 *
 * Enable once per clone:  git config core.hooksPath .githooks
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'docs', 'HOLDING_LIST_CLASSIFICATION_2026-06-11.md');
const SECTION_TITLE = "FOR WAEL'S EYES";

// The summary ends where the governance rules begin. Anything after that
// heading is the detailed list and is not subject to these rules.
const SECTION_END = /^##\s+⭐⭐⭐\s+GOVERNANCE/m;

// A row in the summary: | **B12m** | Both | plain english | Full |
const SUMMARY_ROW = /^\|\s*\*\*((?:B|F|T|S|I)\d+[a-z]?)\*\*\s*\|([^|]*)\|([^|]*)\|/;

// A row in the detailed tables below: | B12m | title | surface | ... |
const DETAIL_ROW = /^\|\s*((?:B|F|T|S|I)\d+[a-z]?)\s*\|([^|]*)\|([^|]*)\|/;

// ── Platform column (Wael, 2026-08-31) ────────────────────────────────────
// Where you would meet the problem. Derived from the item's own Surface value
// below rather than typed independently, because two hand-maintained copies of
// one fact is the failure this whole file exists to prevent — see the four
// rows that were each wrong on the night it was written.
//
// Backend and Internal are deliberately NOT folded into 'Both', even though
// only three names were asked for. Calling a backend item 'Both' claims where
// fifteen items surface, which no row supports; Internal items (test tooling,
// unpromoted infrastructure) appear on neither the phone nor the app.
const PLATFORMS = new Set(['Voice', 'Mobile', 'Both', 'Backend', 'Internal']);

function platformForSurface(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (s.startsWith('infra') || s.startsWith('tooling')) return 'Internal';
  if (s.startsWith('backend')) return 'Backend';
  if (s === 'both') return 'Both';
  // "mobile (voice unverified)" is Mobile until voice is actually confirmed —
  // an unverified surface is not a second surface.
  if (s.includes('voice') && s.includes('mobile')) return s.includes('unverified') ? 'Mobile' : 'Both';
  if (s.startsWith('voice')) return 'Voice';
  if (s.startsWith('mobile')) return 'Mobile';
  return 'Backend';
}

// Sections below the summary that hold rows which are NOT open work.
const NON_OPEN_SECTION = /archive|closed|superseded/i;

// ── Format rules for a summary description ────────────────────────────────
// The cap is measured, not guessed. When this was written the longest of the
// 59 descriptions was 173 characters and the 90th percentile was 141. 240 is
// deliberately loose enough that no honest sentence hits it, and tight enough
// that a paragraph cannot hide. Three lines on screen, roughly.
const MAX_CHARS = 240;

const FORMAT_RULES = [
  { name: 'code formatting (backtick)', test: d => d.includes('`') },
  { name: 'a file path',                test: d => /[\w-]+\/[\w-]+|\.(ts|tsx|js|jsx|sql|json|md)\b/.test(d) },
  { name: 'a line reference',           test: d => /:\d{2,}/.test(d) },
  { name: `over ${MAX_CHARS} characters`, test: d => d.length > MAX_CHARS },
];

const stamp = new Date().toLocaleString('en-CA', {
  timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: 'numeric', minute: '2-digit', second: '2-digit',
});

console.log('');
console.log(`FOR WAEL'S EYES check — is the summary still a summary? ${stamp} EST`);
console.log('');

if (!fs.existsSync(FILE)) {
  console.log(`  ❌ Holding list not found at ${FILE}`);
  process.exit(1);
}

const text = fs.readFileSync(FILE, 'utf8');

// Fails closed. If the section has been deleted or renamed, that is not a
// reason to wave the push through — it is the loudest possible failure.
if (!text.includes(SECTION_TITLE)) {
  console.log(`  ❌ The "${SECTION_TITLE}" section is gone from the top of the holding list.`);
  console.log('');
  console.log('     It is the one view of this file Wael actually reads. If it needs to');
  console.log('     move or be renamed, update this script in the same commit.');
  process.exit(1);
}

const endMatch = text.match(SECTION_END);
if (!endMatch) {
  console.log('  ❌ Could not find the GOVERNANCE heading that ends the summary section.');
  console.log('     This script splits the file there; update it if the heading changed.');
  process.exit(1);
}

const head = text.slice(0, endMatch.index);
const bodyLines = text.slice(endMatch.index).split(/\r?\n/);
const headLines = head.split(/\r?\n/);

// ── Collect summary lines ─────────────────────────────────────────────────
const summary = [];
headLines.forEach((line, i) => {
  const m = line.match(SUMMARY_ROW);
  if (m) summary.push({ id: m[1], platform: m[2].trim(), desc: m[3].trim(), line: i + 1 });
});

// ── Collect open rows ─────────────────────────────────────────────────────
const open = [];
let section = '(before first heading)';
bodyLines.forEach((line, i) => {
  if (/^#{2,3}\s/.test(line)) { section = line.replace(/^#+\s*/, '').trim(); return; }
  if (NON_OPEN_SECTION.test(section)) return;
  const m = line.match(DETAIL_ROW);
  if (m) open.push({ id: m[1], surface: m[3].trim(), section, line: i + headLines.length });
});

const summaryIds = new Set(summary.map(s => s.id));
const openIds = new Set(open.map(o => o.id));

const missing = open.filter(o => !summaryIds.has(o.id));
const stale = summary.filter(s => !openIds.has(s.id));

// A duplicated summary line is its own problem — two lines for one item means
// one of them is being edited and the other is not.
const seen = new Map();
const duplicates = [];
for (const s of summary) {
  if (seen.has(s.id)) duplicates.push(s); else seen.set(s.id, s);
}

// ── Format violations ─────────────────────────────────────────────────────
const malformed = [];
for (const s of summary) {
  const broken = FORMAT_RULES.filter(r => r.test(s.desc)).map(r => r.name);
  if (broken.length) malformed.push({ ...s, broken });
}

// ── Platform must be a known value AND agree with the item's own Surface ──
// Checking agreement, not merely presence, is the point. A Platform column
// typed by hand would be a second copy of a fact that already exists below,
// and this file's own history says the second copy is the one that goes stale.
const surfaceById = new Map(open.map(o => [o.id, o.surface]));
const platformWrong = [];
for (const s of summary) {
  if (!surfaceById.has(s.id)) continue;           // already reported as stale
  const expected = platformForSurface(surfaceById.get(s.id));
  if (!PLATFORMS.has(s.platform)) {
    platformWrong.push({ ...s, expected, why: `"${s.platform}" is not one of ${[...PLATFORMS].join(' / ')}` });
  } else if (s.platform !== expected) {
    platformWrong.push({ ...s, expected, why: `says ${s.platform}, but its row's Surface is "${surfaceById.get(s.id)}" → ${expected}` });
  }
}

const problems = missing.length + stale.length + duplicates.length + malformed.length + platformWrong.length;

console.log(`  ${open.length} open item(s), ${summary.length} summary line(s)`);
console.log('');

if (!problems) {
  console.log('  Clean — every open item has one short, plain-English line, and');
  console.log('  every summary line still points at an open item.');
  console.log('');
  console.log('  Note: this proves the summary is READABLE, not that it is TRUE.');
  console.log('  Nothing mechanical can check the second one.');
  process.exit(0);
}

if (missing.length) {
  console.log(`  ❌ ${missing.length} open item(s) with no line in the summary:`);
  console.log('');
  for (const m of missing) console.log(`     ${m.id.padEnd(6)} in "${m.section}"`);
  console.log('');
  console.log('     Add one line each at the top: ID, plain English, three lines maximum.');
  console.log('     An item nobody summarised is an item Wael cannot review.');
  console.log('');
}

if (stale.length) {
  console.log(`  ❌ ${stale.length} summary line(s) pointing at an item that is no longer open:`);
  console.log('');
  for (const s of stale) console.log(`     ${s.id.padEnd(6)} summary line ${s.line}`);
  console.log('');
  console.log('     If the item closed, remove its summary line in the same commit that');
  console.log('     moved the row. A summary listing finished work is the T6 failure again.');
  console.log('');
}

if (duplicates.length) {
  console.log(`  ❌ ${duplicates.length} item(s) with more than one summary line:`);
  console.log('');
  for (const d of duplicates) console.log(`     ${d.id.padEnd(6)} duplicate at line ${d.line}`);
  console.log('');
  console.log('     Two lines for one item means one of them stops being maintained.');
  console.log('');
}

if (malformed.length) {
  console.log(`  ❌ ${malformed.length} summary line(s) have stopped being a summary:`);
  console.log('');
  for (const m of malformed) {
    console.log(`     ${m.id.padEnd(6)} line ${String(m.line).padEnd(4)} — ${m.broken.join(', ')}`);
  }
  console.log('');
  console.log('     This is the failure that killed every previous attempt at this section.');
  console.log('     Wael: "I asked that before, but they impeded in the long text."');
  console.log('');
  console.log('     The evidence belongs in the item\'s own row, where there is no limit.');
  console.log('     Up here: plain English, no code, no paths, no line numbers.');
  console.log('');
}

if (platformWrong.length) {
  console.log(`  ❌ ${platformWrong.length} summary line(s) with a Platform that does not match the item's own row:`);
  console.log('');
  for (const p of platformWrong) {
    console.log(`     ${p.id.padEnd(6)} line ${String(p.line).padEnd(4)} — ${p.why}`);
  }
  console.log('');
  console.log('     Platform is DERIVED from the row\'s Surface column, never typed twice.');
  console.log('     If the surface genuinely changed, change it in the row and here together.');
  console.log('');
}

console.log('  There is no baseline for this check, deliberately — the fix is always');
console.log('  one short sentence, and parking it would defeat the section.');
process.exit(1);
