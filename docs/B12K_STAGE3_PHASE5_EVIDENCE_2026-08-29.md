# B12k — Stage 3: Phase 5 Evidence Package (Stages 3a and 3c)

**Work item:** [[B12k]] — Naavi is too slow to answer on voice.
**Date:** 2026-08-29
**Covers:** **Stages 3a and 3c only.** Stage 3b was ruled out by the baseline; Stage 3d was closed by Wael.
**Status:** **RESUBMITTED after the reviewer returned it for "actual failure-path validation only."** That validation was performed, and it did not confirm the design — **it dismantled it.** See §4a, which is the most important section in this document. **Stage 3c is now materially smaller than the version this package first described.**

**Why this document exists at all, and it is not a formality.** The earlier Phase 6 states in its own header that it *"covers Stages 1 and 2 only"*, and lists two commits — `e2dcb0f` and `49de2c6`. **Neither is `2583b9c`**, which carries Stages 3a and 3c and was pushed after that review was approved. **Wael caught this**; the task list I wrote had a "closure record" where four governed phases belonged, treating Phase 3's conditional authorization as if it carried the work all the way through. It authorized the change, not the review of the change.

---

## 1. Summary

Two changes to one file, both authorized by Phase 3 §4 branches that the measurements selected.

**Stage 3a — branch A2.** Conversational check-ins added to the trivial fast path. **Nothing else moved.**

**Stage 3c — branches C1/C2.** Bounds on the three authorized call sites, each with an honest failure path.

**Measured effect, live on staging:**

| Turn | Before | After |
|---|---|---|
| *"Are you there?"* | 6.76 s | **3.05 s** |
| *"What is my home address?"* | 7.24 s | **6.49 s**, answer unchanged and still honest |

---

## 2. Files changed

| File | Repository | Branch | Commit | Change |
|---|---|---|---|---|
| `src/index.js` | `munk2207/naavi-voice-server` | `staging` | **`2583b9c` … `fb6546c`** | **+102 / −4 net** |

**Seven commits, because the validation changed the design three times:**

```
2583b9c  Stages 3a and 3c: fast path, and bounded outbound calls
ccd4b5a  make the bound settable so the failure path can be validated
865966d  make the honest failure path mechanical, not instructed
45cce8b  make the unreachable-source path generic, not notes-specific
842cb6b  drop the pronoun from the unreachable-source message
9677929  replace the answer when the question needed the unreachable source
fb6546c  remove the failure-message machinery, keep the bound
```

**The last commit removes most of the five before it.** That history is left intact rather than squashed: each step was approved on evidence available at the time, and each was superseded by evidence that arrived after.

**All five removed lines were replaced by their bounded or extended equivalents:**

```
-    const res = await fetch(`${SUPABASE_URL}/functions/v1/search-knowledge`, {
-  const trivialRe = /^\s*((?:what(?:'s| is) )?(?:my name|the time|…
-  if (knowledge) {
-    const dgRes = await fetch(`https://api.deepgram.com/v1/speak?model=${voice}&encoding=mp3`, {
-          const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-rules`, {
```

**No file outside this one was touched.** No Edge Function, no mobile file, no shared prompt.

---

## 3. Stage 3a — what changed and why the boundary is where it is

