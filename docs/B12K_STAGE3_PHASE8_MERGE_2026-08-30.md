# B12k — Stage 3: Phase 8 Merge

**Work item:** [[B12k]] — Naavi is too slow to answer on voice.
**Date:** 2026-08-30
**Covers:** **Stages 3a and 3c.** 3b was ruled out by the baseline and builds nothing; 3d was closed by Wael. **Stages 1 and 2 closed at their own Phase 8** (`B12K_PHASE8_MERGE_2026-08-29.md`) and are not re-certified here.
**Status:** **APPROVED by Wael, 2026-08-30 — "accepted."** He accepted the two out-of-scope observations, which settles precondition 2 and closes Stage 3. Approved after one return, for a governance claim that had gone stale (§3). **This approval covers staging only and authorizes no production promotion.**

---

## 1. The five merge preconditions

Governance §3 lists what must hold before a change enters Staging.

| # | Precondition | Status |
|---|---|---|
| 1 | Automated tests pass | **MET** — Gate 2 against **STAGING**: 63 tests, **59 passed, 0 failed, 0 errored**, 4 environmental skips. Five of those tests are new and permanent |
| 2 | Manual validation passes | **MET, by Wael's decision 2026-08-30.** Stage 3 validation **PASS**; overall phone-test bar **NOT MET**. He accepted the two out-of-scope failures — see §2 |
| 3 | External review completed (when required) | **MET.** Every Stage 3 phase reviewed; Phase 7 reviewed twice, including the completed phone call. **Nothing outstanding** — see §3 |
| 4 | Any intentional architectural change has updated the Architecture Reference **in this work item** | **MET — vacuously.** No intentional architectural change was made. Phase 6 §2 answers all eight completeness questions "No" |
| 5 | No newer Architecture Reference has superseded the version recorded at Phase 1A | **MET — verified 2026-08-30.** Recorded at Phase 1A: `2026.07.18.15`. Current in the repository: `2026.07.18.15`, read directly from the version line |

---

## 2. ⭐ Precondition 2, stated precisely

**The call did not pass every clause of its own bar, and this document does not claim it did.**

- **The turn Stage 3a changed passed every clause.** *"Are you there?"* took the trivial fast path, selected Haiku, answered correctly in **2 411 ms**, stopped at `end_turn` rather than the token ceiling, and did not drop.
- **All three of Stage 3c's bounded sites ran on the same call** — TTS four times, the knowledge search, and `manage-rules` — with no bound firing, which is the correct outcome when nothing stalls.
- **Two clauses failed on turns Stage 3 does not touch.** Two earlier calls produced no transcript at all (zero-amplitude audio, `transcript=EMPTY`, watchdog exhausted), so no turn ran and no Stage 3 code executed. And a calendar question was answered with *"You have no alerts set up yet"* while three real events sat fetched — a defect on a routing decision made **2026-04-26**, four months before this work item.

**Why the second one is not attributed here to Stage 3, evidenced rather than asserted:** `git diff e2dcb0f..HEAD -- src/index.js` filtered for `haiku`, `sonnet`, `calendarListRe` and `isCalendarListing` returns **nothing**. Stage 3's whole behavioural surface is one regex extended and three fetches bounded.

**Wael ruled on that defect under Rule 1b and declined to create an item:** *"i Must be sure, one test does not justify creating a new items."* **No holding-list row was created.** The evidence is preserved in Phase 7 §4.

**The two verdicts are kept separate and neither is collapsed into the other:**

| | Verdict |
|---|---|
| **Stage 3 validation** | **PASS** |
| **Overall phone-test bar** | **NOT MET** |

> **⚠ Corrected 2026-08-30 on the reviewer's return of Phase 7.** Both documents originally carried the second verdict in their bodies and then dropped it at the conclusion, declaring Phase 7 *"complete."* **A precommitted bar cannot be reinterpreted after the result is known to mean "the part my change touched."** Stage 3 does not fail for defects outside it — the diff above is the grounds — **and** the overall bar is not recorded as met, because it was not.

**So precondition 2 is not self-certified here.** The governance decision is Wael's and is stated as a question rather than assumed:

> **Are the two out-of-scope failures — the silent-audio drops and the calendar-routing defect — accepted, so that Phase 8 may proceed on a Stage 3 validation that passed?**

**⭐ ANSWERED — Wael, 2026-08-30: "accepted."** The reviewer recommended acceptance; the decision is his and he made it. **Precondition 2 is satisfied on that basis, not on a reinterpretation of the bar.**

**What accepting does and does not mean.** It means Stage 3 closes on a validation that passed for everything Stage 3 changed. **It does not retire the two failures.** The calendar-routing defect stays untracked by his separate Rule 1b ruling — *"one test does not justify creating a new items"* — and **the silent-audio failure stands as an unattributed observation** — an identification made here without Wael's approval was reverted on his instruction, 2026-08-30. **Both are recorded in Phase 7 §4 and §6 so a second sighting starts from this evidence rather than from nothing.**

---

## 3. External review — complete, nothing outstanding

**ChatGPT reviewed Stage 3 as it reviewed the rest of B12k**, with Wael carrying findings both ways and issuing the gate decisions himself.

| Document | Outcome |
|---|---|
| Stage 3 Phase 5 (Evidence) | **RETURN**, for failure-path validation performed only by inspection. Re-run with a real injected bound, resubmitted, approved |
| Stage 3 Phase 6 (Technical Review) | **RETURN**, for the *"nothing else moved"* claim in §9 that contradicted this item's own Phase 5. Corrected, resubmitted, **all four verdicts PASS / Approved** |
| Stage 3 Phase 7 (Testing) | **Reviewed twice.** Approved in draft while the call was still outstanding; **RETURN** once the call result was added, for converting a failed overall bar into *"Phase 7 complete"*; corrected and resubmitted; **Stage 3 validation APPROVED, with the overall phone-test bar explicitly recorded NOT MET.** **Wael accepted Phase 7, 2026-08-30** |

**The reviewer has seen the completed call**, including both out-of-scope defects and the split verdict, and issued that approval on it. **Precondition 3 is MET with nothing outstanding.**

> **⚠ Corrected 2026-08-30 on the reviewer's return of this document.** This section previously declared that Phase 7 *"gained its central evidence after approval"* and that **"the reviewer has not seen the outcome"**, offering to hold Phase 8 until they had. **That was true when written and false by the time it was read** — the return of Phase 7 was itself the reviewer engaging with exactly that evidence. **A declared gap has to be retired when the gap closes**, or it keeps asking for something already delivered, and misstates the review history in the one document whose job is to record it.

**The reviewer's recommendation on the remaining question is to accept the two out-of-scope observations**, on the grounds that they do not invalidate Stage 3 and that this work item already records its own 5-second target as not achieved, with the remaining lever at [[B12m]]. **That recommendation is theirs; the decision in §2 is still Wael's.**

---

## 4. Architecture Reference version check

**Recorded at Phase 1A: `2026.07.18.15`. Current: `2026.07.18.15`.** Verified by reading the version line, 2026-08-30. **No newer version has superseded it**, so no assumption this implementation relied on needs re-evaluating.

**The two known omissions are unchanged** — `search-knowledge` has no §2 row despite three callers, and its duplication inside `global-search` is absent from §5a's Duplication Inventory. Both predate B12k. Entries were drafted, approved, written as revision `2026.07.18.16`, and **reverted on Wael's instruction**; nothing was committed. **No reason was given and none is inferred.**

---

## 5. What merges, and what does not

**⭐ The code is already on staging**, under the same sequencing ruling Wael made for Stages 1 and 2: Gate 2 and a live call both run against a *deployed* voice server, so the evidence Phase 8 gates cannot be gathered before the deploy. **A staging deployment is not production authorization.**

| | State |
|---|---|
| Voice `staging` branch | **`fb6546c`** — Stages 3a and 3c, live and behaviourally confirmed |
| Voice `main` branch (production) | **`5dff3d5`** — untouched by this work item |
| Production Supabase | Untouched |
| Mobile | No file changed |
| Edge Functions | None changed |

**Deploy confirmed by behaviour, not by the push.** The per-turn `commit=` marker printed `c248cc2`, a hardcoded April literal that Architecture Reference §0d warns proves nothing. The real proof: *"are you there"* enters `trivialRe` only at `2583b9c`, and the live log shows that phrase taking the trivial branch.

