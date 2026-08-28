# B12k — Phase 1: Problem Definition

**Work item:** [[B12k]] — Naavi is too slow to answer on voice.
**Date:** 2026-08-28
**Phase 0:** `docs/B12K_PHASE0_INTENT_2026-08-28.md`, approved by Wael 2026-08-28 after one rewrite and one return-for-correction.
**Status:** **APPROVED by Wael, 2026-08-28, with explicit deferral — Phase 1 → 1A authorized.** Approved after four returns for correction. **Two measurements are deferred by Wael's decision to the appropriate later authorized phase**, both being unreachable under current read-only access: the greeting's unattributed residual (§9c) and the exact cause of the catastrophic stall (§9d). They are deferred, **not** resolved, and no later phase may treat them as answered. No code written. No fix proposed. No mechanism named.
**Architecture Reference version used:** 2026.07.18.15 (Phase 1A records this formally).

**How to read this document.** Wael's standing instruction is that a statement being well-written or attributed to a rule is not enough. So every claim below is tagged **OBSERVED** (read directly from a log line, a command's output, or source I opened) or **INFERRED** (a conclusion drawn from those). Nothing is asserted as root cause unless it is proven, and where it is not proven this document says so in those words.

---

## 1. What exactly is broken

**There are two defects here, not one, and Phase 0 warned against letting either absorb the other. This investigation confirms they are separable.**

| | **Defect A — the baseline** | **Defect B — the unbounded stall** |
|---|---|---|
| Symptom | **Median turn 8.7 s** against a 5-second bar | A single turn runs 100–140 seconds |
| Frequency | **80 % of turns miss the bar** — 24 of 30, across 14 calls (§9a) | **3.3 % — 1 turn in 30** (§9a). T14 saw a higher rate; the two estimates are not reconciled |
| Caller experience | Slow but working | Indistinguishable from a dropped call |
| Status below | **Dominant contributors identified. Root cause NOT proven** | **Mechanism proven, trigger NOT proven** |

Wael's complaint from prospects is Defect A. The T14 two-minute cases are Defect B.

---

## 2. Evidence

### 2a. New measurement, taken today

**OBSERVED.** Production voice server logs, pulled 2026-08-28 via `railway logs --service naavi-voice-server`. Four complete turns, every timing marker present. This is an independent sample from T14's, on a different call.

| Turn | Total | Context (T0→T2) | T4→T5 | Claude (T5→T6) | T6→T7 | T7→audio |
|---|---|---|---|---|---|---|
| 1 | **139 922 ms** | 127 947 | 6 209 | 4 369 | 723 | 548 |
| 2 | **10 145 ms** | 5 503 | 970 | 2 524 | 707 | 440 |
| 3 | **8 480 ms** | 1 575 | 559 | 3 068 | 771 | 2 506 |
| 4 | **7 467 ms** | 2 431 | 227 | 3 821 | 802 | 186 |

The individual lookups, same sample:

```
searchKnowledgeSpecific — total 122431ms (network 122431ms, parse 0ms, 0 fragments)
searchKnowledgeSpecific — total   4154ms
searchKnowledgeSpecific — total    882ms
searchKnowledgeSpecific — total   1471ms
fetchLiveCalendarEvents —         2908ms
fetchLiveCalendarEvents —          887ms
fetchLiveCalendarEvents —         1377ms
```

> **⭐ SUPERSEDED by §9a — a 30-turn sample across 14 calls.** This four-turn sample is retained because §3c's corrections only make sense against it. Do not draw a rate or a distribution from anything in §2.

**⚠ Limits of this sample, stated before anything is drawn from it.** These four turns come from **one call, which reached an answering machine** — the transcripts are voicemail prompts, not user questions. That affects *what was asked*, not *what the pipeline did with it*: the same functions ran in the same order and were timed by the same markers. It is a four-turn sample and **it is not the trial set** required by Completion Criterion 1. It is used here to locate where time goes, not to establish a rate.

### 2b. What this sample confirms

**OBSERVED — not one healthy turn in this sample came under 5 seconds.** The three non-stalled turns were 7.5 s, 8.5 s and 10.1 s. The chosen bar is a median under 5 s.

**OBSERVED — the T14 shape reproduced.** One turn of four ran 140 s, with 122 s of it inside a single lookup, reported by the voice server's own instrumentation as **entirely network time** (`network 122431ms, parse 0ms`).

