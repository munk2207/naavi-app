/**
 * F25 — FAQ rebuild. (2026-09-02)
 *
 * Covers the three new Edge Functions and the two defects Phase 4 found in
 * its own code, so neither can come back silently.
 *
 * ── Why the 3-trial cases look the way they do ────────────────────────────
 * Governance Phase 3's Non-Determinism Rule requires a minimum of 3
 * independent trials per positive-control case for any classifier change,
 * with the full distribution reported. match-faq is a classifier.
 *
 * "Independent" is doing real work in that sentence: match-faq caches by
 * normalised input (Phase 3 A1e), so calling it three times with the same
 * text would return one model answer replayed three times and prove nothing.
 * Each trial therefore DELETES the cache row first. A 3-trial rule and a
 * result cache are in direct tension, and nothing in the plan noticed that
 * until this file was written.
 *
 * ⚠️ A phrase returning 2 of 3 is a FINDING, not a re-run. Re-running until
 * green is the fake-test pattern.
 *
 * ── Coverage gaps, disclosed per CLAUDE.md Rule 15a ───────────────────────
 * 1. The Edge Functions call Deno.serve at module scope and cannot be
 *    imported into this Node/tsx runner. The live cases below call the
 *    DEPLOYED staging functions over HTTP, which is stronger than a source
 *    assertion; the source assertions that remain guard specific regressions
 *    that HTTP cannot see (e.g. that a fixed parser is still the fixed one).
 * 2. The three web pages (faq.html, report.html, contact.html) are static
 *    files this runner cannot execute. Their behaviour was verified in a
 *    browser against staging on 2026-09-02 and is recorded in the Phase 5
 *    evidence package. Source assertions here check the wiring exists.
 * 3. These live cases need STAGING_SUPABASE_URL and
 *    STAGING_SUPABASE_SERVICE_ROLE_KEY. They SKIP rather than fail when the
 *    environment is not configured, so the suite stays runnable — but a skip
 *    is not a pass, and the runner reports it as a skip.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { TestCase } from '../lib/types';
import { expectTruthy, TestSkippedError } from '../lib/assertions';

const ROOT = join(__dirname, '..', '..');
const MATCH_FAQ = join(ROOT, 'supabase', 'functions', 'match-faq', 'index.ts');
const MANAGE_FAQ = join(ROOT, 'supabase', 'functions', 'manage-faq', 'index.ts');
const GET_FAQ = join(ROOT, 'supabase', 'functions', 'get-faq', 'index.ts');
const WEB = join(ROOT, 'mynaavi-website');
/* The staff portal is a fourth repository, checked out BESIDE this one rather
 * than inside it. Phase 6 recorded "the runner cannot reach it" and left the
 * page with no automated test at all — which is how it reached production
 * having never been opened by anyone. It can be reached; it just has to be
 * allowed to skip when the sibling checkout is absent. */
const STAFF_FAQ = join(ROOT, '..', 'naavi-staff', 'faq.html');

/* Read LAZILY, never at module scope. runner.ts loads .env at line 165 —
 * AFTER it imports this catalogue at line 28 — so a module-level const here
 * captures an empty string and every live case silently skips. Six of them
 * did exactly that on the first run, and a skip is not a pass. */
const stagingUrl = () => process.env.STAGING_SUPABASE_URL ?? '';
const stagingKey = () => process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY ?? '';
const liveReady = () => Boolean(stagingUrl() && stagingKey());

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const inputHash = (s: string) => createHash('sha256').update(norm(s)).digest('hex');

async function clearCache(text: string): Promise<void> {
  await fetch(`${stagingUrl()}/rest/v1/faq_match_cache?input_hash=eq.${inputHash(text)}`, {
    method: 'DELETE',
    headers: { apikey: stagingKey(), Authorization: `Bearer ${stagingKey()}` },
  });
}

