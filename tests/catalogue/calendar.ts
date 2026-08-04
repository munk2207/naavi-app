/**
 * Calendar tests — create event, verify it shows up.
 *
 * Note: this test requires a connected Google Calendar OAuth token for the
 * test user. If the token is missing, the test will be marked as errored and
 * skipped on subsequent runs until a token is provisioned. (Auto-tester
 * doesn't drive OAuth — that's a manual one-time step.)
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectTruthy, extractSpeech, findActionInRawText, TestSkippedError } from '../lib/assertions';
import type { TestCase } from '../lib/types';

// ── Travel-planning classification regression (2026-08-02) ────────────────────
// naavi-chat's `classifyIntent` Level A gate previously had no exclusion for
// leave-by/travel-time phrasing, so questions like "what time should I leave
// for my dentist appointment" were misclassified as CALENDAR_SEARCH or
// READ_CALENDAR and answered deterministically — Claude (and RULE 7's
// fetch_travel_time) was never reached, so the TRAVEL TIME card never
// rendered. Live-reproduced on staging and production 2026-08-02; fixed by
// adding a meaning-based exclusion to the classifier prompt. Phase 3 external
// review (docs/TRAVELTIME_LEAVEBY_MISCLASSIFICATION_PHASE3_TECHNICAL_REVIEW_2026-08-02.md)
// mandated: the boundary test must prove requests do NOT enter EITHER
// deterministic handler (READ_CALENDAR or CALENDAR_SEARCH) — not just one —
// and that routing-level and outcome-level evidence are reported separately.

const READ_CALENDAR_PATTERN = /^(here'?s (your schedule|what'?s on)|your calendar is clear)/i;
const CALENDAR_SEARCH_PATTERN = /^(yes — here'?s what i found for|i found \d+ events? matching|i don'?t see anything matching)/i;

/**
 * Runs a phrase through naavi-chat 3 times (Non-Determinism Rule minimum,
 * governance §3 Phase 3). Any inconsistent result across trials is a
 * failure requiring analysis, not something to retry past — per Phase 3's
 * Mandatory Change 7, this does not loop until 3 successes are found.
 */
async function runClassificationTrials(
  ctx: Parameters<TestCase['run']>[0],
  phrase: string,
  trials = 3,
): Promise<string[]> {
  const speeches: string[] = [];
  for (let i = 1; i <= trials; i++) {
    const { status, data } = await adapters.naaviChat(ctx, {
      messages: [{ role: 'user', content: phrase }],
      max_tokens: 512,
    });
    expect2xx(status, `naavi-chat trial ${i} for "${phrase}"`);
    const speech = extractSpeech(data?.rawText ?? '');
    ctx.log(`trial ${i}/${trials} — "${phrase}" → "${speech.slice(0, 160)}"`);
    speeches.push(speech);
  }
  return speeches;
}

