# B11o — Phase 3: Technical Review (Before Coding)

**Work item:** [[B11o]] — Voice `DELETE_EVENT` sends no `user_id`
**Date:** 2026-08-24
**Reviewer:** ChatGPT (External Technical Reviewer, Governance §1)
**Status:** **RESUBMITTED — round 2, 2026-08-24.** No code written. No file modified.

---

## Round 1 outcome and what changed

**Round 1 verdict (ChatGPT, 2026-08-24): Approved with Mandatory Change.**

> *"The `deleted: 0` issue belongs in B11o because Phase 0 explicitly requires the spoken result to match reality… Do not ship B11o as currently planned… This requires returning to Phase 2 and amending the change plan/boundary to handle `DELETE_EVENT` `deleted: 0` truthfully. It does not bring `DELETE_MEMORY` into scope."*

**Accepted in full. Phase 2 was amended (§2b of `B11O_PHASE2_CHANGE_PLAN_2026-08-24.md`) and re-approved by Wael.**

**The delta, and it is the only delta:** the `DELETE_EVENT` case now classifies a no-match result as a failure, so Naavi cannot speak a deletion that did not happen. `DELETE_MEMORY` remains out of scope, untouched. **The authorized boundary is unchanged at two files** — see §4b for why the fix did not need a third.

**What this round is being asked to review:** §4b (the new code), §6's coupling implications, and whether the boundary in §10 is still correct. §§1–3, 5, 7 are unchanged from round 1 and need no re-reading.

---

## Reviewer instructions

**Governance §1, Reviewer Response Format Rule (v4.1):** state the verdict first, then only mandatory changes, blockers, or material risks. Do not restate this document or repeat evidence already given. Extended explanation only where needed to justify a rejection or a required change.

**Decide per §13's five gates, in order:** Scope Compliance → Governance Compliance → Architecture Compliance → Technical Correctness → Evidence Sufficiency.

**Permitted decisions:** Approved / Approved with Mandatory Changes / Rejected.

**Round 2 focus:** §4b is the new material. §9 — the question round 1 answered — is retained as a record of how the mandatory change arose, not as an open question.

---

## 1. What is being reviewed

A two-line change to one `switch` case in the voice server, plus one new test file. Full plan: `docs/B11O_PHASE2_CHANGE_PLAN_2026-08-24.md`.

**Scope, ruled by Wael and not open for reinterpretation: STRICTLY VOICE STAGING.** Branch `staging`, one production file. Mobile, demo, voice production, and both Supabase projects are excluded.

---

## 2. The defect, compressed

Voice asks the backend to delete a calendar event without saying whose calendar.

`naavi-voice-server/src/index.js:4625-4637`:

```js
case 'DELETE_EVENT': {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-calendar-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ query: action.query }),   // ← no user_id
  });
```

`delete-calendar-event/index.ts:60-84` branches on `body.user_id`. Absent, it takes the JWT branch — which has **no user filter**, because it expects RLS to narrow `user_tokens` via a real user JWT. It receives a service-role key instead, which RLS does not narrow, so `.single()` runs against every Google token row.

**Measured 2026-08-24:** 4 such rows on staging, 5 on production. `.single()` needs exactly one. Result: `HTTP 400 {"error":"No Google token found"}`, always.

**`DELETE_EVENT` is the only one of 11 cases in `executeAction` that never resolves a user.** All ten siblings open with `const uid = userIdOverride || await getUserId();`. The identity is already a parameter of the enclosing function and is simply not read.

---

## 3. Live reproduction — run by Wael, 2026-08-24

Not inferred. He created a meeting, called voice staging, asked Naavi to delete it, said yes.

```
[Claude DIAG] tool_use name=delete_event jsonStr: {"query": "David meeting"}
[Claude DIAG] converted actions: 1 (DELETE_EVENT)
[Action] Executing: DELETE_EVENT
[Action] DELETE_EVENT result: No Google token found
[Process] action DELETE_EVENT → failure
```

This also **excluded the live alternative hypothesis** — that Claude was refusing at the prompt level and never emitting the tool. `toolUseBlocks=1` rules it out.

