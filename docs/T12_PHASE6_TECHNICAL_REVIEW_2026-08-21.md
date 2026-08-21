# T12 — Phase 6: Technical Review Record (After Coding)

**Work item:** [[T12]] — Voice environment equilibrium
**Date:** 2026-08-21
**Reviewer:** ChatGPT (External Technical Reviewer, Governance §1)
**Prompt submitted:** `docs/T12_PHASE6_REVIEW_PROMPT_2026-08-21.md`

## The four verdicts

| Dimension | Verdict |
|---|---|
| Technical Review | **PASS** |
| Architecture Completeness | **PASS** |
| Governance Compliance | **PASS with recorded deviations** |
| **Overall Recommendation** | **Approved — Phase 7 remains mandatory** |

**Mandatory changes before Phase 7: none.**

---

## Ruling 1 — the unswept-functions gap does NOT belong to T12

**Reviewer:** *"Do **not** expand T12 into a sweep. T12's business target is Voice Staging = Voice
Production, and authoritative `parity:verify` demonstrates **32/32 equal**. The possibility that both
environments contain the same uncommitted code is a separate source-control integrity issue, not
failure of Voice equilibrium."*

**This overrules the framing in the Phase 6 prompt.** §3.2 presented the gap as possibly a completion
condition for T12. It is not, and the distinction is precise:

- **T12 asks:** are the two environments equal to each other? **Answered: yes, 32/32, measured.**
- **The gap asks:** does the repository describe what is deployed? **A different question**, and one
  that would remain open even if voice equilibrium were perfect — as it now is.

Conflating them would have let T12 expand without bound, which is the failure the scope rules exist
to prevent. **The gap is real and stays recorded** — Phase 5 §9 risk 1, the T12 holding-list entry,
and commit `8e24aae` — but it is **not** T12's to close.

**Follow-up owed:** it needs its own holding-list item as a source-control integrity issue. Not
opened by this document; flagged for Wael.

## Ruling 2 — the three declared deviations, each accepted

| Deviation | Ruling |
|---|---|
| `--dry-run` added to the deploy wrapper | **Acceptable** — necessary verification of an approved control |
| `calendar.ts` committed outside Phase 3's boundaries | **Acceptable** — Wael explicitly authorized it, and it records already-running production code without changing behaviour |
| Baseline written after deploys, not before | **Correctly classified as an Invalidated Planning Assumption.** Writing known defects into an "accepted differences" baseline would have contradicted T12's purpose |

The third carries the sharpest reasoning: an accepted-differences file listing the very differences
being fixed would have asserted that the divergence was intended. **A baseline is a record of
decisions, not a snapshot of whatever happened to be true.**

---

## What this does and does not permit

**The unrun tests are acceptable ONLY because Phase 7 is still mandatory.** The six registered tests
have never executed. **T12 cannot close until they and the required live regressions pass.**

**Architecture: Outcome 2 confirmed** — divergence caused by an intentional, approved change. Per the
Architecture Drift Rule this makes the Architecture Reference update a **hard precondition for Phase
8 merge**, not an optional follow-up. Owed:

1. §0d's *"Nothing compares deployed Edge Function code between projects"* — now false.
2. §0c's statement of the drift check's blind spot — now partially covered.
3. §0b's stale line reference (`index.js:7224` → `:7624`) — pre-existing, found at Phase 1A.
4. §0b's overstated claim that the guard sits on *every* send path — two known exceptions.

## §14 Claude Implementation Handoff

- **Decision** — Approved.
- **Mandatory Changes** — none before Phase 7.
- **Architecture Requirements** — update the Architecture Reference before Phase 8.
- **Regression Requirements** — execute all Phase 7 tests and live checks.
- **Scope Restrictions** — Voice only. **Do not expand into the unswept-functions issue.**
- **Verification Checklist** — Phase 7 green, then **preserve the 32/32 equilibrium proof**.

On that last item: the proof is `parity:verify`, and it is reproducible rather than archived. Phase 7
must not leave the two environments in a state where re-running it would return anything other than
32/32 — and if a Phase 7 fix requires a deploy, that deploy is itself subject to the same gate.

---

## ⭐ This document does NOT authorize Phase 7

Per Governance §3's Phase-Gate Approval Rule, a reviewer's verdict is one input Wael weighs — never
authorization to proceed. **Phase 7 does not begin until Wael's own separate explicit go-ahead.**

Restated here because this rule has been violated four times in this project (2026-07-15, 07-17,
08-15, 08-20), and because an "Approved" verdict is exactly the moment it gets violated.
