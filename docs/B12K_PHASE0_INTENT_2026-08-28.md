# B12k — Phase 0: Intent Approval

**Work item:** [[B12k]] — Naavi is too slow to answer on voice. Typical turns run eight to twenty seconds; twice in one session a turn ran to nearly two minutes and the caller had hung up before the answer existed.
**Date:** 2026-08-28
**Scope:** **VOICE ONLY** — the voice server and the Edge Functions a voice turn calls. No mobile. No schema change proposed.
**Governance:** Full Phase 1–8. Voice orchestration is Protected Core.
**Risk:** **HIGH.**
**Status:** **CORRECTED 2026-08-28 after Wael's review returned it — awaiting his approval of this text.** The first version was approved and then found to misattribute a position to Wael; the rewrite was reviewed by Wael as a set of claims to challenge and returned for three corrections, now applied. No earlier approval carries to this text. See the two sections below. No code written. No mechanism proposed or approved.

---

## What was wrong with the first version, stated before anything else

The first draft of this document contained this sentence in its Constraints section:

> *"Caching is not authorized by this Phase 0. It is the obvious remedy to reach for and it may well be right, but CLAUDE.md's foundational principle is no-cache-by-default and it requires that a cache never silently override fresh data."*

and in the chat message presenting it, Claude called this **"your no-cache principle"** — meaning Wael's.

**Wael challenged it and asked for the reference. The reference does not support the claim.**

The source is `CLAUDE.md:134`, the section headed *"⭐ FOUNDATIONAL PRINCIPLE — NO CACHE, FRESH ALWAYS, USER PICKS (Wael 2026-05-07)"*. What that section actually says:

- `CLAUDE.md:136` — *"The system has no **place-cache**. Every 'alert me at X' goes fresh to Google Places; the user picks every time."*
- `CLAUDE.md:140` — *"**No place-cache.** Fresh Google every time."*
- `CLAUDE.md:151` — *"Does **the table** need a CACHE? **Default answer: NO.** Caches were the source of every place-related bug today. **Only add one if the underlying source has a real performance or rate-limit problem;** if you do, the cache MUST never silently override fresh data — it must surface as a SUGGESTION the user can override."*

**Two errors, both Claude's.**

1. **Scope.** Every sentence in that section is about **place data and new config tables**. It came out of the `user_places` duplicate-Walmart incident, and its own quote is about a saved Ottawa McDonald's shadowing a Toronto one. Claude generalised it into a standing position against caching, which Wael never took.
2. **The erased clause.** `CLAUDE.md:151` contains an explicit exception for *"a real performance or rate-limit problem"* — which is exactly the situation B12k is. Citing the rule while dropping the one clause that applies to this item made the constraint stricter than the source.

**A general reading is also contradicted by shipped code.** The voice server already caches the base prompt in memory across the turns of a call: declared at `naavi-voice-server/src/index.js:9169`, passed in at `:10954`, read at `:3233`, and the `T4` timing line at `:3241` prints `cached=true/false`. That is live today and has never been treated as a violation.

This is recorded here rather than quietly fixed, because the error is the same class as the one that caused this session's earlier reversion: a position attributed to Wael that he did not state.

---

## Corrections required by Wael's review of the rewrite, 2026-08-28

He reviewed the rewrite **as a set of claims to challenge**, not as a document to approve, and returned it. Three corrections, all applied:

1. **The caching constraint is deleted in full** — both *"caching is not authorized by this Phase 0"* and *"approved on its own."* His reasoning: the first is true only trivially, since Phase 0 authorizes **no** mechanism — not parallelisation, not removing redundant calls, not connection pooling, not prefetching — so singling out caching had no basis, and it re-invoked the place-cache rule Claude had just conceded does not apply here. The second **invented a governance gate**: no governance document requires separate approval for a cache beyond the ordinary Phase 2/3 approval of whatever solution is selected. The "What this Phase 0 does and does not authorize" section now names no mechanism in either direction, and the word "caching" was removed from its list for the same reason.
2. **"Claude was not the bottleneck" is narrowed to the turn it was measured on.** The 3.6 s figure is from one 110-second turn and does not support a global claim.
3. **The repeated-trial requirement is strengthened** — Completion Criteria 2. *"Repeatedly"* was vague enough that three lucky trials could have been declared a fix.

He also confirmed two things in the rewrite should stand: the 71-second gap being labelled an observation with the LIST_RULES attribution held back as an unproven inference, and the `Promise.all` correction showing 16.6 s and 18.3 s do not add to 35 s.