---

## 4. The proposed change

**Proposed only. Not applied to any file.**

```js
case 'DELETE_EVENT': {
  const uid = userIdOverride || await getUserId();
  if (!uid) return { error: 'No user ID' };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-calendar-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ query: action.query, user_id: uid }),
  });
  const data = await res.json();
  console.log(`[Action] DELETE_EVENT result:`, data.success ? 'OK' : data.error);
  return data;
}
```

Two additions, nothing removed. The idiom is copied verbatim from the ten sibling cases; the guard is copied from `DELETE_MEMORY:4656`, the file's other destructive action.

**The guard is functionally required, not stylistic.** Without it a null `uid` yields `user_id: null`, `bodyUserId` is falsy, the Edge Function takes the same broken branch, and B11o reproduces silently.

---

## 4b. ⭐ The mandatory change, as implemented in the plan — NEW IN ROUND 2

**Proposed only. Not applied to any file.** This replaces the plain `const data = await res.json();` line in §4.

```js
const data = await res.json();
// A no-match delete returns { success:true, deleted:0 } — accurate at the API
// layer, but outcome_report reads `success` alone, classifies it 'success', and
// leaves Claude's "I've deleted it" standing. Nothing was deleted, so this call
// site — the only place that knows `deleted` is meaningful — reports a failure.
if (data?.success && (data.deleted ?? 0) === 0) {
  return { success: false, error: 'No matching events found', deleted: 0 };
}
```

**Resulting speech:** *"I wasn't able to delete that event. Please try again."* — produced by `outcome_report.js:127` from the existing `failure` class. **True: nothing was deleted, and she does not claim otherwise.**

### Why this did not require a third file

`outcome_report.js` was the obvious candidate and was **deliberately not used.** It is intentionally ignorant of every Edge Function's response shape — it consumes `{ success, error }` and nothing else, and derives speech from `actionType` + outcome class alone (verified: it has no per-action message hook).

**This change is result *classification*, not speech.** The `DELETE_EVENT` case is the only place in the system that knows `deleted` is a meaningful field on this particular response. Teaching a module shared by twelve action types about one caller's payload would widen its blast radius for one caller's benefit, and would invert the separation B11k built it with.

**So the fix reaches the shared module through its existing contract, and the boundary stays at two files.** `outcome_report.js` is **not** authorized and is not modified.

### Accepted limitation — Wael's ruling, not an oversight

*"Please try again"* invites an identical retry that will fail identically. *"I couldn't find an event matching that"* would be more useful, and requires a new outcome class in `outcome_report.js`.

**Wael was offered both and chose the two-file version (2026-08-24).** The wording is accepted for this work item. **This is a refinement deliberately declined, not a loose end** — raising it as a mandatory change would be re-litigating a Product Owner decision, which §10's Approval Philosophy reserves to him.

### What round 2 should scrutinise here

1. **Is `data?.success && (data.deleted ?? 0) === 0` the correct condition?** It deliberately does not fire when `success` is false — those already classify as failure. `?? 0` treats a missing `deleted` as zero; the alternative reading is that a missing field means "unknown" and should be `unconfirmed`. **I judged the response shape at `index.ts:229` always carries `deleted`, so the coalesce is defensive rather than load-bearing — but this is the line I am least certain of.**
2. **Does returning a synthetic `success: false` mislead anything downstream?** The returned object goes only to `outcome_report.classifyResult`, and the batch does not persist or forward it. §6's trace found no other consumer.
3. **Is discarding `message: 'No matching events found'` acceptable?** It is replaced with the same string as `error`, so nothing is lost in the log line at `:4635`.

---

## 5. Architecture position

- **Capability:** Calendar writes. **Shared Core**, "genuinely shared" (Architecture Reference 2026.07.18.11, §2). **Not duplicated** — no second implementation needs a matching change.
- **Defect location:** the **Voice entry point**, not the owning component. Reference §3: entry points translate rather than implement. This is a translation failure.
- **Shared Core is not modified.** Its existing admin branch is *used*, not changed.
- **No ownership change** (§4 Ownership Change Rule not triggered). **No new duplication. No architecture bypass.**
- **Protected Core:** yes, twice — Voice orchestration and Calendar integration.
- **No drift.** Phase 1A tested the Reference's claims against source and found them accurate; no Reference update is required by this item.

