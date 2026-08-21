# B11f — Phase 7: Testing

**Work item:** [[B11f]] — pause and resume on a voice call
**Date:** 2026-08-21
**Commit tested:** `4724f7d` on `staging`, deployed to `naavi-voice-staging`
**Phase 6:** APPROVED — all four verdicts PASS, conditional on this live-call test being completed

---

## 1. Automated testing

Unchanged and green.

```
tests 133   pass 133   fail 0
```

119 pre-existing (including all 17 pause-vocabulary tests, untouched) + 14 new. `node --check`
clean, `eslint` clean, `no-undef` pre-push gate passed on the push.

Plus the differential equivalence harness from Phase 5: **2,044 input combinations, 0 divergences**
against the original closure bodies.

---

## 2. Manual validation — live call, `+1 343 504 1572`

Performed by Wael, 2026-08-21. **All four passed.**

| # | Test | Result |
|---|---|---|
| 1 | Long answer, say "stop" part-way | **PASS** — she stops |
| 2 | Say "start" | **PASS** — resumes at the previous sentence, not the top, not mid-word |
| 3 | Short answer allowed to finish, then a new question | **PASS** — normal conversation unaffected |
| 4 | "stop", wait, then an unrelated question | **PASS** — held answer does not resurface |

**Test 3 is the one that matters most.** It is the exact regression that caused the July revert:
B11f passed four gates, 102 tests and two external reviews, then broke ordinary conversation the
first time Wael spoke to it.

---

## 3. Log evidence — and it is stronger than the call alone

From `railway logs -s naavi-voice-staging` during the test call:

```
[Voice] Incoming call from "+13433332567" to "+13435041572" — CallSid: CA7839a93a…
[B11f] answer held (157 chars, 66896 bytes spoken)
[B11f] pause while speaking (66896 bytes spoken, pre-generated)
[B11f] resume from char 60 of 157
[Speech] end (pause)
[B11f] answer held (115 chars, 81920 bytes spoken)
[B11f] pause while speaking (81920 bytes spoken, streamed)
```

### 3.1 Both playback paths were exercised, unplanned

The first pause landed on the **pre-generated** path and the second on the **streamed** path. That
was not designed into the test plan — it happened because the two questions took different routes.

**It matters more than any single assertion in the suite.** The pre-generated path is root cause 2
of the July revert: the original implementation instrumented only the streaming branch, while most
answers take the pre-generated one, which is exactly why pause appeared to work *intermittently*
rather than to be broken. **The path that caused the revert is now confirmed working on a live
call, with a log line naming it.**

### 3.2 The resume point is arithmetically consistent — which is what actually tests the wiring

```
66896 bytes ÷ 8000 = 8.4s of audio
8.4s × 14 chars/s   = 117 characters spoken, of a 157-character answer
resume point        = char 60
```

117 characters of a 157-character answer is a plausible fraction (~8.4s into ~11.2s), and 60 < 117
confirms the one-sentence rewind fired rather than resuming where she was cut off.

**This is the direct answer to Phase 6 §4.1**, the one residual risk the reviewer accepted on
condition of this test. The concern was that `index.js` might pass the four state values in the
wrong order — a transposition that would type-check, lint clean and pass all 133 tests. **Had that
happened, the byte count itself would be nonsense**: `lastTtsBytes` in place of `preGenTotalBytes`
would cap the estimate at zero, and a wrong `audioDispatchedAt` would make elapsed time absurd.
Instead the numbers are internally coherent across both paths, and the resume landed where the
arithmetic says it should.

**The residual wiring risk is now discharged by evidence rather than accepted on trust.**

---

## 4. What this phase does NOT establish

Recorded so nobody reads more into a green Phase 7 than it earns.

1. **Nothing about production.** `main` does not contain B11f at all. Promotion is a separate
   decision, and Phase 1 §1.3's interruption trade-off — a misheard pause word leaves a caller
   unable to interrupt at all, where production lets *any* word interrupt — is untouched and
   belongs to that decision.
2. **`holdAnswer` and `endSpeech` remain untested by automation.** They were exercised on this
   call, and the log lines above are them working, but a single live call is not coverage. Phase 2
   §2.4's reasoning for leaving them stands; the gap does too.
3. **One call, one caller, one handset.** Deepgram's mishearing of pause words on 8 kHz mulaw audio
   — which `pauseCommand.js` documents against itself — is not exercised by a test where the words
   were heard correctly.

---

## 5. Phase 8 readiness

Automated green, manual green, log evidence recorded, residual risk discharged.

**One Phase 8 obligation already carried forward from Phase 1A §6:** the Architecture Reference §3
describes "barge-in/interruption" as a single capability, which no longer matches `staging`. That
divergence predates this commit and becomes user-visible only on promotion — but Phase 1A logged
updating it as a merge precondition, and it should not close silently.

Phase 8 does not begin until Wael's own explicit go-ahead.
