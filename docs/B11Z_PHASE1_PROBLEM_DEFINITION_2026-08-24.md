# B11z — Phase 1: Problem Definition

**Work item:** [[B11z]] — Naavi names the competitor twice and hedges when asked how she differs
**Date:** 2026-08-24
**Phase 0:** `docs/B11Z_PHASE0_INTENT_2026-08-24.md` — approved by Wael, 2026-08-24
**Status:** **DRAFT — awaiting Wael's Phase 1 → Phase 1A approval.** No code written. No mechanism selected.

---

## ⭐ The three things Phase 1 established that change this item

1. **Production is affected, identically.** Phase 0 listed this as unknown and warned that "probably" is not evidence. It was tested. It is affected.
2. **Both defects generalise to every competitor** — ChatGPT, Siri and Alexa all produce two mentions, at the *same positions*.
3. **The two defects have different blast radii.** Defect A reaches **voice, including the public demo line**. Defect B does not — it is mobile-backend only.

---

## 1. What exactly is broken

Two independent defects, in two different files, that happen to surface in the same answer.

| | Defect A | Defect B |
|---|---|---|
| **Symptom** | Competitor named twice, not once | Confident answers get an uncertainty disclosure appended |
| **File** | `get-naavi-prompt` | `naavi-chat` |
| **Surfaces** | **Mobile + Voice** (incl. demo line) | **Mobile-backend only** |
| **Caught by the failing test?** | Yes | **No** |

---

## 2. Evidence

### 2.1 Measured — both environments, five question shapes

Live calls to `naavi-chat`, 2026-08-24. **Observation, not inference.**

**STAGING** (`xugvnfudofuskxoknhve`):

| Question | Hedge (B) | Competitor mentions (A) | Numbered points |
|---|---|---|---|
| "what's the difference between you and ChatGPT" | **YES** | **2** | **7** |
| "what can you do" | no | 0 | 0 |
| "how do you work" | no | 0 | **7** |
| "tell me about yourself" | no | 0 | **7** |
| "what makes you different from Siri" | **YES** | **2** | **7** |

**PRODUCTION** (`hhgyppbxgmjrwdpdubcx`), same question:

| Question | Hedge (B) | Mentions (A) | Points |
|---|---|---|---|
| "what's the difference between you and ChatGPT" | **YES** | **2** | **7** |

**Production and staging behave identically.** The unknown Phase 0 flagged is now closed: **this is live for real users, on both environments, right now.**

### 2.2 Defect A generalises — and the positions prove it is systematic

| Competitor | Mentions | Position (% through the answer) |
|---|---|---|
| ChatGPT | 2 | — |
| Siri | 2 | **9%, 88%** |
| Alexa | 2 | **9%, 88%** |

**Identical positions across different competitors is not variation — it is a template being followed.** One mention early (the "brief contrast"), one at the close.

### 2.3 Defect B's trigger — confirmed, not guessed

The regex match was captured directly from the live response:

> `"I don't just discuss your schedule — I work with it"`

**That is rhetorical emphasis, not uncertainty.** It fired on **3 of 3** comparison questions and **0 of 3** non-comparison ones — because the comparison answer is the one that reaches for that construction.

---

## 3. Root cause

### Defect A — PROVEN as a contradiction; causation is strong inference

`get-naavi-prompt` contains two instructions that cannot both be satisfied:

| Line | Text | Commit | Date |
|---|---|---|---|
| `:262` | *"…plus **a brief contrast if comparing to a named competitor**…"* | `23713f6` | **2026-08-06** |
| `:287` | *"The competitor's name appears **EXACTLY ONCE** in the whole answer: the final sentence. **Nowhere else**"* | `0bb49c8` | **2026-08-14** |

The only competitor phrasing the prompt supplies anywhere is the closing line (`:313`). Asked for a contrast, Claude has nothing else to reach for — so it uses that line early, then again as the closer.

**The v4 rewrite did not update the older rule 25 lines above it.** The regression test locking v4 in shipped in the same commit, so for ten days the test has asserted one rule while the prompt carried two.

**Labelled honestly:** the contradiction and its dates are **observation**. That it *causes* the doubling is **inference** — strong, and consistent with the 9%/88% template across three competitors, but Phase 2 should confirm by removing the contradiction and re-measuring.

### Defect B — PROVEN

`naavi-chat:4471` gates the wrapper on:

```ts
/\bi\s+(don'?t|cannot|can'?t|am\s+not\s+sure|have\s+no\s+way|have\s+no\s+access|don'?t\s+have\s+(access|real.time))\b/i
```

