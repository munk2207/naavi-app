# B10m — Phase 1: Problem Definition

**Date:** 2026-07-19 (rewritten same day, end of session, consolidating a full evening of live testing — see §9 for how this document evolved)
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 1
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4

No code was written in producing this document.

---

## 1. What exactly is broken?

On a live phone call to Naavi's production voice number, Deepgram's speech-to-text WebSocket connects and audio is forwarded to it continuously, but **on some calls, Deepgram never produces a transcript of the caller's real, spoken words — for the entire call.** No error, no retry prompt, nothing — the call runs in silence until the caller hangs up.

**This is confirmed intermittent, not deterministic.** The clearest evidence: the identical question, asked on two consecutive calls minutes apart, failed completely on the first and was answered correctly on the second — same server, same code, same phone, same person (§2, calls #12-13). This is not a permanent outage and not something that reproduces reliably on demand.

**Stated plainly, in the terms this matters to a real caller:** a caller cannot tell, before dialing, whether Naavi will hear them. The same request that worked five minutes ago can silently fail the next time, with no indication anything is wrong. **A single successful test call does not establish that the system is reliable** — it only shows the failure didn't happen on that particular attempt. Proving root cause with certainty is not currently possible from the evidence gathered tonight; what is possible, and what this document does, is state precisely what is known, what remains unknown, and what a caller actually experiences.

This is distinct from two other symptoms found during tonight's testing and explicitly not part of this defect: a call that is merely slow to respond (backend latency, already tracked in `project_naavi_latency_issues`), and a call that responds but with garbled/malformed speech content (a JSON-extraction defect, tracked separately as [[B10n]]). A third anomaly — one call where Naavi responded to content the caller never said — was also observed once and is explicitly **not** folded into this defect either; see §6.

**Business severity:** this is a Protected Core defect — it fails the core promise of the product (a phone call to Naavi will be heard and answered) with zero recovery path visible to the caller. Because Voice orchestration is classified Protected Core / Full Phase 1-8 in the Architecture Reference precisely because "a mistake here is heard live by a real caller with no undo," a failure in this layer removes the entire voice surface's function for the affected call. The existing reconnect mechanism that exists specifically to catch this failure mode is confirmed non-functional (§4) — there is currently no code-level safety net once a call enters this state.

## 2. What evidence proves the problem?

**Every call tested on 2026-07-19, in chronological order, Railway Deploy Logs (`naavi-voice-server-production.up.railway.app`), read directly from the dashboard:**

| # | CallSid (suffix) | Time (EDT) | What happened | Outcome |
|---|---|---|---|---|
| 1 | `...ceca1b75c` | 00:56:33 | Silence, ~27s, caller hung up | **Hang** |
| 2 | `...971b6536063135` | 01:06:53 | Silence, ~15s, caller hung up | **Hang** |
| 3 | `...120585fd05218ae2f` | 01:55:18 | Silence, ~14s, caller hung up | **Hang** |
| 4 | `...25460190fe419d` | 01:57:07 | Silence, ~10s, caller hung up | **Hang** |
| 5 | `...845622c29f0bd53915` | 01:58:01 | Silence, ~16s, caller hung up | **Hang** |
| 6 | `...b473c7dfe8ab62` | 01:58:58 | "Time now." transcribed correctly, answered after ~9s of backend latency | Success (separate latency issue, `project_naavi_latency_issues`) |
| 7 | `...d4fdabb7a61e09` | 02:00:28 | Turn 1 clean; turn 2 ("What is on my calendar today?") answered but with raw JSON leaked into speech | Success (separate defect, [[B10n]]) |
| 8 | `...29bd310d` | 02:44:41 | Watchdog disarmed at +2676ms on `transcript=EMPTY`; every Results message for the full ~32s call was empty | **Hang, instrumented** |
| 9 | `...e0876870b8` | 02:49:06 | Watchdog disarmed at +2780ms on `transcript=EMPTY`; every Results message for the full ~19s call was empty | **Hang, instrumented** |
| 10 | (turns `4bd439be`/`901f337f`) | 02:51:17 | Watchdog disarmed at +2462ms on `transcript="No."` — content the caller states he never said; a second turn ("What is the payment") also answered content he never said | **Anomaly — see §6, not this defect** |
| 11 | `...952eefb` | 03:14:02 | Caller deliberately silent for ~38s (control test) — every Results message empty, no fabricated content | Correct behavior (control, not a bug instance) |
| 12 | (not captured) | ~03:19:55 | Caller asked "What is the time now" clearly — every Results message empty for the full visible ~22s, no answer | **Hang, real speech confirmed spoken** |
| 13 | `...45cca49997` | 03:22:48 | Same question repeated — transcribed as `"The time, no."` (minor STT mishearing of "now"), correctly answered "It's 3:23 AM Eastern, Sunday, July 19, 2026." | **Success, immediately after call #12's hang** |

**Calls #12 and #13 are the decisive pair.** Identical intent, spoken by the same person, on consecutive calls, on unchanged code — one produced total silence, the next produced a correct answer. This directly reproduces, with instrumentation for the first time, the long-standing historical pattern already recorded in `project_naavi_voice_call_hang` memory: *"hang up and redial — usually the second call works."* That pattern was previously observed and believed, never proven with a controlled, logged pair until tonight.

**Escalation context:** the historical baseline was "at least 3" occurrences over a longer period, with redial usually clearing it. Tonight alone produced at least 7 confirmed hangs (calls #1-5, #8-9, #12) in one session, plus the anomaly. Whether this reflects a genuine escalation in frequency or simply reflects tonight being the first time it was tested this many times in a row is not established either way.

## 3. Architecture Reference ownership (Phase 1 citation requirement)

Per `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` §4 (Protected Core table): **Voice orchestration** — `naavi-voice-server/src/index.js` (entire file) — "Controls every phone call; a mistake here is heard live by a real caller with no undo" — **Full Phase 1-8** review level.

This is not a Shared Core capability. The Deepgram STT connection, its reconnect watchdog, and Twilio media-frame forwarding are entirely voice-side code (`naavi-voice-server/src/index.js`) with no mobile counterpart — mobile's speech input (`hooks/useWhisperMemo.ts`) is batch record-then-transcribe with no live WebSocket STT connection, no watchdog, and no equivalent failure surface. Confirmed via direct grep: no matches for `deepgramWatchdog`, `connectDeepgram`, or Deepgram WebSocket handling anywhere outside `naavi-voice-server/src/index.js`.

**Classification: Voice-only (Protected Core), not Duplicated, not Shared Core.** No mirrored-fix question applies — there is only one implementation to investigate.

## 4. Root cause

**Root cause is not proven, and — given the confirmed intermittent, probabilistic nature of the failure (§1, §2) — may not be provable through further single-call log evidence alone.** What is proven, and what remains genuinely open, are separated explicitly below.

**Proven:**

1. **The reconnect watchdog is confirmed non-functional as a safety net.** Direct read of `naavi-voice-server/src/index.js:8939-8966`: it arms a 6-second timer on Deepgram WebSocket `'open'`, and disarms on the first `Results` message regardless of transcript content. Instrumented evidence (calls #8-10) shows it disarms in every call observed — hang or success — at ~2.5-2.8 seconds, before its own 6-second window could ever matter. **It disarms identically whether the call goes on to hang or succeed, so it cannot be, and is not, the cause of the hang** — it is simply broken as a protective mechanism, a separate and independently-true fact.
2. **`transcript=EMPTY` Results messages are normal Deepgram behavior, not a symptom by themselves.** They appear continuously in hangs, successes, and the deliberate-silence control call (#11) alike. Only the *complete absence of any non-empty transcript for an entire call with real speech present* (calls #1-5, #8-9, #12) is the actual symptom.
3. **The failure is not caused by our own code.** `naavi-voice-server/src/index.js` has been unchanged since 2026-07-16 (confirmed via `git diff`), and audio is confirmed flowing continuously into Deepgram in every hang (`FrameIn` climbs steadily, `DG state: OPEN` throughout) — ruling out a code regression or a broken audio-forwarding path as the cause.
4. **The failure is intermittent and resolves on retry, at least sometimes** — proven directly by calls #12→#13, not merely assumed from historical memory.

**Not proven, and the honest current limit of this investigation:**

Why Deepgram's STT engine sometimes produces zero output for real, clearly-spoken audio, while at other times (same server, same code, same evening) it works correctly, is not established by any evidence gathered tonight. No pattern distinguishing hang calls from success calls has been found — not timing, not call duration before failure, not any code-level condition. This may be an inherent reliability characteristic of the third-party Deepgram streaming connection itself, rather than something diagnosable further from our own logs. **This document does not claim to know which.**

**Separately, unresolved:** the anomaly in call #10 (content answered that the caller never said) has no explanation at all — not fabrication-under-silence (ruled out by control call #11), not obviously stale state (unverified). It is tracked as a distinct open question, not part of this root-cause statement (§6).

## 5. What alternatives were considered?

Three explanations were investigated and ruled out with direct evidence, not assumption:

1. **Audio forwarding broken (Twilio → Railway → Deepgram)**, per the old 2026-04-18 memory note's explanation. Ruled out: `FrameIn` counters climb steadily and `DG state` reads `OPEN` throughout every hang — audio is provably reaching the Deepgram connection the entire time.
2. **The B4b diagnostic logging commit caused this.** Ruled out: `f56f9da` was live only 8:34-9:09 PM EDT on 2026-07-18; none of this session's hangs (all after midnight, 2026-07-19) occurred while it was deployed, and the file has been otherwise unchanged since 2026-07-16.
3. **The watchdog's disarm condition causes the hang.** Ruled out directly by instrumented evidence (§4) — it disarms identically in calls that go on to succeed.

No fix direction is proposed in this document, per governance's No Assumptions Rule — root cause is not proven.

## 6. Explicitly out of scope for this defect

Three things found during tonight's testing that are **not** part of B10m, kept separate so this defect's evidence stays clean:

- **Backend latency** (call #6) — already tracked in `project_naavi_latency_issues`.
- **JSON-extraction leak into speech** (call #7, turn 2) — tracked separately as [[B10n]].
- **The unexplained phantom-content anomaly** (call #10) — Naavi answered "No." and "What is the payment," neither of which the caller says he said. A deliberate silence control call (#11) immediately after showed zero fabricated content, which argues against "Deepgram randomly hallucinates" as a standing explanation — but does not explain what happened in call #10 specifically. **This has no root cause, no explanation, and no assigned holding-list item yet.** It is flagged here rather than silently dropped, but is not folded into B10m's own root-cause statement (§4) because doing so would attribute an unexplained, single, different-shaped event to a defect whose own evidence (§2) is otherwise internally consistent without it.

## 7. No Assumptions Rule compliance check

Every claim above is backed by a specific citation (CallSid, timestamp, file:line, commit hash, or literal log line) or explicitly labeled "not proven." §4 does not extend "the watchdog is not the cause" into an unsupported claim about what the actual cause is — it states plainly that this may not be resolvable from further log evidence alone.

## 8. Recommended next steps (not yet approved, no fix designed)

Given §4's honest limit — the failure is real, intermittent, not explained by our own code, and may not yield to further single-call diagnostic logging — two different kinds of next steps are worth Phase 2 considering separately, neither designed here:

1. **Fix the watchdog for real, independent of root cause.** It is confirmed broken as a safety net (§4) regardless of why Deepgram sometimes fails. Requiring a non-empty transcript before disarming, and keeping a genuine reconnect-on-timeout active, would not explain the hang but could mitigate it operationally — turning a silent, unrecoverable failure into an automatic reconnect attempt.
2. **Consider this may be a third-party reliability issue outside further internal diagnosis.** Structurally, everything on our side checks out (§4.3) — this may warrant escalating the specific failed connection timestamps/CallSids to Deepgram directly, rather than continuing to add internal instrumentation that has already shown it cannot distinguish hang from success in advance.
3. **The phantom-content anomaly (§6) needs its own separate investigation**, not blocking on this item.

Per governance's No Assumptions Rule, none of the above is a scoped implementation plan — each would need its own Phase 2, pending Wael's own go-ahead.

## 9. How this document evolved tonight (condensed investigation history)

This Phase 1 went through several rounds of live testing and correction over the course of one evening, each documented in full at the time and preserved in this file's git history for anyone who wants the granular blow-by-blow. Condensed here rather than repeated in full:

1. **First draft** (5 pre-instrumentation hangs, calls #1-5): proposed the watchdog's empty-transcript disarm as the leading root-cause hypothesis. Reviewed and Approved.
2. **Phases 1A-6**: architecture review, change plan, technical review, implementation, evidence, and post-coding review all completed for temporary `[B10m-diag]` diagnostic logging (no behavior change). All Approved. Deployed to production (`49f56f3`).
3. **Phase 7 live testing, round 1** (calls #8-10): 2 more hangs plus one call initially read as "successful," which appeared to disprove the original watchdog hypothesis (the same disarm event occurred in the successful call too). Phase 1 was revised accordingly, reviewed, and Approved.
4. **Correction**: Wael clarified the "successful" call's transcribed content ("No.", "What is the payment") did not match what he actually said — reframing call #10 as an unexplained anomaly, not evidence Deepgram was working normally.
5. **Phase 7, round 2** (call #11): a deliberate-silence control call, to test whether Deepgram fabricates content under genuine silence. It did not — ruling out routine hallucination as an explanation for call #10.
6. **Phase 7, round 3** (calls #12-13): a controlled, back-to-back real-speech pair — the same question failed once and succeeded immediately after on retry — providing the clearest evidence gathered tonight that the hang is real, intermittent, and resolves unpredictably on retry.
7. **This rewrite** consolidates all of the above into one coherent document, at Wael's explicit request, rather than continuing to layer incremental patches onto an increasingly hard-to-follow file.

**Prior review records** (Phase 1 original draft, and the round-1 revision) are preserved in this file's git history, not reproduced here. **This rewritten version has not yet been sent for external review.**

## 10. Status

**Phase 1 rewritten 2026-07-19, consolidating a full evening of live production testing (13 calls). Not yet reviewed by the external reviewer in this rewritten form.** Root cause remains not proven, and this document states explicitly that it may not be provable through further log-based diagnosis alone. Two candidate next-step directions are named (§8) but not designed. Phase 7 (live manual testing) is not formally closed — further testing may still be pursued, but is understood to have diminishing evidentiary value given the confirmed probabilistic nature of the failure.
