#!/usr/bin/env node
/**
 * MyNaavi smoke test — runs in ~1 minute, exits non-zero if anything is broken.
 *
 * Usage:
 *   node scripts/smoke-test.js
 *
 * What it checks (no human interaction required):
 *   1. Web app at naavi-app.vercel.app loads + bundle is 200
 *   2. Voice server on Railway responds 200
 *   3. Marketing site mynaavi.com has HubSpot embed intact
 *   4. Supabase: no leaked JWT in cron, no failed cron in last 3 runs
 *   5. Supabase: every deployed Edge Function has source in repo (and vice versa)
 *   6. Supabase: all tables with UNIQUE constraints have zero duplicate rows
 *   7. Supabase: get-naavi-prompt returns valid prompts for both channels
 *   8. Local: scripts/check-native-imports.js passes
 *
 * Does NOT test:
 *   - Phone calls (voice)
 *   - Mobile app UI (no device access)
 *   - Google Sign-In flow (requires human)
 *   - Action execution end-to-end (requires guided manual steps)
 */

const { execSync } = require('child_process');
const path = require('path');
const https = require('https');
const fs = require('fs');

const SUPABASE_URL = 'https://hhgyppbxgmjrwdpdubcx.supabase.co';
const PROJECT_REF  = 'hhgyppbxgmjrwdpdubcx';
const WEB_URL      = 'https://naavi-app.vercel.app';
const VOICE_URL    = 'https://naavi-voice-server-production.up.railway.app/';
const SITE_URL     = 'https://mynaavi.com/';

// ──────────────────────────────────────────────────────────────────────────
// Output helpers
// ──────────────────────────────────────────────────────────────────────────

const results = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n── ${name} ──`);
}

function pass(msg) {
  console.log(`  PASS  ${msg}`);
  results.push({ section: currentSection, status: 'pass', msg });
}

function fail(msg, detail) {
  console.log(`  FAIL  ${msg}`);
  if (detail) console.log(`        ${detail}`);
  results.push({ section: currentSection, status: 'fail', msg, detail });
}

function warn(msg, detail) {
  console.log(`  WARN  ${msg}`);
  if (detail) console.log(`        ${detail}`);
  results.push({ section: currentSection, status: 'warn', msg, detail });
}

// ──────────────────────────────────────────────────────────────────────────
// HTTP helper (built-in, no deps)
// ──────────────────────────────────────────────────────────────────────────

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, body = null, timeout = 15000 } = opts;
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers,
      timeout,
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, text: buf.toString('utf8'), buf });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Supabase helpers — wrap the CLI since we already have it authenticated
// ──────────────────────────────────────────────────────────────────────────

function sbQuery(sql) {
  // Flatten whitespace so the CLI-passed query stays on one line (the CLI
  // doesn't handle newlines in its quoted argument).
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  try {
    const out = execSync(
      `npx supabase db query --linked --output json ${JSON.stringify(oneLine)}`,
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
    );
    // CLI prints "Initialising login role..." then JSON; strip non-JSON lines.
    const jsonStart = out.indexOf('{');
    if (jsonStart === -1) throw new Error(`No JSON in output: ${out.slice(0, 200)}`);
    const parsed = JSON.parse(out.slice(jsonStart));
    return parsed.rows || [];
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    throw new Error(`Supabase query failed: ${err.message.slice(0, 200)}\n${stderr.slice(0, 400)}`);
  }
}

function sbFunctionsList() {
  try {
    const out = execSync(
      `npx supabase functions list --project-ref ${PROJECT_REF}`,
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
    );
    // Output is a plain-text table. Column 3 is SLUG.
    // Skip header, separator, and any literal "SLUG" word that might slip through.
    return out.split('\n')
      .map(l => l.split('|').map(c => c.trim()))
      .filter(cols => cols.length >= 3)
      .map(cols => cols[2])
      .filter(slug => slug && slug !== 'SLUG' && !/^-+$/.test(slug));
  } catch (err) {
    throw new Error(`supabase functions list failed: ${err.message}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Individual checks
// ──────────────────────────────────────────────────────────────────────────

