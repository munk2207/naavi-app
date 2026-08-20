# B10m — Phase 2: Change Planning

**Date:** 2026-07-19
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 2
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4 (unchanged since Phase 1A — no newer revision exists)

No code was written in producing this document.

---

## 0. What this phase plans, and what it does not

Phase 1 (§4) could not prove root cause and explicitly named the missing evidence: a log line at the watchdog's disarm point, and a raw trace of every Results message (interim + final) during a live reproduction. Phase 1 §8 flagged reinstating targeted diagnostic logging as the recommended next step, not yet approved.

**This plan is for that diagnostic instrumentation — not a fix for the hang itself.** No fix can be planned yet because no root cause is proven; proposing one now would violate governance's No Assumptions Rule the same way Phase 1 was careful not to. This mirrors B4b's own precedent on the same file (`docs/B4B_PHASE2_CHANGE_PLAN_2026-07-18.md`): diagnostic-only, temporary, with defined removal criteria.

---

## 1. Files that will change

- `naavi-voice-server/src/index.js` — the only file. No other file requires any change for this diagnostic step.

## 2. Classification of every file

| File | Classification |
|---|---|
| `naavi-voice-server/src/index.js` | Backend (Voice orchestration, Protected Core) |

## 3. Explanation for every modification

Two additions, both temporary and diagnostic-only, tagged `[B10m-diag]` so they're distinguishable from any other diagnostic tag (`[B4b-diag]`, `[F19-1e-diag]`, etc.) and easy to grep out later:

1. **At the watchdog disarm point** (`naavi-voice-server/src/index.js:8963-8966`) — add a log line recording that the disarm fired, including the transcript content of the triggering Results message (or an explicit `EMPTY` marker if blank) and milliseconds since the Deepgram WebSocket opened. This directly targets Phase 1 §8's evidence gap #1: today, this event produces zero log output, so its occurrence can only be inferred (Phase 1 §4), never confirmed.
2. **Inside the Results message handler** (`naavi-voice-server/src/index.js:8968` area, immediately after `transcript`/`isFinal`/`speechFinal` are extracted) — log every Results message received (interim and final, not just non-empty ones), with transcript content, `is_final`, `speech_final`, and milliseconds since Deepgram WebSocket open. This targets Phase 1 §8's evidence gap #2: a raw trace to distinguish whether an early empty-transcript Results message actually precedes the silence, versus some other unidentified path.

**No other executable behavior is modified.** Neither addition changes any conditional, return, or control-flow statement — both are `console.log` calls only, placed at points the existing code already reaches on every call. This is an observability change, not a behavior change — the central design principle of this plan.

## 4. Risk classification: Low

Both additions are pure logging with zero control-flow change — the same shape of change as the already-approved-and-shipped B4b diagnostic commit (`f56f9da`, Phase 3-reviewed and approved same day) on this identical file. **Despite Low risk, Phase 3 review is still mandatory** — per Governance §4, any modification touching the Protected Core automatically requires technical review before coding, regardless of risk classification.

**One risk worth naming, not a blocker:** addition #2 logs on every Results message, which can arrive multiple times per second during active speech (interim results stream continuously). B4b's diagnostic mitigated this by only logging when `transcript` was non-empty — this plan deliberately does **not** apply that same filter, because an empty-transcript message is exactly the evidence being sought (§0). Volume is bounded by call duration (each of the 5 reproduced failures ran 10-27 seconds) and this is temporary, single-purpose diagnostic logging with defined removal criteria (§8), not a standing change.

---

## 5. Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | No | Zero mobile files touched; mobile has no equivalent code path (Phase 1A §3). |
| Voice | Yes | `naavi-voice-server/src/index.js` — two `console.log` additions, no control-flow change. |
| Shared Core | No | Neither addition calls any Shared Core Edge Function; both are local to the Deepgram WebSocket handler closure. |
| Database | No | No table read or write is added or changed. |
| Cron | No | Not applicable — this is a live-call code path, not a scheduled job. |
| API contracts | No | No request/response shape changes for any caller (Twilio, Deepgram, or any Edge Function). |
| Tests | No | No automated test added. Diagnostic-only logging has no assertable behavior to test — same precedent as B4b's diagnostic commit, which also added no test. `npm run test:auto` does not exercise `naavi-voice-server` at all (separate repo, no shared test harness) — this is a pre-existing gap in the test suite's scope, not something this change introduces or could close. **Validation instead occurs through controlled live reproductions** (§9) — the verification method for this change is operational (real calls, real logs), not automated, and that is the correct method for this kind of diagnostic-only Protected Core change. |

