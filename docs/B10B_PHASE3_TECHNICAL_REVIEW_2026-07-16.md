# B10b — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3. Technical review based on ChatGPT's review, documented by Wael. Subject: `docs/B10B_PHASE2_CHANGE_PLAN_2026-07-16.md`. Required because the change touches Protected Core (Action Rules), per governance §4.

---

## Executive summary

| Review item | Status |
|---|---|
| Root cause validated | ✅ |
| Change plan validated | ✅ |
| Scope acceptable | ✅ |
| Regression plan sufficient | ✅ |
| Implementation approved | ✅ |

**Overall recommendation: Proceed to Phase 4 exactly within the documented Implementation Boundaries, with one explicit Phase 5 evidence requirement (see below).**

---

## Round 1 — review of the Phase 2 plan

**Technical observation on a load-bearing assumption:** the plan assumes `action.action_config.to` still holds the original user-entered contact name at the point `failSpeechForAction()` executes. Phase 1 supports this (traced the call site, matched the shape to B10a's Phase 1 evidence) and Phase 2 explains why it believes this is true — but this is not yet demonstrated against the actual implementation. Does not block Phase 2. **Explicit requirement added for Phase 5:** the evidence package must demonstrate — via the implementation diff or a runtime trace — that `action.action_config.to` is indeed available and populated when `failSpeechForAction()` executes, confirming the assumption the personalized messages depend on.

**Test plan:** well chosen — protects both sides of the change (the new branching behavior, and preservation of the legacy duplicate-alert behavior), matching the same regression philosophy already established for B10a.

**Alternative analysis:** agreed with rejecting all three considered alternatives (a single generic message, writing new wording instead of reusing the location handler's, a broader error-taxonomy refactor) — each would increase scope without addressing the proven defect.

**Wording suggestion (adopted):** §1's "using the same wording already approved and live..." reworded to "using wording consistent with the existing location-trigger handler..." — focuses on consistency rather than implying the wording can never evolve independently later.

**Governance compliance checklist (all ✅):** builds on approved Phase 1; single defect; no implementation outside scope; regression analysis; alternatives documented; scope bounded; Protected Core identified.

**Verdict: Approved for Phase 3.** "The proposed implementation is narrowly scoped, technically straightforward, and directly addresses the defect demonstrated in Phase 1 without introducing unnecessary architectural changes. Reusing existing, already-deployed wording improves behavioral consistency while minimizing review risk, and preserving the original duplicate-alert behavior through the default branch appropriately protects against regressions. My only recommendation is that the Phase 5 evidence explicitly demonstrate that `action.action_config.to` is still available at the `failSpeechForAction()` call site, confirming the assumption on which the personalized messages depend."

---

## Response — Phase 2 revised

Wording adopted directly into `docs/B10B_PHASE2_CHANGE_PLAN_2026-07-16.md` §1 (and the matching phrase in §2's files table, corrected for consistency with the Phase 1 review's same wording fix).

---

## Implementation boundaries confirmed

- **Authorized:** `naavi-voice-server/src/action_rule_confirm_gate.js` — rewrite `failSpeechForAction` (currently `:73-75`) to branch on `result.error`, exactly as specified in Phase 2 §1. No other function in this file is in scope.
- **Authorized:** `tests/catalogue/*.ts` — the three regression tests described in Phase 2 §2 (ambiguous → multi-contact message; not_found/resolve_failed → no-contact message; no `error` field → original duplicate-alert message unchanged).
- **No additional files are approved beyond those two.** `naavi-voice-server/src/index.js` is explicitly not touched — B10a already wired `result.error` through to this call site.
- **No opportunistic refactoring, renaming, or cleanup is approved.**
- **No architectural changes are approved** — no broader error-taxonomy refactor of `executeAction`'s return value (explicitly deferred, per Phase 1 §4 and Phase 2 §5).
- **Phase 5 evidence package must include** (added by this review, not optional): a demonstration — via the implementation diff or a runtime trace — that `action.action_config.to` is available and populated at the `failSpeechForAction()` call site when it executes, confirming the assumption the personalized (name-including) messages depend on.
- **Deployment note:** same as B10a — `naavi-voice-server` has no staging tier distinct from production. A manual voice call test (triggering an ambiguous and a not-found name after confirming a time-trigger alert) is required before this is considered operationally verified, per governance Phase 7.

---

## Review conclusion

The proposed implementation remains within the approved Phase 2 scope, introduces no architectural changes, preserves all previously valid behavior, and adds only the minimum branching necessary to present an accurate explanation when recipient resolution fails.

---

## Outcome

**APPROVE.** Per governance §8 (Approval Philosophy), this is the reviewer's recommendation, not final authorization — Wael, as Product Owner, makes the final call on whether Phase 4 begins. Pending that explicit go-ahead, Phase 4 (Implementation) is cleared to proceed exactly within the Implementation Boundaries above.

**Final verdict (2026-07-16):** "APPROVE. The proposed implementation remains narrowly scoped, technically straightforward, and fully consistent with the approved Phase 2 plan. The implementation boundaries are explicit, the regression strategy protects both the new and legacy behaviors, and the added Phase 5 evidence requirement appropriately verifies the only remaining implementation assumption without expanding the scope of the change."
