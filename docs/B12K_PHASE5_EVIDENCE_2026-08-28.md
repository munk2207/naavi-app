# B12k — Phase 5: Evidence Package (Stages 1 and 2)

**Work item:** [[B12k]] — Naavi is too slow to answer on voice.
**Date:** 2026-08-28
**Covers:** Phase 4 implementation of **Stages 1 and 2 only.** Stage 3's three parts are conditionally authorized by Phase 3 §4 and are **not implemented.**
**Status:** **RESUBMITTED with executed evidence, 2026-08-28.** The first version was returned by Wael as premature — it documented a change and admitted the required staging evidence had not been performed. It has now been deployed to staging and the checks have run.

---

## 1. Summary

Instrumentation and a staging-only model switch, one file, voice `staging` branch. **Deployed and verified live.**

**Nothing a caller experiences changes.** With `B12K_FORCE_MODEL` unset — its state on production and on the staging demo service — every path resolves exactly as before.

| Deployment fact | Value |
|---|---|
| Commit | `e2dcb0f` |
| Branch | `staging` |
| Build started / live | **7:50 PM EST / 8:55 PM EST** — 65 min, during a Railway incident (below) |
| Verified live by | The four new `[Timing]` markers appearing in the running container's logs |

---

## 2. Files changed

| File | Repository | Branch | Change |
|---|---|---|---|
| `src/index.js` | `munk2207/naavi-voice-server` | `staging` | **+80 / −8** |

**All 8 removed lines were replaced by their instrumented equivalents** — verified by inspecting every removal. No file outside this one was touched.

---

## 3. Diff — eight hunks, each mapped to its authorization

| Hunk | Location | What | Authorized by Phase 3 §6 |
|---|---|---|---|
| 1 | after `:129` | `_b12kTimed` helper + event-loop lag probe | items 2, 3 |
| 2 | `:3056-3057` | Timing on `fetchWeather`, `fetchGlobalSearch` | item 2 |
| 3 | `:3063` | Timing on `fetchUserLists` | item 1 |
| 4 | `:3331` | Timing on `_b4xBuildAlertsContext` | item 1 |
| 5-6 | `:3351`, `:3353` | Timing on the `user_settings` read | item 1 |
| 7 | `:3414` | Timing on `fetchCalendarPdfBlock` | item 1 |
| 8 | `:3446` | `B12K_FORCE_MODEL` switch | item 4, Option A |

**No hunk falls outside the authorization.** No Edge Function, no mobile file, no prompt, no classifier, no condition, no call's arguments.

**Two choices neither Phase 3 nor I specified in advance:**

1. **Timing at call sites, not inside the functions.** `fetchUserLists` returns early at four points and `fetchGlobalSearch` at three; an internal log at the end would silently miss those paths.
2. **The calendar chain was deliberately NOT wrapped.** §6 named only `fetchGlobalSearch` and `fetchWeather`. **The `.then()` fallback to `fetchCalendarEvents` therefore has no combined figure** — a real gap, left because closing it was unauthorized.

---

## 4. Tests executed

### 4a. Pre-deploy

| Test | Result |
|---|---|
| `node --check src/index.js` | **PASS** |
| Removal audit — all 8 deletions accounted for | **PASS** |
| `git status` — one file modified | **PASS** |

### 4b. Check 1 — Gate 2 voice regression, against STAGING

**Environment proved before running, not after.** `tests/.env` sets `SUPABASE_URL` to **production**, and the runner's fixtures perform live DELETEs before any test executes. A plain `npm run test:voice` would have deleted production rows. The runner's loader only fills **unset** variables (`if (!process.env[m[1]])`), so a shell-provided value wins — verified by replicating that logic in a separate process, which resolved to **STAGING** with no database access. The run's own skip messages then named `xugvnfudofuskxoknhve`, confirming it.

```
Naavi Auto-Tester — 58 tests
✓ 51 passed   ✗ 0 failed   ⨯ 3 errored   ⧗ 0 timed out   ○ 4 skipped
Duration: 54.1s
```

**⚠ Gate 2 is NOT clean, and this package does not claim it is.** Three tests errored:

