# B4b — Phase 5: Evidence Package

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 5. Implementation completed exactly within the Implementation Boundaries confirmed in `docs/B4B_PHASE3_TECHNICAL_REVIEW_2026-07-18.md` §2, verified fresh in `docs/B4B_PHASE4_IMPLEMENTATION_VERIFICATION_2026-07-18.md` (Approved). Started 2026-07-18 on Wael's explicit go-ahead ("go Phase 5").

**This is an evidence package for diagnostic instrumentation, not for a fix** — consistent with Phase 2/3's framing throughout. There is no "does the bug still happen" test to run, because no fix was implemented. The evidence here proves the *instrumentation* is correctly built and safely deployed; the actual payoff (evidence toward B4b's root cause) only starts accumulating once live calls with barge-in occur.

---

## Summary

Added temporary diagnostic logging to `naavi-voice-server/src/index.js` to capture the evidence Phase 1 identified as missing: every Deepgram `Results` message (interim **and** final, not just final) with timestamp, `is_final`/`speech_final` flags, transcript text, and milliseconds since the last barge-in event, tagged `[B4b-diag]`. This closes the specific gap the earlier `[F19-1e-diag]` precedent (`fb63a29`) left — that instrumentation only logged the final aggregated transcript per turn, which cannot show whether a leading word survived in an early interim result before being dropped from the FINAL.

No behavior change. No fix. Purely additive — one new state variable, one new log block, one new line inside the existing barge-in handler, all at the exact positions `docs/B4B_PHASE3_TECHNICAL_REVIEW_2026-07-18.md` §1-2 authorized.

**Committed and pushed** (`f56f9da`, `naavi-voice-server` `main`, 2026-07-18). **Deployment to production Railway not independently verified from this environment** (`docs/B4B_PHASE4_IMPLEMENTATION_VERIFICATION_2026-07-18.md` §4) — no Railway CLI/API access available here; confirmation is deferred to the first live test call (§"Manual tests required" below).

---

## Files changed

| File | Repo | Change |
|---|---|---|
| `src/index.js` | `naavi-voice-server` | 3 additive insertions (13 lines total): a new state variable, a new diagnostic log block in the Deepgram Results handler, and one new line in the existing barge-in handler. No other line touched. |

No other file in either repository touched. No schema change, no new Edge Function, no dependency change, no config/env-var change.

---

## Git diff

```diff
@@ -8322,6 +8322,7 @@ wss.on('connection', (twilioWs) => {
   let userId = null;       // Resolved per-call, not cached globally
   let userName = '';       // User's name from user_settings
   let pendingText = '';
+  let lastBargeInAt = null; // B4b diagnostic (temporary, see docs/B4B_PHASE2_CHANGE_PLAN_2026-07-18.md §9 for removal criteria)
   let conversationHistory = [];
   let isProcessing = false;
   let pendingDraft = null; // Stores draft waiting for voice confirm
@@ -8970,6 +8971,17 @@ wss.on('connection', (twilioWs) => {
           const isFinal = msg.is_final === true;
           const speechFinal = msg.speech_final === true;
 
+          // B4b diagnostic (temporary, see docs/B4B_PHASE2_CHANGE_PLAN_2026-07-18.md
+          // §9 for removal criteria, docs/B4B_PHASE3_TECHNICAL_REVIEW_2026-07-18.md
+          // §1b for design rationale): log every Results message, interim AND
+          // final, to capture evidence the existing [Deepgram] FINAL: log below
+          // (final-only) can't — whether a barge-in-dropped word ever appeared
+          // in an earlier interim result before being lost from the FINAL.
+          if (transcript) {
+            const sinceBargeIn = lastBargeInAt ? (Date.now() - lastBargeInAt) : null;
+            console.log(`[B4b-diag] t=${Date.now()} final=${isFinal} speechFinal=${speechFinal} sinceBargeInMs=${sinceBargeIn} transcript="${transcript}"`);
+          }
+
           // Pre-T0 timing — track when speech was first detected, first/last
           // FINAL chunks, and speech_final flag. Printed as [TimingPre] when
           // processUserMessage runs. These reset at each T0.
@@ -9256,6 +9268,7 @@ wss.on('connection', (twilioWs) => {
           // Send Twilio "clear" to drain buffered TTS audio immediately.
           if (transcript && (isSpeaking || musicLoop)) {
             console.log('[Barge-in] User speaking — stopping playback');
+            lastBargeInAt = Date.now(); // B4b diagnostic — temporary, see docs/B4B_PHASE2_CHANGE_PLAN_2026-07-18.md §9
             if (isSpeaking && twilioWs.readyState === WebSocket.OPEN && streamSid) {
               twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
             }
```

