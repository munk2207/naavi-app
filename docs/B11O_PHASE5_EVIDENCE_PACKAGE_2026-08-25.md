# B11o — Phase 5: Evidence Package

**Work item:** [[B11o]] — Voice `DELETE_EVENT` sends no `user_id`
**Date:** 2026-08-25 (Phases 0–4 ran in the 2026-08-24 session, which continued past midnight EST — the earlier phase documents are dated `_2026-08-24` and are the same continuous work item)
**Scope:** **STRICTLY VOICE STAGING** — branch `staging`
**Status:** **Implementation complete. NOT committed. NOT deployed.**

---

## 1. Summary

The `DELETE_EVENT` case in the voice server's action executor now resolves the caller and sends their `user_id`, and classifies a no-match delete as a failure so Naavi cannot claim a deletion that did not happen.

**Two behaviours changed, both inside one `switch` case:**

1. **Identity** (the original defect) — the caller's `user_id` is now sent, so `delete-calendar-event` takes its admin branch and knows whose calendar to act on.
2. **Truthful no-match reporting** (Phase 3's mandatory change) — `{ success: true, deleted: 0 }` is now returned as a failure, so `outcome_report` overrides Claude's speech instead of letting *"I've deleted it"* stand.

**Nothing else in the file, the repo, or any other repo was touched.**

---

## 2. Files changed

| File | Status | Lines |
|---|---|---|
| `naavi-voice-server/src/index.js` | Modified | +19 / −1 |
| `naavi-voice-server/test/deleteEventUserId.test.js` | **New** | 118 |

Both were authorized by Phase 3 §10. **No third file was created or modified** — `outcome_report.js`, `delete-calendar-event/index.ts`, branch `main`, and every mobile file are untouched, as required.

`git status` confirms exactly this and nothing more:

```
 M src/index.js
?? test/deleteEventUserId.test.js
```

---

## 3. Git diff

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

### ⚠️ One deviation from the reviewed snippet, disclosed rather than buried

**Phase 3 §4b's snippet did not include a `console.log` inside the no-match branch. The implementation adds one.**

**Why:** the guard returns *before* the existing log line at the bottom of the case, so without it the no-match path would produce **no log entry at all** — the exact silent-failure shape AI Coding Discipline Rule 21 forbids, on a path whose whole purpose is making a silent failure visible.

**Assessment:** inside the authorized case, no behavioural effect, one log line. Reported here per Phase 4's No Extra Changes Rule rather than presented as if it were in the reviewed plan. **If the reviewer considers it out of bounds, it can be removed without affecting the fix.**

---

## 4. Tests executed

### 4.1 Voice repo suite — `npm test`

```
ℹ tests 162
ℹ pass 162
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

**162 of 162 pass, 0 fail.** The suite stood at 158 before this work item; the four additions are B11o's.

```
✔ DELETE_EVENT resolves the caller before deleting (6.4264ms)
✔ DELETE_EVENT sends user_id in the request body (6.4749ms)
✔ DELETE_EVENT never reverts to the identity-less body that caused B11o (6.6722ms)
✔ DELETE_EVENT reports a no-match delete as a failure, not a success (5.7643ms)
```

### 4.2 ⭐ The tests were verified in both directions

**A passing test proves nothing unless it would have failed before the fix.** The same four assertions were run against the pre-fix source (`git show HEAD:src/index.js`), read-only:

```
  FAIL  resolves the caller
  FAIL  sends user_id
  FAIL  no identity-less body
  FAIL  guards deleted:0
```

**All four fail on the old source; all four pass on the new.** The test has teeth against both the original defect and the one the fix could have introduced.

This is the standard the drift check was held to when it landed (CLAUDE.md — *"verified in both directions on the day it landed"*), applied here for the same reason.

### 4.3 What these tests do NOT prove

They assert on source text, because `src/index.js` has no `module.exports` and cannot be imported without booting a server (Phase 2 §6). **They prove the two lines are present and would fail loudly if removed. They do not prove a delete succeeds end to end.** That is what §5 is for.

---

## 5. Manual tests required — NOT YET RUN

**All three are Wael's to make. None can be automated from this harness.**

Call voice staging: **+1 343 504 1572**

| # | Test | Pass condition |
|---|---|---|
| 1 | **Positive control.** Ask Naavi to delete a real event on the calling account. Confirm. | The event is **gone** from the caller's own Google Calendar. Log shows a success, not `No Google token found`. |
| 2 | **Negative control — no-match.** Ask her to delete an event that does not exist. | She says she was **not** able to delete it. **A "deleted" claim here fails the work item.** Log shows `no matching events (deleted=0)`. |
| 3 | **Negative control — cross-user.** Confirm only the calling user's calendar was affected. | No other account's events changed. Evidence, not assertion. |

**Test 2 is the one the Phase 3 mandatory change exists for**, and the one most likely to be skipped because it looks like a non-event.

**Blocked until deployed.** The code is not committed and not pushed, so a call placed right now still exercises the old behaviour.

---

## 6. Rollback instructions

**Nothing is committed, so rollback is currently local and total:**

```bash
cd naavi-voice-server && git checkout -- src/index.js && rm test/deleteEventUserId.test.js
```

**After a commit and push to `staging`:**

```bash
cd naavi-voice-server && git revert <sha> && git push origin staging
```

Railway redeploys `naavi-voice-staging` from the branch automatically. **Confirm the rollback from the running container's logs** — `railway logs --service naavi-voice-staging` — never from the push succeeding (Architecture Reference §0d).

**Blast radius of a rollback is one action on one branch.** No schema change, no migration, no Edge Function deploy, nothing to unwind on the Supabase side.

---

## 7. Known risks

1. **The `?? 0` coalesce.** `(data.deleted ?? 0) === 0` treats a missing `deleted` field as zero, i.e. as a failure. `delete-calendar-event:229` always includes `deleted`, so this is defensive rather than load-bearing — but if a future change made the field optional in a *success* response, this would misreport it. **Flagged to the Phase 3 reviewer as the line I was least certain of; it drew no mandatory change.**

2. **Source-assertion tests are brittle to reformatting.** All four assertions match on exact source text. A prettier run or a reformat of this case would fail them without any behavioural regression. **Accepted deliberately** — the alternative was no test at all, or refactoring a Protected Core file for test convenience, which Phase 2 rejected. The failure mode is a loud false alarm, not a silent miss.

3. **The identity is only as good as the caller resolution.** `userIdOverride` comes from `getUserIdByPhone(callerPhone)` at `:6650`. This fix trusts that resolution exactly as the other ten actions already do. It does not introduce that trust and does not widen it.

4. **Deploying to `staging` also redeploys demo staging** (`generous-tenderness-production-9235`, same branch — Architecture Reference §0b). **Demo behaviour does not change** — action execution is unreachable there — but the redeploy is real and is recorded rather than omitted.

5. **Production is untouched and still broken.** Voice production carries the identical defect. That is Phase 0's deliberate scope, not an oversight, and it needs Wael's separate "deploy to production" as its own decision.

---

## 8. Improvement ideas found nearby — reported, NOT implemented

Per Phase 4's No Extra Changes Rule, and per Wael's standing instruction that findings go to the general list rather than into the work.

1. **`DELETE_MEMORY` reports success when it deletes nothing** — `src/index.js:4671`, `return { success: res.ok, deleted: count }`. Same lie-shape this work item just fixed for `DELETE_EVENT`. **Ruled out of B11o twice** — by Wael at Phase 0 and by the Phase 3 reviewer. **General list.**

2. **`/voice/demo/connect` is dead code** — defined at `:8580`, referenced by no TwiML. The comments at `:6640` and `:6750` still describe the old flow that routed to it. Rule 20 (remove dead code). **General list.**

3. **Audit the remaining ~55 Edge Function call sites in the voice server for omitted user identity.** [[B11j]] and B11o are two instances of one shape. Two is short of the four the Architecture Reference's §5 Audit Trigger requires. **General list**, per Phase 1A §5.

4. **A better no-match sentence.** *"Please try again"* invites an identical retry that will fail identically. *"I couldn't find an event matching that"* would tell the caller to rephrase — but needs a new outcome class in `outcome_report.js`. **Wael was offered this and chose the two-file version.** Recorded as a declined refinement, not an open defect.

**None of these were implemented. No file outside the two authorized was touched.**

---

## 9. What is still outstanding

| | |
|---|---|
| Commit | **Not done** — needs Wael's approval |
| Push to `staging` / Railway deploy | **Not done** |
| Live tests 1–3 (§5) | **Not run** — blocked until deployed |
| Phase 6 external review of this diff | Not started |
| Phase 7, Phase 8 | Not started |

**Phase 5 → Phase 6 requires Wael's own separate word** (Governance §3, Phase-Gate Approval Rule).