```
⨯ voice-pin.set-with-service-role-succeeds       — SET: expected 2xx, got 400
⨯ voice-pin.set-rejects-non-4-digit-pin          — expected "pin_must_be_4_digits", got "pin_must_be_6_digits"
⨯ voice-pin.verify-correct-pin-returns-match-true
```

**They are pre-existing, established by evidence rather than by argument.** The run of **2026-08-25** — three days before this change — carries the identical three errors with the identical message (`tests/results/2026-08-25T14-52-53-581Z.md`).

**So: this change introduced no new failures. It did not make Gate 2 pass, because Gate 2 was already not passing.** The four skips are environmental — the account has no Google token on staging.

### 4c. Checks 3-6, via the server's `/test/ask` endpoint

Run against the staging gates account (`ae1f3438…`). No phone call required.

| Check | Result | Evidence |
|---|---|---|
| **3 — Log verification** | **PASS** | All four new markers produce plausible values. **Lag probe silent across 300 log lines** — including a 15-second turn — so loop lag stayed under the 250 ms threshold |
| **4 — Switch inert by default** | **PASS** | Variable unset: calendar listing → Haiku, reasoning question → **Sonnet**. Selection unchanged |
| **5 — Switch honoured when set** | **PASS** | `B12K_FORCE_MODEL=haiku`: `[askClaude] B12k Stage 2: model FORCED to claude-haiku-4-5-20251001` logged, and `T5` reported Haiku on the same question that used Sonnet minutes before |
| **6 — Invalid value rejected** | **PASS** | `B12K_FORCE_MODEL=banana`: warned `not recognised (expected "haiku" or "sonnet") — using normal selection`, and `T5` reported Sonnet |

**Containment verified at every step**, which empirically confirms Phase 3 §5's third argument for Option A:

| Service | Variable |
|---|---|
| `naavi-voice-staging` | set |
| `naavi-voice-server` (production) | **not set** |
| `generous-tenderness` (staging demo) | **not set** |

### 4d. Check 2 — live call: NOT PERFORMED

Requires a real call to `+1 343 504 1572`. **Only Wael can place it.** Outstanding.

---

## 5. ⭐ What the instrumentation measured — the point of the whole change

### 5a. The four serial context calls — four samples, all under the gate

| Sample | `fetchUserLists` | `_b4xBuildAlertsContext` | `user_settings` | `fetchCalendarPdfBlock` | **Total** |
|---|---|---|---|---|---|
| 1 | 327 | 277 | 108 | **0** | **712 ms** |
| 2 | 286 | 273 | 109 | **0** | **668 ms** |
| 3 (Gate 2) | 103 | 222 | 105 | **0** | **430 ms** |
| 4 (Gate 2) | 107 | 284 | 120 | **0** | **511 ms** |

**Phase 3's gate B1 requires ≥ 750 ms to justify restructuring these. Four samples, none reaches it.**

**If this holds across the trial set, Stage 3b is ruled out** — and the threshold, fixed before any data existed, will have done its job by **preventing** work on Protected Core rather than authorising it.

**`fetchCalendarPdfBlock` returned 0 ms on every sample.** The `~50ms` comment on `fetchUserLists` is now measured: 103-327 ms, so the comment understated it by up to 6×.

### 5b. The model — the first controlled comparison

**Same question, same account, minutes apart:**

| Model | Time | Stop reason |
|---|---|---|
| `claude-sonnet-4-6` | **11 602 ms** | `end_turn` |
| `claude-haiku-4-5` | **5 925 ms** | **`max_tokens`** |

**5.7 seconds faster — and truncated.** Haiku's reply ended mid-sentence: *"My take: if you've already decided on the"*. The caller would hear Naavi stop dead in the middle of a thought.

**This is the quality veto earning its place on the first comparison.** Phase 3's gate 4a requires ≥ 1 500 ms faster **AND zero cases of degraded correctness or completeness.** The latency gate passes by a wide margin; the quality gate fails. **A latency-only gate would have waved this through.**

**And it exposes something neither gate was written for.** That reply was **1 411 characters** — roughly a minute and a half of speech on a phone call (estimate, not measured) — and contained markdown bold markers (`**Fall timing:**`) in text destined for TTS. **Answer length is a latency lever nobody in this work item has named**, and it costs twice: longer to generate, then longer to listen to. Sonnet's length on the same question was not captured and should be, in Stage 2 proper.

