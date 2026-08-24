# Session Handoff — 2026-08-23/24

**B11k shipped to voice staging through full governance. Fourteen items closed, six opened. A gate built for the failure that made this session necessary.**

> **Read the previous handoff's own first lesson before this one.** The session opened with Wael's instruction to ignore the prior handoff's recommendations, because it carried an unverified theory that proved wrong. This document therefore records **facts, decisions and open questions**, and marks the few places it recommends. Treat every recommendation here as one input, not a plan.

---

## 1. What shipped

**[[B11k]] — Naavi executes the action before she says she did it.** `naavi-voice-server@3bf15c3`, live on `naavi-voice-staging`, confirmed by Wael on a live call, closed at Phase 8.

Voice used to dispatch its speech to TTS and *then* run the action, as a fire-and-forget `Promise.all` whose result was discarded. The outcome did not exist when Naavi committed to words about it. It now runs the batch **before** speaking, bounded at 5 s, and builds what she says from what actually came back. If anything failed, Claude's original speech is **discarded, not appended to** — appending would leave a false claim in the utterance, contradicted rather than removed.

**Confirmed live:** *"delete my dentist appointment"* → *"I wasn't able to delete that event"*, where the day before she claimed success. An ordinary successful request sounded identical to before.

**Full Phase 0–8, seven external reviews, two of which returned REVISE and were right to.** 158 unit tests. Rule 15a exception approved (the auto-tester structurally cannot reach Railway-local voice orchestration).

**Also shipped:**
- **CLAUDE.md** — three stale spots corrected, each contradicting a rule at the top of the same file (`e13ddc5`).
- **Architecture Reference → 2026.07.18.10** — outcome reporting recorded as a three-way duplication (§5a Priority 1c) and `naavi-chat` Step 1.4's execute-then-speak contract recorded in §2. Both were missing.
- **`scripts/closed-row-placement-check.js`** — a new pre-push gate, verified in three directions.
- **AGENTS.md deleted** — an 846-line stale copy of CLAUDE.md carrying the pre-correction text of all three fixes above.

---

## 2. Wael's decisions, with his words

These are settled. Do not re-litigate them.

| Decision | His words |
|---|---|
| **B11k scope: all twelve actions, structural** | Fixing only the destructive ones repeats what was already done twice |
| **Rule 15a exception, conditioned on voice staging** | *"#1 will be implemented on voice staging"* |
| **[[T11]] declined and closed unproven** | *"the key here is 'might be able', we do not act on 'might be able'"* |
| **[[B9y]] closed** | *"i ruled on it before that it is not worth to follow special for voice"* |
| **[[B4b]] not promoted** | *"it is significantly trivial"* |
| **Staging password: not rotated, never raise again** | Assessed and declined; recorded inline in CLAUDE.md and in the archive |
| **B11k closes at Phase 8** | Corrected Claude's claim that closure required production promotion — governance says *"Production follows the existing release process"*, so production is a release decision, not a phase |
| **B10m and B4z demoted** | After reading both in full |

---

## 3. What Claude got wrong, and it is the useful half

Eight errors, each caught by Wael or by an external reviewer. Recorded because the shape repeats.

1. **⭐ Recommended [[T6]] as the single highest priority — from a row that said CLOSED.** The cell is 9,173 characters and the closure is at the end. Claude read the opening (*"any signed-in user can read every user's medical records"*) and never reached the retraction in the same cell. **Fourth time Epic had come back at Wael.**
2. **Ranked [[T11]] as platform risk from a code reading plus an inference**, presented as established. Never reproduced by anyone.
3. **Brought [[B9y]] back as an open decision** when Wael had ruled it dead in July — and the ruling was quoted in the row Claude read aloud.
4. **"Mobile is not affected"** carried through Phase 0 and Phase 1. True of the ordering half of the defect, not of the result-shape half — mobile's `LOG_CONCERN`/`UPDATE_PROFILE` have the same gap ([[B11q]]).
5. **Proposed *"I've started that, I'll confirm in a moment"*** as the timeout wording — promising a confirmation mechanism B11k does not build. The same defect in a new costume, written one phase after documenting the pattern. Caught at Phase 3 review.
6. **Classified `{skipped:true}` as success** at Phase 4. Faithful to the approved contract, and it meant an action Naavi never attempted was still reported as done. Caught at Phase 5 review.
7. **Recorded Phase 1A as PASS** while its own findings showed the Architecture Reference was already incomplete, reconciled with *"Outcome 3 in form but not in substance"* — an exception the Architecture Drift Rule does not provide. Caught at review; the correction produced revision 10.
8. **Said the password was in two committed files.** It was five.

**The common shape: reading part of something and reporting it as established.** Items 1, 2, 3 and 8 are all that.

---

## 4. The holding list was not trustworthy, and now is

**[[T6]] had been closed on 2026-08-21 and spent three days in the priority list.** The closure was written into the row; the row was never moved. `priority-cap-check` counts rows, not *open* rows, so it reported "5 of 5, full" with one of the five finished.

A sweep found **eight more** rows in the same state. All resolved:

