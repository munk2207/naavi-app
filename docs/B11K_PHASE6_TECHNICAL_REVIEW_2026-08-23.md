# B11k — Phase 6: Technical Review (After Coding)

**Work item:** [[B11k]]
**Date:** 2026-08-23
**Phase 5:** REVISE → resolved (revision 2), 158 tests pass
**Branch:** `naavi-voice-server` @ `staging` — **not committed, not pushed, not deployed**
**Architecture Reference:** 2026.07.18.10
**Risk:** HIGH · Protected Core — this review is mandatory

## ✅ Verdicts — APPROVED, 2026-08-23

| Verdict | Result |
|---|---|
| Technical Review | **PASS** |
| Architecture Completeness | **PASS** |
| Governance Compliance | **PASS** |
| **Overall Recommendation** | **Approved** |

**Provenance, stated exactly.** The external review passed all four verdicts. That outcome is
recorded here on **Wael's own confirmation, 2026-08-23** — *"Phase 6 already approved, I did not
clearly state that"* — corroborated by the Phase 7 plan review, which stated the same and asked for
the pending-verdict warning to be withdrawn.

**The reviewer's own Phase 6 text was not relayed into this repository, and is not reconstructed
here.** Recording the four verdicts is accurate; inventing the prose that produced them would not
be. If the review text is available it should be pasted below this block.

**Phase 8's merge precondition — *"External review completed (when required)"* — is satisfied.**

**§8's two open questions were carried by this approval**, including §2's pause-hold behaviour
change. Note that §2 remains **validated by code reading, not by observation** — Phase 7's **T4** is
the live test that settles it, and it had not been run when this approval was given.

---

Submission for external review of the diff. Four independent verdicts were required: Technical
Review, Architecture Completeness, Governance Compliance, Overall Recommendation.

---

## 1. What changed

| File | Change |
|---|---|
| `src/outcome_report.js` | **New**, 187 lines. Pure module, no I/O, no dependencies: `classifyResult`, `sentenceFor`, `composeTurnSpeech`, the phrase table, `BATCH_TIMEOUT_MS = 5000`. |
| `test/outcome_report.test.js` | **New**, 25 tests. |
| `src/index.js` | **+97 / −18**, five hunks. |

Full diff: `docs/B11K_PHASE5_index_js.diff`. Substantive hunk reproduced in the Phase 5 Evidence
Package §3.

The five hunks map one-for-one onto Phase 3 §4.1's authorized boundary: the `require`, the two
`else if` branches (`LOG_CONCERN`, `UPDATE_PROFILE`), the new awaited batch, and the removal of the
fire-and-forget block. **No sixth hunk exists.**

---

## 2. ⭐ Behaviour change found by self-audit, outside what any phase anticipated

**Relocating the execution earlier means it now runs on a path where an early `return` previously
skipped it entirely.**

`src/index.js:13378` — the pause-word hold path, inside the pre-generated-audio branch:

```js
if (holdReplyForTurn !== null && holdReplyForTurn === currentTurnId) {
  holdReplyForTurn = null;
  isSpeaking = false;
  stopMusic();
  holdAnswer(finalSpeech, 0);
  console.log('[B11f] reply born held — pause arrived while composing (pre-generated)');
  return;                                  // ← line 13378
}
```

**Before this change**, the fire-and-forget block sat at line 13484 — *after* this `return`. So if a
caller said a pause word while Naavi was composing, the function returned and **the caller's actions
were never executed at all.** Silently. A reminder they had just asked for was simply never created,
with nothing said and nothing logged.

**After this change**, the batch runs at 13320, before the return. **The actions now execute.**

### 2.1 Why I believe this is a fix rather than a regression — and why the reviewer should test it

- The path's purpose is to hold the **speech**, not to cancel the work. It calls `holdAnswer(...)` to
  store the reply for resume; nothing in it expresses intent to abandon the action.
- Interrupting Naavi mid-sentence is not a cancellation gesture. A caller who says *"stop"* while she
  is talking has not withdrawn the reminder they asked for one second earlier — and under the old
  behaviour they had no way to know it had been dropped.
- **It is the same defect family as B11k itself**: an action the caller requested, silently not
  performed, with no signal. Found only because the relocation forced a read of every path between
  the old and new call sites.

**Counter-argument the reviewer should weigh:** if any caller has ever used a pause word *as* a
cancel, this changes what that does. My reading of the code is that cancellation lives elsewhere —
`detectStandaloneCancelIntent` and the `pending*` gates — and that this path is purely about audio.
**I have not exercised it live**, so this is a code reading, not an observation.

**Recorded as an Invalidated Planning Assumption** (Phase 6 rule): Phase 2's Regression Matrix traced
`executeAction`'s consumers and the `pending*` deferral flows, and did not identify that the *old*
call site was reachable-or-not depending on an early return 106 lines above it. That is a planning
gap, not an implementation error and not a scope cut.

---

## 3. Architecture impact

