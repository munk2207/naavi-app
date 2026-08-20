# Session Handoff — 2026-08-15 — Conversation Recorder Backend Restored, Build 322, Two Open Bugs

## ⭐ Next session — explicit priority per Wael

**Two confirmed-failing issues from build 322, both need real fixes, not another guess:**

1. **Draft Email action sometimes missing entirely from extraction.** The code fix (recipient_email field) is correct — verified by re-running `extract-actions` directly against the exact real transcript text and getting the right result. But the live extraction call during Wael's actual device test did not produce the email action at all. This is LLM (Haiku) non-determinism on a densely-packed utterance, not a deterministic bug — see "Open issue 1" below for the evidence and options.
2. **Screen does not scroll to show new content at all**, even though the code path that should trigger it (`convState === 'done'`) is confirmed reached (the spoken summary played, and that only fires right before `setConvState('done')`). Two fix attempts have both failed — see "Open issue 2" below. Per this project's 2-hypothesis-cap rule, do NOT attempt a third blind fix — add `remoteLog` instrumentation first (recipe below) to get real evidence from the device before touching the code again.

**When Wael says "confirm" about test results, answer precisely — do not imply passing evidence exists when it doesn't.** This session ended on a correction: I said an issue "failed to deliver a working result in your test" when in fact I had zero passing evidence for one issue and only one non-representative isolated backend call (not an app test) for the other. Wael caught this immediately. Be exact about what "tested and passed" actually means going forward.

---

## What shipped this session

### 1. ChatGPT-comparison prompt rework — shipped to production

Naavi's answer to "what's the difference between you and ChatGPT" (and Claude/Siri/Alexa/Google Assistant) went through 4 rounds of live testing on staging before landing on: the competitor's name appears exactly once, in the closing sentence only; the body is framed as Naavi demonstrating its own specialization, never a rebuttal. Locked in by `tests/catalogue/prompt-regression.ts::prompt-regression.comparison-chatgpt-single-mention`. Deployed to both staging and production `get-naavi-prompt`. Commit `0bb49c8`.

### 2. Conversation-recorder ("Visits") backend restored — dead since 2026-06-11

Root cause: `upload-conversation`, `poll-conversation`, `extract-actions` were deleted 2026-06-11 (commit `f9465e0`, "remove 8 dead Edge Functions") as believed-dead code. They weren't — the mobile app's Visits button still called all three. Neither staging nor production had them deployed; every tap crashed for over two months.

Restored from git history. `extract-actions` worked immediately. `upload-conversation`/`poll-conversation` crashed on every invocation with a generic `WORKER_ERROR` — traced via Supabase's function logs to the `assemblyai` npm SDK bundling realtime WebSocket support (`ws`), which pulls in Node-only modules unavailable in Supabase's Deno edge runtime. Fixed by rewriting both to call AssemblyAI's REST API directly via `fetch()` instead of the SDK. Verified end-to-end on staging (upload → transcribe → poll → completed) and on a real device recording. Commit `69b3cc9`.

Also fixed a stale test assertion (`f12.lookup-contact-contact-id-support`) found while chasing an unrelated failure — the test string-matched source code verbatim; the line had been renamed since. No functional bug. Commit `0bb49c8` (bundled with the ChatGPT prompt work).

### 3. `CLAUDE.md` Rule 1a — read-only actions don't need approval

Wael flagged repeated friction from Claude asking permission before read-only investigation (reading files, listing, grepping). A `.claude/settings.json` audit found the technical permission system was already fully open (`bypassPermissions` + blanket `Bash(*)`) — the friction was Claude's own behavior, not a config gap. Added Rule 1a directly under Rule 1 in `CLAUDE.md`, explicit that Rules 1/2/12 govern state-changing actions only. Saved as memory `feedback_no_confirmation_for_read_only_actions`. Commit `e8839b2`.

### 4. Speaker-diarization investigation — closed with real evidence, not guesswork

Live testing surfaced a real, reproducible bug: action cards sometimes attributed one speaker's words to the other. Root-caused through several rounds (including a second-opinion critique from ChatGPT acting as Wael's auditor, which correctly challenged an overstated "pause-gates-diarization" explanation):
- Pulled raw AssemblyAI output directly from their transcript history (not reconstructed) for multiple real device tests — confirmed the misattribution originates in AssemblyAI's own diarization output, not Naavi's name-mapping code.
- A controlled test (Wael's own idea): a long, deliberately pause-free sentence produced zero false speaker splits, while genuine pauses were sometimes caught and sometimes missed — this is real evidence that pause length correlates with diarization reliability, though the *mechanism* remains formally unconfirmed (ChatGPT's caution stands: correlation observed, causal mechanism not proven).
- Confirmed empirically that action extraction quality (what gets scheduled, when) is unaffected by speaker misattribution — same actions extracted whether content is attributed to 1 speaker or 4.

