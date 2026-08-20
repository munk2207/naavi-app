# B10r — Phase 2 (Addendum 2 scope): Change Planning

**Date:** 2026-07-22
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.7, Phase 2
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4
**Scope:** only Addendum 2's new work (`supabase/functions/global-search/adapters/calendar.ts`). The original B10r scope (`contacts.ts`, `get-naavi-prompt`, the Phase-1-fast-path enrichment) is already implemented and not reopened here.

No code was written in producing this document.

---

## Design decision: gate the year-strip on `recurringEventId`, not title text alone

**Current code** (`calendar.ts:280-292`, re-verified this session, unchanged since Phase 1):
```ts
const startISO = e.start?.dateTime ?? e.start?.date ?? undefined;
const endISO   = e.end?.dateTime   ?? e.end?.date   ?? undefined;
const dateStr = startISO
  ? new Date(startISO).toLocaleDateString('en-US', {
      month: 'short',
      day:   'numeric',
      year:  'numeric',
    })
  : '';
```

**Naive alternative considered and rejected: gate on the event title alone** (`/\b(birthday|anniversary|bday)\b/i.test(e.summary)`). Rejected because it produces a real false positive: a user-created **one-time** event like "Sarah's 50th Birthday Party" on a specific real date has a year the user *deliberately* entered — stripping it would misrepresent a genuine fact, the opposite failure mode Rule 18 exists to prevent, just in the other direction. Title text alone cannot distinguish "the auto-generated recurring Contacts-birthdays calendar entry" (Google's next-occurrence artifact) from "a real one-time event whose title happens to mention a birthday."

**Chosen design: title match AND `recurringEventId` presence.** Google's Calendar API sets `recurringEventId` on every expanded instance of a recurring event (via `singleEvents=true`, already used by this adapter) — present only on instances, absent on standalone events. Combining both signals means the year is stripped **only** for a recurring event whose title says birthday/anniversary — precisely the "Contacts' birthdays" auto-calendar shape this bug is about — and never for a genuine one-time event.

```ts
type GoogleEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  attendees?: Array<{ email?: string; displayName?: string }>;
  start?: { dateTime?: string; date?: string };
  end?:   { dateTime?: string; date?: string };
  htmlLink?: string;
  organizer?: { email?: string; displayName?: string };
  recurringEventId?: string; // NEW — present only on expanded instances of a recurring event
};
```
```ts
// B10r (Addendum 2) — a recurring "X's Birthday"/"X's Anniversary" instance's
// date is only ever the NEXT OCCURRENCE within the search window, never the
// person's real birth/anniversary year (Google's singleEvents expansion has
// no access to an origin year for these). Never assert that computed year as
// a fact (CLAUDE.md Rule 18) — Contacts (contacts.ts) is the real source for
// the year. Gated on recurringEventId (present only on recurring instances)
// AND the title, so a genuine one-time birthday-titled event keeps its year.
const isRecurringBirthdayOrAnniversary =
  !!e.recurringEventId && /\b(birthday|anniversary|bday)\b/i.test(e.summary ?? '');
const dateStr = startISO
  ? new Date(startISO).toLocaleDateString('en-US', {
      month: 'short',
      day:   'numeric',
      ...(isRecurringBirthdayOrAnniversary ? {} : { year: 'numeric' as const }),
    })
  : '';
```

Every other line in the file is unchanged.

---

## Files that will change

| File | Classification | Change |
|---|---|---|
| `supabase/functions/global-search/adapters/calendar.ts` | Backend (Shared Core) | Add `recurringEventId?: string` to the `GoogleEvent` type; add the `isRecurringBirthdayOrAnniversary` check; conditionally omit `year` from `dateStr`'s formatting options. No other logic in the file changes. |
| `tests/catalogue/session-2026-07-22-b10r-contact-birthdays.ts` | Test infra | Add calendar-adapter-specific cases (see Test Plan below) — same file as the original B10r tests, extended rather than a new file, since it's the same feature's test suite. |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | Docs | Update B10r's entry after successful completion. |

**No other files change.** No migration, no cron, no mobile client file, no voice-server file, no `intentHandlers.ts` change (deliberately — see Addendum 2's decision to fix at the source instead).

---

## Test Plan

1. Recurring event (`recurringEventId` present), title `"Fatma Elmehelmy's Birthday"`, next occurrence 2027-01-15 → `dateStr` = `"Jan 15"`, no year.
2. Recurring event, title contains `"Anniversary"` → same (no year).
3. Non-recurring event (no `recurringEventId`), title `"Team Meeting"` → `dateStr` unchanged, keeps year — confirms no regression to the common case.
4. Non-recurring event, title `"Sarah's 50th Birthday Party"` (no `recurringEventId`) → `dateStr` **keeps** the year — confirms the false-positive-avoidance design decision actually holds, not just claimed.
5. Recurring event (`recurringEventId` present) whose title does **not** mention birthday/anniversary (e.g. a recurring "Weekly Standup") → `dateStr` keeps year — confirms `recurringEventId` alone isn't sufficient, the title check still gates it.

---

## Risk classification: Medium

Not **Low**: modifies a Shared Core Edge Function (`calendar.ts`) that is Protected Core (Calendar integration, per Architecture Reference §4) — Full Phase 1-8 applies regardless of how small the diff is, per this project's own established pattern (size of change and required rigor are not correlated in this codebase's history).

Not **High**: no schema/cron/API-contract-shape change — the `SearchResult` object's shape is identical; only the *content* of `snippet`'s date portion changes, and only for one narrowly-gated event type. No write path is touched (`create-calendar-event`/`delete-calendar-event` untouched). No Protected Core file beyond the one already flagged.

---

## Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | **No** | No client file changes — confirmed by the same consumer trace as the original B10r scope; mobile forwards `snippet` generically. |
| Voice | **No** | Confirmed — both voice's Claude-injection formatter and its own `arch1HandlePersonLookup` (per Phase 1A's Addendum 2 finding) forward `snippet` generically; neither needs a code change. |
| Shared Core | Yes | `global-search/adapters/calendar.ts` only. |
| Database | No | |
| Cron | No | |
| API contracts | **No** — distinct from the original B10r scope's `contacts.ts` change. That change added new fields (an API-contract addition). This change alters the *content* of an existing field (`snippet`) for one gated case; the `SearchResult` shape itself is unchanged. |
| Tests | Yes | New cases added to the existing B10r test file (Rule 15a). |

