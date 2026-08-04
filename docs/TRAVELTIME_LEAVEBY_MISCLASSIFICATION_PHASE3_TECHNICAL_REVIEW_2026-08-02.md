# Travel-Time / Leave-By Misclassification — Phase 3 — External Technical Review

**Date:** 2026-08-02
**Governance version:** v4.0
**Reviewer:** External Technical Reviewer (ChatGPT), per governance §1
**Reviewed package:** `docs/TRAVELTIME_LEAVEBY_MISCLASSIFICATION_PHASE3_REVIEW_PACKAGE_2026-08-02.md`

## Decision: APPROVED WITH MANDATORY CHANGES

The root-cause analysis, duplicated/mobile-only architecture framing, and narrow implementation direction are technically sound. A dedicated travel-time Level A intent or new deterministic orchestration path would create unnecessary duplication and materially increase the blast radius. The prompt-only approach is acceptable for this defect, provided the following controls are incorporated.

## Mandatory Changes

**1. Define the exclusion and the fallback destination explicitly.**
The classifier instruction must not merely say leave-by questions are "not `READ_CALENDAR`." It must instruct the classifier to return **no Level A intent** so the request continues to the full Claude/RULE 7 path. Conceptually:

> Questions asking when the user should leave, depart, head out, begin travelling, or how early they must go to reach a calendar event are travel-planning requests. Never classify them as `READ_CALENDAR` or `CALENDAR_SEARCH`. Return no Level A intent so the main assistant can calculate travel time and leave-by time.

Without the explicit fallback direction, the model could move the request from `READ_CALENDAR` into another Level A intent, especially `CALENDAR_SEARCH`.

**2. Protect the `CALENDAR_SEARCH` boundary in the same prompt edit.**
No separate handler or architectural change is authorized, but the classifier prompt must distinguish:
- "When is my dentist appointment?" → `CALENDAR_SEARCH`
- "When should I leave for my dentist appointment?" → no Level A intent; continue to RULE 7

Not scope expansion — necessary to prevent the `READ_CALENDAR` exclusion from producing a different early-return misclassification.

**3. Do not encode the rule as keywords alone.**
Examples may be included, but the normative instruction must be meaning-based, covering semantic equivalents: "When should I head out?", "How early should I go?", "What time do I need to depart?", "How much time should I allow to get there?" No new regex or hard-coded phrase list as the primary routing mechanism.

**4. Test the actual early-return boundary, not only the classifier label.**
The routing-level regression test must prove the request does not enter **either** deterministic calendar handler — `READ_CALENDAR` or `CALENDAR_SEARCH`. Testing only that the classifier result is not `READ_CALENDAR` would permit the defect to reappear through `CALENDAR_SEARCH`.

**5. Preserve the distinction between routing tests and live outcome evidence.**
The catalogue test may use controlled classifier or handler instrumentation, but must not claim to prove the final card unless it genuinely executes the complete travel-time path. The evidence package must report separately: classifier/routing result; calendar event resolution; travel-time tool invocation; rendered card fields; Google Maps action presence.

**6. Confirm the changed prompt is the prompt actually deployed.**
Phase 5 evidence must identify the staging Edge Function deployment/commit containing the new instruction — stale deployment was already encountered this session (`resolve-place`).

**7. Treat three trials as the minimum, not proof of determinism.**
The required 3/3 trials satisfy the governance minimum. Any inconsistent classification during implementation or validation is a failure requiring analysis — must not be resolved by rerunning until three successful examples are obtained.

**8. Voice remains verification-only.**
A live voice failure must return the issue to problem definition or architecture analysis. It does not authorize editing `naavi-voice-server` under this change plan.

## Review Conclusions

- **Prompt-only change:** Appropriate and proportionate — uses the existing full-Claude travel-time orchestration rather than duplicating event resolution, place resolution, and travel-time handling.
- **Architecture classification:** Correct. The affected logic is the mobile-facing backend conversational entry point, not mobile application code and not cross-channel Shared Core.
- **Hidden coupling:** Adequately identified. Principal risk is reassignment to `CALENDAR_SEARCH` or disturbance of sibling intents sharing the classifier prompt. The required boundary test and sibling-intent spot checks address this.
- **Existing test location:** Extending `tests/catalogue/calendar.ts` is appropriate unless the existing harness demonstrably cannot observe the Level A routing decision. Any alternative file must be documented in Phase 4 evidence.

## Implementation Boundaries Confirmed

Implementation is authorized only within:

1. `supabase/functions/naavi-chat/index.ts` — modify the existing `classifyIntent` prompt to establish the semantic travel-planning exclusion and its fall-through behavior. No new intent, handler, routing layer, tool implementation, or unrelated classifier restructuring authorized.
2. `tests/catalogue/calendar.ts` — extend with the approved positive, negative, and boundary cases. A different test file is permitted only if technically required and explicitly documented.
3. `tests/runner.ts` — register only the newly added regression tests.

**No changes authorized to:** mobile application code; `naavi-voice-server`; `get-travel-time`; `resolve-place`; travel-time card UI; database schema or migrations; calendar handlers beyond what is strictly necessary to instrument an existing test; production deployment.

---

**Status:** Review received and recorded. Per governance §3's Phase-Gate Approval Rule, this reviewer verdict is not itself authorization to begin Phase 4 — Wael's own separate, explicit go-ahead is required next, independent of this document's own "authorized next step" language.
