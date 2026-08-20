# B10m — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 3. Subject: `docs/B10M_PHASE2_CHANGE_PLAN_2026-07-19.md`, Approved (that document's §10). This document does not repeat that review — it resolves the remaining implementation-level specifics Phase 2 left at planning-level detail, then formalizes the two elements governance requires specifically of Phase 3: an explicit Implementation Boundaries statement (§2) and a record of deferred architectural ideas (§3).

Required because the plan touches Protected Core (`naavi-voice-server/src/index.js`, Voice orchestration) regardless of its Low risk classification, per Governance §4.

Started 2026-07-19 on Wael's explicit go-ahead ("go Phase 3"). No code was written in producing this document.

---

## 1. Implementation strategy: exact log format and insertion points

Phase 2 §3 described two additions in planning-level terms. This section makes them concrete enough for Phase 4 to implement without further interpretation. Current line numbers re-verified directly against `naavi-voice-server/src/index.js` at the start of this phase (unchanged since Phase 1 — file remains byte-identical to its 2026-07-16 state, per Phase 1 §4d).

### 1a. Watchdog disarm-point log

**Adds one diagnostic statement inside the existing disarm block** (`naavi-voice-server/src/index.js:8963-8966`) — no existing line is changed, removed, or reordered; the block's execution logic is unchanged:
```js
if (msg.type === 'Results' && deepgramFirstMessageAt === null) {
  deepgramFirstMessageAt = Date.now();
  const disarmTranscript = msg.channel?.alternatives?.[0]?.transcript ?? '';
  console.log(`[B10m-diag] Watchdog disarmed at +${deepgramFirstMessageAt - (callStartAt || deepgramFirstMessageAt)}ms since call-start, transcript=${disarmTranscript ? `"${disarmTranscript}"` : 'EMPTY'}`);
  if (deepgramWatchdog) { clearTimeout(deepgramWatchdog); deepgramWatchdog = null; }
}
```
**Design decisions, stated explicitly:**
- Reuses the existing `callStartAt` variable (declared line 8449, set line 12581) for the "ms since call-start" convention already used by every other timing log in this file (`[FrameIn]`, `[FrameCounter]`) — no new timestamp variable introduced.
- Reads `msg.channel?.alternatives?.[0]?.transcript` directly at this point (the same expression used later at line 8969) rather than waiting for the existing extraction at line 8969, because this block executes first and the disarm event itself — not the subsequent full Results handling — is what Phase 1 §8's evidence gap #1 is about.
- `EMPTY` marker (not blank string) makes the log line greppable and unambiguous — matches Phase 2 §3's stated design.

### 1b. Per-Results-message raw trace (interim and final, unfiltered)

**Inserted immediately after `speechFinal` is computed** (`naavi-voice-server/src/index.js:8971`, right after `const speechFinal = msg.speech_final === true;`), as a new, self-contained line — not modifying the existing Pre-T0 timing block that follows it (lines 8973-8983):
```js
console.log(`[B10m-diag] Results msg at +${Date.now() - (callStartAt || Date.now())}ms since call-start, final=${isFinal} speechFinal=${speechFinal} transcript=${transcript ? `"${transcript}"` : 'EMPTY'}`);
```
**Design decisions, stated explicitly:**
- **Deliberately unguarded** — unlike B4b's diagnostic at this same insertion point (`if (transcript) { ... }`, `docs/B4B_PHASE3_TECHNICAL_REVIEW_2026-07-18.md` §1b), this logs every Results message including empty-transcript ones. Per Phase 2 §4, an empty-transcript message is exactly the evidence being sought here — filtering it out would defeat the diagnostic's purpose.
- **Placed before every existing state-gated `return`** (recording mode line 8993, Q&A mode line 9023, privacy-mute line 9309, stop-word line 9433) — captures every Results message unconditionally regardless of call state, same placement logic as B4b's diagnostic.
- **No change to the existing `[Deepgram] FINAL:` log line** (line 9461, confirmed unchanged) — continues to fire exactly as today. The new `[B10m-diag]` line is additive and distinctly tagged.
- **The `[B10m-diag]` tag string is part of this diagnostic's implementation contract**, not an arbitrary label — Phase 5's evidence collection and any future analysis will grep for this exact tag. Changing it in a later revision without updating this document would silently break log searches and evidence correlation; any such change must be reflected here.
- **Coexists cleanly with B4b's diagnostic tag if that is ever redeployed** — different tag (`[B10m-diag]` vs `[B4b-diag]`), and B4b's diagnostic is not currently deployed (reverted, per Phase 1 §5, commit `43e0ae7`), so there is no present conflict. If B4b's diagnostic is redeployed in the future, both could coexist at the same insertion point (8971) without interfering — each is an independent, self-contained `console.log` call.