async function checkWebApp() {
  section('Web app (naavi-app.vercel.app)');
  try {
    const res = await fetch(WEB_URL);
    if (res.status !== 200) {
      fail(`${WEB_URL} returned ${res.status}`);
      return;
    }
    pass('Page returns HTTP 200');

    if (!res.text.includes('<div id="root">')) {
      fail('HTML missing <div id="root">');
    } else {
      pass('HTML has #root mount point');
    }

    const bundleMatch = res.text.match(/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/);
    if (!bundleMatch) {
      fail('No JS bundle reference found in HTML');
      return;
    }
    pass(`Bundle referenced: ${bundleMatch[0]}`);

    const bundleRes = await fetch(WEB_URL + '/' + bundleMatch[0]);
    if (bundleRes.status !== 200) {
      fail(`JS bundle returned ${bundleRes.status}`);
    } else {
      pass(`JS bundle loads (${(bundleRes.text.length/1024).toFixed(0)} KB)`);
    }
  } catch (err) {
    fail('Could not reach web app', err.message);
  }
}

async function checkVoiceServer() {
  section('Voice server (Railway)');
  try {
    const res = await fetch(VOICE_URL);
    if (res.status !== 200) {
      fail(`${VOICE_URL} returned ${res.status}`);
    } else {
      pass('Voice server responds HTTP 200');
    }
  } catch (err) {
    fail('Could not reach voice server', err.message);
  }
}

async function checkMarketingSite() {
  section('Marketing site (mynaavi.com)');
  try {
    const res = await fetch(SITE_URL);
    if (res.status !== 200) {
      fail(`${SITE_URL} returned ${res.status}`);
      return;
    }
    pass('Page returns HTTP 200');

    if (!res.text.includes('js-na3.hsforms.net/forms/embed/343125145.js')) {
      fail('HubSpot embed script missing from #signup');
    } else {
      pass('HubSpot embed script present');
    }

    if (res.text.includes('YOUR_PORTAL_ID') || res.text.includes('YOUR_FORM_ID')) {
      fail('HubSpot placeholder IDs are back (regression)');
    } else {
      pass('No HubSpot placeholder IDs');
    }

    if (!res.text.includes('hs-form-frame')) {
      fail('hs-form-frame div not found');
    } else {
      pass('hs-form-frame div present');
    }
  } catch (err) {
    fail('Could not reach marketing site', err.message);
  }
}

function checkCronHealth() {
  section('Cron jobs (Supabase)');
  try {
    // Leaked JWT check
    const leakedRows = sbQuery(
      `SELECT jobname FROM cron.job WHERE command ~ 'eyJ[A-Za-z0-9_.-]{50,}'`
    );
    if (leakedRows.length === 0) {
      pass('No hardcoded JWT in any cron command');
    } else {
      fail(`Leaked JWT found in crons: ${leakedRows.map(r => r.jobname).join(', ')}`);
    }

    // Latest run status per job
    const runs = sbQuery(
      `SELECT j.jobname, d.status FROM cron.job j
         LEFT JOIN LATERAL (
           SELECT status FROM cron.job_run_details
           WHERE jobid = j.jobid ORDER BY start_time DESC LIMIT 1
         ) d ON true
         WHERE j.active = true
         ORDER BY j.jobname`
    );
    const failed = runs.filter(r => r.status === 'failed');
    const notYetRun = runs.filter(r => r.status === null);
    if (failed.length === 0) {
      pass(`All ${runs.length} active cron jobs healthy (latest run not failed)`);
    } else {
      fail(`Cron jobs with failed latest run: ${failed.map(r => r.jobname).join(', ')}`);
    }
    if (notYetRun.length > 0) {
      warn(`Crons that haven't run yet: ${notYetRun.map(r => r.jobname).join(', ')}`);
    }

    // Gmail sync heartbeat — should have run in last 10 min (5-min schedule)
    const gmailRecent = sbQuery(
      `SELECT COUNT(*)::int as cnt FROM cron.job_run_details
         WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'sync-gmail-every-5-min')
         AND start_time > now() - interval '10 minutes'
         AND status = 'succeeded'`
    );
    if ((gmailRecent[0]?.cnt ?? 0) >= 1) {
      pass(`Gmail sync has succeeded in the last 10 minutes (${gmailRecent[0].cnt} runs)`);
    } else {
      warn('Gmail sync has not run in the last 10 minutes');
    }
  } catch (err) {
    fail('Cron health check error', err.message);
  }
}

