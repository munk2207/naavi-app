# B11o — Phase 2: Change Plan

**Work item:** [[B11o]] — Voice `DELETE_EVENT` sends no `user_id`
**Date:** 2026-08-24
**Scope:** **STRICTLY VOICE STAGING** — branch `staging`. Ruled by Wael, Phase 0.
**Status:** **AMENDED AND RE-APPROVED by Wael, 2026-08-24.** Phase 2 → Phase 3 resubmission authorized. **No code written.**

**Rulings applied (Wael, 2026-08-24):**
1. **Rule 15a approach = option 1** — source-assertion test in the voice repo (§6).
2. **Phase 0 test-file correction ACCEPTED** — test coverage moves from the mobile repo's `tests/catalogue/` + `tests/runner.ts` to the voice repo's `test/`, run by `npm test` (§1).

**⚠️ MANDATORY CHANGE from Phase 3 review (ChatGPT, 2026-08-24) — verdict: Approved with Mandatory Change.**

> *"The `deleted: 0` issue belongs in B11o because Phase 0 explicitly requires the spoken result to match reality. Do not ship B11o as currently planned. Fixing identity while knowingly allowing a no-match deletion to be spoken as successful would violate that approved success criterion. This requires returning to Phase 2 and amending the change plan/boundary to handle `DELETE_EVENT` `deleted: 0` truthfully. It does not bring `DELETE_MEMORY` into scope."*

**Applied in §2b below.** `DELETE_MEMORY` remains out of scope, unchanged.

---

## 1. Files that will change

| File | Repo | Classification | Change |
|---|---|---|---|
| `naavi-voice-server/src/index.js` | `munk2207/naavi-voice-server`, branch `staging` | **Shared Logic** (voice entry point / action executor) | The `DELETE_EVENT` case at `:4625-4637` — resolve the caller and send the identity |
| `naavi-voice-server/test/deleteEventUserId.test.js` | same | **Test** (new file) | Rule 15a coverage — see §6 |

**No other file in any repo.** No Edge Function, no migration, no config, no dependency, no mobile file.

**⚠️ Phase 0 named the wrong test files — corrected, and ACCEPTED by Wael 2026-08-24.** Phase 0's In Scope authorized *"one new or extended file under `tests/catalogue/`"* and *"`tests/runner.ts`"* — those are the **mobile repo's** test harness. The code being changed lives in the **voice repo**, which has its own suite (`npm test` → `node --test test/*.test.js`, 12 existing files). Phase 0 pointed at the wrong repo.

**The corrected Phase 0 contract:** test coverage for B11o is `naavi-voice-server/test/deleteEventUserId.test.js`. **The mobile repo's `tests/catalogue/` and `tests/runner.ts` are now OUT of scope and must not be touched.** Not a scope expansion — still one production file plus test coverage — but Governance §0.2 does not permit silently reinterpreting In Scope, which is why it was raised rather than absorbed.

---

## 2. The modification, explained

**Current** — `src/index.js:4625-4637`:

```js
case 'DELETE_EVENT': {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-calendar-event`, {
    ...
    body: JSON.stringify({ query: action.query }),
  });
