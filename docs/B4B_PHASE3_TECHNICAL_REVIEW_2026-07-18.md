# B4b — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 3. Subject: `docs/B4B_PHASE2_CHANGE_PLAN_2026-07-18.md`, Approved (that document's §11), one optional enhancement (operational impact) adopted. This document does not repeat that review — it resolves the remaining implementation-level specifics Phase 2 left at "planning-level detail, not code" (its own §3 wording), then formalizes the two elements governance requires specifically of Phase 3: an explicit Implementation Boundaries statement (§2) and a record of deferred architectural ideas (§3).

Required because the plan touches Protected Core (`naavi-voice-server/src/index.js`, Voice orchestration) regardless of its Low risk classification, per this project's own established rule that Protected Core always receives full review.

Started 2026-07-18 on Wael's explicit go-ahead ("go Phase 3"). No code was written in producing this document.

---

## 1. Implementation strategy: exact log format and insertion points

Phase 2 §3 described two additions in planning-level terms. This section makes them concrete enough for Phase 4 to implement without further interpretation.

### 1a. Barge-in timestamp marker

**New closure-scoped variable**, declared alongside existing per-connection state (near `let pendingText = '';`, `naavi-voice-server/src/index.js:8324`):
```js
let lastBargeInAt = null; // B4b diagnostic (temporary, see docs/B4B_PHASE2_CHANGE_PLAN_2026-07-18.md §9 for removal criteria)
```

**Set at the existing barge-in handler** (`naavi-voice-server/src/index.js:9255-9264`), immediately after the existing `console.log('[Barge-in] User speaking — stopping playback')` line (9258):
```js
lastBargeInAt = Date.now();
```
No other line in this handler changes. This mirrors the `fb63a29` precedent's `turnHadBargeIn = true;` insertion at the same handler, substituting a timestamp for a boolean because B4b's diagnostic needs to measure elapsed time (Phase 2 §3), not just turn-level occurrence.

### 1b. Per-Results-message diagnostic log (interim and final)

**Inserted immediately after `speechFinal` is computed** (`naavi-voice-server/src/index.js:8971`, right after `const speechFinal = msg.speech_final === true;`), as a new, self-contained block — not modifying the existing Pre-T0 timing block that follows it (lines 8973-8983), so that block's own logic is untouched:
```js
if (transcript) {
  const sinceBargeIn = lastBargeInAt ? (Date.now() - lastBargeInAt) : null;
  console.log(`[B4b-diag] t=${Date.now()} final=${isFinal} speechFinal=${speechFinal} sinceBargeInMs=${sinceBargeIn} transcript="${transcript}"`);
}
```

**Design decisions, stated explicitly:**
- **Guarded on `if (transcript)`** (non-empty), matching the existing code's own convention at line 8976 — avoids logging Deepgram's empty-transcript keepalive-style messages.
- **Placed before every existing state-gated `return`** (recording mode line 8993, Q&A mode line 9023, privacy-mute line 9309, stop-word line 9433) so this diagnostic captures every Results message unconditionally, regardless of call state — Phase 2's evidentiary goal requires seeing interim results that the current code never logs at all today (only the final aggregated transcript is logged, at line 9461, and only when none of those gates intercept it first).
- **No expiry/reset logic on `lastBargeInAt`** — the raw elapsed-ms value is logged every time, even when large or clearly unrelated to a recent barge-in. Filtering "was this within the ~2500ms `utterance_end_ms` window" happens at analysis time, not in code — keeps the diagnostic itself simpler, with fewer moving parts to get wrong.
- **No change to the existing `[Deepgram] FINAL:` log line** (9461) — it continues to fire exactly as it does today, for the same subset of messages. The new `[B4b-diag]` line is additive and distinctly tagged so it can be greped independently.

**Expected lifecycle (added per reviewer feedback — see §4):** this instrumentation is temporary operational diagnostic logging, not a permanent enhancement — it is expected to exist only until `docs/B4B_PHASE2_CHANGE_PLAN_2026-07-18.md` §9's removal criteria are satisfied (at least 3 live reproductions captured, a verdict reached among Phase 1 §10's three hypotheses, and any resulting fix scoped or explicitly deferred), at which point the `[B4b-diag]` line and the `lastBargeInAt` variable are removed in their own follow-on change.

---

## 2. Implementation Boundaries Confirmed