---

## 3. Defect A — dominant contributors identified, root cause not proven

**NOT PROVEN.** Two components dominate every healthy turn measured. That they are the dominant contributors is supported by the evidence; that they make the 5-second bar unreachable is **not**, and §3c states why.

### 3a. Context gathering is only partly parallel

**OBSERVED**, `naavi-voice-server/src/index.js`. Five fetches are issued together in a single `Promise.all` at **`:3053`** — live calendar, knowledge, weather, global search, recent emails. Phase 0 already recorded that this is why 16.6 s and 18.3 s do not add to 35 s.

**But four more network round-trips run one after another, after that block and before Claude is called:**

| Order | Call | Line |
|---|---|---|
| 1 | `fetchUserLists` | `:3063` |
| 2 | `_b4xBuildAlertsContext` | `:3331` |
| 3 | `user_settings` REST read (`home_address`, `work_address`) | `:3352` |
| 4 | `fetchCalendarPdfBlock` | `:3415` |

**INFERRED, and this is the part Phase 2 would need to size:** these four are serial with each other and with the parallel block. Their individual costs are **not instrumented** — no `[Timing]` line covers any of them — so this document cannot say how much of the 1.6–5.5 s context window they occupy. **That is a measurement gap, named in §6.**

**A related OBSERVED point about the markers themselves:** the `T4` line at `:3241` prints *"basePrompt ready"*, but three of those four calls happen **after** `T4` and before `T5` at `:3448`. So the `T4→T5` interval is not prompt-building; it is unlabelled context work. In turn 1 it was 6.2 s.

### 3b. The model is Sonnet for anything not trivially classified

**OBSERVED**, `src/index.js:3446`:

```
const claudeModel = (isTrivial || isCalendarListing || isSimpleLookup || hasPersonalLookup)
  ? 'claude-haiku-4-5-20251001'
  : 'claude-sonnet-4-6';
```

All four sampled turns used `claude-sonnet-4-6`, logged at `T5`. **OBSERVED** cost: 2 524 / 3 068 / 3 821 / 4 369 ms, plus first-byte latency of 1 767–3 489 ms measured at `T5a`.

### 3c. The arithmetic, and what it does and does not support

**OBSERVED — per turn, not mixed across turns:**

| Healthy turn | Context (T0→T2) | Claude (T5→T6) | **These two together** | Whole turn |
|---|---|---|---|---|
| 3 | 1 575 | 3 068 | **4 643 ms** | 8 480 |
| 4 | 2 431 | 3 821 | **6 252 ms** | 7 467 |
| 2 | 5 503 | 2 524 | **8 027 ms** | 10 145 |

**What this supports:** on all three turns these two stages are the dominant cost, and on **two of the three** they alone exceed the 5-second bar before TTS, the action layer, or anything else is counted.

**What it does NOT support — and an earlier draft of this document claimed it did:** that the bar is unreachable on this architecture. Three turns from a single answering-machine call is not a distribution. **On turn 3 the two stages summed to 4.6 s, which is under the bar** — so the evidence does not even uniformly point the way the earlier claim did.

> **⚠ Corrected 2026-08-28 on Wael's challenge.** The earlier version read *"those two together are 4.1 s at the very best observed"* and concluded the bar *"cannot"* be met. **The 4.1 s figure was an arithmetic error** — it added the fastest Claude time from one turn to the fastest context time from a *different* turn, producing a number no measured turn actually produced. The real per-turn minimum is 4 643 ms. The conclusion drawn from it was too strong regardless of the arithmetic, for the sample-size reason above.

**The honest statement of this finding:** Sonnet inference and context gathering are the two dominant latency contributors **in all four turns of this sample**. **T14 does not corroborate that split** — it published a stage-level breakdown for one turn only, the 110-second one; its other figures are turn totals. **Whether reducing these two stages is sufficient to reach a 5-second median is not established by three healthy turns**, and §6a names the sample that would settle it.

---

## 4. Defect B — mechanism proven, trigger NOT proven

### 4a. What is proven

**OBSERVED — nothing on this path has a timeout.**

`src/index.js` contains **132** `await fetch(` calls and **3** `AbortController` usages, at `:67`, `:2780` and `:2802`. None of the three is on the turn path.

