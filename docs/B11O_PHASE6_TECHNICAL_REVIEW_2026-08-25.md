# B11o — Phase 6: Technical Review (After Coding)

**Work item:** [[B11o]] — Voice `DELETE_EVENT` sends no `user_id`
**Date:** 2026-08-25
**Reviewer:** ChatGPT (External Technical Reviewer, Governance §1)
**Status:** **SUBMITTED FOR REVIEW.** Code written, **not committed, not deployed.**

---

## Reviewer instructions

**Response format (Governance §1, v4.1):** verdict first, then only mandatory changes, blockers, or material risks. Do not restate this document.

**Four independent verdicts required** (Governance §3, Phase 6). Numeric scores are not used.

1. Technical Review: PASS / FAIL
2. Architecture Completeness: PASS / FAIL
3. Governance Compliance: PASS / FAIL
4. Overall Recommendation: Approved / Approved with Mandatory Changes / Rejected

**Evaluate in §13's gate order:** Scope → Governance → Architecture → Technical Correctness → Evidence Sufficiency.

**Three items are put in front of you deliberately rather than left to be found:** §4 (a deviation from the reviewed snippet), §5 (an invalidated planning assumption), and §7 (a governance process gap in this work item's own paper trail).

---

## 1. What shipped, against what was authorized

**Authorized (Phase 3 §10):** exactly two files — the `DELETE_EVENT` case in `naavi-voice-server/src/index.js` on branch `staging`, and a new test file.

**Actual:**

```
 M src/index.js                      (+19 / −1)
?? test/deleteEventUserId.test.js    (new, 118 lines)
```

**Nothing else.** `outcome_report.js`, `delete-calendar-event/index.ts`, the other ten cases in `executeAction`, `DELETE_MEMORY`, branch `main`, and every mobile file are untouched.

---

## 2. The diff

```diff
       case 'DELETE_EVENT': {
+        // B11o (2026-08-24) — this case was the only one of the eleven that
+        // never resolved a caller. Without user_id, delete-calendar-event takes
+        // its JWT branch, which has no user filter because it expects RLS to
+        // narrow user_tokens; a service-role key does not narrow, so .single()
+        // ran against every google token row and failed on all of them.
+        // Deleting a calendar event by phone had never worked on any branch.
+        const uid = userIdOverride || await getUserId();
+        if (!uid) return { error: 'No user ID' };
         const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-calendar-event`, {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
             'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
           },
-          body: JSON.stringify({ query: action.query }),
+          body: JSON.stringify({ query: action.query, user_id: uid }),
         });
         const data = await res.json();
+        // B11o — a no-match delete returns { success:true, deleted:0 }. Accurate
+        // at the API layer, but outcome_report reads `success` alone, classifies
+        // it 'success', and leaves Claude's "I've deleted it" standing. Nothing
+        // was deleted, so this call site — the only place that knows `deleted`
+        // is meaningful — reports it as a failure. Keep this guard: removing it
+        // reinstates a false success silently.
+        if (data?.success && (data.deleted ?? 0) === 0) {
+          console.log(`[Action] DELETE_EVENT result: no matching events (deleted=0)`);
+          return { success: false, error: 'No matching events found', deleted: 0 };
+        }
         console.log(`[Action] DELETE_EVENT result:`, data.success ? 'OK' : data.error);
         return data;
       }
