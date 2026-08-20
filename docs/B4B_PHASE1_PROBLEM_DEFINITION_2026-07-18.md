# B4b — Phase 1: Problem Definition

**Date:** 2026-07-18 (revised same day per external reviewer feedback — see §12)
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 1
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4

No code was written in producing this document.

---

## 1. What exactly is broken?

During a live phone call, when the user starts speaking while Naavi's TTS is still playing (a "barge-in"), Deepgram's transcript of the user's utterance frequently loses the leading word or words. When the dropped word is a third-party recipient's name or the trigger verb itself ("Text", "Email"), the resulting alert silently misfires — see [[F5c]] for the exact downstream mechanism (a dropped name converts a third-party alert into a silent self-alert).

This is **confirmed voice-only**. Mobile's speech input (`hooks/useWhisperMemo.ts`) is batch record-then-transcribe with no live-streaming STT and no barge-in concept — it structurally cannot exhibit this failure. Direct evidence for this claim: `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` row `B4b` states this explicitly, and §3 below re-verifies it against current code rather than trusting the doc's prior claim at face value.

**Business severity, stated plainly (added per reviewer feedback — see §12 Gap 3):** this is a Protected Core defect not because it crashes anything, but because it fails silently at the worst possible point — the user hears Naavi's normal, confident confirmation regardless of whether the recipient's name survived transcription. There is no error, no hesitation, no signal to the user that anything went wrong. The eventual message either never reaches the person it was meant for, or silently redirects to the user themselves framed as a self-alert. Every instance of this erodes trust in every alert confirmation Naavi gives, not just the one that failed — the user has no way to tell, from Naavi's behavior, which confirmations are reliable.

## 2. What evidence proves the problem?

**Historical capture (2026-04-19), Railway logs, CallSid ending `4589ms`, 16:57:35–36:**
```
[Barge-in] User speaking — stopping playback
[Deepgram] FINAL: "Time is it?"
[Deepgram] UtteranceEnd
[Process] User said: "Time is it?"
```
User actually said "What time is it?" — Deepgram's FINAL transcript itself, not any downstream processing, is missing "What". Source: `project_naavi_deepgram_first_word_truncation` memory (89 days old at time of this writing — treated as a historical data point, not live-state evidence; the 2026-07-16/17 reproductions below are the current-state evidence).

**Four fresh reproductions, 2026-07-16/17 session** (`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` row `B4b`):
1. F17 Phase 7 test #4, first attempt — "Text Bob when I arrive at home" transcribed as "When I arrive at home" — both "Text" and "Bob" dropped.
2. Same test, second attempt — dropped again on the first try; only survived on a third retry.
3. F5c negative-case test — "Email Bob at [address] when I arrive at home" transcribed with no "Email Bob" at all, twice in a row.
4. Same test session, a later retry also dropped the leading words.

**Fifth reproduction, 2026-07-16, separate session** (`docs/SESSION_HANDOFF_2026-07-16_F19_TRACKB_CLOSED_B10A_FOUND.md:53,71`): "The barge-in/STT truncation bug ... still open, pre-existing since April, reproduced again this session, not fixed."

Five independent reproductions across three sessions, all showing the same signature: leading word(s) of the FINAL transcript missing when speech starts during TTS playback.

## 3. Architecture Reference ownership (Phase 1 citation requirement)

Per `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` §4 (Protected Core table): **Voice orchestration** — `naavi-voice-server/src/index.js` (entire file) — "Controls every phone call; a mistake here is heard live by a real caller with no undo" — **Full Phase 1-8** review level.

This is not a Shared Core capability. §0a's Ownership Model assigns Voice orchestration to the Voice Server repo (`munk2207/naavi-voice-server`) exclusively — Deepgram STT connection, barge-in detection, and transcript aggregation are entirely voice-side code with no mobile counterpart to check for duplication. Confirmed directly: `Grep` for barge-in/Deepgram/UtteranceEnd handling across the codebase returns matches only in `naavi-voice-server/src/index.js` (lines 2836, 8274-9600 range) — no equivalent logic exists in `hooks/` or `app/`.

**Classification: Voice-only (Protected Core), not Duplicated, not Shared Core.** No mirrored-fix question applies — there is only one implementation to fix.