Specifically, with no timeout and no abort signal:

| Call | Line |
|---|---|
| voice server → `search-knowledge` | `src/index.js:1200` |
| `search-knowledge` → OpenAI embeddings | `supabase/functions/search-knowledge/index.ts:23` |
| voice server → `manage-rules`, in the LIST_RULES action | `src/index.js:13051` |

**PROVEN BY CONSTRUCTION:** an upstream dependency that accepts a connection and then stalls will hold the voice turn for as long as it stalls. There is nothing in this path that converts a slow dependency into a bounded failure. That is why 122 seconds was possible, and why it presented as a dead call rather than a degraded answer.

**This is a statement about the blast radius, not about the trigger.** It explains why a stall becomes catastrophic. It does not explain why anything stalled.

### 4b. What is NOT proven

**Root cause of the stall itself: NOT PROVEN.**

The knowledge lookup crosses three hops — voice server → `search-knowledge` (Shared Core) → OpenAI embeddings API → pgvector RPC (`search-knowledge/index.ts:113`, `:121`). The voice server's measurement covers the whole chain and cannot attribute the delay to any one hop.

**What would close it:** `search-knowledge`'s own Edge Function logs for that timestamp, which would show whether the function was even running. **OBSERVED:** the Supabase CLI available here has no `functions logs` subcommand — it rejects it and lists `list`, `delete`, `download`, `deploy`, `new`, `serve` — so this cannot be pulled from the terminal. It needs either the Supabase dashboard or added instrumentation inside the function, and the latter is a code change this phase does not authorize.

**One thing actively hides this class of failure. OBSERVED**, `search-knowledge/index.ts:37`:

```
  } catch {
    return null;
  }
```

A bare catch on the OpenAI call, returning `null` with nothing logged. If the embedding call fails or is aborted, **no record of it exists anywhere.** This is the pattern AI Coding Discipline #21 forbids. Recorded as a finding about diagnosability, not as a fix proposal.

### 4c. Two candidate explanations, neither adopted

Named so they are not rediscovered as fresh ideas, and explicitly **not** ranked:

1. The OpenAI embeddings call stalled. Untested — see the log gap above.
2. Something at the Supabase edge stalled before the function ran. Untested, same gap.

**Both are INFERENCES with no evidence separating them. Neither is this document's finding.**

### 4d. One observation that is not evidence of anything yet

**OBSERVED:** the production voice server runs in Railway region **EU West** (`railway status`), and points at the production Supabase project `hhgyppbxgmjrwdpdubcx` (`railway variables --kv`).

**INFERRED and NOT MEASURED:** that the physical distance between them contributes materially to per-call latency. Every Edge Function call on the turn path makes that crossing, but **no measurement in this document isolates network transit from upstream processing**, and typical transatlantic round-trip time is on the order of 100 ms, not seconds. **This is recorded as a lead with a measurement attached to it in §6, not as a cause.** It would be easy and wrong to reach for it as an explanation.

---

## 5. Architectural ownership — first pass

Per Phase 1's requirement. **Phase 1A performs the full Cross-Repository Verification and carries the provenance tags; this is the first-pass answer only.**

| Affected capability | Owner (Architecture Reference §0a) | Classification |
|---|---|---|
| The voice turn pipeline, all timing markers, the serial context calls | **Voice** — `munk2207/naavi-voice-server` | **Protected Core** — §4 lists `src/index.js` in its entirety |
| `search-knowledge` | **Shared Core** | Not listed as a row in §2 — see below |
| Live calendar reads on the turn path | **Duplicated** | §2 and ADR 0002 — voice and `naavi-chat` each call the Google Calendar API independently |
| `manage-rules` (LIST_RULES action) | **Shared Core** | Protected Core §4, "Action Rules" |

**Two consequences that matter before any change is designed:**

1. **Calendar reads are Duplicated.** Anything done to voice's calendar fetch does **not** reach mobile, and mobile has the same class of complaint recorded in `project_naavi_latency_issues`. Phase 2's Change Impact Matrix must address both rows.
2. **`search-knowledge` has no row in Architecture Reference §2**, although it sits on the voice critical path and is called by Shared Core. §2 has a row for `global-search` but not for this. **Flagged for Phase 1A** to determine whether this is an Architecture Drift Rule Outcome 3 — a Reference stale before the work started — which would stop implementation until reconciled. **This document does not make that determination.**

