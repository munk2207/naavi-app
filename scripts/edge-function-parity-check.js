#!/usr/bin/env node
/**
 * T12 — Voice Edge Function parity check.
 *
 *   npm run parity:check                    fast tripwire, bound to pre-push
 *   npm run parity:verify                   AUTHORITATIVE, downloads real source
 *   npm run parity:verify -- --write-baseline   record deliberate differences
 *
 * ---------------------------------------------------------------------------
 * THE QUESTION THIS ANSWERS
 *
 * Wael, 2026-08-21: "Two environments only have value if you can START from a
 * state where they are equal. Change staging, test, promote, return to equal.
 * If you cannot start from equilibrium, staging is not a rehearsal of
 * production — it is a second system, and 'validated on staging' means nothing
 * about production."
 *
 * The voice server calls 32 Supabase Edge Functions. Those functions live in a
 * different repository from the voice server, so merging `staging` -> `main`
 * moves none of them. Nothing ever compared them between the two projects.
 *
 * ---------------------------------------------------------------------------
 * TWO MODES, BECAUSE ONE THING CANNOT BE BOTH FAST AND AUTHORITATIVE
 *
 *   check    Compares the manifest the deploy wrapper writes. Seconds. Bound to
 *            pre-push. A TRIPWIRE — it can catch divergence, it can never
 *            demonstrate equality, because it records only what the wrapper
 *            believes it deployed and anyone using the raw CLI bypasses it.
 *
 *   verify   Downloads the deployed source from BOTH projects and diffs it.
 *            Minutes. On demand, and before any promotion. THE ONLY
 *            AUTHORITATIVE ANSWER. Rewrites the manifest from reality rather
 *            than trusting it.
 *
 * T12 Phase 3, mandatory change 2: "The manifest cannot itself be called proof
 * of equilibrium. parity:verify, which downloads and compares actual deployed
 * source, is the authoritative evidence." Voice Staging = Voice Production may
 * be claimed on a passing `verify` and on nothing else.
 *
 * Why `verify` is not on pre-push: 32 functions across 2 projects. A ten-minute
 * pre-push hook gets disabled by the first person it inconveniences, and a
 * disabled gate is worse than no gate.
 *
 * ---------------------------------------------------------------------------
 * TWO COMPARATORS THAT LOOK RIGHT AND ARE NOT — DO NOT REINTRODUCE EITHER
 *
 *   ezbr_sha256 from `supabase functions list` is NOT a hash of the function
 *   source. On 2026-08-21 it reported 20 differences across the voice boundary;
 *   downloading and diffing the actual source showed 15 of those were
 *   BYTE-IDENTICAL on production, staging and in the repository. Three separate
 *   claims were built on it and all three were false.
 *
 *   Deploy timestamps prove nothing here, because in this project code is
 *   DEPLOYED BEFORE IT IS COMMITTED. A deploy predating the commit that fixed
 *   something is the normal order, not evidence of staleness. That reasoning
 *   produced a fourth false claim the same day.
 *
 * This is the third time a parity comparison in this project has been
 * confidently wrong (Architecture Reference 0c records the other two: raw-
 * hashed function bodies where one space made identical functions differ, and
 * truncated cron commands). Hence the normalization below, and hence `verify`
 * reading real source instead of any metadata field.
 *
 * ---------------------------------------------------------------------------
 * SCOPE — 32 VOICE FUNCTIONS, ENFORCED. NOT THE OTHER 50.
 *
 * Wael, 2026-08-21: "I would not gate all 82 in T12. Reporting the other 50 is
 * acceptable if essentially free, but T12 must not drift into solving non-Voice
 * parity."
 *
 * Reporting the other 50 was considered and DELIBERATELY OMITTED. The only
 * comparator cheap enough to make it free is ezbr_sha256 — the field proven
 * above to be wrong. Reporting 50 functions through a broken comparator would
 * manufacture exactly the false drift this file exists to eliminate. Free and
 * wrong is not free.
 *
 * The boundary is derived live from naavi-voice-server/src rather than hardcoded,
 * so a function the voice server starts calling is covered without anyone
 * remembering to add it here.
 */

