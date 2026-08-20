# B4b — Phase 2: Change Planning

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 2. Started 2026-07-18 on Wael's explicit go-ahead ("Go Phase 2"). No code was written in producing this document.

**This is an investigation plan, not a fix implementation plan** — the same framing F19 Track B-1e's Phase 2 used for the same reason. Phase 1 (`docs/B4B_PHASE1_PROBLEM_DEFINITION_2026-07-18.md` §5) proved the failure originates at or before Deepgram's `Results` message, but explicitly could not prove the underlying mechanism, and governance's Phase 1 rule is unambiguous: *"If direct evidence is missing, Claude must state: 'Root cause not proven.' No fix is proposed until the root cause is proven."* Designing a fix now would mean guessing at a mechanism with no evidence — exactly what governance exists to prevent. What Phase 2 plans instead is the smallest possible change that produces the missing evidence: temporary diagnostic logging, following the already-approved precedent (`fb63a29`, F19 Track B-1e, Phase 3 Round 4 approval) for exactly this situation on this same file.

---

## 1. What this change is (and isn't)

**Is:** additive, temporary, diagnostic-only logging inside `naavi-voice-server/src/index.js`'s Deepgram message handler and barge-in handler, to capture the raw evidence Phase 1 §10 identified as missing — specifically, every Deepgram `Results` message (interim **and** final, not just final) with its timestamp, `is_final`/`speech_final` flags, and transcript text, correlated against barge-in state.

**Is not:** a fix for the leading-word-drop bug. No behavior changes. Nothing about transcript handling, aggregation, or the trivial-fast-path regex is modified. Once this logging captures enough live reproductions to reach one of Phase 1 §10's three verdicts (audio-path issue / Deepgram VAD-endpointing issue / our own aggregation-code issue), *that* finding becomes its own Phase 1 revision or a fresh Phase 1, which then plans the actual fix — not this document.

---

## 2. Files that will change

| File | Classification | Change |
|---|---|---|
| `naavi-voice-server/src/index.js` | Backend (Voice orchestration, Protected Core) | Add diagnostic `console.log` statements only — no new files, no config, no schema, no dependency changes. |

Only one file changes. No other file in the repository is touched.

---

## 3. Proposed logging additions (planning-level detail, not code)