- **14 closed and archived** — B11k, B11j, T6, B9y, T11, B11c, B11f, B11h, T5, T8, T12, T4, plus B11r/B11s.
- **Two ID collisions resolved** — `B11f` and `B11e` each named two unrelated items. The **older** holders were renamed (B11r, B11s) because the newer ones are referenced across eight governance documents. **History was deliberately not rewritten.**
- **Five rows refiled** — F23 into Features; T7, T10, T11, T13 into Tooling.
- **[[B11j]] closed** — fixed and in production for two days while its row read *"broken on BOTH environments."*

**⭐ The new gate catches the first shape and not the second.** `closed-row-placement-check.js` refuses a push when an open table holds a row that **declares** itself closed. B11j declared nothing — it simply stopped being true. That blind spot is written into the script's own header, and B11j was found within the hour of writing it, by accident, while assessing something else.

---

## 5. Priority list — 5 of 5, ordered

| | Item | One line |
|---|---|---|
| 1 | **[[B11o]]** | Voice `DELETE_EVENT` sends no `user_id` — deleting a calendar event by phone has never worked, either environment. Proven read-only on both: HTTP 400. **Gates B11k's promotion.** |
| 2 | **[[B11l]]** | *"text me"* resolves to a stranger and the card labels him *"me"*. One tap from a real message to the wrong real person. |
| 3 | **[[B9x]]** | A location alert meant for someone else silently fires to the user instead. They never hear from you; you believe they did. |
| 4 | **[[B11m]]** | *"What reminders do I have?"* answered **"none"** with no lookup run, while an enabled rule sat two minutes from firing. It then fired. |
| 5 | **[[S2]]** | The PIN becomes a private ID — it identifies *which* account is calling, not only that the caller is allowed in. Design work, not a defect. |

**Position is priority.** B11o first because it is small, already investigated by B11k's Phase 1, and releases work already built and tested. **B11l and B9x are plausibly one investigation** — both are recipient resolution failing while the interface says otherwise.

**Opened and not prioritised:** [[B11n]] (fired alerts vanish from the app), [[B11p]] (`naavi-chat` speaks success on a failed insert), [[B11q]] (mobile saves without checking), [[B11t]] (below).

---

## 6. Open, and nothing is blocked

1. **B11k's production promotion.** Needs [[B11o]] first — otherwise production gets a Naavi that honestly and reliably announces failure on every delete-event request. Then Gate 2. **⚠️ `npm run test:voice` shares a runner whose `SUPABASE_URL` defaults to production and whose fixtures perform live DELETEs — check the environment banner first.** Promoting voice also releases the 1-888-91-NAAVI demo line (Reference §0b).
2. **[[B11o]]'s governance level — undecided, and only matters when it starts.** The rule says full Phase 0–8 (Protected Core twice over). But [[B11j]], *the identical fix*, went through **zero phases** two days ago and shipped to production. That contradiction is the **low-risk lane proposed 2026-08-21 and never built**. One thing makes B11o riskier than B11j: a wrong user on contact-creation misfiles a contact; a wrong user on *delete* destroys someone else's calendar event. **Claude's recommendation, not a decision:** Phase 0, cite B11k's Phase 1 §5 rather than redo it, keep Phase 3 external review for the destructive path, Phase 5 + 7. Skip 1A and 2.
3. **B11k tests 4 and 5 never ran.** Test 4 (interruption) died three times to transcription, not to the thing under test — recorded against [[B4b]] with all three transcripts. Test 5 was blocked by [[B11t]]. **Phase 6 §2's pause-hold claim therefore stands on code reading and has never been observed.**

---

## 7. [[B11t]] — found on the last call of the session

Naavi says *"say yes if I have it right, or **say change** to correct it."* **"change" has no branch.** `src/index.js:9962` handles yes and no; everything else falls to the else, which speaks the same instruction again. Saying exactly what she asks for loops the call forever. The only exits are "no" — which discards the spelled name — or hanging up.

**The code documents the missing branch itself.** `:9321` reads *"waiting yes/no/change"*. Three outcomes described, two implemented, and the missing one is the one she instructs the caller to use.

---

## 8. What this session is actually about

**Three defects, one failure.** [[B11k]] *acted, then claimed success.* [[B11m]] *never checked, then answered anyway.* [[B11n]] *did the thing, then erased the evidence.* Different mechanisms; in each, the system holds the truth and shows the user something else. The Architecture Reference now carries a row naming that class — its absence is why the same defect was fixed narrowly **five times** between May and July.

**And the method lesson repeated, exactly as the previous handoff predicted.** 158 unit tests, seven external reviews and eight governance phases found none of B11m, B11n, B11o or B11t. **Wael found all four by picking up a phone.** The process is what made the fix safe to ship. It is not what found the bugs.

**The recurring failure is not missing information — it is information filed away from where it is needed.** T6's closure existed. B11j's fix existed. Wael's July ruling on B9y existed and was quoted in the row Claude read aloud. Each was recorded somewhere nobody would look at the moment it mattered. That is why the password ruling was written **inline beside the password**, not only into the archive.