---

## 6. Open gaps — what must close now, and what carries forward

**An earlier version of this section created a deadlock and Wael returned it for that.** It said Phase 1 could not complete while any gap remained, while also naming gaps that can only be closed by instrumentation Phase 0 does not authorize — a condition Phase 1 could never satisfy without breaking its own scope. The two categories are now separated.

### 6a. Must close before Phase 1 completes

**All three are achievable without a code change.** Phase 1 stays open until they are answered or Wael rules one deferred.

> **⭐ Investigated 2026-08-28 — results and current status are in §9. Two are closed to the limit of read-only investigation; one is not. Read §9e for the status table.**

| # | Gap | What closes it |
|---|---|---|
| 1 | **The sample is too small.** Three healthy turns from one call cannot characterise an intermittent defect, cannot support §3c's conclusion, and cannot yield the repetition count Completion Criterion 2 requires | **Read-only log collection.** A larger deliberately-collected sample of production turns, pulled the same way this one was. No code change |
| 2 | **The greeting** — 19.5 s in T14, and Phase 0 puts it in scope as a turn the caller waits through | **Read-only code investigation.** **OBSERVED** so far only that it is a different path entirely: `src/index.js:7440` builds it, `:7444` serves it to Twilio as a `<Play>` of a `/tts-play/` URL, so none of §3's findings describe it. No investigation has been done |
| 3 | **Which hop stalls in Defect B** | Requires access to **Supabase dashboard logs** for `search-knowledge` at the §2a timestamps. Not a code change, but not reachable from the terminal — the CLI here has no `functions logs` subcommand. **If those logs cannot be obtained during Phase 1, the gap requires an explicit decision on whether it may be deferred** |

### 6b. Carries forward to a phase that authorizes measurement

**These do not block Phase 1. They bound what Phase 1 is allowed to claim, which is why §3c is stated as it is rather than as a proven root cause.**

| # | Gap | Carried to |
|---|---|---|
| 4 | The four serial context calls (§3a) are uninstrumented — their individual share of the 1.6–5.5 s is unknown | Whichever phase authorizes a code change. Until then Defect A's breakdown stays at the granularity in §3c: two stages, not the sub-steps inside one of them |
| 5 | Whether cross-region transit (§4d) is material | Same. Requires timing a trivial call from inside the voice server against its server-side duration |
| 6 | The 71 s between T7 and T8 in T14's case | Open, unexplained. Not reproduced today — the equivalent interval was 186–2 506 ms across four turns. The LIST_RULES attribution stays unproven, as Phase 0 required |

**The rule this section now follows:** a gap blocks the phase only if the phase has the authority to close it. A gap it cannot close is carried forward **and recorded as a limit on the phase's conclusions** — never used to justify proceeding as though it were closed.

---

## 7. What was considered and set aside

Investigative alternatives, so they are not re-litigated:

- **"Claude is the bottleneck."** Set aside as the explanation for Defect B — 4.4 s of a 140 s turn. **Not** set aside for Defect A, where it is 2.5–3.8 s of a 7.5–10 s turn and one of the two dominant costs.
- **"The two lookups are serial and add up."** Ruled out — `Promise.all` at `:3053`.
- **"It is a Railway cold start."** Not investigated here. `project_naavi_latency_issues` ruled this out in April for a different measurement, and that finding is 132 days old and does not transfer.
- **"It is [[B12j]], the paused-answer defect, being mistaken for slowness."** Cannot be excluded from the T14 numbers by this document. The four turns sampled today carry no pause marker in their logs, so they are not that. Distinguishing the two across a larger sample stays open.

---

## 8. Conclusion of this phase

**Defect A: contributors established on a real distribution. Full root cause still NOT proven.** *(Updated 2026-08-28 from the 30-turn sample in §9a — the paragraph this replaces rested on three turns from one call.)* Across **30 turns and 14 calls the median turn is 8 736 ms and 80 % miss the 5-second bar.** The two dominant stages have medians of **4 389 ms (Claude, Sonnet on 20 of 24 turns)** and **3 364 ms (context gathering on non-trivial turns)** — Claude's median alone is 88 % of the whole budget. The trivial fast path, by contrast, skips context in 2 ms, and the six turns that met the bar are consistent with it.