async function clearRateLimit(): Promise<void> {
  await fetch(`${stagingUrl()}/rest/v1/faq_rate_limit?ip_hash=neq.__none__`, {
    method: 'DELETE',
    headers: { apikey: stagingKey(), Authorization: `Bearer ${stagingKey()}` },
  });
}

type MatchResult = { status?: string; matches?: { slug: string }[] };

async function matchOnce(text: string): Promise<MatchResult> {
  const r = await fetch(`${stagingUrl()}/functions/v1/match-faq`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, surface: 'auto-tester' }),
  });
  return (await r.json().catch(() => ({}))) as MatchResult;
}

/** Three genuinely independent trials — cache cleared before each. */
async function threeTrials(text: string): Promise<MatchResult[]> {
  const out: MatchResult[] = [];
  for (let i = 0; i < 3; i++) {
    await clearCache(text);
    out.push(await matchOnce(text));
  }
  return out;
}

function reportDistribution(text: string, trials: MatchResult[], hit: (t: MatchResult) => boolean): void {
  const passes = trials.filter(hit).length;
  const detail = trials
    .map((t, i) => `trial ${i + 1}: ${t.status} [${(t.matches ?? []).map(m => m.slug).join(', ') || '—'}]`)
    .join(' | ');
  expectTruthy(
    passes === 3,
    `"${text}" — ${passes}/3 trials matched. Full distribution: ${detail}. ` +
      `A result below 3/3 is a finding to investigate, NOT a case to re-run until green.`,
  );
}