**Net effect confirmed by direct diff read** (also independently re-confirmed in Phase 4 §1): every surrounding line — the existing `[Deepgram] FINAL:` log, the Pre-T0 timing block, all state-gated returns (recording/Q&A/privacy-mute/stop-word), `trivialRe`, `buildDeepgramUrl`, and the barge-in handler's playback-stopping logic — is byte-identical before and after. This is a pure, three-point addition.

---

## Tests executed

**No automated test added — stated explicitly as a Rule 15a exception, not a silent gap.** Per `CLAUDE.md` Rule 15a's exception path: this change is genuinely not meaningfully testable by the auto-tester. It adds `console.log` output observable only on a live phone call with real Deepgram audio timing; there is no mock or unit-level assertion that would exercise the actual condition being diagnosed (STT behavior during real acoustic barge-in). The directly-approved precedent for this exact situation (`fb63a29`, F19 Track B-1e's diagnostic logging, same file, same "diagnostic only" category) also shipped with no accompanying test. `node --check src/index.js` was run and passed (syntax verification only, not a behavioral test) — see `docs/B4B_PHASE4_IMPLEMENTATION_VERIFICATION_2026-07-18.md` §3.

**Rule 15a exception recorded, approval bundled into this Phase 5's own review** — per Rule 15a's requirement to get explicit approval before moving on rather than silently skip the test, this is recorded as a formal exception (diagnostic-only, unit-untestable, matching the `fb63a29` precedent) rather than left as an open conversational question: approving this Phase 5 Evidence Package constitutes approval of the Rule 15a exception recorded here.

No mobile-side `npm run test:auto` suite applies — this change is entirely within `naavi-voice-server`, a separate repository with no dependency on the mobile Edge Functions test catalogue.

---

## Manual tests required (not yet performed)

This is where B4b's actual evidence-gathering happens — not a pass/fail test of a fix, but the live data collection this instrumentation exists to enable. Per `docs/B4B_PHASE2_CHANGE_PLAN_2026-07-18.md` §9's removal criteria (at least 3 independent live reproductions before the logging comes back out):