const { execSync, execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const VOICE_SRC = path.join(REPO, 'naavi-voice-server', 'src');
const BASELINE = path.join(REPO, 'docs', 'T12_accepted_function_differences.json');
const MANIFEST = path.join(REPO, 'docs', 'T12_function_parity_manifest.json');

const PROJECTS = {
  staging:    'xugvnfudofuskxoknhve',
  production: 'hhgyppbxgmjrwdpdubcx',
};

const DOWNLOAD_CONCURRENCY = 4;

function estNow() {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
}

/* ── The voice boundary ─────────────────────────────────────────────────────
 * Every Edge Function the voice server actually calls. Derived from real call
 * sites — `${SUPABASE_URL}/functions/v1/<slug>` — and NOT from searching for
 * the slug as a string anywhere in the file.
 *
 * That distinction cost a correction during T12 Phase 1: a loose string match
 * reported 39 functions, seven of which were slugs appearing in COMMENTS
 * (naavi-chat, sync-gmail, text-to-speech, evaluate-rules, trigger-morning-call,
 * assistant-fulfillment, extract-email-actions). The strict match gives 32.
 */
function voiceBoundary() {
  if (!fs.existsSync(VOICE_SRC)) {
    console.error('naavi-voice-server/src not found. The voice boundary cannot be derived,');
    console.error('so this check cannot know what it is meant to be comparing. Failing closed.');
    process.exit(2);
  }
  const slugs = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.(js|ts|mjs|cjs)$/.test(e.name)) {
        const text = fs.readFileSync(p, 'utf8');
        for (const m of text.matchAll(/functions\/v1\/([a-z0-9-]+)/g)) slugs.add(m[1]);
      }
    }
  };
  walk(VOICE_SRC);
  return [...slugs].sort();
}

/* ── Normalization ──────────────────────────────────────────────────────────
 * Formatting alone must never register as drift. See the header: raw hashing
 * has already produced false drift in this project once.
 */
function normalize(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '\n');
}

function hashDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = [];
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, prefix + e.name + '/');
      else files.push([prefix + e.name, fs.readFileSync(p, 'utf8')]);
    }
  };
  walk(dir, '');
  if (!files.length) return null;
  const h = crypto.createHash('sha256');
  for (const [name, body] of files) h.update(name + '\0' + normalize(body) + '\0');
  return h.digest('hex');
}

/**
 * Windows note: Node 18.20+/20.12+ refuses to spawn a .cmd without a shell
 * (CVE-2024-27980), and `npx` on Windows IS npx.cmd — so execFile without
 * shell:true fails with EINVAL before the CLI ever runs. Shell quoting is safe
 * here because `slug` is matched from /[a-z0-9-]+/ and `ref` comes from the
 * fixed PROJECTS map; neither can carry a shell metacharacter.
 */
