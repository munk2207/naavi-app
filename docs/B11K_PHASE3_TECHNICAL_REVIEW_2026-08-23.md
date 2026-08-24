# B11k — Phase 3: Technical Review (Before Coding)

**Work item:** [[B11k]]
**Date:** 2026-08-23
**Phase 2:** APPROVED WITH MANDATORY CHANGES (both applied)
**Risk:** HIGH · **Protected Core** — external review mandatory
**Architecture Reference:** 2026.07.18.10
**Target:** `naavi-voice-server` branch `staging` → Railway `naavi-voice-staging`. Rule 15a exception approved by Wael 2026-08-23.
**No code written.**

This document is the submission for external technical review. It settles the two items Phase 2 left
open — **the timeout duration** and **the exact wording** — and closes with Implementation Boundaries
and Deferred Architectural Decisions.

---

## 1. Timeout duration: **5000 ms**

Chosen from precedent in this file, not preference.

| Site | Value | What it bounds |
|---|---|---|
| `src/index.js:66` | **5000 ms** | `_delGateMirror` — an outbound POST to Supabase |
| `src/index.js:2780` | **5000 ms** | auth call |
| `src/index.js:2802` | 8000 ms | ticket creation — a heavier, multi-step operation |

**5000 ms is the house value for "one outbound POST to Supabase," which is exactly what every action
in scope is.** 8000 ms belongs to a heavier operation and is not the comparable case.

**⭐ And the 5-second precedent was set by this same lesson, in this same file.** The comment at
`src/index.js:62-65`, Wael 2026-05-13:

> *"Synchronous mirror. The prior **fire-and-forget POST dropped entries under network stress** —
> that's why traces were incomplete. **await + 5s timeout** so we either see it land or see the error
> in console."*

A fire-and-forget POST was converted to await-with-a-5-second-bound because its silent failures were
invisible. **That is B11k's fix, applied to the diagnostic mirror fifteen months before B11k was
opened** — and it is a *fifth* encounter with this class, after 2026-05-12, 2026-07-06 (deferred),
2026-07-15 and 2026-07-21. B11k should adopt the value that decision already established rather than
introduce a sixth number.

**Applied as a bound on the whole `allSettled`, not per action** — actions run in parallel, so the
turn's added latency is capped at 5 s total regardless of how many actions the turn carries.

---

## 2. Exact wording

### 2.1 The rule the wording must satisfy

CLAUDE.md's outbound-message rule governs this: these sentences are spoken to a real caller.

- **No invented cause.** Naavi does not know *why* the write failed and must not guess.
- **Never accuse the user.** No *"you're not connected"*, no *"you didn't…"*.
- **Prefer the action over the diagnosis** — say what to do, not why it broke.
- **Short.** This is heard once, on a phone, possibly by someone driving.

### 2.2 Structure — one frame per outcome class, one phrase per action

`sentenceFor(actionType, outcome)` composes a frame with a per-action phrase. **A new action type
with no phrase registered gets the default phrase, not silence** — this is the Success-Criterion-3
guarantee.

| Outcome | Frame |
|---|---|
| `success` — **every** action in the turn succeeded | *(no sentence — `finalSpeech` is left exactly as composed)* |
| `success` — **within a turn that also had a failure** | **"I did {phrase}."** — used only when rebuilding a mixed-outcome reply, see §2.4 |
| `failure` | **"I wasn't able to {phrase}. Please try again."** |
| `unconfirmed` | **"I couldn't confirm that went through — you may want to check."** |

**The second row is a Phase 3 review consequence**, not part of the original design. Rebuilding a
mixed-outcome reply from verified outcomes (§2.4) means the successful half needs its own verified
sentence, because the original speech can no longer be used to carry it.

**The `unconfirmed` frame deliberately promises nothing.** Phase 2's withdrawn wording implied a
follow-up confirmation that does not exist. This states only what is known and suggests an action the
caller can actually take.

### 2.3 The phrase table

| Action | `{phrase}` |
|---|---|
| `ADD_CONTACT` | save that contact |
| `CREATE_EVENT` | add that to your calendar |
| `DELETE_EVENT` | delete that event |
| `DELETE_MEMORY` | remove that |
| `REMEMBER` | save that |
| `SAVE_TO_DRIVE` | save that to your Drive |
| `SCHEDULE_MEDICATION` | set up that medication schedule |
| `SET_REMINDER` | set that reminder |
| `UPDATE_MORNING_CALL` | change your morning call |
| `SET_ACTION_RULE` (weather / calendar / contact_silence) | set that alert |
| `LOG_CONCERN` | make a note of that |
| `UPDATE_PROFILE` | save that preference |
| **default — any unregistered type** | **do that** |

**⭐ `DRIVE_SEARCH` and `LIST_CONNECTION_QUERY` have no entry — mandatory change #2 from the Phase 3
review.** They had bespoke phrases in the submitted draft and no longer do.