```

**Planned change — two additions, nothing removed:**

1. **Resolve the caller**, using the exact idiom every sibling case already uses:
   `const uid = userIdOverride || await getUserId();`
2. **Guard, then send the identity** — refuse to proceed with no user, and include `user_id: uid` in the body.

**Why the guard, and why it is not scope creep.** Without it, a null `uid` produces `{ query, user_id: null }`; `bodyUserId` is falsy, the Edge Function takes the same `else` branch, and B11o reproduces silently. The guard is **functionally required** for the fix to be a fix. It also matches the file's own precedent for the other destructive action — `DELETE_MEMORY:4656` does exactly this (`if (!uid) return { error: 'No user ID' }`), and Rule 21 forbids silent failures on a path that deletes real user data.

**Why the request shape is right.** `delete-calendar-event:60` branches on `body.user_id` into an admin path that filters `.eq('user_id', bodyUserId)`. That is the branch built for exactly this caller. No Edge Function change is needed or permitted.

**Explicitly NOT in this change:** no refactoring of neighbouring cases, no extraction of a helper, no touching the other ten actions, no `DELETE_MEMORY` (ruled out, Phase 0 — and reaffirmed by the Phase 3 review), no change to gating or confirm flow.

---

## 2b. MANDATORY CHANGE — truthful reporting of a no-match delete

**Required by the Phase 3 review. Without it, this work item is not shippable.**

### The problem the identity fix would create

`delete-calendar-event/index.ts:205`, when the query matches no event:

```json
{ "success": true, "deleted": 0, "message": "No matching events found" }
```

`outcome_report.js:97-108` classifies that as **`'success'`** — `success !== false`, no `error`, no `skipped`. On success the module returns `''` and **Claude's original speech survives untouched**, which for this turn is *"I'll delete the David meeting now."*

**Nothing was deleted and Naavi says she deleted it.** That fails Phase 0's Success Criterion 2 — *"deleted when it deleted, not deleted when it did not."*

**It is invisible today only because B11o masks it.** The call dies at the token lookup and never reaches `:205`. **The identity fix removes the mask.** Shipping §2 alone would convert a loud, honest failure into a silent false success.

### The fix — classify the result at the call site

```js
const data = await res.json();
// A no-match delete returns { success:true, deleted:0 } — accurate at the API
// layer, but outcome_report reads `success` alone, classifies it 'success',
// and leaves Claude's "I've deleted it" standing. Nothing was deleted, so this
// call site — which is the only place that knows `deleted` is meaningful —
// reports it as a failure.
if (data?.success && (data.deleted ?? 0) === 0) {
  return { success: false, error: 'No matching events found', deleted: 0 };
}
```

**Resulting speech:** *"I wasn't able to delete that event. Please try again."* — via `outcome_report.js:127`. **True.** Nothing was deleted, and she does not claim otherwise.

### Why this belongs at the call site and not in `outcome_report.js`

**This is result *classification*, not speech.** `outcome_report.js` is deliberately ignorant of any Edge Function's response shape — it consumes `{ success, error }` and nothing else. Teaching it that `deleted` is meaningful for `DELETE_EVENT` would push per-function knowledge into a module shared by twelve action types, widening its blast radius for one caller's benefit.

The `DELETE_EVENT` case is the **only** place that knows what `deleted: 0` means. Classifying it there is both the minimal change and the architecturally correct one — and it keeps the authorized boundary at two files.

### Known limitation, stated rather than discovered later

The speech is *"Please try again"*, which invites an identical retry that will fail identically. **Truthful but not maximally useful** — *"I couldn't find an event matching that"* would tell the caller to rephrase.

Better wording requires a distinct outcome class or a per-action no-match phrase in `outcome_report.js` — **a third file**, and a change to a module all twelve action types share.

**Decision for Wael** (user-facing wording is his call, not the reviewer's and not mine):

**⭐ Wael's ruling, 2026-08-24: OPTION 1.**

1. **Ship the two-file version; speech is *"I wasn't able to delete that event. Please try again."*** — **SELECTED.** Satisfies Success Criterion 2 fully, keeps the boundary at two files, and puts the logic where it architecturally belongs.
2. ~~Add a no-match outcome class to `outcome_report.js`~~ — not taken. Three files, wider blast radius, would need its own Phase 3 pass.
3. ~~Ship #1 now and record #2 on the general list~~ — not selected.

**`outcome_report.js` is therefore NOT in the authorized boundary.** The *"Please try again"* wording is accepted as-is for this work item. Improving it later is a separate decision and would require its own governance pass — it is not a loose end this item leaves open, it is a refinement deliberately declined.

---

## 3. Risk classification

**MEDIUM.**

Phase 0 recorded **HIGH**. That rated the *problem domain* — irreversible cross-user calendar deletion — before any mechanism was known. With the mechanism now known, the change is two lines in one `switch` case, reusing a code path the auto-tester exercises on every run (§5).

**This changes no procedural requirement.** Governance §3 Phase 3 mandates external review for **both** Medium and High. Full Phase 1–8 remains in force because the area is Protected Core twice over. Nothing is relaxed by this reclassification.

**The residual risk that keeps it above Low:** a wrong `uid` deletes the wrong person's real calendar events, with no undo. That is why §7's completion evidence requires a negative control, not just a success case.

---

## 4. Change Impact Matrix

Every row stated explicitly. An omitted row is not "not affected."

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **No** | Not modified. `lib/calendar.ts:538` and `naavi-chat/intentHandlers.ts:1124` already identify the user correctly and are untouched by a change confined to the voice repo. |
| **Voice** | **Yes** | `src/index.js:4625-4637`, branch `staging` only. Branch `main` (production) is explicitly excluded per Phase 0 and STAGING-FIRST. |
| **Shared Core** | **No** | `delete-calendar-event` is not modified. Its existing admin branch is *used*, not changed. |
| **Database** | **No** | No migration, no schema change, no RLS change, no new column. |
| **Cron** | **No** | No cron job reads or writes this path. `DELETE_EVENT` is caller-initiated only. |
| **API contracts** | **No** | `delete-calendar-event`'s request shape is unchanged. The voice caller starts populating an **already-defined, already-used** optional field (`body.user_id`, `index.ts:46`). No consumer sees a new or altered contract. |
| **Tests** | **Yes** | One new file in the voice repo's own suite. No existing test modified. See §6. |

**Duplication check:** the affected capability is **not** duplicated (Phase 1A §1, Q2 — Reference §2 classifies calendar writes as Shared Core, "genuinely shared"). No second implementation exists that would need a matching change. Stated explicitly rather than left blank.

---

## 5. Mandatory Architecture Impact Checklist

| Question | Answer |
|---|---|
| Does this change modify Shared Core? | **No.** |
| Does this change modify an Entry Point? | **Yes** — the voice entry point, which is where the defect is. It makes the entry point *translate correctly*, moving it toward Reference §3's stated ideal. |
| Does this change introduce new duplication? | **No.** It uses the Edge Function's existing branch rather than adding a parallel path. |
| Does this change eliminate existing duplication? | **No.** |
| Does this change modify Protected Core? | **Yes** — Voice orchestration and Calendar integration (Reference §4). Full Phase 1–8 already in force. |

**Ownership (Governance §4's Ownership Change Rule):** unchanged. Shared Core keeps the capability; the entry point keeps translation. No architectural approval beyond ordinary phase-gating is required.

---

## 6. Rule 15a — test coverage, and the honest constraint

**`src/index.js` has no `module.exports`.** Verified this session — the string does not appear in the file. It cannot be `require`d without starting a server, and **every one of the 12 existing voice-repo tests targets a separately extracted module** (`outcome_report.js`, `list_confirm_gate.js`, `pauseCommand.js`, …), never `index.js` itself.

**So a behavioural unit test of the `DELETE_EVENT` case is impossible without extracting the code into a module — and Phase 0 forbids that** (Rule 0.3, minimal change; "no new source files, no helpers"). [[B11k]] faced this identically and took Rule 15a's exception path with Wael's explicit approval on 2026-08-23.

**What *is* testable, using a pattern this project already uses:** a **source-assertion test** — read `src/index.js` from disk and assert the `DELETE_EVENT` case carries `user_id`. This is not a workaround invented here; `tests/catalogue/session-2026-05-29.ts:233` does exactly this against `delete-calendar-event/index.ts`, asserting on its source text.

**What such a test does and does not prove.** It locks in that the identity is passed and would fail loudly if a future edit dropped it — which is the specific regression worth guarding. **It does not prove the delete succeeds end to end**; only a live call does that, which is why §9 requires one.

**⭐ The test must now assert two things, not one** (mandatory change, §2b):

1. The `DELETE_EVENT` case passes `user_id` in the request body.
2. The `DELETE_EVENT` case guards `deleted: 0`. A future edit removing that guard reinstates the false-success defect **silently** — and it is exactly the kind of line someone deletes while tidying a return statement.

**Decision needed from Wael** — Rule 15a requires either a test or an approved exception:

**⭐ Wael's ruling, 2026-08-24: OPTION 1.** Source-assertion test in the voice repo (`test/deleteEventUserId.test.js`), plus the live call as behavioural evidence. **No Rule 15a exception is being taken** — a real regression test exists, so the rule is satisfied rather than waived.

1. **Source-assertion test in the voice repo** (`test/deleteEventUserId.test.js`), plus the live call as behavioural evidence — **SELECTED**
2. ~~Rule 15a exception with live-call evidence only, as B11k did~~ — not taken
3. ~~Extract the case into a testable module~~ — rejected; violates Phase 0's minimal-change constraint and enlarges a Protected Core file's blast radius for test convenience

---

## 7. Regression Impact — the fixed checklist

Every item stated explicitly. Silence is not acceptable.

| Function | Affected? | Reasoning |
|---|---|---|
| **Voice commands** | **Yes — one, in two respects.** `DELETE_EVENT` only: (a) the caller's identity is now sent, and (b) a no-match result is now classified a failure (§2b), so Naavi stops claiming a deletion that did not happen. The other ten actions in `executeAction` are untouched; the `switch` case is self-contained. **`outcome_report.js` is NOT modified** — the new classification happens at the call site and reaches the shared module through its existing `{ success, error }` contract. The Rule 23 confirm gate is not modified. |
| **Geofencing** | **No.** Mobile-only capability (Reference §2). No shared code path. |
| **Gmail integration** | **No.** Different Edge Functions, different call sites, not touched. |
| **Calendar integration** | **Yes — deletion via voice only.** Calendar **reads** use a separate duplicated path (Reference §2, ADR 0002) and are untouched — confirmed live in the reproduction call, where reads worked while the delete failed. `create-calendar-event`'s four voice call sites are untouched and already pass `user_id`. |
| **Reminders** | **No.** Separate table, separate actions (`SET_REMINDER`), separate Edge Function. |
| **SMS / call alerts** | **No.** `send-sms`, `send-email`, `evaluate-rules` and `report-location-event` are not on this path. |
| **Onboarding** | **No.** First-call onboarding (`:6705` onward) runs before any action execution and is not modified. |
| **Staging build** | **Yes — voice staging redeploys.** Push to `staging` triggers Railway's build of `naavi-voice-staging`. Per Reference §0b, that branch is **also** deployed by `generous-tenderness-production-9235` (demo staging) — so the demo staging service redeploys too. **The demo line's behaviour does not change**, because action execution is unreachable there (Phase 1A §2), but the redeploy itself is a fact of this change and is recorded rather than omitted. |

---

## 8. Regression Matrix — per-change consumer trace

Produced by searching the codebase, not from memory.

### 8a. Consumers of `delete-calendar-event` (the function whose behaviour is being newly exercised)

| Consumer | Location | Auth path used | Effect of this change |
|---|---|---|---|
| Mobile client | `lib/calendar.ts:538` | User JWT → `else` branch | **None.** Not modified; still sends its own JWT. |
| `naavi-chat` | `supabase/functions/naavi-chat/intentHandlers.ts:1124` | Service key + `user_id` → **admin branch** | **None.** Not modified. |
| **Voice server** | `naavi-voice-server/src/index.js:4626` | Service key, **no user** → `else` branch (**broken**) | **This is the change.** Moves from the `else` branch to the admin branch. |
| Auto-tester teardown | `tests/lib/adapters.ts:203` | Service key + `user_id` → **admin branch** | **None.** Not modified. |

**⭐ The single most important regression finding:** the branch this fix moves voice onto is **not a cold path.** `tests/lib/adapters.ts:198-206` sends service-role auth plus `body.user_id` — *the exact shape this change will produce* — and runs on **every `npm run test:auto` execution** as calendar teardown. `naavi-chat` uses the same shape in production. The target path is exercised daily and is the best-proven of the function's two branches.

### 8b. Callers of `executeAction` (the modified function)

All 8 found by search, all pass a resolved user:

`:3881` (multi-action queue, `userIdOverride`) · `:10886` · `:10999` · `:11049` · `:12139` · `:12165` · `:12297` · `:13293` — the last seven all pass `userId`.

**Consequence:** `userIdOverride` is populated at every entry point, so the guard in §2 cannot spuriously block a legitimate delete. Its only trigger would be a caller that stopped passing a user — which is the failure it exists to surface loudly rather than silently repeat B11o.

**Note on `getUserId()`:** `:1029` is a deliberately neutered stub — it logs a warning and returns `null`. The `|| await getUserId()` half of the idiom is dead in practice and is retained only to match the ten sibling cases verbatim. Changing it would be an unapproved refactor of code outside this fix.

---

## 9. Completion evidence this plan commits to

1. **Positive control (live):** call voice staging **+1 343 504 1572**, delete a real event, confirm — the event is gone from the caller's Google Calendar, and the log shows a success rather than `No Google token found`.
2. **Negative control — cross-user:** the deletion touched **only** the calling user's calendar. Evidence, not assertion.
3. **⭐ Negative control — no-match (added by the mandatory change):** ask Naavi to delete an event that does **not** exist. She must say she was **not** able to delete it. **A "deleted" claim here fails the work item**, and this is the case §2b exists to cover. Log evidence: `deleted: 0` classified as failure, `speech_modified: true`.
4. **Regression:** the reproduction from Phase 1 §6 no longer reproduces.
5. **Voice suite green** — `npm test` in the voice repo.
6. **Voice regression suite** (Gate 2) green.

**Gate 1 (`npm run test:auto`) is not a completion criterion for this staging fix** — it is red because of the parked [[B11z]], and it gates *production AAB builds*, not staging voice deploys. Flagged so it is not discovered later as a surprise blocker.

---

## 10. What this Phase 2 does and does not authorize

**Does not authorize:** any code, any commit, any deploy. Phase 2→3 requires Wael's own separate word.

**Two decisions Phase 2 needs before Phase 3:**

1. **§6 — the Rule 15a approach** (source-assertion test / exception / extract). Recommend #1.
2. **§1 — acceptance of the Phase 0 test-file correction**, from the mobile repo's `tests/catalogue/` to the voice repo's `test/`. Phase 0 named the wrong repo; this cannot be reinterpreted silently.
