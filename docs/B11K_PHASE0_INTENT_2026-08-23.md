# B11k — Phase 0: Intent Approval

**Work item:** [[B11k]] — Naavi tells a caller an action succeeded when it failed; every background voice action can fail silently
**Date:** 2026-08-23
**Scope:** **VOICE ONLY** — proposed, see Out of Scope. Mobile is the reference implementation, not a target.
**Governance:** Full Phase 1–8 (Protected Core — Voice orchestration, Action Rules, Reminder Engine, Calendar integration, Notification routing)
**Architecture Reference version at drafting:** 2026.07.18.9
**Risk:** HIGH
**Status:** **APPROVED** — Wael, 2026-08-23. **Scope locked: Option 1 — all twelve state-changing background actions, with a structural solution that makes correct outcome handling the default.**

> External review (ChatGPT), 2026-08-23: Approved, Option 1. Reasoning as recorded: B11k is a class
> defect; fixing only the destructive actions, or individually gating today's twelve, would leave the
> unsafe default able to reproduce the same defect for future actions. No implementation mechanism
> approved at Phase 0.

**This approval covers Phase 0 and the Phase 0→1 transition, given by Wael directly.** No mechanism
is approved. Per governance §3, Phase 2 does not begin — including drafting the Phase 2 document —
until Wael gives his own separate word for that transition.

---

## Why this Phase 0 exists

**Naavi speaks before she acts, and the outcome reaches a log line and nothing else.**

Verified directly, 2026-08-23, on `naavi-voice-server` branch `main`:

```
src/index.js:13406    // Execute remaining actions in background AFTER speaking
src/index.js:13407    Promise.all(backgroundActions.map(a => executeAction(a, userId))).catch(err => {
src/index.js:13408      console.error('[Process] Background action error:', err.message);
```

Not awaited. Result discarded. The speech has already been dispatched to TTS by the time this
line runs, so **the outcome does not exist when Naavi commits to what she says.**

**Background is the default branch, not an opt-in** (`src/index.js:13236`):

```
} else {
  backgroundActions.push(action);
}
```

Anything not explicitly gated falls into it.

**Found by Wael on a phone, 2026-08-21, during the T12 equilibrium test — and it nearly cost that
test its answer.** He asked both lines to add a contact, heard what sounded like success on both,
and reported it worked on both platforms. Staging had created the contact. Production had created
nothing. The logs settled it — staging `{ success: true, resourceName: ... }`, production
`{ error: 'No user found' }`. **Nothing at the user surface distinguished a success from a total
failure.**

**Gated today (safe):** `DELETE_RULE`, the six list actions via `list_confirm_gate.js`, and
`SET_ACTION_RULE` **only** when `trigger_type === 'time'`.

**Background, state-changing, therefore able to lie — twelve:** `ADD_CONTACT` (confirmed live),
`DELETE_EVENT`, `DELETE_MEMORY`, `SET_REMINDER`, `SET_EMAIL_ALERT`, `SET_ACTION_RULE` for every
trigger except time (location, email, weather, calendar, contact_silence), `CREATE_EVENT`,
`SCHEDULE_MEDICATION`, `REMEMBER`, `SAVE_TO_DRIVE`, `UPDATE_MORNING_CALL`, `DRAFT_MESSAGE`.

**The two that should decide priority: `DELETE_EVENT` and `DELETE_MEMORY`.** Destructive, ungated,
silent. Naavi can say something is deleted when it is not — and unlike a missing contact, there is
no artifact left behind to notice later. The user finds out by tripping over the thing they believed
was gone.

**This exact defect has been found and fixed twice, each time only for whatever action was in front
of someone** — the list confirm gate (Wael, 2026-05-12) and the time-trigger gate (F19 Track B-1e,
2026-07-15). `action_rule_confirm_gate.js` names the cause in its own comment: *"fire-before-confirm
+ discarded result."* Nobody generalised it, so eleven more actions still carry it. **Two narrow
fixes to one general defect is the signature of a class that needs solving once.**

