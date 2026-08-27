# B9x — Phase 8: Merge

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-27 |
| **Commit** | `d8fc080` (the fix) |
| **Architecture Reference** | **2026.07.18.13** (revision 13, this work item) |
| **Governance** | v4.2, §3 Phase 8 |
| **Status** | Conditions met. **Awaiting Wael's explicit go-ahead to close.** |

---

## 1. The merge checklist, answered honestly

| Condition | Status |
|---|---|
| Automated tests pass | **14/14 static tests pass.** ⚠️ **Gate 1 was not run** — `npm run test:auto` defaults to production and its fixtures delete rows. Not claimed. |
| Manual validation passes | **Yes for what is testable** — §2. Three branches and Site A are recorded gaps, not passes. |
| External review completed | **Phase 6: PASS / PASS / PASS, approved with conditions.** ⚠️ **Phase 3 v2's verdict never returned** — §4. |
| Architectural change reflected in the Architecture Reference **in this work item** | ✅ **Done — revision 13**, §3. |
| No newer Reference has superseded the Phase 1A version | ✅ **Confirmed** — Phase 1A recorded 2026.07.18.12; nothing intervened between then and revision 13, which this item authored. |

---

## 2. What is proven, and what is not

**Proven live on staging, `d8fc080`:**

- The request that failed 3/3 on `fc71146` now **refuses 3/3** and saves nothing.
- *"Alert me at Costco"* saves single-turn, 3/3 — the exemption is intact.
- Self-override preserved. `DRAFT_MESSAGE` untouched.
- Which path ran was **measured from logs**, not assumed: all four refusals at **Site B**.

**Not proven, and not claimed:**

- **The success path** — a name that resolves, saving in one turn with the number filled in. The
  staging Google account holds no contacts. **This is the common case for real users and it has never
  run live.**
- Ambiguous name; email-only contact on an email alert.
- **Site A — not exercised. Not failed.** It never ran, so there is no result to characterise.

---

## 3. Architecture Reference — revision 13

Two edits, one commit, per the document's own rule:

1. **§2b's Location row** — recipient resolution now has **three** creation-time call sites, not two.
   `naavi-chat` joined voice and the mobile orchestrator.
2. **New §2e** — *a location alert is built in TWO places inside `naavi-chat`*, with the table of
   which is reached when, and the record of why this needed writing down: B9x's first fix was correct
   code on one of the two, and **eleven static tests, a clean type check, and two external reviews
   all passed over it** while it was unreachable.

**§2e also carries the mobile picture** — three creation paths, only one of which resolved before
B9x, all three now covered without a mobile file changing. That is the deferred Phase 1A note, landed
where Wael said to land it.

---

## 4. ⚠️ Two governance exceptions, recorded rather than smoothed over

1. **Phase 3 v2's verdict never returned.** Phase 4 v2 was coded on Wael's explicit instruction with
   that review outstanding, after the Phase 2 v3 approval had said to re-review before coding. It was
   flagged at the time, recorded in `d8fc080`'s message, and is repeated here. **The Phase 2 v3
   approval did cover the design** — one helper, two call sites, gated to location, isolation test
   required — so what went unreviewed was the implementation boundary, not the approach.
2. **Gate 1 not run.** Static tests were executed directly because the runner points at production
   and deletes rows. This is the correct call and was endorsed by the Phase 5 reviewer, but it means
   *"automated tests pass"* above means the B9x suite, not the full gate.

---

## 5. What closing B9x does and does not mean

**Does:** the defect is fixed on the path that carries it, proven live, and merged on `main`.

**Does NOT:**

- **Production is untouched.** It still serves the pre-B9x `naavi-chat` and prompt version
  `2026-08-20-s1-pin-six-digits`. Promotion is a separate decision requiring Wael's explicit
  instruction, and is **not** part of Phase 8.
- **Reproduction 2 is not fixed.** Its rule stored no recipient at all; cause unproven. Out of scope
  since Phase 0 v3, no tracked item created.
- **ADR 0001 is not resolved.** Mobile and voice still classify alerts independently.
- **The fire-time safety net is not built.** Wael deferred it (option 3, 2026-08-26) pending
  prevention being proven. **Prevention is now proven at Site B** — that decision can be revisited on
  his word, and no item has been created for it.

---

## 6. Trail

| Phase | Document |
|---|---|
| 0 (v3) | `B9X_PHASE0_INTENT_APPROVAL_V3_2026-08-26.md` |
| 1 (v2) | `B9X_PHASE1_PROBLEM_DEFINITION_V2_2026-08-26.md` |
| 1A (v2) | `B9X_PHASE1A_ARCHITECTURE_COMPLETENESS_V2_2026-08-26.md` |
| 2 (v3) | `B9X_PHASE2_CHANGE_PLAN_V3_2026-08-27.md` |
| 3 (v2) | `B9X_PHASE3_TECHNICAL_REVIEW_V2_2026-08-27.md` — **verdict outstanding** |
| 4 | `d8fc080` |
| 5 | `B9X_PHASE5_EVIDENCE_2026-08-27.md` |
| 6 | `B9X_PHASE6_TECHNICAL_REVIEW_2026-08-27.md` |
| 7 | `B9X_PHASE7_TESTING_2026-08-27.md` |
| 8 | this document |

Superseded versions retained with headers, not deleted — Phase 0 is the contract, and a contract that
was wrong should show that it was.

---

## 7. Holding-list row

B9x's row has been corrected once already this item (wrong function, and the false *"not yet observed
at actual fire time"*). **On closure it needs moving to Closed Bugs with the reason and date.
Not done — that is a state change on Wael's tracking system and waits for his word to close.**
