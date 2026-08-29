# B12k — Phase 8: Merge

**Work item:** [[B12k]] — Naavi is too slow to answer on voice.
**Date:** 2026-08-29
**Covers:** Stages 1 and 2. **Stage 3 is not built and does not merge here.**
**Status:** **APPROVED by Wael, 2026-08-29 — "Phase 8 approved."** Approved after two returns: a false claim that no ChatGPT review had been obtained for any phase, and a recommendation that Stage 3 restart at Phase 2 when it was already authorized in Phase 3.

---

## 1. The five merge preconditions

Governance §3 lists what must hold before a change enters Staging.

| # | Precondition | Status |
|---|---|---|
| 1 | Automated tests pass | **MET** — Gate 2 against STAGING: 54 passed, 0 failed, 0 errored, 4 environmental skips |
| 2 | Manual validation passes | **MET** — live call 2026-08-29 against a bar fixed before the call, plus five opening calls at ≤3 s |
| 3 | External review completed (when required) | **MET** — ChatGPT reviewed every phase; see §2 |
| 4 | Any intentional architectural change has updated the Architecture Reference **in this work item** | **MET — vacuously.** No intentional architectural change was made |
| 5 | No newer Architecture Reference has superseded the version recorded at Phase 1A | **MET — verified, see §3** |

---

## 2. External review — performed throughout

**ChatGPT external technical review was performed on every phase of B12k**, per Governance §1. **Wael acted as Product Owner and approver, carrying the reviewer's findings back to Claude** and issuing the phase-gate decisions himself.

> **⚠ Corrected 2026-08-29 on Wael's challenge. An earlier version of this section stated "No ChatGPT review was obtained for any phase of B12k" and attributed the reviewing to Wael personally. That is false**, and it is the same failure pattern this work item has been correcting all night — a "Wael did / said / directed" attribution asserted without evidence, this time inverted into denying that the required review had happened at all. **In a Phase 8 document, whose function is to certify that governance was followed, it would have recorded a compliance failure that did not occur.**

**The review was adversarial rather than a formality.** Fourteen phase documents were returned with specific technical challenges, several of which changed the engineering rather than the prose:

- **Gate C3** had made a rare event's recurrence a precondition for building protection against rare events.
- **A claim that Node freezes `process.env` at process start** — false; the real finding was Railway's container-replacement behaviour.
- **A manufactured 90-turn statistical threshold** derived from a single event in 30 trials, alongside a false statement that a clean run below it would not be evidence.
- **An "every non-trivial turn" claim** resting on three turns from one call.
- **Two methodology decisions handed to the reviewer** that belonged to the implementer.

**Wael's own direct challenges are distinguishable from the reviewer's, and several were decisive.** These arrived in his own voice rather than in the review format:

- *"Give me your reference that I said that??"* — which exposed a narrow place-cache rule being cited as a general anti-cache position of his.
- *"I'm not agreeing with your analysis, it is a wrong presentation of the Fact"* — on [[B9x]], which led to establishing that the item was an example of the process working, not failing.
- *"What your reference?"* — on a Phase 0 exclusion cited back to him as his ruling when the document itself labelled it Claude's proposal.
- *"This is a voice call. Naavi has no idea from where you are calling"* — the timezone ruling, where his reason defeated Claude's recommendation.
- *"Slow down… I did not understand anything"* and *"All that talk just for this question"* — on presentation.

**The basis for that split is the form each message took** — the reviewer's arrived as structured phase verdicts, Wael's in his own words. **Where a challenge cannot be confidently assigned, it is not assigned here.**

---

## 3. Architecture Reference version check

**Recorded at Phase 1A: `2026.07.18.15`.**
**Current in the repository: `2026.07.18.15`.** Verified by reading the version line directly, 2026-08-29.

**No newer version has superseded it, so no assumption this implementation relied on needs re-evaluating.**

**One event in this work item is worth stating precisely.** Phase 1A found two omissions — `search-knowledge` has no §2 row despite three callers, and the `global-search` knowledge adapter mirrors it without appearing in §5a's *Full* Duplication Inventory. Entries were drafted, put to Wael in plain language, approved, and written in as revision `2026.07.18.16`. **He then instructed that they be reverted, and they were.** Nothing was committed, so the Reference was never in that state outside one machine.

**Both omissions therefore stand, and both predate B12k.** Neither misled this work — `search-knowledge` was found by direct search. **No reason for the reversal was given and none is inferred here.**

---

## 4. What merges, and what does not

**⭐ The code is already on staging.** `e2dcb0f` was pushed to the voice `staging` branch on 2026-08-28 and has been live since 8:55 PM EST.

**That was not a process breach — it was a sequencing problem Wael resolved deliberately.** Phase 5 §8 raised it: Governance says a change *enters Staging* after its tests pass, but Gate 2 and a live call **run against a deployed voice server**, so the evidence Phase 3 named as replacing a unit test was unobtainable before the deploy that Phase 8 gates. He ruled: deploy to staging so the tests can be executed, and a staging deployment is not production authorization.

