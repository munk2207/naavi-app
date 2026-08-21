#!/usr/bin/env node
/**
 * T4 — staging/production drift check. READ-ONLY.
 *
 * Run: npm run drift:check
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Staging is not a copy of production. It is a reconstruction from the
 * migration files, so it contains what those files describe and nothing else.
 * Wael found this by calling both lines within a minute of each other and
 * getting different behaviour.
 *
 * Measuring it once was the easy part. On 2026-08-20 a name-level comparison
 * reported 14 differences and a definition-level one reported 184 — because an
 * object can exist in both environments, under the same name, and still behave
 * differently. Two of those were live staging failures: staging rejected the
 * 'calendar' document type that CLAUDE.md documents as valid, and rejected
 * every ticket raised from the website.
 *
 * The measurement is worthless without something that re-runs it. Four separate
 * times in one session we found knowledge written down correctly with nothing
 * mechanically enforcing it — a stale architecture document, an unbumped
 * version line, a missing-table warning in every test run, and a "STAGING ONLY"
 * comment that `db push` does not read. This file is the forcing function for
 * environment parity. Make it refuse, don't make it warn.
 *
 * ---------------------------------------------------------------------------
 * HOW IT DECIDES
 *
 * Every difference known on the day the baseline was taken is recorded in
 * docs/T4_accepted_differences.json and is NOT a failure. The check fails on
 * differences that are NEW since then — the two environments separating
 * further. It also reports differences that have gone away, so the baseline can
 * be tightened as T4's remaining passes land.
 *
 * Three categories, and they do not mean the same thing:
 *
 *   missing      production has it, staging does not — the real T4 gap, the
 *                reconstruction being incomplete.
 *   staging-only staging has it, production does not — usually work that has
 *                not been promoted yet. S1 is exactly this and is correct.
 *   differing    present in both, defined differently — the dangerous one. It
 *                looks identical in any name-level check and behaves
 *                differently at runtime.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT NEEDS
 *
 *   STAGING_DB_URL in tests/.env (gitignored) — staging's Postgres connection
 *   string. Read-only use; every statement in the fingerprint is a SELECT.
 *
 * Production comes from the snapshot in docs/T4_fingerprint_production.json
 * rather than a live connection, deliberately. Under staging-first, production
 * only changes when Wael says so, so a snapshot refreshed at those moments is
 * enough and needs no production credentials stored anywhere. Refresh it by
 * running docs/T4_SCHEMA_FINGERPRINT.sql in production's SQL editor and saving
 * the result — and note that the extension version (pg_net today) can move on
 * its own when Supabase upgrades it.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const REPO = path.resolve(__dirname, '..');
const PROD_SNAPSHOT = path.join(REPO, 'docs', 'T4_fingerprint_production.json');
const FINGERPRINT_SQL = path.join(REPO, 'docs', 'T4_SCHEMA_FINGERPRINT.sql');
const BASELINE = path.join(REPO, 'docs', 'T4_accepted_differences.json');
const ENV_FILE = path.join(REPO, 'tests', '.env');

// ── Noise that is not drift ────────────────────────────────────────────────

// pgvector and pg_trgm ship hundreds of functions. 118 of an apparent 207
// "missing" functions were exactly this on 2026-08-20. Real project functions
// missing: zero. Excluded so the number means something.
// l1_distance / hamming_distance / jaccard_distance were added 2026-08-20:
// they are pgvector's, not ours, and were sitting in "missing from staging"
// looking like five of our own functions had gone astray. Only NINE
// non-extension functions exist at all, so five of them being noise was most
// of the category.
const EXTENSION_FN = /^(vector|halfvec|sparsevec|ivfflat|hnsw|l1_distance|l2_|hamming_distance|jaccard_distance|inner_|cosine_|binary_quantize|subvector|array_to_|avg|sum|similarity|show_trgm|word_similarity|strict_word|set_limit|show_limit|gtrgm|gin_|gbt_|uuid_|pgp_|armor|dearmor|crypt|gen_salt|digest|hmac|encrypt|decrypt|pg_stat|algorithm_sign|sign|try_cast|url_|verify|http)/i;

const PROJECT_REFS = /hhgyppbxgmjrwdpdubcx|xugvnfudofuskxoknhve/g;

/**
 * JSON.stringify preserves key insertion order, so two objects with identical
 * content serialise differently if their keys were written in a different
 * order — and this comparison is string-based. Sorting keys removes a whole
 * class of false difference that has nothing to do with either database.
 *
 * Added 2026-08-20 after three cron jobs reported as drift because a snapshot
 * was written {active, schedule, command} while the fingerprint query emits
 * {schedule, active, command}. Same crons, same schedules, same commands.
 */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort()
    .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k]))
    .join(',') + '}';
}

