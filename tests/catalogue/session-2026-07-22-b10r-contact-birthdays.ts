/**
 * B10r regression tests — Contacts is authoritative for birthday/anniversary
 * dates, never Calendar (Wael 2026-07-22).
 *
 * Locks in the fix: `global-search/adapters/contacts.ts` now requests
 * `birthdays,events` from the Google People API and surfaces a real
 * "Birthday: <date>" / "Anniversary: <date>" fact in the [contacts] result's
 * snippet — a year is only ever shown if Google Contacts actually has one on
 * file (never borrowed from Calendar's "next occurrence" computation).
 *
 * Root cause this replaces: the only prior source for a birthday/anniversary
 * was a recurring "X's Birthday" Google Calendar entry, whose date is the
 * next UPCOMING occurrence within the search window — not the person's real
 * birth/anniversary year. Live evidence (2026-07-21/22): a contact with
 * birthday Jan 15 1948 was read back by Naavi as "Jan 15, 2027".
 *
 * ── Coverage gaps acknowledged (Rule 15a exception path) ───────────────────
 * Google Contacts data (birthdays, anniversaries) lives entirely in the
 * test user's real, live Google account — there is no DB table this test
 * harness can seed a fake birthday into (unlike `gmail_messages` or
 * `action_rules`, which the suite seeds directly elsewhere in this
 * catalogue). The calendar adapter this bug's symptom came from ALSO calls
 * the live Google Calendar API directly, not a seedable table — so a true
 * positive-control test (a contact with a known 1948 birthday, confirmed by
 * name, confirmed year in the response) can only run if the auto-tester's
 * connected Google account happens to have such a contact.
 *
 * This file therefore does two things, not one:
 *   1. A named-contact test targeting "Fatma Elmehelmy" (the real contact
 *      from this bug's live evidence) — if she exists in the test account's
 *      Google Contacts, this asserts the exact fix (year 1948, not 2027).
 *      If she is NOT in this account, the test SKIPS cleanly (does not fail
 *      the suite) and logs that fact — this is a real coverage gap, not a
 *      simulated pass.
 *   2. A format-safety test that runs against WHATEVER contacts the test
 *      account actually has: any "Birthday:"/"Anniversary:" fragment found
 *      in any [contacts] result, across a handful of common-letter queries,
 *      must match a valid "Mon Day" / "Mon Day, Year" shape. This is a real
 *      invariant regardless of which contact it happens to hit, and guards
 *      against a malformed/fabricated date resurfacing in a different form.
 *
 * Surfaced to Wael per Rule 15a: full positive-control coverage (test #1
 * actually asserting, not skipping) depends on whether "Fatma Elmehelmy" —
 * or any contact with a known stored birth year — exists in whichever
 * Google account `mynaavi2207@gmail.com` (the auto-tester's test user, per
 * CLAUDE.md, corrected 2026-07-22) is connected to. This was not confirmed
 * before writing this file.
 *
 * ── Addendum 2, 2026-07-22 (calendar.ts year-strip) ────────────────────────
 * Two more tests below cover the follow-on fix found during this file's own
 * Phase 4 testing: Calendar's own adapter must never show a year for a
 * RECURRING birthday/anniversary-titled event (Google's next-occurrence
 * artifact), while still keeping the year for (a) a genuine one-time event
 * that happens to mention "birthday" in its title, and (b) a recurring
 * event that isn't birthday/anniversary-titled. Unlike the Contacts tests
 * above, these have **no coverage gap** — each test creates its own
 * throw-away calendar event via `create-calendar-event` and deletes it in a
 * `finally` block, so they don't depend on any pre-existing account data.
 *
 * ── B10w, 2026-07-22 (lookup-contact additive birthday/anniversary) ────────
 * B10r's fix never reached voice, because voice's `arch1HandlePersonLookup`
 * short-circuits through `lookup-contact` (name/email/phone only) before
 * ever calling `global-search`. B10w adds `birthday`/`anniversary` fields to
 * `lookup-contact`'s own response instead (via the extracted
 * `_shared/contact_date_facts.ts`, also now used by `contacts.ts`), so no
 * second lookup is needed. Two tests below: a positive control against
 * "Bob" (confirmed present with a real birthday/anniversary on the staging
 * account this same session, via direct mobile test) and a format-safety
 * net matching the pattern already established above for `contacts.ts`.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectMatch, expectTruthy, TestSkippedError } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

// "Jan 15" or "Jan 15, 1948" — never a bare year, never a malformed month.
const DATE_FACT_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}(, \d{4})?$/;

function uniqueTag(): string {
  return `b10r ${Date.now()} ${Math.floor(Math.random() * 10000)}`;
}

// All-day event ~10 days out, per CLAUDE.md's documented birthday format
// (date-only YYYY-MM-DD, end = next day, Google treats end as exclusive).
function nearFutureAllDay(): { start: string; end: string } {
  const d = new Date(); d.setDate(d.getDate() + 10);
  const iso = d.toISOString().slice(0, 10);
  const d2 = new Date(d); d2.setDate(d2.getDate() + 1);
  const iso2 = d2.toISOString().slice(0, 10);
  return { start: iso, end: iso2 };
}

async function createEvent(
  ctx: TestContext,
  args: { summary: string; recurring: boolean },
): Promise<void> {
  const { start, end } = nearFutureAllDay();
  const { status } = await adapters.call(ctx, 'create-calendar-event', {
    user_id: ctx.testUserId,
    summary: args.summary,
    start,
    end,
    ...(args.recurring ? { recurrence: ['RRULE:FREQ=YEARLY'] } : {}),
  });
  expect2xx(status, `create-calendar-event "${args.summary}"`);
}

function extractCalendarSnippets(rankedAny: unknown, titleTag: string): string[] {
  if (!Array.isArray(rankedAny)) return [];
  return rankedAny
    .filter((r: any) => r?.source === 'calendar' && typeof r?.title === 'string' && r.title.includes(titleTag))
    .map((r: any) => r.snippet as string);
}

// `delete-calendar-event` has been observed to hang for 40s+ on this staging
// account (found 2026-07-22, unrelated to this fix — likely accumulated test
// data slowing its own search-then-delete logic; tracked separately).
// Fire-and-forget rather than await: cleanup should never consume the
// test's own timeout budget or turn a passing assertion into a false TIMEOUT.
function cleanupEventFireAndForget(ctx: TestContext, query: string): void {
  adapters.deleteCalendarEvent(ctx, query).catch(() => {});
}

const YEAR_RE = /\b(19|20)\d{2}\b/;

function extractContactSnippets(rankedAny: unknown): string[] {
  if (!Array.isArray(rankedAny)) return [];
  return rankedAny
    .filter((r: any) => r?.source === 'contacts' && typeof r?.snippet === 'string')
    .map((r: any) => r.snippet as string);
}

function findDateFactFragments(snippets: string[], label: 'Birthday' | 'Anniversary'): string[] {
  const out: string[] = [];
  for (const snippet of snippets) {
    for (const part of snippet.split(' · ')) {
      if (part.startsWith(`${label}: `)) out.push(part.slice(`${label}: `.length));
    }
  }
  return out;
}

export const b10rContactBirthdaysTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────
  // Positive control (may skip — see "Coverage gaps acknowledged" above).
  // If the test account's Google Contacts has "Fatma Elmehelmy" with the
  // birthday/anniversary from this bug's live evidence, this asserts the
  // exact fix: real year (1948/1982), never Calendar's computed 2027/2026.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'b10r.contacts-birthday-real-year-not-calendar-computed',
    category: 'b10r-contact-birthdays',
    description: '2026-07-22 — named contact with a known birthday shows the real stored year, never a Calendar next-occurrence year',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.globalSearch(ctx, 'Fatma Elmehelmy');
      expect2xx(status, 'global-search');
      const ranked = (data as any)?.ranked;
      const snippets = extractContactSnippets(ranked);
      ctx.log(`contact snippets: ${JSON.stringify(snippets)}`);

      if (snippets.length === 0) {
        throw new TestSkippedError(
          'No "Fatma Elmehelmy" contact found in the test account\'s Google Contacts — cannot assert the exact fix (real stored year vs. Calendar-computed year) without this named contact. Coverage gap: see file header.',
        );
      }

      const birthdays = findDateFactFragments(snippets, 'Birthday');
      if (birthdays.length === 0) {
        throw new TestSkippedError(
          '"Fatma Elmehelmy" found, but no Birthday field is set on that contact in this test account — cannot assert the exact fix. Coverage gap: see file header.',
        );
      }

      for (const b of birthdays) {
        expectMatch(b, DATE_FACT_RE, 'contacts Birthday fragment shape');
      }
      // The specific regression this bug fixed: must never be the Calendar
      // "next occurrence" year (2027) that was live-observed as the bug.
      const hasWrongComputedYear = birthdays.some(b => b.includes('2027'));
      if (hasWrongComputedYear) {
        throw new Error(`Birthday fragment still shows the Calendar-computed year (2027), not a real stored year: ${JSON.stringify(birthdays)}`);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Format-safety net — runs regardless of which specific contacts exist.
  // Whatever Birthday/Anniversary fragments surface, they must be shaped
  // like a real date fact, never malformed or a bare fabricated year.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'b10r.contacts-date-fact-format-never-fabricated',
    category: 'b10r-contact-birthdays',
    description: '2026-07-22 — any Birthday/Anniversary fragment across common contact queries is well-formed ("Mon Day" or "Mon Day, Year"), never a bare/malformed year',
    timeoutMs: 30_000,
    async run(ctx) {
      const queries = ['a', 'e', 'contact'];
      let checked = 0;
      for (const q of queries) {
        const { status, data } = await adapters.globalSearch(ctx, q);
        expect2xx(status, 'global-search');
        const snippets = extractContactSnippets((data as any)?.ranked);
        const facts = [
          ...findDateFactFragments(snippets, 'Birthday'),
          ...findDateFactFragments(snippets, 'Anniversary'),
        ];
        for (const f of facts) {
          expectMatch(f, DATE_FACT_RE, `date-fact fragment for query "${q}"`);
          checked++;
        }
      }
      ctx.log(`checked ${checked} birthday/anniversary fragment(s) across ${queries.length} queries`);
      if (checked === 0) {
        throw new TestSkippedError(
          'No contact in this test account has a Birthday or Anniversary on file across the sampled queries — format-safety net had nothing to check. Coverage gap: see file header.',
        );
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Addendum 2 — calendar.ts year-strip. Positive case: a RECURRING
  // birthday/anniversary-titled event must show no year (Test Plan #1/#2).
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'b10r.calendar-recurring-birthday-anniversary-no-year',
    category: 'b10r-contact-birthdays',
    description: '2026-07-22 (Addendum 2) — recurring birthday/anniversary calendar events show no year (Calendar year is never a real fact for these)',
    timeoutMs: 45_000,
    async run(ctx) {
      const tag = uniqueTag();
      const birthdayTitle = `AutoTest Birthday ${tag}`;
      const anniversaryTitle = `AutoTest Anniversary ${tag}`;
      await createEvent(ctx, { summary: birthdayTitle, recurring: true });
      await createEvent(ctx, { summary: anniversaryTitle, recurring: true });
      try {
        const { status, data } = await adapters.globalSearch(ctx, tag);
        expect2xx(status, 'global-search');
        const ranked = (data as any)?.ranked;
        const birthdaySnippets = extractCalendarSnippets(ranked, birthdayTitle);
        const anniversarySnippets = extractCalendarSnippets(ranked, anniversaryTitle);
        ctx.log(`birthday snippets: ${JSON.stringify(birthdaySnippets)}, anniversary snippets: ${JSON.stringify(anniversarySnippets)}`);

        if (birthdaySnippets.length === 0 && anniversarySnippets.length === 0) {
          throw new TestSkippedError(
            'Neither test calendar event was found by global-search (Google indexing lag or the event fell outside the search window) — cannot assert the fix this run.',
          );
        }
        for (const s of [...birthdaySnippets, ...anniversarySnippets]) {
          expectTruthy(!YEAR_RE.test(s), `recurring birthday/anniversary event snippet must have no year, got: ${JSON.stringify(s)}`);
        }
      } finally {
        cleanupEventFireAndForget(ctx, birthdayTitle);
        cleanupEventFireAndForget(ctx, anniversaryTitle);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Addendum 2 — false-positive-avoidance net (Test Plan #3/#4/#5). Neither
  // a one-time birthday-titled event nor a recurring non-birthday event
  // should lose its year — only the recurring+birthday-titled combination.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'b10r.calendar-year-strip-false-positive-avoidance',
    category: 'b10r-contact-birthdays',
    description: '2026-07-22 (Addendum 2) — a one-time birthday-titled event and a recurring non-birthday event both keep their year; only recurring+birthday-titled loses it',
    timeoutMs: 45_000,
    async run(ctx) {
      const tag = uniqueTag();
      const oneTimeBirthdayTitle = `AutoTest Birthday Party ${tag}`; // one-time, no recurrence
      const recurringPlainTitle  = `AutoTest Standup ${tag}`;        // recurring, no birthday wording
      await createEvent(ctx, { summary: oneTimeBirthdayTitle, recurring: false });
      await createEvent(ctx, { summary: recurringPlainTitle, recurring: true });
      try {
        const { status, data } = await adapters.globalSearch(ctx, tag);
        expect2xx(status, 'global-search');
        const ranked = (data as any)?.ranked;
        const oneTimeSnippets  = extractCalendarSnippets(ranked, oneTimeBirthdayTitle);
        const recurringSnippets = extractCalendarSnippets(ranked, recurringPlainTitle);
        ctx.log(`one-time birthday-party snippets: ${JSON.stringify(oneTimeSnippets)}, recurring plain-event snippets: ${JSON.stringify(recurringSnippets)}`);

        if (oneTimeSnippets.length === 0 && recurringSnippets.length === 0) {
          throw new TestSkippedError(
            'Neither test calendar event was found by global-search (Google indexing lag or the event fell outside the search window) — cannot assert this run.',
          );
        }
        for (const s of oneTimeSnippets) {
          expectTruthy(YEAR_RE.test(s), `one-time birthday-titled event (no recurrence) must KEEP its year, got: ${JSON.stringify(s)}`);
        }
        for (const s of recurringSnippets) {
          expectTruthy(YEAR_RE.test(s), `recurring non-birthday event must KEEP its year, got: ${JSON.stringify(s)}`);
        }
      } finally {
        cleanupEventFireAndForget(ctx, oneTimeBirthdayTitle);
        cleanupEventFireAndForget(ctx, recurringPlainTitle);
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // B10w — positive control. "Bob" is a real MyNaavi-labelled contact with
  // a known birthday + anniversary on the staging test account (confirmed
  // this session via direct mobile test). Asserts lookup-contact's own
  // response now carries both — the exact gap voice's short-circuit hid.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'b10w.lookup-contact-additive-birthday-anniversary',
    category: 'b10r-contact-birthdays',
    description: '2026-07-22 (B10w) — lookup-contact\'s own response includes birthday/anniversary for a known contact, not just name/phone/email',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.lookupContact(ctx, 'Bob');
      expect2xx(status, 'lookup-contact');
      const contacts = Array.isArray((data as any)?.contacts)
        ? (data as any).contacts
        : ((data as any)?.contact ? [(data as any).contact] : []);
      ctx.log(`lookup-contact "Bob" → ${JSON.stringify(contacts.map((c: any) => ({ name: c.name, birthday: c.birthday, anniversary: c.anniversary })))}`);

      if (contacts.length === 0) {
        throw new TestSkippedError(
          'No "Bob" contact found via lookup-contact in this test account — cannot assert the additive fields without this known contact. Coverage gap: see file header.',
        );
      }
      const bob = contacts.find((c: any) => typeof c.birthday === 'string' || typeof c.anniversary === 'string') ?? contacts[0];
      if (!bob.birthday && !bob.anniversary) {
        throw new TestSkippedError(
          '"Bob" found via lookup-contact, but neither birthday nor anniversary is present on the response — cannot assert the fix. Coverage gap: see file header.',
        );
      }
      if (bob.birthday) expectMatch(bob.birthday, DATE_FACT_RE, 'lookup-contact birthday field shape');
      if (bob.anniversary) expectMatch(bob.anniversary, DATE_FACT_RE, 'lookup-contact anniversary field shape');
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // B10w — format-safety net for lookup-contact, same pattern as the
  // contacts.ts net above. Runs regardless of which contacts exist.
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'b10w.lookup-contact-date-fact-format-never-fabricated',
    category: 'b10r-contact-birthdays',
    description: '2026-07-22 (B10w) — any lookup-contact birthday/anniversary field across common queries is well-formed, never a bare/malformed year',
    timeoutMs: 30_000,
    async run(ctx) {
      const queries = ['a', 'e', 'bob'];
      let checked = 0;
      for (const q of queries) {
        const { status, data } = await adapters.lookupContact(ctx, q);
        expect2xx(status, 'lookup-contact');
        const contacts = Array.isArray((data as any)?.contacts)
          ? (data as any).contacts
          : ((data as any)?.contact ? [(data as any).contact] : []);
        for (const c of contacts) {
          if (typeof c.birthday === 'string') {
            expectMatch(c.birthday, DATE_FACT_RE, `lookup-contact birthday field for query "${q}"`);
            checked++;
          }
          if (typeof c.anniversary === 'string') {
            expectMatch(c.anniversary, DATE_FACT_RE, `lookup-contact anniversary field for query "${q}"`);
            checked++;
          }
        }
      }
      ctx.log(`checked ${checked} lookup-contact birthday/anniversary field(s) across ${queries.length} queries`);
      if (checked === 0) {
        throw new TestSkippedError(
          'No contact returned by lookup-contact across the sampled queries has a birthday or anniversary field set — format-safety net had nothing to check. Coverage gap: see file header.',
        );
      }
    },
  },
];