**Not duplicated** (Phase 1A §2) — no "both implementations" question applies.

## 6. Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** No.
- **Does this change modify an Entry Point (mobile or voice translating logic, rather than Shared Core)?** Yes — it adds logging inside the Voice entry point's STT connection handler. It does not change what that entry point translates or how; it only observes.
- **Does this change introduce new duplication?** No.
- **Does this change eliminate existing duplication?** No — not applicable, capability is not duplicated.
- **Does this change modify Protected Core?** Yes, technically (the file is Protected Core) — but only by adding observability, not by changing behavior. No control-flow, timing, or decision logic is altered.

## 7. Regression Impact

| Area | Affected? |
|---|---|
| Voice commands | No — logging only, no change to transcript handling, aggregation, or Claude invocation. |
| Geofencing | No — unrelated code path. |
| Gmail integration | No — unrelated code path. |
| Calendar integration | No — unrelated code path. |
| Reminders | No — unrelated code path. |
| SMS / call alerts | No — unrelated code path. |
| Onboarding | No — unrelated code path. |
| Staging build | No — this deploys to the voice server (Railway), not the mobile AAB/APK build pipeline; no staging-build interaction. |

## 8. Regression Matrix (per-change consumer trace)

The two log additions sit inside `connectDeepgram()`'s `'open'` and `'message'` event handlers. Searched directly (not recalled) for every caller of `connectDeepgram`: exactly two call sites exist in the entire file —
1. `naavi-voice-server/src/index.js:12617`/`12620` — the Twilio MediaStream `'start'` handler, once per inbound call (the only normal entry point).
2. `naavi-voice-server/src/index.js:8952` — the watchdog's own reconnect path, which calls `connectDeepgram()` again if it fires.

No other function, file, or code path calls `connectDeepgram()` or reaches these two handlers. Both additions are `console.log` statements with no return value and no side effect beyond writing to Railway's log stream — nothing downstream (Claude invocation, `action_rules`, alert fan-out, or any other consumer) reads or depends on their output. There is no consumer to regress.

---

## 9. Removal criteria (temporary diagnostic, per governance precedent set by B4b)

Per the same pattern as B4b's diagnostic commit: this logging is removed once either (a) a live reproduction captures the evidence needed to move Phase 1's hypothesis from "leading candidate" to "proven" or "disproven," or (b) a defined number of reproduction attempts (proposed: 3, matching Phase 3's Non-Determinism Rule minimum trial count for the nearest analogous precedent) pass without reproducing the hang at all, at which point the plan itself needs re-evaluation rather than more waiting.

**The diagnostic logging must be removed before production closeout (Phase 6/7) unless explicitly retained through its own separate approval.** This is temporary instrumentation, not a permanent addition — consistent with how B4b's own diagnostic logging was scoped and, in that case, ultimately reverted rather than left in place indefinitely.

---

## 10. Phase 2 review record (2026-07-19)

External reviewer (ChatGPT) verdict: **Approved.** Full governance-compliance checklist (derived from approved Phase 1, no speculative implementation, file list complete, every modification justified, risk classification documented, architecture impact reviewed, regression assessment completed, cross-platform impact considered, temporary diagnostics identified, removal criteria defined) — all items passed. Three editorial observations, all incorporated into this revision: §3's "No other code path is touched" reworded to "No other executable behavior is modified," emphasizing the observability-vs-behavior distinction that is this plan's central design principle; §5's Tests row now explicitly states validation occurs through controlled live reproductions rather than automated tests; §9 now states diagnostic logs must be removed before production closeout unless separately approved to remain.

**This section is the record of the review; it is not, by itself, authorization to proceed.** Per the Phase-Gate Approval Rule: moving to Phase 3 requires Wael's own separate, explicit go-ahead.

## 11. Status

**Phase 2 drafted 2026-07-19, reviewed and Approved same day (§10), three editorial observations incorporated. Phase 3 has NOT started and will not start until Wael gives explicit, separate approval for that specific transition.**
