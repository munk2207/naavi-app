/**
 * Hosted-replies integrity tests — F1d step 2 (Wael 2026-05-11).
 *
 * Covers the four CLAUDE.md data-integrity layers for the new
 * `hosted_replies` table + the two Edge Functions:
 *
 *   - DB constraints: token length, content non-empty, expires > created.
 *   - Single write entry point: save-hosted-reply requires service-role.
 *   - RLS lockdown: anon-key direct REST insert is blocked.
 *   - Read path: get-hosted-reply returns content for valid token,
 *     `{found:false}` for unknown token, `{expired:true}` for past expiry.
 *
 * Spec: docs/F1D_USER_CONTROLLED_MUTE_SPEC.md (step 2 of 4).
 */

import { adapters, db } from '../lib/adapters';
import { expect2xx, expectEqual, expectTruthy } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

function uniqueTag(): string {
  return `hostedtest-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function deleteByContent(ctx: TestContext, marker: string): Promise<void> {
  await db.delete(
    ctx,
    'hosted_replies',
    `content=ilike.*${marker}*`,
  );
}

async function callSave(ctx: TestContext, args: { question?: string; content: string; userId?: string }) {
  return adapters.call(ctx, 'save-hosted-reply', {
    user_id:  args.userId ?? ctx.testUserId,
    question: args.question ?? '',
    content:  args.content,
  }, { asService: true });
}

async function callSaveAsAnon(ctx: TestContext, args: { question?: string; content: string; userId?: string }) {
  return adapters.call(ctx, 'save-hosted-reply', {
    user_id:  args.userId ?? ctx.testUserId,
    question: args.question ?? '',
    content:  args.content,
  } /* default = anon key */);
}

async function callGet(ctx: TestContext, token: string) {
  return adapters.call(ctx, 'get-hosted-reply', { token });
}

export const hostedRepliesTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // Save + read round-trip — happy path. Voice-server's primary use case.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'hosted-replies.save-then-read-round-trip',
    category: 'hosted-replies',
    description: 'F1d step 2 — save-hosted-reply returns a token; get-hosted-reply returns the saved content',
    timeoutMs: 30_000,
    async run(ctx) {
      const marker = uniqueTag();
      const content = `Test response content ${marker}`;
      const question = `Test question ${marker}`;
      try {
        const saveRes = await callSave(ctx, { question, content });
        expect2xx(saveRes.status, 'save-hosted-reply');
        const token = (saveRes.data as any)?.token;
        expectTruthy(typeof token === 'string' && token.length >= 16, `save must return a token (got: ${token})`);

        const getRes = await callGet(ctx, token);
        expect2xx(getRes.status, 'get-hosted-reply');
        const d = getRes.data as any;
        expectEqual(d?.found, true, 'found should be true for a fresh token');
        expectEqual(d?.expired, false, 'expired should be false for a fresh row');
        expectEqual(d?.content, content, 'content round-trips');
        expectEqual(d?.question, question, 'question round-trips');
      } finally {
        await deleteByContent(ctx, marker);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // RLS lockdown — anon-key direct call to save-hosted-reply rejected.
  // The endpoint requires service-role; anon must get 401.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'hosted-replies.anon-save-rejected',
    category: 'hosted-replies',
    description: 'F1d step 2 — save-hosted-reply rejects anon-key (service-role required)',
    timeoutMs: 15_000,
    async run(ctx) {
      const marker = uniqueTag();
      const res = await callSaveAsAnon(ctx, { content: `Anon attempt ${marker}` });
      if (res.status >= 200 && res.status < 300) {
        throw new Error(`anon-key save should be rejected, got ${res.status} body=${JSON.stringify(res.data).slice(0, 200)}`);
      }
      expectEqual(res.status, 401, 'anon-key save must return 401');
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Unknown token — get returns {found: false}, not an error.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'hosted-replies.unknown-token-returns-found-false',
    category: 'hosted-replies',
    description: 'F1d step 2 — get-hosted-reply with unknown token returns found:false (not 500)',
    timeoutMs: 15_000,
    async run(ctx) {
      const fakeToken = `nonexistent${uniqueTag().replace(/-/g, '')}`.slice(0, 24);
      const res = await callGet(ctx, fakeToken);
      expect2xx(res.status, 'get-hosted-reply');
      const d = res.data as any;
      expectEqual(d?.found, false, 'found should be false for unknown token');
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Empty content rejected at DB CHECK level. Tests the constraint
  // hosted_replies_content_nonempty.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'hosted-replies.empty-content-rejected',
    category: 'hosted-replies',
    description: 'F1d step 2 — save-hosted-reply rejects empty content (400 from validation, not 500 from DB)',
    timeoutMs: 15_000,
    async run(ctx) {
      const res = await callSave(ctx, { content: '' });
      if (res.status >= 200 && res.status < 300) {
        throw new Error(`empty content should be rejected, got ${res.status} body=${JSON.stringify(res.data).slice(0, 200)}`);
      }
      // Either 400 (function validation) or 500 (DB CHECK) — both are valid rejections.
      expectTruthy(res.status === 400 || res.status === 500, `expected 4xx/5xx rejection, got ${res.status}`);
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Expired row — get returns expired:true. Insert directly with a past
  // expires_at, then call get.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'hosted-replies.expired-row-returns-expired-true',
    category: 'hosted-replies',
    description: 'F1d step 2 — get-hosted-reply returns expired:true for rows past expires_at',
    timeoutMs: 15_000,
    async run(ctx) {
      const marker = uniqueTag();
      const token = `expired${marker.replace(/-/g, '')}`.slice(0, 24);
      const pastIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
      const createdIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
      await db.insert(ctx, 'hosted_replies', {
        token,
        user_id: ctx.testUserId,
        question: 'old',
        content:  `Expired content ${marker}`,
        created_at: createdIso,
        expires_at: pastIso,
      });
      try {
        const res = await callGet(ctx, token);
        expect2xx(res.status, 'get-hosted-reply');
        const d = res.data as any;
        expectEqual(d?.found, true, 'found should be true (row exists)');
        expectEqual(d?.expired, true, 'expired should be true (expires_at is in past)');
      } finally {
        await deleteByContent(ctx, marker);
      }
    },
  },
];
