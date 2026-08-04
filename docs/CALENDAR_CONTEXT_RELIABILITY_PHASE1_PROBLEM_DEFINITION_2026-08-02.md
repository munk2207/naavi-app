# Calendar Context Reliability — Phase 1 — Problem Definition

**Date:** 2026-08-02
**Governance version:** v4.0
**Phase 0:** Approved 2026-08-02 — `docs/CALENDAR_CONTEXT_RELIABILITY_PHASE0_INTENT_APPROVAL_2026-08-02.md`

Per Wael's two Phase 1 requirements: observation is kept separate from cause throughout, findings are not merged across the 4 failures unless proven to share a mechanism, and every claim below cites the exact evidence it rests on.

## 1. The exact payload the mobile app sends to `naavi-chat`

**Proven, `lib/supabase.ts:243-295` (`callNaaviEdgeFunction`).** The request body is:
```
{ messages, max_tokens: 1024, channel: 'app', language, brief_items, health_context, knowledge_context, user_id?, client_timezone, client_time }
```
**No `system` field is ever sent.** The comment at `lib/supabase.ts:278-281` confirms this is deliberate (V57.9.3 — "ship messages + small context; naavi-chat fetches the canonical system prompt itself"), and `lib/naavi-client.ts:658-661` confirms the same on the caller side.

## 2. Whether an inline `system` prompt bypasses backend prompt assembly

