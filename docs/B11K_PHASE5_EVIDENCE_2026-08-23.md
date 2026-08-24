# B11k — Phase 5: Evidence Package

**Work item:** [[B11k]]
**Date:** 2026-08-23
**Phase 3:** APPROVED WITH MANDATORY CHANGES (both applied before coding)
**Branch:** `naavi-voice-server` @ **`staging`** — not pushed, not deployed
**Architecture Reference:** 2026.07.18.10

---

## 1. Summary

Voice now executes its remaining actions **before** speaking, inspects what came back, and builds
what Naavi says from the real outcome. If anything failed or could not be confirmed, Claude's
original speech is discarded rather than corrected after the fact.

The fire-and-forget `Promise.all` moved from *after* the speech dispatch to *before* it, gained a
5-second whole-batch bound, and its results now flow through a new pure module that owns the
classification and the wording. The two branches carrying the same defect outside that bucket —
`LOG_CONCERN` and `UPDATE_PROFILE` — were converted to awaited-and-inspected.

**Nothing else changed.** No Edge Function, no schema, no prompt, no mobile file, no existing gate.

---

## 2. Files changed

| File | Lines | Nature |
|---|---|---|
| `naavi-voice-server/src/outcome_report.js` | **new**, 187 | Pure module. `classifyResult`, `sentenceFor`, `composeTurnSpeech`, plus the phrase table and `BATCH_TIMEOUT_MS`. No I/O, no dependencies. |
| `naavi-voice-server/test/outcome_report.test.js` | **new**, 25 tests | Unit coverage of all three functions and every classification branch. |
| `naavi-voice-server/src/index.js` | +97 / −18 | Four edits plus one `require`. |

**Exactly five diff hunks, matching Phase 3 §4.1's authorized boundary one-for-one:**

```
@@ -17,2 +17,3      @@   require outcome_report
@@ -12498,8 +12499,25 @@   LOG_CONCERN  → awaited + inspected
@@ -12508,8 +12526,21 @@   UPDATE_PROFILE → awaited + inspected
@@ -13239,2 +13270,50 @@   the awaited, bounded batch (new)
@@ -13405,8 +13484,8 @@   fire-and-forget block removed
```

Full diff: `docs/B11K_PHASE5_index_js.diff` (151 lines).

---

## 3. Git diff — the substantive hunk

```js
    if (backgroundActions.length > 0) {
      const deadline = Date.now() + outcomeReport.BATCH_TIMEOUT_MS;
      const settled = await Promise.allSettled(backgroundActions.map(a =>
        Promise.race([
          executeAction(a, userId),
          new Promise(resolve => setTimeout(
            () => resolve(outcomeReport.TIMEOUT_SENTINEL),
            Math.max(0, deadline - Date.now()),
          )),
        ]),
      ));

      const outcomes = settled.map((s, i) => ({
        actionType: backgroundActions[i].type,
        outcome:    outcomeReport.classifyResult(s),
      }));

      for (const o of outcomes) {
        if (o.outcome !== 'success') {
          console.error(`[Process] action ${o.actionType} → ${o.outcome}`);
        }
      }

      const rebuilt = outcomeReport.composeTurnSpeech(finalSpeech, outcomes);
      if (rebuilt !== finalSpeech) {
        finalSpeech = rebuilt;
        speechWasModified = true;
      }
    }
```

**Placement verified by line number, not by intent:** the block sits at `src/index.js:13271`, the
empty-speech safety net at `:13319`, and `stopMusic()` at `:13332`. **The await happens while the
thinking tick is still playing**, which is what satisfies CLAUDE.md's no-dead-air requirement without
adding any audio work.

**One shared deadline, not one per action.** `deadline` is computed once and each race is given the
*remaining* time, so N parallel actions cost at most 5 s in total — the reviewer's requirement that
the bound not multiply by action count.

---

## 4. Tests executed

**`npm test` from `naavi-voice-server/` — 158 tests, 158 pass, 0 fail, 911 ms.**

That is the pre-existing 133 plus 25 new. **No pre-existing test changed or was disabled.**

*(Revision 2, after the Phase 5 review: 156 → 158, the two added tests covering the `{skipped:true}`
classification required by §6.2 below.)*

New coverage, by the requirement that asked for it:

| Requirement | Tests |
|---|---|
| Phase 2 mandatory change #2 — the result classification contract | rejected promise → `failure`; `{success:false}` → `failure`; **bare `{error}` → `failure`**; timeout sentinel → `unconfirmed`; structural timeout marker → `unconfirmed`; plain success → `success`; success with extra fields → `success`; null/undefined → `unconfirmed`; missing record → `failure` |
| Success Criterion 3 — safe default | an unregistered action type still produces a truthful sentence; every registered phrase produces a well-formed failure sentence |
| Phase 3 mandatory change #1 | `DRIVE_SEARCH` / `LIST_CONNECTION_QUERY` absent from the table, taking the default |
| Phase 3 mandatory change #2 | original speech returned untouched when all succeed; **no fragment survives a mixed turn**, asserted against the specific string; single failure replaces entirely; unconfirmed also discards; two failures named; three collapse to a summary; successes still reported alongside a collapsed summary |
| Withdrawn-wording guard | the `unconfirmed` sentence must not match `/I'll confirm/` or `/shortly\|in a moment/` — so the Phase 2 wording cannot return by accident |

**The bare-`{error}` test is the one that matters most.** It is the exact shape that made the
2026-08-21 production `ADD_CONTACT` failure invisible.

**Voice pre-push gate:** `sh .githooks/pre-push` → *"checking for calls to things that do not
exist... clean."*

**`node --check`** clean on both changed source files.

---

## 5. Manual tests required

Not yet performed — nothing is deployed.

1. **Deploy to `naavi-voice-staging`** (push branch `staging`), confirmed from
   `railway logs --service naavi-voice-staging`, not from the push.
2. **Call +1 343 504 1572** and exercise a normal successful action — confirm the reply is unchanged
   and the turn does not feel slower.
3. **Call again and deliberately fail an action** — Phase 0's Completion Criterion 2. `DELETE_EVENT`
   needs no rigging: it already fails 100% of the time (Phase 1 §5), so *"delete my dentist
   appointment"* should now produce *"I wasn't able to delete that event. Please try again."*
   instead of a false confirmation. **This is the single most direct proof the fix works.**
4. **Gate 2 — voice regression** must pass before any production promotion.

---

## 6. ⭐ Found during implementation — reported, not fixed

Per Phase 4's No Extra Changes Rule: *"If Claude identifies something worth improving nearby, it must
be reported in the Evidence Package as a separate item — never implemented silently."*

### 6.1 `executeAction` essentially never rejects — the old `.catch()` was dead code

`src/index.js:6201-6204` wraps the entire function body in `try/catch` and returns
`{ error: err.message }`. So the removed `Promise.all(...).catch()` would not have fired even for a
thrown exception — the throw was caught one level down and converted to a value.

**This strengthens Phase 1 §3.2 beyond what Phase 1 claimed.** Phase 1 said the catch does not fire
for returned errors. It is stronger than that: **the catch was unreachable for essentially every
failure**, which is why nothing ever appeared in `[Process] Background action error`. Recorded in
the removal comment. **No fix needed — the code is gone.**

### 6.2 ✅ RESOLVED — unhandled action types now classify as FAILURE

**Phase 5 review, 2026-08-23: required change, applied.** `{ skipped: true }` is classified as
`failure`, with two new unit tests. No sixth outcome class was added — the reviewer's ruling is that
`failure` already means *"the requested action was not performed"*, which is exactly what an
unhandled action type is.

A caller now hears the safe-default sentence — *"I wasn't able to do that. Please try again."* —
where before Claude's success speech survived untouched.

**Why this was flagged rather than fixed at Phase 4, and why that was still right:** the classification
contract approved at Phase 2 enumerated five result shapes. `{ skipped: true }` is a sixth that exists
in the code today, and under the contract as written it fell through to `success`. Inventing a rule at
implementation time is what Phase 4's No Extra Changes Rule forbids, so it was reported. **But the
reviewer is right that the outcome contradicted B11k's core invariant** — nothing executed, so the
success claim must not survive. Reporting it was correct; leaving it would not have been.

**Recorded as an Invalidated Planning Assumption** (governance Phase 6): Phase 2's contract was
incomplete against the code, discovered during implementation, and not an implementation error.

The original finding follows, retained as the record of what was found.

#### Original finding (revision 1)

`src/index.js:5425-5427`:

```js
default:
  console.log(`[Action] Unhandled action type: ${type}`);
  return { skipped: true };
```

`{ skipped: true }` has no `success: false` and no `error`, so **under the classification contract
approved at Phase 2 it is a `success`** — the speech is left untouched. That is what the approved
contract says literally, and it preserves today's behaviour exactly, so it is what I implemented.