## 4. Execution path (added per reviewer feedback — see §12 Gap 1)

The full path a spoken alert-creation request travels, end to end, with each hop's evidence. Hops 1-6 are directly verified in this Phase 1 investigation (file:line citations below); hops 7-9 are documented in the Architecture Reference and were not independently re-verified in this document's own investigation (cited, not re-proven, per governance's rule against re-deriving what's already established elsewhere).

```
1. Caller (phone, speaking during Naavi's TTS playback)
        │  PSTN audio
        ▼
2. Twilio (Voice + Media Streams, μ-law 8kHz)
        │  WebSocket 'media' events, ~50 frames/sec
        ▼
3. Voice Server — inbound frame handler
   naavi-voice-server/src/index.js:12659-12689 ('media' case)
   Forwards every frame to Deepgram unconditionally — no isSpeaking gate (§5b)
        │  deepgramWs.send(audio), line 12681-12682
        ▼
4. Deepgram (nova-3, mulaw/8000, endpointing=700ms, utterance_end_ms=2500ms)
   Config: naavi-voice-server/src/index.js:8274-8309 (buildDeepgramUrl)
   Emits interim + FINAL 'Results' messages; boundary where the drop is
   proven to occur (§5) — mechanism inside Deepgram not proven (§5)
        │  msg.channel.alternatives[0].transcript, is_final=true
        ▼
5. Voice Server — transcript aggregation
   naavi-voice-server/src/index.js:8968-9474 (Results handler),
   9478-9537 (UtteranceEnd → pendingText → processUserMessage)
   Transcript taken verbatim, no additional truncation (§5a)
        │  processUserMessage(pendingText)
        ▼
6. Voice Server — trivial fast-path check
   naavi-voice-server/src/index.js:2839-2841 (trivialRe / isTrivial)
   Only affects a narrow trivial-query whitelist (§5d) — an alert-creation
   phrase like "Text Bob..." falls through to full Claude reasoning
        │  full conversational turn → Claude
        ▼
7. Claude tool-use response (action_type, recipient fields)
   Per Architecture Reference §2a: voice runs its own classifier/reasoning
   loop here, independent of mobile's — not re-verified in this document
        ▼
8. action_rules table (Supabase) — row written with whatever recipient/
   trigger Claude inferred from the (possibly truncated) transcript
        │  later: geofence cross or cron tick
        ▼
9. Alert Engine (report-location-event / evaluate-rules, Architecture
   Reference §2) → send-sms / send-email (Shared Core) → real message
   delivered, to whoever the truncated transcript caused Claude to resolve
```

**Where this document's proven findings sit on this path:** the defect is proven to be at or before hop 4→5's boundary (§5a, §5b) — nothing between hop 5 and hop 9 is defective (see §7, Components not defective). Hop 4's internal mechanism (why Deepgram's own output is missing the word) is the unproven root cause this Phase 1 could not close (§5).

## 5. Root cause

**Root cause of the underlying STT/acoustic mechanism: not proven.** No direct evidence (raw Deepgram interim-vs-final message trace, timestamped) currently exists showing *why* the leading word is dropped — whether it is Deepgram's endpointing/VAD treating the first ~200-400ms of new speech as a continuation of the prior utterance's trailing silence window, an artifact of phone-line acoustic echo, or something else. This must not be asserted as fact without that evidence.

What **is** proven, by direct code and git-history inspection, narrows the space considerably:

**a) Our own code does not additionally truncate the transcript in the general conversational path.** Direct read of `naavi-voice-server/src/index.js:8968-9461`: `transcript` is taken verbatim from `msg.channel?.alternatives?.[0]?.transcript` (line 8969) and logged unmodified at line 9461 (`[Deepgram] FINAL: "${transcript}"`). Between those two points, the only conditional returns are for recording-mode (line 8993, gated on `isRecording`), Q&A mode (line 9023, gated on `qaState`), privacy-mute (line 9309), and stop-word commands (line 9433) — none of which apply to ordinary conversational turns. The barge-in handler itself (lines 9255-9264) only stops outbound TTS playback (`twilioWs.send({event:'clear'})`, `stopMusic()`) — it does not touch `transcript` or filter what gets aggregated into `pendingText`. **Conclusion: if the FINAL transcript is missing words, Deepgram sent it that way — this is not a code-side swallow.**

