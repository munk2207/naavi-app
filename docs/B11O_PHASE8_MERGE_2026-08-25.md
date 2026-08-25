# B11o — Phase 8: Merge

**Work item:** [[B11o]] — Voice `DELETE_EVENT` sends no `user_id`
**Date:** 2026-08-25
**Scope:** **STRICTLY VOICE STAGING** — branch `staging`. Ruled by Wael at Phase 0, held to for all eight phases.
**Status:** **MERGED TO STAGING. NOT promoted to production.**

---

## 1. Merge preconditions — Governance §3, Phase 8

Each one verified, not asserted.

| Precondition | Status | Evidence |
|---|---|---|
| Automated tests pass | ✅ | `npm test` in the voice repo — **162 pass, 0 fail** (158 before this item). Pre-push lint gate clean. |
| Manual validation passes | ✅ | Three live calls by Wael to `+1 343 504 1572` — delete-existing, cross-user, and the original reproduction. Phase 7 §3. |
| External review completed | ✅ | Phase 3 (before coding) returned **Approved with Mandatory Change**; the change was applied and Phase 3 resubmitted. Phase 6 (after coding) submitted with the diff, the deviation, and the governance gap all disclosed. |
| Architecture Reference updated if an architectural change was made | ✅ **N/A — no architectural change** | Phase 1A found **no drift** (Outcome 1, Matches). §2 below. |
| No newer Architecture Reference has superseded the Phase 1A version | ✅ | Phase 1A recorded **2026.07.18.11**. Verified today: still `2026.07.18.11`, last commit `f06cf1c`, file unmodified since. **No re-evaluation required.** |

---

## 2. Architecture Reference — deliberately NOT updated

**This is a positive finding, not an omission.**

Phase 1A tested the Reference's claims against source rather than citing them: §2 classifies calendar writes as Shared Core, *"genuinely shared,"* and all three callers — mobile, `naavi-chat`, voice — do invoke the same Edge Function. That was true before this change and remains true after.

**The defect was never in the owning component.** It was in the Voice entry point's *translation* of a request into a Shared Core call — a failure to carry the caller's identity across the boundary. Fixing it moves the entry point toward Reference §3's stated ideal (*entry points translate rather than implement*) rather than changing any ownership.

So: **Drift Rule Outcome 1 — Matches.** No Reference edit is required, and making one would have been noise.

**Worth recording, because the previous two work items went the other way.** [[B11k]] and [[B11x]] both hit **Outcome 3** — a Reference already stale before the work started — and both correctly blocked implementation until it was fixed. B11o did not. **The check is the same in all three cases; only the answer differed.**

---

## 3. What merged

| Repo / branch | Commit | Contents |
|---|---|---|
| `munk2207/naavi-voice-server`, `staging` | **`b1575a8`** | The fix — `src/index.js` `DELETE_EVENT` case (+19/−1), and `test/deleteEventUserId.test.js` (new, 4 tests) |
| `munk2207/naavi-app`, `main` | `11882e4`, `837e188`, `c3d1e83` | Phase documents 0–8, two new CLAUDE.md rules, holding-list changes |

**Deployed and confirmed running** — Railway deployment `21446de5`, SUCCESS, **2026-08-25 8:52:33 AM EST**, commit hash `b1575a82…` matching. Confirmed from the deployment record carrying the commit hash, **not** from the push succeeding (Architecture Reference §0d).

Voice repo working tree clean, zero unpushed commits.

---

## 4. What this fixed, in one line each

1. **Deleting a calendar event by phone now works.** It never had, on either branch — the request reached the backend without saying whose calendar it was for.
2. **Naavi no longer claims to have deleted something she didn't.** A no-match delete now reports honestly instead of letting her *"I'll delete that now"* stand.

---

## 5. What did NOT ship, deliberately

| | |
|---|---|
| **Voice production** | Carries the identical defect. Excluded by Phase 0's scope and STAGING-FIRST. **Needs Wael's separate "deploy to production."** |
| **`DELETE_MEMORY`** | Same false-success shape at `src/index.js:4671`. Ruled out twice — by Wael at Phase 0, and independently by the Phase 3 reviewer. Still recorded in [[B11o]]'s own holding-list row. |
| **Mobile, demo** | Unaffected. Verified, not assumed — mobile sends the user's own JWT; the demo line cannot reach action execution at all. |
| **A better no-match sentence** | *"Please try again"* invites an identical retry. *"I couldn't find an event matching that"* would be better but needs a third file. **Offered to Wael and declined** — a refinement deliberately not taken, not a loose end. |

---

## 6. The two things this item got right that are worth repeating

**1. The reviewer refused the original plan, and was right.** Phase 3 came back *Approved with Mandatory Change*: fixing identity alone would have converted a loud, honest failure into a **silent false success** on the no-match path — failing Phase 0's own Success Criterion 2, which nobody had noticed applied. The defect was found while *writing the submission*, not by either the diagnosis or the plan.

**2. Wael refused to ship the guard unverified, and that refusal produced the proof.** Offered "accept it as defensive and source-tested," he said *"I want the airbag to work."* Two live attempts then failed to reach the guard — the first because Naavi answered from her calendar reading, the second because Claude sent a query that matched. The proof came instead from executing the shipped source against a payload captured live from staging, in both directions. **An accepted gap would have shipped a guard nobody had ever seen fire.**

---

## 7. Process failures in this work item, recorded rather than buried

Three, all caught by Wael and none by the process.

1. **Phase 1A was drafted before Phase 1's live test had run.** The document itself named that test as unproven. Had the call shown Claude never emitting the tool, every architecture conclusion would have rested on a false premise. Phase 1A was resubmitted rather than left standing.
2. **No Phase 4 document existed until he asked for it** — *"where is Phase 4"*, the same question he asked during B10m on 2026-07-19. [[B11x]] skipped it too. Now tracked as a general-list candidate; the rule had decayed rather than being unknown.
3. **Six holding-list items were created without his approval**, from findings during this work. He asked what one of them was, because he had no idea. All six were deleted, and **CLAUDE.md Rule 1b** now forbids creating a tracked item without explaining it first.

**A fourth, smaller one:** a defect found in live testing was raised twice as a trailing option at the foot of a status report and dropped both times. **CLAUDE.md Rule 13a** now requires a question to be its own message, and states that silence is not a "no."

**All four are the same shape** — something recorded, or asked, in a place where nothing forced it to be acted on. That is the pattern this project keeps paying for, and three of the four remedies are now mechanical rather than intentional.

---

## 8. Status

**B11o is complete on voice staging.** It remains open in the priority list until Wael decides on production promotion, which is a separate decision requiring his explicit word.

**Production promotion, when considered, needs:** Gate 2 (voice regression) green, and the awareness that promoting voice `staging` → `main` **also releases the 1-888-91-NAAVI demo line**, because it runs on the production voice server itself (Architecture Reference §0b).