**The regex tests for a surface string, not for uncertainty.** `"I don't know"` and `"I don't just discuss your schedule — I work with it"` are indistinguishable to it. The second is a confident claim.

`naavi-chat:4473` then appends three phrases the prompt bans in four separate places (`get-naavi-prompt:1192`, `:1412`, `:1413`, `:1414` — each says *NEVER*).

**And `naavi-chat:2212` carries a comment complaining that Claude hedges "despite the prompt rule" — while the same file appends the phrase itself 2,261 lines later.** The prompt was hardened three times against a behaviour the code was producing.

### ⭐ 3.1 A third finding, outside this item's scope

**Seven numbered points appeared on 4 of 5 questions — including "how do you work" and "tell me about yourself", which are not comparison questions.**

That violates both count rules: the comparison rule's 3-4 (`:291`) and the general capability rule's *"N = the number asked for, or 2-3 if unspecified"* (`:262`).

**Not explained by Defect A**, and not caused by Defect B. It is a separate defect in the capability answer's length discipline, and it affects the most common "what can you do" question shape.

**Not in scope for B11z** — Phase 0 scoped this item to the comparison answer. **Recommend opening it separately.** Phase 2 must not quietly fix it, and must not let its own changes be judged by whether point counts improved.

---

## 4. Alternatives considered

| # | Alternative | Status |
|---|---|---|
| 1 | Delete the uncertainty disclosure entirely | **Rejected.** It exists deliberately, for genuine uncertainty. Phase 0 puts this Out of Scope. |
| 2 | Broaden the regex's exclusions (e.g. negative-lookahead for "just") | **Open, but weak.** Patches one phrasing; the next rhetorical construction fires it again. Treats the symptom. |
| 3 | Gate the disclosure on something other than string-matching the speech | **Open.** The information about whether Claude was uncertain exists upstream of the text. |
| 4 | Fix the prompt contradiction only | **Insufficient alone.** Closes A, leaves B live on every confident Path B answer. |
| 5 | Strengthen `:287` further | **Rejected.** `:287` is already emphatic. The problem is not weak wording — it is a second instruction pulling the other way. |

**Phase 1 does not choose.** Note only that A and B are independent: either can be fixed without the other.

---

## 5. Architecture ownership

| Question | Answer | Source |
|---|---|---|
| Owning component | **Shared Core** — `munk2207/naavi-app/supabase/functions/*` | Reference §0a |
| Defect A's capability | *"Claude system prompt (non-classifier) — `get-naavi-prompt` (Shared Core). **Genuinely shared — voice fetches this Edge Function live, same bytes mobile uses**"* | Reference §2 |
| Defect B's capability | `naavi-chat` — **Protected Core** ("Action Rules", Full Phase 1-8) | Reference §4 |
| Voice affected by A? | **YES** — *freshly verified: `naavi-voice-server/src/index.js:1918` fetches `get-naavi-prompt` live.* **This includes the public 1-888-91-NAAVI demo line, which runs on the voice production server** (Reference §0b) |
| Voice affected by B? | **NO** — *freshly verified: `grep` for "best reading", "verify this from a live source" and `_genuinelyUncertain` in `naavi-voice-server/src/index.js` returns **nothing**.* Mobile-backend only |

**Architecture location: PROVEN.**

**The asymmetry is load-bearing for Phase 2:** a `get-naavi-prompt` change ships to voice the instant it deploys, with no voice deploy and no client build. A `naavi-chat` change does not touch voice at all. **These two fixes have different blast radii and must not be reasoned about as one change.**

---

## 6. Carried into Phase 1A / Phase 2

1. **Confirm Defect A's causation** by removing the contradiction and re-measuring — 3 trials minimum per the Non-Determinism Rule.
2. **Decide Defect B's mechanism** — alternatives 2 or 3 above, or another.
3. **A prompt change reaches voice immediately.** Any Phase 2 plan must state what it does to the voice answer, and the demo line.
4. **Test coverage for Defect B**, which no test currently has.
5. **The seven-point finding (§3.1)** — Wael's call whether to open it.
6. **The Non-Determinism Rule binds** every behaviour-changing case: min. 3 independent trials, full distribution reported in Phase 5.

---

## 7. What this document authorizes

**On Wael's approval:** the Phase 1 → Phase 1A transition.

**Does not authorize:** any code change, any prompt edit, any mechanism selection, any deploy, or drafting Phase 2.
