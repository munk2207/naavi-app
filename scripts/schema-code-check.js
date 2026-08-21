#!/usr/bin/env node
/**
 * Does deployed code reference database columns that do not exist?
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The drift check (scripts/t4-drift-check.js) compares the two databases TO
 * EACH OTHER. Nothing compared either database TO THE CODE. On 2026-08-21 a
 * manual sweep for exactly that found THREE live defects, all sitting
 * undifferentiated in the same list, none of which looked urgent:
 *
 *   twilio_from_number              armed but not yet fired — the next deploy
 *                                   of evaluate-rules or check-reminders would
 *                                   have stopped every alert and reminder
 *   knowledge_fragments.updated_at  ALREADY FIRING for eight days — every
 *                                   correction to an existing memory was lost
 *   azure_voice_profile_id          reachable by saying "set up my voice ID" —
 *                                   a three-step enrolment whose result the
 *                                   database silently discarded
 *
 * Two of the three had been described, by the person doing the triage, as
 * "misc columns and indexes".
 *
 * ── Why the failure is always total and always silent ──────────────────────
 * PostgREST rejects the ENTIRE statement when one selected or written column is
 * missing (Postgres 42703). Not a partial result — nothing. And because most
 * call sites treat an error as "no data", the caller sees an empty answer
 * rather than a failure. That is the same mechanism as B11c, where one missing
 * column made staging replay a 30-second uninterruptible greeting on every
 * call.
 *
 * ── What this checks, precisely ────────────────────────────────────────────
 * Column references it can resolve statically:
 *   - PostgREST URLs:        `rest/v1/<table>?select=a,b,c`   and `&col=eq.x`
 *   - supabase-js reads:     `.from('<table>')` … `.select('a, b, c')`
 *   - supabase-js writes:    `.update({ a: …, b: … })` with an INLINE literal
 *
 * ── What it deliberately does NOT do ───────────────────────────────────────
 * `.insert(payload)` where `payload` is a variable is NOT resolved. Following
 * that would need real type analysis, and a check that guesses produces false
 * alarms — and a gate that cries wolf gets switched off, which is worse than no
 * gate. This finds the class that has actually bitten, three times, and says
 * plainly what it cannot see.
 *
 * ── Sources of truth ───────────────────────────────────────────────────────
 * Staging:    live, via STAGING_DB_URL in tests/.env
 * Production: docs/T4_fingerprint_production.json — the same snapshot the drift
 *             check uses, and subject to the same caveat: production moving is
 *             invisible until someone recaptures it.
 *
 * Exit 1 if any reference resolves to a column that does not exist in the
 * target. Fails closed: if it cannot read either source, it refuses rather than
 * passing.
 *
 * Usage:
 *   node scripts/schema-code-check.js              # both environments
 *   node scripts/schema-code-check.js --production # production only
 */

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const ENV_FILE = path.join(REPO, 'tests', '.env');
const PROD_SNAPSHOT = path.join(REPO, 'docs', 'T4_fingerprint_production.json');
const SCAN_DIRS = ['supabase/functions', 'naavi-voice-server/src', 'lib', 'hooks'];

// Paths whose schema references are known-unreachable and would be noise.
// Each needs a REASON, not just a name — an unexplained exclusion is how a gate
// quietly stops covering the thing it was built for.
const EXCLUDE = [
  { match: /[/\\]epic[/\\]|epic\.ts|azure-speaker\.js/i,
    why: 'Epic and Azure voice are retired and gated off (T8, T9); their schema is deliberately absent from production' },
  { match: /[/\\]_shared[/\\]institutional_domains\.ts$/i,
    why: 'a domain list, no database access' },
  { match: /\.test\.(js|ts)$/i, why: 'tests' },
];

const est = () => new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });

function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** Every file under SCAN_DIRS, minus the excluded paths. */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!/\.(ts|js|tsx)$/.test(e.name)) continue;
      const rel = path.relative(REPO, p).replace(/\\/g, '/');
      if (EXCLUDE.some((x) => x.match.test(rel))) continue;
      out.push({ abs: p, rel });
    }
  };
  for (const d of SCAN_DIRS) walk(path.join(REPO, d));
  return out;
}

const NOT_A_COLUMN = /^(\*|count|and|or|not|is|eq|neq|gt|gte|lt|lte|like|ilike|in|cs|cd|null|true|false|\d+)$/i;

/**
 * Split a PostgREST select list into columns of the OUTER table only.
 *
 * Embedded resources must be removed BEFORE splitting on commas, not filtered
 * out afterwards. `email_action:email_actions(vendor, summary, reference)`
 * splits into `email_action:email_actions(vendor`, ` summary`, ` reference)` —
 * and the middle one looks exactly like a plain column. That leak is what made
 * the first version of this check report `documents.summary` and
 * `list_connections.name`, neither of which the code ever asked for: they are
 * columns of the EMBEDDED table. Strip the nested groups whole, innermost
 * first, then split.
 */