**Production is not promoted and is not proposed for promotion.** Phase 0 put production deployment out of scope, and CLAUDE.md requires Wael's explicit word regardless.

**⚠ A promotion of this branch would carry more than B12k.** `main` sits at `5dff3d5` while `staging` is at `fb6546c`; everything accumulated on `staging` since would travel with it. **That diff needs examining on its own terms** — the same warning Stages 1–2 carried, and it has grown by seven commits.

---

## 6. What Stage 3 achieved, and what it did not

**Achieved — five check-in phrases are 3.7 seconds faster**, 6.76 s → 3.05 s through the endpoint and **2 411 ms on a real call**. They take the existing trivial fast path, which selects Haiku **and** skips calendar and knowledge context — two changes, not one, which is why the saving exceeds what the model difference alone predicts.

**Achieved — a stalled outbound call is now bounded at 10 seconds** at three sites, instead of running to two minutes and reaching nobody. Four production calls ran 104, 110, 122 and 140 seconds before this existed.

**Achieved — the model lever is now exhausted, and that is a finding, not a failure.** The controlled comparison put Haiku ahead on all four question types, and then vetoed it: Haiku **stated the work address as the home address 3 times out of 3**, and truncated open questions 3 times out of 3. Only check-ins moved. **That veto is now guarded by a permanent test**, so a future widening of the fast path fails the suite rather than reaching a caller.

**NOT achieved: B12k's 5-second bar is not met.** These changes do not move a median. The baseline stands at **8 736 ms**, with 24 of 30 turns over 5 seconds.

**The remaining lever was identified and is not in this stage.** Naavi finishes thinking before she begins speaking; unbundling the two is [[B12m]], created 2026-08-29 on Wael's approval under Rule 1b. **3b was ruled out by measurement** — ≈260 ms against a 750 ms gate fixed before any data existed — and **3d was closed by Wael**, who ruled the premise wrong: answer length is a product decision, and the wait before she speaks is the defect, not how long she speaks.

---

## 7. Loose ends and negative confirmations

1. **Both injected staging variables are cleared.** `B12K_FORCE_MODEL` and `B12K_FETCH_TIMEOUT_MS` are **absent from the staging service configuration**, verified 2026-08-30 by reading the variables directly. Neither was ever set on production or on the staging demo service.
2. **Four tests were deleted** along with the failure-message apparatus they covered. Deliberate: a test asserting removed behaviour either fails or gets "fixed" into testing something that no longer exists.
3. **The silent-audio failure that killed two calls is recorded as an observation, unattributed.** Zero-amplitude audio, no transcript, watchdog reconnected twice and gave up. **⚠ Reverted 2026-08-30 on Wael's instruction** — this section briefly identified it as an existing tracked item, twice, **without ever presenting that identification to him.** The evidence for it was a matching log prefix, and it went untested against a real difference: the existing item's evidence has audio *flowing*, where tonight's frames carried silence. See Phase 7 §6.5.
4. **Three Rule 1b findings raised during this work item were dropped on evidence**, not deferred: `search-knowledge`'s silent catch (0 failures in 75 observations), markdown reaching TTS (Wael listened — inaudible), and `fetchCalendarPdfBlock` duplication (no live issue).

---

## 8. Merge recommendation

**Preconditions 1, 3, 4 and 5 were met outright. Precondition 2 turned on one decision that was Wael's, and he made it on 2026-08-30: accepted.**

**All five preconditions are therefore satisfied. Stages 3a and 3c close here**, and with 3b ruled out by measurement and 3d closed by Wael, **Stage 3 is complete — the last stage B12k authorized.**

**Nothing else is outstanding.** The external review is complete on every Stage 3 phase, Phase 7 included and twice over, and Wael accepted Phase 7 on 2026-08-30.

**With 3b ruled out and 3d closed, Stage 3 is complete, and with it every stage B12k authorized.** What remains for the work item is its closure record — **investigated, bar not met** — and moving it off the priority list in favour of [[B12m]].

**This document does not recommend, and does not authorize, any production promotion.**

Per Governance §3, Phase 8 requires Wael's own separate word.