**So Phase 8 here confirms preconditions retrospectively rather than releasing anything.** The five checks above are all met against a change that is already running.

| | State |
|---|---|
| Voice `staging` branch | **`e2dcb0f`** — Stages 1 and 2, live |
| Voice `main` branch (production) | **`5dff3d5`** — untouched by this work item |
| Production Supabase | Untouched |
| Mobile | No file changed |

**Production is not promoted and is not proposed for promotion here.** Phase 0 put production deployment out of scope, and CLAUDE.md requires Wael's explicit word for it regardless.

**⚠ And a promotion of this branch would carry more than B12k.** `main` sits at `5dff3d5` while `staging` is at `e2dcb0f`; whatever else has accumulated on `staging` since would travel with it. **Any future promotion needs that diff examined on its own terms, not assumed to be this work item.**

---

## 5. What this work item has and has not achieved

**Achieved: the ability to measure.** Before tonight, the four serial context calls were uninstrumented, two members of the parallel block were invisible, and event-loop lag was unmeasured. All three are now instrumented, and a 30-turn baseline exists.

**Achieved: one gate settled by measurement.** **Stage 3b is ruled out** — ≈260 ms against a 750 ms threshold fixed before any data existed.

**NOT achieved, and this is the point worth being blunt about: Naavi is not one millisecond faster.** Stage 1 and 2 were never going to make her faster and the Phase 2 document said so in its opening section. **The complaint Wael reported from prospects is untouched.**

**Outstanding for Stage 3 — already authorized in Phase 3, continuing within B12k rather than restarting:**

| Stage | State |
|---|---|
| **3a** — model selection | Latency gate **passes** at 2 275 ms against 1 500. **Confounded** — Haiku only ran turns the classifier judged simple. **Quality veto unresolved** — Haiku truncated mid-sentence at the token ceiling |
| **3b** — context path | **Ruled out** by the baseline |
| **3c** — bounded calls | Untested. No stall recurred; event-loop lag was zero throughout, favouring branch C1 |
| **3d** — answer length | Untested. One 1 411-character reply observed, with markdown markers in TTS-bound text |

---

## 6. Deferred by Wael, and still deferred

1. **The caller's experienced wait.** Every timing begins after Deepgram decides the caller stopped speaking and ends at audio dispatch, not at audio heard. Head-and-tail instrumentation follows as its own change.
2. **The 19.5-second historical figure.** Unattributed. Phase 7 established it is **not** the caller's opening silence — that measured ≤3 s, five for five.
3. **The stalling hop in Defect B.** Unreachable from this machine; both the CLI and Management API routes were verified closed.

---

## 7. Loose ends

1. **The staging container holds `B12K_FORCE_MODEL="banana"`** from testing. Railway's delete removed it from config without restarting the container. Harmless — it falls back to normal selection, proven in check 6 — and it clears on the next deploy.
2. **Four items surfaced under Rule 1b and never ruled on:** the reverted Architecture Reference entries; `search-knowledge` swallowing its errors silently; the 1 411-character answer with markdown in TTS-bound text; `fetchCalendarPdfBlock` existing in two places. **None has a tracked item, by design.**

---

## 8. Merge recommendation

**Stages 1 and 2 satisfy all five Phase 8 preconditions and are already live on staging. They close here.**

**B12k continues with the previously authorized conditional Stage 3 work.** Stage 3 is **already defined in Phase 2 and conditionally authorized in Phase 3**, with measurable gates fixed before any data existed. **It does not restart at Phase 2**, and this document's earlier recommendation that it should was wrong.

> **⚠ Corrected 2026-08-29 on the reviewer's challenge.** This section previously recommended *"treating Stage 3 as its own governed cycle, beginning at Phase 2 with the baseline in hand."* **That would have reopened decisions already governed** — the branch definitions, the thresholds, the boundaries, the placement rulings — and it is the same process fragmentation the reviewer rejected twice earlier in this work item, when a measurement-only Phase 2 was proposed and when Phase 3 tried to exclude Stage 3 from conditional specification. **Re-running settled governance is not caution; it is undoing it.**

**What continues, against gates that already exist:**

| Stage | Next step |
|---|---|
| **3a** — model | **The controlled comparison.** Identical prompts, both arms forced explicitly — required because the classifier's own routing proved unstable (Phase 6 §7.2). Latency and **answer quality** both measured, minimum 3 trials per case. The quality veto decides this, not the 2 275 ms |
| **3b** — context path | **Closed.** Ruled out by the baseline at ≈260 ms against 750 ms |
| **3c** — bounded calls | Sized from the baseline's healthy distribution. Validation by injected delay, which is also what the permanent regression test requires |
| **3d** — answer length | Measured against the ~400-character gate across the trial set |

**No new Phase 0, 1, 1A, 2 or 3 is required for any of these.** They execute against branches already written and approved.

**It does not recommend, and does not authorize, any production promotion.**

Per Governance §3, Phase 8 and any promotion beyond it require Wael's own separate word.
