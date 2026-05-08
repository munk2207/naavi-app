# Session Handoff — 2026-05-07 — V57.12.6 build 158

**Read this first if you're picking up where this session left off. Pair with `CLAUDE.md` at the repo root (project rules, banned terms, build/deploy workflow).**

## Where you are right now

- **Latest build on Wael's phone AND emulator:** V57.12.6 **build 158** (Internal Testing on phone, side-loaded APK on emulator)
- **Auto-tester:** 52 ✓ / 0 ✗ / 0 errored / 0 skipped — first clean run of the project (held since V57.12.0)
- **Prompt version live:** **v64** — `2026-05-07-v64-no-minimum-reminder-delay`
- **Claude prompt source of truth:** `supabase/functions/get-naavi-prompt/index.ts`
- **DB:** cleaned of test residue at end of session (10 reminders, 4 action_rules, 1 list, 1 contact, 108 conversation rows). User_settings / user_tokens / user_places preserved.

## Headline outcome

This was a **manual sweep + bug-hunt session**. We tested V57.12.0 build 151 step-by-step on Wael's phone, surfaced ~15 distinct bugs, and shipped 6 fix builds (151 → 153 → 154 → 155 → 156 → 157 → 158). The two structurally important wins:

1. **Bug H** (chronic crash on every interaction) traced via `adb logcat` to a React infinite render loop in `app/index.tsx::checkUpcomingEvents` — `recordingPrompt` was a state value used inside an effect that listed `recordingPrompt` in its own deps. Three earlier "fix" builds chased wrong hypotheses (audio-mode constants, error boundaries, native-thread races) until the user pushed back ("I cannot accept a solution that does not address the issue") and we pivoted to a logcat capture that named the actual cause.
2. **Bug P** (silent reminder loss) — every SET_REMINDER since V57.12.0 wrote `phone_number = NULL` because `saveReminder()` passed `undefined` and `check-reminders/index.ts:46` filters `.not('phone_number', 'is', null)` from the cron query. 8 orphans accumulated over 24 hours; backfilled manually via PostgREST PATCH and now `saveReminder()` always populates `phone_number` from `user_settings.phone` if the caller didn't supply it.

## Bugs status — full table

| ID | Description | Status | Fix location |
|----|-------------|--------|--------------|
| A | Picker hijack — confirmation reply absorbed by picker | ✅ Fixed | `useOrchestrator.ts` intercept-entry escape |
| B | Picker stuck forever (no timeout) | ✅ Fixed | 5-min timeout guard |
| C | "Cancel" doesn't escape picker | ✅ Fixed | NEGATIVE_RE relaxed pattern |
| D | "Forget it" / "stop" / "don't" not recognized as cancel | ✅ Fixed | NEGATIVE_RE pattern |
| E | Empty speech with non-empty actions (orchestrator silent) | ✅ Fixed | `naavi-chat` `buildFallbackSpeech` |
| F | LIST_RULES context bleed across turns | ⚠️ Mitigated (prompt v63) | `get-naavi-prompt` |
| G | Audio mode crash on Android | ✅ Fixed | InterruptionModeAndroid enum |
| **H** | **App crashes on every interaction (most painful)** | ✅ Fixed (V57.12.5) | `app/index.tsx::checkUpcomingEvents` — removed `recordingPrompt` from deps |
| I | WhatsApp template variables rejected by Twilio (error 21656) | ✅ Fixed (V57.12.6) | `send-sms` sanitizer for emojis/em-dash/newlines in ContentVariables |
| K | `savePerson` missing user_id | ✅ Fixed | `lib/memory.ts` |
| L | `lookupContact` cross-user bleed | ✅ Fixed | `lib/contacts.ts` user_id scope |
| M | Bubble pop-in race | ✅ Fixed | append before setTurns |
| N | (n/a) | — | — |
| O | Storage adapter swallowed Drive errors | ✅ Fixed | `google/storage.adapter.ts` throw on `result.success===false` |
| **P** | **Reminders never fire — phone_number=NULL filter skips them** | ✅ Fixed (V57.12.6) | `lib/supabase.ts::saveReminder` fetches user_settings.phone fallback |
| Stop button | Disappears during streaming | ✅ Fixed (V57.12.2) | always visible while `convState==='speaking'` |
| Audio mode | `Audio.INTERRUPTION_MODE_ANDROID_DUCK_OTHERS` undefined post-SDK55 | ✅ Fixed (V57.12.3) | enum import + try/catch |

