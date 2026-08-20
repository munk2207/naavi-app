# Session Handoff — 2026-07-19 — B4b Phase 1-6 complete (diagnostic instrumentation, reverted), voice silent-hang bug discovered during manual testing, next session priority is that bug

---

## 1. What happened this session

### B4b (Deepgram barge-in leading-word drop) — full governed Phase 1-6 cycle complete

Ran the entire B4b investigation under Governance v3.5 from a cold start, in order, with Wael's own explicit separate go-ahead at every phase-gate transition:

- **Phase 1** (`docs/B4B_PHASE1_PROBLEM_DEFINITION_2026-07-18.md`) — Approved. Proved the leading-word-drop failure originates at or before Deepgram's own `Results` message (not code-side truncation, not audio being withheld from Deepgram). Root cause of the underlying STT/acoustic mechanism explicitly **not proven** — three candidate hypotheses left open (audio-path issue / Deepgram VAD-endpointing issue / our own aggregation-code gap).
- **Phase 1A** (`docs/B4B_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-07-18.md`) — Approved. Confirmed Voice-only, Protected Core, not Duplicated, not Shared Core. Noted (not fixed) a real Architecture Reference documentation gap: no §2 row for voice STT/barge-in's voice-only status, unlike Geofencing's mobile-only row.
- **Phase 2** (`docs/B4B_PHASE2_CHANGE_PLAN_2026-07-18.md`) — Approved. Since root cause was unproven, planned diagnostic logging (an investigation plan), not a fix — explicitly modeled on the `fb63a29` (F19 Track B-1e) precedent.
- **Phase 3** (`docs/B4B_PHASE3_TECHNICAL_REVIEW_2026-07-18.md`) — Approved. Nailed down exact log format and 3 insertion points in `naavi-voice-server/src/index.js`.
- **Phase 4** (`docs/B4B_PHASE4_IMPLEMENTATION_VERIFICATION_2026-07-18.md`) — Approved. Code implemented, committed (`f56f9da`), pushed. Verified fresh against Phase 3's boundaries — no drift.
- **Phase 5** (`docs/B4B_PHASE5_EVIDENCE_2026-07-18.md`) — Approved. Evidence package for the *instrumentation*, not a fix. Rule 15a exception recorded (no automated test — genuinely not unit-testable, matches the `fb63a29` precedent). Defined the manual live-testing procedure (place calls, barge in with alert phrasing, capture `[B4b-diag]` traces, need ≥3 reproductions).
- **Phase 6** (`docs/B4B_PHASE6_TECHNICAL_REVIEW_2026-07-18.md`) — Approved. Four-verdict structure (Technical Review/Architecture Completeness/Governance Compliance all PASS, Overall Recommendation APPROVE — explicitly scoped to "the instrumentation only," not B4b's resolution).

**Every review round in this cycle produced 1-3 optional refinements from the external reviewer; all were applied on Wael's explicit "#1 confirm" instruction before moving to the next phase. No phase was skipped, and no reviewer "Approved" verdict was ever treated as authorization on its own — each transition required Wael's own separate go-ahead, consistent with the Phase-Gate Approval Rule.**

### Then: Phase 7 (manual live testing) surfaced a different, more serious, unrelated problem

Wael placed test calls per Phase 5's procedure. Result: **3 calls hung up with no response at all, a 4th call answered the greeting but never responded to "what time is it now."** This is not the B4b symptom (dropped leading word) — this is total silence for the entire call.

**Investigation, in order:**
1. First hypothesis: my B4b diagnostic logging commit caused it. **Reverted** (`43e0ae7`, confirmed via `git diff e03b976 HEAD -- src/index.js` → no difference — byte-identical to the pre-B4b state) on Wael's explicit "yes."
2. Wael tried again (waited 4+ hours, retried). **Still failed the same way.** This ruled out both the "my change caused it" hypothesis and a "Railway hadn't finished redeploying" timing hypothesis.
3. Per this project's 2-hypothesis cap, stopped guessing. Wael provided real Railway Deploy Log screenshots from the failed call. Direct log read confirmed: Twilio connects, Deepgram WebSocket reports `connected`, Twilio audio frames flow in continuously for the full ~30 seconds (`[FrameIn] #100` through `#1500`, `DG state: OPEN` throughout) — **but zero `[Deepgram] FINAL:` or any transcript-related log line appears at all.** Call ends via caller hangup (`code: 1005`).
4. Found a 91-day-old memory (`project_naavi_voice_call_hang.md`) documenting the exact same symptom before, historically intermittent, workaround "hang up and redial, usually works." Checked Deepgram's public status page directly (`https://status.deepgram.com/api/v2/status.json`) — "All Systems Operational," ruling out a platform-wide outage.
5. Wael pointed out today's 4/4 failure rate is worse than the historical "usually clears on retry" pattern and asked for real investigation, not more guessing. **Spawned a general-purpose research agent** with a fully self-contained brief (git history check, watchdog code-path trace, keyterm-limit hypothesis check, audio-encoding check). Its findings, reproduced in full below since they will not persist into a fresh session's context.

---

## 2. The new finding — voice silent-hang, likely root cause identified (not yet fixed)

**Confirmed facts (direct evidence, not inference):**
- Git history checked back ~40 commits touching `naavi-voice-server/src/index.js` — nothing except today's B4b commit (fully reverted) touches Deepgram connection/watchdog/media-forwarding code. **This is not a new regression from anything recent.**
- `connectDeepgram()` (`naavi-voice-server/src/index.js:8912-8954`) arms a 6-second watchdog on WS `open` that's supposed to detect "Deepgram connected but silent" and reconnect.
- The watchdog is disarmed at `naavi-voice-server/src/index.js:8963-8966`: `if (msg.type === 'Results' && deepgramFirstMessageAt === null) { ...clearTimeout(deepgramWatchdog) }`. **This checks only that a `Results` envelope arrived — it does not check whether that Results message actually contains a non-empty transcript.**
- This exact code was written in commit `8127dac` (2026-04-18) and has not been touched since — a 3-month-old latent gap, not a recent change.
- Deepgram's own documentation (fetched directly by the research agent) confirms empty-transcript Results messages are a normal, expected occurrence during streaming.
- The keyterm-count hypothesis (80 known names + 10 voice keyterms) was checked and **ruled out** — exceeding Deepgram's keyterm budget causes an explicit connection-level rejection (400 error), not a silent accept-then-hang; the log shows the connection succeeded cleanly.
- Audio encoding/format was checked and found internally consistent — no mismatch found.

**Most evidence-supported hypothesis (not proven with certainty — stated as a hypothesis, not fact):** Deepgram sends an early Results message, plausibly with an empty/low-confidence transcript (which its own docs say happens normally), which satisfies the watchdog's disarm condition and permanently turns off the only safety net for the rest of that call. If Deepgram's actual transcription then goes silent afterward — for whatever reason on Deepgram's side — nothing in the code detects or reacts to it anymore.

**What's still genuinely unknown, requiring data not accessible from this environment:**
- Whether an early empty Results message actually arrived on the failed calls — `deepgramFirstMessageAt` is set in code but **never logged anywhere**, so this can't be confirmed from the Railway excerpt already gathered.
- Why today produced 4/4 failures versus the historical "usually clears on retry" rate — would need Deepgram's own request/session logs (no dashboard access from here) or a Deepgram support ticket.

**Recommended next diagnostic step (not a fix, investigation only):** get the full, unfiltered Railway log for one of the failed calls (beyond the excerpt already reviewed) and/or Deepgram dashboard access for these call's request IDs, to directly confirm or rule out the empty-Results hypothesis before writing any fix.

---

## 3. Current repository state (verify before assuming, per project standing rule)

- `naavi-voice-server` `main` is at commit `43e0ae7` ("Revert 'B4b: add temporary diagnostic logging...'"). **B4b's diagnostic logging is NOT currently live.** Confirmed via `git diff e03b976 HEAD -- src/index.js` → no difference from the pre-B4b baseline.
- No code changes have been made toward the newly-found watchdog/silent-hang bug — investigation only, no fix authorized or attempted.
- All 7 B4b phase documents (`docs/B4B_PHASE1_...` through `docs/B4B_PHASE6_...`) exist, are complete, and are Approved. **B4b itself remains open** — no root-cause evidence has been gathered yet (the manual testing that would gather it was blocked by the silent-hang bug instead).
- The new silent-hang finding has **not** been added to `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` yet — deliberately left for next session rather than risk a rushed edit to a strictly-governed document at session end. Next available ID in the `B10` series: **`B10m`** (checked directly — `a` through `l` are used or already claimed; `B10l` is referenced in prose by T1a but has no open-table row of its own, so `m` is the next clean, unused ID).

---

## 4. Standing rule reaffirmed this session — read before touching either document

**`docs/AI_DEVELOPMENT_GOVERNANCE.md` and `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` are both frozen.** Wael's explicit instruction, this session: no one — including any AI session — is authorized to edit either document, irrespective of reason, reviewer recommendation, or governance §9's own stated amendment process. If a future review (this session's own reviewer included) recommends a change to either document, log it as a deferred item and do not act on it. This is a hard rule, not a default that yields to a good argument.

---

## 5. Recommended next session priority, in order

1. **Add the silent-hang finding to the holding list as `B10m`, Tier 1** (Active risk, real harm already occurring) — full governance discipline applies (check ID uniqueness fresh, don't leave a stale duplicate, re-run the doc's own consistency checks before ending that session too).
2. **Start Phase 1 (Problem Definition) on `B10m`** — Protected Core (Voice orchestration), Full Phase 1-8 required regardless of how the eventual fix looks. This is more urgent than B4b right now: the production voice line is currently unreliable for real callers, which is a worse problem than the leading-word-drop bug B4b investigates.
3. **Only after `B10m` is resolved (or Wael explicitly decides to proceed in parallel):** resume B4b's own evidence-gathering — likely means redeploying the `[B4b-diag]` diagnostic logging (or a revised version, if `B10m`'s fix touches nearby code) and actually completing the ≥3 live reproductions Phase 5 defined, now that calls should reliably connect.

**What NOT to do:** don't re-deploy B4b's diagnostic logging before `B10m` is addressed — a call that goes silent for an unrelated reason produces no useful `[B4b-diag]` evidence anyway, and burns another test cycle on a currently-broken phone line.

---

## 6. Reference — all documents from this session

- `docs/B4B_PHASE1_PROBLEM_DEFINITION_2026-07-18.md`
- `docs/B4B_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-07-18.md`
- `docs/B4B_PHASE2_CHANGE_PLAN_2026-07-18.md`
- `docs/B4B_PHASE3_TECHNICAL_REVIEW_2026-07-18.md`
- `docs/B4B_PHASE4_IMPLEMENTATION_VERIFICATION_2026-07-18.md`
- `docs/B4B_PHASE5_EVIDENCE_2026-07-18.md`
- `docs/B4B_PHASE6_TECHNICAL_REVIEW_2026-07-18.md`
- This handoff: `docs/SESSION_HANDOFF_2026-07-19_B4B_PHASE1-6_DONE_VOICE_SILENT_HANG_FOUND_NEXT.md`

Memory updated in the same session: `project_naavi_voice_call_hang.md` (new root-cause hypothesis added, with code citation), `MEMORY.md` (next-session priority section rewritten to point here).