**What is still not proven:** the sub-structure of the context stage. Four serial network calls (§3a) remain uninstrumented, so *why* that stage costs 3.4 s is unmeasured, and closing that needs a code change this phase cannot authorize (§6b, gap 4).

**Defect B: root cause NOT proven, and the question has moved.** What is proven is that no timeout exists anywhere on the affected path — 132 fetches, 3 abort controllers, none on this route — so any upstream stall is unbounded and presents to the caller as a dead line. **What the 30-turn sample adds (§9d): in the 140-second turn, the Google Calendar lookup took 98 s and the knowledge lookup 122 s *in the same `Promise.all`*, and that pairing repeats on every slow turn and inverts on every fast one.** **That correlation strongly points toward a shared factor and makes an isolated Google-specific or Supabase-specific failure less likely. It does not narrow the cause to any closed list** — concurrent resource contention, event-loop blocking, container scheduling, another common dependency or path, and the behaviour of the measurement itself all remain live, and §9d names why the last of those also puts a limit on every timing figure in this document. **All of this is inference, not proof.** The logs that would test it are not reachable from this machine, verified in both the CLI and Management API routes.

**No fix is proposed. No mechanism is named.** Per Governance §3, Phase 1→1A requires Wael's own separate word.

---

## 9. §6a investigation — results

**Added 2026-08-28**, after Wael accepted the document as written and ruled Phase 1 open until §6a was completed. **§2a's four-turn sample and everything drawn from it is superseded by §9a below.** The earlier numbers are left in place because the corrections in §3c only make sense against them.

### 9a. Gap 1 — the sample. CLOSED

**OBSERVED.** `railway logs --service naavi-voice-server --lines 5000`, pulled 2026-08-28. **30 completed turns across 14 distinct calls** (`[MediaStream] Twilio connected` ×14), against the previous three healthy turns from one call.

**Turn totals, all 30, milliseconds:**

```
1841  2034  2325  2772  2915  3167  5050  7190  7216  7467
7976  8141  8153  8480  8586  8886  8981  8994  9298 10145
11279 11549 13140 15782 17123 18706 19504 21107 28738 139922
```

| Measure | Value |
|---|---|
| **Median turn** | **8 736 ms** |
| Turns under the 5-second bar | **6 of 30 — 20 %** |
| Turns over 5 s | **24 of 30 — 80 %** |
| Turns over 30 s | **1 of 30 — 3.3 %** |
| Fastest / slowest | 1 841 ms / 139 922 ms |

**Stage distributions**, each with its own sample count — the log window cuts turns at both ends, so these are not all the same 30 turns and must not be treated as aligned:

| Stage | n | Median | Range |
|---|---|---|---|
| Claude inference (`Claude took`) | 24 | **4 389 ms** | 1 251 – 14 160 |
| Context gathering (`T2`), non-trivial turns only | 24 | **3 364 ms** | 1 470 – 127 947 |
| Context gathering, trivial fast-path turns | 24 | **2 ms** | — |
| `searchKnowledgeSpecific` | 24 | 1 627 ms | 870 – 122 431 |
| `fetchLiveCalendarEvents` | 23 | 1 305 ms | 737 – 98 022 |
| Model selection | 24 | — | **20 Sonnet / 4 Haiku** |

**What the larger sample establishes that three turns could not:**

1. **The median turn is 8.7 s against a 5-second bar** — 75 % above it. **Four of five turns miss the bar.**
2. **Claude's median alone is 4 389 ms**, which consumes 88 % of the entire 5-second budget before context, TTS or anything else.
3. **The trivial fast path works.** 24 turns skipped context gathering entirely at a cost of 2 ms, and the six turns under the bar are consistent with that path. The problem is what happens when a turn is *not* classified trivial.
4. **8 of 38 turns that entered the pipeline never reached audio dispatch** (38 `T0` entries, 30 `T10`). **Not interpreted here** — the window truncates turns at both ends and callers hang up, so this is recorded as a number to explain, not a finding.

**Sample provenance, stated because it bounds the claim:** 12 of the resolved turns were Wael's own production account and 1 was `robert.esm…`. This is real production traffic, but it is **Wael's testing traffic**, not a broad user population.

### 9b. The repeated-trial set required by Completion Criterion 2

