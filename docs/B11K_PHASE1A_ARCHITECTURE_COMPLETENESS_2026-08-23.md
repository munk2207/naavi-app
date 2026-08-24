# B11k — Phase 1A: Architecture Completeness Review

**Work item:** [[B11k]]
**Date:** 2026-08-23
**Phase 1:** APPROVED 2026-08-23, scope amended to the verified exposed set
**Purpose:** verify the Phase 1 problem definition is complete *with respect to the Architecture Reference* — not merely internally consistent.

**Revision 2 (2026-08-23), after external review returned REVISE.** Revision 1 recorded Architecture
Completeness as **PASS** while its own §3 described the Architecture Reference as already incomplete
before this work began, and reconciled that contradiction with the phrase *"Outcome 3 territory in
form but not in substance."* **That phrase invented an exception the Architecture Drift Rule does not
provide, and it is withdrawn.** The rule's third outcome reads *"or the Reference was already stale
before this work started — implementation stops."* It attaches no test of whether the staleness
contradicts the current work item. §5a of the Reference is titled **"Full Duplication Inventory"**;
an inventory claiming fullness while omitting a three-way duplication is not merely incomplete, it
is inaccurate. **Verdict changed to FAIL — Architecture Reference reconciliation required.** §3 and
§4 are rewritten; §1 and §2's findings are unchanged and were not disputed.

## Architecture Reference Version Verification

| | |
|---|---|
| Version used for this review | **2026.07.18.9** (revision 9, 2026-08-21, T12 Phase 8) |
| Recorded here per Phase 1A's Version Verification requirement | Before Phase 8 merge, confirm no newer revision has superseded it; if one has, evaluate explicitly whether it changes any assumption this implementation relied on. |

---

## 1. The six mandatory questions

### What is the architectural owner of the affected capability?

**Voice** — `munk2207/naavi-voice-server`, per the Reference's Ownership Model (§0a). The defective
code is `naavi-voice-server/src/index.js`.

### Is the capability Shared Core, Duplicated, or Platform-specific?

**Duplicated — and by three implementations, not the two Phase 1 assumed.**

The capability is *"execute a state-changing action and report its real outcome to the user."*

| # | Implementation | Location | State |
|---|---|---|---|
| 1 | Voice's action loop | `naavi-voice-server/src/index.js:12122-13236` + `:13407` | **Broken** |
| 2 | Mobile's orchestrator | `hooks/useOrchestrator.ts` | **Correct for most actions, not all** — see §2.2 |
| 3 | **`naavi-chat` Step 1.4 executors** | `supabase/functions/naavi-chat/index.ts:2388-2455` + `intentHandlers.ts` | **Correct — and it is Shared Core** |

**Phase 1 did not identify implementation #3.** It is the most consequential finding of this review:
**a correct reference implementation of this exact capability already exists inside Shared Core**,
not only on mobile.

### If duplicated, were all documented implementations investigated?

**Yes — all three, plus the two the Reference documents as duplicated in adjacent form.** See §2.

### If not, which were investigated and which were not?

Not applicable — none were skipped. Two were found that the Reference does not document at all; they
are named in §3 as a Reference gap.

### Does the documented problem scope match the Architecture Reference?

**Partially — and the mismatch is in Phase 1's favour on one point and against it on another.**

- **Matches:** the Reference §3 already names voice's *"own turn-state tracking… its own direct
  database inserts for reminders and rules"* as *"the single biggest gap between what an entry point
  should do and what voice actually does."* B11k is a consequence of exactly that documented gap.
- **Does not match:** the Reference's §5a Duplication Inventory has **no row** for outcome reporting
  / failure surfacing. This capability is duplicated three ways and the Reference does not say so.
  Recorded as a Reference gap in §3 below.

### Is any documented implementation excluded from the investigation?

**Yes — one, deliberately, and it is declared here rather than left silent.** Mobile is excluded by
Wael's Phase 0 decision. §2.2 states exactly what was found on the mobile side anyway, because the
Architecture Scope Rule forbids silence in either direction.

---

## 2. Cross-Repository Verification Rule

Per the Verification Provenance Rule (v3.7), every bullet is tagged.

### 2.1 Voice — the subject

- **Freshly verified this session.** Speech is dispatched before execution; the execution site is
  un-awaited with the result discarded — `naavi-voice-server/src/index.js:13406-13408`. Background is
  the default branch — `:13235-13236`.
- **Freshly verified this session.** `executeAction` returns business failures as values rather than
  throwing — `src/index.js:4557`, `:4655`, `:4874`, `:4994` — so the `.catch()` at `:13408` does not
  fire for them.
