# B10m — Phase 5b: Evidence Package

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 5. Implementation completed exactly within the Implementation Boundaries confirmed in `docs/B10M_PHASE3B_TECHNICAL_REVIEW_2026-07-19.md` §2, verified fresh in `docs/B10M_PHASE4B_IMPLEMENTATION_VERIFICATION_2026-07-19.md`.

**This is an evidence package for a real behavior fix, not diagnostic instrumentation** — unlike B10m's earlier Phase 5, this change is expected to alter what happens on a live call (a hang-shaped call should now trigger an actual reconnect attempt, which never happened before tonight). It does not claim to fix or explain the underlying intermittent Deepgram STT failure (`docs/B10M_PHASE1_PROBLEM_DEFINITION_2026-07-19.md` §4 — root cause remains unproven). It mitigates a separately-proven, independent defect: the watchdog's own broken disarm condition.

---

## Summary

Changed the disarm condition in `naavi-voice-server/src/index.js` so the reconnect watchdog only clears on a Results message carrying a **non-empty** transcript, instead of any Results message regardless of content. Live instrumentation earlier tonight proved the old condition disarmed identically whether a call went on to hang or succeed, providing no real protection. With this fix, a call where Deepgram never produces real content keeps the watchdog armed, so the pre-existing 6-second timeout / 30-frame minimum / 2-attempt reconnect cap (all unchanged) can fire as originally designed.

**Committed and pushed** (`90a5072`, `naavi-voice-server` `main`, 2026-07-19 03:40:27 EDT, confirmed on `origin/main`). **Deployment to production Railway not independently verified from this environment** — no Railway CLI/API access available here; confirmation is deferred to the first live test call (§"Manual tests required" below).

---

## Files changed

| File | Repo | Change |
|---|---|---|
| `src/index.js` | `naavi-voice-server` | Disarm condition re-guarded on non-empty transcript; comment expanded to explain why; dead `EMPTY`-ternary branch removed from the existing diagnostic log line. No other line touched. |

No other file in either repository touched. No schema change, no new Edge Function, no dependency change, no config/env-var change.

---

## Git diff

```diff
@@ -8957,14 +8957,21 @@ wss.on('connection', (twilioWs) => {
       try {
         const msg = JSON.parse(data.toString());
 
-        // Only clear the watchdog on a Results message — Deepgram sends a
-        // metadata/open message immediately on connect, which would falsely
-        // clear the watchdog before the hang is detected.
+        // Only clear the watchdog on a Results message with a real, non-empty
+        // transcript — Deepgram sends a metadata/open message immediately on
+        // connect (would falsely clear it before the hang is detected), and
+        // also sends empty-transcript Results messages routinely during normal
+        // streaming. B10m (2026-07-19): live instrumentation proved the old
+        // disarm-on-any-Results condition fires identically whether the call
+        // goes on to hang or succeed — it provided no real protection. See
+        // docs/B10M_PHASE1_PROBLEM_DEFINITION_2026-07-19.md Section 4.
         if (msg.type === 'Results' && deepgramFirstMessageAt === null) {
-          deepgramFirstMessageAt = Date.now();
           const disarmTranscript = msg.channel?.alternatives?.[0]?.transcript ?? '';
-          console.log(`[B10m-diag] Watchdog disarmed at +${deepgramFirstMessageAt - (callStartAt || deepgramFirstMessageAt)}ms since call-start, transcript=${disarmTranscript ? `"${disarmTranscript}"` : 'EMPTY'}`);
-          if (deepgramWatchdog) { clearTimeout(deepgramWatchdog); deepgramWatchdog = null; }
+          if (disarmTranscript) {
+            deepgramFirstMessageAt = Date.now();
+            console.log(`[B10m-diag] Watchdog disarmed at +${deepgramFirstMessageAt - (callStartAt || deepgramFirstMessageAt)}ms since call-start, transcript="${disarmTranscript}"`);
+            if (deepgramWatchdog) { clearTimeout(deepgramWatchdog); deepgramWatchdog = null; }
+          }
         }
 
         if (msg.type === 'Results') {
```

**Net effect confirmed by direct diff read** (also independently confirmed in Phase 4b §1, including the explicit control-flow/state/interface/timing checklist): the watchdog's arm/timeout logic, the reconnect cap, the per-Results-message raw trace log, the Pre-T0 timing block, all state-gated returns, and `connectDeepgram()`'s two call sites are all byte-identical before and after. This is a single, isolated re-guard of one condition.

---

## Tests executed

