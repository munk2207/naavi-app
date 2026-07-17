# B10a — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3. Technical review based on ChatGPT's review, documented by Wael. Subject: `docs/B10A_PHASE2_CHANGE_PLAN_2026-07-16.md`. Required because the change touches Protected Core (Action Rules, Voice orchestration) and was classified Medium overall risk (Implementation Low / Regression Medium / Architecture Low).

Split into its own document per Wael's direction (2026-07-16) — the review was originally recorded inline inside the Phase 2 document; kept there as an interim measure, now separated out as its own artifact for a cleaner audit trail, per the reviewer's own suggestion in Round 2 below.

---

## Executive summary

| Review item | Status |
|---|---|
| Root cause validated | ✅ |
| Change plan validated | ✅ |
| Scope acceptable | ✅ |
| Regression plan sufficient | ✅ |
| Implementation approved | ✅ |

**Overall recommendation: Proceed to Phase 4 exactly within the documented Implementation Boundaries.**

---

## Round 1 — review of the original Phase 2 draft

**Technical concern raised:** the `failSpeechForAction` fix (originally Phase 2 §2) is a real, valid defect, but it is not the defect B10a's Phase 1 was approved on — it's a different bug discovered while tracing the same failure path. Bundling two different user-facing defects into one governance item makes "what exactly was B10a" ambiguous to anyone reading back later. Recommendation: separate them — keep B10a scoped to recipient-resolution ordering only, and open **B10b** as its own Problem Definition → Change Plan for the spoken-failure-message defect.

**Architectural policy (fail-open vs. fail-closed) reviewed and endorsed:** fail-closed agreed as correct. Reasoning affirmed: a silent redirect ("Text Bob" actually texting the user) changes user intent without telling them; a spoken failure ("I couldn't resolve Bob") is honest. Fail-open would repeat the exact silent-misdirection pattern this bug exists to close.

**Risk classification revised:** the blanket "Medium" rating was recommended split three ways — Implementation Risk: Low (the change is mechanically a block reorder, no new conditions), Regression Risk: Medium (the change site is inside Protected Core, which carries cost independent of diff size), Architecture Risk: Low (no new architecture, just restoring an already-approved intended order).

**Regression section wording:** the "SMS / call alerts" row's original wording ("this is the fix") was recommended reworded to name the exact scope explicitly — only third-party SMS/WhatsApp alerts using the general (non-location) `SET_ACTION_RULE` path — to avoid future ambiguity about what's actually affected.

**Test coverage addition:** recommended a third regression test, beyond the two already planned (resolve Bob correctly; fail closed on unresolvable name) — that **"Text me in three minutes"** (no named recipient) still defaults to the user's own number after the reorder. Without this test, B4y's original purpose is asserted to survive the reorder but never actually proven.

**Wording precision:** "B4y naturally skips" replaced with "B4y's existing guard evaluates false" — more precise description of the actual mechanism (a boolean condition, not an implicit behavior).

**Governance compliance checklist (all ✅):** builds only on approved Phase 1; no implementation beyond plan; regression analysis present; alternatives documented; scope bounded; Protected Core identified; no speculative refactoring.

**Verdict: Approved for Phase 3**, conditioned on adopting the B10b split as the one procedural recommendation. "The proposed implementation is smaller, cleaner, and lower risk than the alternatives considered in Phase 1. Reordering the existing blocks leverages the current guard logic instead of introducing new conditions, making the change easier to review and less likely to create regressions. The grep audit and explicit scope boundaries further increase confidence in the approach."

---

## Response — Phase 2 revised

All Round 1 feedback adopted directly into `docs/B10A_PHASE2_CHANGE_PLAN_2026-07-16.md`:

- `failSpeechForAction` fix removed from B10a's file list, spun out to `docs/B10B_PHASE1_PROBLEM_DEFINITION_2026-07-16.md` (§2), with an explicit sequencing note: B10b's new branch is unreachable/dead code until B10a's reorder ships, so B10b must not be implemented or deployed ahead of B10a.
- Fail-closed decision recorded as confirmed (§3).
- Risk classification split into the three-dimension table (§5).
- Regression row reworded to name the exact scope (§6).
- Third regression test added to the files table (§4).
- Wording corrected to "B4y's existing guard evaluates false" (§1).

