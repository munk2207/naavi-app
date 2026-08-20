# B10m — Phase 2b: Change Planning (watchdog mitigation, post-Phase-7)

**Date:** 2026-07-19
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 2
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4

No code was written in producing this document.

**Named "Phase 2b"** (not a plain "Phase 2") to distinguish it from the diagnostic-only Phase 2 already completed and closed out earlier today (`docs/B10M_PHASE2_CHANGE_PLAN_2026-07-19.md`, Phases 2-6). This is a new work item within the same B10m holding-list entry: where the earlier cycle planned temporary logging, this plans an actual behavior change, following directly from `docs/B10M_PHASE1_PROBLEM_DEFINITION_2026-07-19.md` §8's first candidate direction.

---

## 0. What this plans, and what it explicitly does not

Per Phase 1 §4 (rewritten): root cause of *why Deepgram sometimes produces no transcript for real speech* is not proven and may not be provable. This plan does **not** claim to fix that. It targets a narrower, separately-proven fact: **the reconnect watchdog is confirmed broken as a safety net** — it disarms on the first Results message regardless of content, identically whether the call goes on to hang or succeed (Phase 1 §4, item 1, instrumented evidence from calls #8-10).

This is a mitigation for a proven-broken mechanism, not a fix for an unproven root cause. Governance's No Assumptions Rule ("no fix is proposed until root cause is proven") is satisfied because **this fix's own root cause — the disarm condition accepting an empty transcript — is itself proven**, with file:line citation and direct instrumented evidence, independent of whether the deeper Deepgram-side question is ever resolved.

## 1. Files that will change

- `naavi-voice-server/src/index.js` — the only file.

## 2. Classification of every file

| File | Classification |
|---|---|
| `naavi-voice-server/src/index.js` | Backend (Voice orchestration, Protected Core) |

## 3. Explanation for every modification

**One change, at the disarm condition (`naavi-voice-server/src/index.js:8963-8967`):**

Require the triggering Results message to carry a **non-empty transcript** before disarming the watchdog — not merely `msg.type === 'Results'`. Concretely, planning-level (exact code deferred to Phase 3): move the transcript extraction ahead of the disarm check, and gate the disarm on `transcript` being truthy.

**Why this specific change and no other:** it is the smallest change that directly corrects the exact proven defect (Phase 1 §4, item 1) — nothing else about the watchdog's arm/timeout/reconnect logic is touched. With this change: a call where Deepgram never produces real content (the observed hang shape) will no longer disarm the watchdog at all, so the existing 6-second timer will fire as originally designed, and attempt a reconnect (existing `deepgramReconnectCount`/cap-of-2 logic, unchanged).

**What this change does NOT do, stated explicitly so Phase 3 doesn't need to infer it:**
- It does not add any new monitoring after the first successful disarm — once the watchdog is legitimately disarmed by a real transcript, no further re-arming happens for the rest of the call (matching current behavior exactly, just gated correctly at the one point that was proven broken).
- It does not add a caller-facing fallback message if reconnects are exhausted and the call is still silent. That idea was raised in Phase 1 §8 as a second, separate candidate — **explicitly deferred, not part of this plan** (see §9, Deferred Architectural Decisions).
- It does not change the 6-second threshold, the 30-frame minimum, or the 2-attempt reconnect cap.

## 4. Risk classification: Medium

Unlike B10m's earlier diagnostic-only change (Low risk, logging only), this is a **real behavior change** — it can cause an actual mid-call Deepgram reconnect on production calls that would not have reconnected before. Protected Core review is mandatory regardless (Governance §4), but Medium is the honest classification here, not Low, because:

- **False-positive risk:** if a legitimate caller simply hasn't spoken within 6 seconds of a (re)connection — e.g., still listening to Naavi's own greeting, or thinking before responding — this change means the watchdog will still be armed and could fire a reconnect that wasn't previously happening (previously, any Results message, even empty, disarmed it near-immediately). **Mitigating evidence, not a full resolution:** every real success observed tonight (calls #6, #10, #13) got a non-empty transcript within 1-2.5 seconds of connecting — well under the 6-second threshold — suggesting the window has real headroom in practice. But this is only 3 data points, not proof the threshold is always safe.
- **Reconnect side effects unverified:** a mid-call Deepgram reconnect closes and reopens the STT WebSocket. Whether this produces an audible gap, drops in-flight audio, or otherwise disrupts a call that was about to succeed on its own has not been tested — the existing reconnect path (`connectDeepgram`) has never actually been exercised in production before (Phase 1 confirmed it never fires, in every reproduction studied).

## 5. Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | No | Confirmed voice-only capability (Phase 1A §2-3 of the original diagnostic cycle; unchanged). |
| Voice | Yes | `naavi-voice-server/src/index.js` — disarm condition gains a transcript-content check. |
| Shared Core | No | No Edge Function call added or changed. |
| Database | No | No table read or write. |
| Cron | No | Not applicable. |
| API contracts | No | No request/response shape change for any caller. |
| Tests | No | No automated test suite covers this repo (same Rule 15a situation as the diagnostic cycle) — verification is live-call only (§8). |

## 6. Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** No.
- **Does this change modify an Entry Point?** Yes — the Voice entry point's STT reconnect behavior, not its translation logic to Claude/Shared Core.
- **Does this change introduce new duplication?** No.
- **Does this change eliminate existing duplication?** No — not applicable.
- **Does this change modify Protected Core?** Yes — a real behavior change to Voice orchestration's failure-recovery logic, which is exactly why Phase 3 review is mandatory regardless of risk tier.

## 7. Regression Impact

| Area | Affected? |
|---|---|
| Voice commands | Possibly, indirectly — a mid-call reconnect could theoretically interrupt an in-progress utterance capture; see §4's false-positive risk. |
| Geofencing | No. |
| Gmail integration | No. |
| Calendar integration | No. |
| Reminders | No. |
| SMS / call alerts | No. |
| Onboarding | No. |
| Staging build | No — this deploys to the voice server (Railway), not the mobile AAB/APK pipeline. |

## 8. Regression Matrix (per-change consumer trace)

Searched directly: the disarm condition at lines 8963-8967 has exactly one reader/writer of `deepgramFirstMessageAt` and `deepgramWatchdog` — the `connectDeepgram()` closure itself (confirmed via grep: both variables appear only within this function's scope, lines 8463-8467 declaration, 8919/8941-8967 usage). `connectDeepgram()` has exactly two call sites (unchanged from the original diagnostic Phase 2's finding): the Twilio MediaStream `'start'` handler (once per call), and the watchdog's own reconnect path. No other function or code path is affected by this change.

## 9. Deferred architectural ideas

Per Governance §Phase 3's convention, recorded explicitly rather than left implied:

1. **Caller-facing fallback message after reconnects are exhausted with still no transcript.** Not approved for this implementation — broader scope (new TTS content, new code path for the "give up" branch) than this narrowly-targeted fix. Worth reconsidering once this narrower fix's real-world effect (does reconnecting actually help?) is observed.
2. **Ongoing re-arming of the watchdog throughout a call, not just at initial connect.** Not approved — this fix only corrects the proven-broken initial disarm condition; a full mid-call monitoring redesign is a larger change with its own false-positive risk (distinguishing "caller is naturally pausing" from "STT has silently stopped working") that has not been evaluated.
3. **Tuning the 6-second/30-frame thresholds.** Not approved — no evidence gathered tonight suggests the current thresholds themselves are wrong; changing them without evidence would violate the No Assumptions Rule.

## 10. Regression Impact — Non-Determinism Rule applicability

Not applicable. This change touches deterministic reconnect logic, not an LLM/classifier prompt.

---

## 11. No code yet

This plan is submitted for Phase 3 Technical Review before any implementation begins, per governance sequencing — same as B10m's original diagnostic cycle.
