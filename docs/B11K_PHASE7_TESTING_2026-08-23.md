# B11k — Phase 7: Testing

**Work item:** [[B11k]]
**Date:** 2026-08-23
**Branch:** `naavi-voice-server` @ `staging`
**Status:** **PLAN — nothing deployed, no test executed yet**

> ✅ **Phase 6 — RESOLVED.** Confirmed approved by Wael, 2026-08-23: *"Phase 6 already approved, I
> did not clearly state that."* All four verdicts PASS, now recorded in
> `docs/B11K_PHASE6_TECHNICAL_REVIEW_2026-08-23.md`. Phase 8's *"External review completed"*
> precondition is satisfied.
>
> **Kept as a short note rather than deleted, because the gap was real while it lasted.** The review
> had happened; the record did not say so, and a precondition that lives only in recollection is the
> failure mode this project has already paid for repeatedly. Thirty seconds of asking resolved it.
> The correction cost nothing; assuming either way could have.

---

## 1. Why manual testing is mandatory here

Governance Phase 7: *"Passing automated tests alone is not sufficient."* Manual validation is
mandatory for Voice, Phone, and Notifications — this change touches all three.

**And the project's own evidence says the same thing more bluntly.** From the holding list's closing
note on the day B11k was found:

> Every genuine defect found on 2026-08-21 came from Wael doing something physical — pressing keypad
> keys, calling two lines a minute apart, dictating a contact. **None came from the tests, the gates
> or the reviews.**

158 unit tests pass. They prove the module's contract. They prove nothing about a phone call.

---

## 2. Pre-flight state

| | |
|---|---|
| Automated suite | **158 pass / 0 fail** (`npm test`, re-run immediately before this document) |
| Voice pre-push gate | clean |
| `node --check` | clean, both changed sources |
| Working tree | `src/index.js` modified; `src/outcome_report.js`, `test/outcome_report.test.js` untracked |
| Committed | **No** |
| Deployed | **No** |

---

## 3a. ✅ DEPLOYED TO STAGING — 2026-08-23, 3:00 PM EST

| | |
|---|---|
| Commit | **`3bf15c3`** — *"B11k: Naavi executes the action before she says she did it"* |
| Branch | `staging` → `04a61f2..3bf15c3` |
| Voice pre-push gate | clean |
| Service | `naavi-voice-staging` |

**Confirmed from the running container, not from the push** (Architecture Reference §0d):

```
Starting Container
[Voice] Server running on port 8080
```

**And confirmed to be *this* commit, not merely *a* deploy** — the two timestamps, in EST:

| Event | Time (EST) |
|---|---|
| Commit `3bf15c3` authored | **3:00:23 PM** |
| Container image built | **3:00:49 PM** — 26 seconds later |
| Fresh container booted | confirmed in deployment logs |

§0d warns that a push completing, the `/` route, and the per-turn `commit=` marker are all
unreliable signals — the last two are hardcoded April literals. The image build timestamp landing 26
seconds after the commit is positive evidence; nothing here rests on the push having succeeded.

**The staging demo line `+1 873 446 2284` received this deploy too**, since it runs the same branch
(§0b). Expected.

**Production is untouched.** `main` is unchanged.

---

## 3. Deployment steps — executed 2026-08-23, see §3a

1. Commit the three files on branch `staging`.
2. `git push origin staging` — triggers the voice pre-push gate.
3. Railway auto-deploys → service **`naavi-voice-staging`**.
4. **Confirm the deploy from the running container**: `railway logs --service naavi-voice-staging`.
   Not from the push completing, and not from the `/` route or the `commit=` marker — both are
   hardcoded April literals that report the same value regardless of what is running (Architecture
   Reference §0d). Allow the build time to start before concluding it has not.

**⚠️ The staging demo line deploys the same branch.** `+1 873 446 2284` runs on
`generous-tenderness-production-9235`, which deploys `staging` (Reference §0b). This push changes it
too. Expected, not a fault.

---

## 4. Test matrix

All calls to the **staging** line: **+1 343 504 1572**. Not the production number.

### T1 — A successful action is unchanged

