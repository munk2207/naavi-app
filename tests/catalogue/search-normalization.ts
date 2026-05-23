/**
 * Search-query normalization tests — Wael 2026-05-10.
 *
 * Locks in the fix for the "email about X" noise-prefix bug discovered
 * during Wael's deep test on 2026-05-10. The pre-search query at
 * hooks/useOrchestrator.ts strips "do I have" but leaves "email about" as
 * a literal prefix. The gmail adapter then does ILIKE %email about X%
 * against the email subject "X" — and returns 0 hits even though the
 * email exists.
 *
 * Live diagnosis from Supabase function_logs:
 *   query="email about birthday party" → gmail:0 results (despite a real
 *   "Birthday Party" email being in gmail_messages).
 *   query="email about hockey game"    → gmail:0 results too — only saved
 *   by the drive adapter accidentally finding an unrelated "Naavi
 *   Conversation" doc that contained the word "hockey".
 *
 * The fix lives in supabase/functions/global-search/query_expansion.ts —
 * strip the noise prefix before generating variants. These tests assert
 * that natural-language email queries reach the gmail_messages store via
 * the gmail adapter.
 *
 * Each test inserts a unique gmail_messages row, calls global-search with
 * the noisy phrasing, asserts ≥1 gmail hit, and cleans up. Using a unique
 * subject suffix per test means existing user data does not pollute the
 * result count.
 */

import { adapters, db } from '../lib/adapters';
import { expect2xx, expectTruthy } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

