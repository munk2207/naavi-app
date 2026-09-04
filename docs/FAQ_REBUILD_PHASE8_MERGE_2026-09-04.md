# FAQ Rebuild — Stage 1, Phase 8: Merge

**Date written:** 2026-09-04
**Item:** F25 Stage 1 (web)
**Architecture Reference at merge:** `2026.09.03.17`
**Governance:** v4.3, Phase 8.

> ## ⚠️ THIS DOCUMENT IS RETROSPECTIVE
>
> **It was written on 2026-09-04, after the work it describes had already shipped.** Stage 1's phase
> documents stop at Phase 7, which still reads *"HELD — awaiting Wael's authorisation"* — a status
> that stopped being true when the deploy was authorised and was never updated.
>
> The gap was found by Wael, on 2026-09-04, by asking four times whether the Stage 2 Phase 3 review
> reflected everything open. The first three answers audited code, then tests, then documents, and
> each found more. **The record was the last place anyone looked.**
>
> **Wael's instruction, 2026-09-04: "Do not rewrite history — record the actual
> deployment/manual-validation sequence and defects discovered."** This document does that. Where
> the sequence departed from the plan, it says so.

---

## 1. What merged

| Repository | Commits |
|---|---|
| `munk2207/naavi-app` | `4f79c19` (2026-09-03 22:51 EST) — migration, `get-faq`, `manage-faq`, `match-faq`, migration script, tests, phase documents · `f1811e3` (2026-09-04 09:00 EST) — the Architecture Reference reconciliation |
| `munk2207/naavi-staff` | `b9e224c` (2026-09-03 04:18) · `de8cd9a` (22:53) · `0750aaa` (2026-09-04 06:36) · `b8261c9` (08:56) |
| `munk2207/mynaavi-website` | `4ac088e` (2026-09-04 05:32) · `372c2d2` (06:21) · `cdb2183` (06:48) · `8d53958` (08:56) · `405b2a5` (09:11) · `5c7d09d` (09:14) · `8210825` (09:19) |

Production Supabase `hhgyppbxgmjrwdpdubcx`: four tables and three Edge Functions, live.

---

## 2. ⚠️ The sequence actually run, against the sequence planned

Phase 2 §7 specified: staging → tests → **Wael approves production** → functions and migration to
production → staff portal → **Wael's manual pass** → website last.

**What happened:**

| # | Event | Matches the plan? |
|---|---|---|
| 1 | Migration + 3 functions deployed to staging; 20 tests green | ✅ |
| 2 | Phase 7 recorded **HOLD**, requesting authorisation to deploy to production | ✅ |
| 3 | **Migration + 3 functions deployed to PRODUCTION** | ⚠️ **Authorised, but no phase document records the authorisation or the deploy.** They were found already live at the start of the 2026-09-04 session |
| 4 | Staff portal pushed (`b9e224c`) | ⚠️ Same — no document |
| 5 | Wael added 3 test questions on production via the staff portal, 08:22 and 23:45–23:47 EST on 2026-09-03 | Not in any plan |
| 6 | Session of 2026-09-04: staff list ordering fixed, category management built, `manage-faq` redeployed to staging then production | Outside Stage 1's Phase 2 file list |
| 7 | **Wael used the staff portal and found six defects** | ✅ the manual validation Phase 7 asked for — **but after the deploy, not before** |
| 8 | Six defects fixed and shipped as they were found | ⚠️ No Phase 5 evidence document |
| 9 | Website pushed (`4ac088e`) — **build failed** | ⚠️ First customer-visible step, and it failed |
| 10 | Build fixed (`372c2d2`), website live | ✅ |
| 11 | Architecture Reference reconciled (`f1811e3`) | ✅ Phase 8 precondition met |

**The material departure is not the ordering — it is that steps 3 through 9 produced no documents.**
The work was authorised at each point; the record simply stopped at Phase 7 and never resumed.

**A second departure worth naming:** Phase 2 §7 put the website last *"because its pages go live the
moment they are pushed and there is no staging to catch a mistake."* That reasoning was correct and
the first push still failed — Vercel rejected the build with *missing public directory*, because
adding a `buildCommand` to a previously static site makes Vercel look for an output directory that
did not exist. The site kept serving the previous deployment throughout, so no customer saw
anything. **The precaution worked; the plan simply had no step that would have caught it.**