**Expected lifecycle:** temporary operational diagnostic logging, per Phase 2 §9's removal criteria (at least 3 live reproductions captured, or a defined attempt count passes without reproduction) and §9's addition (removed before production closeout, Phase 6/7, unless separately approved to remain).

---

## 2. Implementation Boundaries Confirmed

- **Authorized file, exactly one:** `naavi-voice-server/src/index.js` —
  - One new line inside the existing disarm block, `naavi-voice-server/src/index.js:8963-8966` (§1a).
  - One new `console.log` line immediately after line 8971 (§1b).
- **No additional files are approved.** Not any mobile file (confirmed voice-only, Phase 1A §2-3). Not any Supabase Edge Function (confirmed Shared Core untouched, Phase 2 §5). Not a new file — no `_shared/` module, no config file, no `.env`/Railway variable.
- **No opportunistic refactoring is approved.** The existing disarm condition's own logic (line 8963's `if`, `deepgramFirstMessageAt = Date.now()`, `clearTimeout`), the Pre-T0 timing block (8973-8983), the recording/Q&A/privacy-mute/stop-word gates, the existing `[Deepgram] FINAL:` log (9461), and the watchdog's own arm/timeout logic (8939-8953) are all untouched.
- **No architectural changes are approved beyond §1.** No change to the watchdog's 6-second/30-frame trigger thresholds, no change to `deepgramReconnectCount`'s 2-attempt cap, no change to the disarm condition's actual logic (it still disarms on any Results message — this phase only makes that event visible, it does not fix it, because root cause is not yet proven per Phase 1 §4).
- **Explicitly excluded from this authorization** — each would need its own Phase 1/2/3, not implied by this approval:
  - Any actual fix to the watchdog's disarm condition (e.g., requiring a non-empty transcript before disarming) — root cause remains a hypothesis, not proven (Phase 1 §4), and this document does not change that.
  - Removing the `[B10m-diag]` logging — governed by Phase 2 §9's removal criteria, not by this document, and not yet due.
  - Any change to `connectDeepgram()`'s two call sites (Phase 2 §8) or any other part of the voice orchestration flow.
  - [[B10n]] (the JSON-extraction/garbled-speech defect) — separately tracked, unrelated code path, no Phase 1 written for it yet, not part of this authorization.

## 3. Deferred architectural ideas

**No deferred architecture decisions.** Distinguished explicitly from "nothing discussed": the plan was evaluated for architectural surface area (§1's two additive log lines) and none exists to defer — this is not an absence of discussion, it is the discussion's conclusion.

## 4. Non-Determinism Rule applicability

Not applicable. Governance §Phase 3's Non-Determinism Rule governs Claude/Haiku classifier or system-prompt changes, which produce non-deterministic routing decisions across repeated calls. This change touches neither — it is deterministic `console.log` instrumentation with no LLM involvement. The rule's spirit (multiple live trials before drawing a conclusion) is still honored operationally via Phase 2 §9's removal criteria (minimum 3 reproduction attempts before evaluating the evidence), but the rule itself does not formally apply here.

---

## 5. Phase 3 review record (2026-07-19)

External reviewer (ChatGPT) verdict: **Approved.** Full governance-compliance checklist (derived from approved Phase 2, implementation details complete, exact insertion points defined, implementation boundaries explicit, no scope expansion, Protected Core handled correctly, architectural changes deferred, diagnostic remains behavior-neutral, future work explicitly excluded, phase gate respected) — all items passed. Three editorial observations, all incorporated into this revision: §1a's "modifies the existing disarm block" reworded to "adds one diagnostic statement inside the existing disarm block," emphasizing execution logic is unchanged; §1b now states the `[B10m-diag]` tag is part of the diagnostic's implementation contract, not an arbitrary label; §3 reworded from "None raised" to "No deferred architecture decisions," distinguishing a considered-and-concluded absence from a simply-undiscussed one.

**This section is the record of the review; it is not, by itself, authorization to proceed.** Per the Phase-Gate Approval Rule: moving to Phase 4 requires Wael's own separate, explicit go-ahead.

## 6. Status

**Phase 3 drafted 2026-07-19, reviewed and Approved same day (§5), three editorial observations incorporated. Phase 4 (Implementation) has NOT started and will not start until Wael gives explicit, separate approval for that specific transition.**
