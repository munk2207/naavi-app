#!/usr/bin/env node
/**
 * T12 — Edge Function deploy wrapper.
 *
 * Run: npm run deploy:fn -- <slug> <staging|production>
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Promoting voice means merging `staging` -> `main` in the naavi-voice-server
 * repository. The Edge Functions the voice server calls live in a DIFFERENT
 * repository, so that merge moves none of them. Nothing has ever deployed them
 * as part of promoting, and nothing compared them between the two Supabase
 * projects. Three months of divergence was invisible to every check the project
 * owns (Architecture Reference 0c and 0d recorded this as a known weakness
 * before T12 opened).
 *
 * But the cause that defeats the other two is subtler, and T12 Phase 1 found it
 * by accident: DEPLOYMENT DOES NOT COME FROM GIT. On 2026-08-21, staging's
 * `create-contact` was found to be running 37 lines that existed in no commit —
 * only in one machine's working tree — while production was byte-identical to
 * committed HEAD. The assumption everyone held (production is stale, staging is
 * current) was exactly backwards.
 *
 * A promotion mechanism keyed on git would never have moved that code. A
 * comparison against the repository would have called staging "correct" only
 * because the edit happened to be sitting in that clone's working tree; on any
 * other clone the same check would have reported the opposite.
 *
 * So this wrapper's first job is not to deploy. It is to REFUSE to deploy
 * something that is not committed. Make it refuse, don't make it warn.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 *
 *   1. Refuses when the working tree is dirty for the function being deployed
 *      (its own directory, and any _shared file it imports). Exit 1.
 *   2. Deploys via the Supabase CLI with --no-verify-jwt, per CLAUDE.md.
 *   3. Records into docs/T12_function_parity_manifest.json: slug, environment,
 *      git commit, normalized source hash, and the timestamp in EST.
 *   4. Prints the environment resolved FROM THE PROJECT REF, not from a
 *      variable — Architecture Reference 0d: "verify a deployment from the
 *      running process, not from the push and not from the code."
 *
 * ---------------------------------------------------------------------------
 * WHAT THE MANIFEST IS NOT
 *
 * The manifest records what THIS WRAPPER deployed. Anyone using the raw CLI
 * bypasses it entirely, and the manifest would then assert a state that is not
 * real. It is a tripwire, never evidence.
 *
 * Per the T12 Phase 3 review (mandatory change 2): equilibrium may be claimed
 * ONLY on a passing `npm run parity:verify`, which downloads and diffs the
 * actual deployed source from both projects. Not on this file.
 *
 * ---------------------------------------------------------------------------
 * KNOWN LIMIT, stated rather than discovered later
 *
 * The source hash covers the function's own directory plus the _shared files it
 * imports directly (one level, no recursion). A transitive import of a _shared
 * file by another _shared file is not followed. This is a manifest-fidelity
 * limit only — `parity:verify` reads what Supabase actually holds and is
 * unaffected by it.
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const FUNCTIONS_DIR = path.join(REPO, 'supabase', 'functions');
const MANIFEST = path.join(REPO, 'docs', 'T12_function_parity_manifest.json');

const PROJECTS = {
  staging:    'xugvnfudofuskxoknhve',
  production: 'hhgyppbxgmjrwdpdubcx',
};

function estNow() {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/**
 * Files that make up a function's deployable source: its own directory, plus
 * every ../_shared/*.ts it imports directly.
 */
function sourceFilesFor(slug) {
  const dir = path.join(FUNCTIONS_DIR, slug);
  if (!fs.existsSync(dir)) {
    console.error(`No source for "${slug}" at supabase/functions/${slug}/`);
    console.error('This wrapper deploys committed repository source. It cannot deploy what is not there.');
    process.exit(2);
  }

  const own = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(dir, f));

  const shared = new Set();
  for (const file of own) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/from\s+['"]\.\.\/_shared\/([A-Za-z0-9_.-]+)['"]/g)) {
      const p = path.join(FUNCTIONS_DIR, '_shared', m[1]);
      if (fs.existsSync(p)) shared.add(p);
    }
  }

  return [...own, ...shared].sort();
}