> **⚠ Corrected 2026-08-28 on Wael's challenge. The earlier version of this section derived a "≥ 90 turns" acceptance threshold from a single catastrophic event in 30 turns and presented it as a statistical requirement. It is replaced, not adjusted, because it was wrong in three ways:**
>
> 1. **The rate it rested on is not knowable from one event.** One occurrence in 30 gives a point estimate of 3.3 % whose confidence interval runs from roughly 0.1 % to 17 %. Putting the point estimate into `(1−p)^n < 0.05` yields a number with the appearance of rigour and none of the substance — the same formula across that interval demands anywhere from about 17 trials to several thousand.
> 2. **It claimed a clean run below 90 "is not evidence — it is the expected outcome even with the defect fully intact." That is false.** A clean run is always evidence; the question is its strength, not its existence. Thirty clean turns, if the rate really were 3.3 %, would happen about 36 % of the time by chance — weak evidence, but evidence.
> 3. **Ninety passing trials would not establish Phase 0's "no turn over 30 seconds" as a property of the system.** It would establish that none occurred in ninety turns. Trials cannot buy the first claim.

**What replaces it: a trial set precommitted here, with an explicit statement of what it can and cannot demonstrate.**

**The set — fixed now, before any result exists, per Wael's requirement that the count may not be chosen afterwards:**

| Turn type | Repetitions |
|---|---|
| Opening greeting | 5 |
| Trivial question (the fast path) | 5 |
| Simple lookup | 5 |
| Alerts listing | 5 |
| A turn that gathers calendar and saved notes | 5 |
| A confirmation turn | 5 |
| **Total** | **30 turns** |

**Why 30 and not some derived number:** it matches the size of the baseline distribution in §9a, so the before-and-after comparison is like-for-like rather than comparing a large sample to a small one, and it is achievable in a single testing session. **It is a practical, precommitted number. It is not a statistical threshold and is not presented as one.**

**Reporting rules, also fixed now:** every turn's time is published individually, not only as a summary; median, maximum, count over 5 s and count over 30 s are all reported; the identical set is run against pre-fix and post-fix code on staging.

**What this set can demonstrate:** whether the median moved, and by how much. Thirty turns is enough to see a shift from the measured 8 736 ms to under 5 000 ms if one occurs. **That is the first half of Wael's bar and the trial set answers it.**

**What this set cannot demonstrate:** that turns over 30 seconds have been eliminated. **No trial set of practical size can prove the absence of a rare event**, and this document does not claim otherwise. The set contributes exactly one fact to that half — whether any occurred in 30 turns — and that fact is weak evidence on its own.

**So the catastrophic half needs something other than trials, and Phase 1 does not decide what.** It would need either evidence about the upper bound on how long a turn can take, or observation of production over a window long enough to contain the event at its natural rate — and which of those is even available depends on what is selected later. **Phase 2 owns that question.** What Phase 1 records is that the trial set alone will not answer it, so nobody later mistakes 30 clean turns for proof.

### 9c. Gap 2 — the greeting. PARTIALLY CLOSED

**One cause excluded by measurement; the 19.5 s remains unattributed.**

**OBSERVED — the path.** The greeting is not produced by the turn pipeline. It is TwiML containing `<Play>` of a `/tts-play/<token>` URL (`src/index.js:7444`), and the audio is generated on demand when Twilio fetches that URL, at the route handler `:8867`.

**OBSERVED — TTS generation is fast, across 50 samples:**

```
147 231 323 360 … 465 (median) … 638 642 644 713   ms
```

**Range 147–713 ms. Not one sample reached three quarters of a second.** **Greeting TTS generation is therefore excluded as the cause of a 19.5-second greeting.**

**NOT ESTABLISHED — where the 19.5 s actually goes.** The logs available to me carry no timestamps, so T14's specific event cannot be located in this sample.

**One candidate, OBSERVED in the sample but NOT established as the cause:** the timezone-capture onboarding flow issues **four separate prompt round-trips** before the caller can ask anything — *"Good morning, Wael!"* → *"Wael, what city or time zone are you in?"* → *"Got it — Eastern time. Is that right?"* → *"Nah-vee here, how can I help you Wael?"* Each is its own TwiML round-trip and its own TTS fetch. A caller in that flow waits through all four. **Whether T14's 19.5 s was this flow is unknown.**