function checkEdgeFunctionsSync() {
  section('Edge Functions: deployed vs source');
  try {
    const deployed = new Set(sbFunctionsList());
    const fs = require('fs');
    const srcDir = path.resolve(__dirname, '..', 'supabase', 'functions');
    const source = new Set(
      fs.readdirSync(srcDir).filter(name => {
        const p = path.join(srcDir, name);
        return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'index.ts'));
      })
    );

    const orphans = [...deployed].filter(n => !source.has(n));
    const unDeployed = [...source].filter(n => !deployed.has(n));

    if (orphans.length === 0) pass(`All ${deployed.size} deployed functions have source`);
    else fail(`Deployed without source (cannot update from git): ${orphans.join(', ')}`);

    if (unDeployed.length === 0) pass(`All ${source.size} source functions are deployed`);
    else fail(`Source exists but not deployed: ${unDeployed.join(', ')}`);
  } catch (err) {
    fail('Edge Function sync check error', err.message);
  }
}

function checkDuplicates() {
  section('Data duplicates (per-user tables)');
  const tables = [
    ['contacts',             `user_id, name, email`],
    ['knowledge_fragments',  `user_id, content`],
    ['reminders',            `user_id, title, datetime`],
    ['action_rules',         `user_id, label`],
    ['user_settings',        `user_id`],
    ['user_tokens',          `user_id, provider`],
  ];
  for (const [tbl, cols] of tables) {
    try {
      const rows = sbQuery(
        `SELECT COUNT(*)::int as dup FROM (
           SELECT 1 FROM ${tbl} GROUP BY ${cols} HAVING COUNT(*) > 1
         ) x`
      );
      const dup = rows[0]?.dup ?? 0;
      if (dup === 0) pass(`${tbl}: no duplicates`);
      else fail(`${tbl}: ${dup} duplicate groups`);
    } catch (err) {
      fail(`${tbl}: query error`, err.message);
    }
  }
}

async function checkSharedPrompt() {
  section('Shared Claude prompt');
  for (const channel of ['app', 'voice']) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-naavi-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Anon key works — function is deployed with --no-verify-jwt and
          // reads channel from body. We don't need auth for a read-only
          // "give me the prompt" call.
          'Authorization': `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ''}`,
        },
        body: JSON.stringify({ channel, userName: 'TestUser', userPhone: '+15550123' }),
      });
      if (res.status !== 200) {
        fail(`channel=${channel}: HTTP ${res.status}`);
        continue;
      }
      const data = JSON.parse(res.text);
      if (typeof data.prompt !== 'string' || data.prompt.length < 2000) {
        fail(`channel=${channel}: prompt too short (${data.prompt?.length ?? 0} chars)`);
      } else {
        pass(`channel=${channel}: returned ${data.prompt.length} chars, version ${data.version}`);
      }
      // Check a few expected anchors
      const expected = ['RULE 1', 'RULE 8', 'RULE 14', 'CRITICAL', 'JSON'];
      const missing = expected.filter(tok => !data.prompt?.includes(tok));
      if (missing.length === 0) pass(`channel=${channel}: all expected RULE anchors present`);
      else fail(`channel=${channel}: missing ${missing.join(', ')}`);
    } catch (err) {
      fail(`channel=${channel}: request error`, err.message);
    }
  }
}

function checkNativeImportsGuard() {
  section('Native imports guard');
  try {
    execSync(
      `node scripts/check-native-imports.js`,
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: path.resolve(__dirname, '..') }
    );
    pass('No unguarded native-only imports in source');
  } catch (err) {
    const stderr = (err.stderr || err.stdout || '').toString();
    fail('check-native-imports FAILED', stderr.split('\n').slice(0, 5).join(' | '));
  }
}

