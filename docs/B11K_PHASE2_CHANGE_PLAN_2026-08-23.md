# B11k — Phase 2: Change Plan

**Work item:** [[B11k]]
**Date:** 2026-08-23
**Phase 1:** APPROVED (both independent reviews pass — Technical 2026-08-23, Architecture Completeness 2026-08-23 revision 3, after Reference reconciliation to `2026.07.18.10`)
**Architecture Reference version:** **2026.07.18.10** — note this is *newer* than the 2026.07.18.9 recorded at Phase 1A. It was bumped **by this work item** as its reconciliation. Per Phase 1A's Version Verification requirement, the change is ours, its content is §5's Priority 1c and §2's two new rows, and it invalidates no assumption relied on here.
**Risk: HIGH**
**No code written.**

---

## 1. The mechanism decision Phase 0 deferred to here

**Recommendation: await the actions before speaking, and derive the words from the result.**

Phase 0 framed this as a hard trade — *"awaiting is truthful by construction but adds latency to a
live conversation."* **Investigation shows the trade is much smaller than it looked, for four
reasons, each verified.**

### 1.1 The action loop already runs before speech is dispatched

The loop is `src/index.js:12122-13236`. Speech dispatch begins at `:13286`. **Everything in the loop
is already pre-speech.** The fire-and-forget call at `:13407` is not in the loop — it sits *after*
dispatch, and moving it earlier is a relocation, not a redesign.

### 1.2 The pattern already exists in this exact function, three times

`LIST_READ` (`:12138`), **B10q's `SET_EMAIL_ALERT` branch (`:12164`)**, and `GLOBAL_SEARCH`
(`:12296`) all do `const result = await executeAction(...)` inside the loop and then set
`finalSpeech` + `speechWasModified`. `GLOBAL_SEARCH` runs a ten-adapter search and is awaited here in
production today. **A single-row insert cannot plausibly be the awaited call that breaks the call.**

### 1.3 ⭐ The tick sound already covers the entire window

`startMusic()` at `src/index.js:11965`. `stopMusic()` at `:13253`. **The thinking audio plays across
the whole action loop and stops immediately before dispatch.** Anything awaited inside that window
is already covered by CLAUDE.md's no-dead-air requirement — no new audio work, and the constraint
Phase 0 named is satisfied by construction rather than by adding something.

### 1.4 The success path keeps the fast TTS route

`speechWasModified` costs the pre-generated-audio fast path (`:13286`, `if (preGenAudio &&
!speechWasModified)`). **It only flips on failure.** A successful action leaves the speech untouched
and the fast path intact, so the steady-state cost is the action's own latency and nothing else.

### 1.5 ⭐ This fix was already named once, in-code, and deferred

`src/index.js:4834-4838`, F12 Phase 4, 2026-07-06:

> *"Returning success:false here is a smaller behavior change than wiring bespoke speech through all
> 5 call sites of executeAction() for this action type… Tailoring the spoken message at each call
> site is left as a follow-up, not silently skipped."*

**That is a fourth recorded encounter with this class** — after 2026-05-12, 2026-07-15 and
2026-07-21 — and it names the work B11k is now doing. The follow-up was never opened.

### 1.6 Alternatives considered and rejected

| Alternative | Rejected because |
|---|---|
| **Speak, then correct** | Naavi states something false first. On a phone there is no scrollback — a correction landing two seconds later competes with a caller who has already started their next sentence. Mobile's proven design is execute-then-speak; the two correct implementations both do it that way. |
| **Per-action gates, like the three existing ones** | Rejected at Phase 0 as Option 3. It leaves the default unsafe, so action thirteen re-enters the trap. |
| **Prompt rule telling Naavi to be cautious** | Ruled out at Phase 1 §3.3 — the speech is composed before the outcome exists. No wording can describe a result that has not happened. |
| **Await serially** | Unnecessary latency. `Promise.allSettled` keeps it at max(action), not sum(actions) — the same parallelism the current `Promise.all` has. |

---

## 2. Files that will change

| File | Classification | Change |
|---|---|---|
| `naavi-voice-server/src/index.js` | **Shared Logic** (voice entry point, Protected Core) | Relocate + await the background bucket; inspect results; route failures through the new module. Convert `LOG_CONCERN` / `UPDATE_PROFILE` to awaited-and-inspected. |
| `naavi-voice-server/src/outcome_report.js` | **Shared Logic — NEW** | Two exported functions: **(a) `classifyResult(settled)`** — the outcome contract, mapping a settled promise to `success` / `failure` / `unconfirmed`; **(b) `sentenceFor(actionType, outcome)`** — the wording, with a safe default for unknown action types. **The classification is exported rather than inlined in `index.js` specifically so it is unit-testable** — a Phase 2 review mandatory change. |
| `naavi-voice-server/test/outcome_report.test.js` | **Tests — NEW** | Unit coverage of **both** functions. Follows `test/list_confirm_gate.test.js`, the established precedent for testing a voice gate module. |