**And a standing instruction, recorded here because it governs every phase after this one:** *"a Claude statement being well-written or attributed to a governance rule will not be enough for my approval. I will challenge the underlying claim itself."*

---

## Provenance of every requirement in this document

Wael's instruction on rewriting this document was *"I will read it word by word first, I do not trust your judgement."* This table exists so the attributions can be checked without reading for them.

| Item | Whose |
|---|---|
| The 5-second typical / 30-second maximum bar | **Wael's**, chosen 2026-08-28 as option 2 of three Claude offered. See Success Criteria for the exact exchange. |
| That this item is general slowness, not one outlier | **Wael's**, quoted verbatim on the holding-list row. |
| That B12k is the top priority item | **Wael's**, recorded on the row and confirmed live by the pre-push priority check. |
| The measured timings | **Measured**, from `docs/T14_VOICE_ALERT_REMINDER_TEST_2026-08-28.md`. |
| The code locations | **Verified by Claude** on 2026-08-28 by direct grep. Cited as `file:line`. |
| Everything under In Scope, Out of Scope, Constraints and Completion Criteria | **Claude's proposal**, unless the line itself names Wael. Nothing in those sections is a ruling of Wael's that he has already given. |

---

## Why this item is first

**Wael, 2026-08-28, on the [[B12k]] holding-list row, verbatim:**

> *"One of the main concerns in general is the extreme slow response — I personally received complaints about it from different prospects."*

That sets the shape of the item, and it is why the two-minute cases are **not** the whole of it. Prospects did not complain about a two-minute outlier they never experienced; they complained about how long Naavi generally takes. The row states this in its own words: **a general response-time item, not one outlier.**

B12k took [[T14]]'s slot on the priority list when T14 closed, by the arrangement recorded on the row when it was opened. Confirmed live 2026-08-28 — the pre-push priority check printed `5 of 5 — full: B12k, B11m, B10c, B11l, S2`, with B12k first.

---

## The evidence

**Every turn of one session was timed on voice production, 2026-08-28.** Source: `docs/T14_VOICE_ALERT_REMINDER_TEST_2026-08-28.md`. These are measurements, not impressions.

| Turn | Time |
|---|---|
| *"What reminders do I have?"* | **1.1 s**, and **3.2 s** |
| *"What alerts do I have?"* | **2.0 s**, and **2.3 s** |
| A misheard fragment | **7.2 s** |
| *"Set alert in five minutes…"* | **8.0 s** |
| A confirmation turn | **8.1 s** |
| A Costco arrival request | **17 s** |
| The opening greeting | **19.5 s** |
| *"What alerts do I have?"* | **104 s** |
| *"List me the alerts that I have."* | **110 s** |

### Where the time went on the 110-second turn

From the call log at 05:34, no pause involved (T14 §B):

```
05:34:52  turn starts — "List me the alerts that I have."
05:35:08  fetchLiveCalendarEvents — 16623ms
05:35:10  searchKnowledgeSpecific — 18345ms
05:35:15  [MediaStream] Stream stopped            ← caller hung up, 23s in
05:35:31  T6 Claude stream complete +39188ms      (Claude itself: 3645ms)
05:36:42  T8 TTS stream start +110416ms
05:36:42  [TTS] Cannot stream — WebSocket not open
05:36:42  [Process] TTS stream failed — no audio sent
```

Three things follow from that block. **All three are observations read directly from the log, not inferences:**

1. **On this 110-second turn, Claude's model reasoning accounted for approximately 3.6 seconds, and therefore does not explain the extreme latency observed in this turn.** *(Narrowed on Wael's challenge, 2026-08-28 — this previously read "Claude was not the bottleneck," which is a global claim the evidence does not support.)* Whether model latency contributes materially to the ordinary 8–20 second problem is a separate question and Phase 1's to answer.
2. **The two lookups took 16.6 s and 18.3 s — and the same two lookups on the previous turn of the same call took 1008 ms and 2262 ms.** Same code, same account, same call, ninety seconds apart.
3. **A further 71 s sits between the answer being ready (T7) and the audio starting (T8).**

**One inference, labelled as an inference and not relied on:** T14 attributes that 71 s to the LIST_RULES action executing and rewriting the speech. The log excerpt above does not itself show that. Phase 1 owes evidence for what occupied those 71 seconds; this document does not treat it as established.

### The code these measurements refer to, verified 2026-08-28