### 5c. Knowledge search — the variance reproduced in miniature

`searchKnowledgeSpecific`, same account, minutes apart: **3 525 ms**, then **935 ms** — 3.8× — **returning zero fragments every time.** On the 3 525 ms turn it was **91 % of the entire context cost.**

This is the same function that stalled at 122 seconds in production. **Caveat: the gates account holds little knowledge data**, so these figures should not be carried to a real account without measuring there.

### 5d. Event-loop lag — nothing to report, which is itself data

**Zero lag lines across 300+ log lines**, including a 15-second turn. Loop lag stayed under 250 ms throughout. **One early data point toward Stage 3c's C1 branch rather than C2** — but taken on a healthy staging service with no stall present, so it says nothing about what the loop does *during* one.

---

## 6. Rollback

**Committed and deployed**, so rollback is a revert and push; Railway redeploys from the branch.

**To disable only the model switch:** delete `B12K_FORCE_MODEL` on the Railway service. **No deploy, no code change.** See §8 for a caveat on how that behaved in practice.

---

## 7. Known risks

| # | Risk | Assessment after execution |
|---|---|---|
| 1 | An editing mistake in Protected Core | **Materially reduced.** 51 Gate 2 tests pass, 0 fail, and four live turns behaved correctly |
| 2 | Log volume | Six new per-turn lines. Small against existing per-turn logging |
| 3 | Lag probe timer overhead | No observable effect; probe silent throughout |
| 4 | Variable set on the wrong service | **Did not occur.** Verified absent from production and the demo service at every step |
| 5 | The probe measures the loop, not causation | Unchanged and unmitigated, by design |

---

## 8. ⭐ Two operational findings worth carrying forward

**1. Deleting a Railway variable does not restart the container.** After `railway variable delete B12K_FORCE_MODEL`, the stored config showed it gone — while the running process still had `banana` in its environment, proven by five "not recognised" warnings during Gate 2. **Behaviourally harmless**, because check 6 established that value falls back to normal selection. **But the config and the running process diverged, and only the config is visible to someone looking.** Same class as code deployed and never committed. It clears on the next deploy.

**2. Railway had an active incident during this deploy** — *"Deployments slow to start", Degraded Performance, EU West among the regions*, posted 7:59 PM EST, nine minutes after our build began at 7:50 PM EST. **The 65-minute build is explained by that, not by anything in the change**, which touched one file and no dependency. A later restart completed in under a minute once the incident cleared. **No redeploy was fired during the incident**, on the Architecture Reference's own warning that impatience there creates a confusing picture rather than a faster one.

---

## 9. Improvement ideas noticed and NOT implemented

**Per Phase 4's No Extra Changes Rule — reported, not acted on. None is proposed as work, and none has a tracked item; Rule 1b applies.**

1. **`search-knowledge/index.ts:37` swallows its OpenAI error** — bare `catch { return null; }`, no logging. AI Coding Discipline #21 forbids the shape, and it is why a failing embedding call leaves no trace.
2. **`searchKnowledgeSpecific` returns `''` on failure** (`:1223-1225`) — a failed lookup is indistinguishable from "the user has no notes on this." **Phase 3 §4c already makes this a mandatory constraint on Stage 3c.**
3. **Three `voice-pin` tests have been erroring since at least 2026-08-25**, expecting a 4-digit PIN where the deployed function requires 6 — apparently stale against the S1 change. **Gate 2 has therefore not been clean for at least three days.**
4. **Naavi produced a 1 411-character spoken answer containing markdown bold markers.** Two separate problems — length, and formatting in TTS-bound text.
5. **The calendar chain in the parallel block has no combined timing** (§3).
6. **`fetchCalendarPdfBlock` exists twice** — `src/index.js:1292` and `naavi-chat/index.ts:806`.

---

## 10. What this package claims, and what it does not

**Claims:** the change is what was authorized; it is deployed and running; it introduced no new test failures; the switch is inert by default and correct when set; and the instrumentation produces usable measurements.

**Does not claim:** that Gate 2 is green — it is not, for reasons predating this work. That the caller experience is verified — **check 2 has not been performed.** That any Stage 3 gate is settled — four samples are not the trial set.

Per Governance §3, Phase 5 → 6 requires Wael's own separate word.