```

**Isolation, verified from hunk headers rather than by reading narratively:** three hunks at `+4626,8`, `+4640`, `+4643,10`. The case spans `:4625-4655`. **Every changed line is inside it.** The single deletion is the defect itself.

`node --check src/index.js` passes — stated because a syntax error here fails at Railway container boot, not at edit time.

---

## 3. Architecture impact

| Question (Governance §3, Phase 6) | Answer |
|---|---|
| Increased duplication? | **No** |
| Reduced duplication? | **No** |
| Bypassed Shared Core? | **No** — it now *uses* Shared Core's admin branch correctly, where before it misused the JWT branch |
| Introduced another independent implementation? | **No** |
| Violated entry-point responsibilities? | **No — the reverse.** The entry point was failing to translate (holding the caller's identity and not passing it). It now translates correctly, which moves it toward Reference §3's stated ideal |
| Changed an API contract? | **No.** `body.user_id` is an already-defined, already-used optional field (`delete-calendar-event/index.ts:46`). A caller began populating it. No consumer sees a new shape |
| Changed a capability's ownership? | **No.** §4's Ownership Change Rule is not triggered |
| Expanded Protected Core? | **No** |

### Architecture Drift Rule — **Outcome 1: Matches**

The Architecture Reference remains accurate. Verified, not assumed:

- **Version is still `2026.07.18.11`**, last committed at `f06cf1c` (B11x revision 11). `git status` shows the file unmodified. **The version recorded at Phase 1A has not been superseded**, satisfying Phase 8's Version Verification precondition in advance.
- §2's *"Calendar — writes … Shared Core, genuinely shared"* was true before this change and is true after. The change is caller-side.
- **No Reference update is required by this work item**, because no architectural change was made. This is Outcome 1, not the Outcome 2 case where a Reference update becomes a hard merge precondition.

---

## 4. ⭐ Deviation from the reviewed snippet — disclosed

**Phase 3 §4b's snippet did not contain the `console.log` at `:4650`. The implementation added it.**

**Why:** the no-match guard returns *before* the existing log line at `:4653`. Without the added line, that path emits **no log entry at all** — the silent-failure shape AI Coding Discipline Rule 21 forbids, on the one path whose entire purpose is making a silent failure visible.

**Assessment offered, not asserted:** inside the authorized case, one line, no behavioural effect, and it can be removed without touching the fix. **Whether it falls inside "only the listed mandatory changes may be performed" is the reviewer's call, not the implementer's** — which is why it is here rather than in a footnote.

---

## 5. ⭐ Invalidated Planning Assumption (Governance §3, Phase 6)

Recorded per the rule, because collapsing this into "an extra line was added" loses the signal.

- **Phase 2 assumed:** the existing `console.log` at the bottom of the case would continue to report every outcome, so the no-match guard needed only a `return`.
- **Phase 4 found:** an early `return` bypasses that line entirely. The no-match path would have been the only outcome in the case producing no log.
- **Why the assumption did not hold:** the plan was written as a diff fragment rather than against the case's control flow. The guard's *position* — necessarily before the log, since it must intercept `data` — was the detail the fragment did not surface.

**This is a planning gap, not an implementation error and not a scope cut.** The distinction matters because it points at a specific improvement for future Phase 2 documents: when a plan inserts an early return, state explicitly what that return skips.

---

## 6. Regression risk and test coverage

### 6.1 Consumer trace — unchanged from Phase 3, re-confirmed

| Consumer | Auth path | Affected? |
|---|---|---|
| `lib/calendar.ts:538` (mobile) | user JWT → JWT branch | No — not modified |
| `naavi-chat/intentHandlers.ts:1124` | service key + `user_id` → admin branch | No — not modified |
| `src/index.js:4634` (voice) | service key + `user_id` → **admin branch** | **This change** |
| `tests/lib/adapters.ts:203` (auto-tester teardown) | service key + `user_id` → admin branch | No — not modified |

**The branch voice moved onto is exercised daily.** Rows 2 and 4 already send this exact shape; row 4 runs on every `npm run test:auto` as calendar teardown.

### 6.2 Tests — and the reason to believe them

`npm test`: **162 pass, 0 fail** (158 before this item).

**Verified in both directions.** The four new assertions were run against the pre-fix source (`git show HEAD:src/index.js`):

```
  FAIL  resolves the caller
  FAIL  sends user_id
  FAIL  no identity-less body
  FAIL  guards deleted:0
