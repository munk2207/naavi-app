# B11f — Phase 6: Technical Review Prompt (After Coding)

**Work item:** [[B11f]] — pause and resume on a voice call
**Date:** 2026-08-21
**Commit under review:** `4724f7d` on branch `staging` (`naavi-voice-server`), parent `33e7558`
**Risk:** MEDIUM — Protected Core (`naavi-voice-server/src/index.js`)

**Documents:**
- Phase 2 change plan — `docs/B11F_PHASE2_CHANGE_PLAN_2026-08-21.md`
- Phase 3 authorisation — `docs/B11F_PHASE3_REVIEW_PROMPT_2026-08-21.md` + your Phase 3 verdict
- **Phase 5 evidence — `docs/B11F_PHASE5_EVIDENCE_2026-08-21.md`**
- Architecture Reference — version `2026.07.18.7`

---

## 1. What was built

The two functions deciding what a caller hears on resume were closures inside a ~1,400-line
WebSocket handler — **untestable, and therefore untested**. They now live in
`src/voice/resumePoint.js` as pure functions, covered by 14 tests.

| File | Lines | Change |
|---|---|---|
| `src/voice/resumePoint.js` | +102 | New. `bytesSpokenSoFar`, `resumePointOf`, three named constants replacing magic numbers. |
| `src/index.js` | +23 / −18 | Two closures removed; one import; `bytesSpokenSoFar` becomes a per-connection wrapper. |
| `test/resumePoint.test.js` | +173 | New. 14 tests. |

**Both call sites are unchanged** — `bytesSpokenSoFar()` at `:10316` and `resumePointOf(held)` at
`:10289` read exactly as before.

---

## 2. Evidence for the central claim

The plan promised **no behaviour change**. The evidence is a differential harness, not an
assertion: the original closure bodies, copied verbatim from `33e7558`, run against the extracted
module.

```
input combinations compared: 2044
divergences: 0
```

Both playback paths; clocks before, at, and long after dispatch; `audioDispatchedAt = 0`; buffers
of 0 / 1 / 16k / 80k; seven text shapes including empty, unpunctuated, no-space-after-full-stop,
multiple spaces, and `?`/`!` terminators.

**Tests: 133 pass, 0 fail** (119 pre-existing unchanged + 14 new). `node --check` clean, `eslint`
clean, `no-undef` pre-push gate passed.

---

## 3. Please review

- The **git diff** (`git diff 33e7558..4724f7d`)
- **Changed files**
- **Architecture impact**
- **Regression risk**
- **Isolation**
- **Test coverage**

---

## 4. Where I would most value your scrutiny

**4.1 — The residual risk I have documented but not eliminated.**
The arithmetic is proven equivalent. **The wiring is not.** `index.js` builds the state object from
four closure variables:

```js
return bytesSpokenSoFarOf({ usingPreGenAudio, lastTtsBytes, audioDispatchedAt, preGenTotalBytes });
```

A transposition — `lastTtsBytes` where `preGenTotalBytes` belongs — would type-check, lint clean,
and **pass all 133 tests**. The only defences are the shorthand object literal (property and
variable names must match) and a live call.

**Is that acceptable, or does it mean the extraction moved the risk rather than reducing it?**

**4.2 — Is the seam coherent?**
`resumePointOf` and `bytesSpokenSoFar` are now in a module; `holdAnswer` and `endSpeech` — same
mechanism, adjacent lines — remain in the handler. Phase 2 §2.4's reasoning: both *mutate* per-call
state rather than computing a value, so extracting them means inventing a shared mutable state
object, which Rule 19 asks to justify. **Consequence, stated plainly: `holdAnswer` stores what
`bytesSpokenSoFar` computes, and stays untested.** Sound, or the harder half rationalised away?

**4.3 — Do the tests test the right things?**
They assert caller-visible behaviour rather than return values — e.g. pausing in the third sentence
resumes at the **second** (the deliberate one-sentence rewind), and one regression test named for
the July revert asserting the pre-generated path reports progress at all. **Is anything important
uncovered?**

**4.4 — A defect the tests caught, in the tests.**
The first run failed. Expected boundaries were written as 45 and 84; they are **46 and 85**. The
implementation was right, the test was wrong. Fixed by computing the boundaries and naming them as
constants rather than adjusting numbers until they matched. **Does that undermine confidence in the
remaining expectations, or demonstrate the suite working?**

---

## 5. Architecture Drift Rule

Please issue this as part of the Architecture Completeness verdict.

**My assessment: outcome 1 — matches.** The implementation stays inside the component the Reference
already assigns this capability to (§3, *Voice server should own… playing audio back, handling
barge-in/interruption*), adds no duplication, removes none, and bypasses no Shared Core. A module
boundary inside one entry point is below the granularity the Reference describes.

**One known Reference gap, already recorded at Phase 1A §6 and NOT introduced by this commit:** §3
treats "barge-in/interruption" as a single capability, whereas on `staging` ordinary speech no
longer interrupts. That divergence was created by the original B11f work in August, not by this
change. It is accurate for production today and becomes wrong only on promotion, so Phase 1A logged
updating §3 as a **Phase 8 obligation**.

**Do you agree that is outcome 1, or do you read the pre-existing §3 gap as outcome 3 — the
Reference was already stale before this work started?**

---

## 6. Invalidated Planning Assumption Rule

**One, and it was in the tests rather than the plan:** Phase 2 assumed the expected sentence
boundaries could be written by hand. They could not — see §4.4. No change to the plan's approach
followed; the constants are now computed from the text.

**Everything else in the Phase 2 plan was carried out exactly as written.** `resumePointOf` moved
verbatim; `bytesSpokenSoFar` kept identical arithmetic with a defaulted clock; `holdAnswer` and
`endSpeech` were left in place as the plan provisionally decided; three files changed and no
others.

---

## 7. Required output

Four independent verdicts. **No numeric scores** — they hide failures in individual dimensions.

- **Technical Review:** PASS / FAIL
- **Architecture Completeness:** PASS / FAIL — including the Architecture Drift Rule question in §5
- **Governance Compliance:** PASS / FAIL
- **Overall Recommendation:** Approved / Approved with Mandatory Changes / Rejected

**Please also address §4.1 explicitly.** It is the one place I think this change could still be
wrong, and I would rather you tell me it is unacceptable now than have it found on a live call.

---

## 8. Governance note, disclosed rather than omitted

This work item had a **phase-gate violation at the 0→1 transition**: Phase 1 was drafted on the
strength of Phase 0's approval carrying a forward-looking instruction, without Wael's separate
go-ahead for starting Phase 1. Wael caught it, chose to approve the transition retroactively, and
required the violation be recorded in the Phase 1 document, where it appears at the top.

It is disclosed here because Governance Compliance is one of your four verdicts and you should
assess it on the full record. **Every subsequent transition (1→1A, 1A→2, 2→3, 3→4, 4→5, 5→6) had
Wael's explicit prior go-ahead.**