**Proven, and the answer rules this out as a cause for all 4 live failures.** `naavi-chat/index.ts:3237-3255` only skips its own `assembleSystemPromptServerSide` when `hasInlineSystem` is true. Since the real mobile app never sends `system` (per #1), `hasInlineSystem` is always false for real app traffic, and server-side assembly — including live calendar injection — always runs. My earlier working hypothesis blaming an inline `system` field was based on a manually-constructed test script, not the real app's behavior, and is retracted as a cause.

## 3. Where calendar events are fetched, filtered, serialized, and (sometimes) omitted

**Proven, `naavi-chat/index.ts:1271-1272, 1344-1347, 876-1069`.** Two different mechanisms decide what calendar data Claude sees, gated by one regex:

- `LIVE_CALENDAR_RE` (line 1271-1272) tests the user's exact text. If it matches, `needsLiveCalendar = true` and the server calls `fetchLiveCalendarEvents` — a fresh, direct Google Calendar API call (line 876), fetching every calendar the user has, deduplicating, sorting by start time, dropping already-passed events, and formatting each into a brief line including `e.location` from Google's own API response (line 1056).
- If it does **not** match, the server does no fetch of its own and falls back entirely to whatever `brief_items` the mobile app included in its request (`naavi-chat/index.ts:1345-1347`) — client-supplied, not freshly fetched server-side.

Direct regex test against the three distinct phrasings used in the 4 live attempts:
```
"Drive me to my next meeting"                        -> needsLiveCalendar: true
"Drive me to my next appointment"                     -> needsLiveCalendar: true
"What time should I leave for my Team standup"        -> needsLiveCalendar: false
```

**This is the first proof that the 4 failures do not share one cause.** Failures 1-3 (phrasings that trigger a fresh server-side fetch) and failure 4 (a phrasing that falls back to client-supplied data) are structurally different code paths.

## 4. Why "next meeting" skipped the earlier Gym class event

**Root cause not fully proven — but the data-layer explanation is proven false.** Reproduced live against the real account (Robert, staging) via `"What is on my calendar right now"` — a query that also uses `fetchLiveCalendarEvents` (through the deterministic `READ_CALENDAR` path, `naavi-chat/index.ts:2816-2822`, same underlying fetch function as the full-Claude path):

```
"Here's your schedule for the next 7 days. 1. Gym class, Aug 2 at 8:00 AM. 2. Team standup, Aug 2 at 9:00 AM. ..."
```

**Gym class is correctly fetched, correctly ordered first (chronologically earliest), and correctly present in the exact same data source RULE 7 draws from.** This proves the omission is not a fetch, filter, or serialization defect — the event reaches the point where Claude has access to it. The remaining, unproven question is Claude's own downstream selection logic in RULE 7's "PICK THE RIGHT EVENT FIRST" step (`get-naavi-prompt/index.ts:699` — instructs picking "the one with the EARLIEST future start," no event-type filter is documented anywhere in that rule's text). Whether Claude is applying an undocumented semantic filter (treating "Gym class" as not a "meeting") is a live-LLM-reasoning question, not something provable from static code — it would need multiple live trials of the exact same request to characterize, which is out of this Phase 1's evidence so far.

## 5. Why the identical phrase ("Drive me to my next appointment") selected different events across two attempts

**Root cause not proven.** Both attempts used a phrasing where `needsLiveCalendar = true` (per #3), meaning both should have received a fresh, correctly-ordered fetch (per #4's proof that the fetch itself is reliable). The inconsistency between the two answers (Team standup vs. Dentist appointment) therefore points toward Claude's own event-selection reasoning varying between calls with the same input — consistent with, but not proof of, ordinary LLM non-determinism in RULE 7's interpretation step. Not independently reproduced multiple times in this investigation; stated as an open question, not a conclusion.

## 6. Why a named, existing event ("Team standup") produced a false "not found"

**Proven, distinct mechanism.** Per #3, `"What time should I leave for my Team standup"` does not match `LIVE_CALENDAR_RE`, so `needsLiveCalendar = false`, so the server never calls `fetchLiveCalendarEvents` for this request — it relies entirely on the `brief_items` the mobile app supplied in that specific request. **This has not yet been confirmed against the actual `brief_items` value the live app sent on that exact turn** — that would require live client-side instrumentation (e.g. `remoteLog`) that isn't in place for this call site today. What is proven is the mechanism that makes a false negative possible: if the client's cached brief was empty, stale, or excluded Team standup at that moment, Claude would correctly (from its own input) report not finding it — this is a plausible, mechanism-proven explanation, not yet a fully closed root cause.

## 7. Whether event type, date range, timezone, recurring-event expansion, or stale context changes the result

- **Event type:** Live-reproduced open question (#4) — Gym class (personal/recurring) was present in fetched data but excluded from Claude's answer; Team standup and Dentist (work-shaped) were used. Suggestive but not proven as a deliberate filter.
- **Date range:** `fetchLiveCalendarEvents` uses `timeMin = now`, `timeMax = now + 7 days` (line 904-906) — Gym class today at 8 AM and Team standup today at 9 AM are both well inside this window; not implicated for these specific failures.
- **Timezone:** All-day-event date handling is deliberately guarded against a known past timezone bug (line 1012-1021 comment references the "Victoria Day" class of bug, CLAUDE.md Rule 18) — none of the 4 failures involved an all-day event, so this guard isn't implicated here.
- **Recurring-event expansion:** Gym class is recurring ("Repeats weekly on Mon, Wed, Fri," per the live Google Calendar screenshot). `fetchLiveCalendarEvents` requests `singleEvents=true` (line 929), which correctly expands recurring events into individual instances — proven by #4's result showing today's Gym class instance present and correctly dated. Not implicated as a cause.
- **Stale conversation/context state:** Not independently tested this session — flagged as still open, not ruled in or out.

## Architecture Location

**Capability:** Calendar — reads (live event fetch). Classification per Architecture Reference (`docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md:68`): **Duplicated** — already established in the prior work item's Phase 1A.

**New finding this session, not previously documented:** the duplication is not limited to mobile-vs-voice. Within `naavi-chat` itself, at least two independent live-Google-Calendar-fetch implementations exist and disagree: `fetchLiveCalendarEvents` (`naavi-chat/index.ts:876`, used by both the deterministic `READ_CALENDAR` handler and the full-Claude RULE 7 path) correctly found Gym class and Team standup when tested directly; `global-search`'s `calendarAdapter` (`supabase/functions/global-search/adapters/calendar.ts`), called independently with a generic "calendar today" query against the same account, returned **zero results** in the same few minutes. Both call Google Calendar's API for the same user; only one currently works reliably. This is a third calendar-read implementation beyond the two (mobile/voice) already tracked in ADR-0002, not yet reflected in the Architecture Reference.

## What Remains Open (explicitly, per Wael's Requirement 1 — not to be closed by inference)

- Whether Claude's event-selection reasoning in RULE 7 applies an undocumented event-type filter (#4, #5) — requires multiple live trials to characterize, not yet done.
- The actual `brief_items` payload the live app sent on the failing "Team standup" turn (#6) — requires client-side instrumentation not currently in place.
- Why `global-search`'s calendar adapter returned empty where `fetchLiveCalendarEvents` succeeded — a newly found, third data point, not yet root-caused.

---

**Status:** Awaiting Wael's direction — proceed to Phase 1A, or narrow scope given how much of this traces to live-LLM reasoning rather than a fixable code defect.
