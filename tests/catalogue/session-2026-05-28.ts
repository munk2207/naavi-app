/**
 * Session 2026-05-28 — regression coverage for B6d, B6e, B4s, B4y Phase 2, B-NEW-1.
 *
 * B-NEW-1: Contact search token punctuation bug — "Find Hussein, spelled h u s s e i n"
 * produced token "n," (trailing comma, length 2, not filtered). "n," appears as a
 * substring of "ON, Canada" in every Ontario contact's formatted address →
 * addressTokenMatch fired for all Ontario contacts → irrelevant contacts scored 0.75
 * and appeared alongside Hussein in results.
 * Fix: tokensFromVariants in contacts.ts strips leading/trailing non-alphanumeric
 * chars before the length check — "n," → "n" (length 1, filtered).
 * Also: "hussein," → "hussein" so the name now correctly matches "hussein el-aggan".
 *
 * B6d: Expanded numbered-list rule from choices-only (v98) to ALL lists (v99).
 * display field now uses 1./2./3. numbering, never bullet glyphs (•/-/*).
 * Fix: PROMPT_VERSION 2026-05-28-v99-all-lists-numbered in get-naavi-prompt.
 * Regression tests also in prompt-regression.ts (b6d-display-uses-numbers-*).
 *
 * B6e: "What is on my calendar this week?" reliably misrouted to LIST_READ /
 * LIST_RULES at the 111 KB assembled prompt (Haiku attention loss on long
 * context). Root cause confirmed 2026-05-26: three explicit prompt rules
 * instructing "calendar queries → read the Schedule section" were ignored.
 * Fix: server-side pre-Claude bypass in naavi-chat (commit bf906c4) —
 * isCalendarReadIntent() detects the query, fetchLiveCalendarEvents() answers
 * deterministically. Claude is never called → impossible to misroute.
 * Deployed as part of B4y Phase 2 naavi-chat deploy (commit 494baeb).
 *
 * B4y Phase 2: Universal RULE 23 confirm-then-act gate covering CREATE_EVENT,
 * DELETE_EVENT, DELETE_RULE, DELETE_MEMORY, UPDATE_MORNING_CALL,
 * SCHEDULE_MEDICATION, and non-email SET_ACTION_RULE triggers.
 * Tests in tests/catalogue/confirm-then-act.ts (b4z.* tests added 2026-05-28).
 *
 * B-NEW-2 (community context in Claude): fetchOtherContacts was missing
 * "memberships" in readMask → isCommunity always false for other-contacts bucket.
 * Fix part 1 (server): added "memberships" to readMask (contacts.ts:165).
 * Fix part 2 (mobile): useOrchestrator.ts pre-search result formatter now appends
 * "[MyNaavi Community member]" or "[not in MyNaavi Community]" to contact lines
 * so Claude can read community status and follow the community prompt rules.
 *
 * Coverage gap acknowledged (Rule 15a exception):
 *   B-NEW-2 mobile formatter: useOrchestrator.ts pre-search formatting is mobile
 *   client code not reachable from the Node auto-tester. Server-side fix (memberships
 *   in readMask) is covered by the b-new-2-contacts-adapter-reachable test (2xx check).
 *   Mobile formatter verified by Wael on next APK install via community tests.
 *
 * Run via `npm run test:auto -- --grep session-2026-05-28`.
 */

