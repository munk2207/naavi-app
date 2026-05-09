# Session Handoff — 2026-05-09 — Classification + Build Rules + B1c Shipped

**Read this first if you're picking up where this session left off. Pair with `CLAUDE.md` at the repo root (project rules, banned terms, build/deploy workflow). Now contains Rules 16 and 17.**

## Where you are right now

- **Latest deploy state:** B1c email instant-search live-overlay shipped on both surfaces. Mobile half verified working; voice half partially verified (1 success, 1 failure on consecutive tests — open follow-up).
- **Last commit on `naavi-app/main`:** `ea2ca28` — *"B1c shipped + partially verified; classification updated"*. Pushed.
- **Last commit on `naavi-voice-server/main`:** `ae2e9a4` — *"B1c — email instant-search live-overlay (voice-server half)"*. Pushed; Railway auto-deployed.
- **Auto-tester baseline:** 50 ✓ / 0 ✗ / 3 errored / 2 skipped. The 3 errored are pre-existing Google-token issues with the test user account (`mynaavi2207@gmail.com`) — unrelated to any session change. Fix the test user tokens for cleaner future baselines.
- **No pending work in any repo. Working tree clean. All commits on origin.**

## Headline outcome

This was a **research + planning session that became a discipline-building session.** The walkthrough of the 26-item holding list (started 2026-05-08) was finalized, then a second pass added cross-surface drift discipline (CLAUDE.md Rule 16), validate-before-fix discipline (Rule 17), and surface-tag classification. The first concrete fix (B1c email live-overlay) was implemented end-to-end through this discipline as the live test of the new workflow.

The session also surfaced two important methodology lessons (saved as memory files):
- **`feedback_user_test_is_ground_truth`** — when user test contradicts your hypothesis, accept the test; don't construct edge cases.
- **`feedback_dont_overstate`** — don't assert hypotheses as facts; slow down and rethink before writing.

Plus operational discipline:
- **`feedback_classification_notes_plain_functional`** — Notes column = plain user-visible behavior, not technical detail.
- **`feedback_batch_docx_regeneration`** — don't regen .docx after every change; batch at session boundaries.

## Three documents that direct the work going forward

| Doc | Purpose | Update cadence |
|---|---|---|
| `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08` (.md + .docx) | Backlog with severity-encoded IDs (B/F/T/I + 1/2/3) and Surface tag (voice/mobile/both/backend/website) | When items get added, classified, or change state |
| `docs/VOICE_COMPLETION_ROADMAP_2026-05-08` (.md → no, only .docx via build script) | Strategic plan to reach voice-replicates-mobile + voice-native dignity. 11 work items W0–W10 in dependency order | When strategy shifts (rarely) |
| `CLAUDE.md` | Project rules including the new Rule 16 (parity-impact: on commits) and Rule 17 (validate before fix) | When rules change |

## What changed this session

### Discipline + rules (the foundation)

**CLAUDE.md additions:**
- **Rule 16** — every commit changing user-facing behavior in `naavi-voice-server/`, `hooks/useOrchestrator.ts`, `app/`, `naavi-chat`, or `get-naavi-prompt` MUST include a `parity-impact:` line in the message body. Forces explicit cross-surface decision at change time. Auto-retires once Voice Roadmap W2 (Anthropic Structured Outputs) + W3 (Voice Automated Regression Suite) land.
- **Rule 17** — validate every classification entry by user-facing test BEFORE coding a fix. If the test doesn't reproduce the bug, close the item rather than fixing a phantom. Don't construct tighter / weirder reproduction setups to make a failed hypothesis appear.

**Voice Completion Roadmap promoted W7 → W2 (Structured Outputs) and W9 → W3 (Voice Automated Regression Suite)** — they form the mechanical guarantee of cross-surface parity once shipped, and Rule 16 auto-retires when they're in place.

**Classification doc gained a Surface column** with values `voice` / `mobile` / `both` / `backend` / `website`. Used at design time to answer *"should this also be done on the other surface?"* before code is written.

### Items processed under Rule 17