---

## 3. Manual validation — what it actually produced

Phase 7 §5 recorded *"Manual: PARTIAL. The staff-facing surface is not verified at all, and this
document does not pretend otherwise."* **That was true when written and is now false.** Wael
validated it on 2026-09-04 and found **six defects, none of which any test caught.**

| # | Defect | Fix |
|---|---|---|
| 1 | **Category management did not exist.** `manage-faq` had `categories` and `add_category` from the start and nothing called them — "staff own the list" was true of the database and false of anyone using it | `de8cd9a` |
| 2 | **The staff list was oldest-first**, so a just-written answer landed below everything already published | `4f79c19` |
| 3 | **"Publish again" was invisible.** `.item.inactive` faded the whole card at 55% including its buttons — the one control that reverses the state | `0750aaa` |
| 4 | **The empty state blamed the wrong filter.** One word typed and a category chosen produced *"Try fewer words"*. Measured: the word alone found 2, the category alone held 4; only the combination was empty. The advice was the one action that could not work | `cdb2183` |
| 5 | **A published answer was invisible for up to an hour.** `get-faq` sends `max-age=3600`; a browser held 23 answers in 11 ms while the server had 26 — and the page had already rendered the correct 26 from its generated copy before the stale fetch overwrote them | `8d53958` |
| 6 | **No way to check whether an answer already existed** before writing a new one, at 26 answers and growing — the duplication F25 exists to remove, reappearing inside the tool built to remove it | `b8261c9` |

Plus two presentation corrections Wael asked for: the status line no longer reads *"2 of 26"*
(`405b2a5`), and the two controls carry bold labels with the search clearing on category change
(`5c7d09d`, `8210825`).

**Every one was found by using the product. None was found by a test.** Each now has a regression
test — the F25 catalogue grew from 20 cases to 30.

**The transferable lesson, and it is not "test more":** defects 3 and 4 were both *states I had built
and never looked at* — a hidden item, and an empty result. I verified the paths that work and
skipped the ones that do not.

---

## 4. Phase 8 merge conditions

| Condition | Status |
|---|---|
| Automated tests pass | ⚠️ **Qualified.** Phase 7 recorded 592/595 with 1 pre-existing calendar flake and 2 documented skips — *"this is not 100% green, and it should not be reported as such."* The 10 cases added on 2026-09-04 have **not** run inside `tests/runner.ts`; they were verified by a scratch harness covering file-level assertions only. **Tracked as F1 in Stage 2's Phase 3** |
| Manual validation passes | ✅ §3 — after the deploy rather than before |
| External review completed | ✅ Phases 3 and 6 |
| Architectural change updated the Reference in this work item | ✅ `f1811e3`, version `2026.09.03.17` |
| No newer Reference superseded the Phase 1A version unevaluated | ✅ `2026.09.01.16` → `2026.09.03.17` was this item's own edit |

---

## 5. Known open items carried out of Stage 1

Recorded so they are not lost by this document declaring the stage closed:

- **`extractJson` exists in three copies** — `match-faq`, `manage-faq`, `naavi-chat:72`. This session
  found the same parsing bug in two of the three. Deferred at Phase 6 §8 because the fix requires
  editing `naavi-chat`, outside the approved boundary.
- **The support-form glue is duplicated** between `report.html` and `contact.html`; Stage 2 adds a
  third and fourth instance in the app, deliberately (Stage 2 Phase 3 D1).
- **The website's `match-faq` call has no timeout** (Stage 2 Phase 3 A5, D2).
- **Cross-environment classifier reproducibility** — `"password"` finds an answer on staging and
  nothing on production, because the classifier assigned different search terms to the same 23
  answers. **Wael's decision, 2026-09-04: a separate item, not part of Stage 2.**
- **The rate limiter fails open silently and its counter has a lost-update race** — found in Stage 2's
  Phase 3 as A1 and A2, in Stage 1 code. **Wael approved fixing both in Stage 2.**

---

## 6. Status

**Stage 1 is CLOSED.** The web stage is live: `mynaavi.com/faq` reads from the database with search
and categories, both website support forms match on Send, and staff author answers in the portal.

**Stage 2 (mobile) is open** and at Phase 3, approved with seven mandatory changes.