| Question | Answer |
|---|---|
| Shared Core modified? | **No.** No Edge Function, no schema, no cron, no API contract. |
| Entry point modified? | **Yes**, and in the direction Reference §3 asks for: the voice entry point now reports what Shared Core returned instead of substituting its own optimistic account. |
| New duplication introduced? | **No.** `outcome_report.js` is voice-local with no counterpart to drift from. |
| Existing duplication eliminated? | **Partially.** Voice's behaviour is brought into line with the other two implementations; the three are not unified. §5a Priority 1c stays open, as planned. |
| Ownership changed? | **No.** §4's Ownership Change Rule is not engaged. |
| Protected Core modified? | **Yes** — Voice orchestration, Action Rules, Reminder Engine, Calendar integration, Notification routing. |

### 3.1 Architecture Drift Rule

**Outcome 1 — matches.** The Architecture Reference at 2026.07.18.10 already describes this
capability as a three-way duplication with voice's instance broken (§5a Priority 1c, §2), because
**this work item wrote those rows** as its Phase 1A reconciliation. The implementation matches what
the Reference now claims. No further Reference update is required at Phase 8 beyond confirming the
version is unchanged since Phase 2.

---

## 4. Regression risk

| Area | Assessment |
|---|---|
| **All-success turns** | **Byte-identical to before.** `composeTurnSpeech` returns the original speech unchanged, `speechWasModified` stays false, the pre-generated-audio fast path is untouched. Asserted by test. |
| **The three existing gates** | Untouched. `list_confirm_gate.js`, `action_rule_confirm_gate.js` and B10q's inline branch are byte-identical — deliberately not consolidated, per Phase 3 §4.3. |
| **`pending*` deferral flows** | Untouched. None enters `backgroundActions`. |
| **`START_CALL_RECORDING`** | Still after dispatch, unmoved. |
| **Turn latency** | Bounded at 5 s for the whole batch, only on turns carrying background actions. **Not measured live** — §6. |
| **The pause-hold path** | Changed. See §2. |
| **156 pre-existing tests** | All still pass, none modified or disabled. |

---

## 5. Isolation

- `outcome_report.js` is pure: no I/O, no imports, no shared state. Every branch is reachable from a
  unit test.
- `index.js`'s new block calls the module and acts on the answer; **it performs no classification of
  its own**, which is what makes the contract testable rather than inspectable.
- The removed `.catch()` was **dead code**: `executeAction` wraps its whole body in `try/catch`
  (`src/index.js:6201-6204`) and returns `{ error: err.message }`, so it essentially never rejects.
  This is stronger than Phase 1 §3.2 claimed — the catch was unreachable for essentially every real
  failure, which is why `[Process] Background action error` never appeared in any log.

---

## 6. Test coverage

**158 pass / 0 fail** (133 pre-existing + 25 new), `npm test`, 911 ms. Voice pre-push gate clean.
`node --check` clean on both changed sources.

| Contract | Covered |
|---|---|
| Classification — rejection, `{success:false}`, **bare `{error}`**, `{skipped:true}`, timeout, success, null/undefined, missing record | ✅ 9 tests |
| Safe default for an unregistered action type | ✅ |
| Read-only actions absent from the phrase table | ✅ |
| Original speech survives an all-success turn | ✅ |
| **No fragment of the original survives a failed or mixed turn** | ✅ asserted against the literal string |
| Two failures named; three collapse to a summary; successes reported alongside | ✅ |
| Withdrawn Phase 2 wording cannot return | ✅ regex guard |

**Acknowledged coverage gap, approved under Rule 15a by Wael 2026-08-23:** the mobile auto-tester
structurally cannot reach this code — it exercises Edge Functions over HTTP, and this is control flow
inside a Node process on Railway. **No live call has been made.** Nothing in this document claims
anything about live behaviour.

---

## 7. Governance compliance

| Requirement | Status |
|---|---|
| Phase-Gate Approval Rule — Wael's word at every transition | ✅ 0→1, 1→1A, 1A→2, 2→3, 3→4, 5→6 |
| Phase 1A Cross-Repository Verification + Provenance tags | ✅ |
| Architecture Reference reconciled before proceeding (Outcome 3) | ✅ bumped to 2026.07.18.10 |
| Phase 3 Implementation Boundaries + Deferred Architectural Decisions | ✅ |
| Phase 4 No Extra Changes Rule | ✅ five hunks, and every nearby improvement reported in Phase 5 §6 rather than implemented |
| Non-Determinism Rule | **Not applicable** — no prompt or classifier changed. Stated rather than omitted. |
| Rule 15a | ✅ exception approved by Wael with substitute evidence recorded |
| Invalidated Planning Assumption Rule | ✅ two recorded — Phase 5 §6.2 (`{skipped:true}`), and §2 above |
| Staging-first | ✅ branch `staging`; production untouched |

---

## 8. What the reviewer is asked to rule on

1. **§2 — the pause-hold behaviour change.** Is executing the caller's actions on that path correct?
   This is the one finding where I am reasoning from code rather than observation.
2. **Whether §2 requires a live test before Phase 7**, or can be validated as part of it.
3. The four Phase 6 verdicts.

**Decision required:** Technical Review PASS/FAIL · Architecture Completeness PASS/FAIL · Governance
Compliance PASS/FAIL · Overall: Approved / Approved with Mandatory Changes / Rejected.

Per governance §3, Phase 7 does not begin until Wael's own explicit word.
