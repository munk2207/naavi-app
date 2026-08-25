# B11o — Phase 0: Intent Approval

**Work item:** [[B11o]] — Voice `DELETE_EVENT` sends no `user_id`; deleting a calendar event by phone has never worked
**Date:** 2026-08-24
**Governance:** Full Phase 1–8 — Protected Core twice over (Voice orchestration + Calendar integration)
**Risk:** **HIGH** — not because the change is large, but because the failure mode is irreversible cross-user data loss. A wrong fix deletes the wrong person's real calendar events, and there is no undo.
**Status:** **APPROVED WITH ONE CORRECTION by Wael, 2026-08-24** — Phase 0 → Phase 1 authorized. No code written.
**Correction applied:** Constraints said *"One file. No new files"* while Completion Criterion 4 required a new regression test file. Contradictory. Now separated: **one production source file**, plus the test files Rule 15a requires, named explicitly below.
**Ruling applied:** `DELETE_MEMORY` is **out of scope** — B11o fixes `DELETE_EVENT` only.

---

## ⭐⭐⭐ SCOPE: STRICTLY VOICE STAGING. NOTHING ELSE.

**Wael, 2026-08-24: *"B11o is ONLY Voice staging. DO NOT TOUCH anything else."***

| Surface | Touched by this work item? |
|---|---|
| **Voice staging** — branch `staging` → Railway service `naavi-voice-staging` | **YES — the only surface** |
| Voice production — branch `main` → `naavi-voice-server` | **NO** |
| Mobile staging | **NO** |
| Mobile production | **NO** |
| Demo staging — `generous-tenderness-production-9235` | **NO** |
| Demo production — 1-888-91-NAAVI | **NO** |
| Supabase staging `xugvnfudofuskxoknhve` | **NO** — no schema change, no Edge Function change proposed |
| Supabase production `hhgyppbxgmjrwdpdubcx` | **NO** |

**Exactly one production source file may be edited: `naavi-voice-server/src/index.js`, on branch `staging`.** Test files are the one authorized addition — see In Scope.

### Why the other five surfaces are excluded — verified, not assumed

**Mobile is not affected.** It reaches the same Edge Function by a different route that identifies the user correctly:
- `lib/calendar.ts:538` — sends `{ query }` through `supabase.functions.invoke`, which attaches the signed-in user's own JWT. The Edge Function's JWT branch then scopes the token lookup to that user under RLS, resolves one row, and works.
- `supabase/functions/naavi-chat/intentHandlers.ts:1124` — sends `user_id: userId` explicitly and takes the admin branch. Also works.

**Demo is not affected — the code is unreachable.** Since F2b (2026-07-01) a demo caller gets a fixed scripted walkthrough, never an open conversation. `/voice/demo/name` (`:7676`) and `/voice/demo/confirm` (`:7714`) both route into `buildDemoWalkthroughGateTwiml`. The route that would open a media stream, `/voice/demo/connect`, is defined at `:8580` and **called by nothing**. Action execution — where `DELETE_EVENT` lives — cannot be reached from the demo line at all.

**Production is excluded by STAGING-FIRST**, not because the defect is absent. `origin/main:4625-4633` is byte-identical to `staging`. Production carries the same bug and receives this fix **only** on Wael's explicit "deploy to production", as a separate decision after staging is confirmed.

**⭐ The correction that produced this scope is worth keeping.** An earlier draft of this analysis claimed the demo line was affected, reasoning *"demo deploys the same branch, so it has the same bug."* Wael rejected it on the ground that calendar does not work on the demo line at all — and he was right. **Same code deployed is not the same code reached.** Architecture Reference §7 rule 5 names this exact trap; the first pass skipped it.

---

## Why this Phase 0 exists

**A caller asks Naavi to delete a calendar event. Naavi asks the backend to delete it, but never says whose calendar.**

`naavi-voice-server/src/index.js:4625-4637`, read on branch `staging`, 2026-08-24:

```js
case 'DELETE_EVENT': {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-calendar-event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ query: action.query }),
  });
```

No `user_id` in the body. The `Authorization` header carries the **service-role key**, not a user JWT.

`supabase/functions/delete-calendar-event/index.ts:60-84` branches on exactly that:

```ts
if (bodyUserId) {                     // admin path — filters .eq('user_id', bodyUserId)
  ...
} else {                              // JWT path — no user filter at all
  const userClient = createClient(..., ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: tokenRow } = await userClient
    .from('user_tokens')
    .select('refresh_token')
    .eq('provider', 'google')
    .single();
}
```

With no `user_id` in the body, it takes the `else` branch. That branch expects a real user JWT so RLS narrows `user_tokens` to one row. It receives the service-role key instead, which RLS does not narrow — so `.single()` runs against **every** Google token row in the project.

**Measured live, read-only, 2026-08-24** (`scripts/diag-b11k-user-tokens-count.js`):

```
STAGING:    4 row(s) with provider='google'
PRODUCTION: 5 row(s) with provider='google'
```

`.single()` requires exactly one. Four rows fail, five rows fail. `refreshToken` comes back undefined and the function returns `HTTP 400 {"error":"No Google token found"}` — every time, for every caller, on both projects.

### Three facts that sharpen the diagnosis

1. **`DELETE_EVENT` is the only action in the file that does this.** All 11 cases in `executeAction` were scanned; `CREATE_EVENT`, `SCHEDULE_MEDICATION`, `REMEMBER`, `DELETE_MEMORY`, `SAVE_TO_DRIVE`, `DRIVE_SEARCH`, `GLOBAL_SEARCH`, `SET_EMAIL_ALERT` and `SET_ACTION_RULE` each open with `const uid = userIdOverride || await getUserId();`. `DELETE_EVENT` never computes `uid` at all.

