# Session handoff — 2026-08-21 evening → 2026-08-23 early morning

**Next session is [[B11k]].** Wael's instruction, given at the close of this one. Everything needed to
start is in §1. Read that first; the rest is context.

**A standing instruction from this session, worth applying to this document too.** Wael's first words
here were *"Ignore all the recommendations in the handoff."* He was right to say it — the previous
handoff's recommendations had not been verified and one of them (the "7-day OAuth" theory) was wrong.
**So this document records facts, decisions and open questions. Where it recommends, it says so
explicitly and you should verify before acting.**

---

## 1. B11k — Naavi tells a caller an action succeeded when it failed

**What it means, in one line:** on a phone call Naavi says an action worked before she has any idea
whether it did, and if it failed she still says it worked and the caller never finds out.

**The mechanism, which IS the item — this is structural, not Naavi being optimistic:**

```
naavi-voice-server/src/index.js:13407-13408
    Promise.all(backgroundActions...).catch()   ← not awaited, result discarded
```

The speech is dispatched to TTS at `step=turn-exit-before-tts`, and the action executes **after**.
So the outcome does not exist when Naavi commits to what she says, and when it does exist it reaches
a log line and nothing else. **Silent failure is guaranteed by construction.**

**Caught live 2026-08-21**, in the production log, during T12's own equilibrium test:

```
[DELETE-GATE] user_message="Yes."  final_speech="Saved."  action_types=["ADD_CONTACT"]
[GATE-CRITICAL] step=turn-exit-before-tts  final_speech="Saved."  bg_action_count=1
[Action] Executing: ADD_CONTACT
[Action] ADD_CONTACT result: { error: 'Token refresh failed: invalid_grant' }
```

**Twelve state-changing actions are exposed.** Gated and safe: `DELETE_RULE`, the six list actions,
and `SET_ACTION_RULE` **only** when `trigger_type === 'time'`. Everything else falls into the
background branch (`src/index.js:13236`) — including **`DELETE_EVENT` and `DELETE_MEMORY`, which are
destructive, ungated and silent.** Unlike a missing contact those leave no artifact; the user finds
out by tripping over the thing they believed was gone.

**⭐ A reference implementation already exists — the fix does not need designing from scratch.**
Mobile does the opposite and has for months: it **awaits** each action, catches the failure, and
**rewrites what Naavi says** before the user sees it. There are 21 such catch blocks in
`hooks/useOrchestrator.ts`. One of them describes the voice bug exactly, written in V57.8:

> *"override Naavi's speech to be truthful about the failure. Otherwise the speech still says 'I've
> added it' and the user thinks the event was created."*

Wael corroborated it from use rather than code: *"that is what I expected, I never saw that in
mobile."*

**⭐ The pattern, which is why this is bigger than any one action.** This same defect has been found
and fixed **twice**, each time only for whatever action happened to be in front of someone — the list
confirm gate (Wael, 2026-05-12) and the time-trigger gate (F19 Track B-1e, 2026-07-15).
`action_rule_confirm_gate.js` names the cause in its own comment: *"fire-before-confirm + discarded
result."* **Nobody generalised it, so eleven more actions still carry it.** Two narrow fixes to one
general defect is the signature of a class that needs solving once.

**Relationship to CLAUDE.md Rule 12, which is not cosmetic.** Rule 12 requires a post-action readback
— *"Done. [the specific commitment that was just implemented]"* — explicitly as the **second** defence
layer. **That readback is structurally impossible for a background action**, because the action has
not run when Naavi speaks. Rule 12 has therefore been unenforceable on voice for these twelve actions
since it was written.

**Do not merge with [[B11j]].** B11j is *why* voice ADD_CONTACT failed. B11k is *why the caller could
not tell.* Fixing B11j removed one failure; it made no other failure visible.

**Governance: Full Phase 1-8** — Voice orchestration, Protected Core. No Phase 0 written.

---

## 2. What closed

**[[T12]] — CLOSED**, full Phase 0-8, externally reviewed at Phases 3 and 6, Wael approving every
transition. Record: `docs/T12_PHASE8_MERGE_2026-08-22.md`.

**The acceptance measurement was re-run at close**, not quoted from Phase 5, because Phase 6 made
preserving it a hard condition:

```
parity:verify — identical 32   DIFFERENT 0   one-sided 0   baseline {} empty
```

