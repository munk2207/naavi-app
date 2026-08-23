/**
 * orphan-item-check — finds work items that are written about but have no row.
 *
 * Wael, 2026-08-23: "build a check for items written about but not in the list."
 *
 * ── The failure it catches ─────────────────────────────────────────────────
 * An item becomes real the moment someone writes a paragraph about it. Nothing
 * checked that a thing being written about also had an entry in the inventory,
 * and on 2026-08-23 that gap surfaced four times in one session:
 *
 *   T3    ranked Tier 1 in the priority queue, referenced by the Architecture
 *         Reference twice — and in no table at all. Found by accident while
 *         archiving the queue.
 *   B4z   cited EIGHT times inside the shared Claude prompt as the authority
 *         for RULE 23, and named in CLAUDE.md as queued work. Tracked nowhere.
 *   S1    referenced by the Architecture Reference; no row.
 *   B10x  referenced by its own Phase 0 document; no row.
 *
 * The priority cap counts what IS in the table. It cannot see what is missing
 * from it. This check is the other direction.
 *
 * ── Why [[wiki-links]] and not every mention ───────────────────────────────
 * Measured before being written. Scanning bare tokens (`B10g`, `F5c`) across
 * docs and functions produced 216 orphans, almost all closed items legitimately
 * living in the closed archive, plus partial matches like `B10` inside `B10g`.
 * A check with that much noise gets switched off, which is worse than no check
 * because the absence then becomes invisible.
 *
 * `[[ID]]` is how this project deliberately cross-references an item. Requiring
 * both the wiki-link form AND the item-ID shape took it from 216 orphans to 2 —
 * and both of those were real.
 *
 * ── What it does NOT do ────────────────────────────────────────────────────
 * It cannot see an item written about WITHOUT a wiki-link — B4z was cited eight
 * times in the prompt as plain text and this check would not have caught it
 * there. It cannot tell whether a row is any good, current, or correctly
 * classified. It answers exactly one question: is this referenced ID absent
 * from both holding-list files?
 */

const fs = require('fs');
const path = require('path');

const REPO = process.cwd();
const SOURCES = [
  path.join(REPO, 'docs', 'HOLDING_LIST_CLASSIFICATION_2026-06-11.md'),
  path.join(REPO, 'docs', 'HOLDING_LIST_CLOSED_ARCHIVE_2026-07-28.md'),
];
const BASELINE = path.join(REPO, 'docs', 'orphan_item_known.json');

const SCAN_ROOTS = [
  path.join(REPO, 'docs'),
  path.join(REPO, 'supabase', 'functions'),
  path.join(REPO, 'naavi-voice-server', 'src'),
];
const SKIP_DIR = /^(node_modules|\.git|\.claude|dist|build|android|ios|tests)$/;
const WIKI = /\[\[([A-Za-z][A-Za-z0-9-]*)\]\]/g;
/** Item-ID shape: B/F/T/S/I + digits + optional letter, or the T2-F1 form. */
const SHAPE = /^(?:[BFTSI]\d{1,2}[a-z]?|T\d+-F\d+)$/;

/**
 * A nested checkout is not this repo, and must not be scanned.
 *
 * Found 2026-08-23 the hard way: a full 982 MB clone of this repository
 * appeared at `docs/Naavi/` — its own `.git`, the same remote, HEAD on a commit
 * made thirteen minutes earlier. The gate walked into it, read the COPY of the
 * holding list as an ordinary document rather than as a source of truth, and
 * reported five false orphans from wiki-links inside it.
 *
 * The check was right to fail; it was failing on rubbish. A gate that breaks
 * because a directory was copied somewhere is fragile, and fragile gates get
 * switched off. Anything carrying its own `.git` is a separate repository and
 * is skipped whole.
 */
function isNestedCheckout(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

function walk(dir, out = [], depth = 0) {
  if (depth > 6 || !fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.test(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (isNestedCheckout(f)) continue;
      walk(f, out, depth + 1);
    } else if (/\.(md|ts|js|tsx)$/.test(e.name)) {
      out.push(f);
    }
  }
  return out;
}

function main() {
  const present = SOURCES.filter((f) => fs.existsSync(f));
  if (present.length === 0) {
    console.error('Orphan item check could not run: no holding-list file found.');
    console.error('Failing closed — a gate that skips itself when it cannot check is not a gate.');
    return 2;
  }

  const known = new Set();
  for (const src of present) {
    for (const line of fs.readFileSync(src, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\|\s*([A-Za-z][A-Za-z0-9-]*)\s*\|/);
      if (m && m[1] !== 'ID') known.add(m[1]);
    }
  }

  const files = SCAN_ROOTS.flatMap((r) => walk(r)).filter((f) => !present.includes(f));
  const refs = new Map();
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const m of txt.matchAll(WIKI)) {
      const id = m[1];
      if (!SHAPE.test(id)) continue;
      if (!refs.has(id)) refs.set(id, new Set());
      refs.get(id).add(path.relative(REPO, f).replace(/\\/g, '/'));
    }
  }

  let accepted = new Set();
  if (fs.existsSync(BASELINE)) {
    const b = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    accepted = new Set(b.known || []);
  }

  const orphans = [...refs].filter(([id]) => !known.has(id)).sort();
  const fresh = orphans.filter(([id]) => !accepted.has(id));

  const stamp = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
  console.log(`Orphan item check — referenced but not in the list, ${stamp} EST`);
  console.log(`  ${files.length} files scanned, ${known.size} ids with a row, ${refs.size} referenced`);

  if (fresh.length) {
    console.error('');
    console.error(`  ${fresh.length} item(s) written about with NO row in either holding-list file:`);
    for (const [id, where] of fresh) {
      console.error(`     ${id.padEnd(8)} referenced in ${[...where].slice(0, 3).join(', ')}`);
    }
    console.error('');
    console.error('  Give it a row, or — if it is deliberately not tracked — record it:');
    console.error('     node scripts/orphan-item-check.js --write-baseline');
    return 1;
  }

  const carried = orphans.length;
  console.log(`  Clean — no NEW orphan${carried ? ` (${carried} already recorded)` : ''}.`);
  return 0;
}

function writeBaseline() {
  const present = SOURCES.filter((f) => fs.existsSync(f));
  const known = new Set();
  for (const src of present) {
    for (const line of fs.readFileSync(src, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\|\s*([A-Za-z][A-Za-z0-9-]*)\s*\|/);
      if (m && m[1] !== 'ID') known.add(m[1]);
    }
  }
  const files = SCAN_ROOTS.flatMap((r) => walk(r)).filter((f) => !present.includes(f));
  const refs = new Set();
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(WIKI)) {
      if (SHAPE.test(m[1]) && !known.has(m[1])) refs.add(m[1]);
    }
  }
  const out = {
    note: 'Item IDs referenced with [[wiki-links]] that deliberately have no row in either '
        + 'holding-list file. Every entry needs a reason. The check fails on anything NOT listed here.',
    captured: new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' }) + ' EST',
    known: [...refs].sort(),
  };
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
  console.log(`Baseline written: ${out.known.length} accepted orphan(s) — ${out.known.join(', ') || 'none'}`);
  return 0;
}

process.exit(process.argv.includes('--write-baseline') ? writeBaseline() : main());