**Alternatives rejected**, with reasons, in Phase 1 §5: changing the Edge Function to tolerate a missing user (no correct answer to "which user"; breaks two working callers); sending a user JWT (voice has none — it identifies by caller phone); `.single()` → `.maybeSingle()` (masks the failure, still identifies nobody).

---

## 6. Isolation and hidden coupling

**Consumer trace of `delete-calendar-event`**, produced by search:

| Consumer | Auth path | Effect |
|---|---|---|
| `lib/calendar.ts:538` (mobile) | user JWT → JWT branch | none — not modified |
| `naavi-chat/intentHandlers.ts:1124` | service key + `user_id` → **admin branch** | none — not modified |
| `src/index.js:4626` (voice) | service key, no user → JWT branch (**broken**) | **this change** — moves to admin branch |
| `tests/lib/adapters.ts:203` (auto-tester teardown) | service key + `user_id` → **admin branch** | none — not modified |

**The target branch is not a cold path.** Rows 2 and 4 already send the exact shape this change produces; row 4 runs on every `npm run test:auto` as calendar teardown. Voice is being moved onto the better-exercised of the function's two branches.

**All 8 callers of `executeAction`** (`:3881`, `:10886`, `:10999`, `:11049`, `:12139`, `:12165`, `:12297`, `:13293`) pass a resolved user, so the guard cannot spuriously block a legitimate delete.

**Deploy coupling, recorded rather than omitted:** pushing to `staging` redeploys `naavi-voice-staging` **and** `generous-tenderness-production-9235` (demo staging), which deploys the same branch (Reference §0b). Demo behaviour does not change — action execution is unreachable there — but the redeploy is a fact of this change.

---

## 7. Non-Determinism Rule

**Not applicable.** This is not a prompt or classifier change. No `get-naavi-prompt` edit, no Layer-2 classifier edit, no change to tool definitions. Stated explicitly because §15 lists "single-trial evidence presented as sufficient" as an automatic rejection condition, and I am asserting the rule does not engage rather than silently omitting it.

---

## 8. Test approach (Wael ruled option 1, 2026-08-24)

**`src/index.js` contains no `module.exports`.** It cannot be required without booting a server, and all 12 existing voice-repo tests target separately extracted modules. A behavioural unit test of this case is impossible without extracting code — which Phase 0 forbids as an unapproved refactor of a Protected Core file.

**Selected:** a **source-assertion test** (`naavi-voice-server/test/deleteEventUserId.test.js`) that reads `src/index.js` and asserts the `DELETE_EVENT` case carries `user_id`. Established pattern in this project — `tests/catalogue/session-2026-05-29.ts:233` does the same against a Supabase function's source.

**No Rule 15a exception is being taken.** [[B11k]] took one for the same structural reason; this item does not need to, because a real regression test exists.

**Honest limit:** the test proves the identity is passed and would fail loudly if a future edit dropped it. **It does not prove the delete succeeds end to end.** Only the live call does that, and Phase 2 §9 requires one, plus a negative control that only the calling user's calendar was touched.

---

## 9. ⭐ The question I want challenged — a defect this fix will UNMASK

**Found while preparing this submission. Not previously recorded in any phase document.**

`delete-calendar-event/index.ts:205` returns, when the query matches nothing:

```json
{ "success": true, "deleted": 0, "message": "No matching events found" }
```

`outcome_report.js:97-108` classifies an action's outcome. `success !== false`, no `error`, no `skipped` → **`'success'`** → Claude's original speech is returned **untouched**.

**So once B11o is fixed, a caller asking to delete an event whose title does not match will hear Naavi say she deleted it. Nothing was deleted.**

**Today this is invisible, because B11o masks it** — the call dies at the token lookup and never reaches `:205`. **Fixing B11o exposes it.**