**A standing rule has been unenforceable on voice since it was written.** CLAUDE.md Rule 12 requires
a post-action readback — *"Done. [specific commitment that was just implemented]"* — explicitly as
the **second** defence layer, so a user can catch a mis-resolution or a failure. That readback is
**structurally impossible** for a background action, because the action has not run when Naavi
speaks. This item is not only a bug fix; it restores enforceability of Rule 12 on voice.

**Mobile does the opposite and has for months.** It awaits each action, catches the failure, and
rewrites what Naavi says before the user ever sees it — 21 catch blocks in the
`hooks/useOrchestrator.ts` action loop. One of them describes the voice bug exactly
(`useOrchestrator.ts:2557`, V57.8): *"override Naavi's speech to be truthful about the failure.
Otherwise the speech still says 'I've added it' and the user thinks the event was created."*
Corroborated by Wael from use rather than from code, 2026-08-21: *"that is what I expected, I never
saw that in mobile."*

**Voice has been telling callers things that were not true for as long as mobile has been telling
users the truth.**

---

## User Intent

When Naavi tells a caller on the phone that something was done, it was done. If it failed, she says
so on that call, in terms the caller can act on — rather than reporting success and leaving the
failure in a log nobody reads.

---

## Success Criteria

1. **No state-changing voice action can report success without its outcome being known.** For every
   action in scope, what Naavi says is determined by what actually happened.
2. **A failure is audible to the caller during the call** — not silent, not deferred to a log.
3. **The fix is structural, not per-action.** A thirteenth action added later inherits the correct
   behaviour by default rather than by someone remembering. The current default is the unsafe branch;
   after this item it must not be.
4. **Rule 12's readback becomes possible on voice** for the actions in scope.
5. **The call does not regress** — no dead air (CLAUDE.md "VOICE CALL — NO SILENCE ALLOWED"), and no
   latency increase Wael judges unacceptable on a live call.

---

## In Scope

- The twelve background state-changing actions listed above.
- The branch structure at `src/index.js:13236` and the execution site at `13407-13408` — including
  changing which branch is the default.
- Whatever Naavi says on failure, for those actions.
- Tracing the five read-only actions (`GLOBAL_SEARCH`, `LIST_READ`, `DRIVE_SEARCH`,
  `FETCH_TRAVEL_TIME`, `LIST_CONNECTION_QUERY`) **to determine whether they also route through the
  background branch.** The holding list records this as never traced. Determining it is in scope;
  changing their behaviour is not, unless the trace shows they are affected — in which case it
  returns here as an amendment rather than being absorbed silently.
- The auto-tester coverage Rule 15a requires.
- The Architecture Reference update, if the outcome changes what §3 says about voice entry-point
  responsibilities.

## Out of Scope

- **Mobile.** Established 2026-08-21 as behaving correctly, and it is the reference implementation
  this item learns from. Not investigated, not modified.

  **The constraint that survives the exclusion:** if the fix touches any shared Edge Function or
  `get-naavi-prompt`, that function's other consumers must be regression-tested per Rule 0.5 and
  Phase 2's Regression Matrix. Phase 1 must establish whether any such change is needed at all — the
  defect as read is voice-side control flow, but that is a Phase 1 finding, not a Phase 0 assumption.

- **[[B11j]]** — why voice `ADD_CONTACT` failed. B11k is why the caller could not tell. Fixing B11j
  removes one failure; it does not make any other failure visible. **They must not be merged.**
- **The three already-gated paths** (`DELETE_RULE`, the six list actions, time-trigger
  `SET_ACTION_RULE`). They work. This item does not re-litigate their design — though Phase 2 may
  propose reusing their mechanism.
- **Voice latency in general** ([[project_naavi_latency_issues]]). Any latency this fix *adds* is in
  scope as a constraint; the pre-existing ~20s baseline is not this item's to solve.