**No Edge Function changes. No database changes. No migration. No cron changes. No dependency
changes.**

### 2.1 The four edits, specifically

1. **`src/index.js:13407-13411`** — remove the fire-and-forget block.
2. **Before `stopMusic()` at `:13253`** — `const results = await Promise.allSettled(backgroundActions.map(...))` under the §2.3 timeout, then pass each settled result to `outcome_report.classifyResult()`. Anything not `success` produces a sentence via `sentenceFor()`, which replaces `finalSpeech` and sets `speechWasModified = true`. **`index.js` does no classification of its own** — it calls the module and acts on the answer.
3. **`src/index.js:12495-12500` and `:12509-12514`** — `LOG_CONCERN` and `UPDATE_PROFILE`: `await` the insert, inspect the result, route through the same module. Delete the unconditional "saved" log, which is itself an untrue statement in a log file.
4. **`src/index.js:13235-13236`** — the `else` branch keeps pushing to `backgroundActions`, but that bucket is now awaited-and-inspected. **The default becomes safe without every action needing its own branch.** This is what satisfies Phase 0's Success Criterion 3.

### 2.2 Complexity tax (AI Coding Discipline #23)

**Simpler alternative considered:** inline the failure sentences at the inspection site, adding no
module. **Ruled out** because the failure text would then live in one place while
`list_confirm_gate.js` and `action_rule_confirm_gate.js` keep theirs in another, and the next action
added gets a sentence only if someone remembers to write one. The module exists so the *default*
exists. It is one file with one exported function and a lookup table — the smallest thing that makes
the safe default real.

