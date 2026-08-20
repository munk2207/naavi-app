# B10m — Phase 5: Evidence Package

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 5. Implementation completed exactly within the Implementation Boundaries confirmed in `docs/B10M_PHASE3_TECHNICAL_REVIEW_2026-07-19.md` §2, verified fresh in `docs/B10M_PHASE4_IMPLEMENTATION_VERIFICATION_2026-07-19.md` (Approved).

**This is an evidence package for diagnostic instrumentation, not for a fix** — consistent with Phase 2/3's framing throughout. There is no "does the hang still happen" test to run, because no fix was implemented. The evidence here proves the *instrumentation* is correctly built; the actual payoff (evidence toward B10m's root cause) only starts accumulating once a live reproduction occurs with this logging deployed.

---

## Summary

Added temporary diagnostic logging to `naavi-voice-server/src/index.js` to capture the two evidence gaps Phase 1 §8 identified: (1) a log line at the watchdog's disarm point, recording the transcript content (or `EMPTY`) of the Results message that triggered it, and (2) an unfiltered raw trace of every Results message (interim and final, including empty-transcript ones) with timing and flags, tagged `[B10m-diag]`.

No behavior change. No fix. Purely additive — one new local `const` and two new `console.log` lines, at the exact positions `docs/B10M_PHASE3_TECHNICAL_REVIEW_2026-07-19.md` §1 authorized.

**Committed and pushed** (`49f56f3`, `naavi-voice-server` `main`, 2026-07-19 02:39:51 EDT, confirmed on `origin/main` via `git merge-base --is-ancestor`). **Deployment to production Railway not independently verified from this environment** — no Railway CLI/API access available here; confirmation is deferred to the first live test call (§"Manual tests required" below), same limitation B4b's Phase 4 §4 recorded for the identical situation.

---

## Files changed

| File | Repo | Change |
|---|---|---|
| `src/index.js` | `naavi-voice-server` | 2 additive insertions (3 lines total): one new log line inside the existing watchdog disarm block, and one new log line immediately after `speechFinal` is computed in the Results handler. No other line touched. |

No other file in either repository touched. No schema change, no new Edge Function, no dependency change, no config/env-var change.

---

## Git diff

```diff
@@ -8962,6 +8962,8 @@ wss.on('connection', (twilioWs) => {
         // clear the watchdog before the hang is detected.
         if (msg.type === 'Results' && deepgramFirstMessageAt === null) {
           deepgramFirstMessageAt = Date.now();
+          const disarmTranscript = msg.channel?.alternatives?.[0]?.transcript ?? '';
+          console.log(`[B10m-diag] Watchdog disarmed at +${deepgramFirstMessageAt - (callStartAt || deepgramFirstMessageAt)}ms since call-start, transcript=${disarmTranscript ? `"${disarmTranscript}"` : 'EMPTY'}`);
           if (deepgramWatchdog) { clearTimeout(deepgramWatchdog); deepgramWatchdog = null; }
         }
 
@@ -8969,6 +8971,7 @@ wss.on('connection', (twilioWs) => {
           const transcript = msg.channel?.alternatives?.[0]?.transcript ?? '';
           const isFinal = msg.is_final === true;
           const speechFinal = msg.speech_final === true;
+          console.log(`[B10m-diag] Results msg at +${Date.now() - (callStartAt || Date.now())}ms since call-start, final=${isFinal} speechFinal=${speechFinal} transcript=${transcript ? `"${transcript}"` : 'EMPTY'}`);
 
           // Pre-T0 timing — track when speech was first detected, first/last
           // FINAL chunks, and speech_final flag. Printed as [TimingPre] when
```

**Net effect confirmed by direct diff read** (also independently confirmed in Phase 4 §1, including the explicit control-flow/state/interface/timing checklist): every surrounding line — the disarm block's own logic, the watchdog's arm/timeout logic, the Pre-T0 timing block, all state-gated returns, the existing `[Deepgram] FINAL:` log, and `connectDeepgram()`'s two call sites — is byte-identical before and after. This is a pure, two-point addition.

---

## Verification performed

**No automated test added — a Rule 15a exception, recorded here rather than left as a silent gap.** This section is named "Verification performed" rather than "Tests executed" because, for a diagnostic-only change, the applicable verification is broader than traditional testing — syntax validation, implementation-boundary verification (Phase 4), and this governance exception, together. Per `CLAUDE.md` Rule 15a's exception path: this change is not meaningfully testable by the auto-tester. It adds `console.log` output observable only on a live phone call with real Deepgram connection behavior; there is no mock or unit-level assertion that exercises the actual condition being diagnosed. The directly-approved precedent for this exact situation (`f56f9da`, B4b's diagnostic logging, same file, same category) also shipped with no accompanying test. `node --check src/index.js` was run and passed (syntax verification only — Phase 4 §2).

**Approving this Phase 5 Evidence Package constitutes approval of this Rule 15a exception**, per the same convention B4b's Phase 5 established.

No mobile-side `npm run test:auto` suite applies — this change is entirely within `naavi-voice-server`, a separate repository with no dependency on the mobile Edge Functions test catalogue.

---

## Manual tests required (not yet performed)

This is where B10m's actual evidence-gathering happens — not a pass/fail test of a fix, but the live data collection this instrumentation exists to enable. Per `docs/B10M_PHASE2_CHANGE_PLAN_2026-07-19.md` §9's removal criteria (at least 3 reproduction attempts before evaluating, or evaluating a defined non-reproduction count):