function columnsFromSelect(spec) {
  let s = spec;
  let prev;
  do {                                    // innermost-first, until stable
    prev = s;
    s = s.replace(/[a-z_][a-z0-9_]*\s*\([^()]*\)/gi, '');
  } while (s !== prev);

  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && !x.includes('(') && !x.includes(')'))
    .map((x) => (x.includes(':') ? x.split(':').pop() : x))   // alias:col
    .map((x) => x.trim())
    .filter((x) => /^[a-z_][a-z0-9_]*$/i.test(x) && !NOT_A_COLUMN.test(x));
}

/** Every (table, column, file, line) reference this can resolve statically. */
function extractReferences(files) {
  const refs = [];
  const add = (table, col, f, idx, how) => {
    if (!table || !col || NOT_A_COLUMN.test(col)) return;
    refs.push({ table, col, file: f.rel, line: idx + 1, how });
  };

  for (const f of files) {
    const src = fs.readFileSync(f.abs, 'utf8');
    const lines = src.split('\n');

    // ── PostgREST URLs ────────────────────────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const url = line.match(/rest\/v1\/([a-z_][a-z0-9_]*)\?([^`'"\s]+)/i);
      if (url) {
        const table = url[1];
        const qs = url[2];
        const sel = qs.match(/select=([^&`'"]+)/i);
        if (sel) for (const c of columnsFromSelect(sel[1])) add(table, c, f, i, 'select=');
        // filters: &col=eq.x  — but not the PostgREST operators themselves
        for (const m of qs.matchAll(/[&?]([a-z_][a-z0-9_]*)=(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|not)\./gi)) {
          add(table, m[1], f, i, 'filter');
        }
      }
    }

    // ── supabase-js: .from('x') then .select(...) / .update({...}) ────────
    for (let i = 0; i < lines.length; i++) {
      const from = lines[i].match(/\.from\(\s*['"`]([a-z_][a-z0-9_]*)['"`]\s*\)/i);
      if (!from) continue;
      const table = from[1];

      // The window must stop at the END OF THIS STATEMENT, not after a fixed
      // number of lines. A greedy window attaches the NEXT query's .select() to
      // THIS query's table — the first version of this check produced 95
      // findings that way, nearly all of them a `tickets` column blamed on
      // `support_staff` because the two queries sat twelve lines apart. A gate
      // that cries wolf gets switched off, which is worse than no gate.
      //
      // The statement ends at the first `;` after the chain starts, or at the
      // next `.from(`, whichever comes first.
      let end = i;
      for (let k = i; k < Math.min(i + 25, lines.length); k++) {
        if (k > i && /\.from\(\s*['"`]/.test(lines[k])) break;
        end = k;
        if (/;\s*$/.test(lines[k].trim())) break;
      }
      const window = lines.slice(i, end + 1).join('\n');

      for (const m of window.matchAll(/\.select\(\s*['"`]([^'"`]+)['"`]/g)) {
        for (const c of columnsFromSelect(m[1])) add(table, c, f, i, '.select()');
      }
      // .update({ a: ..., b: ... }) — inline literals only, by design
      for (const m of window.matchAll(/\.update\(\s*\{([^}]*)\}/g)) {
        for (const kv of m[1].split(',')) {
          const k = kv.split(':')[0].trim().replace(/['"`]/g, '');
          if (/^[a-z_][a-z0-9_]*$/i.test(k)) add(table, k, f, i, '.update()');
        }
      }
      for (const m of window.matchAll(/\.(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains)\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/gi)) {
        add(table, m[1], f, i, 'filter');
      }
    }
  }
  return refs;
}

async function stagingSchema(env) {
  if (!env.STAGING_DB_URL) return null;
  const { Client } = require('pg');
  const c = new Client({ connectionString: env.STAGING_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(
    `select table_name, column_name from information_schema.columns where table_schema='public'`);
  await c.end();
  const map = new Map();
  for (const row of r.rows) {
    if (!map.has(row.table_name)) map.set(row.table_name, new Set());
    map.get(row.table_name).add(row.column_name);
  }
  return map;
}

function productionSchema() {
  if (!fs.existsSync(PROD_SNAPSHOT)) return null;
  const raw = JSON.parse(fs.readFileSync(PROD_SNAPSHOT, 'utf8'));
  const fp = JSON.parse((raw['0'] || raw).fingerprint);
  const map = new Map();
  for (const key of Object.keys(fp.columns || {})) {
    const [t, c] = key.split('.');
    if (!map.has(t)) map.set(t, new Set());
    map.get(t).add(c);
  }
  return map;
}

function check(label, schema, refs, baseline, out) {
  const missing = [];
  const seen = new Set();
  for (const r of refs) {
    // A table absent from the schema is out of scope here: it may be a view, a
    // cron/auth table, or simply not captured by the snapshot. This check is
    // about columns on tables we DO know, which is where the damage has been.
    const cols = schema.get(r.table);
    if (!cols) continue;
    if (cols.has(r.col)) continue;
    const key = `${r.table}.${r.col}@${r.file}:${r.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    missing.push(r);
  }
  for (const m of missing) out.push(m);
  const fresh = missing.filter((m) => !baseline.has(keyOf(m)));
  const known = missing.length - fresh.length;

  if (!fresh.length) {
    console.log(`  ${label}: clean${known ? ` (${known} known finding${known > 1 ? 's' : ''}, already recorded)` : ''}.`);
    return 0;
  }
  console.log(`\n  ${label} — ${fresh.length} NEW reference(s) to columns that DO NOT EXIST:\n`);
  for (const m of fresh) {
    console.log(`     ✗ ${m.table}.${m.col}`);
    console.log(`         ${m.file}:${m.line}  (${m.how})`);
  }
  console.log(`
     PostgREST fails the WHOLE statement when one column is missing, and most
     call sites read that as "no data" rather than as an error. Expect silence,
     not a crash.

     Either add the column to that environment, or stop the code reaching it.`);
  return fresh.length;
}

// ── Baseline ───────────────────────────────────────────────────────────────
// Known findings, so this gate fails on NEW ones rather than on the backlog it
// inherited. Same pattern, and the same reasoning, as the drift check's
// accepted differences: a gate that fails from the day it is installed is a
// gate someone disables within a week.
//
// A baseline entry is NOT a dismissal. Every line in it is a real defect with
// a real consequence — see the work item recorded alongside it.
const BASELINE_FILE = path.join(REPO, 'docs', 'schema_code_known_findings.json');
// Deliberately WITHOUT the line number. The first version keyed on file:line
// and went red the moment a comment was added above a known finding — 54 lines
// of explanation shifted every entry and the gate reported them all as new.
// A finding is "this file references this missing column", which does not stop
// being true because something moved. Keying on the line number made the
// baseline decay on every unrelated edit, which is the cry-wolf failure this
// check was explicitly built to avoid.
const keyOf = (m) => `${m.table}.${m.col}@${m.file}`;

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).known || []);
}

function writeBaseline(keys) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify({
    note: 'Known schema/code mismatches. Each is a REAL defect, not a dismissal — '
        + 'the gate fails on NEW ones so it is not permanently red from day one. '
        + 'Written by scripts/schema-code-check.js --write-baseline.',
    written: est() + ' EST',
    known: [...keys].sort(),
  }, null, 2) + '\n');
}

(async () => {
  const onlyProd = process.argv.includes('--production');
  const writing = process.argv.includes('--write-baseline');
  console.log(`\nSchema/code check — does the code reference columns that exist? ${est()} EST\n`);

  const env = readEnv();
  const files = sourceFiles();
  const refs = extractReferences(files);
  console.log(`  scanned ${files.length} files, resolved ${refs.length} column references\n`);

  const prod = productionSchema();
  if (!prod) {
    console.error('  REFUSING: production snapshot missing (docs/T4_fingerprint_production.json).');
    process.exit(1);
  }
  const baseline = writing ? new Set() : loadBaseline();
  const found = [];
  let bad = check('PRODUCTION', prod, refs, baseline, found);

  if (!onlyProd) {
    const stg = await stagingSchema(env);
    if (!stg) {
      console.error('\n  REFUSING: STAGING_DB_URL is not set in tests/.env, so staging cannot be checked.');
      console.error('  A check that skips itself when unconfigured is not a check.');
      process.exit(1);
    }
    bad += check('STAGING   ', stg, refs, baseline, found);
  }

  if (writing) {
    const keys = new Set(found.map(keyOf));
    writeBaseline(keys);
    console.log(`\n  Baseline written: ${keys.size} known finding(s).`);
    console.log('  Each is a REAL defect, recorded so this gate fails on NEW ones');
    console.log('  rather than staying permanently red over an inherited backlog.\n');
    return;
  }
  if (bad) {
    console.log(`\n  FAILED — ${bad} NEW reference(s) point at columns that are not there.\n`);
    console.log('  If the reference is deliberate and understood, record it:');
    console.log('    node scripts/schema-code-check.js --write-baseline\n');
    process.exit(1);
  }
  console.log('\n  Clean — no NEW schema/code mismatch.\n');
})().catch((e) => { console.error('  REFUSING: ' + e.message); process.exit(1); });