**No automated test added — a Rule 15a exception, recorded here rather than left as a silent gap.** Same situation as B10m's diagnostic cycle: this repository has no automated test harness, and the actual behavior being changed (real-time Deepgram reconnect timing under live call conditions) is not meaningfully unit-testable — there is no mock that exercises genuine Deepgram STT failure/recovery timing. `node --check src/index.js` was run and passed (syntax verification only — Phase 4b §2).

**Unlike the diagnostic cycle, this change has real behavioral stakes** (Phase 2b §4 — Medium risk, false-positive reconnect risk on legitimate slow-starting calls), which raises the bar on what "verified" needs to mean here: syntax-only verification is necessary but not sufficient. The manual tests below are not optional evidence-gathering (as in the diagnostic cycle) — they are the actual verification this change needs before it can be considered confirmed safe.

**Approving this Phase 5 Evidence Package constitutes approval of the Rule 15a exception**, per the same convention established in B10m's earlier Phase 5.

---

## Manual tests required (not yet performed)

Two distinct things need confirming, not one:

1. **Deployment landed.** Place any call and confirm `[B10m-diag] Watchdog disarmed...` lines still appear in Railway's live logs (proves the deploy succeeded).
2. **The fix behaves as designed, in both directions:**
   - **On a hang-shaped call** (if one occurs): confirm the watchdog now actually fires — look for `[Deepgram] Watchdog: no transcript after 6s with N frames — reconnecting (attempt 1)`, a log line that has never once appeared in any reproduction studied tonight (Phase 1 §2, calls #1-5, #8-9, #12). Its appearance for the first time would itself be direct evidence the fix is working as intended.
   - **On a normal call:** confirm `[B10m-diag] Watchdog disarmed...` still fires promptly (within 1-3 seconds, matching every observed success tonight) and does **not** produce a spurious reconnect on a call where the caller simply hasn't started speaking yet. This directly tests Phase 2b §4's named false-positive risk.
3. **If a reconnect does fire mid-call:** listen for any audible gap, dropped audio, or disruption to the caller's own in-progress speech. This is the one risk category (Phase 2b §4, "reconnect side effects unverified") that has genuinely never been observed before — the reconnect path exists in code but has never once executed in production until this fix could allow it to.

Given tonight's confirmed intermittent, probabilistic failure rate, a single test call proves less here than it would for a deterministic bug (per Phase 1 §1's own stated caution) — several calls, across time, are the only way to build confidence this actually helps.

---

## Nearby improvement identified, not made

None identified during implementation. The change was small and precisely scoped by Phase 3b (one guard condition, one comment, one dead-branch removal) — no adjacent opportunity presented itself, and none was pursued regardless.

---

## Rollback instructions

`git revert 90a5072` on `naavi-voice-server` `main`, then push — restores the prior (proven-broken but previously-shipped) disarm condition exactly. No migration, no schema change, no data cleanup needed — this change writes nothing to any database. If a reconnect side effect is observed to actively harm call quality (§"Manual tests required," item 3), this is the fastest path back to the pre-fix state, at the cost of reintroducing the original unprotected-hang behavior.

---

## Known risks

- **False-positive reconnects on legitimate slow-starting calls** (Phase 2b §4) — mitigated but not eliminated by the observation that every real success tonight got content within 1-2.5 seconds, well under the 6-second threshold; only 3 data points support this.
- **Reconnect side effects on a live call are genuinely unverified** — the reconnect code path has never executed in production before this fix. Whether it causes an audible gap or drops in-flight speech is unknown until observed live (§"Manual tests required," item 3).
- **No automated test coverage** — accepted as a stated Rule 15a exception (§"Tests executed" above).
- **This does not fix or explain the underlying bug** — stated repeatedly, not just once: if Deepgram's STT genuinely never processes real audio for a call (as opposed to merely being slow to emit a first Results message), a reconnect may not help at all, and the caller could still experience a hang, just with one or two audible reconnect attempts in the middle of it rather than total silence. This is a plausible improvement, not a guaranteed fix.

**No architectural risk introduced.** This change adds no new table, no new Edge Function, no new duplication, no change to any capability's ownership or Voice-only classification — it is a one-condition fix inside the single existing Voice-only implementation.

---

## Status

**Phase 5b drafted 2026-07-19. Not yet reviewed by the external reviewer.** Implementation is committed and pushed; deployment is not independently confirmed. Unlike the diagnostic cycle, this Evidence Package's manual tests are load-bearing, not optional — Phase 6 review can proceed on the code itself, but confidence that this actually helps (rather than merely being correctly implemented) depends on live observation over multiple calls.