import { adapters } from '../lib/adapters';
import {
  expect2xx,
  expectTruthy,
  findActionInRawText,
  extractSpeech,
} from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const session2026_05_28Tests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // B6e — calendar-read pre-Claude bypass (commit bf906c4, deployed 2026-05-28)
  // Regression: "what is on my calendar this week?" must NOT route to LIST_READ.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'session-2026-05-28.b6e-calendar-query-no-list-read',
    category: 'session-2026-05-28',
    description: 'B6e: "what is on my calendar this week?" must NOT emit LIST_READ — bypass returns calendar content directly',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'What is on my calendar this week?' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 400)}…`);

      // Must NOT have emitted LIST_READ — that was the bug.
      const listRead = findActionInRawText(rawText, 'LIST_READ');
      if (listRead) {
        throw new Error(
          `B6e regression: calendar query emitted LIST_READ instead of returning calendar content. ` +
          `Action: ${JSON.stringify(listRead)}. rawText: ${rawText.slice(0, 300)}`,
        );
      }

      // Must NOT have emitted LIST_RULES either (second misroute pattern).
      const listRules = findActionInRawText(rawText, 'LIST_RULES');
      if (listRules) {
        throw new Error(
          `B6e regression: calendar query emitted LIST_RULES instead of returning calendar content. ` +
          `Action: ${JSON.stringify(listRules)}. rawText: ${rawText.slice(0, 300)}`,
        );
      }

      // Speech must reference a calendar-shaped response (schedule / calendar /
      // clear / event — not a list of items from a named list).
      const speech = extractSpeech(rawText).toLowerCase();
      ctx.log(`speech: ${speech.slice(0, 200)}`);
      expectTruthy(
        /schedule|calendar|event|appointment|meeting|clear/.test(speech),
        `B6e: speech doesn't look like a calendar reply. Speech: "${speech.slice(0, 200)}"`,
      );
    },
  },

  {
    id: 'session-2026-05-28.b6e-today-calendar-no-list-read',
    category: 'session-2026-05-28',
    description: 'B6e: "what is on my calendar today?" must NOT emit LIST_READ',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'What is on my calendar today?' }],
        max_tokens: 1024,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 400)}…`);

      const listRead = findActionInRawText(rawText, 'LIST_READ');
      if (listRead) {
        throw new Error(
          `B6e regression (today variant): calendar query emitted LIST_READ. ` +
          `Action: ${JSON.stringify(listRead)}. rawText: ${rawText.slice(0, 300)}`,
        );
      }

      const speech = extractSpeech(rawText).toLowerCase();
      expectTruthy(
        /schedule|calendar|event|appointment|meeting|clear/.test(speech),
        `B6e: today variant speech doesn't look like a calendar reply. Speech: "${speech.slice(0, 200)}"`,
      );
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // B6d v99 — ALL lists and choices must be numbered (not bullets)
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'session-2026-05-28.b6d-prompt-version-v100',
    category: 'session-2026-05-28',
    description: 'Nav-disambiguation v101 — PROMPT_VERSION must be 2026-06-06-v105-numbered-lists-final-reminder',
    timeoutMs: 15_000,
    async run(ctx) {
      const { status, data } = await adapters.call(
        ctx, 'get-naavi-prompt', { channel: 'app' }, { timeoutMs: 15_000 },
      );
      expect2xx(status, 'get-naavi-prompt');
      const version: string = data?.version ?? '';
      ctx.log(`version: ${version}`);
      expectTruthy(
        version === '2026-06-06-v105-numbered-lists-final-reminder',
        `Expected version "2026-06-06-v105-numbered-lists-final-reminder", got "${version}"`,
      );
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // MyNaavi Community — regression tests (2026-05-28)
  //
  // The community feature uses Google Contacts label "MyNaavi" to mark VIP
  // contacts. Community members receive a 1.5x score boost in search results.
  // ADD_TO_COMMUNITY executes server-side in naavi-chat (requires Google
  // OAuth write scope: contacts). Voice server has the tool defined but
  // execution is deferred (voice has no Google write path yet).
  // ──────────────────────────────────────────────────────────────────────

  {
    id: 'session-2026-05-28.community-prompt-has-section',
    category: 'session-2026-05-28',
    description: 'Community: get-naavi-prompt must contain MYNAAVI COMMUNITY section and add_to_community mention',
    timeoutMs: 15_000,
    async run(ctx) {
      const { status, data } = await adapters.call(
        ctx, 'get-naavi-prompt', { channel: 'app' }, { timeoutMs: 15_000 },
      );
      expect2xx(status, 'get-naavi-prompt');
      const prompt: string = data?.prompt ?? '';
      ctx.log(`prompt length: ${prompt.length}`);
      expectTruthy(
        prompt.toLowerCase().includes('mynaavi community'),
        'Prompt must contain "MYNAAVI COMMUNITY" section',
      );
      expectTruthy(
        prompt.includes('add_to_community'),
        'Prompt must mention the add_to_community tool',
      );
    },
  },

  {
    id: 'session-2026-05-28.community-no-add-without-resource-name',
    category: 'session-2026-05-28',
    description: 'Community: cold "add Bob to community" (no prior search) must NOT emit ADD_TO_COMMUNITY',
    timeoutMs: 30_000,
    async run(ctx) {
      // A cold request with no resource_name available must NOT emit ADD_TO_COMMUNITY.
      // The prompt rule: "Always use the contact's resourceName from a prior contact search result."
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Add Bob to my MyNaavi community.' }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const rawText = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 400)}…`);

      // Must NOT emit ADD_TO_COMMUNITY — no resource_name is available.
      const communityAction = findActionInRawText(rawText, 'ADD_TO_COMMUNITY');
      if (communityAction) {
        throw new Error(
          `Community regression: ADD_TO_COMMUNITY emitted without resource_name from prior search. ` +
          `Action: ${JSON.stringify(communityAction)}`,
        );
      }

      // Speech should acknowledge the request but ask to search/find the contact first.
      const speech = extractSpeech(rawText).toLowerCase();
      ctx.log(`speech: ${speech.slice(0, 200)}`);
      expectTruthy(
        speech.length > 0,
        'Community: speech must not be empty when ADD_TO_COMMUNITY is blocked',
      );
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // B-NEW-2 — community detection: fetchOtherContacts missing memberships
  //
  // fetchOtherContacts used readMask without "memberships". Any contact in
  // the Other Contacts bucket had p.memberships=undefined → isCommunity=false
  // even when the MyNaavi label was present in Google Contacts.
  // Fix: added "memberships" to readMask in fetchOtherContacts (contacts.ts:165).
  //
  // Coverage gap: this test calls global-search but cannot assert is_community
  // without knowing which contacts in mynaavi2207's account have the label.
  // The test verifies the endpoint remains reachable after the change.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'session-2026-05-28.b-new-2-contacts-adapter-reachable',
    category: 'session-2026-05-28',
    description: 'B-NEW-2: global-search contacts adapter returns 2xx after memberships added to fetchOtherContacts readMask',
    timeoutMs: 20_000,
    async run(ctx) {
      const { status } = await adapters.globalSearch(ctx, 'Hussein');
      expect2xx(status, 'global-search contacts reachability after B-NEW-2 fix');
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // B-NEW-1 — contact search token punctuation bug (2026-05-28)
  //
  // Voice query "Find Hussein, spelled h u s s e i n, in my contacts"
  // produced token "n," (trailing comma kept by old tokensFromVariants).
  // "n," is a substring of "ON, Canada" in every Ontario address →
  // addressTokenMatch fired for all Ontario contacts → false positives.
  // Fix: strip leading/trailing non-alphanumeric chars from each token.
  //
  // Coverage gap: the contacts adapter hits Google People API (real OAuth).
  // This test uses a provably-absent name so the result count must be 0
  // regardless of which contacts are in the test account.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'session-2026-05-28.b-new-1-spelled-query-no-false-contacts',
    category: 'session-2026-05-28',
    description: 'B-NEW-1: voice "spelled" query for nonsense name must return 0 contacts, not Ontario false matches',
    timeoutMs: 20_000,
    async run(ctx) {
      // "Xqzqzqzq" cannot exist in any real contact list.
      // The trailing "n," in the query was the token that matched Ontario addresses.
      const { status, data } = await adapters.globalSearch(ctx, 'Xqzqzqzq, spelled h u s s e i n,');
      expect2xx(status, 'global-search');
      const groups = ((data as any)?.groups ?? {}) as Record<string, unknown[]>;
      const contactHits = Array.isArray(groups['contacts']) ? groups['contacts'] : [];
      ctx.log(`contact hits for nonsense+spelled query: ${contactHits.length}`);
      if (contactHits.length > 0) {
        throw new Error(
          `B-NEW-1 regression: query with "spelled n," noise returned ${contactHits.length} contacts. ` +
          `Expected 0. First hit: ${JSON.stringify(contactHits[0]).slice(0, 200)}`,
        );
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // B-NEW-5 — fetchLiveCalendarEvents fetches ALL calendars (2026-05-29)
  //
  // Previously hardcoded to calendars/primary/events. Events on family /
  // shared / subscribed calendars (e.g. 'Pick up Lila') were invisible
  // to Naavi when answering 'drive me to my next meeting'.
  // Fix: calendarList call → parallel per-calendar fetch → dedup by ID.
  //
  // Coverage gap (Rule 15a exception): cannot assert cross-calendar
  // coverage without knowing which calendars are in mynaavi2207's
  // account. The test verifies naavi-chat returns a 2xx response for a
  // calendar query — structural health check only. Wael verifies the
  // 4-event result live on the phone.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'session-2026-05-28.b-new-5-calendar-all-calendars-reachable',
    category: 'session-2026-05-28',
    description: 'B-NEW-5: naavi-chat returns 2xx for a calendar schedule query after all-calendars fix',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'What is on my calendar today?' }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat calendar query after B-NEW-5 all-calendars fix');
    },
  },
];