**Why the two options the reviewer offered turn out to be the same thing.** The reviewer said keep
their reporting *generic*, or preferably *exclude them from the state-changing phrase table*. Under
this design those converge: no table entry **is** the generic path, because an unregistered type
falls to the default phrase by construction. So both are satisfied by one change — remove the rows.

**And Phase 1's decision 2 still holds.** They remain in scope in the only sense that mattered: they
stop being silently discarded, and a failure reaches the caller. What they lose is bespoke wording
they should never have had, since B11k is a state-changing-outcome table and these are read-only.
**Surfacing their result content stays excluded** (§4.5), unchanged.

### 2.4 Two composition questions, proposed rather than assumed

**(a) Mixed outcomes — SETTLED by the Phase 3 review, and the submitted proposal was wrong.**

The draft proposed: replace `finalSpeech` when every action failed, **append** when the outcome is
mixed, so the successful half survives. **The reviewer rejected appending, and the reasoning is
decisive:**

> *"That speech may contain success claims for actions that actually failed, so appending can
> preserve the exact false statement B11k exists to eliminate."*

**Worked example.** Caller says *"add Sarah's birthday to my calendar and remind me to buy a card."*
Claude composes *"I've added Sarah's birthday and set a reminder to buy a card."* The reminder write
fails. Appending yields:

> *"I've added Sarah's birthday and set a reminder to buy a card. I wasn't able to set that reminder.
> Please try again."*

The false claim is still in there, now contradicted by the sentence after it. **Appending does not
remove a lie; it argues with one.**

**The mandated design:** if **any** action in the turn returns `failure` or `unconfirmed`, the
original `finalSpeech` is **discarded entirely** and the action-outcome reply is **constructed from
verified outcomes only** — successes acknowledged with the `success`-within-mixed frame (§2.2),
failures and unconfirmed from `outcome_report`. **Claude's optimistic claims never survive a turn
that contained a failure.**

The same example becomes:

> *"I did add Sarah's birthday to your calendar. I wasn't able to set that reminder. Please try
> again."*

Every clause traceable to a settled result. **When all actions succeed, `finalSpeech` is untouched**
— so the common path, and the pre-generated-audio fast path with it, is unchanged.

**(b) Two or more failures in one turn — APPROVED as proposed.**

Join up to two sentences; beyond that, one summary — *"A few of those didn't go through. Please try
again."* Three failure sentences in a row is unintelligible on a phone, and a caller who has heard
two failures already knows the turn did not work.

---

## 3. Non-Determinism Rule — does not apply

Phase 3's Non-Determinism Rule governs changes to a Claude/Haiku classifier prompt or system prompt,
requiring 3+ trials per positive-control case.

**B11k changes no prompt.** `get-naavi-prompt` is untouched, `buildVoiceSystemPrompt` is untouched,
and no classifier input or instruction changes. The sentences in §2 are emitted by JavaScript, not by
Claude, so they are deterministic by construction. **Stated explicitly rather than omitted**, per §15's
rejection condition for single-trial evidence on classifier changes — the rule is inapplicable, not
skipped.

---

## 4. Implementation Boundaries Confirmed

Stated plainly so Phase 4 has a boundary to implement against and Phase 6 has one to audit against.

### 4.1 Authorized files, and the specific change in each

| File | Authorized change |
|---|---|
| `naavi-voice-server/src/outcome_report.js` **(new)** | Three exported functions: `classifyResult(settled)` → `success` \| `failure` \| `unconfirmed`; `sentenceFor(actionType, outcome)` → the §2 wording, with the default phrase for unregistered types; **`composeTurnSpeech(originalSpeech, outcomes)`** → returns `originalSpeech` unchanged when every outcome is `success`, otherwise **builds the reply from verified outcomes only** and applies §2.4(b)'s two-failure cap. No other exports. **The third function is a Phase 3 review consequence** — it is where "the original speech must not survive a failed turn" is enforced, and putting it in the module means the rule is unit-testable rather than living inline in `index.js`. |
| `naavi-voice-server/test/outcome_report.test.js` **(new)** | Unit coverage of all three functions: every classification branch required by Phase 2's mandatory change #2 (rejection, `{success:false}`, bare `{error}`, timeout, success), the unknown-action-type default, and — **added by the Phase 3 review** — that `composeTurnSpeech` returns the original speech when all succeed, and that **no fragment of the original speech survives** when any outcome is `failure` or `unconfirmed`, including the mixed case. |
| `naavi-voice-server/src/index.js` | **Four edits only:** (1) delete the fire-and-forget block at `:13407-13411`; (2) insert an awaited, 5-s-bounded `Promise.allSettled` over `backgroundActions` before `stopMusic()` at `:13253`, routing each settled result through `outcome_report`; (3) convert `LOG_CONCERN` (`:12495-12500`) and `UPDATE_PROFILE` (`:12509-12514`) to awaited-and-inspected through the same module, deleting their unconditional "saved" logs; (4) no change to the `else` at `:13235-13236` itself — it becomes safe because the bucket it feeds is now awaited. |

### 4.2 No additional files are approved