**The equilibrium test passed on the criterion Wael committed before the promotion existed**
(`c3d6b5e`): a contact bearing the exact digits dictated. It does not establish that staging predicts
production for *every* change — one instance is one instance. It establishes that the loop **can**
close, which had never been demonstrated in this project.

**Phase 7: four checks passed, one closed by Wael's Governance §3 decision** — the demo-line "stop"
check, on the grounds that it costs a permanent opt-out and *"if it is broken it is OK, if it works,
let someone else stop."* Three of its four links were verified without a call; the spoken-word half
is unproven. **Do not re-raise it.**

**What T12 does NOT establish, recorded so the closure is not read as broader than it is:**
`ingest-ticket` and `send-user-email` were redeployed and **never exercised**; equilibrium is proven
for 32 functions on one date, not continuously; and **neither parity tool can see code deployed to
both projects and committed to neither** — T12 found two live instances of exactly that, one of them
**on production, serving real users**.

---

## 3. The holding list was rebuilt — read this before working from it

**It had ~50 items and Wael could not tell which mattered:** *"B11k is hidden in the long list, but it
is top priority."*

**Now: a priority list of five at the top, capped and enforced.**

| | |
|---|---|
| `B11k` | Naavi says an action worked before she knows whether it did |
| `B11l` | "text me" reaches a stranger, and the card calls him "me" |
| `B4z` | she asks permission for some changes and not others |
| `T6` | any signed-in user can read every user's medical rows |
| `B10m` | a whole call where she hears nothing at all |

**Three rules, all mechanically enforced rather than remembered:**

1. **Items MOVE, never copy.** A row lives in the priority table or the general list, never both.
   That is what killed the old queue — it described every item twice and the copies drifted. A test
   asserts no ID appears in two rows.
2. **Maximum 5.** `scripts/priority-cap-check.js` refuses a push at six. Adding a sixth requires
   deciding what stops being important — *"this will force us in cleaning and closing items."*
3. **Position is priority.** No P0/P1 labels, no tier numbers, nothing to keep in sync.

**Every open item now opens with a plain-English paragraph** headed **What it means:**, technical
record underneath. The rule already existed in memory as
`feedback_classification_notes_plain_functional` and was not being followed.