- **Freshly verified this session.** Two further instances sit *outside* the default branch, inside
  explicit `else if` arms, each an un-awaited `fetch(...).catch()` followed by an unconditional
  "saved" log — `src/index.js:12495-12500` (`LOG_CONCERN`) and `:12509-12514` (`UPDATE_PROFILE`).
- **Freshly verified this session.** Voice never calls `naavi-chat`: `grep "functions/v1/naavi-chat"`
  over `src/index.js` returns **zero** matches, while the file contains **47** comments describing
  itself as mirroring naavi-chat logic. This confirms Reference §2a — voice does not call mobile's
  backend for action handling; it reimplements it.

### 2.2 Mobile — excluded from scope, and what was found regardless

- **Freshly verified this session.** The correct mechanism exists and is applied broadly:
  **52** `turnSpeechOverride = ` assignments in `hooks/useOrchestrator.ts`, and the comment at
  `:2555-2560` (V57.8) describes the voice defect exactly — *"override Naavi's speech to be truthful
  about the failure. Otherwise the speech still says 'I've added it' and the user thinks the event
  was created."*
- **⭐ Freshly verified this session — and it refines a claim Phase 0 and Phase 1 both carried.**
  *"Mobile is not affected"* is true of the **ordering** half of the defect and **not universally
  true of the result-shape half.** `hooks/useOrchestrator.ts:3304-3307` handles `LOG_CONCERN` and
  `UPDATE_PROFILE` by `await saveTopic(...)`. `saveTopic` (`lib/memory.ts:301-311`) returns
  `Promise<void>` and awaits a Supabase insert **whose returned error is never inspected** — and
  supabase-js returns errors rather than throwing. So for these two actions mobile gets the ordering
  right and the inspection wrong, and no speech override fires.
- **Consequence, stated plainly:** mobile's correctness here is **per-action, not global.** It was
  taken as global in Phase 0 and Phase 1 on the strength of the holding list. This is precisely the
  failure mode the Verification Provenance Rule exists to catch.
- **Still out of scope**, per Wael's Phase 0 decision. Declared, not silent. Recommended as its own
  item in §4.

### 2.3 Shared Core — investigated, and it splits

**The correct implementation — `naavi-chat` Step 1.4:**

- **Freshly verified this session.** Seven executors are `await`ed and **the reply's speech is taken
  from the executor's return value** — `naavi-chat/index.ts:2388-2455`, covering `SET_REMINDER`,
  `CREATE_EVENT`, `REMEMBER`, `DELETE_RULE`, `DELETE_MEMORY`, `ADD_CONTACT`, `DELETE_EVENT`. The
  pattern is `const result = await handle…Exec(…)` then `speech: result.speech`. Execute, then
  speak — the outcome determines the words.

**⭐ The decisive contrast — same target function, two callers, opposite behaviour:**

| | Shared Core (`naavi-chat`) | Voice |
|---|---|---|
| Call site | `intentHandlers.ts:1120-1125` | `src/index.js:4625-4631` |
| Body sent | `{ query, user_id: userId }` | `{ query }` — **no `user_id`** |
| Result | `if (!res.ok)` → speaks *"I couldn't delete that event. Please try again."* | returned, then discarded |

- **Freshly verified this session.** This is why `DELETE_EVENT` works from mobile and is dead on
  voice (Phase 1 §5). The correct call shape has existed in Shared Core the whole time.

**The two Shared Core instances that carry the defect:**

- **⭐ Freshly verified this session.** `naavi-chat` has two raw `action_rules` inserts outside the
  Step 1.4 pattern, both fire-and-log with the speech already composed:
  - `naavi-chat/index.ts:1716-1727` — `if (error) console.error(…)` and nothing else.
  - `naavi-chat/index.ts:3844-3858` — `if (_insErr && code !== '23505') console.error(…)` else logs
    *"saved"*.
  These run **server-side, before the response reaches mobile**, so mobile's `turnSpeechOverride`
  cannot correct them — it never learns the write failed. **This is a Shared Core instance of the
  same defect, and its blast radius is mobile.**

- **Freshly verified this session.** `handleDeleteEventExec` (`intentHandlers.ts:1131-1135`) computes
  `const count = data?.deleted ?? 1` and branches on `count > 1`, so a `{ success: true, deleted: 0 }`
  response — which `delete-calendar-event/index.ts:205` returns for *"No matching events found"* —
  produces *"Done. Deleted 'X' from your calendar."* **This is a Shared Core instance of the
  zero-match defect Phase 1 §5.1 found in voice's `DELETE_MEMORY`.**