Decision: removed the in-app "Conversation Transcript" display entirely (Wael's call — "we do not need to announce our failure"). The transcript still saves to Google Drive, now with a disclaimer under the TRANSCRIPT header: *"Speaker labels are Naavi's best effort — voice identification isn't always exact."* Also removed the "— [name]" attribution line from action cards (kept the timing). Commit `9eb234b`.

**Vendor comparison (Deepgram) — tested, AssemblyAI stays.** Deepgram's standard diarization (nova-3) performed *worse* on the same real test files (put the entire conversation under one speaker, zero distinction). Deepgram's Flux model (conversational turn-taking) solves a different problem — human-vs-AI end-of-turn detection for voice agents, not multi-human speaker diarization — confirmed directly against Flux's own docs, not assumed. Closed, no further action.

### 5. PLAUD Transcription API evaluation — PAUSED, not abandoned

Wael's physical PLAUD device reportedly handles real multi-speaker/multi-language conversations well; investigated their standalone Transcription API as a possible AssemblyAI replacement. Full technical recipe (verified working through the file-upload half of the pipeline) is saved in memory: `project_naavi_plaud_diarization_evaluation`. Blocked on `403 DEVICE_MISSING` from the transcription-submit endpoint, which contradicts PLAUD's own documentation (no device requirement is stated anywhere for this API). Working theory: an account-level gate tied to their free-tier-hours condition, not a genuine per-request requirement. **Resume when Wael has his physical PLAUD device available to connect to the developer account** — the memory file has the exact request/response shapes for every step so this doesn't need to be re-derived from their docs again.

Live API credentials were shared directly in chat during this session for evaluation purposes; Wael said he'll leave them as-is until this work resumes (no rotation needed yet).

### 6. Mobile builds this session — 319 through 322 (all staging only, none promoted to production)

- **319**: Draft Email button gated on `action.email_draft` presence (was showing unconditionally). Tappable calendar badge (`calendar_html_link` now captured and opened). In-app transcript display removed. — Tested, passed.
- **320**: Spoken confirmation added to the Visits flow (was completely silent end-to-end). Suggested-by name removed from cards. — Tested, passed (voice worked; timing/detail added in 321 per feedback).
- **321**: Auto-scroll added on `convActions` populating; spoken summary now includes each item's timing, not just titles. — Tested: voice passed; scroll **failed** ("screen started at the end and never scrolled with the voice" — root-caused to `convActions` being set way before `speakCue` fires, due to calendar-creation + Drive-save latency in between).
- **322**: Scroll trigger moved to `convState === 'done'` (should align with when voice starts). `recipient_email` field added to `extract-actions` + Draft Email handler, so a literal spoken email address bypasses speaker-name resolution entirely. — Tested: **both fixes failed** (see priority section above).

---

## Open issue 1 — Draft Email action sometimes missing (evidence, not yet a fix)

The real transcript from Wael's build-322 test (pulled directly from AssemblyAI, transcript ID `a2a66f56-d156-45b8-becb-e7183e2d9b40`, created 2026-08-15T15:31:40Z) confirms the email line WAS correctly transcribed:

> "I'd also like you to get a blood test next Friday, and let's schedule a follow-up in 2 weeks at 10 AM. If you have any questions, Email my office at whwh2207@gmail.com."

(Note: real diarization crammed the test + follow-up + email instruction into ONE utterance for "Speaker B" — this is the same turn-boundary unreliability documented in the diarization investigation above, just not the cause of THIS bug.)

Re-running `extract-actions` directly with this exact text (bypassing the app) DID correctly produce all 4 actions including the email one with `recipient_email: "whwh2207@gmail.com"` populated. So the extraction logic works — it's non-deterministic on this input, not deterministically broken. The model is Haiku (`claude-haiku-4-5-20251001`, chosen for cost — see comment in `supabase/functions/extract-actions/index.ts`), which may be less reliable at reliably parsing multiple distinct actions crammed into one dense utterance than a stronger model would be.

**Options for next session, not yet decided:**
- Test extraction repeatedly against the same real transcript to measure actual failure rate before deciding this needs a fix at all.
- Consider whether reverting to Sonnet for this specific extraction call (cost tradeoff — see the existing code comment about the April 2026 Haiku-accuracy regression that originally justified Sonnet) would reduce the miss rate.
- Consider a lightweight self-check/retry in the extraction call if the transcript clearly contains "@"-style content but no email-type action was returned.

## Open issue 2 — Screen scroll never happens (needs real evidence, not another guess)

Two attempts, two failures:
- Build 321: triggered on `convActions.length > 0` — fired too early (before calendar creation + Drive save complete), so the screen was already scrolled to the end before the voice even started. ("screen started at the end and never scrolled with the voice")
- Build 322: moved the trigger to `convState === 'done'`, which fires right alongside `speakCue()` — should be correctly timed. Wael confirmed the voice DID play (so `convState` genuinely reached `'done'`), but the screen "didn't move at all."

The scroll container is a `KeyboardAwareScrollView` (`react-native-keyboard-aware-scroll-view`), attached via `innerRef` (not a plain `ref`) to `scrollRef` — see `app/index.tsx` around line 1979-1980. This exact same `scrollRef.current?.scrollToEnd({animated:true})` pattern works correctly elsewhere in the file for normal chat replies, so the mechanism itself is proven — something about this specific call site isn't working.

**Do not attempt a third blind fix.** Per Rule B (2-hypothesis cap), the next step is to add `remoteLog` instrumentation (pattern already used elsewhere, e.g. `lib/calendar.ts`) around the scroll effect in `app/index.tsx` — log whether the effect fires, whether `scrollRef.current` is non-null at that moment, and ideally the ScrollView's measured content size — build once, have Wael retest, then query the remote log directly (same technique used throughout this session for Supabase-backed diagnostics) to see what's actually happening on the device before writing a third fix.

---

## Git state

- Main repo (`Naavi`): `d3940ae` is the latest commit, pushed to `origin/main`. Working tree otherwise matches session start (long-standing untracked doc/script files from prior sessions, untouched).
- Build clone (`naavi-mobile`): merged up to `d3940ae` via `git merge origin/main` (clean, no conflicts). `app.json` has `versionCode: 322` / `version: "1.0.322"`.
- All temporary diagnostic Edge Functions created this session (`diag-list-transcripts`, `diag-deepgram-diarize`, `diag-sms-forward-*`) were deleted from both staging and local disk before this handoff — none were ever committed.
