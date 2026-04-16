#!/usr/bin/env node
/**
 * Guard against native-only packages imported without a Platform.OS === 'web' guard.
 *
 * Background: the mobile app (Expo) ships web via `expo export --platform web`.
 * A module-level `import` of a native-only package (e.g. @mykin-ai/expo-audio-stream)
 * runs at load time on web too, where the native module doesn't exist — it throws,
 * crashes the React tree, and the page renders blank.
 *
 * This script is run as a Vercel pre-build step. It fails the build (exit 1)
 * when it finds a direct top-level import of any KNOWN native-only package
 * outside the platform guard pattern below:
 *
 *   const ExpoPlayAudioStream = Platform.OS === 'web'
 *     ? stubObject
 *     : require('@mykin-ai/expo-audio-stream').ExpoPlayAudioStream;
 *
 * If a new native-only package needs the same treatment, add it to
 * NATIVE_ONLY_PACKAGES below.
 */

const fs = require('fs');
const path = require('path');

const NATIVE_ONLY_PACKAGES = [
  '@mykin-ai/expo-audio-stream',
];

const ROOTS = ['lib', 'hooks', 'app', 'components'];
const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (FILE_EXTENSIONS.has(path.extname(name))) out.push(full);
  }
  return out;
}

function check(file) {
  const src = fs.readFileSync(file, 'utf8');
  const problems = [];
  for (const pkg of NATIVE_ONLY_PACKAGES) {
    // Match top-level ES imports — these run at module load time on web and crash
    const importRegex = new RegExp(
      `^\\s*import\\s+[^;]+from\\s+['"\`]${pkg.replace(/[/-]/g, '\\$&')}['"\`]`,
      'm'
    );
    if (importRegex.test(src)) {
      problems.push({ pkg, pattern: 'top-level ES import' });
    }
  }
  return problems;
}

function main() {
  const files = ROOTS.flatMap(r => walk(path.resolve(process.cwd(), r)));
  const failures = [];
  for (const file of files) {
    const problems = check(file);
    if (problems.length) failures.push({ file, problems });
  }
  if (failures.length === 0) {
    console.log('[check-native-imports] OK — no unguarded native-only imports.');
    process.exit(0);
  }
  console.error('[check-native-imports] FAILED — native-only packages must be lazy-loaded inside a Platform.OS guard.');
  console.error('  See hooks/useHandsfreeMode.ts for the correct pattern.');
  console.error('');
  for (const { file, problems } of failures) {
    const rel = path.relative(process.cwd(), file);
    for (const p of problems) {
      console.error(`  - ${rel}: ${p.pattern} of "${p.pkg}"`);
    }
  }
  console.error('');
  console.error('  Fix by replacing the import with:');
  console.error('    const Thing: any = Platform.OS === "web"');
  console.error('      ? { /* web stub */ }');
  console.error('      : require("package-name").Thing;');
  process.exit(1);
}

main();