function downloadOne(slug, ref, destRoot) {
  return new Promise((resolve) => {
    const dest = path.join(destRoot, ref);
    fs.mkdirSync(dest, { recursive: true });
    execFile(
      `npx --yes supabase@latest functions download ${slug} --project-ref ${ref}`,
      { cwd: dest, timeout: 180_000, shell: true },
      (err) => resolve(err ? null : path.join(dest, 'supabase', 'functions', slug)),
    );
  });
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

/* ── The invariant that replaces a structural protection ────────────────────
 * Before T12, production was protected two ways at once: it did not have the
 * outbound guard code, AND it did not have the allowlist secret. After T12
 * deploys the guard, only the second remains.
 *
 * That is the guard's own stated design (_shared/outbound_guard.ts: "even if
 * this code were deployed to production, every call would fall through to
 * existing behavior"), so it is not a regression. But it converts a structural
 * property into a configuration invariant, and an invariant nothing checks is
 * a comment. If OUTBOUND_ALLOWLIST is ever set on production, every outbound
 * send starts being filtered against it — silent alert loss, which is the
 * worst failure mode this product has.
 */
function assertAllowlistUnsetOnProduction() {
  let raw;
  try {
    raw = execSync(
      `npx --yes supabase@latest secrets list --project-ref ${PROJECTS.production}`,
      { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 },
    );
  } catch (e) {
    console.error('Could not read production secrets, so the OUTBOUND_ALLOWLIST invariant');
    console.error('could not be checked. Failing closed rather than assuming.');
    console.error('  ' + (e.message || '').split('\n')[0]);
    process.exit(2);
  }

  if (/OUTBOUND_ALLOWLIST/.test(raw)) {
    console.error('');
    console.error('FAILED — OUTBOUND_ALLOWLIST is set on PRODUCTION.');
    console.error('');
    console.error('  That secret is what makes the outbound guard enforce. It belongs on');
    console.error('  staging only. With it set on production, every SMS, email and push');
    console.error('  is filtered against an allowlist, and anything not on that list is');
    console.error('  silently dropped. Alerts would stop arriving with no error anywhere.');
    console.error('');
    console.error('  Remove it from the production project before doing anything else.');
    console.error('');
    process.exit(1);
  }
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
}

function writeBaseline(differing, oneSided) {
  const accepted = {};
  for (const slug of differing) accepted[slug] = 'RECORDED WITHOUT A REASON — replace this text with why this difference is deliberate, or resolve it.';
  for (const [slug, where] of oneSided) accepted[slug] = `Present only on ${where}. RECORDED WITHOUT A REASON — replace this text.`;
  fs.writeFileSync(BASELINE, JSON.stringify({
    note: 'Deliberate differences between the two Supabase projects, across the voice boundary. Every entry needs a written reason. The check fails on anything NOT listed here. Regenerate with: npm run parity:verify -- --write-baseline',
    captured: `${estNow()} EST`,
    accepted,
  }, null, 2) + '\n');
  console.log(`\nBaseline written: ${Object.keys(accepted).length} accepted difference(s).`);
  console.log('Each entry says "RECORDED WITHOUT A REASON" — replace those with real reasons.');
  console.log('A baseline of unexplained entries is a list of things nobody decided.');
}

/* ── verify: the authoritative comparison ───────────────────────────────── */
async function runVerify(wantBaseline) {
  const slugs = voiceBoundary();
  console.log(`T12 parity VERIFY — ${slugs.length} voice-boundary functions, ${estNow()} EST`);
  console.log('Downloading deployed source from both projects. This takes a few minutes.\n');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't12-parity-'));
  const jobs = [];
  for (const slug of slugs) {
    jobs.push({ slug, env: 'production', ref: PROJECTS.production });
    jobs.push({ slug, env: 'staging', ref: PROJECTS.staging });
  }

  let done = 0;
  const results = await pool(jobs, DOWNLOAD_CONCURRENCY, async (job) => {
    const dir = await downloadOne(job.slug, job.ref, path.join(tmp, job.slug));
    done++;
    process.stdout.write(`\r  ${done}/${jobs.length} fetched`);
    return { ...job, hash: dir ? hashDir(dir) : null };
  });
  process.stdout.write('\n\n');

  const byslug = {};
  for (const r of results) {
    byslug[r.slug] = byslug[r.slug] || {};
    byslug[r.slug][r.env] = r.hash;
  }

  const identical = [];
  const differing = [];
  const oneSided = [];
  for (const slug of slugs) {
    const { production: p, staging: s } = byslug[slug];
    if (p && !s) oneSided.push([slug, 'production']);
    else if (s && !p) oneSided.push([slug, 'staging']);
    else if (!p && !s) oneSided.push([slug, 'neither — not deployed anywhere']);
    else if (p === s) identical.push(slug);
    else differing.push(slug);
  }

  console.log(`  identical : ${identical.length}`);
  console.log(`  DIFFERENT : ${differing.length}${differing.length ? '  ' + differing.join(', ') : ''}`);
  console.log(`  one-sided : ${oneSided.length}${oneSided.length ? '  ' + oneSided.map(([a, b]) => `${a} (${b})`).join(', ') : ''}`);
  console.log('');

  if (wantBaseline) return writeBaseline(differing, oneSided), 0;

  const baseline = loadBaseline();
  if (!baseline) {
    console.error('No baseline. Create one with: npm run parity:verify -- --write-baseline');
    return 2;
  }

  const accepted = new Set(Object.keys(baseline.accepted || {}));
  const unexpected = [...differing, ...oneSided.map(([s]) => s)].filter((s) => !accepted.has(s));
  const resolved = [...accepted].filter(
    (s) => !differing.includes(s) && !oneSided.some(([o]) => o === s),
  );

  if (resolved.length) {
    console.log(`${resolved.length} accepted difference(s) no longer present:`);
    for (const s of resolved) console.log(`   ✓ ${s}`);
    console.log('   Re-baseline once these are intended to stay closed:');
    console.log('     npm run parity:verify -- --write-baseline\n');
  }

  if (unexpected.length) {
    console.error(`PARITY VERIFY FAILED — ${unexpected.length} unrecorded difference(s):\n`);
    for (const s of unexpected) console.error(`   ✗ ${s}`);
    console.error('\nEither promote it, or — if the difference is deliberate — record it');
    console.error('WITH A REASON:');
    console.error('  npm run parity:verify -- --write-baseline');
    return 1;
  }

  console.log('AUTHORITATIVE: Voice Staging and Voice Production are equal across the');
  console.log('voice boundary, except the differences recorded in the baseline.');
  console.log('');
  console.log('This is the only output in this project entitled to say that.');
  return 0;
}

