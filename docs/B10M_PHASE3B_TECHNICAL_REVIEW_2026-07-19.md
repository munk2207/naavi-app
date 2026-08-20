# B10m — Phase 3b: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 3. Subject: `docs/B10M_PHASE2B_CHANGE_PLAN_2026-07-19.md`. Named "3b" to match "Phase 2b," distinguishing this from the earlier diagnostic-only Phase 3 in the same B10m item.

Required because the plan touches Protected Core (`naavi-voice-server/src/index.js`, Voice orchestration), and because Phase 2b's own risk classification (Medium — a real behavior change, not diagnostic-only) makes review mandatory on both grounds.

Started 2026-07-19 on Wael's explicit go-ahead ("Go to Phase 3"). No code was written in producing this document.

---

## 1. Implementation strategy: exact code

Phase 2b §3 described the fix in planning-level terms. This section makes it concrete enough for Phase 4 to implement without further interpretation. Current line numbers re-verified directly against `naavi-voice-server/src/index.js` at the start of this phase.

**Replaces the existing disarm block** (`naavi-voice-server/src/index.js:8960-8968`):

Current code:
```js
// Only clear the watchdog on a Results message — Deepgram sends a
// metadata/open message immediately on connect, which would falsely
// clear the watchdog before the hang is detected.
if (msg.type === 'Results' && deepgramFirstMessageAt === null) {
  deepgramFirstMessageAt = Date.now();
  const disarmTranscript = msg.channel?.alternatives?.[0]?.transcript ?? '';
  console.log(`[B10m-diag] Watchdog disarmed at +${deepgramFirstMessageAt - (callStartAt || deepgramFirstMessageAt)}ms since call-start, transcript=${disarmTranscript ? `"${disarmTranscript}"` : 'EMPTY'}`);
  if (deepgramWatchdog) { clearTimeout(deepgramWatchdog); deepgramWatchdog = null; }
}
```

Replacement code:
```js
// Only clear the watchdog on a Results message with a real, non-empty
// transcript — Deepgram sends a metadata/open message immediately on
// connect (would falsely clear it before the hang is detected), and
// also sends empty-transcript Results messages routinely during normal
// streaming. B10m (2026-07-19): live instrumentation proved the old
// disarm-on-any-Results condition fires identically whether the call
// goes on to hang or succeed — it provided no real protection. See
// docs/B10M_PHASE1_PROBLEM_DEFINITION_2026-07-19.md Section 4.
if (msg.type === 'Results' && deepgramFirstMessageAt === null) {
  const disarmTranscript = msg.channel?.alternatives?.[0]?.transcript ?? '';
  if (disarmTranscript) {
    deepgramFirstMessageAt = Date.now();
    console.log(`[B10m-diag] Watchdog disarmed at +${deepgramFirstMessageAt - (callStartAt || deepgramFirstMessageAt)}ms since call-start, transcript="${disarmTranscript}"`);
    if (deepgramWatchdog) { clearTimeout(deepgramWatchdog); deepgramWatchdog = null; }
  }
}
```

**Design decisions, stated explicitly:**
- **The only semantic change: `deepgramFirstMessageAt` is now set only when a Results message carries a non-empty transcript.** Every other line in this block is functionally identical (assignment, log, `clearTimeout`) — just moved inside the new `if (disarmTranscript)` guard.
- **The `[B10m-diag]` log line's ternary is simplified** — since this branch can now only ever execute with a non-empty `disarmTranscript`, the `EMPTY` fallback is dead code and is removed rather than left unreachable.
- **The comment is expanded, not just the code** — per this project's own convention (comments explain non-obvious WHY), the new empty-transcript exclusion is exactly the kind of non-obvious reasoning worth documenting in place, with a pointer to Phase 1's evidence rather than restating it.
- **No other line in `naavi-voice-server/src/index.js` changes.** The watchdog's arm/timeout logic (lines 8939-8953), the reconnect cap (`deepgramReconnectCount >= 2`), the per-Results-message raw trace log (immediately following this block, unchanged), and every other part of the file are untouched.
- **Downstream composition confirmed, not assumed:** `connectDeepgram()` resets `deepgramFirstMessageAt = null` on every call including reconnects (line 8919, unchanged), and re-arms the watchdog fresh in the `'open'` handler (unchanged) — so after a reconnect triggered by this fix, the watchdog correctly requires a fresh non-empty transcript again before disarming. No additional change is needed to make the reconnect path compose correctly with this fix.

---

## 2. Implementation Boundaries Confirmed

- **Authorized file, exactly one:** `naavi-voice-server/src/index.js` — the disarm block at lines 8960-8968 only, replaced exactly as shown in §1.
- **No additional files are approved.** Not any mobile file (confirmed voice-only, original Phase 1A). Not any Supabase Edge Function (confirmed Shared Core untouched). Not a new file.
- **No opportunistic refactoring is approved.** The watchdog's arm/timeout logic, the reconnect cap, the per-Results-message trace log, the Pre-T0 timing block, the recording/Q&A/privacy-mute/stop-word gates, and every other part of the file are untouched.
- **No architectural changes are approved beyond §1.** No change to the 6-second threshold, the 30-frame minimum, or the 2-attempt reconnect cap (Phase 2b §9, item 3 — explicitly deferred, no evidence to justify a threshold change).
- **Explicitly excluded from this authorization** — each would need its own Phase 1/2/3, not implied by this approval:
  - A caller-facing fallback message after reconnects are exhausted (Phase 2b §9, item 1).
  - Ongoing watchdog re-arming throughout the whole call, not just at initial connect (Phase 2b §9, item 2).
  - Any change to the still-unproven question of why Deepgram sometimes produces no transcript at all — this fix mitigates a symptom of the proven-broken safety net, not the underlying cause.
  - [[B10n]] and the phantom-content anomaly (Phase 1 §6) — unrelated code paths, not part of this authorization.

## 3. Deferred architectural ideas

No new ideas raised during this phase beyond what Phase 2b §9 already recorded and this document's §2 already carries forward by reference. Nothing new to add.

## 4. Non-Determinism Rule applicability

Not applicable — deterministic reconnect logic, no LLM/classifier prompt involved.

## 5. Risk re-assessment after concrete design

Phase 2b classified this Medium risk at the planning level. Having now seen the exact, minimal diff (one `if` guard added, one dead branch removed, one comment expanded — no new state, no new timer, no new code path), **the risk remains Medium, not downgraded to Low**, because the risk is behavioral (whether reconnects trigger unnecessarily or disrupt legitimate calls), not implementation-complexity-based. A small diff can still carry real production risk; this document does not conflate "the code change is small" with "the risk is small."

---

## 6. Status

**Phase 3b drafted 2026-07-19. Not yet reviewed by the external reviewer. Phase 4 (Implementation) has NOT started and will not start until Wael gives explicit, separate approval for that specific transition.**
