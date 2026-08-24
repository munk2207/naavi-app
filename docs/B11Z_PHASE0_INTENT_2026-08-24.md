# B11z — Phase 0: Intent Approval

**Work item:** [[B11z]] — Naavi names ChatGPT twice and hedges when asked how she differs from it
**Date:** 2026-08-24
**Scope:** **Shared Core** — `get-naavi-prompt` and/or `naavi-chat`. Both Protected Core.
**Governance:** Full Phase 1–8. **Prompt change → the Non-Determinism Rule binds** (min. 3 independent trials per behaviour-changing case, full distribution in Phase 5).
**Risk:** **MEDIUM.** Nothing is broken functionally, but this is the answer given in a YouTube demo, and it is the single test blocking Gate 1 for every future mobile build.

**Status:** **DRAFT — awaiting Wael's Phase 0 approval.** No mechanism approved. No code written.

---

## 1. Why this exists, and why it is being done first

`prompt-regression.comparison-chatgpt-single-mention` fails. Rule 15 makes a 100% green `test:auto` a prerequisite for **every production AAB**, so this one test **blocks the next mobile build** — including [[B11y]]'s client half.

Wael's sequencing decision, 2026-08-24: do B11z first so nothing downstream is blocked. Correct — and the argument I initially framed as a caveat ("I don't know how big it is") is in fact an argument *for* going first: the unknown only shrinks by investigating, and deferring delays the discovery rather than the work.

**Found 2026-08-24** by the full Gate 1 suite during [[B11x]] Phase 5. Not user-reported. **Proven not to be B11x** — `naavi-chat` was deployed to staging 2026-08-13, eleven days before that work. **Reproduced 3/3** per the Non-Determinism Rule; consistently reproducible, not flaky.

---

## 2. What Naavi actually says

Asked *"what's the difference between you and ChatGPT"*, the reply was:

> **Here's my best reading:** I'm built around your personal operational life — bringing your calendar, contacts, alerts, and follow-through together. **ChatGPT answers questions about the world. I answer questions about your world.**
>
> Here's what sets me apart:
> 1. … **[seven numbered points]** … 7. Travel time. …
>
> **ChatGPT answers questions about the world. I answer questions about your world.** **— I can't verify this from a live source right now. Does that work, or would you like me to try a different approach?**

**Four separate violations of the rule that governs this answer:**

| Rule | `get-naavi-prompt` line | Violated how |
|---|---|---|
| Competitor named **exactly once**, final sentence only | `:287`, `:313` | Named **twice** — the closer appears at the top *and* the bottom |
| Open with Naavi's purpose, **no competitor mention** | `:289` | Opens with the closer |
| **3-4** numbered points | `:291` | **Seven** |
| Closing line last, **"nothing after it"** | `:313` | A hedge is appended after it |

---

## 3. ⭐ Two distinct defects, not one

### Defect A — the prompt contradicts itself, and the dates show how

**`get-naavi-prompt:262`** (the SHAPE rule) tells Claude the `speech` field is one sentence per capability *"**plus a brief contrast if comparing to a named competitor**"*.

**`get-naavi-prompt:287`** tells Claude the competitor's name appears *"EXACTLY ONCE in the whole answer: the final sentence. **Nowhere else**"*.

**These cannot both be satisfied.** Asked for a contrast, the only competitor phrasing Claude is given anywhere in the prompt is the closing line — so it uses that line for the contrast, then uses it again as the closer. **Two mentions, exactly as observed.**

*Verified from git:*

| Line | Commit | Date |
|---|---|---|
| `:262` "plus a brief contrast…" | `23713f6` | **2026-08-06** |
| `:287`/`:313` the v4 exactly-once rule | `0bb49c8` | **2026-08-14** |

**The v4 rewrite eight days later did not update the older SHAPE rule sitting 25 lines above it.** The test locking in v4 was written in the same commit — so the test has been asserting one rule while the prompt carried two.

**Status: strong hypothesis, NOT established.** The contradiction is proven; that it *causes* the doubling is inference. Phase 1 must confirm.

### Defect B — ⭐ the code injects the exact phrases the prompt forbids

