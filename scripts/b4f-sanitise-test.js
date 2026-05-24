// B4f sanity test — does the proposed sanitiseForSpeech transform
// correctly handle postal codes, partial postal fragments, and province
// codes WITHOUT the existing char-splitter undoing the work?

const fixPostalLetter = (l) => {
  if (l === 'M') return 'em';
  if (l === 'N') return 'en';
  if (l === 'S') return 'ess';
  if (l === 'W') return 'double u';
  return l;
};

function sanitiseForSpeech(text) {
  // NEW: postal-code + province normalization (added first)
  text = text
    .replace(
      /\b([A-Z])(\d)([A-Z])\s?(\d)([A-Z])(\d)\b/g,
      (_m, l1, d1, l2, d2, l3, d3) =>
        `${fixPostalLetter(l1)} ${d1} ${fixPostalLetter(l2)}, ${d2} ${fixPostalLetter(l3)} ${d3}`,
    )
    .replace(/\b(\d)([MNSW])(\d)\b/g, (_m, d1, l, d2) => `${d1} ${fixPostalLetter(l)} ${d2}`)
    .replace(/,\s*ON\b/g, ', Ontario')
    .replace(/,\s*QC\b/g, ', Quebec')
    .replace(/,\s*BC\b/g, ', British Columbia')
    .replace(/,\s*AB\b/g, ', Alberta');

  // EXISTING: markdown strip + char-splitter (unchanged from production)
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\*+/g, '')
    .replace(/_{2,}/g, '')
    .replace(
      /\b(?!\d+(?:st|nd|rd|th|am|pm)\b)([A-Za-z]+\d+[A-Za-z0-9]*|[A-Za-z0-9]*\d+[A-Za-z]+[A-Za-z0-9]*)\b/g,
      (match) => match.split('').join(' '),
    );
}

const tests = [
  // Core B4f bug cases (from today's failed test)
  // K is L1 (preserved — not in M/N/S/W set), C is L2 (preserved),
  // M is L3 (expanded to "em" — the actual fix).
  ['K1C5M3', 'K 1 C, 5 em 3'],
  ['K1C 5M3', 'K 1 C, 5 em 3'],
  ['5M3', '5 em 3'],
  [
    "I don't have a contact with postal code K1C5M3 in your records.",
    "I don't have a contact with postal code K 1 C, 5 em 3 in your records.",
  ],

  // Other M/N/S/W partial fragments
  ['5N3', '5 en 3'],
  ['5S3', '5 ess 3'],
  ['5W3', '5 double u 3'],

  // Non-confusable letters (should NOT trigger partial normalization;
  // letters surrounded by digits still get char-split by the existing
  // splitter — but that produces correct pronunciation like "5 K 3")
  ['5K3', '5 K 3'],
  ['5P2', '5 P 2'],

  // Full postal codes for various provinces.
  // M5V starts with M (L1) — expanded to "em" so TTS doesn't say "meters".
  ['M5V 1A1', 'em 5 V, 1 A 1'],
  ['V6B 3K9', 'V 6 B, 3 K 9'],

  // Province expansion
  ['Ottawa, ON', 'Ottawa, Ontario'],
  ['Toronto, ON', 'Toronto, Ontario'],
  ['turn ON the light', 'turn ON the light'], // no leading comma — leave alone

  // Pre-existing behavior we must NOT break (ordinal dates / times)
  ['October 15th', 'October 15th'],
  ['meet at 5pm', 'meet at 5pm'],

  // Pre-existing behavior — char-splitter still works for non-postal patterns
  ['aggan2207', 'a g g a n 2 2 0 7'],
];

let passed = 0;
let failed = 0;
for (const [input, expected] of tests) {
  const actual = sanitiseForSpeech(input);
  const pass = actual === expected;
  if (pass) {
    passed++;
    console.log(`PASS: "${input}" -> "${actual}"`);
  } else {
    failed++;
    console.log(`FAIL: "${input}"`);
    console.log(`      expected: "${expected}"`);
    console.log(`      actual:   "${actual}"`);
  }
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