**The old 76-line queue is archived verbatim at the foot of the document**, not deleted (Wael: *"I
personally do not like to delete anything"*). Read it for reasoning recorded nowhere else. **Do not
read it for status** — nine of its items were already closed.

---

## 4. Two new gates, both of which found real things immediately

**`scripts/priority-cap-check.js`** — refuses a push at six priority items.

**`scripts/orphan-item-check.js`** — refuses a push when an item is written about but has no row.
**It found four on its first run:** `T3` (ranked Tier 1, referenced by the Architecture Reference
twice, in no table), `B4z` (cited **eight times inside the shared Claude prompt**, tracked nowhere),
`S1` (**a P0 security item**, no row before or after it closed), and `B10x` (ranked P1, no row). All
four now have rows.

**⭐ The design decision worth keeping.** The noise floor was measured *before* the gate was written.
Scanning every bare mention produced **216 orphans** — and revealed a second holding-list file,
`HOLDING_LIST_CLOSED_ARCHIVE_2026-07-28.md`, that had gone unnoticed all session. Reading both files
and requiring the `[[wiki-link]]` form took 216 → 2, both real. **A gate that cries wolf gets switched
off, and the absence is then invisible.**

**⭐ It then failed on its own first test run** — it walked into a nested checkout, read a *copy* of
the holding list as an ordinary document, and reported five false orphans. Fixed generally: any
directory carrying its own `.git` is skipped whole. **That failure is the argument for running tests
rather than reasoning about them** — it had been verified by hand in both directions and looked
correct.

**Five gates now run on every push:** priority cap · orphan items · schema drift · schema/code · voice
Edge Function parity.

**Nine tests written this session, nine run, nine passing** — against STAGING, banner-confirmed.
**Not the full 595**, and deliberately so: no product code was touched, so there was nothing for the
rest of the suite to catch. Wael's call, and correct.

---

## 5. Decisions Wael made — do not re-raise these

| Decision | |
|---|---|
| **The `+1 343 333 2567` shared-number claim** | Deleted from CLAUDE.md entirely, and its inference stripped from the S2 row. It had been written in hazard voice — *"THE ONE THAT WILL CATCH YOU… suspect this before suspecting the feature"* — inside the file every session loads, which turned a future design item into a live constraint. He has used that number across ten YouTube videos without issue |
| **The outbound-guard "finding"** | `send-email` and `send-drive-file` have no allowlist. **Assessed and closed, not a gap.** Staging is contained by **controlled data**, not the guard — all 34 staging sends ever recorded went to controlled destinations. *"Where is the risk in a world that we receive hundreds of spam emails daily… it does not justify"* |
| **The "Known and accepted" split** | Considered and rejected. The cap already solves it, and labelling unscheduled defects "accepted" would dress an absence of scheduling up as a decision |
| **Phase 4 has no document** | Correct and by design — Phase 4 is implementation, Phase 5 is its record. Not a governance gap |
| **Demo-line "stop" check** | Closed on partial evidence, §2 above |

---

## 6. Claims Claude made this session that were wrong

Recorded because the corrections came from Wael knowing the real state, or from measurement, not from
any check.

1. **"Every Google token dies at exactly 7 days"** — presented as a measured boundary across eight
   tokens. The underlying probe results were real; the framing was built before reading the log that
   would have identified which account actually answered the call. **Wael's correction: start from the
   log, not from probing every account.**
2. **"The contact was not saved"** — it was. It went to `wael.aggan@gmail.com`, the account he called
   *from*. Nothing in the log or the spoken reply names the destination account, and on production
   both candidate accounts are named "Robert".
3. **"A spoken sentence could delete something unconfirmed"** — false. `delete_event`, `delete_rule`
   and `delete_memory` are all inside RULE 23's scope. The real gap is three actions wide.
4. **"The drift check is not running — a pattern worth ten minutes"** — it was running every time. My
   own `tail -20` had cut it off the output.
5. **"Check 3 permanently opts out the number"** — permanent to the product, but one service-role
   delete undoes it. Also implied the number was already suppressed; it was not.
6. **`:7224` for the demo recap SMS** — inherited from two documents. Measured: `:7637`.
7. **Recommending a full 595-case suite run** — habit, not analysis. No product code was touched.

**The pattern in 1, 2 and 5:** a real observation given more weight than the evidence supported, then
carried into a recommendation.

---

## 7. State of the repositories

**`munk2207/naavi-app` `main`** — pushed through `c36f833`. Working tree carries the same untracked
diagnostic scripts and screenshots that predate this session.

**Branch cleanup:** 27 branches deleted — 20 local `claude/*`, 7 on origin — every one verified merged
or content-verified individually rather than trusted to a flag. `t12/create-contact-user-id-resolution`
deleted after merge. **Kept:** the five `archive/*` branches, `feature/app-actions-spike` (F9a is
open), and `worktree-agent-af7f1550a5a91abbc` (live worktree).

**Disk:** 574 MB recovered from 14 stale worktrees, and **1.4 GB from `docs/Naavi/`** — a full clone
of this repository that appeared inside `docs/` at 03:53:18 on 2026-08-23, carrying OneDrive reparse
tag `0x9000e01a`. **Nobody knows what created it.** Verified not a link to the repo root by three
independent checks before deletion. **It may return; OneDrive was actively populating it.**

**Five previously-untracked Edge Functions are now in git** (`63b6efb`) — `delete-contact`,
`patch-calendar-event`, `seed-demo-email-james`, `seed-demo-emails`, `whoami-google-diag`. All live on
staging, none on production. **The promote-or-drop decision is open, one per function** — [[T13]].

**Gate status:** all five push gates green. Voice regression not run this session. Firebase Test Lab
not run.

---

## 8. ⭐ The honest summary

**Every genuine defect found in this session came from Wael doing something physical** — dictating a
contact into a phone, reading a confirmation card and declining to press send, noticing that an
account had no phone number on his own screen. B11j, B11k, B4z and B11l all surfaced that way.

**The gates were not useless.** The T0 gate, the drift check and the schema/code check each refused
something real, and the orphan gate found four unfiled items within minutes of existing. But none of
them found what a person on a phone found in an afternoon.

**The recurring failure this session was built to stop:** knowledge recorded correctly with nothing
mechanically enforcing it. A stale architecture reference, a priority queue five weeks out of date, a
work item cited eight times in the prompt and tracked nowhere, a rule about plain-English descriptions
sitting unfollowed in memory. **Make it refuse, do not make it warn** — that is what the two new gates
are, and it is the standard the next mechanism should be held to.
