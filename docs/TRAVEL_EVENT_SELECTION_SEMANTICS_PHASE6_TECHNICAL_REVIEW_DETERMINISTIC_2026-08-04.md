# Travel Event Selection Semantics (Ticket B) — Phase 6 — External Technical Review (Deterministic Redesign)

**Date:** 2026-08-04
**Governance version:** v4.0
**Reviewed:** `docs/TRAVEL_EVENT_SELECTION_SEMANTICS_PHASE5_EVIDENCE_DETERMINISTIC_2026-08-04.md`

## Decision: APPROVED WITH MANDATORY FOLLOW-UP

Ranked as the strongest of the three approaches explored this ticket: prompt-only (❌ failed live validation) → marker-gated prompt (⚠️ relied on LLM compliance) → deterministic server-side selection (✅). Simpler, more deterministic, easier to reason about, more maintainable.

## Mandatory Follow-Up — both applied

1. **Permanent "next appointment" regression test** — added: `calendar.next-appointment-deterministic-first-entry` (`tests/catalogue/calendar.ts`), mirroring the existing "next event" 3-trial determinism test. Locks in "next appointment" as its own standalone check, on top of the existing 3-way comparison test (`calendar.no-semantic-type-override`) that already covered it as part of a set.
2. **Engineering lesson recorded** — the `ReferenceError` was caused by extending a shared data structure (`MobileBriefItem`) without a full regression pass first, not by the deterministic design itself. Recorded as a standing process note: *"When extending shared DTOs or model objects used by multiple consumers, perform one complete regression run before functional testing."* Saved to project memory (`feedback_shared_dto_extension_regression_first`) for future sessions.

## B10z — confirmed independent

Reviewer agreed: "Drive me to Team standup" (named-event lookup failure) correctly stays out of Ticket B's scope and must not be merged into it at closure. No action needed — already tracked separately.

## Production Readiness

Reviewer found no remaining technical blocker: deterministic behavior achieved, architecture preserved, regression suite passes, scope respected. Cleared for Phase 7 user validation; the "next appointment" permanent test should exist before production promotion (now done).

---

**Status:** Phase 6 CLOSED — Approved with Mandatory Follow-Up, both items applied. Per governance §3's Phase-Gate Approval Rule, this reviewer verdict is not itself authorization for Phase 7 — awaiting Wael's own separate, explicit go-ahead.
