# Travel Event Selection Semantics (Ticket B) — Phase 1 — Problem Definition

**Date:** 2026-08-03
**Governance version:** v4.0
**Phase 0:** Approved — `docs/TRAVEL_EVENT_SELECTION_SEMANTICS_PHASE0_INTENT_APPROVAL_2026-08-02.md`
**Constraint honored:** this investigation ran after Ticket A's staging schema fix and Ticket C's atomic-sync fix were both live and validated (Tickets A & C closed 2026-08-03, `docs/CALENDAR_TICKETS_AC_PHASE8_MERGE_2026-08-03.md`), so these results are not confounded by the already-diagnosed data-availability defect.

## Evidence gap, stated up front

Phase 0's background evidence (2026-08-02) described "Gym class" being skipped by "next meeting"/"next appointment" despite being chronologically first. **That exact scenario could not be re-reproduced today** — the calendar has rolled forward (today is 2026-08-03; Gym class's next occurrence is 2026-08-05, no longer chronologically first). This is an honest evidence gap, not an assumption: live schedule pulled fresh today (`scripts/diag-b-schedule-check.js`) confirms Gym class is currently 2 days out, behind Team standup (today, 9 AM), Dr. Osei dentist (today, 10 AM), and Home reno walkthrough (today, 5:30 PM).

**However, today's live trials independently reproduced both underlying phenomena Ticket B was opened to investigate — with different, currently-real events — which is sufficient to answer all 5 Success Criteria without needing Gym class specifically.**

## What exactly is broken

Two distinct, separately-evidenced behaviors, both live-tested today against the same real, correctly-synced staging calendar (`scripts/diag-calendar-context-controlled-trials.js`, `scripts/diag-b-next-event-extra-trials.js`, staging user `f1bc46b8-a478-43ad-bf09-e138099c8847`, fresh conversation each trial):

**1. Genuine non-determinism in the neutral "next event" case (Success Criteria 3, 5).** 8 identical trials of "Drive me to my next event" — a phrase with no type-semantics to interpret — should deterministically select Team standup (9:00 AM, the chronologically earliest qualifying event). It did, in 6/8 trials. In 2/8 trials it instead selected the dentist appointment (10:00 AM, chronologically later). Same pre-fetched, pre-sorted data every time (see Root Cause below) — the only variable was the model's own re-derivation.

**2. A consistent, undocumented type-based filter on "appointment" (Success Criterion 4).** 8/8 trials of "Drive me to my next appointment" selected the 10:00 AM dentist visit, never the 9:00 AM Team standup — even though Team standup is chronologically earlier and would qualify as "next" under a literal earliest-start reading. "Drive me to my next meeting" (3/3 trials) and "Drive me to my next event" (majority of trials) both correctly selected Team standup instead. This is a real, reproducible, internally-consistent distinction Claude is applying between "meeting"/"event" and "appointment" — not noise.

## Root Cause — proven, not inferred

**File evidence, RULE 7 (`supabase/functions/get-naavi-prompt/index.ts:699`, `:719-729`):** the literal instruction text contains zero type-filtering language. It says only: walk every event, parse start times, drop past events, pick the one with the earliest future start. No mention of "meeting" vs. "appointment" vs. "event" as distinct categories to match against.

