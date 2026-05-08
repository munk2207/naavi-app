# Session 25 handoff — V56.4 → V56.6 shipped, V56.7 staged

**Closed:** 2026-04-28
**Active branch:** `main`
**Last AAB on Robert's phone:** V56.6 build 115 (installed 2026-04-28)
**Local uncommitted work:** V56.7 build 116 (kill-and-replace race fix — DO NOT push without approval)

---

## What shipped to the phone this session

### V56.5 build 114 (committed `b60e498`, pushed)
- Mobile-side **kill-and-replace** in `useOrchestrator.send()` — `currentSendIdRef` generation counter; `stopSpeaking()` at top of send; old send bails before `setStatus('speaking')` and inside `speakResponse.then()/.catch()` if newer send is in flight.
- Replaced V56.4's blocking `sendInFlightRef` guard.
- **Result on phone: failed.** Tap mic during reply → still got Q1 + Q2 audio playing through. Root cause was the UI gate, not the orchestrator (see V56.6).

### V56.6 build 115 (committed `3d795fa`, pushed, AAB built `4P4kaCgsc2oibSbB1E5zUs.aab`)
- **`app/index.tsx` mic button:** removed `status==='speaking'` from `disabled` predicate; `stopSpeaking()` called the moment recording starts so Naavi's voice doesn't bleed into the user's mic input.
- **`app/index.tsx` `handleSend`:** allows during `speaking` (kill-and-replace handles it). Still blocks during `thinking`.
- **`app/index.tsx` TextInput:** editable during `speaking` (read-only only in `thinking` and `pending_confirm`).
- **`app/index.tsx` Draft Email card (#25):** uses `suggested_by` as explicit recipient (`"Draft an email to {Dr. X} about {title}. Body: {body}"`) so Claude emits `DRAFT_MESSAGE` instead of a conversational reply.
- **`app/settings.tsx` cleanup:** removed Providers section, Notion row, MyChart row, Health Wearables, Smart Home, and the standalone Calendar Disconnect button. Connected Services now lists Gmail / Calendar / Drive / Maps as status-only rows. Voice Playback + Push Notifications kept. Sign Out moved to bottom of the page above the version label.
- **AAB bug doc:** item #21 (mobile voice barge-in) marked resolved by V56.6 mic-tap behavior — re-open if hands-free voice barge-in becomes a requirement.

**Test result on phone:** kill-and-replace **still failed** — Q1 played to completion AND Q2 played at the same time (literal overlap). Root cause identified at the end of session (see V56.7 below).

---

## V56.7 build 116 — STAGED LOCALLY, NOT COMMITTED, NOT PUSHED

The user explicitly stopped at the verification gate: *"do not push until we verify everything"* and later *"Close this session"*. V56.7 must be committed + pushed + built only after the next session resumes and the user approves.

### Files changed (uncommitted)
- `app.json` — `versionCode: 116`
- `app/settings.tsx` — version label `V56.7 (build 116)`
- `hooks/useOrchestrator.ts` — replaced module-level `_speechStopped` boolean with a `_speechGen` counter

### Why
V56.5/V56.6 used a boolean `_speechStopped` flag set by `stopSpeaking()` and **reset by `send()` to allow the next reply to speak**. Race window:

1. Q1's `speakCloudNative` is awaiting chunk N
2. Mic tap → `stopSpeaking()` → `_speechStopped = true` (chunk N's `stopAsync` fires)
3. Recording → STT → `send(Q2)` → `_speechStopped = false` **before Q1's loop checks it**
4. Q1's loop wakes from its await, sees `_speechStopped = false`, plays chunks N+1, N+2…
5. Q2's `speakResponse` runs in parallel → both audio streams play simultaneously

### V56.7 fix
- `_speechStopped` boolean **deleted**. Replaced with module-level `_speechGen: number = 0`.
- `stopSpeaking()` increments `_speechGen`.
- Each `speakCloud` / `speakCloudNative` invocation captures `const myGen = ++_speechGen` on entry, then checks `_speechGen !== myGen` at every loop iteration. Once stale, it bails. Old loops cannot un-stale themselves because `myGen` is a captured local — no shared boolean to race over.
- `send()` no longer touches the speech-gen counter directly. The `stopSpeaking()` call there is sufficient because the next `speakResponse` will claim its own gen on entry.

### Next-session steps
1. Confirm with user that the V56.7 plan above is what they want shipped.
2. `git add app.json app/settings.tsx hooks/useOrchestrator.ts` → commit → push.
3. `cd C:/Users/waela/naavi-mobile && git fetch origin && git merge origin/main`.
4. `npx eas build --platform android --profile production --non-interactive`.
5. Upload AAB to Play Console Internal Testing → install on phone.
6. Run V56.6 test list (below) — kill-and-replace should now actually kill.

---

## V56.6 test list — what's still untested on phone

User completed only **Test 1 (kill-and-replace via Tap-to-Speak)** — failed → fixed in V56.7. The other items are still open and worth running before declaring V56.7 stable:

| # | Test | Status |
|---|---|---|
| 1 | Tap-to-Speak rapid-fire kill-and-replace | ✗ FAIL on V56.6 → V56.7 fix |
| 2 | Typed Send rapid-fire kill-and-replace | NOT RUN |
| 3 | Text input editable while Naavi is speaking | NOT RUN |
| 4 | Orange Stop button still appears + silences (no new turn) | NOT RUN |
| 5 | Draft Email card from Record-a-visit produces a draft card with `To:` filled in | NOT RUN |
| 6 | Settings — only Gmail / Calendar / Drive / Maps under Connected Services | NOT RUN |
| 7 | Sign Out is the last interactive element at the bottom of Settings | NOT RUN |
| 8 | Sign Out functional (tap → confirm → returns to login) | NOT RUN |
| 9 | Single Q+A regression (no interruption) still works | NOT RUN |

---

## Bug doc updates this session (`docs/AAB_BUNDLE_NEXT_RELEASE.md`)

| # | Title | Resolution |
|---|---|---|
| 21 | Voice "Naavi stop / cancel" interrupt on mobile | **RESOLVED 2026-04-28 by V56.6 mic-tap behavior.** Re-open if hands-free voice barge-in is later required. |
| 24 | Kill-and-replace replaces blocking guard | Open in V56.7 (race fix). |
| 25 | Draft Email card from Record-a-visit doesn't compose | Fixed in V56.6. Pending phone test. |
| 26 | Speaker labeling shows 1 speaker for 2-voice audio | Monitoring only — passed 3 retests. No code fix. |

---

## Server-side

No server-side changes this session. The Edge Functions and Supabase prompt are unchanged from Session 24.

- Active prompt version: `2026-04-23-v24-delete-all-keyword` (the v38 from Session 24's experiments was rolled back at end of Session 24 if I recall — verify by checking `supabase functions deploy get-naavi-prompt` recent log if Naavi behavior diverges from expectation).
- `extract-actions` Edge Function: still on Sonnet (reverted from Haiku in V56.4 — B20 prescription dose miscount).

---

## Open items not in V56.7

| Item | Status | Why deferred |
|---|---|---|
| Hands-free voice barge-in (#21 successor) | Deferred | Multi-day rewrite — Voice Agent API or react-native-webrtc. Not blocking. |
| B19 cross-account calendar leak | Diagnostic deployed | Server-side, intermittent. Watching logs. |
| B4 STT mis-transcription | Voice server scope | Separate session. |
| Card tap loading indicator (UX latency) | Pending | Cosmetic. |
| Push Notifications default ON for new users (#8) | Pending | Quick win for V56.8. |
| Remove Anthropic API Key field from Settings (#9) | Pending | Audit + remove. |

---

## Files referenced

- Repo root: `C:/Users/waela/OneDrive/Desktop/Naavi`
- Build clone: `C:/Users/waela/naavi-mobile`
- Voice server: `C:/Users/waela/OneDrive/Desktop/Naavi/naavi-voice-server`
- Website: `C:/Users/waela/OneDrive/Desktop/Naavi/mynaavi-website`

## Documents created in this session

- `docs/LAUNCH_PLAN.md` — peer products study, beta plan, social/SEO, six prep tracks
- `docs/SESSION_25_HANDOFF.md` — this file

## Memory pointers worth re-reading next session

- `feedback_one_question_at_a_time.md`
- `feedback_business_function_only.md`
- `feedback_no_dev_build_setup.md`
- `feedback_test_passes_user_end.md`
- `feedback_no_quit_option.md`
- `project_naavi_active_bugs.md`
- `project_naavi_voice_unification_open.md`

---

## Next session — name and scope

**Session 26 — Complete review of MV & MT bugs.**

Scope: a full sweep of Mobile Voice (MV) and Mobile Text (MT) behavior end-to-end. Not just the V56.7 verification — a structured pass through every input mode (typed Send, Tap-to-Speak, Hands-free, Record-a-visit, Daily Brief item taps, Draft cards, Settings toggles) to catalogue every defect before any new feature work. Output: a prioritized bug list grouped by surface (MV vs MT vs shared), with reproduction steps for each.

## First action next session

**Read this doc, then ask the user:** *"V56.7 is staged locally with the speech-gen race fix. Push and rebuild as the start of Session 26 (Complete MV & MT bug review)?"* Wait for explicit yes before committing.