---

## Round 2 — review of the split and process observation

**On recording Phase 3 inline inside the Phase 2 document:** not technically wrong — the Phase 2 document can serve as the authorization record — but recommended that, as this governance process matures, Phase 2 (Change Plan) and Phase 3 (Independent Technical Review) become separate artifacts for a cleaner audit trail. Recommended not changing the current document for this item, given it was already consistent with the process used so far.

**Wael's decision (2026-07-16):** apply the separation now rather than deferring it — this document is the result.

**Implementation recommendation:** "Approved to implement exactly as documented" — scoped strictly to (1) moving the B4y block after the F12 block, (2) adding only the three specified regression tests, (3) no additional refactoring or opportunistic changes. This disciplined scope is what keeps the Protected Core modification low risk.

**Final verdict:** "B10A is ready for Phase 4 (Implementation). This is one of the strongest governance packages I've reviewed. The progression from Phase 1 through the revised Phase 2 shows a disciplined engineering process: the root cause is proven rather than inferred; the chosen fix is the smallest change that resolves the defect; existing behavior is intentionally preserved; regression protection covers both the new behavior and the legacy behavior that must remain; scope is tightly controlled, with unrelated findings correctly split into a separate governance item (B10b)."

---

## Implementation boundaries confirmed

- **Authorized:** `naavi-voice-server/src/index.js` — move the B4y default-to-self block (currently `:4696-4739`) to run after the F12 resolution block (currently `:4755-4787`), within the `SET_ACTION_RULE` case only. No condition logic changes — the reorder alone is the fix.
- **Authorized:** `tests/catalogue/*.ts` — exactly the three regression tests described in Phase 2 §4 (resolve a named contact correctly; fail closed on an unresolvable name; "text me..." with no named recipient still self-defaults).
- **No additional files are approved beyond those two.**
- **No opportunistic refactoring, renaming, or cleanup is approved.**
- **No architectural changes beyond the reorder described above are approved.**
- **Explicitly excluded from this authorization:** `naavi-voice-server/src/action_rule_confirm_gate.js` (`failSpeechForAction`) — tracked separately as B10b, not authorized for implementation alongside B10a, and not to be implemented or deployed until B10a is live and verified (per B10b's own Phase 1 §6 sequencing note).
- **Deployment note:** `naavi-voice-server` has no staging tier distinct from production (Railway auto-deploys from its own `main`). A real voice call test is mandatory before that push, per governance Phase 7, since there is no staging gate to catch a regression first.

---

## Round 3 — final confirmation of this document

**Editorial note (adopted):** the reviewer-attribution line was refined from "Reviewer: ChatGPT (External Technical Reviewer), via Wael" to "Technical review based on ChatGPT's review, documented by Wael" — more accurately reflects that Wael records the review rather than the model authoring the document directly.

**Governance maturity observation:** the process across B10a's lifecycle has evolved from ad hoc bug-finding-and-fixing into a genuine engineering governance workflow — Problem Definition → Change Planning → Independent Technical Review → Controlled Implementation → Evidence → Final Technical Review — improving traceability and reducing the chance unrelated changes slip into Protected Core work.

**Verdict: Approved.** "This Phase 3 document is complete and ready to serve as the formal authorization record preceding implementation. It accurately captures the review history, clearly defines implementation boundaries, documents adopted recommendations, and maintains a disciplined separation between review, planning, and execution."

---

## Outcome

**APPROVE.** Per governance §8 (Approval Philosophy), this reviewer verdict is a recommendation, not final authorization — Wael, as Product Owner, makes the final call on whether Phase 4 begins. Pending that explicit go-ahead, Phase 4 (Implementation) is cleared to proceed exactly within the Implementation Boundaries above.