2. **It is the identical shape to [[B11j]]**, voice `ADD_CONTACT`, fixed 2026-08-21 — for `ADD_CONTACT` alone. `DELETE_EVENT` has the same omission and was never examined at the time.

3. **It fails safe today only by accident, and that is a CLAUDE.md Rule 4 / Rule 10 violation.** It errors out because *more than one* Google user exists. With exactly one Google-connected user in a project, `.single()` would resolve — and Naavi would delete from that person's calendar regardless of who phoned. The safety here is a property of the current user count, not of the code.

**Provenance:** found 2026-08-23 during [[B11k]] Phase 1, proven live and read-only on both projects via the function's own `diag:true` branch, which returns before any delete.

---

## User Intent

When a caller asks Naavi by phone to delete a calendar event, it should be deleted from **that caller's** calendar — and from nobody else's.

## Success Criteria

1. A registered caller on voice staging asks Naavi to delete a calendar event, and the event is removed from **their own** Google Calendar.
2. Naavi's spoken reply matches what actually happened — deleted when it deleted, not deleted when it did not.
3. No path exists by which a delete request from one caller can reach another user's calendar.
4. Nothing else in the call flow changes.

## In Scope

**Production source — one file:**

- `naavi-voice-server/src/index.js` — the `DELETE_EVENT` case at `:4625-4637`, on branch `staging` only.

**Test files — the only additions authorized, required by Rule 15a:**

- One new or extended file under `tests/catalogue/`, locking in that the voice delete path identifies the caller.
- `tests/runner.ts` — registration of that test, and nothing else in this file.

These are test-harness files in the mobile repo; they ship with no product code and reach no user. Naming them here so "one file" is not later read as forbidding the test Rule 15a mandates.

## Out of Scope

- **Every surface except voice staging** — see the scope table above. Mobile, demo, production, and both Supabase projects are untouched.
- **`supabase/functions/delete-calendar-event/index.ts`.** Its dual-auth design is not the defect; the caller not using it is. Changing the Edge Function would alter behaviour for mobile and `naavi-chat`, which work correctly today, and would put a Shared Core change inside a work item Wael scoped to voice staging.
- **`DELETE_MEMORY`** — ruled out by Wael, 2026-08-24. Real defect, separate root cause, general list. See the section below.
- **The other ten actions in `executeAction`.** They already resolve a user. Not re-examined, not touched.
- **[[B11j]] and any other already-fixed sibling.** Closed; not reopened.
- **Production deployment.** A separate decision, on Wael's explicit word, after staging is confirmed.

## Constraints

- Branch `staging` only. No commit to `main`.
- **One production source file** — `naavi-voice-server/src/index.js`. No new source files, no helpers, no refactoring of neighbouring cases (Governance §0.3, Rule 0.3 Minimal Change).
- **Test files are the sole exception**, limited to the two named in In Scope. They add no product code and change no user-facing behaviour.
- No schema change. No Edge Function change. No prompt change.
- No cadence, config, or environment-variable change.
- Rule 15a applies: the regression test exists, is registered in `tests/runner.ts`, and passes before this item is done.
- Rule 17 applies: the bug must be reproduced by a live user-facing test before any fix is coded.

## Completion Criteria

1. **Reproduced first.** A live call to voice staging (**+1 343 504 1572**) asking Naavi to delete a real calendar event fails as described, evidenced from `railway logs --service naavi-voice-staging` — not inferred from source.
2. After the fix, the same live call deletes the event from the caller's own calendar, confirmed in the caller's Google Calendar.
3. A negative control: the deletion touches only the calling user's calendar. Evidence, not assertion.
4. A regression test in `tests/catalogue/` covers "voice delete path sends a user identifier", registered in `tests/runner.ts`.
5. `npm run test:auto` green with the environment banner read and recorded — per the Cross-Cutting Change Parity Check.

**⚠ Known blocker on criterion 5, surfaced now rather than discovered at the gate:** Gate 1 is currently **red** because of [[B11z]], which is parked. Criterion 5 cannot pass until B11z is resolved or Wael rules otherwise. This does not block the staging fix or the live test — it blocks any eventual production promotion.

---

## ⭐ DELETE_MEMORY — ruled OUT of scope (Wael, 2026-08-24)

The holding-list row for B11o also names a second defect in the same file:

**`DELETE_MEMORY` reports success even when it deletes nothing.** `src/index.js:4671` returns `{ success: res.ok, deleted: count }` — `res.ok` is true for a delete that matched zero rows, so Naavi says the memory is gone when it is still there.

It sits in the same executor, in the same file, on the same branch — inside the boundary Wael set. But it is a **separate bug with a separate root cause** (truthful reporting, not user identification), and Governance §0.2 locks scope at Phase 0 rather than letting it widen later.

**Wael's ruling: OUT.** B11o fixes `DELETE_EVENT` only. `DELETE_MEMORY` goes to the general list as its own item, with the evidence above, and is not investigated or fixed under this work item.

**Any later attempt to fold it back in is a Phase 0 scope violation** (Governance §15 — "scope expanded without approval") and must be rejected rather than absorbed.

---

## What this Phase 0 does and does not authorize

**Authorizes, on Wael's approval:** the Phase 0→1 transition, and Phase 1's investigation — including a live reproduction call to voice staging.

**Does not authorize:** any code change, any mechanism, any deploy, any commit, or drafting the Phase 2 document. Per Governance §3's Phase-Gate Approval Rule, each transition needs Wael's own separate word — a reviewer's "Approved" is never sufficient on its own.