### Bug F (LIST_RULES context bleed) — partial

Prompt v63 added an explicit "list_rules without context-bleed" rule. Holds in tests (regression suite) but not field-tested on a long multi-turn voice session. Watch for regressions in next session.

## Build timeline this session

| Build | Marker | Highlights |
|-------|--------|------------|
| 151 | V57.12.0 | Anthropic Structured Outputs (prior session). Sweep started here. |
| 152 | (cancelled in-flight) | — |
| 153 | (cancelled in-flight) | — |
| 154 | V57.12.2 | Stop button always visible; bubble lineHeight 24 → 20 |
| 155 | V57.12.3 | InterruptionModeAndroid enum fix; first wrong Bug H hypothesis (audio mode) |
| 156 | V57.12.4 | Heartbeats 12×10s → 60×2s; AppState logging; second wrong Bug H hypothesis |
| 157 | V57.12.5 | **Real Bug H fix** — `recordingPrompt` removed from deps array in `checkUpcomingEvents` |
| **158** | **V57.12.6** | **Bug P fix** — `saveReminder` always populates `phone_number`; Bug I fix in `send-sms` ContentVariables sanitization |

## Server-side changes that ride on top of any build (no AAB needed)

These were deployed during the session and apply to V57.12.x AND any future build immediately:

- `supabase/functions/get-naavi-prompt/index.ts` → **v64** (`2026-05-07-v64-no-minimum-reminder-delay`). v63 added list_rules context isolation; v64 explicitly tells Claude there is no minimum reminder delay (fixes Claude's hallucinated "2 minutes is too soon" refusal).
- `supabase/functions/naavi-chat/index.ts` → `buildFallbackSpeech()` for empty-speech-with-actions case (Bug E).
- `supabase/functions/check-reminders/index.ts` → `Promise.allSettled` per-channel + `recipient_name` passthrough (Bug I diagnostic). **Note:** the line-46 filter `.not('phone_number', 'is', null)` is unchanged — fixed at the write side, not the query side. Don't touch the filter or you'll fan-out reminders to nobody.
- `supabase/functions/send-sms/index.ts` → ContentVariables sanitizer for WhatsApp template slot (Bug I). Strips emojis (BMP-out chars), collapses newlines to spaces, em-dash → hyphen, multiple whitespace → single. ASCII-rich body still flows on SMS / email path; sanitization is **template-slot only**.

## Non-app work shipped this session

### Public demo line — full redesign

Twilio number `1-888-916-2284` (the "1-888-91-NAAVI" public demo number) was reworked end-to-end:

- Dropped "Naavi Demo" branding from greeting (now reads as a normal Naavi call).
- Replaced live LLM with a **canned interactive demo** — 5 menu-driven scenarios (calendar / email / reminder / alert / note). Caller asks, Naavi responds; permissive STT keyword match with 2-attempt graceful fallback.
- **Voice changed from Aura to Polly Joanna** with SSML `<break>` tags for pacing (caller had reported it sounding rushed).
- 5-minute soft-cap CTA: at 5:00 Naavi offers SMS opt-in via the same 888 number; on yes, fires `sendDemoCtaSms` from `+18889162284` and ends call gracefully.
- Per-call state lives in `demoCallState` Map keyed by Twilio CallSid.
- New endpoints: `/voice/demo/menu`, `/voice/demo/scenario/:name`, `/voice/demo/cta`.
- File: `naavi-voice-server/src/index.js`. ~297 lines added.

### Maestro e2e suite committed to git

Previously untracked. After Bug H bleeding through 10 of 13 tests on V57.12.0, the suite was rewritten to assert on **stable UI labels** (`LIST CREATED`, `SMS DRAFT READY`, `Ask MyNaavi`) rather than LLM prose. Now committed under `e2e/` (13 yaml scenarios).

### Test residue cleanup

End-of-session DB cleanup against `wael.aggan@gmail.com` user_id only, last 8 hours:
- 10 reminders (test reminders + the 8 backfilled orphans)
- 4 action_rules (test alerts)
- 1 list ("Test List")
- 1 contact (test contact)
- 108 conversation rows

**Preserved:** user_settings, user_tokens, user_places (saved addresses, OAuth, phone). Google Calendar was NOT cleaned — there are test calendar events in there (user opted out of that step, said it was acceptable).

## What did not get verified before close

The session ended **before** post-build-158 manual verification. Specifically:

1. **Bug I live verification** — server-side fix is deployed. Wael was about to run a 2-min reminder on his phone to confirm WhatsApp arrives. Did not happen. Maestro suite was started in parallel and stopped (cleanly via TaskStop) on close.
2. **Bug B (5-min picker timeout)** and **Bug C (resolved-state escape)** — code-level fixes shipped, not field-verified.
3. **Maestro full suite on V57.12.6** — not run to completion. Run `cd /c/Users/waela/OneDrive/Desktop/Naavi && /c/maestro/bin/maestro.bat test e2e/ --format junit` against the emulator.

### Self-correction note

During the session I instructed Wael to "tap the orange button" to start a voice reminder. That was wrong — **the voice CTA has always been the green mic button** at the bottom-right of the home screen (blue button next to it is contacts). Wael's reply *"there is no orange button"* was a correction, not a bug report. Build 158 home screen renders correctly. Don't reintroduce this mis-naming.

## Top of next session — priority order

1. **Bug I live verification** — fresh 2-min reminder on phone, confirm SMS + WhatsApp + Email + Push all arrive.
2. **Maestro full suite on V57.12.6.** Cascade should clear now that Bug H is fixed.
3. **Bug B / Bug C live verification** in conversation flow.
4. **From the V57.12 carryover backlog (in CLAUDE.md):**
   - Bubble truncation final attempt (`lineHeight: 20` for ratio 1.33 OR react-native-markdown-display swap)
   - LIST_RULES synthesize-action backstop in orchestrator
   - Verified-address rejection naming the address ("I can't confirm '<destination>' for your meeting today")
   - Haptic VIBRATE permission + duration
   - Voice server chain-store mirror (defer until Structured Outputs is fully bedded down everywhere)

## Where the code is right now

- **Worktree this session ran in:** `.claude/worktrees/elegant-hertz-df3c33` — branch `claude/elegant-hertz-df3c33` (clean as of close, last commit pushed and built as 158).
- **Main repo:** `C:\Users\waela\OneDrive\Desktop\Naavi` — `main` branch, in sync with worktree's last commit.
- **Build clone:** `C:\Users\waela\naavi-mobile` — `main`, in sync; do not edit code here.
- **Voice server:** `naavi-voice-server` repo — `main` branch, demo-line changes pushed; Railway auto-deployed.
- **Latest commit on main:**
  - `66b3bf6` — `V57.12.6 build 158 — Bug P fix (saveReminder always populates phone_number)`
  - Prior: `e6660c8` `V57.12.0 build 151 — Anthropic Structured Outputs migration (Phases 1-5)` (prior session's anchor)

## Rules to keep honoring (see CLAUDE.md for full list)

- **Mandatory `npm run test:auto` GREEN before any AAB build.** Held this session — 52/0/0/0 throughout.
- **No "senior" / "caregiver" framing.** Held.
- **No action without explicit approval; one step at a time; numbered choices.** Held this session — pacing markedly improved over recent sessions per `feedback_slow_down_sync.md`.
- **Ship one thing per session.** Broken this session by user authorization ("authorizing you for all"). Don't read that as a precedent — wait for explicit re-authorization next time.
- **`# N` means option N.** Held.

## Files to read alongside this handoff

- `CLAUDE.md` (project root) — banned terms, build workflow, multi-user safety, alert fan-out rule, configuration discipline.
- Memory index: `C:\Users\waela\.claude\projects\C--Users-waela-OneDrive-Desktop-Naavi\memory\MEMORY.md` — pull `feedback_slow_down_sync.md`, `project_naavi_active_bugs.md`, `feedback_mandatory_auto_tester_before_build.md` first.
- Prior handoff: `docs/SESSION_HANDOFF_2026-05-06_STRUCTURED_OUTPUTS_V57.12.md` (V57.12.0 baseline this session built on).
