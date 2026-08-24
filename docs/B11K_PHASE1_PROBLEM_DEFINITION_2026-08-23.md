# B11k — Phase 1: Problem Definition

**Work item:** [[B11k]] — Naavi tells a caller an action succeeded when it failed
**Date:** 2026-08-23
**Phase 0:** APPROVED 2026-08-23, scope locked to Option 1 (all state-changing background actions, structural fix, safe default)
**Architecture Reference version used:** 2026.07.18.9
**Code under investigation:** `naavi-voice-server` @ `55ce1d3`. **`origin/main` and `origin/staging` are byte-identical across `src/` and `test/`** (`git diff --stat origin/main origin/staging -- src/ test/` returns empty), so every finding below applies to both branches.
**No code was written during this phase.** Three read-only diagnostic scripts were added and are cited as evidence.

**Status: APPROVED** — Wael, 2026-08-23, with all three §8 decisions accepted as recommended. External review (ChatGPT) same date: Approved.

**Scope, as amended by this approval — this supersedes Phase 0's "twelve":**
- **Removed** (proven already safe, §4.1): `SET_EMAIL_ALERT`, `SET_ACTION_RULE`(email), `SET_ACTION_RULE`(location), `DRAFT_MESSAGE`.
- **Added** (§4.3): `LOG_CONCERN`, `UPDATE_PROFILE`.
- **Added** (§4.4, decision 2): `DRIVE_SEARCH`, `LIST_CONNECTION_QUERY`.
- **Governing scope is now the verified exposed set, not the original estimate.**