**Say:** *"Remember that my neighbour's dog is called Rufus."*
**Expect:** the same confirmation Naavi gives today. No new sentence, no audible change.
**Proves:** the all-success path is untouched — the single most important regression check, because
it is every normal turn.
**Watch for:** any added pause before she speaks.

### T2 — ⭐ The headline test: a failing action now says so

**Say:** *"Delete my dentist appointment from my calendar."*
**Expect:** *"I wasn't able to delete that event. Please try again."*
**Before this change she said it was done.** `DELETE_EVENT` fails 100% of the time (Phase 1 §5) —
voice sends no `user_id`, and `delete-calendar-event` returns `{"error":"No Google token found"}`,
proven by read-only probe on both environments.
**Proves:** Phase 0's Completion Criterion 2, with no rigging required.

### T3 — Latency on a state-changing turn

**Say:** *"Remind me to call the pharmacy at four o'clock."*
**Expect:** confirmation as today; the wait should be unremarkable and the tick audible throughout.
**Proves:** the 5-second bound is not felt in practice.
**Fail condition:** a pause Wael judges too long. That is the number to revisit, not the design.

### T4 — ⭐ The pause-hold path (Phase 6 §2)

**Do:** ask for a reminder, then say a pause word while Naavi is still composing her answer.
**Then:** ask her to list your reminders, or check the Alerts screen.
**Expect:** **the reminder exists.**
**Before this change it did not** — the early return at `src/index.js:13378` fired before the old
execution site, so the action was silently dropped.
**Proves or disproves the one claim in Phase 6 made from code rather than observation.** If the
reminder is absent, my reading is wrong and Phase 6 §2 must be rewritten.

### T5 — An unhandled action type

**Only if a natural phrasing can trigger one.** `{skipped:true}` now classifies as `failure`
(Phase 5 §6.2), so Naavi should say *"I wasn't able to do that. Please try again."* rather than
claiming success.
**If no natural trigger exists, record that and rely on the unit test.** Do not contrive a phrasing
that no caller would use.

### T6 — Gate 2, voice regression

Must pass. Required before any production promotion, not before staging testing.

---

## 5. What would make this fail

Stated in advance so the result is not interpreted after the fact:

| Observation | Meaning |
|---|---|
| T1 sounds different, or is slower in a way Wael notices | Regression on the common path — **stop** |
| T2 still claims success | The fix does not work |
| T2 says the failure — | **the fix works** |
| T3 has an unacceptable pause | Revisit the 5-second bound, not the design |
| T4 reminder absent | Phase 6 §2's reading is wrong; rewrite before Phase 8 |
| Any dead air with no tick | The block is on the wrong side of `stopMusic()` — contradicts the line-number check, but the call is ground truth |

**Wael's verdict on a live call is ground truth** (CLAUDE.md lever 5). No test result here will be
argued with by proposing a tighter test setup.

---

## 6. Status

**Deployed to staging (§3a). No live test run yet — T1–T6 are Wael's to perform.**

### 6.1 Results — to be filled in as each test is run

| Test | Result | Notes |
|---|---|---|
| T1 — successful action unchanged | **✅ PASS** | Wael, live call from +1 343 333 2567, 2026-08-23. `REMEMBER` — confirmed as before, no audible change, no noticeable added pause |
| T2 — ⭐ failing action now says so | **✅ PASS** | Same call. `DELETE_EVENT` now reports the failure instead of claiming success. **This is B11k's defect, fixed and observed.** |
| T3 — latency on a state-changing turn | **✅ largely covered by T1** | `REMEMBER` is a background action, so T1 exercised the new awaited batch. A second instance (`SET_REMINDER`) may still be run |
| T4 — ⭐ pause-hold path | **⬜ NOT RUN — closed unrun by Wael, 2026-08-23** | See §6.3. **Phase 6 §2's claim remains unverified by observation.** |
| T5 — unhandled action type | **⬜ NOT RUN** | No natural trigger presented itself; covered by unit test only |
| T6 — Gate 2 voice regression | — | required before production promotion, not before staging |

### 6.3 T4 closed unrun — what that costs, stated plainly