Modeled directly on the `[F19-1e-diag]` precedent (`fb63a29`) — always-on `console.log`, no env-var/feature-flag gating (matching the precedent's own simplicity), tagged distinctly (`[B4b-diag]`) so it can be grepped independently of any other diagnostic tag still in logs.

1. **Barge-in marker** — at the existing barge-in handler (`naavi-voice-server/src/index.js:9255-9264`), record a timestamp (not just a boolean, unlike the 1e precedent — B4b's diagnostic needs to correlate against *when* Deepgram messages arrive relative to the barge-in, not just whether one happened this turn) when `[Barge-in] User speaking — stopping playback` fires.

2. **Every Deepgram Results message, not just FINAL** — inside the `Results` handler (`naavi-voice-server/src/index.js:8968-8971`, where `transcript`/`isFinal`/`speechFinal` are already computed from `msg`), add one log line per message covering **both interim and final** results: transcript text, `is_final`, `speech_final`, timestamp, and milliseconds since the last barge-in marker (from item 1) if one occurred recently (e.g. within the last 3 seconds — wide enough to cover Deepgram's `utterance_end_ms: 2500` window). This is the core addition the `[F19-1e-diag]` precedent didn't have — that precedent only logged the final aggregated transcript per turn, which is exactly why it couldn't have answered B4b's question even if it had still been in place.

**Why this design answers Phase 1 §10's three hypotheses:**
- If no Results message (interim or final) ever contains the dropped word, close to the barge-in marker → supports **hypothesis 1** (audio-path issue — Deepgram never got it). Phase 1 §5b already found this unlikely (audio is forwarded unconditionally) but not impossible (loss could occur inside Deepgram's own ingestion).
- If an interim result contains the word but the FINAL does not → supports **hypothesis 2** (Deepgram's own VAD/endpointing excluded it during finalization) — this would also, incidentally, disprove hypothesis 3 for that reproduction.
- If an interim result contains the word and our current code simply never used it (because only `isFinal` chunks are aggregated into `pendingText`, confirmed at `naavi-voice-server/src/index.js:9474`) → supports **hypothesis 3** (a code-side gap, not a Deepgram defect) — this would be the best-case outcome, since it means the fix is entirely on our side and does not depend on Deepgram's model behavior at all.

**What is deliberately NOT proposed:** capturing or storing raw call audio for offline analysis. Rejected as an alternative — Deepgram's own transcript-level output is sufficient to test all three hypotheses above, and recording raw audio would introduce a real privacy/storage burden (this project already has explicit privacy-mute features for exactly this class of concern) with no corresponding evidentiary benefit over transcript-level logging.

**Expected operational impact (added per reviewer feedback — see §11):** Deepgram emits interim results roughly every 100-300ms during active speech (typical streaming-ASR cadence), so each utterance adds on the order of 5-15 extra log lines during the diagnostic window versus today's final-only logging — a modest, bounded increase in Railway log volume, not a per-audio-frame cost (audio frames arrive every 20ms but are not what's being logged). This is the same order of magnitude as logging already present in this same handler (e.g. the existing frame-gap/heartbeat logging at `naavi-voice-server/src/index.js:12665-12679`) and is not expected to introduce measurable latency to the STT→Claude turn pipeline — `console.log` calls do not block the WebSocket message loop. Deployment is a single Railway auto-deploy from `main` (per `CLAUDE.md`'s "HOW THE VOICE SERVER DEPLOYS"), typically live within a few minutes of push, matching the `fb63a29` precedent's own deployment shape — no extended rollout window.

---

## 4. Risk classification

**Low.** Purely additive logging, no control-flow changes, no new state read by any decision branch. Matches the already-approved `fb63a29` precedent's own risk profile on this exact file.

**Governance level: Full Phase 1-8 anyway**, because the file is Protected Core (`naavi-voice-server/src/index.js`, Architecture Reference §4) — per this project's own established rule, size of change and required rigor are not correlated; Protected Core always gets full review regardless of how small the diff looks.

---

## 5. Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | No | Voice-only capability (Phase 1A §2); no mobile file touched. |
| Voice | Yes | `naavi-voice-server/src/index.js` — new log statements only, in the Results handler and barge-in handler. |
| Shared Core | No | No Edge Function, no Supabase table, no Shared Core file touched. |
| Database | No | Logging goes to Railway console output only, same as the `fb63a29` precedent — no DB write, no schema change. |
| Cron | No | Not cron-related. |
| API contracts | No | No request/response shape changes anywhere; purely internal console output. |
| Tests | No new automated test — see §6 (Rule 15a exception path) below; not silently skipped. |

Not duplicated (Phase 1A §2) — no "will both implementations change" question applies; there is exactly one implementation.

---

## 6. Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** No.
- **Does this change modify an Entry Point (mobile or voice translating logic rather than Shared Core)?** Yes, narrowly — it adds instrumentation inside the Voice entry point's STT-handling code. It does not add or change any translation/business logic; the entry point's actual behavior (what it does with a transcript) is unchanged.
- **Does this change introduce new duplication?** No.
- **Does this change eliminate existing duplication?** No.
- **Does this change modify Protected Core?** Yes — `naavi-voice-server/src/index.js` is Protected Core (Voice orchestration, Architecture Reference §4). This is why full governance applies to what is otherwise a trivial diff.

---

## 7. Regression Impact

Per governance's fixed checklist — stated explicitly for each, per the "silence is not acceptable" rule:

- **Voice commands:** Not affected. No branch, return, or timing logic changes — only additive logging in a message handler that already runs on every turn.
- **Geofencing:** Not affected. Unrelated subsystem, no shared file.
- **Gmail integration:** Not affected.
- **Calendar integration:** Not affected.
- **Reminders:** Not affected.
- **SMS / call alerts:** Not affected. This diagnostic only observes the STT input stage (Phase 1 §4, hops 4-5); it does not touch the Action Rules write path or Alert Engine (hops 7-9), which Phase 1 §7 already established are not defective.
- **Onboarding:** Not affected.
- **Staging build:** **No voice staging environment exists** (holding-list Tier 5, "Voice Staging platform... not started"). Per `CLAUDE.md`, `naavi-voice-server` auto-deploys to production Railway (`naavi-voice-server-production.up.railway.app`) directly from `main` — there is no staging tier to land this in first. **This means even this diagnostic-only change deploys straight to the production voice line serving real callers.** Flagged explicitly rather than glossed over, consistent with this project's staging-first philosophy even though voice itself doesn't yet have the infrastructure to honor it. Mitigation: the change is additive-only (no behavior change) and mirrors an already-approved, already-deployed-to-production precedent (`fb63a29`) with no reported incident.

---

## 8. Regression Matrix (per-change consumer trace)

The two touched locations are not shared/exported functions with discrete external callers — they are inline logic inside the single `wss.on('connection', ...)` closure that handles every live Twilio Media Stream connection. The "consumer" of this code is **every active phone call** on the production voice line, since (per §7) no staging tier exists to isolate a test population. This is stated directly rather than forced into a caller-search framing meant for shared utility functions with multiple call sites — confirmed by `Grep` for `deepgramWs.on('message'` and the barge-in handler's containing function: both live inside the same per-connection closure, with exactly one execution context per call, not a reusable function invoked from multiple places.

---

## 9. Logging removal criteria (carried forward from Phase 1 §10 and the `fb63a29` precedent)

The temporary logging added under this Phase 2 is removed once **all three** are true, matching the precedent's own exit-condition discipline:

1. At least 3 independent live reproductions of the barge-in truncation are captured with full diagnostic output (the Non-Determinism Rule's minimum trial count, governance §Phase 3, applied here even though this isn't a classifier/prompt change — the same "don't conclude from one trial" discipline is warranted given this bug's own probabilistic reproduction rate, Phase 1 §2).
2. A verdict is reached among Phase 1 §10's three hypotheses (or "neither confirmed" if the traces don't cleanly support one) and written up as a Phase 1 revision or fresh Phase 1 document.
3. If the verdict warrants a fix, that fix is scoped as its own Phase 1→2 cycle (or the decision to defer it is explicitly recorded) — this document's diagnostic logging does not itself become the fix by inertia.

---

## 10. Next step

Per governance §3 (Medium/High risk and Protected Core changes require Phase 3 review before coding): this plan requires Phase 3 — Technical Review before any of the logging described in §3 is implemented. **Not started, and will not start without Wael's own separate, explicit go-ahead**, per the Phase-Gate Approval Rule.

---

## 11. Phase 2 review record (2026-07-18)

External reviewer (ChatGPT) verdict: **Approved.** Full assessment: correct interpretation of Phase 2 as an investigation plan rather than a premature fix rated the strongest aspect; minimal-change philosophy, purposeful (not exploratory) diagnostic design, explicit rejection of raw-audio capture, the implementation-risk-vs-governance-level distinction, the explicit architecture checklist, the honest production-deployment acknowledgement (no voice staging exists), and the logging removal criteria were all rated strong. No blocking gaps identified.

One optional recommendation, adopted: document expected operational impact (log volume, performance cost, deployment duration) so reviewers and production operators have a clear expectation of what to observe. **Addressed:** new paragraph added to §3 above, covering expected log-line volume per utterance, comparison to existing logging already present in the same handler, expected latency impact (none — `console.log` is non-blocking), and deployment shape (single Railway auto-deploy, minutes, matching the `fb63a29` precedent).

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to proceed to Phase 3.** Per the Phase-Gate Approval Rule, that requires Wael's own separate, explicit go-ahead. Given 2026-07-18 ("#1 first, confirm then go Phase 3").

---

## 12. Status

**Phase 2 drafted and reviewed 2026-07-18, one optional enhancement (operational impact) adopted. Phase 3 authorized to start by Wael, 2026-07-18.**
