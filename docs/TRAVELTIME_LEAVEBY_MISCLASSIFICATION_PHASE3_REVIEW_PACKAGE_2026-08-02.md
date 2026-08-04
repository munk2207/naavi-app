# Travel-Time / Leave-By Misclassification — Phase 3 — External Technical Review Package

**Date:** 2026-08-02
**Governance version:** v4.0
**For:** External Technical Reviewer (ChatGPT), per governance §1 and §3 Phase 3.
**Prior phases (full detail on request):** Phase 0 (Intent), Phase 1 (Problem Definition), Phase 1A (Architecture Completeness), Phase 2 (Change Plan, amended) — all in `docs/TRAVELTIME_LEAVEBY_MISCLASSIFICATION_PHASE*_2026-08-02.md`.

This package is a condensed submission per governance §14's Cost-Aware AI Collaboration — it summarizes what a Medium-risk, Protected-Core Phase 3 review needs; the four linked documents hold the full record if you need to check a specific claim.

## What's broken

Mobile only: asking a leave-by/travel-time question phrased as "What time should I leave for my [event]" (or paraphrases like "How early do I need to go?") returns a plain calendar listing, not the TRAVEL TIME card. "Navigate to my next meeting" works correctly. Live-reproduced on both staging and production, same failure, same phrasing pattern — not an environment or build issue.

## Root cause (proven, file:line)

`supabase/functions/naavi-chat/index.ts:1627` (`classifyIntent`) is a lightweight Haiku classifier that runs *before* the full Claude system that owns `get-naavi-prompt`'s RULE 7 (which knows how to call `fetch_travel_time`). Its prompt (line 1664) lists example phrasings for `intent: "READ_CALENDAR"` with no exclusion for leave-by/travel-time phrasing. When it misclassifies a message this way, `naavi-chat/index.ts:2816-2822` answers deterministically and returns immediately — Claude, and RULE 7, are never reached.

## Proposed fix (narrowest option; two others considered and rejected — Phase 1 §Alternatives)

Add an explicit, meaning-based exclusion to `classifyIntent`'s prompt: leave-by, departure-time, commute-time, navigation-time, and travel-time questions must not be classified `READ_CALENDAR`. Not a fixed keyword list — must generalize to paraphrases.

## Architecture position (Phase 1A, freshly verified this session)

- Capability: Calendar reads — **Duplicated** per Architecture Reference (`docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md:68`, `docs/adr/0002`). Mobile (`naavi-chat`) and voice (`naavi-voice-server`) each have independent implementations.
- This bug and this fix are **mobile-side only**. Voice's own classifier (`naavi-voice-server/src/index.js:2255-2352`) has a separate intent list that never included `READ_CALENDAR` in the first place — checked directly, not assumed. Code-level finding only; a live voice call is still required (Phase 7) before this is treated as confirmed.
- Checked for hidden duplicates before defining scope: no second copy of `classifyIntent`, no shared local-fallback prompt gap (`lib/naavi-client.ts` already has correct `FETCH_TRAVEL_TIME` handling and sits downstream of this gate anyway), voice's separate `calendarListRe` latency regex doesn't match any reproduction or paraphrase test — full table in Phase 1A doc.

## Isolation / hidden coupling

`classifyIntent` has exactly one call site (`naavi-chat/index.ts:2762`) and gates **10 Level A intents through one shared prompt** (`LIST_RULES`, `LOOKUP_CONTACT`, `CALENDAR_SEARCH`, `READ_CALENDAR`, `GMAIL_SEARCH`, `PERSON_LOOKUP`, `LIST_READ`, `REMINDER_READ`, `MEMORY_SEARCH`, `CREATE_TICKET`). The main coupling risk: editing this shared prompt for one intent's exclusion could leak into another intent's classification, particularly `CALENDAR_SEARCH` (a specific-event-by-name question like "When is my dentist appointment?" must **not** be pulled into the new exclusion just because it names an appointment). Full consumer trace in Phase 2's Regression Matrix.

## Assumptions this plan is making (please stress-test these)

1. That a prompt-only change (no new Level A intent, no deterministic handler) is sufficient — vs. building a dedicated deterministic travel-time intent. Rejected in Phase 1 as disproportionate to the bug; open to challenge.
2. That excluding travel-time phrasing from `READ_CALENDAR` won't require a symmetric change to `CALENDAR_SEARCH`'s own instructions to keep the two boundaries clean.
3. That the existing test fixture (`tests/catalogue/calendar.ts`, two tests locking in `"what do I have today"` / `"what's coming up"` → `READ_CALENDAR`) is sufficient non-regression coverage, extended per Phase 2 rather than replaced.

## Evidence plan (Phase 2 Amendments 3 & 4 — already locked in, not open for this review to loosen)

Two-layer proof required per test phrase, minimum 3 trials each (Non-Determinism Rule):
- **Routing-level:** phrase does not classify `READ_CALENDAR`.
- **Outcome-level:** full request produces destination, duration, leave-by time, and the Google Maps action.

Positive controls: "What time should I leave for my dentist appointment?", "What time should I leave for my next meeting?", "When should I head out for my dentist appointment?", "How early do I need to go to my next meeting?"
Negative controls (must stay `READ_CALENDAR`): "What's on my calendar today?", "What do I have this week?", "What's next on my calendar?"
Boundary case (must stay `CALENDAR_SEARCH`): "When is my dentist appointment?"

## Implementation authorization boundary (Phase 2 Amendment 7)

Staging deployment only. Production is explicitly out of scope for this authorization pending completed staging evidence and Wael's own separate approval.

## What we're asking you to evaluate

Per governance §3 Phase 3 and §13 Gate 3/4: assumptions above, architecture correctness (does the Duplicated/mobile-only framing hold up), isolation/hidden coupling (the 10-intent shared-prompt risk), and implementation strategy (prompt-only exclusion vs. the two rejected alternatives). Please conclude with one of the three permitted decisions (Approved / Approved with Mandatory Changes / Rejected) and, if not Rejected, the Implementation Boundaries Confirmed statement per §3 Phase 3 (exact files/changes authorized, nothing beyond).

---

**Status:** Submitted for external review. No code written yet.