**Also OBSERVED:** `:8879` has a pre-generated-MP3 fast path. **It was used 0 times in 50 fetches** in this sample. Recorded as an observation about the code's behaviour, not as a fix.

### 9d. Gap 3 — the stalling hop. NOT CLOSED, and the question has changed

**First, the access question is settled, not assumed.** There is no Supabase access token on this machine — `~/.supabase/access-token` does not exist and `SUPABASE_ACCESS_TOKEN` is unset — so the Management API route is closed as well as the CLI one. **Verified, not inferred.**

**Second, and more important: the larger sample makes the original framing of this gap wrong.**

**OBSERVED.** In the 139 922 ms turn, two lookups ran inside the same `Promise.all` at `:3053`:

```
line 4456:  fetchLiveCalendarEvents  —  98 022 ms
line 4533:  searchKnowledgeSpecific  — 122 431 ms
```

**These call two entirely unrelated upstreams** — Google's Calendar API, and Supabase → OpenAI's embeddings API.

**And the pairing repeats.** Every turn where one was slow, the other was slow; every turn where one was fast, the other was fast:

| Turn | `fetchLiveCalendarEvents` | `searchKnowledgeSpecific` |
|---|---|---|
| log line 4456 / 4533 | 98 022 ms | 122 431 ms |
| log line 725 / 729 | 16 623 ms | 18 345 ms |
| log line 859 / 857 | 13 480 ms | 12 738 ms |
| healthy | 887 ms | 882 ms |
| healthy | 1 377 ms | 1 471 ms |

**INFERRED, and explicitly not proven.** Two independent third-party providers degrading together by a similar factor, repeatedly, **strongly points toward a shared factor, and makes an isolated Google-specific or Supabase-specific failure less likely.** It does **not** identify what the shared factor is, and it does not reduce the candidates to any closed list.

*(Corrected 2026-08-28 on Wael's challenge — this previously said the remaining explanations "sit below both of them — the voice server process, its container, or its network egress," which enumerated three candidates and presented them as exhaustive.)*

**Shared factors that could produce this pattern, as examples and not as a complete set:** concurrent resource contention · event-loop blocking in the Node process · scheduling or CPU starvation in the container · another dependency or network path both calls have in common · **the behaviour of the measurement itself.**

**That last one deserves naming, because it undercuts this document's own evidence.** Every duration here is a `Date.now()` delta taken around an `await`. If the event loop is blocked, the resuming callback runs late and the delta inflates **whether or not the network was slow at all** — which would mean the `network 122431ms` label does not necessarily describe network time. Nothing in this investigation distinguishes a genuinely slow response from a delayed continuation. **That is a limitation of the instrument, and it applies to every timing figure in this document, not only the extreme ones.**

**Consequence for §4c:** its two candidates are made **less likely**, not eliminated — a genuine stall at either provider would still produce a slow lookup, and correlation across two turns' worth of pairs is suggestive, not decisive.

**One measurement was attempted and returns nothing usable — recorded so it is not repeated.** Railway exposes network-flow and DNS logs. Both return `No network flows found` / `No DNS queries found` **with no filters applied at all**, which means the data source is not collecting for this service. **The absence of dropped flows and failed lookups is therefore NOT evidence of a healthy network** — it is an absent instrument. A result that looks reassuring while measuring nothing is exactly the shape this project has been caught by before.

**Consistent with §4a:** the Deepgram TTS call at `:8903` also has no timeout, adding a fourth uninstrumented, unbounded outbound call to the three already listed.

### 9e. Status of §6a after this work

| Gap | Status |
|---|---|
| 1 — larger sample | **CLOSED.** 30 turns, 14 calls. Trial set precommitted at 30 structured turns (§9b) — a practical, precommitted set, **not** a statistical threshold, and it answers the median half of the bar only |
| 2 — the greeting | **PARTIALLY CLOSED.** TTS excluded by 50 measurements; the 19.5 s is unattributed and one candidate is named |
| 3 — the stalling hop | **NOT CLOSED.** Out of reach from this machine, verified in both routes. The larger sample has redirected the question away from any single upstream |

**Two of three are closed to the limit of what read-only investigation can reach. Gap 3 requires a decision on whether it may be deferred, and gap 2's remainder requires the same.**
