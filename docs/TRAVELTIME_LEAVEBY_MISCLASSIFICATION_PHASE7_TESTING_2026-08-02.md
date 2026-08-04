# Travel-Time / Leave-By Misclassification — Phase 7 — Testing

**Date:** 2026-08-02
**Governance version:** v4.0
**Phase 6:** Approved with Mandatory Follow-Up — `docs/TRAVELTIME_LEAVEBY_MISCLASSIFICATION_PHASE6_TECHNICAL_REVIEW_2026-08-02.md`

## Result: FAILED

Wael's verdict, stated directly: *"i can not cinsider this is passed or even partial pass, it is failed."* Per this project's standing rule, the user's live test verdict is ground truth and is not second-guessed or reframed here.

## What was attempted (staging, live phone, `robert.esm.2207@gmail.com`)

1. "Drive me to my next meeting" → skipped Gym class (today, 8:00 AM, real address on file), answered with a Dentist appointment days out. No card.
2. "Drive me to my next appointment" → skipped Gym class again, picked Team standup (today, 9:00 AM), asked the user to confirm the office address rather than proceeding. No card.
3. "Drive me to my next appointment" (retry) → picked the Dentist appointment again, inconsistent with attempt 2. No card.
4. "What time should I leave for my Team standup" (named event, to remove selection ambiguity) → Naavi stated *"I don't see a Team standup on your calendar for today or the upcoming week"* — false; the event exists (confirmed on-screen in Google Calendar, in the database, and in a separate server-side reproduction using the same account and same event). No card.

**Zero of four live attempts produced the TRAVEL TIME card.** One attempt included an outright false claim about the user's own calendar data.

## What this does and does not tell us

- The routing-level fix (this work item's actual scope — `naavi-chat`'s `classifyIntent` no longer misrouting travel-planning phrasing into `READ_CALENDAR`/`CALENDAR_SEARCH`) held up in all four live attempts: none produced the old bug's deterministic listing responses.
- A server-side reproduction (same account, same backend, a request shape that supplies no inline `system` and lets `naavi-chat` assemble its own prompt with live calendar data) successfully completed the full chain for both "Navigate to my next meeting" and a Team-standup-shaped travel question, real destination, real `FETCH_TRAVEL_TIME` action.
- The live phone app, across four attempts, could not reliably reproduce that same success — including one case of stating false information about existing calendar data.
- This points to a separate, unproven-in-detail cause in how the live app supplies (or fails to supply) calendar context to Claude on a given turn — distinct from the classifier fix, not yet root-caused to the rigor this project requires (file:line, reproduced live from the actual mobile code path, not just inferred from a server-side approximation).

## Consequence

Per Phase 6's Mandatory Follow-Up, this blocks production promotion. **Production deployment does not proceed.** The classifier fix remains deployed to staging only, exactly as authorized.

This also surfaces a new, likely higher-priority issue: Naavi asserting calendar data doesn't exist when it does is a direct violation of CLAUDE.md's Rule 18 (no reformatting or inventing facts) — and independent of this work item's scope.

---

**Status:** Failed. Awaiting Wael's direction on next step — open a new Phase 0 for the calendar-context reliability issue, or another course.
