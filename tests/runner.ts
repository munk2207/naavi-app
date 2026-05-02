/**
 * Naavi auto-tester — main runner.
 *
 * Loads every test case from the catalogue, runs them serially with a hard
 * timeout per test, generates a markdown + JSON report, and exits 0 (all
 * passed) or 1 (any failure / error / timeout).
 *
 * Usage:
 *   npm run test:auto                      # full suite
 *   npm run test:auto -- --grep location   # only tests whose id matches
 *   npm run test:auto -- --bail            # stop on first failure
 *
 * Environment (loaded from .env or tests/.env, root tried first):
 *   SUPABASE_URL              required
 *   SUPABASE_SERVICE_ROLE_KEY required (used for direct DB access + setup/teardown)
 *   SUPABASE_ANON_KEY         required (used to mimic the mobile app's auth)
 *   TEST_USER_ID              required (a real auth.users.id; tests write rows owned by this user)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import type { SuiteReport, TestCase, TestContext, TestResult } from './lib/types';
import { setupSuite, teardownSuite } from './lib/fixtures';
import { writeReport, renderConsoleSummary } from './lib/report';

import { smokeTests } from './catalogue/smoke';
import { chatTests } from './catalogue/chat';
import { rulesTests } from './catalogue/rules';
import { contactsTests } from './catalogue/contacts';
import { locationTests } from './catalogue/location';
import { calendarTests } from './catalogue/calendar';
import { memoryTests } from './catalogue/memory';
import { emailTests } from './catalogue/email';
import { waelTests } from './catalogue/wael-cases';
import { multiUserTests } from './catalogue/multiuser';
import { listsTests } from './catalogue/lists';

// ────────────────────────────────────────────────────────────────────────────
// .env loader (avoids adding dotenv as a dependency).
// ────────────────────────────────────────────────────────────────────────────

function loadEnv(filePath: string): void {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

// Try project root .env first, then tests/.env override.
loadEnv(join(process.cwd(), '.env'));
loadEnv(join(process.cwd(), 'tests', '.env'));

// ────────────────────────────────────────────────────────────────────────────
// Argument parsing.
// ────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getFlag(name: string): string | true | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const next = args[idx + 1];
  if (!next || next.startsWith('--')) return true;
  return next;
}
const grep = getFlag('--grep') as string | undefined;
const bail = getFlag('--bail') === true;
const json = getFlag('--json') === true;
const list = getFlag('--list') === true;

// ────────────────────────────────────────────────────────────────────────────
// Suite — flat list of all test cases.
// ────────────────────────────────────────────────────────────────────────────

const ALL_TESTS: TestCase[] = [
  ...smokeTests,
  ...chatTests,
  ...rulesTests,
  ...contactsTests,
  ...locationTests,
  ...calendarTests,
  ...memoryTests,
  ...emailTests,
  ...waelTests,
  ...multiUserTests,
  ...listsTests,
];

// ────────────────────────────────────────────────────────────────────────────
// Main.
// ────────────────────────────────────────────────────────────────────────────

function runWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function runOne(ctx: TestContext, t: TestCase): Promise<TestResult> {
  const log: string[] = [];
  const localCtx: TestContext = { ...ctx, log: (m) => log.push(m) };
  const start = Date.now();

  try {
    if (t.setup) await runWithTimeout(t.setup(localCtx), 30_000);
    await runWithTimeout(t.run(localCtx), t.timeoutMs ?? 30_000);

    return {
      id: t.id, category: t.category, description: t.description,
      status: 'passed', durationMs: Date.now() - start, log,
    };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    const isTimeout = msg.includes('timed out');
    let status: TestResult['status'];
    if (isTimeout)                         status = 'timed-out';
    else if (err?.name === 'TestSkippedError') status = 'skipped';
    else if (err?.name === 'AssertionError')   status = 'failed';
    else                                    status = 'errored';
    return {
      id: t.id, category: t.category, description: t.description,
      status,
      durationMs: Date.now() - start,
      errorMessage: msg,
      errorStack: err?.stack,
      log,
    };
  } finally {
    if (t.teardown) {
      try { await runWithTimeout(t.teardown(localCtx), 30_000); } catch { /* ignore */ }
    }
  }
}