### 2.4 Capabilities the Reference documents as duplicated — checked for relevance

- **Relying on Architecture Reference classification, not re-checked this session:** Action Rules
  execution fan-out (§5a Priority 1b), Calendar reads (Priority 2), Gmail live reads (Priority 3),
  List reads, Conversation/turn state (Priority 4). **None are touched by B11k** — B11k changes when
  a result is inspected inside voice's turn loop, not what any of these read or fire.
- **Freshly verified this session:** Action Rules *creation* (§5a Priority 1) **is** touched, in the
  sense that voice's creation path is where the exposed `SET_ACTION_RULE` variants originate. B11k
  does not unify it and does not make it worse.

---

## 3. Architecture Reference gaps this review found

Recorded so Phase 8 knows what must be updated, per §8's Architecture Change Procedure.

1. **§5a's Duplication Inventory has no row for outcome reporting / failure surfacing.** It is
   duplicated three ways (§1) with no shared module and nothing enforcing consistency — which is the
   definition the Inventory exists to capture. **Its absence is why three independent narrow fixes
   happened without anyone seeing them as one class.**
2. **§2 has no row for `naavi-chat`'s Step 1.4 executors as a Shared Core implementation of action
   execution.** §2b describes Step 1.4 as *"the only place that reads the marker back and performs
   the write"* but does not record that it also owns the correct execute-then-speak contract.
3. **Both gaps predate B11k, and that is exactly what makes them Outcome 3.** The Architecture Drift
   Rule's third outcome is *"an unapproved change slipped in, **or the Reference was already stale
   before this work started**"* → *"Implementation stops. The discrepancy must be resolved and the
   Architecture Reference reconciled before Phase 6 review is repeated."* The rule sets **no test**
   of whether the staleness bears on the current work item, so "it predates us and doesn't
   contradict us" is not a route past it.

4. **And gap 1 is not a mere omission — it is an inaccurate claim.** §5a is titled **"Full
   Duplication Inventory."** A table asserting fullness while omitting a capability duplicated three
   ways is wrong on its face, not thin. Governance's own words for why this matters: *"An
   architecture document that's already known to be wrong is worse than no document, and proceeding
   on top of a known-wrong map is exactly the failure this entire framework exists to prevent."*

5. **The rule names Phase 6; this is Phase 1A.** The Drift Rule is written under Phase 6's
   Architecture Completeness verdict, and this is Phase 1A's. Two reasons that does not create an
   exemption: both phases issue the same named verdict, and finding the drift *before* implementation
   is strictly the better outcome — reading the rule as "only Phase 6 stops for this" would mean a
   drift found early is waved through and a drift found late is not. **Recorded as a genuine
   ambiguity in the governance text**, resolved here in the direction that stops rather than
   proceeds, and offered to Wael in §4 as a ruling he may make either way.

6. **Consequence, stated plainly.** Under the Drift Rule, **implementation stops.** Phase 2 cannot be
   authorized on this Phase 1A. What unblocks it is reconciliation of the Reference — or Wael's
   explicit ruling that these omissions are not Outcome 3.

---

## 4. Verdict

**Architecture Completeness: FAIL — Architecture Reference reconciliation required.**

Not a failure of Phase 1's investigation, which is sound and undisputed. It is a failure of the
**map** the investigation was checked against. Under the Architecture Drift Rule, implementation
stops until the Reference is reconciled.

**Everything in §1 and §2 stands.** The problem definition is complete with respect to what the
Reference *should* say. The verdict turns entirely on what it currently *does* say.

### 4.0 Reconciliation status — APPLIED 2026-08-23

**Wael chose §4.2 Option 1 (reconcile now), 2026-08-23.** External review recommended the same and
approved all three proposed changes. They are applied to
`docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`:

| # | Change | Where it landed |
|---|---|---|
| 1 | Duplication Inventory row — outcome reporting / failure surfacing, Priority 1c | §5a |
| 1b | **Matching §5 narrative for Priority 1c** — see the note below | §5 |
| 2 | `naavi-chat` Step 1.4's execute-then-speak contract, plus a row naming the three-way duplication | §2 |
| 3 | Version bumped `2026.07.18.9` → **`2026.07.18.10`**, with a revision note, same commit | version block |

**⭐ One edit beyond the three approved, reported rather than made silently** (Phase 4's No Extra
Changes discipline, applied here even though this is not Phase 4). The approved §5a row is labelled
**Priority 1c**, and §5 and §5a are the same content in two views — every other §5a row's priority
label has a matching §5 entry. Landing the row alone would have left a priority label pointing at
nothing, which is a fresh inconsistency introduced by the fix for an inconsistency. The §5 narrative
was therefore written as part of edit 1, not as a separate change. **If the reviewer or Wael
considers this outside what was approved, it is a two-line removal.**

