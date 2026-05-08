/**
 * Convert Maestro `extendedWaitUntil` blocks where `text:` was left at
 * the wrong indentation (a sibling of `visible:` instead of a child).
 * The earlier conversion script had bad indentation; this one fixes it
 * by adding 2 extra spaces in front of every line that should be a
 * child of `visible:`.
 *
 * Run: node scripts/fix-maestro-timeout-syntax.js
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'e2e');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));

let totalChanges = 0;

for (const f of files) {
  const fp = path.join(dir, f);
  let s = fs.readFileSync(fp, 'utf8');

  // Pattern produced by the buggy conversion:
  //   - extendedWaitUntil:
  //       visible:
  //       text: "..."
  //       timeout: NNNN
  //
  // We need:
  //   - extendedWaitUntil:
  //       visible:
  //         text: "..."
  //       timeout: NNNN
  //
  // Strategy: find each `extendedWaitUntil` block, locate the `visible:`
  // line, then re-indent any lines BETWEEN `visible:` and `timeout:` by
  // adding 2 extra leading spaces.
  const lines = s.split('\n');
  const out = [];
  let i = 0;
  let blockChanges = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);
    // Detect "- extendedWaitUntil:" then "    visible:" pattern
    if (/^\s*- extendedWaitUntil:\s*$/.test(line)) {
      // Look ahead for "    visible:" line (4-space indent under the dash)
      if (i + 1 < lines.length && /^    visible:\s*$/.test(lines[i + 1])) {
        out.push(lines[i + 1]); // visible: line
        i += 2;
        // Now consume body lines until we hit a line that's NOT 4-space
        // indented OR is a `timeout:` line. Re-indent body to 6 spaces.
        while (i < lines.length) {
          const body = lines[i];
          // Stop at timeout (which stays at 4 spaces)
          if (/^    timeout:\s*\d+\s*$/.test(body)) {
            out.push(body);
            i += 1;
            blockChanges += 1;
            break;
          }
          // Body line at 4-space indent — re-indent to 6
          if (/^    \S/.test(body)) {
            out.push('  ' + body);
            i += 1;
            continue;
          }
          // Anything else — bail
          break;
        }
        continue;
      }
    }
    i += 1;
  }
  const fixed = out.join('\n');
  if (fixed !== s) {
    fs.writeFileSync(fp, fixed);
    console.log(`${f}: re-indented ${blockChanges} extendedWaitUntil blocks`);
    totalChanges += blockChanges;
  }
}

console.log(`\nTotal: ${totalChanges} re-indents across ${files.length} files`);