function uniqueTag(): string {
  return `searchnorm-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function insertTestEmail(
  ctx: TestContext,
  args: { subject: string; gmailMessageId: string },
): Promise<void> {
  await db.insert(ctx, 'gmail_messages', {
    user_id: ctx.testUserId,
    gmail_message_id: args.gmailMessageId,
    thread_id: args.gmailMessageId, // unique thread_id avoids any conflict
    subject: args.subject,
    sender_name: 'Auto Tester',
    sender_email: 'autotester@example.com',
    snippet: 'Test email body for search normalization regression test.',
    body_text: 'Test email body for search normalization regression test.',
    received_at: new Date().toISOString(),
    is_unread: false,
    is_important: false,
    is_tier1: true,
    signal_strength: 'personal',
    labels: [],
    updated_at: new Date().toISOString(),
  });
}

async function deleteTestEmail(ctx: TestContext, gmailMessageId: string): Promise<void> {
  await db.delete(
    ctx,
    'gmail_messages',
    `user_id=eq.${ctx.testUserId}&gmail_message_id=eq.${gmailMessageId}`,
  );
}

function gmailHitTitleMatches(rankedAny: unknown, subject: string): boolean {
  if (!Array.isArray(rankedAny)) return false;
  return rankedAny.some(
    (r: any) => r?.source === 'gmail' && typeof r?.title === 'string' && r.title.includes(subject),
  );
}

export const searchNormalizationTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // Wael's actual failure case: "email about <topic>" must reach the
  // gmail adapter. Before the fix this returns 0 gmail hits because the
  // ILIKE pattern is %email about birthday party% against subject
  // "Birthday Party". After the fix the prefix is stripped and the
  // variant becomes "birthday party" → matches.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'search-normalization.email-about-prefix-strip',
    category: 'search-normalization',
    description: '2026-05-10 — "email about <topic>" reaches gmail adapter (prefix stripped from query)',
    timeoutMs: 30_000,
    async run(ctx) {
      const tag = uniqueTag();
      const subject = `Birthday Party ${tag}`;
      const gmailMessageId = `test-${tag}`;
      await insertTestEmail(ctx, { subject, gmailMessageId });
      try {
        const { status, data } = await adapters.globalSearch(ctx, `email about birthday party ${tag}`);
        expect2xx(status, 'global-search');
        const ranked = (data as any)?.ranked;
        ctx.log(`ranked count=${Array.isArray(ranked) ? ranked.length : 'n/a'}`);
        expectTruthy(
          gmailHitTitleMatches(ranked, subject),
          `expected ≥1 gmail hit with subject "${subject}" — noise prefix "email about" must be stripped before ILIKE`,
        );
      } finally {
        await deleteTestEmail(ctx, gmailMessageId);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Determiner + noun variants must also strip ("any email", "an email",
  // "the email", "any emails", "my emails"). These all came up during
  // the diagnosis discussion as natural phrasings users will hit.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'search-normalization.any-email-about-prefix-strip',
    category: 'search-normalization',
    description: '2026-05-10 — "any email about <topic>" reaches gmail adapter',
    timeoutMs: 30_000,
    async run(ctx) {
      const tag = uniqueTag();
      const subject = `Football Game ${tag}`;
      const gmailMessageId = `test-${tag}`;
      await insertTestEmail(ctx, { subject, gmailMessageId });
      try {
        const { status, data } = await adapters.globalSearch(ctx, `any email about football game ${tag}`);
        expect2xx(status, 'global-search');
        const ranked = (data as any)?.ranked;
        ctx.log(`ranked count=${Array.isArray(ranked) ? ranked.length : 'n/a'}`);
        expectTruthy(
          gmailHitTitleMatches(ranked, subject),
          `expected ≥1 gmail hit with subject "${subject}" — "any email about" prefix must strip`,
        );
      } finally {
        await deleteTestEmail(ctx, gmailMessageId);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // "regarding" / "on" variants must strip too. Less common but the
  // normalization should be uniform.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'search-normalization.email-regarding-prefix-strip',
    category: 'search-normalization',
    description: '2026-05-10 — "email regarding <topic>" reaches gmail adapter',
    timeoutMs: 30_000,
    async run(ctx) {
      const tag = uniqueTag();
      const subject = `Dinner Meeting ${tag}`;
      const gmailMessageId = `test-${tag}`;
      await insertTestEmail(ctx, { subject, gmailMessageId });
      try {
        const { status, data } = await adapters.globalSearch(ctx, `email regarding dinner meeting ${tag}`);
        expect2xx(status, 'global-search');
        const ranked = (data as any)?.ranked;
        ctx.log(`ranked count=${Array.isArray(ranked) ? ranked.length : 'n/a'}`);
        expectTruthy(
          gmailHitTitleMatches(ranked, subject),
          `expected ≥1 gmail hit with subject "${subject}" — "email regarding" prefix must strip`,
        );
      } finally {
        await deleteTestEmail(ctx, gmailMessageId);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Wael 2026-05-22 — "Do I have contact name Bob" failure case. Claude
  // passed query="name Bob" to global_search; the contacts adapter did
  // a literal substring match on "name bob" against every contact name
  // and returned 0 hits while Bob was in Google Contacts. The fix is in
  // CONTACT_NOISE_PREFIX_RE — "name <X>" / "contact named <X>" /
  // "the contact <X>" must all yield bare "<X>" as a variant.
  //
  // We assert via the GMAIL adapter (the only adapter the test runner
  // can seed). Gmail uses the same expandQuery variants, so if the
  // noise prefix is stripped the variant "bob <tag>" reaches the
  // ILIKE clause and matches the seeded subject.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'search-normalization.contact-name-prefix-strip',
    category: 'search-normalization',
    description: '2026-05-22 — "contact name <X>" / "name <X>" reaches adapters (contact-shaped prefix stripped)',
    timeoutMs: 30_000,
    async run(ctx) {
      const tag = uniqueTag();
      const subject = `Bob ${tag}`;
      const gmailMessageId = `test-${tag}`;
      await insertTestEmail(ctx, { subject, gmailMessageId });
      try {
        const { status, data } = await adapters.globalSearch(ctx, `contact name Bob ${tag}`);
        expect2xx(status, 'global-search');
        const ranked = (data as any)?.ranked;
        ctx.log(`ranked count=${Array.isArray(ranked) ? ranked.length : 'n/a'}`);
        expectTruthy(
          gmailHitTitleMatches(ranked, subject),
          `expected ≥1 gmail hit with subject "${subject}" — "contact name" prefix must strip so "Bob ${tag}" matches subject`,
        );
      } finally {
        await deleteTestEmail(ctx, gmailMessageId);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Negative case — a query that already lacks the prefix must still
  // match. Guards against an over-eager strip that mangles clean queries.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'search-normalization.bare-topic-still-matches',
    category: 'search-normalization',
    description: '2026-05-10 — bare topic query (no prefix) still matches gmail adapter (no over-strip regression)',
    timeoutMs: 30_000,
    async run(ctx) {
      const tag = uniqueTag();
      const subject = `Buying Home ${tag}`;
      const gmailMessageId = `test-${tag}`;
      await insertTestEmail(ctx, { subject, gmailMessageId });
      try {
        const { status, data } = await adapters.globalSearch(ctx, `buying home ${tag}`);
        expect2xx(status, 'global-search');
        const ranked = (data as any)?.ranked;
        ctx.log(`ranked count=${Array.isArray(ranked) ? ranked.length : 'n/a'}`);
        expectTruthy(
          gmailHitTitleMatches(ranked, subject),
          `expected ≥1 gmail hit with subject "${subject}" — bare topic query must still match`,
        );
      } finally {
        await deleteTestEmail(ctx, gmailMessageId);
      }
    },
  },
];