**Wael's decision, 2026-08-23.** An attempt was made and produced no usable result: Deepgram
transcribed *"pharmacy"* as *"farmer"*, that rule took the 10:05 PM slot, and every retry was
rejected with a duplicate conflict — so the interrupt step never got a clean run. Rather than keep
fighting the setup, T4 is closed unrun.

**What this means for the record, precisely:**

- **Phase 6 §2's behaviour change is validated by code reading only.** The claim is that a caller who
  interrupts Naavi mid-composition now gets their action performed, where before the early return at
  `src/index.js:13378` silently discarded it. That reading was reviewed and approved; **it has not
  been observed.**
- **It is not a claim B11k depends on.** T1 and T2 passed and are what Phase 0's Success Criteria
  asked for. §2 is a side effect found by self-audit, not the fix.
- **The residual risk, named:** if a caller has ever used a pause word *as* a cancel, this changes
  what that does. My reading is that cancellation lives elsewhere (`detectStandaloneCancelIntent`,
  the `pending*` gates) and that this path only holds audio. **Unverified.**
- **Cheap to close later.** One call: request a reminder at an unoccupied time, interrupt during the
  tick, then check the database directly rather than asking Naavi — [[B11m]] means her own answer to
  *"what reminders do I have"* is not currently trustworthy evidence.

**T1 + T2 together are Phase 0's Completion Criterion 2**, and the pair matters more than either
alone: T2 proves the failure is now audible, and T1 proves that did not cost anything on the path
every ordinary request takes.

**Wael's live verdict is ground truth** (CLAUDE.md lever 5). No test setup is being renegotiated
after the result.

### 6.4 Three defects found by testing, none of them B11k — now open as holding-list items

The testing session found more than it was looking for. **Every one of these went through paths B11k
does not touch** — each turn logged `bg_action_count: 0` — so none is a regression from this change.

| Item | Finding | Surface |
|---|---|---|
| [[B11m]] | *"What reminders do I have?"* answered **"none"** with `action_types: []` — no lookup ran — while an enabled rule sat two minutes from firing, and then fired | voice |
| [[B11n]] | A fired one-shot alert vanishes from the app instead of showing as triggered (`app/index.tsx:360` filters `enabled=true`) | mobile |
| [[B11o]] | Voice `DELETE_EVENT` sends no `user_id` — the cause of T2's failure, proven dead on both environments | voice |

Two more were already agreed at Phase 1A and are opened alongside them: [[B11p]] (`naavi-chat`'s two
raw inserts, Shared Core) and [[B11q]] (mobile's unchecked `saveTopic`).

**⭐ The pattern across B11k, B11m and B11n is one thing, and it is worth stating once.** In all
three the system holds the truth and shows the user something else — B11k *acted then claimed
success*, B11m *never checked then answered anyway*, B11n *did the thing then erased the evidence*.
Three different mechanisms, one failure: **Naavi's account of reality diverging from her own
records.** That is [[project_naavi_truth_at_user_layer]], and it now has three live instances rather
than an abstraction.

**And the session's own lesson repeated itself exactly.** The holding list's note on the day B11k was
found reads: *every genuine defect came from Wael doing something physical; none came from the tests,
the gates or the reviews.* Tonight: 158 unit tests, four external reviews and eight governance phases
found none of B11m, B11n or B11o. **One phone call found all three.**

### 6.2 One thing seen in the staging logs while confirming the deploy — unrelated to B11k

The last recorded call on `naavi-voice-staging` ends with:

```
[Context] No user found for phone +16137697957 — returning null (no fallback)
```

That is Wael's own number failing to resolve to a user on staging. **Not caused by B11k** — the line
predates this deploy and B11k does not touch caller resolution. **Reported rather than passed over**,
because it will affect T1–T5: an unresolved caller may not reach the action paths under test at all.

**Check before running the matrix:** confirm the staging line recognises the calling number. If it
does not, the tests will exercise the wrong path and their results will mean nothing — which is the
same class of error as running the auto-tester against the wrong environment
([[feedback_verify_test_env_before_trusting_gate]]).