| ID | Action | Result |
|---|---|---|
| **B1a** Voice live-calendar fetch | User test 2026-05-08 | Closed — voice gives fresh calendar answers in real use; bug as classified does NOT reproduce. Architectural read was right about code path, wrong about user-visible behavior. |
| **B1b voice half** Voice LIST_RULES backstop | User test 2026-05-08 | Closed — voice (PC) correctly listed all 7+ alerts. Voice path reliable in real use. Mobile half (B1b) still active and confirmed broken (Naavi said *"I don't have any alerts in your records"* when 7+ exist). |
| **B1c** Email instant-search live-overlay | User test 2026-05-08 + implementation | Mobile half SHIPPED (commit 694b601) and verified working. Voice half SHIPPED (voice-server commit ae2e9a4) and partially verified — see Open Investigation below. |
| **B2a** Voice SCHEDULE_MEDICATION | User test 2026-05-08 | Validated broken on voice. Naavi said *"I'll set up your aspirin schedule"* but no events landed in Calendar. Fix deferred to next focused server-side session. |
| **B2b** Voice "Naavi stop" | User test 2026-05-08 | Validated broken on voice. Bigger than originally classified — both *"Naavi stop"* AND bare *"stop"* fail to interrupt. Fix deferred. |
| **B2c** Voice barge-in | User test 2026-05-08 | Validated broken. Likely same root cause as B2b (test does not distinguish "system never received audio" from "system received but ignored"). Investigate together. Fix deferred. |
| **B2d** Voice name-search mistranscription | User test 2026-05-08 → Pivoted to F2c | Closed as bug; opened as new Feature F2c (Walkie-talkie style turn-taking on voice — Wael's idea after seeing the channel-architecture difference between MV clean-channel and PC always-listening). Severity F2. |
| **B3a** Voice fragmentation across surfaces | Traced 2026-05-08 | Confirmed via direct user observation. Trace finding: mobile app prefers Deepgram Aura via cloud TTS but falls back to phone's native TTS (`expo-speech`) whenever the cloud path fails (Edge Function error / JWT expired / network blip / audio-focus hiccup / any chunk null). The architecture is intentional (cloud-preferred + native fallback so replies are never silent). Real fix is "make cloud TTS reliable enough that fallback rarely fires." Connected to memory `project_naavi_mobile_tts_loss.md`. PC fragmentation perception NOT yet traced (different TTS architecture — voice server streams Aura via Twilio). |

### Final tally after this session

| List | Count | IDs |
|---|---|---|
| Bugs (B) | 10 | B1b, B1c, B2a, B2b, B2c, B3a, B3b, B3c, B3d, B3e |
| Features (F) | 7 | F1a, F1b, F1c, F2a, F2b, F2c, F3a |
| Tooling (T) | 3 | T1a, T2a, T2b |
| Ideas (I) | 3 | I2a, I2b, I3a |
| Closed without entry | 5 | Items 4, 12, 14, B1a, B2d |
| **Total** | **28** | |

By Surface: voice 5, mobile 6, both 6, backend 5, website 1.

## Open follow-ups (TOP OF NEXT SESSION)

### 1. B1c voice-half inconsistency (newest, top of mind)

Two consecutive tests gave opposite results minutes apart:

- **9:23 AM "Dinner Meeting" test** — succeeded. Naavi said *"Let me search for emails about a dinner meeting. This is about our discussion yesterday, and 8 more if you want them."* Found the email correctly.
- **9:30 AM "Buying Home" test** — failed. Naavi said *"I don't have buying-home email in your records."*

Both emails fresh (sent 0 minutes before call). Same caller, same flow. Voice behaves inconsistently.

**Open investigation:** read Railway logs for the Buying Home call (~9:31 AM) — look for `[Timing] fetchLiveRecentEmails` line and `[Action] GLOBAL_SEARCH` line. We need to know whether:
- The intent regex matched and live-overlay fired
- If fired, what the live-overlay returned
- Whether GLOBAL_SEARCH ran for this query

Without those log lines we can't diagnose. Could be regex miss, could be Gmail API filtering, could be a Claude-side semantic mismatch.

**Important: do NOT investigate by running tighter tests** (memory `feedback_user_test_is_ground_truth`). The user already ran a clean test; the result is the truth. Look at logs.

### 2. Five severity-1+2 bugs remaining for fix work

Per Wael's directive 2026-05-08, hold the B3 (severity-3) items and tackle these:

| ID | Surface | Server/AAB | State |
|---|---|---|---|
| B1b | mobile | AAB | Validated broken; defer to next AAB cycle |
| B1c | both | Server | Mobile shipped + verified; voice shipped + partially verified (see #1 above) |
| B2a | voice | Server | Validated broken; deferred |
| B2b | voice | Server | Validated broken; deferred — investigate jointly with B2c |
| B2c | voice | Server | Validated broken; deferred — investigate jointly with B2b |

Order Wael originally wanted: B1c → B2a → B2b+B2c together → B1b mobile (next AAB).

### 3. Voice TTS streaming reliability (separate observation)

Railway logs during B1c voice testing showed repeated patterns of:
- `[TTS] Cannot stream — WebSocket not open`
- `[Process] TTS stream failed — no audio sent`
- `[MediaStream] Twilio disconnected — code: 1005`

Code 1005 in some cases is the user hanging up; in others it's a TTS-during-disconnect race. Worth flagging as a separate item if it surfaces consistently. **Not currently classified.**

### 4. Test user Google tokens expired

Auto-tester errors 3 of 55 tests with `Token has been expired or revoked` for `mynaavi2207@gmail.com`. The errors are unrelated to any session change but they prevent ever reaching 0/55/0/0/0 baseline. **One-time fix:** sign in with `mynaavi2207@gmail.com` to re-authorize the Google tokens used by the auto-tester. Worth doing before next AAB to make Rule 15 enforcement clean.

## Where the code is right now

- **Active worktree:** `.claude/worktrees/beautiful-hoover-43f146` — branch `claude/beautiful-hoover-43f146` (at same commit as `origin/main` after end-of-session push).
- **Main repo:** `C:\Users\waela\OneDrive\Desktop\Naavi` — `main` branch, in sync with `origin/main` at `ea2ca28`.
- **Build clone:** `C:\Users\waela\naavi-mobile` — `main`, may be stale; sync via `git fetch origin && git merge origin/main` before next AAB.
- **Voice server:** `naavi-voice-server` repo — `main` branch at `ae2e9a4`; Railway auto-deployed.

## Files to read alongside this handoff

- `CLAUDE.md` — Rules 1-17 including the two new ones from this session (16: parity-impact: discipline; 17: validate before fix)
- `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md` — current state of all 28 items with Surface tags + tallies
- `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.docx` — Word version of the same
- `docs/VOICE_COMPLETION_ROADMAP_2026-05-08.docx` — strategic plan W0–W10
- Memory index: `C:\Users\waela\.claude\projects\C--Users-waela-OneDrive-Desktop-Naavi\memory\MEMORY.md` — pull these first:
  - `feedback_user_test_is_ground_truth` (NEW 2026-05-08)
  - `feedback_dont_overstate` (NEW 2026-05-08)
  - `feedback_classification_notes_plain_functional` (NEW 2026-05-08)
  - `feedback_batch_docx_regeneration` (NEW 2026-05-08)
- Prior handoff: `docs/SESSION_HANDOFF_2026-05-07_V57.13.7_BUILD_165.md` — V57.13.7 baseline before this research session

## Rules to keep honoring (see CLAUDE.md for full list)

- **Rule 1** — no action without explicit approval
- **Rule 9** — wait for user "done" signal before next item
- **Rule 11** — never recommend stopping / pacing
- **Rule 13** — numbered choices, never embedded in prose
- **Rule 14** — `# N` = option N
- **Rule 15** — `npm run test:auto` green before every AAB build
- **Rule 16 (NEW)** — `parity-impact:` line on every cross-surface commit
- **Rule 17 (NEW)** — validate every classification entry by user-facing test before coding a fix
- **`feedback_user_test_is_ground_truth`** (NEW memory) — when user test contradicts your hypothesis, accept the test
- **`feedback_dont_overstate`** (NEW memory) — don't assert hypotheses as facts; slow down before writing