export const faqTests: TestCase[] = [
  // ── the four phrases from Phase 0's Success Criteria ────────────────────
  {
    id: 'f25.match.delete-an-alert',
    category: 'faq',
    description: 'match-faq finds the delete-an-alert answer for "how do i delete an alert" (3 trials)',
    async run() {
      if (!liveReady()) throw new TestSkippedError('STAGING_SUPABASE_URL / SERVICE_ROLE_KEY not set');
      await clearRateLimit();
      const text = 'how do i delete an alert';
      reportDistribution(text, await threeTrials(text), t => (t.matches ?? []).some(m => m.slug === 'delete-alert'));
    },
  },
  {
    id: 'f25.match.partial-phrase',
    category: 'faq',
    description: 'match-faq finds delete-alert for the partial "how do i delete" — keyword scoring gives this 1.5, below its threshold of 2, so it returns nothing today (3 trials)',
    async run() {
      if (!liveReady()) throw new TestSkippedError('staging env not set');
      await clearRateLimit();
      const text = 'how do i delete';
      reportDistribution(text, await threeTrials(text), t => (t.matches ?? []).some(m => m.slug === 'delete-alert'));
    },
  },
  {
    id: 'f25.match.no-shared-words',
    category: 'faq',
    description: 'match-faq finds community-add for "I want to add my daughter to my community" — keyword scoring gives this ZERO against a published answer (3 trials)',
    async run() {
      if (!liveReady()) throw new TestSkippedError('staging env not set');
      await clearRateLimit();
      const text = 'I want to add my daughter to my community';
      reportDistribution(text, await threeTrials(text), t => (t.matches ?? []).some(m => m.slug === 'community-add'));
    },
  },
  {
    id: 'f25.match.described-not-named',
    category: 'faq',
    description: 'match-faq routes "my alarm didn\'t go off this morning" to report-problem (3 trials). Phase 0 originally expected the morning-brief answer; that expectation was wrong and was corrected on Wael\'s ruling, 2026-09-02',
    async run() {
      if (!liveReady()) throw new TestSkippedError('staging env not set');
      await clearRateLimit();
      const text = "my alarm didn't go off this morning";
      reportDistribution(text, await threeTrials(text), t => (t.matches ?? []).some(m => m.slug === 'report-problem'));
    },
  },

  // ── the control: it must be able to find nothing ────────────────────────
  {
    id: 'f25.match.returns-nothing-when-nothing-fits',
    category: 'faq',
    description: 'match-faq returns status no_match and an EMPTY list for off-topic input — a matcher that always finds something sends a person with a real problem to read something irrelevant (3 trials)',
    async run() {
      if (!liveReady()) throw new TestSkippedError('staging env not set');
      await clearRateLimit();
      const text = 'I would like to order a pizza for delivery tonight';
      reportDistribution(text, await threeTrials(text), t => t.status === 'no_match' && (t.matches ?? []).length === 0);
    },
  },

  // ── regression: the two defects Phase 4 found in its own code ───────────
  {
    id: 'f25.regression.json-extractor-handles-trailing-prose',
    category: 'faq',
    description: 'REGRESSION (Phase 4, 2026-09-02): both AI-calling functions must extract JSON by walking braces, not by stripping a fence from each end. Haiku answers with fenced JSON FOLLOWED BY PROSE, which made match-faq report "unavailable" — the one status that must mean "nothing was checked" — precisely on the off-topic input where no_match is correct',
    async run() {
      for (const [label, path] of [['match-faq', MATCH_FAQ], ['manage-faq', MANAGE_FAQ]] as const) {
        const src = readFileSync(path, 'utf8');
        expectTruthy(
          src.includes('function extractJson('),
          `${label} must use the brace-walking extractJson helper`,
        );
        expectTruthy(
          !/replace\(\/\^```\(\?:json\)\?\/i, ''\)[\s\S]{0,40}replace\(\/```\$\//.test(src),
          `${label} must NOT strip fences from each end — that is the bug this test exists for`,
        );
      }
    },
  },
  {
    id: 'f25.regression.match-faq-validates-returned-slugs',
    category: 'faq',
    description: 'match-faq discards any slug the model returns that is not a published answer, so an invented answer is structurally impossible rather than merely instructed against (Phase 3 A3)',
    async run() {
      const src = readFileSync(MATCH_FAQ, 'utf8');
      expectTruthy(src.includes('const bySlug = new Map('), 'match-faq must build a lookup of published slugs');
      expectTruthy(
        src.includes('discarded unknown slug from model'),
        'match-faq must discard and log any slug not in the published set',
      );
    },
  },
  {
    id: 'f25.regression.manage-faq-allows-span',
    category: 'faq',
    description: 'REGRESSION (Phase 4, 2026-09-02): the allowed-tag list must include span and must NOT have been left as the asserted six. Phase 2 named a tag set "the existing answers actually use" without checking — code appears zero times, span appears ten, and migrating five answers would have failed',
    async run() {
      const src = readFileSync(MANAGE_FAQ, 'utf8');
      const m = src.match(/const ALLOWED_TAGS = \[([^\]]+)\]/);
      expectTruthy(Boolean(m), 'manage-faq must declare ALLOWED_TAGS');
      const tags = m![1].split(',').map(t => t.trim().replace(/['"]/g, ''));
      for (const required of ['p', 'strong', 'em', 'br', 'span', 'a']) {
        expectTruthy(tags.includes(required), `ALLOWED_TAGS must include "${required}" — it is used by the published answers`);
      }
    },
  },
  {
    id: 'f25.manage-faq-rejects-event-handlers',
    category: 'faq',
    description: 'manage-faq refuses answer HTML carrying an event-handler attribute or a javascript:/data: URL, so an allowed tag cannot smuggle script into a public page',
    async run() {
      const src = readFileSync(MANAGE_FAQ, 'utf8');
      expectTruthy(src.includes('FORBIDDEN_ATTR_RE'), 'manage-faq must reject event-handler attributes');
      expectTruthy(src.includes('FORBIDDEN_URL_RE'), 'manage-faq must reject javascript:/data: URLs');
    },
  },
  {
    id: 'f25.manage-faq-fails-open-on-classifier-outage',
    category: 'faq',
    description: 'Phase 3 A2: a classifier outage must never cost a staffer the answer they wrote. classify() returns null on every failure path and the save proceeds with needs_classification set',
    async run() {
      const src = readFileSync(MANAGE_FAQ, 'utf8');
      expectTruthy(src.includes('needs_classification: !result'), 'create must save with needs_classification when classification failed');
      expectTruthy(src.includes('needsClassification = true'), 'update must flag rather than fail when classification failed');
    },
  },
  {
    id: 'f25.get-faq-has-no-caller-controlled-filtering',
    category: 'faq',
    description: 'Phase 3 A4: get-faq holds service-role privileges against a table clients cannot read, so it must expose a fixed response shape — no caller-supplied select, predicate, ordering or include-inactive flag',
    async run() {
      const src = readFileSync(GET_FAQ, 'utf8');
      expectTruthy(
        src.includes(".select('slug, question, answer_html, categories, search_terms')"),
        'get-faq must use a fixed column list',
      );
      expectTruthy(src.includes(".eq('active', true)"), 'get-faq must only ever return active rows');
      expectTruthy(!/req\.url|searchParams|body\.(select|filter|where|order)/.test(src),
        'get-faq must not read any caller-supplied query shape');
    },
  },

  // ── ordering: the two lists answer different questions ─────────────────
  {
    id: 'f25.ordering.staff-newest-first-customer-oldest-first',
    category: 'faq',
    description:
      'The staff list is newest-first so a just-written answer is at the top instead of below everything already published; the customer page stays oldest-first so the curated order of the 23 migrated answers survives and "What is MyNaavi?" is still met first. Two opposite orders, on purpose — this exists so a future session that makes one match the other breaks a test rather than the page',
    async run() {
      const manage = readFileSync(MANAGE_FAQ, 'utf8');
      const get = readFileSync(GET_FAQ, 'utf8');
      expectTruthy(
        /case 'list':[\s\S]{0,800}?\.order\('created_at', \{ ascending: false \}\)/.test(manage),
        "manage-faq's list op must order created_at descending — newest first for the staffer",
      );
      expectTruthy(
        get.includes(".order('created_at', { ascending: true })"),
        'get-faq must stay ascending — the customer page order is curated and must not be reversed',
      );
    },
  },
  {
    id: 'f25.ordering.live-staff-list-is-the-public-page-reversed',
    category: 'faq',
    description:
      'Proven against the deployed functions rather than the source: the staff list, reduced to published answers, is exactly the public page in reverse. A source assertion cannot tell you what is actually deployed',
    async run() {
      if (!liveReady()) throw new TestSkippedError('staging env not set');
      const [listRes, pubRes] = await Promise.all([
        fetch(`${stagingUrl()}/functions/v1/manage-faq`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${stagingKey()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'list' }),
        }),
        fetch(`${stagingUrl()}/functions/v1/get-faq`),
      ]);
      const list = (await listRes.json()) as { ok?: boolean; items?: { slug: string; active: boolean }[] };
      const pub = (await pubRes.json()) as { ok?: boolean; items?: { slug: string }[] };
      expectTruthy(list.ok === true, 'manage-faq list must return ok');
      expectTruthy(pub.ok === true, 'get-faq must return ok');

      const staffPublished = (list.items ?? []).filter(i => i.active).map(i => i.slug);
      const publicOrder = (pub.items ?? []).map(i => i.slug);
      expectTruthy(publicOrder.length > 1, 'need more than one published answer for an order to mean anything');
      expectTruthy(
        JSON.stringify(staffPublished) === JSON.stringify([...publicOrder].reverse()),
        `the staff list is not the public page reversed.\n  staff:  ${staffPublished.join(', ')}\n  public: ${publicOrder.join(', ')}`,
      );
    },
  },

  // ── the staff category surface ─────────────────────────────────────────
  {
    id: 'f25.staff-page-can-manage-categories',
    category: 'faq',
    description:
      'Phase 0 put the category list in the database so staff would own it, and manage-faq carried the categories and add_category operations from the start — but nothing ever called them, so the list was data no staffer could reach. This asserts the staff page wires both, and that it tells the truth about what adding one does',
    async run() {
      if (!existsSync(STAFF_FAQ)) throw new TestSkippedError('naavi-staff checkout not present beside this repo');
      const src = readFileSync(STAFF_FAQ, 'utf8');
      expectTruthy(src.includes("api('categories')"), 'the staff page must read the category list');
      expectTruthy(src.includes("api('add_category'"), 'the staff page must be able to add a category');
      expectTruthy(src.includes('id="cats-panel"'), 'the category panel must exist in the markup');
      expectTruthy(
        src.includes('category_exists'),
        'a duplicate category must be reported to the staffer, not swallowed into a generic error',
      );
      expectTruthy(
        /next time an answer is saved or sorted/.test(src),
        'the page must say that a new category does not re-sort answers already published — it does not, and a staffer who assumes otherwise will be wrong',
      );
    },
  },
  {
    id: 'f25.staff-category-ops-exist-server-side',
    category: 'faq',
    description:
      'The two operations the category panel depends on, asserted on the server rather than only on the page that calls them — a UI wired to an op that was renamed fails silently at the moment a staffer uses it',
    async run() {
      if (!liveReady()) throw new TestSkippedError('staging env not set');
      const r = await fetch(`${stagingUrl()}/functions/v1/manage-faq`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${stagingKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'categories' }),
      });
      const d = (await r.json()) as { ok?: boolean; categories?: { name: string; active: boolean }[] };
      expectTruthy(d.ok === true, 'the categories op must return ok');
      const names = (d.categories ?? []).map(c => c.name);
      expectTruthy(names.length >= 6, `expected at least the six approved categories, found ${names.length}`);
      for (const required of ['Getting started', 'Talking to MyNaavi', 'Alerts & reminders', 'Messages & lists', 'Calls & briefings', 'Privacy & help']) {
        expectTruthy(names.includes(required), `the approved category "${required}" is missing`);
      }

      // add_category must refuse a duplicate rather than quietly making a
      // second row with the same name — the panel reports 409 to the staffer.
      const dup = await fetch(`${stagingUrl()}/functions/v1/manage-faq`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${stagingKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'add_category', name: 'Getting started' }),
      });
      const dupBody = (await dup.json()) as { error?: string };
      expectTruthy(
        dup.status === 409 && dupBody.error === 'category_exists',
        `a duplicate category must return 409 category_exists, got ${dup.status} ${JSON.stringify(dupBody)}`,
      );
    },
  },

  // ── the live read, and the anchors the mobile app depends on ────────────
  {
    id: 'f25.get-faq-serves-every-anchor-the-app-links-to',
    category: 'faq',
    description: 'Every slug the mobile app deep-links (lib/faq.ts) resolves to a published answer. These are addresses, not internal ids — breaking one silently breaks a link inside the shipped app',
    async run() {
      if (!liveReady()) throw new TestSkippedError('staging env not set');
      const appSlugs = [...readFileSync(join(ROOT, 'lib', 'faq.ts'), 'utf8').matchAll(/slug:\s*'([^']+)'/g)].map(m => m[1]);
      expectTruthy(appSlugs.length === 12, `lib/faq.ts is expected to hold 12 entries; found ${appSlugs.length}`);

      const r = await fetch(`${stagingUrl()}/functions/v1/get-faq`);
      const d = (await r.json()) as { ok?: boolean; items?: { slug: string }[] };
      expectTruthy(d.ok === true, 'get-faq must return ok');
      const live = new Set((d.items ?? []).map(i => i.slug));
      const missing = appSlugs.filter(s => !live.has(s));
      expectTruthy(missing.length === 0, `these app deep-links have no published answer: ${missing.join(', ')}`);
    },
  },
  // ── §10: the answers must stay readable without JavaScript ─────────────
  {
    id: 'f25.seo.answers-present-in-static-html',
    category: 'faq',
    description: '§10: every published answer is baked into faq.html as real HTML, so a crawler that never runs JavaScript still reads the text. The page this replaced carried all 23 statically; shipping the dynamic page alone would have removed the FAQ from search',
    async run() {
      const html = readFileSync(join(WEB, 'faq.html'), 'utf8');
      const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/g, '');
      const count = (withoutScripts.match(/<details id="/g) ?? []).length;
      expectTruthy(count >= 23, `expected at least 23 answers in static HTML, found ${count}`);
      const words = withoutScripts.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').length;
      expectTruthy(words > 1500, `static HTML should carry the answer text; found only ${words} words`);
    },
  },
  {
    id: 'f25.seo.generated-block-is-output-not-a-source',
    category: 'faq',
    description: '§10: the baked answers sit between generator markers and are overwritten on every build. If this ever became hand-authored it would be a second copy of the content with a sync obligation and nothing enforcing it — the exact defect F25 removes',
    async run() {
      const html = readFileSync(join(WEB, 'faq.html'), 'utf8');
      expectTruthy(html.includes('<!-- F25:generated-start -->'), 'faq.html must carry the generator start marker');
      expectTruthy(html.includes('<!-- F25:generated-end -->'), 'faq.html must carry the generator end marker');
      expectTruthy(html.includes('Do NOT edit by hand'), 'the generated block must warn against hand-editing');

      const vercel = JSON.parse(readFileSync(join(WEB, 'vercel.json'), 'utf8'));
      expectTruthy(
        typeof vercel.buildCommand === 'string' && vercel.buildCommand.includes('build-faq'),
        `vercel.json buildCommand must run the generator; found ${JSON.stringify(vercel.buildCommand)}`,
      );
    },
  },
  {
    id: 'f25.seo.failed-fetch-keeps-the-static-answers',
    category: 'faq',
    description: '§10: when the live fetch fails the page must KEEP the generated answers, not replace them with an error. Verified in a browser against an unreachable endpoint on 2026-09-02: 23 answers still shown, anchors intact, controls hidden because they cannot work',
    async run() {
      const html = readFileSync(join(WEB, 'faq.html'), 'utf8');
      expectTruthy(
        html.includes("if (!elItems.querySelector('details'))"),
        'the failure path must only write an error message when there is no generated content to fall back on',
      );
      expectTruthy(
        html.includes('showing the generated copy'),
        'the failure path must log that it fell back rather than failing silently',
      );
    },
  },
  {
    id: 'f25.seo.save-is-not-blocked-by-the-deploy-hook',
    category: 'faq',
    description: '§10: regenerating the crawler copy is triggered by the save, but a slow or broken deploy hook must never cost a staffer their answer. Verified live on 2026-09-02 with VERCEL_DEPLOY_HOOK_URL unset: the save returned ok',
    async run() {
      const src = readFileSync(MANAGE_FAQ, 'utf8');
      expectTruthy(src.includes('async function pingDeployHook('), 'manage-faq must have the deploy-hook helper');
      const helper = src.slice(src.indexOf('async function pingDeployHook('));
      expectTruthy(
        !/throw /.test(helper.slice(0, helper.indexOf('\n}'))),
        'pingDeployHook must never throw — the write has already committed by the time it runs',
      );
      for (const op of ['create', 'update', 'deactivate', 'reactivate']) {
        expectTruthy(src.includes(`pingDeployHook('${op}')`), `the ${op} path must regenerate the crawler copy`);
      }
    },
  },

  // ── Phase 6 mandatory change #1: staleness must be noticeable ──────────
  {
    id: 'f25.staleness.generated-block-carries-a-build-stamp',
    category: 'faq',
    description: 'Phase 6 #1: the generated block carries the time it was written, and manage-faq can parse it. Without a stamp there is no way to tell a fresh page from one whose deploy hook quietly stopped firing',
    async run() {
      const html = readFileSync(join(WEB, 'faq.html'), 'utf8');
      const m = html.match(/<!--\s*F25:generated-at\s+(\S+)\s+count:(\d+)\s*-->/);
      expectTruthy(Boolean(m), 'faq.html must carry an F25:generated-at stamp');
      expectTruthy(!Number.isNaN(new Date(m![1]).getTime()), `the stamp must be a valid date; got "${m![1]}"`);
      expectTruthy(Number(m![2]) > 0, 'the stamp must record how many answers were written');

      const gen = readFileSync(join(WEB, 'build-faq.js'), 'utf8');
      expectTruthy(gen.includes('F25:generated-at'), 'build-faq.js must write the stamp');
    },
  },
  {
    id: 'f25.staleness.reported-by-manage-faq',
    category: 'faq',
    description: 'Phase 6 #1: manage-faq reports whether the public page is behind the newest content change, and reports UNKNOWN rather than healthy when it cannot tell — an automatic process that quietly stops is worse than a manual one, because nobody watches for it',
    async run() {
      if (!liveReady()) throw new TestSkippedError('staging env not set');
      const r = await fetch(`${stagingUrl()}/functions/v1/manage-faq`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${stagingKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'publish_status' }),
      });
      const b = (await r.json()) as Record<string, unknown>;
      expectTruthy(b.ok === true, 'publish_status must respond');
      expectTruthy(
        ['current', 'stale', 'unknown'].includes(String(b.state)),
        `state must be one of current/stale/unknown; got ${b.state}`,
      );
      expectTruthy('hook_configured' in b, 'must report whether the deploy hook is configured at all');
      expectTruthy('last_content_change' in b, 'must report the newest content change to compare against');
      // Unknown must never be dressed up as healthy.
      if (b.page_generated_at === null) {
        expectTruthy(b.state !== 'current', 'a page with no stamp must not be reported as current');
      }
    },
  },
  {
    id: 'f25.staleness.rebuild-refuses-honestly-without-a-hook',
    category: 'faq',
    description: 'Phase 6 #1: the manual recovery path reports hook_not_configured rather than pretending to have triggered a rebuild',
    async run() {
      if (!liveReady()) throw new TestSkippedError('staging env not set');
      const r = await fetch(`${stagingUrl()}/functions/v1/manage-faq`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${stagingKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'rebuild_now' }),
      });
      const b = (await r.json()) as { ok?: boolean; error?: string };
      // With a hook configured this returns ok; without one it must say so.
      expectTruthy(
        b.ok === true || b.error === 'hook_not_configured',
        `expected ok or hook_not_configured; got ${JSON.stringify(b)}`,
      );
    },
  },

  {
    id: 'f25.web-pages-are-wired',
    category: 'faq',
    description: 'The FAQ page reads get-faq and filters locally; both website support forms call match-faq on Send. Source assertions — the pages themselves were verified in a browser (see the Phase 5 evidence)',
    async run() {
      const faq = readFileSync(join(WEB, 'faq.html'), 'utf8');
      expectTruthy(faq.includes('functions/v1/get-faq'), 'faq.html must read get-faq');
      expectTruthy(faq.includes('id="faq-search"') && faq.includes('id="faq-category"'), 'faq.html must have search and a category filter');
      expectTruthy(!faq.includes('application/ld+json'), 'the hand-maintained JSON-LD copy must be gone');

      for (const page of ['report.html', 'contact.html']) {
        const src = readFileSync(join(WEB, page), 'utf8');
        expectTruthy(src.includes('functions/v1/match-faq'), `${page} must call match-faq`);
        expectTruthy(src.includes('if (await faqCheckBlocks()) return;'), `${page} must check on Send`);
        expectTruthy(src.includes("return false;   /* no_match, unavailable, or an error — send it */"),
          `${page} must submit anyway when the matcher finds nothing or cannot run — a customer is never blocked from reaching support`);
      }
    },
  },
];
