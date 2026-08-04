# Calendar Context Reliability — Phase 1A — Architecture Completeness and Live Context Trace

**Date:** 2026-08-02
**Governance version:** v4.0
**Phase 1:** Approved as interim problem-definition — `docs/CALENDAR_CONTEXT_RELIABILITY_PHASE1_PROBLEM_DEFINITION_2026-08-02.md`

Correction accepted from Wael's review: Phase 1's "different causes" language is revised throughout this document to "different context-acquisition paths" — whether they share a downstream cause is addressed below with evidence, not assumed either way.

## global-search — scoped out, per Wael's instruction

Checked directly: `hooks/useOrchestrator.ts`'s `FETCH_TRAVEL_TIME` handler (lines 2477-2520-ish, already cited in the prior work item) calls only `resolve-place` and `get-travel-time`. No call to `global-search` anywhere in this path — confirmed by grep, zero matches. **The failing mobile path does not call `global-search`.** Per Wael's instruction, this is recorded as a separate finding, not pulled into this ticket: *a newly discovered calendar-read implementation and potential architecture-documentation gap, pending consumer tracing* — to be opened as its own governance item.

## Controlled Repeated Trials (3 per phrase, fresh conversation each time, real account, real staging deployment)

### "Drive me to my next meeting" (`needsLiveCalendar = true`)

All 3 trials identified **Team standup** as the target (Gym class consistently not selected — see analysis below). Inconsistent on the location:
- Trial 1: "I don't have a location listed for this meeting" — no `FETCH_TRAVEL_TIME`.
- Trials 2-3: correctly stated "at your work address, 340 Albert St, Ottawa" — `FETCH_TRAVEL_TIME` emitted with the real address.

**Event selection was consistent (3/3); location recall was not (2/3 vs 1/3).**

### "Drive me to my next appointment" (`needsLiveCalendar = true`)

All 3 trials identified **Dentist appointment with Dr. Osei, tomorrow** — fully consistent, `FETCH_TRAVEL_TIME` emitted every time with `destination: "Dr. Osei Dentist"` (a name, not a resolved address).

**Both event selection and the decision to act were consistent (3/3) in this isolated run.** This differs from the live phone session, where the same phrase selected different events across two consecutive attempts — addressed under Conversation-State Contamination below.

### "What time should I leave for my Team standup?" (`needsLiveCalendar = false`, no `brief_items` supplied)

All 3 trials: **"I don't see a Team standup on your calendar for the next 7 days."** — fully consistent, exactly reproducing the live phone failure.

## Semantic Boundary Controls (3 trials each)

- **"Drive me to my next event."** — 3/3 correctly identified **Gym class at 8:00 AM today** as "next event," but reported it lacks a specific address and asked for one. Proves the event-selection mechanism *can* reach Gym class correctly when the phrasing is generic ("event," not "meeting"/"appointment").
- **"Drive me to my next class."** — 3/3 false negative: "I don't see any upcoming classes." Gym class's title literally contains "class"; Claude did not match it.
- **"Drive me to Gym class."** (exact title, named directly) — 3/3 false negative: "I don't see a 'Gym class' event."
- **"Drive me to Team standup."** (exact title, named directly) — 3/3 false negative: "I don't see a Team standup meeting."

**All three false-negative phrases above share one property, checked directly: none contain any word in `LIVE_CALENDAR_RE`** (`schedul|calendar|agenda|meeting|appointment|event|...` — "class" and bare event titles like "Gym class"/"Team standup" match none of it). Per Phase 1's proven mechanism (#3), this means `needsLiveCalendar = false` for all four, and all four fall back to empty `brief_items` in these isolated tests — **the same proven mechanism, now reproduced across 4 independent phrasings, 12 trials, 100% consistent.**

## Conversation-State Contamination — phrase: "What time should I leave for my Team standup?"

- **New conversation:** false negative (matches baseline).
- **After an unrelated message** ("What is the capital of France?"): false negative — unrelated content does not help.
- **Immediately after another calendar query** (prior assistant turn already listed "Team standup, Aug 2 at 9:00 AM" in its reply): **SUCCESS** — "Looking up travel time" + `FETCH_TRAVEL_TIME(destination="340 Albert St, Ottawa, ON, Canada")`.
- **Retry, same thread, second ask** (first ask's false-negative denial as prior turn): false negative again — the first reply contained no real calendar data, so repeating the ask with that denial in history doesn't introduce any.

**This is the single clearest proof in this investigation: identical phrase, identical (empty) `brief_items`, identical `needsLiveCalendar = false` — the only variable changed was conversation history — and the outcome flipped from false-negative to fully correct with a real address.** Per Wael's Requirement 4, conversation state is now a **proven** contributing factor, not a hypothesis.

## Synthesis — what this proves about the 4 original live failures

1. **Failure 4 (false "Team standup not found"), and by extension "Drive me to Team standup"/"my next class"-style phrasing generally:** mechanism proven, reproduced 4-for-4 phrasings × 3 trials = 12/12. `needsLiveCalendar = false` for any phrase that doesn't hit a calendar-trigger keyword, and with no prior conversation mention of the event, the server has nothing to inject except the client's `brief_items` — which, in these controlled trials, was empty. **Whether the real live app's `brief_items` was actually empty on the failing turn is still not directly captured** (see below) — but the mechanism that makes the failure possible is now proven, and conversation-state was proven to independently produce a correct answer with the exact same empty-brief_items condition, which strongly narrows what remains unexplained.
2. **Failures 1-3 (event selection: skipping Gym, "next meeting" vs "next appointment" picking different events, inconsistency across repeated identical asks):** in *isolated, fresh-conversation* trials, event selection for "next meeting" and "next appointment" was internally *consistent* (3/3 each) — Gym class was reliably not selected for either phrasing, while it *was* reliably selected for the more generic "next event." This is a real, reproducible pattern, not random noise, in a controlled setting. The inconsistency Wael observed live (same phrase, "next appointment," selecting different events across two consecutive phone attempts) did not reproduce in my fresh-conversation trials — the leading candidate explanation, now supported by the conversation-state proof above, is that the live phone session's accumulating conversation history (unlike my reset-per-trial script) was itself an active variable. This is not yet directly proven for that specific pair of phone attempts — the live phone conversation's exact prior turns were not captured — but it is no longer an unconstrained "LLM non-determinism" shrug; there is now a proven mechanism (conversation-state effects) that plausibly explains it, pending direct confirmation.

## Still Open — Real Mobile Payload Capture

Wael's Requirement 1 (temporary diagnostic instrumentation capturing the real app's exact `brief_items`, messages, `needsLiveCalendar` result, and final injected calendar context on a live failing turn) has **not** been done — it requires deploying temporary logging to `naavi-chat` and one more live phone test while it's active. Given how much of the mechanism is now independently proven through controlled reproduction above, this remaining step would confirm (not re-derive) the mechanism against a real live turn, and would additionally reveal exactly what the live app's `brief_items` actually contained. Recommend as the next concrete step if full closure per Wael's original Requirement 1a is still wanted.

---

**Status:** Awaiting Wael's direction — proceed with the temporary instrumentation + one more live test to close the remaining gap, or treat the mechanism proof above as sufficient to move toward Phase 2 change planning.