async function main(): Promise<void> {
  // ── List mode — print the test catalogue and exit. No env required. ─────
  if (list) {
    console.log('');
    console.log('Naavi auto-tester — test catalogue');
    console.log('────────────────────────────────────────────────────────');
    console.log(`Total cases: ${ALL_TESTS.length}`);
    console.log('');

    const byCategory: Record<string, TestCase[]> = {};
    for (const t of ALL_TESTS) {
      if (!byCategory[t.category]) byCategory[t.category] = [];
      byCategory[t.category].push(t);
    }

    let n = 1;
    for (const [cat, tests] of Object.entries(byCategory)) {
      console.log(`\n## ${cat.toUpperCase()}`);
      for (const t of tests) {
        console.log('');
        console.log(`  ${n}. ${t.id}`);
        console.log(`     ${t.description}`);
        if (t.setup) console.log(`     (has setup)`);
        if (t.teardown) console.log(`     (has teardown)`);
        if (t.timeoutMs) console.log(`     (timeout: ${t.timeoutMs / 1000}s)`);
        n++;
      }
    }
    console.log('\n────────────────────────────────────────────────────────');
    console.log('Run any test:    npm run test:auto -- --grep <id-or-category>');
    console.log('Run full suite:  npm run test:auto');
    console.log('');
    process.exit(0);
  }

  const supabaseUrl     = process.env.SUPABASE_URL ?? '';
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const anonKey         = process.env.SUPABASE_ANON_KEY ?? '';
  const testUserId      = process.env.TEST_USER_ID ?? '';

  const missing: string[] = [];
  if (!supabaseUrl)    missing.push('SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!anonKey)        missing.push('SUPABASE_ANON_KEY');
  if (!testUserId)     missing.push('TEST_USER_ID');
  if (missing.length > 0) {
    console.error('Missing required env vars: ' + missing.join(', '));
    console.error('Set them in .env (project root) or tests/.env');
    process.exit(2);
  }

  const baseCtx: TestContext = {
    supabaseUrl,
    serviceRoleKey,
    anonKey,
    testUserId,
    log: () => {},
  };

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  console.log(`\nNaavi auto-tester — ${ALL_TESTS.length} cases`);
  console.log(`test user: ${testUserId}`);
  console.log(`supabase:  ${supabaseUrl}\n`);

  let candidates = ALL_TESTS;
  if (grep) {
    candidates = ALL_TESTS.filter(t => t.id.includes(grep) || t.category === grep);
    console.log(`grep=${grep} → ${candidates.length} match(es)\n`);
  }

  console.log('Setup: cleaning prior fixtures…');
  await setupSuite({ ...baseCtx, log: (m) => console.log('  ' + m) });

  const results: TestResult[] = [];
  for (const t of candidates) {
    process.stdout.write(`  ${t.id} … `);
    let result = await runOne(baseCtx, t);
    // V57.10.3 — retry-on-flake for chat / smoke tests. Both categories
    // hit Claude Haiku, which is non-deterministic for prompt-driven
    // shape assertions (one_shot defaults, action types, etc.). One
    // re-run catches transient flakes without normalising real
    // regressions. Wael 2026-05-02:
    // chat.location-default-one-time passed 27 runs in a row then
    // errored once on `one_shot=false` immediately before a build;
    // immediate re-run passed. Retry once for failed/errored chat-shape
    // tests; passed/skipped/timed-out are not retried.
    const isChatShape = t.category === 'chat' || t.category === 'smoke';
    const isRetriable = result.status === 'failed' || result.status === 'errored';
    if (isChatShape && isRetriable) {
      process.stdout.write('[retry] ');
      const retryResult = await runOne(baseCtx, t);
      if (retryResult.status === 'passed') {
        retryResult.log = [...(result.log ?? []), '--- RETRIED (initial run flaked) ---', ...(retryResult.log ?? [])];
        result = retryResult;
      }
    }
    results.push(result);
    const glyph =
      result.status === 'passed'    ? '[32m✓[0m PASS' :
      result.status === 'failed'    ? '[31m✗[0m FAIL' :
      result.status === 'timed-out' ? '[33m⧗[0m TIMEOUT' :
      result.status === 'skipped'   ? '○ SKIP' :
                                       '[31m⨯[0m ERROR';
    console.log(`${glyph} (${result.durationMs}ms)`);
    if (result.errorMessage) console.log(`    ${result.errorMessage}`);
    if (bail && result.status !== 'passed' && result.status !== 'skipped') {
      console.log('\n--bail: stopping after first failure.\n');
      break;
    }
  }

  console.log('\nTeardown: cleaning test rows…');
  await teardownSuite({ ...baseCtx, log: (m) => console.log('  ' + m) });

  const finishedAt = new Date().toISOString();
  const report: SuiteReport = {
    startedAt, finishedAt,
    durationMs: Date.now() - startMs,
    total:    results.length,
    passed:   results.filter(r => r.status === 'passed').length,
    failed:   results.filter(r => r.status === 'failed').length,
    errored:  results.filter(r => r.status === 'errored').length,
    timedOut: results.filter(r => r.status === 'timed-out').length,
    skipped:  results.filter(r => r.status === 'skipped').length,
    results,
  };

  const { markdownPath, jsonPath, latestPath } = writeReport(report);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderConsoleSummary(report));
    console.log(`Report: ${markdownPath}`);
    console.log(`Latest: ${latestPath}\n`);
  }

  process.exit(report.failed + report.errored + report.timedOut > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