**Refactor over layer (#19):** no existing file does this job. `list_confirm_gate.js` gates
*before* execution; this reports *after* it. Extending it would give one file two unrelated jobs,
against #22.

### 2.3 Timeout — settled by Phase 2 review, mandatory change applied

**The await is timeout-bounded.** An unbounded await lets a hung Edge Function hold the call
silent-but-ticking indefinitely.

**Timeout is a third outcome class — `unconfirmed` — not success and not failure.**

**⭐ The wording this document originally proposed is withdrawn.** It read *"I've started that, I'll
confirm in a moment."* **That sentence promises a later confirmation that B11k does not build** —
there is no mechanism, in this change or anywhere else, that would deliver it. It is the same defect
in a new costume: a true-sounding statement about something that will not happen, spoken to a caller
who has no way to check. **Caught by the Phase 2 reviewer.** The fact that it survived being written
by the person who had just spent a phase documenting this exact failure mode is the argument for
external review, not against the plan.

**Direction, per the reviewer:** the sentence states only what is known — that completion could not
be confirmed. Reference shape: *"I couldn't confirm that completed."*

**Phase 3 approves the timeout duration and the exact wording.** Neither is fixed here.

---

## 3. Change Impact Matrix

Every row stated explicitly, per Phase 2's requirement.

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **No** | No file under `app/`, `hooks/` or `lib/` changes. Mobile's own instances of this defect (Phase 1A §2.2) are carried forward as a separate item, not touched here. |
| **Voice** | **Yes** | `src/index.js` and one new module. This is the whole change. |
| **Shared Core** | **No** | No Edge Function source changes. The fix inspects what Edge Functions already return; it does not alter what they return. |
| **Database** | **No** | No schema change, no migration, no RLS change. |
| **Cron** | **No** | No `cron.job` entry added, removed or altered. |
| **API contracts** | **No** | No request or response shape changes. `executeAction`'s existing return shapes are consumed, not redefined. |
| **Tests** | **Yes** | One new voice unit test file. Gate 2 (voice regression) must pass. See §6 for the Rule 15a position. |

**Duplicated capability — which implementations change?** Per Architecture Reference §5a Priority 1c
(added by this work item), outcome reporting has three implementations. **Only voice's changes.**
Mobile's is correct for the actions in B11k's scope. `naavi-chat`'s Step 1.4 is correct and is the
contract voice is being brought into line with. `naavi-chat`'s two raw inserts are defective and are
**explicitly out of scope**, carried as a separate item — stated here rather than left blank.

### 3.1 Mandatory Architecture Impact Checklist

| Question | Answer |
|---|---|
| Does this change modify Shared Core? | **No.** |
| Does this change modify an Entry Point? | **Yes** — the voice entry point, and in the direction §3 of the Reference asks for: less independent business logic, more faithful translation of what Shared Core returned. |
| Does this change introduce new duplication? | **No.** The new module is voice-local and has no counterpart elsewhere to drift from. |
| Does this change eliminate existing duplication? | **Partially.** It does not unify the three implementations. It brings voice's behaviour into line with the other two and consolidates voice's own scattered handling into one module. §5a's Priority 1c row stays open. |
| Does this change modify Protected Core? | **Yes** — five areas: Voice orchestration, Action Rules, Reminder Engine, Calendar integration, Notification routing. External review mandatory at Phase 3 and Phase 6. |

---

## 4. Regression Impact

Each item stated explicitly. Silence is not acceptable.

| Function | Affected? | Reasoning |
|---|---|---|
| **Voice commands** | **Yes — every state-changing one** | The whole point. Turn timing changes for the affected actions. |
| **Geofencing** | **No** | Mobile-only by nature (Reference §2). No voice path. |
| **Gmail integration** | **No** | Voice's live Gmail reads are not action-loop actions. |
| **Calendar integration** | **Yes** | `CREATE_EVENT` and `DELETE_EVENT` are both in scope. `DELETE_EVENT` will begin reporting the failure it already has (Phase 1 §5) — **expected, and correct, and will look like a new bug to anyone who has not read Phase 1.** |
| **Reminders** | **Yes** | `SET_REMINDER` and `SCHEDULE_MEDICATION` in scope. |
| **SMS / call alerts** | **Yes, indirectly** | `SET_ACTION_RULE` (weather / calendar / contact_silence) in scope. Fire-time behaviour is untouched; only rule *creation* reporting changes. |
| **Onboarding** | **No** | No onboarding path touches the action loop. |
| **Staging build** | **Yes** | Deploys to `naavi-voice-staging` via branch `staging`. |

### 4.1 Regression Matrix — consumer trace

Produced by search, not memory.

**`executeAction`** — `grep "executeAction("` over `src/index.js`: **9 sites**, one definition
(`:4516`) and 8 calls (`:3880`, `:10885`, `:10998`, `:11048`, `:12138`, `:12164`, `:12296`,
`:13408`). **Seven of the eight already `await`; only `:13408` does not.** The function is **not
exported** — `grep -rn "executeAction" src/ test/` outside `index.js` returns only three comment
references in `action_rule_confirm_gate.js`. **The consumer surface is one file.**

**The three existing gates must keep working and must not be duplicated:**

| Module | Covers | Interaction with this change |
|---|---|---|
| `list_confirm_gate.js` | six list actions | Gated *before* the `else`; never enters the bucket. Untouched. |
| `action_rule_confirm_gate.js` | `SET_ACTION_RULE` (time) | Same. Untouched. |
| B10q inline branch (`:12151-12175`) | `SET_EMAIL_ALERT`, `SET_ACTION_RULE` (email) | Already awaits and corrects. **Left exactly as-is in this phase** — folding it into the new module is a tempting cleanup and is forbidden by Phase 4's No Extra Changes Rule unless separately approved. |

**Deferral flows sharing the loop, all must survive:** `pendingDraft` (`:12123`), `pendingLocation`
(`:12533`), `pendingLocationCreate` (`:12786`), `pendingDeleteAll` / `pendingDelete`,
`pendingListAction`. **None enter `backgroundActions`** — verified by branch enumeration at Phase 1
§4. Untouched.

**`START_CALL_RECORDING`** is deliberately deferred to after speech (`:13411-13413`, so Naavi's own
confirmation is not captured in the recording). **It is not a background action and must stay after
dispatch.** Named explicitly because §2.1's relocation is adjacent to it.

---

## 5. Risk classification: HIGH

| Risk | Mitigation |
|---|---|
| Added turn latency on state-changing turns | Parallel `allSettled`, not serial. Tick already playing (§1.3). Precedent: `GLOBAL_SEARCH` awaited in the same loop today. Timeout bound proposed in §2.3. |
| A hung Edge Function holds the call | The §2.3 timeout, if approved. |
| Failure sentences are wrong or alarming for a real caller | Every sentence reviewed at Phase 3. Rule 12's readback shape is the model. |
| `DELETE_EVENT` starts announcing failure on every attempt | **Expected.** It is already failing 100% (Phase 1 §5). Sequencing depends on the separate correctness item landing first — Phase 1 decision 3. |
| Losing the pre-generated-audio fast path more often | Only on failure (§1.4). Failures should be rare once the correctness item lands. |

---

## 6. ⭐ Rule 15a — coverage gap, surfaced for explicit approval

**CLAUDE.md Rule 15a requires an auto-tester test in `tests/catalogue/*.ts`, registered in
`tests/runner.ts`, before this work is considered done.**

**The auto-tester cannot reach this code.** It lives in the mobile repo and exercises Supabase Edge
Functions over HTTP. The defect is control flow inside a Node process on Railway — no Edge Function
behaviour changes, so there is nothing for `test:auto` to assert against. This is Rule 15a's
"genuinely impossible" category, not its "hard" category.

**Substitute coverage — APPROVED by Phase 2 review, 2026-08-23, and recorded here as the Rule 15a
exception evidence:**

1. **`test/outcome_report.test.js`** — **expanded per a Phase 2 review mandatory change.** It must
   prove **both halves**, not just the wording:

   | Function | Must cover |
   |---|---|
   | `classifyResult()` — **the result classification contract** | a rejected promise → `failure`; `{ success: false }` → `failure`; a bare `{ error: ... }` with no `success` key → `failure`; a timeout → `unconfirmed`; a successful result → `success` |
   | `sentenceFor()` | each outcome class produces its sentence; **an unknown action type gets the safe default** — the Success-Criterion-3 guarantee, tested directly |

   **Why the reviewer required this:** the bare-`{error}` case is the exact shape that made the
   production `ADD_CONTACT` failure invisible (Phase 1 §3.2). Leaving the inspection logic proven
   only by a live call would mean the one branch this whole item exists to fix is the one branch
   nothing automated asserts.

2. **Gate 2, voice regression** — must pass.
3. **A live staging call by Wael with an action deliberately failed** — Phase 0's Completion
   Criterion 2, and the only test that has actually caught anything in this class. Every genuine
   defect found on 2026-08-21 came from a physical action, not from a suite.

**⭐ Rule 15a exception APPROVED by Wael, 2026-08-23**, on the condition that the work is implemented
and tested on **voice staging**. This is the explicit approval the rule requires; the reviewer's
verdict was the recommendation that preceded it.

**What "voice staging" means concretely, so nothing is assumed later:**

| | |
|---|---|
| Repository / branch | `munk2207/naavi-voice-server`, branch **`staging`** |
| Railway service | **`naavi-voice-staging`** (auto-deploys from `staging`) |
| Number to call for the live test | **+1 343 504 1572** — the staging line. **Not** +1 249 523 5394, which is production |
| Supabase project the test runs against | staging, `xugvnfudofuskxoknhve` |
| Deploy confirmation | `railway logs --service naavi-voice-staging` — from the running container, never inferred from the push (Architecture Reference §0d) |

**⚠️ One consequence of pushing to `staging`, recorded because it is easy to miss.** Per Architecture
Reference §0b, the **staging demo line** (`+1 873 446 2284`, Railway service
`generous-tenderness-production-9235`) deploys **the same `staging` branch**. A push for B11k lands
there too. It is not isolated from voice-staging and never has been; the two differ only by
environment variables. No action required — noted so a surprise on the demo staging line during
B11k testing is recognised rather than investigated from scratch.

**Production is untouched by this approval.** Promotion is a separate decision after Wael validates
on a staging call, and per §0b that promotion is simultaneously a release of the public
1-888-91-NAAVI demo line.

---

## 7. Status

**External review, 2026-08-23: APPROVED WITH MANDATORY CHANGES.** Both are applied, and nothing else
was changed under that authorization (§13 — *"only the listed mandatory changes may be performed"*):

| # | Mandatory change | Applied in |
|---|---|---|
| 1 | Bound the await; reject *"started, will confirm"*; timeout is a third class, `unconfirmed`, with wording that states only what is known | §2.3, §2.1 edit 2, §2 file table |
| 2 | Unit tests must prove the **result classification contract** — rejection, `{success:false}`, bare `{error}`, timeout, success — not only the wording | §6.1, and §2's file table, where classification became an exported function specifically so it is testable |

**Rule 15a exception: approved by the reviewer, recorded as exception evidence in §6. Wael's own
explicit approval still required** — a reviewer's verdict is not the authorization the rule asks for.

**Still open, deliberately, for Phase 3:** the timeout **duration** and the **exact wording** of every
sentence. Phase 3 is the external technical review of this plan and is mandatory — Protected Core,
HIGH risk.

Per governance §3's Phase-Gate Approval Rule, Phase 3 does not begin — including drafting its
document — until Wael's own explicit word for the 2 → 3 transition.