```

All four fail on the old code, all four pass on the new — so the test catches both the original defect and the false-success defect the fix could have introduced.

### 6.3 What the tests do not cover, stated plainly

They are **source-assertion** tests. `src/index.js` has no `module.exports` and cannot be imported without booting a server, so no behavioural unit test of this case is possible without extracting it into a module — rejected at Phase 2 as a refactor of a Protected Core file for test convenience.

**They prove the two lines are present. They do not prove a delete succeeds end to end.** Only the live tests in §8 do, and **none has been run**, because nothing is deployed.

**Known brittleness:** the assertions match exact source text, so a reformat would fail them without any behavioural regression. Accepted deliberately — the failure mode is a loud false alarm, not a silent miss.

---

## 7. ⭐ Governance compliance — including a gap in this item's own paper trail

**Disclosed for the Governance Compliance verdict rather than left for the reviewer to notice.**

**No Phase 4 document was written until Wael asked for it.** The session implemented the code and went straight to the Phase 5 Evidence Package. He asked *"where is Phase 4"* — **the identical question he asked during B10m on 2026-07-19**, which produced the standing rule that every phase gets its own document.

**The rule had decayed, not been unknown.** Checked directly: `docs/` contains `B10G_PHASE4A_…` and `B10M_PHASE4_…`, then nothing — **and [[B11x]], shipped through all eight phases the previous day, has no Phase 4 document either.** Its set jumps 3 → 5.

**Remedied as the rule prescribes:** written immediately on being caught, with the gap noted openly rather than backfilled silently, and with a fresh re-read of the code from disk rather than a restatement of the implementation turn's own account — which is what produced the `node --check` result and the hunk-header containment proof in §2.

**The documents are also out of order:** Phase 5 was written at 3:14 AM EST, Phase 4 at 3:17.

**Offered for the reviewer's judgement, and I do not claim the answer:** whether a phase artifact produced only after prompting satisfies Governance Compliance, or whether the correct verdict is FAIL on that dimension with the work otherwise Approved.

**One observation for §9 of governance:** nothing mechanically forces the Phase 4 document to exist. This is the same failure shape CLAUDE.md names about architecture documents — *a document stays current only if something mechanically forces it to* — now demonstrated twice inside the governance framework's own artifacts.

### Other governance dimensions

| | |
|---|---|
| Scope (Gate 1) | Inside Phase 0's contract. Voice staging only. `DELETE_MEMORY` excluded as ruled, twice |
| Phase-gate approvals | Wael's own separate word obtained at 0→1, 1→1A, 1A→2, 2→3, 3→4. No reviewer verdict was treated as authorization |
| Rule 17 (validate before fixing) | Satisfied — live reproduction run by Wael before any code was written, returning the predicted string verbatim |
| Rule 15a (test before moving on) | Satisfied by a real test, not an exception. B11k took an exception for the same structural reason; this item did not need one |
| Non-Determinism Rule | Not applicable — no prompt or classifier change. Asserted explicitly, per §15 |
| No Extra Changes Rule | Four nearby improvements found and **reported, not implemented** (Phase 5 §8) |

---

## 8. Not yet done — and this review does not authorize it

| | |
|---|---|
| Commit | **No** — HEAD is still `3bf15c3` |
| Push / Railway deploy | **No** |
| Live test 1 — positive control | **Not run** |
| Live test 2 — **no-match negative control** | **Not run** |
| Live test 3 — cross-user negative control | **Not run** |

**A call to +1 343 504 1572 right now still reproduces B11o.** All three live tests are Phase 7 and are blocked until deployment is confirmed from the running container's logs — not from the push succeeding (Architecture Reference §0d).

**Test 2 is the one this review's mandatory change exists for**, and the one most likely to be skipped because a correct result looks like nothing happening.

---

## 9. What a positive verdict authorizes

Phase 6 → Phase 7 (testing), **subject to Wael's own separate go-ahead.** A reviewer's "Approved" is never itself authorization to proceed (Governance §3, Phase-Gate Approval Rule).