- **Authorized file, exactly one:** `naavi-voice-server/src/index.js` —
  - New variable declaration near line 8324 (§1a).
  - One new line inside the barge-in handler, immediately after line 9258 (§1a).
  - One new `if (transcript) { ... }` block immediately after line 8971 (§1b).
- **No additional files are approved.** Not any mobile file (confirmed voice-only, Phase 1A §2-3). Not any Supabase Edge Function (confirmed Shared Core untouched, Phase 2 §5). Not a new file — no `_shared/` module, no config file, no `.env`/Railway variable.
- **No opportunistic refactoring is approved.** The existing `[Deepgram] FINAL:` log (9461), the Pre-T0 timing block (8973-8983), the recording/Q&A/privacy-mute/stop-word gates, and the barge-in handler's existing `twilioWs.send`/`stopMusic()` logic are all untouched — the two additions are purely additive at the exact positions specified in §1.
- **No architectural changes are approved beyond §1.** No change to `trivialRe`, no change to Deepgram connection config (`buildDeepgramUrl`, lines 8274-8309), no audio buffering/pre-roll mechanism (Phase 1 §6 candidate #2 remains unevaluated and unimplemented), no retry logic (Phase 1 §6 candidate #4 remains unevaluated and unimplemented). This document authorizes evidence-gathering only, per Phase 2's own framing.
- **Explicitly excluded from this authorization** — each would need its own Phase 1/2/3, not implied by this approval:
  - Any actual fix to the leading-word-drop mechanism itself — root cause remains unproven (Phase 1 §5) and this document does not change that; a fix cannot be authorized until it is.
  - Removing the `[B4b-diag]` logging — governed by Phase 2 §9's removal criteria, not by this document, and not yet due.
  - Any change to the Action Rules write path or Alert Engine — confirmed not defective and out of scope (Phase 1 §7).

---

## 3. Deferred Architectural Decisions

**Idea:** temporary diagnostic logging on this file has now been added and later removed at least twice (`fb63a29`'s `[F19-1e-diag]`, and this document's `[B4b-diag]`), each time as a one-off hand-written addition with its own tag, its own removal criteria buried in a Phase 2 document, and no shared mechanism (e.g., an env-var-gated verbosity level, or a single documented pattern for "temporary investigation logging") to make adding/removing this class of instrumentation more consistent or harder to forget to remove.

**Not approved for this implementation.** Broader scope than this specific evidence-gathering need requires, and premature to design a general-purpose mechanism from two data points. Matches this project's own stated bar for introducing new abstractions (`CLAUDE.md` Rule 19 — "new abstractions must justify their existence... if the justification is 'cleaner code' without a concrete problem it solves, the abstraction is not justified") — the concrete problem (temporary logging outliving its purpose) is already addressed per-instance by each Phase 2's explicit removal criteria; a shared mechanism is a convenience, not a fix for a demonstrated failure to remove logging on time.

**What would make it worth reconsidering:** a third instance of temporary diagnostic logging being added to this file without a shared mechanism, or a first instance of temporary logging actually being forgotten and left in past its removal criteria (which has not happened yet — `[F19-1e-diag]` was confirmed removed, Phase 1 §5e).

---

## 4. Phase 3 review record (2026-07-18)

External reviewer (ChatGPT) verdict: **Approved.** Full assessment: phase separation (Phase 2 decides what, Phase 3 decides exactly how, without redesigning or reopening Phase 2) rated disciplined; elimination of implementation ambiguity (insertion locations, variable scope, log format, ordering, placement relative to existing logic) rated the biggest improvement, turning Phase 4 into implementation rather than interpretation; the additive-only philosophy, the Implementation Boundaries section's explicit "what's not implied by this approval" list, and the Deferred Architectural Decisions section's restraint (Rule 19) were all rated strong. No blocking gaps identified.

One optional recommendation, adopted: make the temporary nature of this instrumentation explicit within the implementation document itself, not just by reference to Phase 2's removal criteria. **Addressed:** new "Expected lifecycle" paragraph added to §1b above.

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to proceed to Phase 4.** Per the Phase-Gate Approval Rule, that requires Wael's own separate, explicit go-ahead. Given 2026-07-18 ("#1 confirm, then Phase 4").

---

## 5. Outcome

**Implementation is authorized only within the boundaries defined in §2, using the exact log format decided in §1 (including the expected-lifecycle note), reviewed and approved 2026-07-18, one optional enhancement adopted. Phase 4 authorized to start by Wael, 2026-07-18.**