**b) Audio is forwarded to Deepgram continuously, not gated by barge-in state.** Direct read of `naavi-voice-server/src/index.js:12659-12689` (`case 'media':`): every inbound Twilio audio frame is forwarded to `deepgramWs.send(audio)` unconditionally whenever the Deepgram socket is open, with no `isSpeaking` check. The only frame-dropping path is at call start, before Deepgram's WebSocket has finished its handshake (comment at line 12568-12572: "Media packets arriving before Deepgram is ready are dropped... normal inbound calls have a ~2-3s Polly greeting... so this is plenty of time") — a pre-call-start condition, not a mid-call barge-in condition. **Conclusion: the audio itself reaches Deepgram in real time; nothing in our pipeline withholds the user's opening words from Deepgram's input stream.**

**c) No audio pre-roll/buffering exists to recover a dropped word.** `Grep` for `preRoll|pre-roll|prebuffer|rollingBuffer|circularBuffer|audioHistory` across `naavi-voice-server/src/index.js` returns no matches. Fix direction 2 from the original memory ("capture ~200ms of audio before barge-in fires, feed it back into Deepgram") was never implemented.

**d) The only fix ever shipped addresses a narrow symptom, not the mechanism, and does not cover the current reproduction shape.** Git history (`naavi-voice-server`, `src/index.js`) shows four attempts, all the same approach — relaxing the "trivial fast-path" regex to tolerate a missing leading word:
- `cb0a103` (2026-04-18) — first version
- `fa21da9` (2026-04-20) — relax further, reverted same day (`048ab14`)
- `73549ee` (2026-04-20) — bare time/day/date, reverted same day (`d531432`)
- `7b3c84c` (2026-06-06, "Item 3") — current shipped version, confirmed live in code at `naavi-voice-server/src/index.js:2836-2839`

Direct read of the current regex (`trivialRe`, line 2839) confirms its scope: it matches only a fixed whitelist of trivial phrases (name/time/date/day lookups, greetings, thanks) with the leading "what" made optional. It has no interaction with alert-creation phrasing at all. Applying this regex to reproduction #1's transcript ("When I arrive at home") confirms it does not match — the fix's scope was never intended to cover this class of utterance. **This directly explains, with evidence rather than assumption, the holding list's note that "the 2026-05-23 regex fix evidently doesn't cover this shape of drop": it was never designed to.**

**e) An adjacent investigation (F19 Track B-1e, 2026-07-15/16) ruled out an unrelated hypothesis but did not root-cause this bug.** Diagnostic logging was added (`fb63a29`, tag `[F19-1e-diag]`) to determine whether a *different* symptom (a confirm-turn loop) was caused by this same STT/barge-in mechanism. Per `docs/SESSION_HANDOFF_2026-07-16_F19_TRACKB_CLOSED_B10A_FOUND.md:16`: live trace showed that specific symptom was **not** caused by STT/barge-in corruption — the real cause was an unrelated fire-and-forget execution bug (closed separately). The same handoff (line 53, 71) reconfirms B4b itself is "still open, pre-existing, unfixed" — i.e., this diagnostic effort ruled out one confusion, not this bug's mechanism. **Confirmed via `Grep`: the `[F19-1e-diag]` logging no longer exists in current code** (removed per its own documented exit criteria) — so no residual instrumentation is currently available to capture a fresh raw trace without re-adding it.

**Summary:** the failure is proven to originate at or before Deepgram's `Results` message — not in any downstream code — but the precise acoustic/VAD mechanism inside that boundary is not proven and would require new evidence (a raw, timestamped capture of Deepgram interim + final messages during a live repro) to establish.

## 6. What alternatives were considered?

From `project_naavi_deepgram_first_word_truncation` memory (2026-04-19), four fix directions, status updated against current evidence:

1. **Relax the trivial fast-path regex** — implemented (`7b3c84c`) but proven, by direct comparison, to cover only a narrow trivial-query whitelist, not the alert-creation phrasing that produced all 5 reproductions above. Cannot be the fix for this bug's damaging cases.
2. **Barge-in audio pre-roll buffering** (~200ms captured before barge-in fires, replayed to Deepgram) — never implemented (confirmed by grep, §5c). Untested, not ruled in or out.
3. **Deepgram config tuning** (`endpointing`/`utterance_end_ms`) — these values were changed once (`edac64b`, 300→700ms / 1000→2500ms) but explicitly "to prevent cutting off long questions" (a segment-*end* problem), not a leading-word/segment-*start* problem — this change was not aimed at and has not been evaluated against this bug.
4. **STT retry on short utterances** — never implemented.

None of 2-4 have been evaluated with evidence. No fix is proposed in this document per governance's No Assumptions Rule — root cause is not proven.

## 7. Scope boundary — components not defective (added per reviewer feedback — see §12 Gap 2)

**Confirmed not affected, and why they only appear implicated:**

- **SMS / Email sending (`send-sms`, `send-email`, Shared Core).** These functions send exactly what they're told to send. If a message goes to the wrong person or never mentions the right person, the defect is upstream (hop 4-5 of §4) — these senders correctly execute a bad instruction, they don't produce one.
- **Reminder Engine (`check-reminders`).** Not on this bug's path at all — reminders are a separate trigger/table from the Action Rules alert-creation flow this bug corrupts input to. No evidence connects this bug to reminder delivery.
- **Calendar integration (`create-calendar-event`, `delete-calendar-event`).** Same reasoning as Reminder Engine — a different capability, not on this bug's execution path (§4), not evaluated as part of this investigation because there is no evidence connecting them.
- **Geofence engine (`report-location-event`'s trigger *detection*).** The geofence-crossing detection itself (did the phone cross the boundary) is unrelated and unaffected. Only the *recipient field* the alert was configured with, hop 8-9 of §4, can be wrong as a downstream consequence — the geofence mechanism that decides *when* to fire is untouched.
- **Mobile app, entirely.** Re-confirmed in §1 and §3 — no live-streaming STT with barge-in exists on mobile; this bug has no mobile-side counterpart to check.

**Why this section matters:** every system listed above is a downstream consumer of whatever recipient/intent Claude resolved from the (possibly corrupted) transcript. They faithfully execute what they're told. None of them has an independent defect, and a reviewer or future session should not spend time auditing them for this bug — the entire defect lives in the narrow window between Deepgram's STT output and the aggregated transcript handed to Claude (§4, hops 4-5).

## 8. Success criteria (added per reviewer feedback — see §12 Gap 4)

Phase 1 defines the problem, not the fix — these are proposed **acceptance criteria for Phase 2/5** to formalize and measure against, not a prescribed implementation:

1. **Reproduction rate:** across a defined number of live barge-in trials on real calls (candidate: 20 consecutive trials, chosen because the failure is probabilistic — 5 reproductions across prior sessions is not enough to establish a baseline rate for comparison), the leading word(s) of the FINAL transcript are preserved in at least the same proportion a fix is expected to guarantee. Phase 2 should set the actual target rate and trial count; this document does not choose one.
2. **Recipient integrity:** for alert-creation phrasing specifically ("Text/Email [name] when..."), the recipient name written to `action_rules.action_config` (`to_name`/`to_phone`/`to_email`) matches what the user actually said, verified against the call recording or a live listener — not just that *some* text survived.
3. **Trigger-verb integrity:** the action type (`sms` vs `email` vs other) written to `action_rules` matches what the user actually said — a dropped verb should not silently default to the wrong channel.
4. **No regression to the existing trivial fast-path:** whatever fix is chosen must not degrade the already-working trivial-query latency behavior (`trivialRe`, §5d) — date/time/name lookups during barge-in should remain fast.
5. **Non-Determinism Rule compliance:** per governance §3 (Phase 3), any fix touching STT/prompt behavior must be validated with a minimum of 3 independent trials per positive-control case before being considered verified — this bug's own probabilistic nature (§5, five reproductions, not 100% reproducible on demand) makes this rule especially load-bearing here, likely warranting more than the governance minimum given criterion 1 above.

## 9. No Assumptions Rule compliance check

Every claim above is either backed by a specific citation (file:line, commit hash, log line, or doc reference) or explicitly labeled "not proven." No use of "probably" or "likely" appears in this document as a basis for any decision.

## 10. Recommended next step (not yet approved)

To move Phase 1's root cause from "not proven" to "proven," the evidence gap is a raw, timestamped Deepgram message trace (interim + final results, not just the final aggregated transcript) captured during a live reproduction, so it's possible to distinguish:
- Deepgram never received the audio for the dropped word(s) at all (an audio-path issue), vs.
- Deepgram received it but its VAD/endpointing excluded it from the utterance's FINAL result (a Deepgram-model/config issue), vs.
- Deepgram included it in an early interim result that our own aggregation logic never captured (a code issue — though §5a's read makes this the least likely of the three).

This would require reinstating targeted diagnostic logging (similar in spirit to the removed `[F19-1e-diag]` instrumentation, but logging Deepgram's raw interim results alongside finals) for a live test call — itself a small, temporary, diagnostic-only change. Not proposed for implementation here; flagged for Phase 1A / Phase 2 to scope explicitly, pending Wael's go-ahead to proceed past Phase 1.

---

## 11. Deferred item — governance template recommendation

The external reviewer separately recommended a standing, fixed 10-section structure for all future Phase 1 documents (Problem Definition, Evidence, Architecture Ownership, Execution Path, Scope Boundaries, Root Cause, Alternatives, Business Impact, Success Criteria, Recommended Next Step — which this revised document now follows in substance). Per Wael's own instruction, this is being tracked as a **separate governance-change decision** (governance §9's process — stated problem/benefit/example, external review, Wael's explicit approval, version bump, changelog entry), not bundled into B4b's own approval. Not adopted as a standing rule in this document.

---

## 12. Phase 1 review record (2026-07-18)

External reviewer (ChatGPT) verdict on the original Phase 1 draft: **Approved with minor documentation improvements.** Full assessment: problem definition rated precise, evidence separation (historical vs. current vs. architecture vs. code) rated excellent, architecture-ownership-first sequencing rated as the governance's intended pattern working correctly, root-cause discipline (proven vs. not-proven, no invented mechanism) rated the strongest section, alternatives evaluation rated valuable, and the explicit No Assumptions compliance check recommended as a standing element of every future Phase 1.

Four gaps identified, not requiring technical rework, all incorporated into this revision:

1. **Gap 1 — missing explicit execution path.** Ownership, location, and non-duplication were proven, but a reviewer had to mentally reconstruct the caller→Twilio→Voice Server→Deepgram→transcript→intent→alert chain. **Addressed:** new §4, with file:line citations for every hop this Phase 1 directly verified, and explicit acknowledgment of which hops are cited from the Architecture Reference rather than independently re-verified here.
2. **Gap 2 — scope boundary could be stronger.** The document proved mobile is unaffected but never stated which *server-side* components are not defective, risking a future reviewer chasing SMS/Email/Reminders/Calendar/Geofence unnecessarily. **Addressed:** new §7, explicitly listing each downstream consumer and why it's a faithful executor of bad input rather than an independent defect.
3. **Gap 3 — business severity stated only technically.** **Addressed:** added to §1, tying the defect to silent success-confirmation and erosion of trust in every alert Naavi confirms, not just the failing one.
4. **Gap 4 — no success criteria.** Phase 1 defined the problem but not when it would be considered solved, which Phase 2 needs. **Addressed:** new §8, proposed (not prescribed) measurable acceptance criteria, explicitly deferring the actual trial-count/target-rate decision to Phase 2.

A fifth reviewer recommendation — adopting a fixed 10-section template for all future Phase 1 documents — is **not** adopted here; tracked separately per §11, per Wael's own instruction to keep it a distinct governance decision rather than bundle it into this document's approval.

**This section is the record of the review; it is not, by itself, authorization to proceed.** Per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3): moving to Phase 1A requires Wael's own separate, explicit go-ahead, regardless of this review's verdict. That has not yet been given.

---

## 13. Status

**Phase 1 drafted 2026-07-18, revised same day per external review (§12), all four documentation gaps incorporated. Phase 1A has NOT started and will not start until Wael gives explicit, separate approval for that specific transition.**