1. **Commit, push, and confirm deployment landed.** This is the still-pending action (§"Summary" above) — place any call to the production voice line afterward and confirm Railway's live logs show `[B10m-diag]` lines at all. This step confirms deployment only — it does not by itself validate or rule out Phase 1 §4's watchdog-disarm hypothesis.
2. **Reproduce the silent-hang condition** per Phase 1 §2's reproduction shape: place a call, wait for the greeting, then attempt to speak — across at least 3 separate calls, per the same trial-count discipline Phase 2 §9 borrowed from the Non-Determinism Rule's nearest analogous precedent.
3. **For each attempt, whether or not it hangs,** pull the `[B10m-diag]` lines for that call from Railway logs and check:
   - Does a `Watchdog disarmed` line appear at all? If yes, with `transcript=EMPTY` or `transcript="..."` — directly confirms or refutes whether an empty-transcript Results message is what disarms the watchdog (Phase 1 §4's central hypothesis).
   - Does the raw `Results msg` trace show any Results message at all before the hang begins, or none? If none ever appears, the disarm event itself couldn't have happened the way §4 hypothesizes, and the mechanism must be something else entirely — a finding that would send Phase 1 back for revision rather than confirm it.
4. **Document the traces** — save the raw `[B10m-diag]` log sequences for each reproduction attempt (both hangs and any successful calls in between), not just a summary, so a future Phase 1 revision can cite them directly. **Each captured Railway log must be preserved as raw evidence** (e.g. screenshots or exported text, same as this session's Phase 1 evidence-gathering) — a later document may summarize or quote from it, but the raw capture itself is the evidence of record, not the summary.

---

## Nearby improvement identified, not made

None identified during implementation. The change was small enough (3 lines, two insertion points, both specified exactly in Phase 3) that no adjacent opportunity presented itself, and none was pursued regardless — Phase 4 §1's checklist confirms no code outside the authorized boundary was touched.

---

## Rollback instructions

Once committed: `git revert <commit-hash>` on `naavi-voice-server` `main`, then push — restores the file to its pre-diagnostic state exactly (an isolated 3-line addition with no other changes to conflict with a revert). No migration, no schema change, no data cleanup needed — this change writes nothing to any database; it only adds console output. If Railway has already deployed the commit, pushing the revert triggers a redeploy of the reverted code via the same auto-deploy path.

`git revert 49f56f3` on `naavi-voice-server` `main`, then push — the commit is a clean, isolated 3-line addition with no other changes to conflict with a revert.

---

## Known risks

- **No staging environment for this repo** — this diagnostic, like any voice-server change, will go straight to the production line serving real callers once committed and pushed. Mitigated by the change being additive-only and matching an already-deployed, incident-free precedent (`f56f9da`, B4b's diagnostic).
- **No automated test coverage** — accepted as a stated Rule 15a exception given the change's nature, not silently skipped (§"Tests executed" above).
- **Logging volume during active speech** — addition #2 fires on every Results message, including rapid interim results during continuous speech (Phase 2 §4's explicit, deliberate design choice — filtering would defeat the diagnostic's purpose). Bounded by call duration; temporary; defined removal criteria exist (Phase 2 §9).
- **The diagnostic may sit idle for a while before producing 3 reproductions**, since — per B10m's own evidence — the hang is not 100% reproducible on every call attempt (5/5 tonight, but the historical baseline was intermittent). A timeline consideration, not a system risk.
- **Behavioral risk to existing calls: assessed as negligible.** `console.log` is synchronous and non-blocking within Node's event loop for this use, matching the volume of logging already present throughout this same handler; Phase 4 §1's explicit checklist confirmed no surrounding control-flow, return value, or state used elsewhere was touched.

**No architectural risk introduced.** This change adds no new table, no new Edge Function, no new duplication, no change to any capability's ownership or Voice-only classification (Phase 1A §2-4) — it is instrumentation inside the single existing Voice-only implementation, nothing more.

---

## Phase 5 review record (2026-07-19)

External reviewer (ChatGPT) verdict: **Approved.** Full governance-compliance checklist (evidence matches implementation, no unsupported claims, diff documented, Rule 15a exception recorded, manual validation defined, rollback documented, risks documented, deployment state accurately recorded, phase-gate respected) — all items passed. Two editorial observations incorporated into this revision: "Tests executed" renamed to "Verification performed," reflecting that this diagnostic-only change's applicable verification is broader than traditional automated testing; the manual-tests documentation step now explicitly requires preserving each captured Railway log as raw evidence, not only a later summary. A third observation (praising the document's restraint in not forcing Phase 6 to start before a commit exists) required no edit — noted as a reinforcement of existing governance principle, not a requested change.

**This section is the record of the review; it is not, by itself, authorization to proceed.** Per the Phase-Gate Approval Rule: the still-pending commit/push/deployment action requires Wael's own separate, explicit confirmation — not implied by this Phase 5 approval.

## Status

**Phase 5 drafted 2026-07-19, reviewed and Approved same day (see above), two editorial observations incorporated. Committed and pushed 2026-07-19 (`49f56f3`), on Wael's explicit confirmation.** Deployment to Railway not independently verified from this environment (see Summary). Phase 6 (Technical Review After Coding) can now meaningfully begin — a committed Git Diff exists — but has not started and will not start until Wael gives explicit, separate approval for that specific transition.