function normalise(v) {
  return stableStringify(v)
    .replace(PROJECT_REFS, 'PROJECT_REF')
    // Both key formats collapse to ONE placeholder. A service-role key differs
    // between environments by design, and the FORMAT differs too: Supabase
    // rotated staging's to the new sb_secret_ style while production still
    // carries the old eyJ… JWT. Mapping them to different placeholders made
    // four cron jobs report as drift for having the right key in the right
    // environment.
    .replace(/eyJ[A-Za-z0-9_.\-]{20,}/g, 'SERVICE_KEY')
    .replace(/sb_secret_[A-Za-z0-9_\-]+/g, 'SERVICE_KEY')
    // Escaped line breaks INSIDE the stringified value. Production's cron
    // commands carry \r\n and staging's carry \n — identical instructions typed
    // on different machines. Collapsing \s+ does not touch these, because after
    // JSON.stringify they are the two literal characters backslash-n, not
    // whitespace. Ten cron jobs looked like drift until this line existed,
    // which is precisely how a real difference gets buried.
    .replace(/\\r\\n|\\r|\\n|\\t/g, ' ')
    .replace(/\s+/g, ' ')
    // Spacing around punctuation. Postgres stores a function or constraint
    // exactly as it was typed, so "AND (x IS NULL" and "AND ( x IS NULL" are
    // reported as different definitions while being the same instruction.
    // try_enter_geofence — the geofence dwell logic — sat in the differences
    // list all day on the strength of ONE space after a bracket. Four separate
    // false alarms came from formatting on 2026-08-20, and each one buried the
    // real findings underneath it. The point of this check is that a failure
    // means something; noise of this kind is what turns a gate into wallpaper.
    .replace(/\s*([(),;])\s*/g, '$1')
    // A trailing semicolon on a SQL statement changes nothing. cleanup-old-emails
    // differed between the environments on exactly that, and nothing else.
    .replace(/;+(["'\\]*)\s*$/, '$1')
    .trim();
}

// ── Loading ────────────────────────────────────────────────────────────────

function readEnvVar(name) {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(ENV_FILE)) return null;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

function loadProduction() {
  const raw = JSON.parse(fs.readFileSync(PROD_SNAPSHOT, 'utf8'));
  // The saved SQL-editor result nests the value one level down.
  const inner = raw['0'] || raw;
  return typeof inner.fingerprint === 'string' ? JSON.parse(inner.fingerprint) : inner;
}

async function loadStaging(dbUrl) {
  const sql = fs.readFileSync(FINGERPRINT_SQL, 'utf8');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const res = await client.query(sql);
    return JSON.parse(res.rows[0].fingerprint);
  } finally {
    await client.end();
  }
}

// ── Comparison ─────────────────────────────────────────────────────────────

function compare(prod, stag) {
  const sections = [...new Set([...Object.keys(prod), ...Object.keys(stag)])].sort();
  const out = {};
  for (const name of sections) {
    const p = prod[name] || {};
    const s = stag[name] || {};
    let keysP = Object.keys(p);
    let keysS = Object.keys(s);
    if (name === 'functions') {
      keysP = keysP.filter(k => !EXTENSION_FN.test(k));
      keysS = keysS.filter(k => !EXTENSION_FN.test(k));
    }
    const setP = new Set(keysP);
    const setS = new Set(keysS);
    out[name] = {
      missing: keysP.filter(k => !setS.has(k)).sort(),
      extra: keysS.filter(k => !setP.has(k)).sort(),
      differing: keysP.filter(k => setS.has(k) && normalise(p[k]) !== normalise(s[k])).sort(),
    };
  }
  return out;
}

const CATEGORIES = ['missing', 'extra', 'differing'];
const LABEL = { missing: 'missing from staging', extra: 'staging-only', differing: 'defined differently' };

// ── Main ───────────────────────────────────────────────────────────────────

(async () => {
  const writeBaseline = process.argv.includes('--write-baseline');

  const dbUrl = readEnvVar('STAGING_DB_URL');
  if (!dbUrl) {
    console.error('STAGING_DB_URL is not set. Add it to tests/.env (gitignored).');
    console.error('It is staging\'s Postgres connection string; this check only reads.');
    process.exit(2);
  }

  const prod = loadProduction();
  const stag = await loadStaging(dbUrl);
  const current = compare(prod, stag);

  const now = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });

  if (writeBaseline) {
    fs.writeFileSync(BASELINE, JSON.stringify({
      note: 'Differences known and accepted as of the capture below. The check fails on anything NEW. Regenerate with: npm run drift:check -- --write-baseline',
      captured: `${now} EST`,
      accepted: current,
    }, null, 2) + '\n');
    const total = Object.values(current).reduce((n, r) => n + r.missing.length + r.extra.length + r.differing.length, 0);
    console.log(`Baseline written: ${total} accepted differences, ${now} EST`);
    return;
  }

  if (!fs.existsSync(BASELINE)) {
    console.error('No baseline. Create one with: npm run drift:check -- --write-baseline');
    process.exit(2);
  }
  const accepted = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).accepted;

  const newOnes = [];
  const resolved = [];
  for (const section of Object.keys(current)) {
    for (const cat of CATEGORIES) {
      const acc = new Set(((accepted[section] || {})[cat]) || []);
      const cur = new Set(current[section][cat]);
      for (const k of cur) if (!acc.has(k)) newOnes.push({ section, cat, key: k });
      for (const k of acc) if (!cur.has(k)) resolved.push({ section, cat, key: k });
    }
  }

  console.log(`T4 drift check — staging vs production, ${now} EST\n`);

  if (resolved.length) {
    console.log(`${resolved.length} accepted difference(s) no longer present — T4 progress:`);
    for (const r of resolved.slice(0, 20)) console.log(`   ✓ ${r.section}: ${r.key}  (${LABEL[r.cat]})`);
    if (resolved.length > 20) console.log(`   … and ${resolved.length - 20} more`);
    console.log('   Re-baseline once these are intended to stay closed:');
    console.log('     npm run drift:check -- --write-baseline\n');
  }

  if (!newOnes.length) {
    console.log('No new drift. Staging and production have not separated further.');
    return;
  }

  console.log(`DRIFT CHECK FAILED — ${newOnes.length} new difference(s) since the baseline:\n`);
  for (const n of newOnes) {
    console.log(`   ✗ ${n.section}: ${n.key}`);
    console.log(`     ${LABEL[n.cat]}`);
  }
  console.log('\nEither fix it, or — if the difference is deliberate, such as work');
  console.log('that is on staging and not yet promoted — record it:');
  console.log('  npm run drift:check -- --write-baseline');
  process.exit(1);
})().catch(e => {
  console.error('Drift check could not run: ' + e.message);
  process.exit(2);
});