1. **Confirm deployment landed.** Place any call to the production voice line and confirm Railway's live logs show `[B4b-diag]` lines at all (proves the deploy succeeded — the one fact Phase 4 §4 could not verify from this environment). **This step confirms deployment of this diagnostic version only — it does not validate or rule in/out any of Phase 1 §10's three root-cause hypotheses.** Deployment verification and hypothesis validation are separate facts; only step 3 below speaks to the latter.
2. **Reproduce the barge-in condition** per the existing test recipe (`project_naavi_deepgram_first_word_truncation` memory, and Phase 1 §2's reproduction shapes): speak an alert-creation phrase ("Text Bob when I arrive at home") during Naavi's TTS playback, at least 3 separate attempts across separate calls, per the Non-Determinism Rule discipline applied in `docs/B4B_PHASE2_CHANGE_PLAN_2026-07-18.md` §9.
3. **For each attempt, whether or not the FINAL transcript is truncated,** pull the `[B4b-diag]` lines for that turn from Railway logs and check:
   - Did any interim result (`final=false`) contain the full phrase, including "Text"/"Bob", before a later result dropped it? → evidence for Phase 1 §10's hypothesis 3 (our own aggregation gap).
   - Did no result, interim or final, ever contain the dropped words? → evidence for hypothesis 1 (audio-path) or hypothesis 2 (Deepgram VAD/endpointing) — the `sinceBargeInMs` field and the raw sequence of `final=false`→`final=true` transitions help distinguish which.
4. **Document the traces** — save the raw `[B4b-diag]` log sequences for each of the (at least 3) reproduction attempts, not just a summary, so a future Phase 1 revision can cite them directly (matching this project's own evidentiary standard throughout B4b's phases so far).

---

## Nearby improvement identified, not made

None identified during implementation. The change was small enough (13 lines, three insertion points, all specified exactly in Phase 3) that no adjacent opportunity presented itself, and none was pursued regardless — Phase 4 §1 confirms no code outside the authorized boundary was touched.

---

## Rollback instructions

`git revert f56f9da` on `naavi-voice-server` `main`, then push — restores the file to its pre-diagnostic state exactly (the commit is a clean, isolated 13-line addition with no other changes to conflict with a revert). No migration, no schema change, no data cleanup needed — this change writes nothing to any database; it only adds console output. If Railway has already deployed `f56f9da`, pushing the revert commit triggers a redeploy of the reverted code via the same auto-deploy path.

---

## Known risks

- **Deployment not independently verified** (Phase 4 §4) — carried forward here rather than re-litigated; first confirmation happens at manual test step 1 above.
- **No voice staging environment** (`docs/B4B_PHASE2_CHANGE_PLAN_2026-07-18.md` §7) — this diagnostic, like any voice-server change today, went straight to the production line serving real callers. Mitigated by the change being additive-only and matching an already-deployed, incident-free precedent (`fb63a29`).
- **No automated test coverage** (see "Tests executed" above) — accepted as a stated Rule 15a exception given the change's nature, not silently skipped; explicitly flagged for Wael's confirmation.
- **The diagnostic may sit idle for a while before producing 3 reproductions**, since the underlying bug (Phase 1 §2) does not reproduce on every barge-in attempt — a timeline/process consideration, not a system risk. No action needed beyond continued live testing.
- **Behavioral risk to existing calls: assessed as negligible.** `console.log` is synchronous and non-blocking within Node's event loop for this use (matches the existing, already-heavy logging already present throughout this same handler); Phase 4 §1 directly confirmed no surrounding control-flow, return value, or state used elsewhere was touched.

**No architectural risk introduced.** This change adds no new table, no new Edge Function, no new duplication, no change to any capability's ownership or Shared Core/Voice-only classification (Phase 1A §2-4) — it is instrumentation inside the single existing Voice-only implementation, nothing more.

---

## Phase 5 review record (2026-07-18)

External reviewer (ChatGPT) verdict: **Approved with one minor documentation refinement.** Full assessment: the document's consistent framing as evidence for diagnostic instrumentation rather than for a fix rated the strongest aspect and set correct reviewer expectations throughout; the honest Summary (what was added, why, what it cannot yet prove), the Git diff's explicit "byte-identical surrounding logic" conclusion, the transparent testing-rationale treatment, the Manual Tests section's evidence-collection-procedure framing (rated the strongest section), rollback, and the risk section's operational/process/engineering distinction were all rated strong. No blocking gaps identified.

One required change, adopted: the Rule 15a note was reworded from an open question addressed to Wael to a governance record — the evidence package should record facts and decisions, not pending conversational questions. **Addressed:** "Tests executed" now states the exception is recorded and that approving this Phase 5 Evidence Package constitutes approval of it, rather than posing it as a separate open question.

Three optional minor refinements, adopted:
1. **Manual Test 1** — added a sentence distinguishing deployment verification (this step) from root-cause hypothesis validation (step 3), so a successful `[B4b-diag]` appearance isn't misread as validating anything about the bug's mechanism.
2. **Known risks** — added a concluding sentence: "No architectural risk introduced," completing the risk assessment explicitly rather than leaving it implied.
3. **Status** — added an explicit snapshot sentence distinguishing "implementation evidence complete" from "technical review pending."

Reviewer's stated governance observation: this document demonstrates a distinction worth generalizing — Phase 5 evidence packages now come in two kinds, *implementation evidence* (proving a fix behaves correctly) and *diagnostic evidence* (proving instrumentation is correctly installed and capable of collecting future evidence) — B4b falls squarely in the second category and stays consistent with that throughout.

**This is the reviewer's assessment of the evidence package's quality — it is not, by itself, authorization to begin Phase 6.** Per the Phase-Gate Approval Rule, that requires Wael's own separate, explicit go-ahead. Given 2026-07-18 ("As i mentioned #1 yes confirm").

---

## Status

**Phase 5 drafted and reviewed 2026-07-18, Approved, required Rule 15a rewording and three minor refinements all adopted. Phase 5 implementation evidence complete; technical review pending.** Phase 6 (Technical Review After Coding) has NOT started and will not start until Wael gives explicit, separate approval for that specific transition.
