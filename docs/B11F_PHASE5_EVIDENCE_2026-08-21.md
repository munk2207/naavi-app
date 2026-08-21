# B11f — Phase 5: Evidence Package

**Work item:** [[B11f]] — pause and resume on a voice call
**Date:** 2026-08-21
**Commit:** `4724f7d` on branch `staging` (`naavi-voice-server`), parent `33e7558`
**Deployed:** voice staging, container started and confirmed running

---

## 1. Summary

The two functions that decide what a caller hears when they say "stop" and then "start" were
closures inside a ~1,400-line WebSocket handler, and therefore had **no tests and could not have
any**. They now live in `src/voice/resumePoint.js` as pure functions, and are covered by 14 tests.

**No behaviour changed on any surface.** That is not an assertion — see §4.2.

---

## 2. Files changed

Exactly the three authorised at Phase 3. No others.

| File | Lines | Change |
|---|---|---|
| `src/voice/resumePoint.js` | +102 | New. `bytesSpokenSoFar`, `resumePointOf`, three named constants replacing magic numbers. |
| `src/index.js` | +23 / −18 | Two closures removed; one import added; `bytesSpokenSoFar` becomes a thin per-connection wrapper. |
| `test/resumePoint.test.js` | +173 | New. 14 tests. |

**Not touched:** `pauseCommand.js` and its 17 tests, `holdAnswer`, `endSpeech`,
`sendAudioToTwilio` and its 43 call sites, any Edge Function, anything mobile.

---

## 3. Git diff

Full diff: `git diff 33e7558..4724f7d`. The Protected Core change in `src/index.js` is 41 lines and
reduces to three things:

**3.1 — the import**

```js
const {
  bytesSpokenSoFar: bytesSpokenSoFarOf,
  resumePointOf,
} = require('./voice/resumePoint.js');
```

**3.2 — `bytesSpokenSoFar` becomes a wrapper.** The call site `bytesSpokenSoFar()` at `:10316` is
unchanged; only the body moved.

```diff
-    if (!usingPreGenAudio) return lastTtsBytes;
-    if (!audioDispatchedAt) return 0;
-    const elapsedMs = Date.now() - audioDispatchedAt;
-    return Math.max(0, Math.min(preGenTotalBytes, Math.floor(elapsedMs * 8)));
+    return bytesSpokenSoFarOf({
+      usingPreGenAudio, lastTtsBytes, audioDispatchedAt, preGenTotalBytes,
+    });
```

**3.3 — `resumePointOf` deleted, replaced by a pointer comment.** Its call site at `:10289` is
unchanged; the name now resolves to the import.

---

## 4. Tests executed

### 4.1 Suite

```
tests 133   pass 133   fail 0
```

119 pre-existing (unchanged, including all 17 vocabulary tests) + 14 new. `node --check` clean;
`eslint` clean; the `no-undef` pre-push gate passed on the push itself.

**The 14 new tests assert caller-visible behaviour, not return values.** The two that matter most:

- **"paused inside the THIRD sentence resumes at the SECOND"** — the deliberate one-sentence
  rewind. Dropping a caller back at the exact word they interrupted is precise and useless to
  listen to. Nothing verified this before.
- **"REGRESSION (B11f revert, 2026-08-19): the pre-generated path reports progress at all"** —
  named for the defect that caused the revert. That path was uninstrumented while most answers take
  it, which is why pause looked intermittent rather than broken.

### 4.2 Equivalence proof — the evidence for "no behaviour change"

A differential harness ran **the original closure bodies, copied verbatim from `33e7558`**, against
the extracted module:

```
input combinations compared: 2044
divergences: 0
```

Covering both playback paths; clocks before, at and long after dispatch; `audioDispatchedAt = 0`;
buffers of 0 / 1 / 16k / 80k bytes; and seven text shapes including empty, unpunctuated,
no-space-after-full-stop, multiple spaces, and `?`/`!` terminators.

**This is the claim's proof.** A reviewer should weigh it as the primary evidence that Protected
Core behaviour is unchanged.

### 4.3 A defect the tests caught — in the tests

First run failed. Expected sentence boundaries were written as 45 and 84; they are **46 and 85** —
a boundary is the index after the punctuation *and* the following space. **The implementation was
right and the test was wrong.** Fixed by computing the boundaries and naming them as constants,
rather than patching the numbers until they matched.

Recorded because it is the honest shape of the risk here: hand-written expectations about this
arithmetic are easy to get wrong, which is precisely why it needed tests.

---

## 5. Manual tests required (Phase 7)

Automated tests cannot reach the WebSocket handler, so the wiring — as opposed to the arithmetic —
is only provable on a live call. **On voice staging, `+1 343 504 1572`:**

1. Ask something with a multi-sentence answer. Say **"stop"** partway through. → She stops.
2. Say **"start"**. → She resumes **from the start of the previous sentence**, not from the top and
   not mid-word. This exercises both extracted functions end to end.
3. Let a short answer finish uninterrupted, then ask another question. → **Normal conversation is
   unaffected** — this is the regression that caused the July revert and is the most important
   check.
4. Say "stop", wait, then say something unrelated instead of "start". → The held answer does not
   surface uninvited.

---

## 6. Rollback instructions

Single commit, no schema, no configuration, no data.

```bash
cd naavi-voice-server
git revert --no-edit 4724f7d
git push origin staging
railway redeploy -s naavi-voice-staging --from-source -y   # only if the auto-deploy has not started
```

**Production is unaffected either way** — `main` does not contain B11f at all, so no rollback there
is possible or needed.

---

## 7. Known risks

1. **The wiring is untested by automation.** The arithmetic is proven; that `index.js` passes the
   right four values into it is not. A transposition — `lastTtsBytes` where `preGenTotalBytes`
   belongs — would type-check, lint clean, and pass all 133 tests. **Mitigated only by the shorthand
   object literal**, where the property name and variable name must match, and by manual test §5.2.
   This is the residual risk and it should not be described as smaller than it is.
2. **`holdAnswer` and `endSpeech` remain untested**, per Phase 2 §2.4. `holdAnswer` stores what
   `bytesSpokenSoFar` computes, so a defect there is still invisible to the suite.
3. **The file is Protected Core.** A mistake here is heard live by a real caller with no undo. This
   change is small and proven equivalent, but it is in that file.
4. **Not a risk, recorded to prevent misreading:** this work does not make B11f safe to promote.
   The interruption trade-off in Phase 1 §1.3 — a misheard pause word leaves a caller unable to
   interrupt at all, where production lets any word interrupt — is untouched and belongs to the
   promotion decision.

---

## 8. Phase 6 readiness

Package complete: summary, files, diff, tests, manual tests, rollback, known risks. Phase 6
external review does not begin until Wael's own explicit go-ahead.