/* ── check: the fast tripwire ───────────────────────────────────────────── */
function runCheck() {
  const slugs = voiceBoundary();
  console.log(`T12 parity check — ${slugs.length} voice-boundary functions, ${estNow()} EST`);

  if (!fs.existsSync(BASELINE)) {
    console.error('\nNo baseline. Create one with: npm run parity:verify -- --write-baseline');
    return 2;
  }
  const accepted = new Set(Object.keys(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).accepted || {}));

  const manifest = fs.existsSync(MANIFEST)
    ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).deployments || {}
    : {};

  const mismatched = [];
  let unknown = 0;
  for (const slug of slugs) {
    const rec = manifest[slug];
    if (!rec || !rec.staging || !rec.production) { unknown++; continue; }
    if (rec.staging.source_sha256 !== rec.production.source_sha256 && !accepted.has(slug)) {
      mismatched.push(slug);
    }
  }

  if (mismatched.length) {
    console.error(`\nPARITY CHECK FAILED — ${mismatched.length} function(s) recorded as divergent:\n`);
    for (const s of mismatched) console.error(`   ✗ ${s}`);
    console.error('\nEither promote it, or record the difference with a reason:');
    console.error('  npm run parity:verify -- --write-baseline');
    return 1;
  }

  const covered = slugs.length - unknown;
  console.log(`  no recorded divergence among the ${covered} of ${slugs.length} function(s) this manifest covers.`);
  if (unknown) {
    // Wording matters here. This line used to read "N of M not yet deployed
    // through the wrapper", which sounded like a backlog of pending work and
    // was flagged as misleading in T12's own holding-list row. The manifest
    // gains an entry only when a function is deployed through
    // scripts/deploy-edge-function.js; a function deployed before the wrapper
    // existed, or through the raw Supabase CLI, simply has no fingerprint here.
    // That is not a finding about the function — it is the absence of one.
    console.log(`  ${unknown} of ${slugs.length} have NO recorded fingerprint, so this check makes`);
    console.log('  no claim about them in either direction. Not a backlog, not a warning:');
    console.log('  the manifest only gains an entry on deploy through the wrapper.');
  }
  console.log('');
  console.log('  ⚠ THIS IS NOT PROOF OF EQUILIBRIUM.');
  console.log('    It compares a manifest this repo writes, which anyone using the raw');
  console.log('    Supabase CLI bypasses. It can catch divergence; it cannot demonstrate');
  console.log('    equality. Only this proves that:');
  console.log('      npm run parity:verify');
  return 0;
}

(async () => {
  const verify = process.argv.includes('--verify');
  const wantBaseline = process.argv.includes('--write-baseline');

  assertAllowlistUnsetOnProduction();

  const code = verify || wantBaseline ? await runVerify(wantBaseline) : runCheck();
  process.exit(code);
})().catch((e) => {
  console.error('Parity check could not run: ' + e.message);
  process.exit(2);
});