**Re-review returned PASS, 2026-08-23.** Wael confirmed the same date and authorized the 1A → 2
transition. **Architecture Completeness is therefore PASS**, and both of Phase 1's independent
reviews now hold — see §5. The FAIL recorded below is retained as the historical verdict of
revision 2, not as current state.

### 4.1 What reconciliation required — as proposed, now applied

Per the Reference's own header: *Claude proposes architecture changes and updates to this document;
ChatGPT reviews them; only Wael approves a new Architecture Version.* Proposed below so the decision
is concrete rather than an instruction to go and do something.

**Proposed edit 1 — new row in §5a's Full Duplication Inventory:**

> | **Action outcome reporting / failure surfacing** — Priority 1c | | ✅ | **Not** an accepted
> Exception. Three independent implementations: voice's action loop (broken — speaks before
> executing, discards the result), mobile's `useOrchestrator` (`turnSpeechOverride`, correct for most
> actions), and `naavi-chat`'s Step 1.4 executors (correct, and Shared Core). Nothing enforces
> consistency. Three narrow fixes to the voice instance landed independently — 2026-05-12,
> 2026-07-15, 2026-07-21 — without the class being named. Tracked as [[B11k]] |

**Proposed edit 2 — new row in §2's Shared Core Boundaries:**

> | Action execution and outcome-truthful reply (app path) | `naavi-chat` Step 1.4 executors
> (Shared Core) | Genuinely shared for the seven intents it covers, and the **reference contract**
> for this capability: execute, then derive the reply's speech from the result. §2b previously
> described Step 1.4 only as the marker's read-back point; owning the execute-then-speak contract was
> unrecorded |

**Proposed edit 3 — version bump to `2026.07.18.10`**, with a revision note, in the same commit as
the edits. Per revision 5's own lesson: *"a revision number only means something if bumping it is
part of editing."*

### 4.2 The decision, and it is yours

1. **Reconcile now** — apply edits 1–3 to the Architecture Reference, re-review this Phase 1A, then
   consider Phase 2. **Recommend this.** The gaps are small, the text is drafted, and the whole
   reason §5a exists is that undocumented duplication stops being tracked. This item is the proof:
   the same defect was fixed three times in three months because no inventory row named the class.
2. **Rule that these omissions are not Outcome 3** — an explicit governance ruling from you, recorded
   in this document, that a pre-existing Reference omission unrelated to the current change does not
   stop implementation. Legitimate, and it resolves the §3.5 ambiguity for every future work item.
   But it widens the Drift Rule permanently, and §9's Rule-Removal Requirement would arguably apply.
3. **Defer to Phase 8** — what revision 1 proposed. **No longer offered as a recommendation.** It is
   what the Drift Rule forbids, and the reviewer was right to reject it.

### 4.3 Carried forward — unchanged, none started

1. **`naavi-chat`'s two raw inserts (§2.3)** — a Shared Core instance of B11k's defect affecting
   mobile. **Separate item.** Reviewer agreed.
2. **Mobile's `LOG_CONCERN` / `UPDATE_PROFILE` (§2.2)** and **`handleDeleteEventExec`'s zero-match
   (§2.3)** — **added to the correctness item already being opened** for `DELETE_EVENT`'s `user_id`
   and `DELETE_MEMORY`'s zero-match. Same two defect shapes, different surfaces. Reviewer agreed.
3. **The two Reference gaps** — resolved here in §4.1/§4.2 rather than deferred, per the reviewer's
   required change.

---

## 5. Independent Review Rule — status

Phase 1 carries two independent reviews, and governance states plainly that *"passing one review does
not imply passing the other"* and that *"a Phase 1 document cannot receive an overall approval
recommendation until both reviews pass."*

| Review | Verdict | Date |
|---|---|---|
| Technical Investigation Review | **PASS** | 2026-08-23 |
| Architecture Completeness Review | FAIL — reconciliation required | 2026-08-23 (revision 2) |
| Architecture Completeness Review — re-review after reconciliation | **PASS** | 2026-08-23 (revision 3) |

**Both reviews now pass, so Phase 1 holds an overall approval recommendation.** The path it took
there is the point: the technical work was right from the start, the map it was checked against was
not, and the split verdict is what made that visible instead of averaging it away. Had revision 1's
PASS stood, the Architecture Reference would still be missing the row — and the next person to hit
this defect would have been the fourth to fix it narrowly.

**Phase 2 authorized by Wael, 2026-08-23.**
