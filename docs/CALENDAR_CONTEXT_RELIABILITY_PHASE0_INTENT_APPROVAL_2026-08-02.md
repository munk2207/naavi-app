# Calendar Context Reliability — Phase 0 — Intent Approval

**Date:** 2026-08-02
**Governance version:** v4.0
**Origin:** Surfaced during Phase 7 live testing of `docs/TRAVELTIME_LEAVEBY_MISCLASSIFICATION_*` — see `docs/TRAVELTIME_LEAVEBY_MISCLASSIFICATION_PHASE7_TESTING_2026-08-02.md`. Separate work item; that fix's own Phase 7 test failed for a reason traced to this issue, not to the classifier fix itself.

## Background (supporting record — not a governance field)

Four live phone attempts on staging (`robert.esm.2207@gmail.com`), same day:
1. "Drive me to my next meeting" — skipped Gym class (today, 8:00 AM, real address on file), answered with a Dentist appointment days out.
2. "Drive me to my next appointment" — skipped Gym class again, picked Team standup, asked to confirm an address it should already have known.
3. Same phrase, retried — picked a different event than attempt 2.
4. "What time should I leave for my Team standup" (named event) — Naavi stated it could not find a Team standup on the calendar at all. False; the event exists, confirmed on-screen, in the database, and via a separate server-side call.

A server-side reproduction (same account, same event) succeeded when the request omitted an inline `system` field, letting `naavi-chat` assemble its own prompt with live calendar data server-side. This is a plausible lead, not a proven root cause — it was never confirmed against the actual mobile app's real request payload.

## User Intent

Prove — with direct evidence from the actual mobile app code path, not a server-side approximation — why Naavi's calendar-aware answers are unreliable: missing real events, selecting inconsistent events across identical repeated asks, and in at least one case, falsely stating a real event does not exist. Only after the mechanism is proven should a fix be scoped.

## Success Criteria

Each of the following is answered with direct evidence (file path, function name, actual request/response payload, or log line — not "probably" or "likely"):

1. The exact payload the mobile app sends to `naavi-chat` for a calendar-shaped question, as sent by the real app code (`hooks/useOrchestrator.ts` / `lib/naavi-client.ts` or wherever the call originates) — not a hand-constructed approximation.
2. Whether an inline `system` prompt, when present, replaces or bypasses `naavi-chat`'s own backend prompt assembly (`assembleSystemPromptServerSide`), and whether the real mobile app sends one.
3. Where calendar events are fetched, filtered, serialized, truncated, or omitted — the full path from source (Google Calendar API / cached table) to whatever Claude actually sees in context.
4. Why "next meeting" skipped the earlier Gym class event.
5. Why the identical phrase ("Drive me to my next appointment") selected different events across two consecutive attempts.
6. Why a named, existing event ("Team standup") produced a false "I don't see that on your calendar" response.
7. Whether event type (personal vs. work), date range, timezone handling, recurring-event expansion, or stale conversation/context state changes which events Claude sees or how it answers.

## In Scope

- Full investigation of the mobile app's actual request path to `naavi-chat` for calendar-aware questions.
- Full investigation of `naavi-chat`'s calendar-context assembly (both the deterministic Level A paths and the full-Claude/RULE 7 path), including the `needsLiveCalendar` / `LIVE_CALENDAR_RE` mechanism already found during the prior work item.
- Reproducing each of the 4 live failures above from the real mobile code path (not a manual script) wherever feasible.

## Out of Scope

- Implementing any fix — this Phase 0 authorizes investigation only. A fix is scoped in a later phase, after root cause is proven.
- The travel-time classifier fix itself (`docs/TRAVELTIME_LEAVEBY_MISCLASSIFICATION_*`) — already shipped to staging, closed as its own work item pending this investigation's outcome for production promotion.
- Voice server — this issue was only observed and reproduced on mobile; voice is not in scope unless this investigation finds a shared cause.

## Constraints

- Investigation must trace the real mobile app's actual code and, where possible, actual live network payloads — not a hand-built reproduction standing in for it (the prior work item's server-side test was useful as a lead, not as proof).
- No code changes in this phase.
- No architecture changes proposed until root cause is established.

## Completion Criteria

All 7 Success Criteria items answered with direct, cited evidence. Where an item cannot be answered from static code alone, a live reproduction (matching the real mobile app's request shape) is required before Phase 1 can close.

---

**Status:** Awaiting Wael's explicit approval to proceed to Phase 1.