**Duplicated capability — will both implementations change?** N/A — `calendar.ts` is genuinely shared, not duplicated (confirmed in Phase 1A). The newly-found ARCH-1/Layer-2 duplication (B10t) is **not** being unified by this change — both `handlePersonLookup` and `arch1HandlePersonLookup` continue to exist independently; they simply stop receiving a false year from this one source, which is the intended, narrower fix.

---

## Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** Yes — `calendar.ts`.
- **Does this change modify an Entry Point?** No.
- **Does this change introduce new duplication?** No.
- **Does this change eliminate existing duplication?** No — B10t (the ARCH-1/Layer-2 duplication) remains, deliberately deferred per Phase 1A.
- **Does this change modify Protected Core?** Yes — Calendar integration. Full Phase 1-8 applies, already in effect for this addendum.

---

## Regression Impact

| Area | Affected? |
|---|---|
| Voice commands | Content only — voice's spoken answer for a recurring birthday/anniversary query loses the false year; no mechanism/code change in voice itself. |
| Geofencing | No |
| Gmail integration | No |
| Calendar integration | **Yes, narrowly** — only Global-Search-triggered reads of recurring birthday/anniversary-titled events lose their year. `create-calendar-event`, `delete-calendar-event`, and the separate `fetchLiveCalendarEvents` mechanism (used for the system prompt's "Schedule" section, per Phase 1A's distinction) are untouched — confirmed different function, different file section. |
| Reminders | No |
| SMS / call alerts | No |
| Onboarding | No |
| Staging build | Edge-Function-only again — `calendar.ts` deploys independently of any mobile app build. No AAB/APK required. |

---

## Regression Matrix (per-change consumer trace)

Every real consumer of `calendar.ts`'s `SearchResult` output, traced this session (extends the original B10r trace with the two deterministic Level-A handlers Phase 1A's Addendum 2 found):

1. `hooks/useOrchestrator.ts:2283-2298` (mobile → Claude injection) — forwards `snippet` generically, unaffected.
2. `naavi-voice-server/src/index.js` (~3238-3244) (voice → Claude injection) — same, unaffected.
3. `app/index.tsx:2270-2311` (mobile GLOBAL_SEARCH UI card) — renders `title`/`snippet` only, unaffected.
4. `naavi-chat/intentHandlers.ts:495-517` (`handlePersonLookup`, Level A deterministic) — concatenates `title`/`snippet` per source; a shorter date string is still a valid string, no parsing assumption broken.
5. `naavi-voice-server/src/index.js:2215-2240` (`arch1HandlePersonLookup`, voice's own Level A deterministic) — same pattern, same conclusion.

No consumer parses `snippet` for a year specifically (confirmed by reading all five) — every one treats it as opaque display text, so removing the year in this one gated case cannot break any of them structurally.

---

## Status and next steps

Phase 2 (Addendum 2) complete. Risk classification is **Medium**, which per Governance §Phase 3 requires ChatGPT technical review before coding begins. Per the Phase-Gate Approval Rule, your own explicit go-ahead is required before Phase 3 starts, separately from that review's eventual verdict.