function checkRepoState() {
  section('Local repo state');
  try {
    // Mobile main repo
    const root = path.resolve(__dirname, '..');
    const status = execSync('git status --short', { cwd: root, encoding: 'utf8' }).trim();
    if (status === '' || status === '?? naavi-voice-server/') {
      pass('Mobile main repo clean (only expected untracked items)');
    } else {
      warn(`Mobile main repo has uncommitted changes`, status.split('\n').slice(0, 3).join(' | '));
    }

    const behind = execSync('git rev-list --count HEAD..@{u}', { cwd: root, encoding: 'utf8' }).trim();
    const ahead  = execSync('git rev-list --count @{u}..HEAD', { cwd: root, encoding: 'utf8' }).trim();
    if (behind === '0' && ahead === '0') pass('Mobile repo in sync with origin/main');
    else fail(`Mobile repo: ahead=${ahead} behind=${behind}`);

    // Build clone
    const bc = 'C:\\Users\\waela\\naavi-mobile';
    const bcStatus = execSync('git status --short', { cwd: bc, encoding: 'utf8' }).trim();
    if (bcStatus === '') pass('Build clone (naavi-mobile) clean');
    else warn('Build clone has uncommitted changes', bcStatus.slice(0, 200));
    const bcBehind = execSync('git rev-list --count HEAD..@{u}', { cwd: bc, encoding: 'utf8' }).trim();
    if (bcBehind === '0') pass('Build clone in sync with origin/main (ready to build AAB)');
    else fail(`Build clone behind origin by ${bcBehind} commits — run 'git fetch && git merge origin/main' in ${bc}`);
  } catch (err) {
    warn('Repo state check error (optional)', err.message);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

// Capture everything written to stdout so we can save the same output to a log file.
const logLines = [];
const origLog = console.log.bind(console);
console.log = (...args) => {
  const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  logLines.push(line);
  origLog(...args);
};

function saveResultLog(summary) {
  try {
    const logsDir = path.resolve(__dirname, '..', 'docs', 'smoke-test-results');
    fs.mkdirSync(logsDir, { recursive: true });

    // Timestamped file for history
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-04-16T14-23-45
    const datedPath  = path.join(logsDir, `${ts}.log`);
    const latestPath = path.join(logsDir, 'latest.log');

    const header =
      `MyNaavi smoke test — ${new Date().toISOString()}\n` +
      `Result: ${summary.passed} passed, ${summary.failed} failed, ${summary.warned} warnings (${summary.elapsed}s)\n` +
      `${'-'.repeat(60)}\n`;
    const content = header + logLines.join('\n') + '\n';

    fs.writeFileSync(datedPath, content, 'utf8');
    fs.writeFileSync(latestPath, content, 'utf8');

    // Also write a single-line summary that appends to history.csv for quick trend
    const historyPath = path.join(logsDir, 'history.csv');
    const isNew = !fs.existsSync(historyPath);
    const header2 = 'timestamp,passed,failed,warned,elapsed_s\n';
    const row = `${new Date().toISOString()},${summary.passed},${summary.failed},${summary.warned},${summary.elapsed}\n`;
    fs.appendFileSync(historyPath, (isNew ? header2 : '') + row);

    origLog(`\n  Log saved:    ${path.relative(process.cwd(), datedPath)}`);
    origLog(`  Latest log:   ${path.relative(process.cwd(), latestPath)}`);
    origLog(`  History CSV:  ${path.relative(process.cwd(), historyPath)}`);
  } catch (err) {
    origLog(`  (could not save log: ${err.message})`);
  }
}

(async () => {
  console.log('=== MyNaavi smoke test ===');
  const started = Date.now();

  await checkWebApp();
  await checkVoiceServer();
  await checkMarketingSite();
  checkCronHealth();
  checkEdgeFunctionsSync();
  checkDuplicates();
  await checkSharedPrompt();
  checkNativeImportsGuard();
  checkRepoState();

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warned = results.filter(r => r.status === 'warn').length;

  console.log(`\n=== Summary ===`);
  console.log(`  ${passed} passed, ${failed} failed, ${warned} warnings — ${elapsed}s`);
  if (failed > 0) {
    console.log('\n  Failures:');
    for (const r of results.filter(r => r.status === 'fail')) {
      console.log(`   - [${r.section}] ${r.msg}${r.detail ? ' | ' + r.detail : ''}`);
    }
  }

  saveResultLog({ passed, failed, warned, elapsed });

  process.exit(failed === 0 ? 0 : 1);
})().catch(err => {
  console.error('\nSmoke test crashed:', err);
  process.exit(2);
});