This is the one worth Wael's attention, and it is **not** what the test was written to catch.

**`naavi-chat:4473`:**

```ts
speech = `Here's my best reading: ${speech} — I can't verify this from a live source right now. Does that work, or would you like me to try a different approach?`;
```

**The prompt bans all three of those phrases, in three separate places:**

- `get-naavi-prompt:1192` — *"NEVER SAY 'Here's my best reading' or 'I can't verify this from a live source.' These phrases expose internal technical limitations and confuse the user."*
- `:1412` — *"'Here's my best reading' — NEVER."*
- `:1413` — *"'I can't verify this from a live source' — NEVER."*
- `:1414` — *"'Does that work, or would you like me to try a different approach?' — NEVER after a search."*

And `naavi-chat:2212` carries a comment complaining that *"Claude hedges with 'Here's my best reading' despite the prompt rule"* — **while the same file adds the phrase programmatically 2,261 lines later.**

**Why it fired here.** The wrapper is gated on `_genuinelyUncertain` (`:4471`):

```ts
/\bi\s+(don'?t|cannot|can'?t|am\s+not\s+sure|have\s+no\s+way|have\s+no\s+access|don'?t\s+have\s+(access|real.time))\b/i
```

The answer contains *"**I don't** just discuss your schedule — I work with it."*

**That is rhetorical emphasis, not uncertainty.** The regex cannot distinguish *"I don't know"* from *"I don't just X — I do Y"*, so a confident contrastive sentence triggers an uncertainty disclosure.

**Status: mechanism proven by reading; the specific trigger is high-confidence inference.** Phase 1 confirms which sentence matched.

**Severity, stated plainly: Defect B is worse than the test failure.** It is deterministic, it fires on any confident answer using that common construction, and it puts *"I can't verify this from a live source"* in front of a real user — the precise thing three prompt rules were written to prevent. **The test that failed does not test for it.**

---

## 4. User Intent

When someone asks how Naavi differs from another assistant, Naavi should answer the way Wael specified over four live rounds: her own specialization, the competitor named once at the end, no hedging.

And more broadly: **Naavi should not say things the prompt explicitly forbids because the code appended them.**

## 5. Success Criteria

1. The competitor is named **exactly once**, in the closing sentence.
2. The answer uses **3-4** numbered points, not seven.
3. **No hedging wrapper** on a confident answer.
4. The uncertainty disclosure still appears when Naavi is **genuinely** uncertain — this is a real feature and must not be deleted wholesale.
5. `prompt-regression.comparison-chatgpt-single-mention` passes, **Gate 1 returns to green**, and mobile builds unblock.
6. A regression test covers Defect B specifically — a confident answer containing *"I don't just…"* must not be wrapped.

## 6. In Scope

- `get-naavi-prompt/index.ts` — the `:262` / `:287` contradiction.
- `naavi-chat/index.ts` — the `:4471` trigger and the `:4473` wrapper.
- Regression tests for both defects.

## 7. Out of Scope

- Any other prompt rule not implicated by these two defects.
- **Deleting the uncertainty disclosure entirely.** It exists deliberately; the defect is that it fires on confident answers.
- [[B11y]], [[B12a]], and the two prompt findings from B11x's Phase 0 ("senior" in three prompts, `${todayISO}` in a cached block).

## 8. Not established — Phase 1 must settle, do not assume

1. **Whether production is affected.** Only staging was tested. Both projects have `get-naavi-prompt` deployed within six seconds of each other, so it probably is — **but "probably" is not evidence**, and Phase 1 must check directly.
2. Whether Defect A alone explains the doubling, or whether Claude also over-generates points independently (seven vs 3-4 is not explained by the contradiction).
3. **How often Defect B fires in normal use.** The regex is broad; *"I don't"* is extremely common. This may be affecting far more than comparison questions — the test only caught it here because this is where an assertion happened to exist.
4. Whether the fix belongs in the prompt, the code, or both.

## 9. What this document authorizes

**On Wael's approval:** the Phase 0 → Phase 1 transition, and Phase 1's investigation only.

**Does not authorize:** any code change, any prompt edit, any deploy, or drafting Phase 2.