**But it means an action type voice does not implement is still reported to the caller as done.**
Claude emits the action, voice logs *"Unhandled action type"*, nothing happens, and Naavi says
whatever she was going to say.

**This is the same defect class B11k exists to close, in a case the plan did not anticipate.** I did
not add a rule for it, because inventing classification rules at Phase 4 is exactly what the No
Extra Changes Rule forbids. **It needs a Phase 6 decision** — most likely `skipped` becomes its own
outcome class, or is folded into `failure`.

*(Resolved at the Phase 5 review — folded into `failure`, as above.)*

### 6.3 `null` / `undefined` results classify as `unconfirmed` — a choice the plan did not specify

The approved contract lists rejection, `{success:false}`, bare `{error}`, timeout, success. It does
not say what a `null` result is. Under the literal rules it would fall through to `success`.

**I classified it `unconfirmed` instead**, because claiming success with no evidence is precisely the
thing this module exists to prevent. It is defensive — every `executeAction` path I read returns an
object — so it should never trigger.

**Reported rather than buried**, because it is a rule I chose and the reviewer did not approve. If
Phase 6 disagrees it is a two-line change with a test already covering both directions.

**Phase 5 review, 2026-08-23: APPROVED as implemented** — *"the correct defensive safe-default
behavior."* No change.

### 6.4 The race timer is not cleared

Each action's `Promise.race` leaves a `setTimeout` that fires up to 5 s after the action resolves,
resolving an already-settled promise — a harmless no-op. Clearing it would need a handle threaded
through the race.

**Left as is deliberately:** bounded, self-clearing, and on a per-turn path. Adding cleanup would be
optimisation the plan did not authorize. **Noted so it is a decision on the record rather than an
oversight.**

**Phase 5 review, 2026-08-23: acceptable as implemented, no change required.**

---

## 7. Rollback instructions

Nothing is deployed, so rollback today is local.

- **Before commit:** `git checkout -- src/index.js && rm src/outcome_report.js test/outcome_report.test.js`
- **After commit, before push:** `git revert <sha>` on `staging`.
- **After deploy to staging:** revert on `staging` and push; Railway redeploys `naavi-voice-staging`.
  Confirm from `railway logs --service naavi-voice-staging`, never from the push.
- **Production is unaffected** — `main` is untouched and this was never promoted.

**The revert is clean.** The change adds one module and moves one block; it deletes no logic and
alters no data. Nothing persists that a revert would leave behind.

---

## 8. Known risks

| Risk | Assessment |
|---|---|
| **Added turn latency** | Bounded at 5 s for the whole batch, and only on turns that carry background actions. Not yet measured on a live call — **item 2 of §5 is what measures it.** |
| **`DELETE_EVENT` will now announce failure on every attempt** | **Expected and correct.** It already fails every time; it simply never said so. Will look like a new bug to anyone who has not read Phase 1 §5. The separate correctness item fixes the underlying cause. |
| ~~**§6.2 — unhandled types still report success**~~ | **Closed at the Phase 5 review** — `{skipped:true}` now classifies as `failure`, with tests. An action type voice does not implement produces a truthful sentence instead of a false confirmation. |
| **Mixed-turn rebuild changes phrasing users have heard before** | Only on turns containing a failure. All-success turns are byte-identical to today, verified by test. |
| **Losing the pre-generated-audio fast path more often** | Only when `speechWasModified` flips, which is only on failure. |
| **Not yet exercised against a real Twilio call** | The whole of §5. No claim is made here about live behaviour. |

---

## 9. Status

Phase 4 complete. **Not committed, not pushed, not deployed.**

**Phase 5 review, 2026-08-23: REVISE BEFORE PHASE 6 — resolved.** One required change (§6.2,
`{skipped:true}` → `failure`, plus tests), applied. §6.3 approved as implemented, §6.4 accepted with
no change. Suite rerun: **158 pass, 0 fail.** Nothing else was changed under that authorization.

| Review finding | Disposition |
|---|---|
| §6.2 `{skipped:true}` must not be `success` | **Fixed** — classified `failure`, 2 new tests |
| §6.3 `null`/`undefined` → `unconfirmed` | **Approved as implemented** |
| §6.4 uncleared timer | **Accepted, no change** |

**Ready for Phase 6** — the external technical review of the diff, mandatory for Protected Core at
HIGH risk.

Per governance §3's Phase-Gate Approval Rule, Phase 6 does not begin until Wael's own explicit word.