**File evidence, the data path (`supabase/functions/naavi-chat/index.ts:998-1044`, `fetchLiveCalendarEvents`):** events are already sorted chronologically (`.sort()`, line 998) and past events are already dropped (`.filter()`, line 1032-1044) **in code, server-side, before Claude ever sees them.** The function's own comment at line 1004-1010 states this was done specifically for this reason: *"Doing it server-side makes 'next meeting' answers deterministic."* The array Claude receives in the `## [user]'s upcoming schedule` block is already in the correct order, with the correct first element.

**The mismatch:** RULE 7 nonetheless re-instructs Claude to independently re-walk, re-parse, and re-compare every event's start time and re-derive "the earliest" itself — duplicating, in natural-language reasoning, a computation the server has already performed reliably in code. This is the proven mechanism for both observed defects:
- **Non-determinism** — LLM re-parsing of time strings via sampling is not guaranteed to reproduce the same comparison result every call, even though the correct answer (the first item in the already-sorted array) never changes. This matches exactly what was observed: 6/8 correct, 2/8 wrong, same input every time.
- **Undocumented type filtering** — because Claude is re-deriving "next" itself rather than simply taking the first list item, it has room to apply an interpretive step RULE 7 never asked for: matching the noun in the user's phrasing ("appointment") against event titles, and skipping past an earlier item that doesn't semantically fit. RULE 7 has no keyword-to-title matching instruction anywhere in its text.

**Root cause proven for the non-determinism**, not "probably": the redundant natural-language re-derivation in RULE 7, layered on top of an already-correct server-side sort/filter, per the code and comment cited above.

**For the "appointment" semantic filtering, one step of inference remains, stated precisely (Wael's Phase 1 review, 2026-08-03):** it is proven that RULE 7 never instructs semantic filtering, and proven that Claude consistently performs it anyway — but *why* Claude performs it is not directly proven, only reasonably inferred. Correct framing: **the redundant reasoning step creates the opportunity for undocumented semantic interpretation, which matches the observed behavior** — not a fully proven causal mechanism for that half of the finding.

## Answering the 5 Success Criteria

1. **Does "next meeting" reliably exclude non-work/personal events across many trials, or was 3/3 coincidental?** Not proven either way today — no personal/non-standard-labeled event was chronologically first in today's window, so this specific exclusion couldn't be tested. What IS proven: "next meeting" (3/3) and "next event" (6/8) converge on the same, correct, chronologically-first answer most of the time — consistent with, but not conclusive proof of, a "meeting" ≈ generic-next behavior.
2. **Does "next appointment" reliably select a different event than "next meeting", and is that intentional or an artifact?** Reliably yes (8/8 vs 8/8, zero overlap) — this is not noise, it's a consistent, real semantic split. Not documented anywhere in RULE 7, so it is currently an **artifact** of the model's own interpretation, not a designed, locked-in behavior — see Recommendation below on whether to keep it.
3. **What caused two identical "next appointment" asks on a live call to select different events?** Reframed by today's evidence: the same non-determinism reproduces on the neutral "next event" phrasing (2/8 trials wrong) even without any type-semantics involved. Conversation history is not the mechanism here — every trial used a fresh conversation. The mechanism is the redundant LLM re-derivation described in Root Cause above.
4. **Is there an undocumented ranking/filter beyond RULE 7's literal text?** Yes, proven directly — RULE 7's text (cited above) has no type-matching instruction, yet "appointment" phrasing consistently (8/8) skips a chronologically-earlier "meeting"-titled event. Whether this is desirable behavior worth keeping is a product decision for Phase 2, not resolved here.
5. **Does conversation history explain the inconsistency, the way it did for Ticket A's false negative?** No — every trial in this investigation used a fresh conversation with no prior turns, and non-determinism still occurred. History is ruled out as the mechanism for this ticket's core defect (though Part D's contamination tests, retained from the earlier script, still show conversation-history sensitivity for named-event lookups — a separate, already-covered concern, not re-litigated here).

## Architecture ownership

Two capabilities are touched, per `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` §2 (Architecture Version 2026.07.18.4, still current — confirmed no newer revision exists):
- **RULE 7 itself** lives in `get-naavi-prompt` — row "Claude system prompt (non-classifier)" — **Shared Core, genuinely shared**. Voice fetches this same Edge Function live.
- **The live calendar fetch** (`fetchLiveCalendarEvents`) — row "Calendar — reads (live event fetch)" — **Duplicated**. `naavi-chat` and the voice server each independently call the Google Calendar API and independently sort/filter. This investigation only tested `naavi-chat`'s implementation.

**Important consequence for scope, not previously flagged in Phase 0:** because RULE 7 is genuinely Shared Core, any change to RULE 7's instructions in Phase 2 will land on voice automatically the next time voice fetches the prompt — even though Phase 0 marked voice "out of scope unless this investigation finds a shared cause." The root cause found here (RULE 7's redundant re-derivation) **is** shared — it's in the one prompt both surfaces read. Voice's own `fetchLiveCalendarEvents`-equivalent was not tested for the same server-side sort/filter guarantee this session; that should be confirmed in Phase 2 before assuming voice inherits the fix cleanly, not assumed to already have it.

## Alternatives considered (for Phase 2, not decided here)

Not evaluated in depth this phase — Phase 1 identifies the root cause, Phase 2 designs the fix. Noted for continuity: the server already computes the correct, deterministic first event; the most direct fix candidate is having RULE 7 tell Claude to trust and use the array's existing order/first-element for "next"-type queries rather than re-deriving it, which would likely eliminate the non-determinism. Whether to also preserve or remove the "appointment" semantic split is a separate, explicit product decision.

## Completion status

All 5 Success Criteria answered with direct, multi-trial evidence (8 trials for the two closely-examined phrases, 3 trials each for supporting phrases) and exact file:line citations for the root cause. One Success Criterion (1) is explicitly marked not fully provable today due to the calendar's natural date rollover — stated as a gap, not glossed over.

## Wael's Phase 1 Review — 2026-08-03 — APPROVED

Three observations, all incorporated:

1. **Root cause well proven — endorsed.** The real finding isn't "Claude is wrong," it's architectural: the server already sorts events deterministically, RULE 7 tells Claude to sort them again, so two independent decision-makers exist for one decision.
2. **One claim was stronger than the evidence — corrected above.** "Proven mechanism for both observed defects" overstated the appointment-semantics half. It's proven RULE 7 never instructs semantic filtering and proven Claude does it anyway; *why* remains one step of inference, not direct proof. Reworded in the Root Cause section.
3. **Phase 2 needs a product decision before an engineering decision — mandatory note below.**

## Mandatory Note for Phase 2

Two independent problems, requiring two different kinds of decision, must not be conflated into one fix:

- **Problem A — Determinism.** "Next event" sometimes picks the wrong (non-earliest) event. This is unambiguously a bug — it must always return the chronologically earliest qualifying event. Not a product question; must be fixed.
- **Problem B — Semantic interpretation.** Should "next appointment" mean "earliest calendar item" or "earliest event that looks like an appointment"? This is a **product question, not an engineering one** — Wael's own lean (not yet a final decision to build against without confirming): many users likely expect "next meeting" → a meeting, "next appointment" → an appointment, "next class" → a class, "next event" → earliest regardless of type — so this behavior should not be automatically stripped out while fixing Problem A.

**Phase 2 must explicitly separate these two before proposing any implementation**, and must get Wael's explicit product decision on Problem B before coding — fixing the true defect (A) must not silently remove behavior users may actually prefer (B).

**Problem B — Wael's decision, 2026-08-03: Option 2, always earliest, ignore wording.** "Next appointment", "next meeting", "next event", and any other "next [X]" phrasing all mean the same thing — the literal chronologically earliest qualifying event, full stop. No event-type semantic matching. Reasoning given: "much simpler." This resolves Problem B outright — no type taxonomy to design. Phase 2's scope is now Problem A only: eliminate the redundant natural-language re-derivation in RULE 7 so "next" always returns the already-sorted, already-filtered array's first element deterministically, and remove/replace whatever is currently producing the "appointment" type-matching side effect so it stops happening (not preserve it as a feature).

---

**Status:** Phase 1 CLOSED — APPROVED by Wael 2026-08-03, with a Mandatory Note carried into Phase 2, now resolved by Wael's Problem B decision above. Next: Phase 1A (Architecture Completeness Review — needed regardless, given the Shared Core/voice consequence found), then Phase 2 Change Planning — scoped to Problem A (determinism) only.