**Split out of B11k as separate correctness items** (decision 3, plus the reviewer's addition): `DELETE_EVENT`'s missing `user_id` (§5) — to be opened and prioritised **above** B11k's implementation; and `DELETE_MEMORY`'s zero-match-returns-success (§5.1) — recorded as independent, unless a later phase shows truthful outcome handling cannot be built without defining that result contract first.

---

## 1. What exactly is broken

Naavi dispatches her speech to TTS, and *then* executes the action she just described. The outcome
does not exist at the moment she commits to words about it, and when it does exist it is discarded.

**Two things follow, and they are separate defects that share one cause:**

- **A failed action is reported as a success.** The caller is told it worked.
- **A failed action is invisible even to the error log**, in the common case — see §3.2. The
  `.catch()` on the execution site does not catch business failures.

---

## 2. What evidence proves the problem

### 2.1 The ordering, in source

```
src/index.js:13406    // Execute remaining actions in background AFTER speaking
src/index.js:13407    Promise.all(backgroundActions.map(a => executeAction(a, userId))).catch(err => {
src/index.js:13408      console.error('[Process] Background action error:', err.message);
```

Not awaited. Return values discarded. The comment states the ordering as intent.

**Background is the default branch, not an opt-in** (`src/index.js:13235-13236`):

```
} else {
  backgroundActions.push(action);
}
```

### 2.2 The live proof, from Wael's phone

2026-08-21, during the [[T12]] equilibrium test. He asked both lines to add a contact and heard what
sounded like success on both. Staging created the contact; production created nothing — staging
logged `{ success: true, resourceName: ... }`, production `{ error: 'No user found' }`. **Nothing at
the user surface distinguished them.** The turn log reads `step=turn-exit-before-tts` with
`bg_action_count: 1`.

### 2.3 The precedent — this is the fourth encounter, not the second

The holding list records two prior narrow fixes. There are three:

| Date | Fix | Actions covered |
|---|---|---|
| 2026-05-12 | `list_confirm_gate.js` (Wael) | the six list actions |
| 2026-07-15 | `action_rule_confirm_gate.js` (F19 Track B-1e) | `SET_ACTION_RULE` where `trigger_type === 'time'` |
| **2026-07-21** | **B10q + follow-up** (`src/index.js:12151-12175`) | **`SET_EMAIL_ALERT`, and `SET_ACTION_RULE` where `trigger_type === 'email'`** |

`action_rule_confirm_gate.js` names the cause in its own comment: *"fire-before-confirm + discarded
result."* B10q's comment at `src/index.js:12153-12156` names it independently: *"must await here
rather than fall through to the generic fire-and-forget backgroundActions bucket (Promise.all, not
awaited, runs after finalSpeech is already dispatched to Twilio)."*

**Three independent discoveries of one defect, each fixed only for the action in front of the
person who found it.** B10q's own comment records that its follow-up was itself a second,
independently-discovered write path for the same defect, found by a real phone call.

---

## 3. Root cause

**Proven. Two components, both required — fixing either alone leaves the defect.**

### 3.1 Ordering: speech is committed before the outcome exists

`finalSpeech` is dispatched to Twilio before `src/index.js:13407` runs. There is no point at which
the speech can be informed by the result, because the result does not yet exist.

### 3.2 Result shape: `executeAction` returns failures, it does not throw

This is the component the holding list did not capture, and it is why the `.catch()` at 13408 gives
false reassurance.

`executeAction` (`src/index.js:4516`) returns structured objects on failure rather than throwing:

```
src/index.js:4557   return { success: false, error: 'No user id' };      // SCHEDULE_MEDICATION
src/index.js:4655   if (!uid) return { error: 'No user ID' };            // DELETE_MEMORY
src/index.js:4874   return { success: false, error: 'resolve_failed' };  // SET_ACTION_RULE
src/index.js:4994   return { error: 'No phone' };                        // SET_REMINDER
```

A returned `{ error: ... }` is not a rejected promise. **`Promise.all(...).catch()` never fires for
it.** The production `ADD_CONTACT` failure in §2.2 was `{ error: 'No user found' }` — a returned
value. It did not reach the catch, and it did not reach `[Process] Background action error`.

**Consequence for any fix:** awaiting the promise is necessary but not sufficient. The result must
be *inspected*, because failure is carried in the value, not in the control flow. This is precisely
what the three prior narrow fixes each do — B10q at `src/index.js:12164` tests
`result?.error === 'email_alert_unscoped'` and `result?.success === false`, not a thrown exception.

### 3.3 Alternatives considered and ruled out

| Hypothesis | Ruled out by |
|---|---|
| Claude generates optimistic speech; a prompt rule would fix it | The speech is dispatched before the action runs. No prompt wording can describe an outcome that does not exist yet. |
| The `.catch()` handles failures; the gap is only that nothing is *spoken* | §3.2 — the catch does not fire for returned errors, which is the observed production case. |
| It affects only ungated actions in the `else` branch | §4.3 — `LOG_CONCERN` and `UPDATE_PROFILE` carry the same defect inside explicit branches. |
| Fixing [[B11j]] fixes this | B11j removes one failure. It does not make any other failure visible. Holding list records them as separate; this phase found no evidence to merge them. |

---

## 4. ⭐ The exposed set is not the twelve in the holding list

The holding list's twelve were, in its own words, *"derived by reading the branch structure, not by
exercising each."* Enumerating every branch of the action loop (`src/index.js:12122-13236`) against
every case `executeAction` handles (`src/index.js:4516-6200`, 23 types) gives a different set.

### 4.1 Four of the twelve are already safe — remove them

| Claimed exposed | Actually | Evidence |
|---|---|---|
| `SET_EMAIL_ALERT` | **Awaited, speech corrected on failure** | `src/index.js:12151-12175` (B10q) |
| `SET_ACTION_RULE` (`trigger_type='email'`) | **Awaited, speech corrected on failure** | same branch, `12151` |
| `SET_ACTION_RULE` (`trigger_type='location'`) | **Never reaches background.** Deferred to `pendingLocation`, committed via `await commitLocationRule(...)` with the result checked | `src/index.js:12533`, `11750`, `11789` |
| `DRAFT_MESSAGE` | **Never executed here.** Held as `pendingDraft` for voice confirm | `src/index.js:12123-12125` |

### 4.2 Nine state-changing types genuinely reach the `else`

`ADD_CONTACT` · `CREATE_EVENT` · `DELETE_EVENT` · `DELETE_MEMORY` · `REMEMBER` · `SAVE_TO_DRIVE` ·
`SCHEDULE_MEDICATION` · `SET_REMINDER` · `UPDATE_MORNING_CALL`

Plus `SET_ACTION_RULE` for **three** remaining triggers: `weather`, `calendar`, `contact_silence`.
(The calendar pre-pass at `src/index.js:12105-12120` only corrects a `minutes` value; it does not
gate or execute, so calendar still falls through.)

### 4.3 ⭐ Two more carry the defect *outside* the `else` branch — newly found

Both write to `topics` with a bare un-awaited `fetch(...).catch()` and print an unconditional
"saved" log immediately after:

```
src/index.js:12499   }).catch(err => console.error('[Voice] LOG_CONCERN insert failed:', ...));
src/index.js:12500   console.log(`[Voice] LOG_CONCERN saved subject="${subject}" ...`);

src/index.js:12513   }).catch(err => console.error('[Voice] UPDATE_PROFILE insert failed:', ...));
src/index.js:12514   console.log(`[Voice] UPDATE_PROFILE saved key="${subject}"`);
```

Both are on CLAUDE.md Rule 12's state-changing list. **They sit inside explicit `else if` branches,
so they look handled.** A fix that changes only the default branch at `13236`/`13407` leaves both
untouched — and an audit that asks "is it in the `else`?" misses both.

### 4.4 Phase 0's open trace question — answered

Phase 0 put the five read-only actions in scope *to determine* whether they route through
background. They split:

| Action | Routed | Consequence |
|---|---|---|
| `GLOBAL_SEARCH` | awaited, `12292` | fine |
| `LIST_READ` | awaited, `12135` | fine |
| `FETCH_TRAVEL_TIME` | awaited, `12178` | fine |
| **`DRIVE_SEARCH`** | **falls to the `else`** | its result is discarded; the caller can never receive it |
| **`LIST_CONNECTION_QUERY`** | **falls to the `else`** | same |

These two are not "Naavi lies about success" — they are "Naavi cannot answer the question at all."
Different symptom, same line of code. **Flagged, not silently absorbed:** Phase 0 scoped in
*determining* this and explicitly said changing their behaviour returns as an amendment.

---

## 5. ⭐⭐ `DELETE_EVENT` is not merely invisible — it is dead, on both environments

Phase 0 named `DELETE_EVENT` and `DELETE_MEMORY` as the two that should decide priority. The
investigation found something worse than predicted for the first of them.

**Voice sends no `user_id`** (`src/index.js:4625-4631`):

```
body: JSON.stringify({ query: action.query }),
```

with `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`.

**`delete-calendar-event` therefore takes its JWT branch** (`supabase/functions/delete-calendar-event/index.ts:72-83`),
which queries `user_tokens` filtered only by `provider='google'` and calls `.single()`.

**Measured, 2026-08-23** (`scripts/diag-b11k-user-tokens-count.js`):

| Project | rows with `provider='google'` |
|---|---|
| Staging | 4 |
| Production | 5 |

`.single()` cannot resolve against 4 or 5 rows.

**Proven live, read-only, both environments** (`scripts/diag-b11k-delete-event-userpath.js` and
`...-prod.js`). These reproduce voice's exact call shape but pass `diag: true`, a branch that only
lists and returns before any delete (`delete-calendar-event/index.ts:101`) — and which sits *after*
token resolution, so it exercises the path under test:

```
STAGING     HTTP 400   {"error":"No Google token found"}
PRODUCTION  HTTP 400   {"error":"No Google token found"}
```

**Voice `DELETE_EVENT` deletes nothing, for any caller, on either environment — and every caller is
told it worked.** The error is a returned value inside a discarded promise, so per §3.2 it never
even reached the background-error log.

**This is the same shape as [[B11j]]** (voice `ADD_CONTACT` omitting `user_id`), which was fixed on
2026-08-21. That fix was applied to `ADD_CONTACT` alone. `DELETE_EVENT` has the identical omission
and was not examined.

**It is also a CLAUDE.md Rule 4 / Rule 10 violation** — the no-`user_id` path is the forbidden
"resolve the user from `user_tokens`" shortcut on a multi-user table. It currently fails safe
(400) rather than deleting from the wrong person's calendar, but only because more than one row
exists. **With exactly one Google-connected user it would resolve to that user and delete from their
calendar regardless of who called.**

**Scope note:** repairing `DELETE_EVENT`'s `user_id` omission is a *correctness* fix, not a
*visibility* fix, and Phase 0 scoped B11k to visibility. Recorded here per Phase 4's rule that
improvements found nearby are reported, never implemented silently. It needs Wael's decision — see §8.

### 5.1 `DELETE_MEMORY` has a second, independent defect

`src/index.js:4670`:

```
return { success: res.ok, deleted: count };
```

`res.ok` is true for an HTTP 200 **even when `count === 0`**. Deleting nothing returns
`success: true`. So even a fix that correctly awaits and inspects the result would still be told
this succeeded when the memory the user named was never found. **The result shape cannot express
"matched nothing."**

---

## 6. Architecture ownership and classification

Per the Architecture Reference (2026.07.18.9):

| Question | Answer |
|---|---|
| **Owning component** (§0a Ownership Model) | **Voice** — `munk2207/naavi-voice-server` |
| **Classification** | **Voice-only defect in an entry point.** The capability "report truthfully whether an action succeeded" is **Duplicated** across surfaces (§5a) — mobile owns a working implementation, voice owns a broken one |
| **Protected Core?** (§4) | **Yes, five areas** — Voice orchestration (`src/index.js`, entire file), Action Rules, Reminder Engine, Calendar integration, Notification routing |
| **Review level** | **Full Phase 1–8**, external review mandatory at Phase 3 and Phase 6 |

**This is the documented entry-point drift, not a new one.** §3 states an entry point should
translate rather than implement business logic, and names voice's *"own turn-state tracking… its own
direct database inserts"* as *"the single biggest gap between what an entry point should do and what
voice actually does."* B11k is a consequence of that gap.

**Mobile's implementation, verified this session** (not cited from the Reference):

- `hooks/useOrchestrator.ts:2555-2560` — the comment describing the voice bug exactly, V57.8:
  *"override Naavi's speech to be truthful about the failure. Otherwise the speech still says 'I've
  added it' and the user thinks the event was created."*
- **52 `turnSpeechOverride = ` assignments** in that file — the mechanism, applied broadly rather
  than at one site.

**Mobile executes, then speaks, and rewrites the speech to the truth on failure. Voice speaks, then
executes, and discards the outcome.**

**Voice cannot copy it verbatim** and this is the real design constraint: mobile can take as long as
it needs before rendering a bubble; a phone call cannot. Phase 2 owns that trade-off. Phase 1 does
not propose a mechanism.

---

## 7. Regression surface identified for Phase 2

Not analysed here — recorded so Phase 2's Regression Matrix has its starting list:

- 11 state-changing action types + 3 `SET_ACTION_RULE` trigger variants (§4.2, §4.3)
- 2 read-only actions whose results currently vanish (§4.4)
- 3 existing gates that already solve this narrowly and must not be broken or duplicated by a
  general fix: `list_confirm_gate.js`, `action_rule_confirm_gate.js`, B10q's inline branch
- The `pendingDraft`, `pendingLocation` and `pendingLocationCreate` deferral flows, which are
  correct today and share the loop
- Turn latency and the no-dead-air requirement

---

## 8. Decisions this phase surfaces, for Wael

Phase 0 locked scope as *"all twelve."* The investigation shows the set is different — smaller in
one direction, larger in another. Three questions follow. **No work proceeds on any of them without
your word.**

1. **Amend the scope from "the twelve" to the actual set?** Remove the four that are already safe
   (§4.1); add `LOG_CONCERN` and `UPDATE_PROFILE` (§4.3). Net: 11 state-changing types plus 3
   trigger variants. **Recommend yes** — the four removed are already correct, and the two added
   carry the identical defect. Fixing the list as written would both do redundant work and miss
   two real cases.

2. **`DRIVE_SEARCH` and `LIST_CONNECTION_QUERY` (§4.4) — in or out?** Same root cause, same line,
   different symptom: the caller gets no answer rather than a false one. **Recommend in** — they
   are fixed by the same structural change, and leaving them out means knowingly shipping a fix
   past two known instances.

3. **`DELETE_EVENT`'s missing `user_id` (§5) — separate item, or fold in?** It is a correctness
   defect, not a visibility one, and B11k is scoped to visibility. **Recommend a separate item,
   opened now and prioritised above B11k's implementation** — because B11k's fix would otherwise
   make Naavi correctly and reliably announce a failure on every single delete-event request,
   which is honest but still broken. The two land best together, in that order.

---

## 9. Required output

Approve, approve with changes, or reject this Phase 1 — and answer the three questions in §8.

Per governance §3's Phase-Gate Approval Rule, Phase 1A does not begin — including drafting its
document — until Wael's own explicit go-ahead for that transition.