| Thing measured | Where it lives |
|---|---|
| `fetchLiveCalendarEvents` | `naavi-voice-server/src/index.js:878`, timing log at `:971` |
| `searchKnowledgeSpecific` | `:1196`, timing log at `:1217` |
| Knowledge fetch selection (broad vs. specific) | `:2984` |
| Calendar and knowledge issued together | `:3053` — a single `Promise.all`, so these two run **in parallel, not one after the other** |
| `T6` / `T7` / `T8` markers | `:3556` / `:12064` / `:13413` |

**That parallelism matters and corrects a natural misreading of the log:** 16.6 s and 18.3 s do not add up to 35 s of waiting. They overlap, and the turn waited roughly the longer of the two.

**The measurements were taken against voice production; this repository's checked-out branch is `staging`. That is not a mismatch.** Verified 2026-08-28 by direct query: `origin/staging` and `origin/main` resolve to the identical tree `b203613be12275f4bb0f8cae75ef017350c45103`, and `src/index.js` is the identical blob `676d02bc…` on both branches. The production numbers describe this code.

### Two properties that make this harder than it looks

**It is intermittent.** The identical question answered in **2325 ms** at 05:48, minutes after the 110 s failure. The row states the consequence and it is adopted here for the whole item: **one fast run is not evidence a fix worked.** Any remedy is measured across repeated trials or it is not measured.

**The caller cannot tell slow from broken.** Two minutes of silence is not a slow answer — it is a failed call. Both two-minute cases ended with the audio failing outright, because the line had already closed. The answer was computed correctly and reached nobody.

### Prior art

`project_naavi_latency_issues` (2026-04-18) records ~15 s on mobile chat and ~20 s on voice for trivial questions and calls it server-fixable. The B12k row states that **this memory has never had a tracked item.** Its investigation suggestions are prior art for Phase 1 to evaluate, not findings to inherit — it is 132 days old and its file references predate several rewrites.

### One live observation, recorded but deliberately not used here

Phase 1 investigation began after the first version of this document was approved, and has already observed one comparable case in production logs. **It belongs to Phase 1 and is not offered as evidence in this document**, which rests on the T14 measurements above. It is mentioned only so that its later appearance in Phase 1 is not a surprise.

---

## User Intent

Naavi should answer a phone call quickly enough that the caller is not left waiting, and should never take so long that the caller hangs up before the answer arrives.

## Success Criteria

**The bar is Wael's, chosen 2026-08-28.** Claude offered three; Wael replied `# 2`. The three, as offered:

1. No call ever exceeds ~30 seconds. Kills the two-minute failures only; typical stays 8–20 s.
2. **Typical answer under 5 seconds, and no call over 30 seconds.** ← **chosen**
3. Typical under 3 seconds, and no call over 30 seconds.

Written out:

1. **A typical voice turn completes in under 5 seconds**, measured as the median across a fixed, repeated trial set — not a single good call.
2. **No turn in the trial set exceeds 30 seconds.**
3. Success is demonstrated **across repeated trials**. A single fast run is explicitly not acceptable evidence.
4. **Nothing Naavi says changes as a side effect.** Answers stay as correct and as complete as they are today. *(Claude's proposal, not Wael's ruling — it is here to stop the metric being met by making Naavi say less.)*

**What is measured, from the caller's point of view:** the gap between the caller finishing speaking and Naavi's audio beginning. The opening greeting (19.5 s in the session above) counts as a turn, because the caller waits through it. **Phase 1 owes the exact mapping of that definition onto the existing `T`-markers**, which do not necessarily begin where the caller stops speaking. The definition is the contract; the instrumentation is Phase 1's problem.

**On the 3-second bar:** it was option 3, offered and not chosen. If Phase 1 finds 3 seconds reachable, hitting it also satisfies option 2 — the chosen bar is a floor on acceptability, not a cap.

## In Scope

*Claude's proposal.*

- `naavi-voice-server/src/index.js` — the turn pipeline, including the two lookups above, the T7→T8 region, and the greeting path.
- The Edge Functions a voice turn calls, where they sit on the measured critical path. **Naming them here authorizes investigating them, not changing them.** A Shared Core function is used by mobile too, and any change to one must be traced against every consumer per Phase 2's Regression Matrix.
- **Measurement instrumentation sufficient to prove the criteria across repeated trials.** A fix that cannot be measured cannot be shown to work.
- An auto-tester regression test per Rule 15a.

## Out of Scope

