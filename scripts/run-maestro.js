/**
 * run-maestro.js — orchestrator for the e2e/ Maestro test scenarios.
 *
 * Responsibilities:
 *   1. Verify Maestro CLI is installed and on PATH.
 *   2. Verify an Android device or emulator is reachable via adb.
 *   3. (Optional) verify the MyNaavi APK is installed; if not, prompt
 *      the user to install it manually (the AAB lives on EAS / Play
 *      Store, not in the repo).
 *   4. Run `maestro test e2e/` and stream output.
 *   5. Exit with the same code Maestro returns so CI can gate on it.
 *
 * Usage:
 *   npm run test:mobile                      # run all scenarios
 *   npm run test:mobile -- 02-five-cons*     # run matching scenarios
 *   npm run test:mobile:one 05-force-close   # run exactly one
 *
 * Conventions:
 *   - The emulator must be created with name "Naavi-Test" per
 *     docs/MAESTRO_SETUP.docx step 2. We don't auto-boot it because
 *     boot times vary 30s-3min and the CLI deserves to be predictable.
 *   - The MyNaavi APK is installed via the Play Store internal-test
 *     channel on the emulator (one-time setup).
 */

const { spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const APP_ID = 'ca.naavi.app';
const E2E_DIR = path.resolve(__dirname, '..', 'e2e');

function red(s)    { return `\x1b[31m${s}\x1b[0m`; }
function green(s)  { return `\x1b[32m${s}\x1b[0m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }
function dim(s)    { return `\x1b[2m${s}\x1b[0m`; }

// On Windows, spawnSync needs `shell: true` to resolve .bat / .cmd files
// (maestro.bat, adb.exe via PATH, etc.) — without it, Node only finds
// raw .exe files and reports "not found" for everything else.
const SPAWN_OPTS = { encoding: 'utf8', shell: true };

function check(cmd, args, label) {
  const r = spawnSync(cmd, args, SPAWN_OPTS);
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || ''), label };
}

function assertCli(name, args, hint) {
  const r = check(name, args);
  if (!r.ok) {
    console.error(red(`✗ ${name} not found or failed.`));
    console.error(dim(hint));
    process.exit(2);
  }
  console.log(green(`✓ ${name}`) + dim(`  ${r.out.split('\n')[0]}`));
}

console.log(dim('— Naavi mobile e2e (Maestro) —'));

// 1. Maestro on PATH
assertCli('maestro', ['--version'], 'See docs/MAESTRO_SETUP.docx Step 3.');

// 2. adb on PATH
assertCli('adb', ['version'], 'Install Android Studio (Step 1) — adb ships with the SDK.');

// 3. A device or emulator reachable
const devices = check('adb', ['devices']);
const lines = devices.out.split('\n')
  .slice(1)
  .filter(l => l.trim() && !l.startsWith('*'));
const ready = lines.filter(l => /\bdevice\b/.test(l));
if (ready.length === 0) {
  console.error(red('✗ No Android device or emulator detected.'));
  console.error(dim('Boot the Naavi-Test emulator from Android Studio (Device Manager → ▶) and re-run.'));
  process.exit(2);
}
console.log(green(`✓ adb device(s): ${ready.length}`) + dim(`  ${ready.map(l => l.split(/\s+/)[0]).join(', ')}`));

// 4. MyNaavi installed?
const pmList = check('adb', ['shell', 'pm', 'list', 'packages', APP_ID]);
if (!new RegExp(APP_ID).test(pmList.out)) {
  console.error(red(`✗ ${APP_ID} is not installed on the device.`));
  console.error(dim('Install MyNaavi from the Play Store internal-test URL on the emulator first.'));
  process.exit(2);
}
console.log(green(`✓ ${APP_ID} installed`));

// 5. Pick scenarios. With no args, run the whole e2e/ folder. With args
// we glob-match against filenames.
const userArgs = process.argv.slice(2).filter(a => a !== '--one');
let target = E2E_DIR;
if (userArgs.length > 0) {
  const pat = userArgs[0];
  const all = fs.readdirSync(E2E_DIR).filter(f => f.endsWith('.yaml'));
  const matches = all.filter(f => f.includes(pat) || new RegExp(pat).test(f));
  if (matches.length === 0) {
    console.error(red(`✗ no e2e scenario matches "${pat}". Available:`));
    for (const f of all) console.error(dim('  ' + f));
    process.exit(2);
  }
  if (matches.length === 1 || process.argv.includes('--one')) {
    target = path.join(E2E_DIR, matches[0]);
    console.log(yellow(`→ running 1 scenario: ${matches[0]}`));
  } else {
    console.log(yellow(`→ ${matches.length} scenarios matched, running all`));
    // Maestro doesn't accept multiple file args directly; pass the
    // first match and warn the user to refine if they want more.
    target = path.join(E2E_DIR, matches[0]);
    console.log(dim('   (Maestro runs one path at a time — running first match. Pass a tighter pattern or use --one.)'));
  }
} else {
  console.log(yellow(`→ running all scenarios in ${path.relative(process.cwd(), E2E_DIR)}/`));
}

// 6. Hand off to Maestro. shell:true so maestro.bat resolves on Windows.
const child = spawn('maestro', ['test', target], { stdio: 'inherit', shell: true });
child.on('exit', code => process.exit(code ?? 1));