/**
 * Normalized so formatting alone can never register as drift.
 *
 * The T4 drift check hashed function bodies raw, and ONE EXTRA SPACE made two
 * identical functions look different (Architecture Reference 0c). That defect
 * presented exactly like real drift and quietly inflated the difference count
 * until someone chased it. Normalizing here is not tidiness; it is the fix for
 * a failure this project has already paid for.
 */
function normalizedHash(files) {
  const h = crypto.createHash('sha256');
  for (const f of files) {
    const body = fs.readFileSync(f, 'utf8')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((l) => l.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n+$/, '\n');
    h.update(path.basename(f) + '\0' + body + '\0');
  }
  return h.digest('hex');
}

function refuseIfDirty(slug, files) {
  const rel = files.map((f) => path.relative(REPO, f).replace(/\\/g, '/'));
  let dirty = '';
  try {
    dirty = sh(`git status --porcelain -- ${rel.map((r) => `"${r}"`).join(' ')}`).trim();
  } catch (e) {
    console.error('Could not read git status: ' + e.message);
    process.exit(2);
  }

  if (!dirty) return;

  console.error('');
  console.error(`DEPLOY REFUSED — "${slug}" has uncommitted changes.`);
  console.error('');
  for (const line of dirty.split('\n')) console.error('   ' + line);
  console.error('');
  console.error('  Deploying this would put code into a Supabase project that exists in');
  console.error('  no commit. That is exactly what happened to create-contact on staging,');
  console.error('  and it is why the two environments could not be compared at all: there');
  console.error('  was no shared source of truth to compare them against.');
  console.error('');
  console.error('  Commit it first, then deploy.');
  console.error('');
  process.exit(1);
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) {
    return {
      note: 'What the T12 deploy wrapper recorded deploying, per function per environment. A TRIPWIRE, NOT EVIDENCE — anyone using the raw Supabase CLI bypasses it. Equilibrium may be claimed only on a passing `npm run parity:verify`.',
      updated: null,
      deployments: {},
    };
  }
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const [slug, env] = args;

  if (!slug || !PROJECTS[env]) {
    console.error('Usage: npm run deploy:fn -- <slug> <staging|production>');
    console.error('');
    console.error('  staging     -> ' + PROJECTS.staging);
    console.error('  production  -> ' + PROJECTS.production);
    process.exit(2);
  }

  const ref = PROJECTS[env];
  const dryRun = process.argv.includes('--dry-run');
  const files = sourceFilesFor(slug);

  refuseIfDirty(slug, files);

  const commit = sh('git rev-parse HEAD').trim();
  const hash = normalizedHash(files);

  console.log(`Deploying "${slug}" to ${env.toUpperCase()} (project ${ref})`);
  console.log(`   commit ${commit.slice(0, 12)}   source ${hash.slice(0, 12)}`);
  console.log('');

  // --dry-run performs every check and stops before the deploy and before
  // touching the manifest. It exists so the auto-tester can exercise the
  // dirty-tree refusal for real, rather than asserting that the source
  // "looks like" it would refuse. A guard nothing tests is a guard nobody
  // knows still works.
  if (dryRun) {
    console.log('--dry-run: checks passed, nothing deployed, manifest untouched.');
    return;
  }

  try {
    execSync(
      `npx --yes supabase@latest functions deploy ${slug} --no-verify-jwt --project-ref ${ref}`,
      { cwd: REPO, stdio: 'inherit' },
    );
  } catch (e) {
    console.error('');
    console.error('Deploy failed. Nothing recorded in the manifest.');
    process.exit(1);
  }

  const manifest = loadManifest();
  manifest.deployments[slug] = manifest.deployments[slug] || {};
  manifest.deployments[slug][env] = {
    commit,
    source_sha256: hash,
    files: files.map((f) => path.relative(REPO, f).replace(/\\/g, '/')),
    deployed_at: `${estNow()} EST`,
  };
  manifest.updated = `${estNow()} EST`;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

  console.log('');
  console.log(`Recorded in the manifest: ${slug} @ ${env}`);
  console.log('');
  console.log('  Reminder: the manifest is a tripwire, not proof. To demonstrate');
  console.log('  that staging and production are actually equal, run:');
  console.log('    npm run parity:verify');
  console.log('');
}

main();