**Branch A2 fired**, not A1. The controlled comparison (2026-08-29, three trials per case, both arms forced explicitly because the classifier's own routing proved unstable):

| Turn type | Sonnet | Haiku | Quality |
|---|---|---|---|
| Check-in | 6.76 s | **3.28 s** | Equivalent |
| **Lookup** | 7.24 s | 3.61 s | ❌ **stated the WORK address as the home address, 3 of 3** |
| Calendar + notes | 5.68 s | 3.34 s | Equivalent — **already on Haiku** |
| **Open question** | 8.9–13.2 s | 8.09 s | ❌ **truncated at `max_tokens`, 3 of 3** |

**Haiku was faster on every type and wrong on two.** Branch A2 authorizes extending only to classes where quality held. Of those, calendar listings already used Haiku — **so check-ins were the only expansion available.**

**Five phrasings added:** `are you there`, `are you still there`, `can you hear me`, `you there`, `are you listening`.

**The rule the comment states, and the test enforces: the fast path may hold phrases that ASK FOR NOTHING.** A check-in cannot be mistaken for a question about the caller's data. That is the entire safety argument, and it is why the lookup case above must never be allowed onto this path.

**An effect larger than predicted, and worth recording because it was not designed for.** The saving was 3.7 s, not the ~3.5 s the model difference alone predicted. `isTrivial` does two things: it selects Haiku **and skips the calendar and knowledge fetches entirely** (`[askClaude] Trivial query — skipping calendar & knowledge fetch`). The check-in now avoids both. **The fast path is a context skip as much as a model choice**, which the Phase 3 analysis did not state.

---

## 4. Stage 3c — the bound is the easy half

**Three sites bounded at 10 seconds**, exactly the three Phase 3 §4c authorized:

| Site | Function |
|---|---|
| `_b12kFetchBounded('searchKnowledgeSpecific', …)` | the call measured at **122 431 ms** in production |
| `_b12kFetchBounded('LIST_RULES manage-rules', …)` | the alerts listing |
| `_b12kFetchBounded('tts-play deepgram', …)` | on-demand TTS |

**Nothing inside `search-knowledge` was touched** — Phase 3 forbade it, because that function has three callers including the mobile client.

**10 seconds is derived, not chosen.** The baseline measured the knowledge lookup at **870–6 050 ms across 24 samples**. Ten seconds sits above healthy and inside Phase 0's 30-second ceiling: two bounded lookups plus Sonnet's 4.3 s median lands near 16 s.

### 4a. ⭐ The failure-path validation — what it found, and what it removed

**The reviewer returned this package with one requirement:** inject the timeout through the staging conversational path and observe the actual answer. *"The automated test proves the bound fires and proves the prompt contains the safety instruction. It does not prove the resulting Naavi response obeys it."*

**That was correct, and it found four things in sequence.**

**1. The instruction was ignored.** With the bound injected at 1 ms, everything built worked — the bound fired, the sentinel returned, the honest-failure section reached the prompt intact:

```
[Timing] searchKnowledgeSpecific — BOUND FIRED at 1ms
[Claude] Knowledge section included: YES (343 chars)
  "You do NOT know whether the user has notes on this subject. Do NOT say they have none."
```

**Naavi then said: "I don't have that information in your records."** Seven passing tests, a working sentinel and a correct prompt section all sat on top of that, because every one of them tested that the instruction **existed** and none tested that she **obeyed** it.

**2. A mechanical prefix produced a contradiction.** Replacing instruction with construction gave *"I couldn't reach your saved notes just now… I don't have that information in your records."* — true first, absence-claim second.

**3. The gate meant to fix that was far too broad.** Restricting the replacement to turns that "needed" the notes used `isRetrievalQuery`, whose pattern matches `what is` — so *"What is the weather like today?"* counted, and **the weather answer was destroyed**. Found only because both halves were tested; the retrieval half alone looked like a clean pass.

**4. Neither available signal can make that judgement.** `isRetrievalQuery` fires on nearly everything; `isKnowledgeQuery` matches almost nothing and would miss *"When is the first day of school?"*, which genuinely does depend on notes. Deciding in advance whether an answer needs the notes is the same unsolvable classification Wael had already identified about hard-versus-easy questions.

### ⭐ Then the premise itself turned out to be wrong

**Wael's ruling, 2026-08-29:**

> *"If Naavi said I do not have the information, [it] does not mean that Robert does not have the information or the information does not exist, it simply means Naavi does not have the resources to answer. Nothing more."*

And on why she should not narrate her own plumbing:

> *"Robert asks about the school, he does not care if Naavi searches a note or cloud — focus on what he asked about, not what Naavi is doing."*

**The sentence this stage spent hours trying to prevent was honest all along.** It describes her reach, not his data.

**And the decisive evidence arrived last, when Wael stopped the verification to ask whether she would still say it.** The same question, with the lookup **succeeding normally**, returns the identical sentence:

> *"I don't have that information in your records. Forward the school calendar email to yourself and I'll pick it up automatically."*

**Word for word what she said when the lookup timed out.** So there was never a distinct failure case needing distinct phrasing — the caller hears the same true thing either way, and every layer built to separate them was inventing a distinction he has no use for.

### What was removed

The sentinel, the per-turn list of unreachable sources, the formatter, the prompt section, the spoken prefix, and the retrieval-gated replacement. **Four tests went with them.**

**What remains is the bound**, which was right the first time and needed none of it.

**The reasoning is preserved in both the voice server and the test file** rather than deleted silently, so the next person who thinks Naavi should announce her own lookup failures meets the argument before rebuilding it. Both also record the line that **would** still be false — one asserting the caller has nothing, such as *"your records are empty"* — so removing the imaginary boundary does not erase the real one.

### ⭐ The transferable lesson

**Every test passed at each step, and the design was wrong at every step.** The tests verified that the code did what I had decided it should do. Only two things exposed the error: running it end-to-end against a real turn, and Wael asking what the caller would actually hear.

---

### The original constraint section, retained

*(Kept because the reasoning below is what the validation tested and disproved. Superseded by §4a.)*

### ⭐ The mandatory constraint, and why it is most of the work

Phase 3 §4c: *"a bound without this is not authorized under any branch."*

**A timeout falling back to an empty result would make Naavi say the caller has no notes on a subject when the truth is she could not look.** That is CLAUDE.md Rule 18 — reshaping a fact to fit what is stored — and it would be **caused by the fix**.

| Site | What happens when the bound fires |
|---|---|
| Knowledge | Returns a sentinel, **not `''`**. That produces its **own** prompt section: *"You do NOT know whether the user has notes on this subject. Do NOT say they have none."* |
| Alerts | Falls into the existing catch: *"I couldn't reach your alerts right now"* — true, and not "you have no alerts" |
| TTS | Existing handler returns 502; Twilio moves on. A bounded failure rather than an open one |

**The knowledge section is deliberately NOT placed under "What Naavi knows about this user."** Framing a failed lookup as knowledge is exactly how *"I couldn't reach it"* becomes *"you have none."*

---

## 5. Tests

**Seven new permanent regression tests**, registered in `tests/runner.ts` so they run on every build. **Stage 3 carries no Rule 15a exception** — Wael's condition when granting one for Stage 2 was that Stage 3 requires *"permanent regression auto-tests that run on every new build."*

```
Testing against: STAGING  (xugvnfudofuskxoknhve)

b12k.fast-path.check-ins-route-to-haiku                       ✓ PASS
b12k.fast-path.information-requests-stay-off-it               ✓ PASS
b12k.fast-path.selection-comment-records-the-boundary         ✓ PASS
b12k.bounded.fires-against-a-server-that-never-responds       ✓ PASS
b12k.bounded.three-call-sites-are-bounded                     ✓ PASS
b12k.bounded.knowledge-timeout-does-not-look-like-no-notes    ✓ PASS
b12k.bounded.timeout-tells-claude-not-to-claim-there-are-none ✓ PASS

Naavi Auto-Tester — 65 tests
✓ 61 passed   ✗ 0 failed   ⨯ 0 errored   ○ 4 skipped
```

**One is behavioural rather than a source check**, and it is the validation Phase 3 specified. It stands up a local server that accepts a connection and never answers — the production stall's exact shape — lifts the real helper out of the voice server, and asserts the bound fires:

```
[Timing] test-hang — BOUND FIRED at 400ms (B12k Stage 3c)
```

**It needs no stall to recur**, which matters because none has since instrumentation went live.

**Two negative cases are deliberately adversarial:** *"can you hear me read my emails"* and *"Are you there when I call Bob?"* both **open with a check-in and then request something**. That is the shape a careless widening of the fast path would let through, and the suite fails if either is ever admitted.

**The tests lift the live regex and the live helper from source rather than restating them**, so they cannot pass against a copy that has drifted from the code.

---

## 6. Live verification on staging

Commit `2583b9c`, `status=SUCCESS`, one instance.

```
[askClaude] Trivial query — skipping calendar & knowledge fetch
[Timing] T5 Claude API call start +547ms  (model: claude-haiku-4-5-20251001)   ← "Are you there?"
[Timing] T5 Claude API call start +1818ms (model: claude-sonnet-4-6)           ← "What is my home address?"
```

- **The saving is real:** 6.76 s → **3.05 s**.
- **The guard held:** the lookup stayed on Sonnet and still answered *"I don't have your home address saved… only your work address."*
- **No `BOUND FIRED` on healthy turns**, and no knowledge errors. **That silence is the correct result** — the bounds change failure behaviour only, so evidence of no harm is that nothing visible changed.

---

## 7. Rollback

Revert `2583b9c` and push; Railway redeploys `staging`.

**The two stages are independently revertible** — they touch different regions of the file and share only the `_b12kFetchBounded` helper, which Stage 3a does not use.

---

## 8. Known risks

| # | Risk | Assessment |
|---|---|---|
| 1 | **The fast path is widened later to include a request** | The real risk. Mitigated by a test with adversarial negatives and by the comment stating the rule. **Not eliminated** — a future edit could change both |
| 2 | **10 s is wrong for some upstream** | Derived from 24 samples of one call. The alerts and TTS calls were not separately sized; both measured far faster |
| 3 | **A bound fires and Naavi's phrasing is poor** | The prompt section instructs, it does not script. What she actually says on a fired bound **has never been heard** — no stall has recurred |
| 4 | **In-process delay reduces the bound's value** | Recorded in Phase 2 §2.3: a timer on a blocked loop fires late, not never. Lag has measured zero throughout |

---

## 9. What this package claims, and what it does not

**Claims:** the change is what Phase 3 authorized; it is deployed and verified live; check-ins are 3.7 s faster; the guard holds on lookups; **Gate 2 green at 63 tests — 59 passed, 0 failed, 0 errored**; the bound fires under an injected stall; and **the failure path was validated end-to-end through the conversational path**, not only in tests.

**Does not claim:** that a bound has ever fired in production — none has. That B12k's 5-second bar is met — **it is not**, and these changes do not move a median.

**No longer claimed, because the validation disproved it:** that a distinct failure message is needed at all. Naavi's ordinary answer was measured **word-for-word identical** whether the lookup succeeded or timed out.

Per Governance §3, Phase 5 → 6 requires Wael's own separate word.