### Why this is not obviously out of scope

Phase 0's **Success Criterion 2**, approved by Wael, reads:

> *"Naavi's spoken reply matches what actually happened — deleted when it deleted, not deleted when it did not."*

`deleted: 0` reported as success **fails that criterion as written.** So the argument that this is new scope is weak; the argument that it was always inside Phase 0's contract and nobody noticed is stronger.

### Why it is not obviously in scope either

- It is the **same lie-shape as `DELETE_MEMORY`**, which Wael explicitly ruled **out** of B11o on 2026-08-24 — *"Keep DELETE_MEMORY out."* Including this while excluding that is inconsistent unless the distinction is principled.
- A fix likely belongs in `outcome_report.js` or the `DELETE_EVENT` case's return handling, i.e. **a third file** beyond the two authorized.
- Wael's standing instruction for this session is explicit: findings go to the general list, work stays on the priority item. *"Finding a defect is not the same as it being worth fixing now."*

### ✅ ANSWERED IN ROUND 1 — retained as the record of how the mandatory change arose

**Verdict:** it belongs in B11o, because Phase 0 Success Criterion 2 requires it. B11o may not ship as originally planned. Handled by amending Phase 2, not by returning to Phase 0 — the scope contract already covered it. `DELETE_MEMORY` stays out.

**Applied in §4b.** No longer an open question.

**Worth keeping for the record:** this defect was found while *writing the submission*, not by either the diagnosis or the plan — and it was the one thing capable of making a correct fix ship a new lie. The pattern matches this project's recent history: the genuine defects surface from doing the next concrete step, not from reviewing the previous one.

---

## 10. Implementation Boundaries — to be confirmed or amended by this review

Per Governance §3, Phase 3 must close with an explicit authorization boundary.

**Authorized files — exactly two. Unchanged by the mandatory change.**

1. `naavi-voice-server/src/index.js`, branch `staging` — the `DELETE_EVENT` case at `:4625-4637`, and nothing else in the file. **Two behaviours change within that case: the caller's identity is sent (§4), and a no-match result is classified a failure (§4b).**
2. `naavi-voice-server/test/deleteEventUserId.test.js` — new. **Must assert both**: that `user_id` is passed, and that the `deleted: 0` guard is present. The second matters because that guard is exactly the line someone removes while tidying a return statement, and losing it reinstates the false success silently.

**Explicitly NOT authorized:** any other file in any repo · `delete-calendar-event/index.ts` · **`outcome_report.js`** (see §4b — deliberately excluded, not overlooked) · any other case in `executeAction` · `DELETE_MEMORY` · branch `main` · any mobile file · the mobile repo's `tests/catalogue/` or `tests/runner.ts` · any migration, cron, config, or dependency.

**No opportunistic refactoring. No architectural change. No deploy authorized by this review.**

---

## 11. Deferred Architectural Decisions

Per Governance §3, recorded separately so a future session recognises them as already considered.

1. **Extracting `executeAction`'s cases into testable modules.** Would make behavioural unit tests possible and is what [[B11k]] did for outcome reporting. **Not approved here** — a refactor of a Protected Core file justified only by test convenience. Reconsider if a third work item hits the same untestability wall.

2. **Auditing all ~55 Edge Function call sites in the voice server for omitted user identity.** [[B11j]] (`ADD_CONTACT`, fixed 2026-08-21) and B11o are two instances of one shape. **Not approved here** — two is short of the four the Reference's §5 Audit Trigger requires. Phase 1A §5 recommends a general-list row. Reconsider at a third instance.

3. **`DELETE_MEMORY`'s false success** (`src/index.js:4671`, `success: res.ok`). Ruled out of B11o by Wael. **Not approved here.** Related to §9 and should be decided together with it if §9 is taken up.

---

## 12. What a positive verdict authorizes

Phase 3 → Phase 4 (implementation), **subject to Wael's own separate go-ahead** — a reviewer's "Approved" is never itself authorization to proceed (Governance §3, Phase-Gate Approval Rule).