- **Promotion to production.** Staging first, per CLAUDE.md. Production promotion is a separate
  decision after Wael validates on a staging call, and it is also a demo-line release (Architecture
  Reference §0b).

## Constraints

- **Protected Core, five areas.** External review mandatory at Phase 3 and Phase 6. The twelve
  actions span Voice orchestration, Action Rules, Reminder Engine, Calendar integration and
  Notification routing — Phase 2's Change Impact Matrix must state a verdict for every row.
- **Staging branch only** (`naavi-voice-server` branch `staging` → Railway `naavi-voice-staging`).
- **No dead air.** Any design that waits before speaking must keep the tick sound running. CLAUDE.md
  names this a core UX requirement, not a nice-to-have.
- **Real-time speech.** Voice cannot copy mobile verbatim. Mobile can take as long as it likes before
  rendering a bubble; a phone call cannot. This is the central design tension and it belongs to
  Phase 2.
- **If the fix changes what Naavi says via `get-naavi-prompt`**, three consequences follow: it is
  Shared Core, it is per-environment (so a staging deploy leaves production behind — the B11h
  mechanism), and Phase 3's Non-Determinism Rule applies, requiring a minimum of 3 independent
  trials per positive-control case.
- **Rule 15a** — the regression test exists, is registered, and passes before this item is done.

## Completion Criteria

1. Every action in scope has its outcome known before Naavi commits to words about it, or has
   Naavi correct herself on the same call — per whichever design Phase 2 approves.
2. A deliberately-failed action produces an audible, accurate failure on a live staging call.
   **Wael's own live call is the ground-truth test** — the holding list's closing note is that every
   genuine defect found on 2026-08-21 came from him doing something physical, and none came from the
   tests, the gates, or the reviews.
3. The default branch at `13236` is the safe one; a new action inherits correct behaviour.
4. Auto-tester test written, registered, green.
5. `npm run test:auto` green against a confirmed environment, and voice regression green.
6. Architecture Reference updated in this same work item if voice's entry-point behaviour changed.

---

## What Phase 0 deliberately does not decide

**The mechanism.** The open design question, stated in the holding list and not answered here:

> Does voice **await** state-changing actions before committing to words, or does it **speak and
> then correct**?

Both are defensible. Awaiting is truthful by construction but adds latency to a live conversation.
Speak-then-correct keeps the conversation fast but means Naavi says a wrong thing first and takes it
back — which on a phone call may be worse than a pause. A third option is to split by action:
await the destructive ones, background the rest.

**This is a Phase 2 decision.** Naming it here would prescribe an implementation before Phase 1 has
investigated, which is what Phase 0 exists to prevent.

---

## The one scope decision that needs your answer

How many of the twelve are in scope?

1. **All twelve, fixed structurally by changing the default branch.**
2. **`DELETE_EVENT` and `DELETE_MEMORY` only** — the two destructive ones, gated individually now,
   the other ten deferred.
3. **All twelve, but gated individually** rather than by changing the default.

**Recommend #1**, and the reason is this item's own history rather than a preference. Option 2 is
exactly what was done in May 2026 and again in July 2026 — fix the action in front of you, leave the
class. Both times it was correct, shipped, and left the defect intact for everything else; that is
how eleven actions still carry it today. Option 3 fixes all twelve but leaves the default unsafe, so
action thirteen re-enters the same trap the moment someone adds it. Only option 1 satisfies Success
Criterion 3, and Success Criterion 3 is the difference between closing B11k and scheduling B11k's
successor.

**Cost of the recommendation, stated honestly:** option 1 has the largest blast radius of the three.
It changes behaviour for twelve actions across five Protected Core areas at once, on the surface
where a mistake is heard live by a real caller with no undo. Option 2 is genuinely the lower-risk
change to make — it is just not a fix for what B11k is.

---

## Required output

Approve, approve with changes, or reject — and answer the scope question above.

Per governance §3's Phase-Gate Approval Rule, no work begins — including drafting Phase 1 — until
Wael's own explicit go-ahead for that specific transition.