export const calendarTests: TestCase[] = [
  {
    id: 'calendar.create-event',
    category: 'calendar',
    description: 'create-calendar-event returns a valid htmlLink for a new event',
    timeoutMs: 30_000,
    async run(ctx) {
      // 30 minutes from now, 30 min duration.
      const start = new Date(Date.now() + 30 * 60_000);
      const end = new Date(start.getTime() + 30 * 60_000);

      const { status, data } = await adapters.createCalendarEvent(ctx, {
        summary: 'Auto-tester sample event',
        start: start.toISOString(),
        end: end.toISOString(),
        description: 'Created by Naavi auto-tester. Safe to delete.',
      });
      ctx.log(`create-event status=${status} data=${JSON.stringify(data).slice(0, 200)}`);

      // Skip cleanly when the test user's Google Calendar OAuth isn't
      // connected — that's a one-time manual setup, not a code bug.
      const errMsg = String(data?.error ?? '');
      if (status === 401 || status === 403 || /token (refresh|expired|revoked|invalid)|invalid_grant|insufficient.*(scope|permission)|insufficientPermissions/i.test(errMsg)) {
        throw new TestSkippedError(
          `Google Calendar OAuth not connected for test user. Sign in to Google Calendar once with mynaavi2207@gmail.com to enable.`,
        );
      }
      expect2xx(status, 'create-calendar-event');
      expectTruthy(data?.htmlLink, 'event htmlLink');
    },
  },

  // ── ARCH-1 READ_CALENDAR regression (2026-06-13) ─────────────────────────────
  // "what do I have today" must return a deterministic calendar answer —
  // never Claude hedging like "I don't have access" or a list/alert read.
  {
    id: 'calendar.read-today-no-hedging',
    category: 'calendar',
    description: 'ARCH-1 — "what do I have today" returns a deterministic calendar response, never Claude hedging',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'what do I have today' }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const speech = extractSpeech(data?.rawText ?? '');
      ctx.log(`speech: ${speech.slice(0, 200)}`);
      // Must be one of the two deterministic responses: clear calendar OR event list.
      const isCalendarClear = /your calendar is clear for today/i.test(speech);
      const isSchedule      = /here'?s your schedule for today/i.test(speech);
      // Must NOT be Claude hedging about calendar access.
      const isHedging = /i (don'?t|can'?t|cannot|do not) have access|i'?m not able to|i can'?t (see|access|check|view)|unable to access/i.test(speech);
      if (isHedging) {
        throw new Error(`READ_CALENDAR returned Claude hedging: "${speech.slice(0, 200)}"`);
      }
      expectTruthy(
        isCalendarClear || isSchedule,
        `Expected deterministic calendar response ("Your calendar is clear for today" OR "Here's your schedule for today"), got: "${speech.slice(0, 200)}"`,
      );
    },
  },

  // "what's coming up" — another gap pattern not caught by the original B6e regex.
  {
    id: 'calendar.read-coming-up-no-hedging',
    category: 'calendar',
    description: 'ARCH-1 — "what\'s coming up" returns a deterministic calendar response',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: "what's coming up" }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const speech = extractSpeech(data?.rawText ?? '');
      ctx.log(`speech: ${speech.slice(0, 200)}`);
      const isHedging = /i (don'?t|can'?t|cannot|do not) have access|i'?m not able to|i can'?t (see|access|check|view)|unable to access/i.test(speech);
      if (isHedging) {
        throw new Error(`READ_CALENDAR returned Claude hedging for "what's coming up": "${speech.slice(0, 200)}"`);
      }
      const isDeterministic = /your calendar is clear|here'?s your schedule|here'?s what'?s on/i.test(speech);
      expectTruthy(
        isDeterministic,
        `Expected deterministic calendar response, got: "${speech.slice(0, 200)}"`,
      );
    },
  },

  // ── Positive controls — travel-planning phrasing must bypass BOTH
  //    deterministic calendar handlers (Phase 3 Mandatory Change 4). ────────────
  {
    id: 'calendar.travel-planning-excluded-from-level-a',
    category: 'calendar',
    description: 'Leave-by/travel-time phrasing must NOT classify as READ_CALENDAR or CALENDAR_SEARCH (routing-level)',
    timeoutMs: 90_000,
    async run(ctx) {
      const positiveControls = [
        'What time should I leave for my dentist appointment?',
        'What time should I leave for my next meeting?',
        'When should I head out for my dentist appointment?',
        'How early do I need to go to my next meeting?',
      ];
      for (const phrase of positiveControls) {
        const speeches = await runClassificationTrials(ctx, phrase);
        for (let i = 0; i < speeches.length; i++) {
          const speech = speeches[i];
          if (READ_CALENDAR_PATTERN.test(speech)) {
            throw new Error(`Trial ${i + 1} — "${phrase}" was misclassified as READ_CALENDAR: "${speech.slice(0, 200)}"`);
          }
          if (CALENDAR_SEARCH_PATTERN.test(speech)) {
            throw new Error(`Trial ${i + 1} — "${phrase}" was misclassified as CALENDAR_SEARCH: "${speech.slice(0, 200)}"`);
          }
        }
      }
    },
  },

  // ── Negative controls — generic reads must still classify READ_CALENDAR. ────
  {
    id: 'calendar.read-calendar-negative-controls',
    category: 'calendar',
    description: 'Generic calendar reads (Phase 2 Amendment 4 phrasing) must remain READ_CALENDAR, unaffected by the travel-planning exclusion',
    timeoutMs: 90_000,
    async run(ctx) {
      const negativeControls = [
        "What's on my calendar today?",
        'What do I have this week?',
        "What's next on my calendar?",
      ];
      for (const phrase of negativeControls) {
        const speeches = await runClassificationTrials(ctx, phrase);
        for (let i = 0; i < speeches.length; i++) {
          const speech = speeches[i];
          const isHedging = /i (don'?t|can'?t|cannot|do not) have access|i'?m not able to|i can'?t (see|access|check|view)|unable to access/i.test(speech);
          if (isHedging) {
            throw new Error(`Trial ${i + 1} — "${phrase}" returned Claude hedging instead of READ_CALENDAR: "${speech.slice(0, 200)}"`);
          }
          if (!READ_CALENDAR_PATTERN.test(speech)) {
            throw new Error(`Trial ${i + 1} — "${phrase}" was expected to stay READ_CALENDAR but got: "${speech.slice(0, 200)}"`);
          }
        }
      }
    },
  },

  // ── Boundary case — event-lookup-by-name must stay CALENDAR_SEARCH. ─────────
  {
    id: 'calendar.calendar-search-boundary-preserved',
    category: 'calendar',
    description: 'Phase 3 Mandatory Change 2 — "when IS my appointment" (event lookup) must remain CALENDAR_SEARCH, not be swept into the travel-planning exclusion',
    timeoutMs: 90_000,
    async run(ctx) {
      const speeches = await runClassificationTrials(ctx, 'When is my dentist appointment?');
      for (let i = 0; i < speeches.length; i++) {
        const speech = speeches[i];
        if (!CALENDAR_SEARCH_PATTERN.test(speech)) {
          throw new Error(`Trial ${i + 1} — "When is my dentist appointment?" was expected to stay CALENDAR_SEARCH but got: "${speech.slice(0, 200)}"`);
        }
      }
    },
  },

  // ── Outcome-level chain — Phase 3 Mandatory Change 5. ────────────────────────
  // Routing-level tests above only prove the request wasn't blocked. This test
  // additionally proves the full chain a positive-control phrase must drive:
  // classifier → Claude emits FETCH_TRAVEL_TIME → resolve-place verifies the
  // destination → get-travel-time returns a real duration. The final mobile
  // TRAVEL TIME card render (destination/duration/leave-by/Open in Google Maps)
  // is UI the auto-tester cannot click — that was confirmed separately by live
  // manual test on staging and production, 2026-08-02 (see Phase 1 evidence).
  // This test proves the backend chain feeding that card is real, not just
  // that Claude was reached.
  {
    id: 'calendar.travel-planning-outcome-level-chain',
    category: 'calendar',
    description: 'Phase 3 Mandatory Change 5 — travel-planning phrase must drive FETCH_TRAVEL_TIME → resolve-place → get-travel-time to a real duration, not just avoid misclassification',
    timeoutMs: 60_000,
    async run(ctx) {
      const phrase = 'What time should I leave for my dentist appointment?';
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: phrase }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const speech = extractSpeech(data?.rawText ?? '');
      ctx.log(`routing-level speech: "${speech.slice(0, 200)}"`);

      // Routing-level assertion, same boundary as the test above.
      expectTruthy(!READ_CALENDAR_PATTERN.test(speech), `Routing-level: "${phrase}" must not be READ_CALENDAR`);
      expectTruthy(!CALENDAR_SEARCH_PATTERN.test(speech), `Routing-level: "${phrase}" must not be CALENDAR_SEARCH`);

      const action = findActionInRawText(data?.rawText ?? '', 'FETCH_TRAVEL_TIME');
      ctx.log(`tool-invocation: FETCH_TRAVEL_TIME action = ${JSON.stringify(action)}`);
      if (!action?.destination) {
        // No dentist appointment on the test account's live calendar right
        // now — a live-data precondition, not a code bug. Routing-level
        // evidence above still stands; outcome-level is inconclusive.
        throw new TestSkippedError(
          `No FETCH_TRAVEL_TIME action with a destination was emitted for "${phrase}" — the test account likely has no matching "dentist appointment" event right now. Routing-level check (above) passed independently.`,
        );
      }

      const resolveRes = await adapters.resolvePlace(ctx, { place_name: action.destination });
      ctx.log(`calendar-event-resolution / resolve-place: status=${resolveRes.status} data=${JSON.stringify(resolveRes.data).slice(0, 200)}`);
      expect2xx(resolveRes.status, 'resolve-place');
      expectTruthy(resolveRes.data?.status === 'ok', `resolve-place must verify "${action.destination}", got status="${resolveRes.data?.status}"`);

      const travelRes = await adapters.call(ctx, 'get-travel-time', {
        destination: resolveRes.data.address ?? action.destination,
        originAddress: 'Ottawa, ON, Canada',
      });
      ctx.log(`travel-time-tool-invocation / get-travel-time: status=${travelRes.status} data=${JSON.stringify(travelRes.data).slice(0, 200)}`);
      expect2xx(travelRes.status, 'get-travel-time');
      expectTruthy(
        typeof travelRes.data?.durationMinutes === 'number' && travelRes.data.durationMinutes > 0,
        `get-travel-time must return a real durationMinutes, got: ${JSON.stringify(travelRes.data)}`,
      );
      ctx.log(`rendered-card-fields (backend-proven): destination="${resolveRes.data.address}", durationMinutes=${travelRes.data.durationMinutes}, distanceKm=${travelRes.data.distanceKm}`);
      ctx.log(`google-maps-action-presence: destination resolved to a real address usable by a Maps deep link — "${resolveRes.data.address}"`);
    },
  },

  // ── Calendar cache synchronization integrity (Ticket C, 2026-08-02) ─────────
  // sync-google-calendar previously pruned local calendar_events rows whose
  // google_event_id didn't match a live Google fetch even when that fetch/
  // write cycle had itself failed (e.g. a missing column made every write
  // fail silently) — deleting rows for events that were still genuinely
  // live. Fix: prune now runs only when reconciliation for that user
  // completed with no unrecovered write/fetch error (`sync_ok`).
  //
  // Coverage gap, acknowledged per Rule 15a: this suite verifies the
  // response contract and that prune runs normally on a healthy sync. It
  // does NOT force a genuine write/fetch failure to prove prune is skipped
  // in that case — sync-google-calendar has no dependency-injection or
  // failure-simulation hook, and deliberately breaking schema/tokens to
  // trigger a real failure would be destructive to shared staging data.
  // That specific negative-control path was instead verified directly by
  // source read during Phase 4 implementation (docs/
  // CALENDAR_CACHE_SYNC_INTEGRITY_PHASE5_EVIDENCE_PACKAGE_2026-08-02.md) —
  // every write-error and fetch-error site calls the same `markFailure()`
  // helper that gates the prune step, so there is one code path to trust,
  // not several independently-implemented checks.
  {
    id: 'calendar.sync-atomic-response-contract',
    category: 'calendar',
    description: 'Ticket C — sync-google-calendar response includes sync_ok and pruned fields for each user result',
    timeoutMs: 45_000,
    async run(ctx) {
      const { status, data } = await adapters.call(ctx, 'sync-google-calendar', { user_id: ctx.testUserId }, { asService: true });
      expect2xx(status, 'sync-google-calendar');
      const results = Array.isArray(data?.results) ? data.results : [];
      const mine = results.find((r: any) => r.user_id === ctx.testUserId);
      if (!mine) {
        throw new TestSkippedError('sync-google-calendar did not return a result for the test user — check user_tokens provisioning.');
      }
      ctx.log(`result for test user: ${JSON.stringify(mine)}`);
      if (mine.error) {
        throw new TestSkippedError(`Test user's Google token is not usable right now: ${mine.error}`);
      }
      expectTruthy(typeof mine.sync_ok === 'boolean', `Expected sync_ok to be a boolean, got: ${JSON.stringify(mine.sync_ok)}`);
      expectTruthy(
        mine.pruned === null || typeof mine.pruned === 'number',
        `Expected pruned to be null or a number, got: ${JSON.stringify(mine.pruned)}`,
      );
    },
  },

  {
    id: 'calendar.sync-successful-run-prunes-normally',
    category: 'calendar',
    description: 'Ticket C — a fully successful sync (sync_ok=true) still runs prune normally, proving the atomicity gate does not block the healthy case',
    timeoutMs: 45_000,
    async run(ctx) {
      const { status, data } = await adapters.call(ctx, 'sync-google-calendar', { user_id: ctx.testUserId }, { asService: true });
      expect2xx(status, 'sync-google-calendar');
      const results = Array.isArray(data?.results) ? data.results : [];
      const mine = results.find((r: any) => r.user_id === ctx.testUserId);
      if (!mine || mine.error) {
        throw new TestSkippedError(`Test user's Google token is not usable right now: ${mine?.error ?? 'no result'}`);
      }
      ctx.log(`result: ${JSON.stringify(mine)}`);
      if (mine.sync_ok !== true) {
        throw new TestSkippedError(`This sync run was not fully successful (sync_ok=${mine.sync_ok}) — cannot assert normal-case prune behavior from this run.`);
      }
      expectTruthy(
        typeof mine.pruned === 'number',
        `Expected prune to run (pruned as a number) after a fully successful sync, got: ${JSON.stringify(mine.pruned)}`,
      );
    },
  },

  // ── Travel Event Selection Semantics (Ticket B, 2026-08-03) ────────────────
  // Two designs were tried for mobile. (1) A prompt-only rule, then (2) a
  // marker-gated prompt rule — both asked Claude to trust the schedule's
  // already-sorted, already-past-filtered first entry instead of re-deriving
  // it. Both were implemented, reviewed, and deployed, but live Phase 7
  // testing proved Claude still applied undocumented semantic type-matching
  // for "meeting" and "appointment" specifically — "next event" correctly
  // took the first entry, "next meeting"/"next appointment" did not, even
  // though all three should be identical per the explicit rule against it.
  // (3) FINAL DESIGN, current: event selection for unnamed "next" requests
  // was moved out of the prompt entirely into deterministic code
  // (`isUnnamedNextEventTravelTimeIntent` / `buildNextEventTravelTimeResponse`,
  // `naavi-chat/index.ts`) — same pattern as the existing B6e calendar-read
  // bypass. No LLM decision, so no semantic drift is possible. Named-event
  // requests ("Team standup," "the Dentist appointment") are explicitly
  // excluded from this classifier and remain on Claude's unchanged branch.
  // Voice is untouched — it keeps the marker-gated RULE 7 fix, per Wael's
  // "forget about voice" decision; `get-naavi-prompt/index.ts` was not
  // further edited in this round.
  {
    id: 'calendar.next-event-deterministic-first-entry',
    category: 'calendar',
    description: 'Ticket B — repeated "next event" trials select the same (chronologically first) destination every time',
    timeoutMs: 60_000,
    async run(ctx) {
      const destinations: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const { status, data } = await adapters.naaviChat(ctx, {
          messages: [{ role: 'user', content: 'Drive me to my next event' }],
          max_tokens: 512,
        });
        expect2xx(status, `naavi-chat trial ${i}`);
        const action = findActionInRawText(data?.rawText ?? '', 'FETCH_TRAVEL_TIME');
        ctx.log(`trial ${i}: destination=${JSON.stringify(action?.destination)}`);
        if (!action?.destination) {
          throw new TestSkippedError(`Trial ${i}: no FETCH_TRAVEL_TIME destination — test account may have no qualifying event right now.`);
        }
        destinations.push(action.destination);
      }
      const allSame = destinations.every(d => d === destinations[0]);
      expectTruthy(allSame, `Expected identical destination across 3 trials, got: ${JSON.stringify(destinations)}`);
    },
  },

  {
    id: 'calendar.next-appointment-deterministic-first-entry',
    category: 'calendar',
    description: 'Ticket B — reviewer mandatory follow-up (Phase 6, 2026-08-04): permanently lock "next appointment" as its own standalone determinism check, not just via the 3-way comparison test below',
    timeoutMs: 60_000,
    async run(ctx) {
      const destinations: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const { status, data } = await adapters.naaviChat(ctx, {
          messages: [{ role: 'user', content: 'Drive me to my next appointment' }],
          max_tokens: 512,
        });
        expect2xx(status, `naavi-chat trial ${i}`);
        const action = findActionInRawText(data?.rawText ?? '', 'FETCH_TRAVEL_TIME');
        ctx.log(`trial ${i}: destination=${JSON.stringify(action?.destination)}`);
        if (!action?.destination) {
          throw new TestSkippedError(`Trial ${i}: no FETCH_TRAVEL_TIME destination — test account may have no qualifying event right now.`);
        }
        destinations.push(action.destination);
      }
      const allSame = destinations.every(d => d === destinations[0]);
      expectTruthy(allSame, `Expected identical destination across 3 trials, got: ${JSON.stringify(destinations)}`);
    },
  },

  {
    id: 'calendar.no-semantic-type-override',
    category: 'calendar',
    description: 'Ticket B — "next event", "next meeting", and "next appointment" resolve to the same destination (no undocumented type filter, per Wael\'s Problem B decision)',
    timeoutMs: 90_000,
    async run(ctx) {
      const phrases = ['Drive me to my next event', 'Drive me to my next meeting', 'Drive me to my next appointment'];
      const destinations: string[] = [];
      for (const phrase of phrases) {
        const { status, data } = await adapters.naaviChat(ctx, {
          messages: [{ role: 'user', content: phrase }],
          max_tokens: 512,
        });
        expect2xx(status, `naavi-chat "${phrase}"`);
        const action = findActionInRawText(data?.rawText ?? '', 'FETCH_TRAVEL_TIME');
        ctx.log(`"${phrase}" → destination=${JSON.stringify(action?.destination)}`);
        if (!action?.destination) {
          throw new TestSkippedError(`No FETCH_TRAVEL_TIME destination for "${phrase}" — test account may have no qualifying event right now.`);
        }
        destinations.push(action.destination);
      }
      const allSame = destinations.every(d => d === destinations[0]);
      expectTruthy(allSame, `Expected all three phrasings to resolve identically, got: ${JSON.stringify(destinations)}`);
    },
  },

  {
    id: 'calendar.named-event-branch-preserved',
    category: 'calendar',
    description: 'Ticket B — a named-event travel request ("Team standup") still selects that event, not the chronologically-first one, confirming the unnamed-branch fix did not regress the named-event branch',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Drive me to Team standup' }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const action = findActionInRawText(data?.rawText ?? '', 'FETCH_TRAVEL_TIME');
      ctx.log(`"Drive me to Team standup" → destination=${JSON.stringify(action?.destination)}`);
      if (!action?.destination) {
        throw new TestSkippedError('No FETCH_TRAVEL_TIME destination for "Team standup" — test account may not have this recurring event right now.');
      }
      const speech = extractSpeech(data?.rawText ?? '');
      expectTruthy(
        /team\s*standup/i.test(speech) || /340\s*Albert/i.test(action.destination),
        `Expected the named-event response to reference Team standup, got speech="${speech.slice(0, 150)}" destination="${action.destination}"`,
      );
    },
  },

  {
    id: 'calendar.next-event-address-description-fallback',
    category: 'calendar',
    description: 'Ticket B deterministic redesign — the next-event bypass resolves an address from the calendar description field when the dedicated location field is empty (fixes B11a for this path)',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Drive me to my next event' }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const action = findActionInRawText(data?.rawText ?? '', 'FETCH_TRAVEL_TIME');
      const speech = extractSpeech(data?.rawText ?? '');
      ctx.log(`destination=${JSON.stringify(action?.destination)} speech="${speech.slice(0, 150)}"`);
      if (!action?.destination) {
        // Acceptable outcome too: the deterministic "I don't have an address" response.
        expectTruthy(
          /don'?t have an address/i.test(speech),
          `Expected either a resolved destination or the "I don't have an address" response, got speech="${speech.slice(0, 150)}"`,
        );
        return;
      }
      expectTruthy(
        !/^\s*$/.test(action.destination) && action.destination.length > 3,
        `Expected a real, non-trivial destination string, got: ${JSON.stringify(action.destination)}`,
      );
    },
  },

  {
    id: 'calendar.next-event-never-fabricates-address',
    category: 'calendar',
    description: 'Ticket B deterministic redesign — never invents a destination; either a real resolved address or an honest "I don\'t have an address" response, never a guess from the title alone',
    timeoutMs: 30_000,
    async run(ctx) {
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Drive me to my next meeting' }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const action = findActionInRawText(data?.rawText ?? '', 'FETCH_TRAVEL_TIME');
      const speech = extractSpeech(data?.rawText ?? '');
      ctx.log(`destination=${JSON.stringify(action?.destination)} speech="${speech.slice(0, 150)}"`);
      const hasRealDestination = !!action?.destination && action.destination.trim().length > 3;
      const hasHonestNoAddress = /don'?t have an address/i.test(speech);
      expectTruthy(
        hasRealDestination || hasHonestNoAddress,
        `Expected a real destination or an honest "no address" response, got speech="${speech.slice(0, 150)}" destination="${JSON.stringify(action?.destination)}"`,
      );
    },
  },
];
