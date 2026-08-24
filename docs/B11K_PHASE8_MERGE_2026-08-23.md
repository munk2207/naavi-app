# B11k — Phase 8: Merge

**Work item:** [[B11k]]
**Date:** 2026-08-23
**Scope of this phase:** **staging only.** Production promotion is a separate decision and is **not** authorized here.

---

## 1. Merge preconditions — each verified, not asserted

Governance Phase 8 lists five. All five are met **for staging**.

| # | Precondition | Status | Evidence |
|---|---|---|---|
| 1 | Automated tests pass | ✅ | `npm test` in `naavi-voice-server` — **158 pass / 0 fail**. 133 pre-existing + 25 new; none modified or disabled. Voice pre-push gate clean; `node --check` clean. |
| 2 | Manual validation passes | ✅ **for what was run** | T1 and T2 passed on a live staging call, Wael, 2026-08-23. **T4 and T5 were not run** — see §3. |
| 3 | External review completed | ✅ | Phase 6, all four verdicts PASS, confirmed by Wael 2026-08-23. Reviews also completed at Phases 0, 1, 1A (×2), 2, 3 and 5. |
| 4 | Any intentional architectural change updated the Architecture Reference **in this work item** | ✅ | Bumped `2026.07.18.9` → **`2026.07.18.10`** at Phase 1A, in the same commit as the edits: §5a Priority 1c, §5 narrative, §2's two new rows. |
| 5 | No newer Architecture Reference superseded the version recorded at Phase 1A | ✅ | Phase 1A recorded **.9**; current is **.10**, and `git log` on that file shows the most recent change is this item's own commit `b2b23d7`. Nothing else moved it in between. |

**Rule 15a:** exception approved by Wael 2026-08-23, conditioned on implementation and testing on
voice staging. Substitute evidence recorded in Phase 5 §6 and delivered: 25 unit tests covering the
classification contract, plus the live staging call.

---

## 2. What "merge" means for this item

**There is nothing left to merge.** The change is on branch `staging` at commit `3bf15c3`, pushed,
deployed to Railway service `naavi-voice-staging`, and confirmed running from the container's own
boot log with the image built 26 seconds after the commit.

**Merging `staging` → `main` IS the production promotion** for the voice server. That is deliberately
out of scope here, and §4 states what it would require.

**Governance record committed** at `b2b23d7` (nine phase documents, the Architecture Reference at
revision 10, five new holding-list items, six diagnostic scripts), pushed through all five main-repo
gates.

---

## 3. What this item does NOT establish

Recorded so its closure is not read as broader than it is.

- **T4 was not run.** Phase 6 §2's claim — that interrupting Naavi mid-composition now performs the
  requested action, where the early return at `src/index.js:13378` previously discarded it silently —
  **stands on code reading and has never been observed.** Not a claim B11k depends on; it is a side
  effect found by self-audit. The residual risk is that a caller who uses a pause word *as* a cancel
  now gets the action performed anyway.
- **T5 was not run.** No natural phrasing presented itself to trigger an unhandled action type. The
  `{skipped:true}` → `failure` classification is covered by unit test only.
- **Gate 2 (voice regression) has not been run.** Not required for staging. **Required before
  production promotion.**
  **⚠️ And it must not be run casually:** `npm run test:voice` shares `tests/runner.ts` with
  `test:auto`, whose `SUPABASE_URL` **defaults to production**, and whose fixtures perform live
  DELETEs regardless of `--grep`. Confirm the environment banner before running it.
- **This does not fix any of the twelve actions' underlying failures.** It makes them audible. The
  clearest case is `DELETE_EVENT`, which still deletes nothing — [[B11o]] is the fix for that.
- **The three-way duplication is not unified.** §5a Priority 1c stays open by design.

---

## 4. Production promotion — the conditions, for whenever that decision is taken

Not a recommendation to promote. A list of what promoting would require.

1. **Wael's explicit approval** — CLAUDE.md staging-first rule 5.
2. **Gate 1** `npm run test:auto` 100% green against a confirmed environment; **Gate 2** voice
   regression green. Gate 3 (Firebase) does not apply — no mobile client change.
3. **[[B11o]] should land first.** Otherwise promotion delivers a Naavi that reliably and honestly
   announces failure on every delete-event request. Truthful, still broken. Phase 1 decision 3, and
   the Phase 1 reviewer agreed.
4. **`get-naavi-prompt` is not involved** — no prompt changed, so the [[B11h]] trap (staging deployed,
   production five days stale) is not in play here.
5. **⚠️ Promoting the voice server also releases the public demo line.** 1-888-91-NAAVI runs on the
   production voice server itself (Architecture Reference §0b), so a `staging` → `main` merge is
   simultaneously a demo release. There is no way to promote one without the other until [[T3]].

---

## 5. Item status — CLOSED

**B11k is CLOSED**, 2026-08-23. Moved from the priority list to `Closed Bugs` in
`docs/HOLDING_LIST_CLOSED_ARCHIVE_2026-07-28.md`.

**⭐ This document originally argued the opposite, and the argument was wrong.** It held that B11k
should stay open because *"closure implies the defect is fixed for real users and production has not
been promoted."* Wael challenged it, and governance settles it plainly: **Phase 8 is the staging
merge, and *"Production follows the existing release process"*** — production is not a phase, it is a
release decision outside the workflow. A work item's governed lifecycle ends at Phase 8.

Holding an item open until it ships to users conflates *work item* with *release*, and would leave
essentially every completed item permanently open — occupying a capped priority slot while its
engineering is finished. That is the failure the cap exists to prevent, not an application of it.

**What closure does not claim.** The closed row records it explicitly: production is not promoted,
`DELETE_EVENT` still deletes nothing ([[B11o]] is that fix), and T4/T5 were not run. Closing B11k
asserts the fix is built, reviewed, shipped to staging and confirmed live — nothing more.

**Priority list is now 4 of 5, one slot free.** [[B11o]] is the natural candidate: it gates B11k's
own production promotion. That remains Wael's call.

---

## 6. Governance closing note

Eight phases, seven external reviews, two of which returned **REVISE** and were right to:

- **Phase 1A** recorded a PASS while its own findings showed the Architecture Reference was already
  incomplete, and reconciled the contradiction with an exception the Architecture Drift Rule does not
  provide. The correction produced revision 10 — the row naming a class that had been fixed narrowly
  five times without anyone seeing it as one thing.
- **Phase 5** caught `{skipped:true}` classifying as success. Implementing the approved contract
  literally was the right process call and produced the wrong outcome; reporting it was what let the
  review fix it.

**And the finding that outlives the item:** 158 unit tests, seven reviews and eight governance phases
found none of [[B11m]], [[B11n]] or [[B11o]]. One phone call found all three. The process is what
made the fix safe to ship; **it is not what found the bugs.**
