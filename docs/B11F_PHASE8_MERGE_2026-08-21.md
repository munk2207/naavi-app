# B11f — Phase 8: Merge

**Work item:** [[B11f]] — pause and resume on a voice call
**Date:** 2026-08-21
**Commit:** `4724f7d` on `staging` (`naavi-voice-server`), deployed and live-tested
**Scope of this merge: STAGING ONLY.** Production promotion is a separate decision — see §3.

---

## 1. Merge preconditions

Governance Phase 8 requires all five. Each verified, not assumed.

| Precondition | Status |
|---|---|
| Automated tests pass | ✓ **133 pass, 0 fail** — 119 pre-existing unchanged + 14 new. Plus 2,044-case equivalence harness, 0 divergences. |
| Manual validation passes | ✓ **4 of 4** on a live staging call, 2026-08-21 |
| External review completed | ✓ **Phase 3** (before coding) and **Phase 6** (after coding) — Phase 6 returned PASS on all four verdicts |
| Intentional architectural change has updated the Architecture Reference in this session | ✓ **§3 rewritten; version bumped `2026.07.18.7` → `.8` in the same commit** — §2 below |
| No newer Architecture Reference superseded the version recorded at Phase 1A without re-evaluation | ✓ **Re-evaluated — and it had changed.** §2.2 |

---

## 2. Architecture Reference

### 2.1 The obligation carried from Phase 1A §6, now discharged

§3 listed "Playing audio back, handling **barge-in/interruption**" as a single capability. That has
not been true since the original B11f work in August. It is now **two designs, one per branch** —
and mobile is a third:

| | `main` (production) | `staging` | Mobile |
|---|---|---|---|
| How to interrupt | any transcript | a recognised pause word | on-screen Stop button |
| Noise silences her | yes | no | n/a |
| Resume | no — discarded | yes, previous sentence | no — discarded |

§3 now carries that table, the reason for the difference, and Wael's ruling that the resulting trade
belongs to the production-promotion decision.

**This was recorded at Phase 1A as a merge precondition specifically so it could not close
silently**, and the divergence predates this commit — it was created by the original B11f work, not
by the extraction.

### 2.2 Version Verification — the Reference HAD moved since Phase 1A

Phase 1A recorded version **`2026.07.18.7`**. Checking before merge, as that phase requires, found
the Reference **had been edited since** — commit `23ee5c6` retracted the §0d claim that Railway does
not reliably auto-deploy.

**That edit did not bump the version**, so `2026.07.18.7` briefly identified two different
documents. **That was my lapse, made a few hours after revision 7's own note asked whoever edited
next to bump in the same commit** — the precise failure the version line exists to prevent, in the
document that records the lesson. Corrected in revision 8's note rather than quietly.

**Assessment, as the rule requires rather than "probably not":** the retracted claim concerned
Railway deployment behaviour. B11f's implementation relies on nothing in it. **No assumption
invalidated.**

---

## 3. What this merge does NOT authorise

**B11f remains held from production, and this phase does not change that.**

- `main` does not contain B11f. Nothing about this merge alters production behaviour.
- Promotion requires Wael's own explicit word after Phase 8, per governance line 146.
- **The interruption trade-off is the substance of that decision**, not a detail of it: promoting
  B11f removes barge-in from production, so a caller whose pause word is misheard would be unable
  to interrupt at all, where today any word works. Documented at Phase 1 §1.3, now in §3 of the
  Architecture Reference, and explicitly assigned to the promotion decision by Wael.

---

## 4. What was actually achieved

The feature did not change. **What changed is that it can now fail loudly instead of silently.**

- Two functions that decide what a caller hears moved from an untestable closure into a module with
  14 tests.
- The path that caused the July revert — pre-generated audio — has a regression test named for it,
  and was confirmed working on a live call with a log line naming it.
- "No behaviour change" is backed by a 2,044-case differential harness against the original code,
  not by assertion.

**What remains uncovered, recorded so a green Phase 8 is not over-read:** `holdAnswer` and
`endSpeech` are still untested by automation (Phase 2 §2.4), the wiring between `index.js` and the
module is proven by one live call rather than by a test, and no test exercises Deepgram mishearing
a pause word.

---

## 5. Governance record

Phases 0 through 8 complete. **One violation, disclosed and not tidied away:** Phase 1 was drafted
without a separate go-ahead for the 0→1 transition, on the strength of a Phase 0 approval that
carried a forward-looking instruction. Wael caught it, approved the transition retroactively, and
required the violation be recorded in the Phase 1 document, where it appears at the top. It was
disclosed again in the Phase 6 review prompt so the Governance Compliance verdict was issued on the
full record; the reviewer passed it as recorded and corrected.

**Every other transition — 1→1A, 1A→2, 2→3, 3→4, 4→5, 5→6, 6→7, 7→8 — had Wael's explicit prior
go-ahead.**

**This is the fourth occurrence of that same phase-gate failure across the project's history**
(2026-07-15, 2026-07-17, 2026-08-15, and this one), against three escalating written rules and zero
mechanical enforcement. Every occurrence was caught by Wael reading the output. The memory entry
`feedback_governance_phase_gate_wait` now proposes the only intervention not yet tried: a pre-push
hook refusing a new `*_PHASE<N>_*` document with no recorded approval, matching the pattern already
used for schema drift and undefined names. **Not built; proposed.**