*Claude's proposal.*

- **Mobile chat latency.** The April memory covers mobile too, at ~15 s. This item is voice. If Phase 1 finds a shared cause, that is a finding to raise on its own under Rule 1b — not a licence to widen this item.
- **The AAB 325 delay** (`docs/SESSION_HANDOFF_2026-08-28_AAB325_DELAY_NEXT.md`). Different surface, different symptom, unsolved. It must not be folded into this item or explained by it.
- **The other four items T14 opened** — B12h, B12i, B12j, B12l. B12j in particular produces silence a listener could mistake for slowness; telling them apart is Phase 1's job, fixing B12j is not.
- **Speech-to-text mishearing** (T14 §C, *"Me hello."*). A separate shape with its own existing memories.
- **Shortening or simplifying what Naavi says** as a way of hitting the number.
- **Production deployment.** Staging first.

## Constraints

*Claude's proposal, except where a source is named.*

- **Staging only** until Wael explicitly says otherwise — voice branch `staging`, Supabase `xugvnfudofuskxoknhve`. Source: CLAUDE.md, STAGING-FIRST.
- **Protected Core: full Phase 1–8**, with Wael's own separate word required at every phase transition; a reviewer's "Approved" is never authorization. Source: `docs/AI_DEVELOPMENT_GOVERNANCE.md` §3, Phase-Gate Approval Rule. The Architecture Reference §4 lists `naavi-voice-server/src/index.js` in its entirety as Protected Core, reason given there as *"Controls every phone call; a mistake here is heard live by a real caller with no undo."*
- **Any future voice production promotion is simultaneously a demo-line release**, because 1-888-91-NAAVI runs on the production voice server itself. Source: Architecture Reference §0b and §0d. A property of promoting this item, to be planned for rather than discovered.
- **The Non-Determinism Rule applies** to any classifier or prompt change: minimum 3 independent trials per behaviour-changing case. Source: Governance §3, Phase 3.
- **Rule 15a:** the regression test exists, is registered, and passes before this item is done.
- **Repeated-trial measurement**, per the row's own rule.

## Completion Criteria

*Claude's proposal.*

1. A defined trial set of representative voice turns — including the greeting, a simple lookup, and a turn that gathers calendar and saved notes — run repeatedly on **staging**, every turn timed.
2. **Phase 1 must define and justify the number of repetitions sufficient to test the observed intermittent latency; the trial count may not be selected after seeing the results.** *(Wael's requirement, 2026-08-28.)* The defect is intermittent — the same operation measured 1.0 s and 16.6 s ninety seconds apart — so a small favourable sample would show a fix that is not there. Phase 0 does not invent the number; Phase 1 derives it from the measured variance and fixes it before the trials run.
3. That trial set shows a **median under 5 seconds** and **no single trial over 30 seconds**.
4. The same trial set run against the pre-fix code is on record as the baseline. Without it there is nothing to compare against.
5. A regression test in `tests/catalogue/`, registered in `tests/runner.ts`.
6. `npm run test:auto` green against **staging** — env banner read and recorded, per the Cross-Cutting Change Parity Check.
7. Architecture Reference updated in this same work item if anything architectural changes. Reference version at the time of this draft: **2026.07.18.15**. Phase 1A records it formally; Phase 8 re-checks it.

---

## What this Phase 0 does and does not authorize

**Authorizes, on Wael's approval of this text:** the Phase 0→1 transition, and Phase 1's investigation — reading logs, timing turns, and measuring where the time actually goes.

**Does not authorize:** any code change, **any mechanism whatsoever**, any deploy, any production promotion, or drafting the Phase 2 document. Per Governance §3, each transition needs Wael's own separate word.

**No mechanism is named here, favourably or unfavourably.** Caching, parallelisation, removing redundant calls, connection pooling, prefetching — none is authorized, and none is singled out. Whether a proposed mechanism conflicts with any architectural freshness requirement is a question for the phase that proposes it, against that specific proposal.

---

## One thing Phase 1 must not assume

**The two-minute case and the eight-to-twenty-second case may not have the same cause.** They are one work item because they are one user-visible complaint — Naavi is too slow — and the chosen bar covers both. But 16.6 s on a lookup that took 1.0 s ninety seconds earlier is a **variance** problem, while a turn that reliably takes 8–20 s is a **baseline** problem, and those are different shapes of defect. Phase 1 states which it has evidence for, separately, and does not let one explanation absorb the other because it arrived first.
