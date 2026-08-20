# B10m — Phase 1: Problem Definition (v2 — consolidated end-of-night rewrite)

**Date:** 2026-07-19
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 1
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4
**Supersedes:** `docs/B10M_PHASE1_PROBLEM_DEFINITION_2026-07-19.md` (the first rewrite) — that document is preserved, not deleted, and remains the source for the earlier investigation's own audit trail (§9 there). This v2 exists because a full night of further testing, a shipped mitigation, a shipped caller-experience fix, and a third-party escalation happened after that document was last updated, per Wael's request to consolidate again rather than keep patching.

No code was written in producing this document.

---

## 1. What exactly is broken?

On a live phone call to Naavi's production voice number, Deepgram's speech-to-text WebSocket connects and audio is forwarded to it continuously, but **on some calls, Deepgram never produces a transcript of the caller's real, spoken words — for the entire call**, despite confirmed real speech signal being present and sent. This is intermittent: the same phrase, asked twice in a row minutes apart, has failed completely once and worked correctly the next time, on unchanged code.

**As of this rewrite, the situation is materially different from the first Phase 1** in three ways:

1. **A mitigation is shipped and confirmed working.** The reconnect watchdog — previously proven to be non-functional as a safety net — now correctly detects the failure and attempts two reconnects. Confirmed live: it fired and reconnected twice on a real hang.
2. **Reconnecting does not recover the call.** All three connection attempts in that same call (original + 2 reconnects) received zero transcript, despite continuous, confirmed non-silent audio.
3. **The failure is now confirmed to originate outside our own system.** An audio-amplitude diagnostic proved real speech signal (avg amplitude 698, clearly non-silent) was present and sent to Deepgram during a hang. Our own code, audio path, and infrastructure are confirmed structurally sound. This has been escalated directly to Deepgram (GitHub Discussion #1645, `deepgram/community`, unanswered as of this writing).
4. **A caller-facing fix is shipped**, independent of the root cause: once both reconnect attempts are exhausted with still no transcript, Naavi now speaks an apology and hangs up cleanly instead of leaving the caller in dead silence for the rest of the call.

**This remains, and may permanently remain, a "root cause not proven" item** — not because the investigation was insufficient, but because the evidence now points at a third party's own STT engine, which cannot be directly inspected from our side. What follows documents what is proven, what has been mitigated, and what is still genuinely open.

This is distinct from three other things found during testing and explicitly not part of this defect: backend latency (`project_naavi_latency_issues`), a JSON-extraction leak into speech ([[B10n]]), and a single unexplained phantom-content anomaly (§7).

**Business severity, updated:** the core failure (Deepgram silently not hearing a caller) is unchanged in severity — still Protected Core, still "a mistake here is heard live by a real caller with no undo." What has changed is the *caller's experience* of the failure: previously, total silent dead air with no recovery path; now, a clear spoken message and an honest, clean call ending. That is a real reduction in harm even though the underlying transcription failure itself is not fixed.

## 2. What evidence proves the problem?

**Full evidence base, in three phases of testing across one evening:**

**Phase A — original discovery (13 calls, pre-mitigation), fully detailed in the v1 document's §2.** Summary: 8+ confirmed hangs (zero transcript, entire call, despite continuous audio), 3 confirmed successes, one latency issue, one JSON-leak defect, and one unexplained phantom-content anomaly. The clearest single piece of evidence from this phase: the identical question, asked twice in a row on consecutive calls, failed completely once and succeeded immediately after (calls `#12`→`#13` in the v1 document).

**Phase B — watchdog fix, live-tested.** After shipping commit `90a5072` (require non-empty transcript before disarming), a test call showed, for the first time in this entire investigation:
```
[Deepgram] Watchdog: no transcript after 6s with 387 frames — reconnecting (attempt 1)
[Deepgram] WebSocket closed: code=1005
[Deepgram] WebSocket connected
[Deepgram] Watchdog: no transcript after 6s with 702 frames — reconnecting (attempt 2)
[Deepgram] WebSocket closed: code=1005
[Deepgram] WebSocket connected
[Deepgram] Watchdog: silent hang detected but reconnect limit reached
```
The watchdog fired and reconnected exactly as designed. **All three connections (original + 2 reconnects) produced zero transcript for the entire ~30-second call.** This proved the fix works correctly, and separately proved reconnecting alone does not resolve the underlying issue.

**Phase C — audio-content diagnostic, corrected, decisive.** A first attempt at an audio-signal check (`b141be5`, byte-match heuristic) was found unreliable — it reported "100% near-silence" even during a call with two correctly-transcribed, correctly-answered turns, so it could not distinguish anything. A corrected version (`e4ad140`, real mu-law-to-linear decode, rolling amplitude average) was deployed and tested against a fresh hang:
```
[FrameIn] #100 at +1872ms since call-start (DG state: OPEN)
[B10m-diag] Audio level over last 100 frames: avg amplitude 698
[B10m-diag] Results msg at +2550ms since call-start, final=false speechFinal=false transcript=EMPTY
```
**Real, non-trivial signal (698, later 72 and 27 at other points in the same call) was confirmed present in the audio sent to Deepgram, at multiple points, across a hang that never once produced a transcript.** This is the decisive finding of the entire investigation: it rules out "our own audio path is silent or broken" and points at Deepgram's STT engine itself failing to transcribe audio it demonstrably received.

**Separately, in the same testing round:** 3 of 4 phone call attempts didn't ring at all — no log evidence exists for them (the calls likely never reached the voice server). This is a different symptom, not diagnosed here, not part of B10m's evidence base.

## 3. Architecture Reference ownership (Phase 1 citation requirement)

Unchanged from the v1 document. Per `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` §4 (Protected Core table): **Voice orchestration** — `naavi-voice-server/src/index.js` (entire file) — **Full Phase 1-8** review level. Voice-only, not Duplicated, not Shared Core — confirmed via direct grep, no matches for the relevant Deepgram/watchdog logic outside this one file.

## 4. Root cause

**Root cause is not proven, and is now understood to likely sit outside code this project controls.**

**Proven, by direct evidence:**
1. The original watchdog was non-functional as a safety net (disarmed identically in success and failure) — fixed, confirmed working (§2, Phase B).
2. Reconnecting to a fresh Deepgram WebSocket does not, by itself, resolve an in-progress hang — proven directly (§2, Phase B), not assumed.
3. Real, non-silent audio signal is confirmed present and sent to Deepgram during a hang — proven directly via amplitude decoding (§2, Phase C), not inferred.
4. Our own code is not the cause — unchanged for multiple days across dozens of reproductions, audio path confirmed structurally sound.
5. The failure is intermittent and can resolve on its own between calls — proven via the `#12`→`#13` pair (Phase A).

**Not proven, and now explicitly acknowledged as possibly unprovable from our side:** why Deepgram's Nova-3 streaming engine sometimes fails to transcribe audio it has verifiably received, while working correctly on other calls with identical code and infrastructure on our end. This is now the subject of a direct escalation to Deepgram (GitHub Discussion #1645) rather than further internal diagnosis — internal evidence-gathering has reached the limit of what our own logs can determine.

## 5. What alternatives were considered?

All alternatives from the v1 document remain ruled out (audio forwarding broken, the B4b diagnostic commit, the watchdog disarm condition as differentiator). One additional alternative considered and ruled out this round:

4. **The audio-content diagnostic's first version (byte-match heuristic) as evidence of anything.** Ruled out as unreliable — it reported near-100% silence even during confirmed-successful transcriptions, meaning it could not discriminate signal from silence at all. Replaced with a proper amplitude decode before drawing any conclusion from it.

## 6. What's been done about it, given root cause may be unprovable

Per governance's No Assumptions Rule, no fix for the *unproven root cause* is proposed here. But two real, evidence-justified actions have been taken, each targeting something that **is** proven, independent of the Deepgram question:

1. **Watchdog fix** (`90a5072`) — mitigates the proven-broken safety net. Confirmed working; does not by itself resolve hangs (§2, Phase B).
2. **Caller-facing fallback message + clean hang-up** (`5f29255`) — once reconnects are exhausted with still no transcript, Naavi speaks "I'm sorry, I'm having trouble hearing you right now. Please try calling back in a moment. Goodbye[, name]." and ends the call, instead of leaving the caller in dead silence for the remainder. This does not fix the transcription failure — it fixes what the caller experiences when it happens.
3. **Escalated to Deepgram directly** — GitHub Discussion #1645, `deepgram/community`, "General help" category. Full post content in `docs/B10M_DEEPGRAM_FORUM_POST_DRAFT_2026-07-19.md`. Unanswered as of this writing.

## 7. Explicitly out of scope for this defect

Unchanged from the v1 document (§6 there): backend latency (`project_naavi_latency_issues`), the JSON-extraction leak ([[B10n]]), and the unexplained phantom-content anomaly (one occurrence, Naavi answered content the caller never said — no root cause, no explanation, deliberately not folded into this defect's evidence). Newly noted this round: the "3 of 4 calls didn't ring" symptom, no evidence available, not diagnosed, not this bug.

## 8. No Assumptions Rule compliance check

Every claim above is backed by a specific citation (commit hash, log line, CallSid/timestamp, or explicit reference to the v1 document's own evidence) or labeled "not proven." §4 explicitly distinguishes what's proven from what may be permanently unprovable from this side — it does not extend "our code is fine" into an unsupported claim about what Deepgram's actual internal failure is.

## 9. Status and next steps

**Investigation is functionally complete from our side.** Further internal diagnosis is not expected to add meaningful new evidence — the remaining unknown (why Deepgram's engine sometimes fails on valid audio) is not observable from our logs, only from Deepgram's own. Next steps are external, not internal:

1. **Monitor Discussion #1645** for a response from Deepgram.
2. **Observe the fallback message in production** over time — does it reduce caller confusion/complaints, even though the underlying rate of hangs is presumably unchanged.
3. **The phantom-content anomaly (§7) remains genuinely unexplained** and could be picked up as its own investigation if it recurs.
4. **B4b (Deepgram word-drop) remains blocked** behind B10m per this session's own standing note — a silently-failing call produces no useful B4b evidence; resume B4b's manual testing only once B10m's caller-facing behavior is stable enough that test calls reliably reach the point B4b needs to observe.

**This document (v2) is submitted for external review**, same as every prior phase document tonight.
