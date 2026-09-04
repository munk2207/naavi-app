/**
 * F25 — one-time migration of the 23 hand-written FAQ answers into faq_items.
 * (2026-09-02)
 *
 * Writes through manage-faq, NOT directly into the table. The whole point of
 * this item is that there is one write entry point; a migration that inserts
 * behind it would be the first exception on day one.
 *
 * ── The constraint this script exists to protect ───────────────────────────
 * Phase 0: "The 23 answers must not change wording. Not rewritten, not
 * summarised, not improved in passing." So the script does two things in equal
 * measure — it migrates, and it PROVES the migration changed nothing, by
 * comparing the visible text of every answer before and after and printing the
 * comparison rather than asserting it.
 *
 * The slug is taken from each <details id="..."> verbatim, because those are
 * published addresses: the mobile app deep-links 12 of them.
 *
 * Usage:
 *   node scripts/migrate-faq-to-db.js --check     read + compare only, no writes
 *   node scripts/migrate-faq-to-db.js --staging   migrate into staging
 *   node scripts/migrate-faq-to-db.js --production  (refuses without --i-mean-it)
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const FAQ_HTML = path.join(REPO, 'mynaavi-website', 'faq.html');

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const PRODUCTION = args.includes('--production');
const CONFIRMED = args.includes('--i-mean-it');

if (PRODUCTION && !CONFIRMED) {
  console.error('Refusing: --production requires --i-mean-it, and Wael\'s explicit instruction.');
  process.exit(1);
}

// ── env ───────────────────────────────────────────────────────────────────
const env = {};
for (const line of fs.readFileSync(path.join(REPO, 'tests', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const URL = PRODUCTION ? env.SUPABASE_URL : env.STAGING_SUPABASE_URL;
const KEY = PRODUCTION ? env.SUPABASE_SERVICE_ROLE_KEY : env.STAGING_SUPABASE_SERVICE_ROLE_KEY;

// ── parse the 23 answers out of the live page ─────────────────────────────
const html = fs.readFileSync(FAQ_HTML, 'utf8');
const blocks = [...html.matchAll(
  /<details id="([^"]+)">\s*<summary>([\s\S]*?)<\/summary>\s*<div class="answer">([\s\S]*?)<\/div>\s*<\/details>/g,
)];

const items = blocks.map(m => ({
  slug: m[1],
  question: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
  answer_html: m[3].trim(),
}));

// The comparison key: visible words only, formatting ignored. If this string
// differs before and after, wording changed — which is the one thing forbidden.
const visibleText = s =>
  s.replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();

console.log(`parsed ${items.length} answers from mynaavi-website/faq.html`);
if (items.length !== 23) {
  console.error(`*** expected 23, got ${items.length} — refusing to continue`);
  process.exit(1);
}

const dupes = items.map(i => i.slug).filter((s, i, a) => a.indexOf(s) !== i);
if (dupes.length) {
  console.error(`*** duplicate slugs in source: ${dupes.join(', ')} — refusing`);
  process.exit(1);
}

if (CHECK_ONLY) {
  console.log('\n--check: parsed only, nothing written.\n');
  items.forEach((it, n) => console.log(`  ${String(n + 1).padStart(2)}. ${it.slug.padEnd(26)} ${visibleText(it.answer_html).length} chars`));
  process.exit(0);
}

console.log(`target: ${URL} ${PRODUCTION ? '<- PRODUCTION' : '<- staging'}\n`);

async function call(op, payload) {
  const r = await fetch(`${URL}/functions/v1/manage-faq`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, ...payload }),
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return [r.status, j];
}

(async () => {
  const results = [];
  for (const it of items) {
    const [status, body] = await call('create', it);
    results.push({ slug: it.slug, status, ok: body && body.ok, err: body && body.error, flagged: body && body.needs_classification });
    process.stdout.write(body && body.ok ? '.' : 'X');
  }
  console.log('\n');

  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(f => console.log(`  ${f.slug.padEnd(26)} HTTP ${f.status}  ${f.err ?? ''}`));
  }
  const flagged = results.filter(r => r.flagged);
  console.log(`written: ${results.length - failed.length}/${items.length}   classifier-flagged: ${flagged.length}`);
  if (flagged.length) console.log(`  needs classification: ${flagged.map(f => f.slug).join(', ')}`);

  // ── the part that matters: prove nothing changed ────────────────────────
  console.log('\n--- word-for-word comparison, all 23 ---');
  const r = await fetch(`${URL}/functions/v1/get-faq`);
  const live = await r.json();
  const bySlug = new Map((live.items || []).map(i => [i.slug, i]));

  let identical = 0;
  let differing = 0;
  for (const it of items) {
    const got = bySlug.get(it.slug);
    if (!got) { console.log(`  MISSING   ${it.slug}`); differing++; continue; }
    const before = visibleText(it.answer_html);
    const after = visibleText(got.answer_html);
    const qBefore = it.question;
    const qAfter = got.question;
    if (before === after && qBefore === qAfter) {
      identical++;
    } else {
      differing++;
      console.log(`  DIFFERS   ${it.slug}`);
      if (qBefore !== qAfter) console.log(`     question before: ${qBefore}\n     question after : ${qAfter}`);
      if (before !== after) {
        let k = 0;
        while (k < before.length && k < after.length && before[k] === after[k]) k++;
        console.log(`     first divergence at char ${k}`);
        console.log(`     before: …${before.slice(Math.max(0, k - 40), k + 60)}`);
        console.log(`     after : …${after.slice(Math.max(0, k - 40), k + 60)}`);
      }
    }
  }

  console.log(`\n  identical: ${identical}/23    differing: ${differing}`);
  console.log(differing === 0
    ? '\nALL 23 ANSWERS MIGRATED WORD FOR WORD.'
    : '\n*** WORDING CHANGED — Phase 0 constraint violated, investigate before proceeding ***');

  // ── anchors ─────────────────────────────────────────────────────────────
  const sourceSlugs = items.map(i => i.slug);
  const liveSlugs = (live.items || []).map(i => i.slug);
  const lost = sourceSlugs.filter(s => !liveSlugs.includes(s));
  console.log(`\n--- anchors ---\n  ${sourceSlugs.length} in source, ${liveSlugs.length} live, ${lost.length} lost`);
  if (lost.length) console.log(`  *** LOST: ${lost.join(', ')} — the app deep-links 12 of these`);
})();