Beyond the three above, nothing. No Edge Function, no migration, no mobile file, no configuration.

### 4.3 No opportunistic refactoring is approved

Specifically named because each is tempting and adjacent:

- **Do not** fold B10q's inline branch (`:12151-12175`) into `outcome_report`, even though it does
  the same job.
- **Do not** fold `list_confirm_gate.js` or `action_rule_confirm_gate.js` into it.
- **Do not** tidy `executeAction`'s inconsistent return shapes — some return `{success:false,error}`,
  some a bare `{error}`. `classifyResult` must **handle** that inconsistency; normalising it is a
  different change with a different blast radius.

### 4.4 No architectural changes are approved beyond the plan

Ownership does not move. Nothing moves into or out of Shared Core. §5a's Priority 1c row stays open —
this item brings voice into line with the other two implementations; it does not unify them.

### 4.5 Explicitly excluded from this authorization

| Excluded | Where it lives instead |
|---|---|
| `DELETE_EVENT`'s missing `user_id` | Separate correctness item, to land **before** B11k's implementation (Phase 1 decision 3) |
| `DELETE_MEMORY`'s zero-match-returns-success | Same separate correctness item |
| `naavi-chat`'s two raw `action_rules` inserts | Separate item (Phase 1A §4.3) |
| Mobile's `LOG_CONCERN` / `UPDATE_PROFILE`, and `handleDeleteEventExec`'s zero-match | Same separate correctness item |
| **Surfacing `DRIVE_SEARCH` / `LIST_CONNECTION_QUERY` result content to the caller** | **Out.** They gain failure reporting here; speaking their *results* is a feature, not a truthfulness fix |
| Production promotion | Separate decision after Wael's staging call; also a demo-line release (Reference §0b) |

---

## 5. Deferred Architectural Decisions

Recorded so a future session recognises these as considered and set aside, not as fresh ideas.

1. **Unifying the three implementations of outcome reporting.** Not approved. Voice, mobile and
   `naavi-chat` would need one shared contract across two runtimes and two repositories. **Revisit
   when:** a fourth implementation appears, or the §5a Priority 1c row reaches its review date.
2. **Consolidating voice's four confirmation/reporting mechanisms** (the two gates, B10q's branch,
   and the new module) into one. Not approved — it would put a large refactor of working, separately
   -reviewed code inside a defect fix. **Revisit when:** a fifth mechanism is proposed, which is the
   point at which "four is fine" stops being true.
3. **Normalising `executeAction`'s return shapes.** Not approved — see §4.3. **Revisit when:** a
   change needs the shape itself, rather than needing to read around it.
4. **Making `classifyResult` the single reader of action results across all 8 `executeAction` call
   sites.** Not approved; only the background bucket is in scope. **Revisit when:** the consolidation
   in item 2 is taken up.

---

## 6. Review outcome

**External review, 2026-08-23: APPROVED WITH MANDATORY CHANGES.** Both applied; nothing else changed
under that authorization (§13 — *"only the listed mandatory changes may be performed"*).

| # | Mandatory change | Applied in |
|---|---|---|
| 1 | `DRIVE_SEARCH` / `LIST_CONNECTION_QUERY` get no action-specific phrases — generic, or excluded from the state-changing table | §2.3 — rows removed; they fall to the default phrase, which is both options at once |
| 2 | Never append to, or preserve, Claude's original speech when any outcome is failure/unconfirmed — rebuild the reply from verified outcomes | §2.4(a), plus §2.2's new frame, plus `composeTurnSpeech` in §4.1 and its tests |

**Approved as submitted:** 5000 ms bounded across the whole parallel batch (§1); the remaining
phrases (§2.3); the two-failure cap (§2.4b); and the Implementation Boundaries (§4), *"in particular,
do not consolidate B10q or the existing confirmation gates during B11k."*

### 6.1 Claude Implementation Handoff (§14)

- **Decision:** Approved with Mandatory Changes — both now applied.
- **Mandatory changes:** the two above. Nothing beyond this list may be performed.
- **Architecture requirements:** stay inside the voice entry point; no Shared Core change; ownership
  unmoved; §5a Priority 1c stays open.
- **Regression requirements:** Phase 2 §4.1's consumer trace — `executeAction`'s 8 call sites (7
  already awaited), the three existing gates untouched, every `pending*` deferral flow untouched,
  `START_CALL_RECORDING` stays after dispatch.
- **Scope restrictions:** Phase 0 as amended at Phase 1; §4.5's exclusions.
- **Verification checklist for Phase 5:** unit tests green across all three functions and every
  classification branch; voice regression green; a live staging call on **+1 343 504 1572** with an
  action deliberately failed; evidence that no fragment of the original speech survives a failed turn.
- **The standing instruction, in the reviewer's words:** *"Never preserve or append to unverified
  action-success claims when any outcome is failure/unconfirmed."*

**Per governance §3's Phase-Gate Approval Rule, Phase 4 does not begin — including writing any code —
until Wael's own explicit word for the 3 → 4 transition.**
