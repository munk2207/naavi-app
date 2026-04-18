# Session 13 — Complete Handoff Record (April 17, 2026, evening → late night)

**Purpose:** Full state so the next Claude session can pick up where this one ended without re-learning anything. Follows the same pattern as SESSION_12. Covers only work done in Session 13; Sessions 9 through 12 remain accurate context for everything before this.

This session's focus: **morning-call verification end-to-end** — started as "check the pickup + AMD fixes deployed in Session 10, not tested", ended with the entire morning-call flow rewritten around async AMD + a voice gate, plus a mobile-app TTS unification.

---

## 0. For the next Claude — read in this order

1. **This file end-to-end.**
2. `../CLAUDE.md` — project rules. Still load-bearing; nothing here overrides them.
3. `docs/SESSION_12_COMPLETE_HANDOFF.md` — website + founder letter + attachment-harvesting proposal. Still the canonical record for positioning.
4. `docs/SESSION_11_COMPLETE_HANDOFF.md` — voice-recording Q&A + Drive folder + keyterm priming. Still the canonical record for inbound voice calls and conversation recording.
5. Memory: the new `project_naavi_morning_call_flow.md` and `project_naavi_next_mobile_build.md`.

---

## 1. The verification that wasn't — what we found

The morning call's **pickup + AMD** fixes from Session 10 (`14225ec`, `b56fb27`, `9a4e47b`, `fb1dfb2`) were deployed but never had live verification. User tried in the morning (08:00 call for Huss, 13:15 for Wael). Reported:
- VM received full morning briefings from Naavi.
- 10 attempts reached, `status` still `pending`.
- Nothing stopped the retries, no "give up" alerts.

Deep investigation over the course of the session unearthed **three compounding bugs** — not just one.

### Bug 1 — AMD's `unknown` classification leaks brief into VM

Twilio's synchronous AMD (`MachineDetection: 'Enable'`) was returning `AnsweredBy=unknown` for Wael's real pickups and `AnsweredBy=human` for some VM pickups (the 08:17 leak). The voice server only treated `machine_*` and `fax` as machine, so `unknown` fell through to brief playback.

**Attempted fix (walked back):** treat `unknown` as machine. Worked for the 08:23 VM leak but caused the 17:30 test to drop Wael's real pickup where he stayed silent and AMD had no audio to classify.

### Bug 2 — `/call-status` never fired, *ever*

This was the load-bearing discovery. The Supabase Edge Function was setting:
```ts
StatusCallbackEvent: 'answered completed',
```
inside a `URLSearchParams({...})` literal. Twilio rejects space-joined multi-event values with Warning 21626: *"Invalid events for callSid: ... invalid statusCallbackEvents answered completed"*. The webhook was silently not subscribed, so Twilio never called the voice server's `/call-status` endpoint. **This meant "mark answered", "count missed attempts", "send alerts at 3", "mark missed at 10" had been dead code for months.** Nobody noticed because `attempts` was still incremented by the dispatcher, and the voice server had recently started writing `status='answered'` directly from `deliverMorningBrief`, so at least successful calls ended up in the right state.

The fix is to `body.append('StatusCallbackEvent', 'answered')` and `body.append('StatusCallbackEvent', 'completed')` as separate form fields.

### Bug 3 — marking answered on `in-progress` with empty AnsweredBy

Once /call-status did start firing, the first attempt always ended up with `status='answered'` and cron skipped all retries. Cause: with async AMD (`DetectMessageEnd`), `AnsweredBy` is empty on the `in-progress` status event (AMD is still running), so `!isMachine` evaluated true and the "mark answered" branch triggered. Fix: `/call-status` now ignores `in-progress` entirely. The voice server is the sole source of truth for `status='answered'`, writing it from `deliverMorningBrief` after the brief is actually played through the gate.

### Bug 4 — `UPDATE_MORNING_CALL` unconditionally cancelled today's call

Setting a new time by voice ("set my morning briefing to 8 a.m.") used to always write `status='answered'` + `last_morning_call_date=today`. This silently cancelled the scheduled call every time the user changed the time. Fixed: only mark answered if the new time has already passed today; otherwise reset to pending with attempts=0.

---

## 2. The new architecture — voice gate + async AMD

The morning-call flow now works like this (canonical document: `memory/project_naavi_morning_call_flow.md`):

1. `trigger-morning-call` (pg_cron, every minute) dispatches outbound calls with:
   - `MachineDetection: 'DetectMessageEnd'` — async, webhook fires immediately.
   - `Url` threaded with `?user_id=...&phone=...` so the voice server has the caller's identity without falling back to `user_tokens`.
   - `StatusCallbackEvent` appended per event, not space-joined.
2. `/outbound-voice` opens a media stream with `callType='morning-brief'`, `userId`, `callerPhone` as stream parameters.
3. In the stream 'start' handler, the voice server plays the **human gate**: *"Good morning {name}, it's Naavi. Say hello to hear your morning briefing."*
4. A 6-second timeout starts **when the prompt finishes playing** (on the `response_end` mark) — not when it starts. Starting on the start loses 4 s to the prompt itself.
5. If any transcript arrives (barge-in interim OR Deepgram FINAL) → `deliverMorningBrief()` runs. The brief is generated, TTS streamed to the caller, and the voice server PATCHes `morning_call_status='answered'`.
6. If 6 s elapses with nothing → the media WebSocket closes → the call ends → `/call-status` sees a terminal event, sees status is NOT yet `answered`, and runs the missed path: bump attempts via dispatcher's existing increment, send alert at attempt 2, send alert + PATCH `status='missed'` at attempt 3.

**Caps (now permanent):**
- Max 3 attempts per day.
- 5-minute interval between retries.
- Alerts at attempts 2 and 3.

**What the voice gate buys us:**
- VM pickups leak only the prompt, never the full brief.
- Real pickups where the user says anything → brief plays.
- Real pickups where the user stays silent → hung up after 6 s, cron retries.

**What AMD buys us now:**
- As a second-line signal in `/call-status` to classify `machine_*/fax/unknown` as machine for attempt-counting — even though the gate is the real gatekeeper.

---

## 3. Mobile-app migration to match voice server (partial — no rebuild required)

After the morning-call work stabilized, the user asked to also align the mobile app with the voice server so both feel like the same Naavi. Three items in scope:

### 3a. TTS voice → Deepgram `aura-hera-en` ✅
The `text-to-speech` Edge Function previously called **OpenAI** with the `shimmer` voice. Rewrote it to call **Deepgram** `aura-hera-en` (same voice as the phone). Returns the same base64-encoded MP3 shape, so the mobile client needed zero changes. DEEPGRAM_API_KEY was already set as a Supabase secret. Verified by Wael on device.

### 3b. MyNaavi Drive folder ✅
Already done in Session 11 (`dd564ec`). Every mobile Drive save goes through the `save-to-drive` EF, which creates/reuses a `MyNaavi` folder under the user's Drive root. Verified live by Wael in this session.

### 3c. Shared Claude prompt ✅
Already wired. `lib/naavi-client.ts` fetches `get-naavi-prompt` EF and falls back to local `buildSystemPrompt` on error. Same pattern as voice server. Confirmed at code level.

### 3d. Known mismatch — hands-free cue voice (needs mobile rebuild)
The hands-free mode's short cues ("I'm listening", "Goodbye Robert", "Tap Resume...") use `expo-speech` — Android's native TTS, not the Deepgram voice. Changing this requires a new AAB. Logged in `memory/project_naavi_next_mobile_build.md`.

---

## 4. Commits pushed this session

### Voice server (`munk2207/naavi-voice-server`, branch `main`)
Ordered, most recent last:

| SHA | Title |
|---|---|
| `d93090d` | morning-call: treat AMD unknown as machine + run give-up on machine completed |
| `6d3bd3c` | voice: don't short-circuit to brief when utterance is a config command |
| `fa6e9f7` | morning-call: async AMD + human-gate prompt before brief |
| `a25ec69` | morning-call: start gate timer on prompt-end, accept barge-in as speech, thread userId from outbound URL |
| `fae5c08` | UPDATE_MORNING_CALL: reset status when new time still ahead today; answered only when it has passed |
| `79d978f` | TEMP: compress retry cap 10 to 3 (test only) |
| `84ec26c` | TEMP: cap at 2 attempts (test only) |
| `80cf8da` | call-status: ignore in-progress; voice server owns answered state |
| `0b98aa0` | morning-call: permanent 3-attempt cap, alerts at 2 and 3 |

Voice server HEAD at session end: **`0b98aa0`**.

### Main repo (`munk2207/naavi-app`, branch `main`)

| SHA | Title |
|---|---|
| `2015553` | TEMP: compress retry interval 5 min to 1 min (test only — reverted) |
| `165f3ec` | trigger-morning-call: append StatusCallbackEvent per event (fix Twilio warning 21626) |
| `ca1c798` | morning-call: permanent 3-cap + 5-min retry interval |
| `495aef6` | text-to-speech: switch from OpenAI shimmer to Deepgram aura-hera-en to match phone voice |

Main repo HEAD at session end: **`495aef6`**. SESSION_13 handoff committed separately after this file.

### Edge Functions deployed to Supabase (project `hhgyppbxgmjrwdpdubcx`)
All with `--no-verify-jwt`.

- `trigger-morning-call` — deployed 3 times during the session as thresholds / AMD / StatusCallbackEvent all changed.
- `text-to-speech` — deployed once (Deepgram switch).

---

## 5. Live verification — what actually worked

1. ✅ Human gate: *"Say hello to hear your morning briefing"* — user said "hello", full brief played, `status='answered'`.
2. ✅ VM decline: picked up then immediately declined → VM answered → gate prompt played into VM → no brief leaked, hangup after 6 s silence.
3. ✅ VM natural ring-out: same as decline.
4. ✅ Missed-call counter: `attempts` climbs 1 → 2 → 3 cleanly.
5. ✅ Alert at attempt 2: SMS + WhatsApp arrived with the "still trying" message.
6. ✅ Alert at attempt 3: SMS + WhatsApp arrived with the "cancelled for today" message, `status` flipped to `missed`.
7. ✅ Voice config command: *"Set my morning briefing to 5:30 p.m."* — time updates, status stays pending if time is still ahead today.
8. ✅ Mobile TTS voice: Wael confirmed mobile replies now sound like the phone (aura-hera-en).
9. ✅ MyNaavi folder: mobile note-save landed in the existing folder.

---

## 6. Open items / not-yet-tested / deferred

### Not built (morning-call)
- **Email the brief text when all attempts fail** — the SMS/WhatsApp only says "call us back", not what today's brief was.
- **Save brief for next day when missed** — planned in SESSION_11, still not built.
- **System-alert SMS wrapper** — current alerts go through `send-sms` using the person-to-person template and read *"Hi there, Robert shared this message with you: ..."*. System alerts should be direct (no wrapper).
- **Push notification verification** — SMS and WhatsApp landed at attempts 2 and 3; push landing on the device was not confirmed in this session.

### Needs next mobile AAB (see `memory/project_naavi_next_mobile_build.md`)
- Hands-free cue voice mismatch (expo-speech vs Deepgram).
- SCHEDULE_MEDICATION retest on device.
- Supabase anon JWT rotation should bundle into this build.

### Still-open from prior sessions
- Attachment harvesting Phase 1 (SESSION_12 proposal) — not started.
- Morning-call catch-up / pending_actions Phase 2 — still designed but not built.
- Rotate Firebase service account key + revoke old GitHub PAT (carryover from Session 10).

---

## 7. What NOT to lose from this session

1. **AMD is not a gate.** Twilio's AMD is heuristic and wrong often enough (unknown, human-misfires on VM) that relying on it for "should we play the brief" leads directly to brief-in-VM leaks or hangups on real humans. The voice gate inside the media stream is the real gatekeeper; AMD is a belt-and-suspenders signal for counting missed attempts.

2. **"It's deployed" doesn't mean "it's working".** The `/call-status` webhook looked completely normal in code for ~6 months — but Twilio Warning 21626 had been silently rejecting its subscription. Always check the Twilio Debugger and HTTP Logs for actual webhook hits, not just "the URL is set".

3. **URLSearchParams joins multi-value fields by space, which Twilio then rejects.** When a Twilio param accepts a list, append each value separately. This applies to StatusCallbackEvent and any other multi-value field.

4. **Status changes should have one writer per call outcome.** Voice server writes `answered` when the gate proves a human; /call-status writes `missed` when attempts cap out. Neither tries to write the state the other owns. When both wrote `answered`, race conditions killed retries.

5. **Sync vs async AMD has UX implications.** Sync AMD adds 4+ s of silent wait before the webhook fires — users hang up. Async AMD fires immediately but means /call-status's first-event AnsweredBy is empty. The gate-in-stream pattern only works with async.

6. **Test ahead of scheduled time, not at it.** The cron checks "currentTime === callTime" for the first attempt. Reset SQL that lands after the target minute means the test slips to the next day. Always set morning_call_time at least 2 minutes ahead of current clock and confirm with a SELECT.

---

## 8. Resume prompt for the next session

```
I am Wael (non-technical founder of MyNaavi). Read these before ANY action:
1. C:\Users\waela\OneDrive\Desktop\Naavi\docs\SESSION_13_COMPLETE_HANDOFF.md (this session)
2. C:\Users\waela\OneDrive\Desktop\Naavi\docs\SESSION_12_COMPLETE_HANDOFF.md (positioning)
3. C:\Users\waela\OneDrive\Desktop\Naavi\docs\SESSION_11_COMPLETE_HANDOFF.md (inbound voice pipeline)
4. C:\Users\waela\OneDrive\Desktop\Naavi\CLAUDE.md
5. Memory: C:\Users\waela\.claude\projects\C--Users-waela-OneDrive-Desktop-Naavi\memory\MEMORY.md
   — specifically project_naavi_morning_call_flow.md and project_naavi_next_mobile_build.md

State at Session 13 end:
- Morning call verified end-to-end: voice gate works, alerts at attempts 2 and 3, status flips to missed at 3.
- Mobile TTS now Deepgram aura-hera-en to match phone (text-to-speech EF switched).
- MyNaavi Drive folder + shared prompt already in place; verified live.
- Morning call is permanent: 3-attempt cap, 5-min retry, 08:00 Toronto for Wael.

Next likely tasks (in user's preference order):
A. New mobile AAB with hands-free cue voice fix + SCHEDULE_MEDICATION retest.
B. Attachment-harvesting Phase 1 (docs/PROPOSAL_ATTACHMENT_HARVESTING.md).
C. Email-the-brief-on-giveup + save-for-tomorrow (not built).

Rules: no action without explicit approval; one step at a time; keep responses short; never assume; trace before changing.
```

---

## 9. Honest gaps in this document

- Push notification delivery was never confirmed by the user for the missed-call alerts at attempts 2 and 3 — SMS and WhatsApp were confirmed, push was asked for and not reported back.
- The final `text-to-speech` EF test was confirmed with "yes" from Wael after one voice exchange on mobile; a deeper test of long responses, accents, and edge cases wasn't done.
- The "answered" PATCH from `deliverMorningBrief` in the voice server fires asynchronously; under network failure it silently fails with a `console.error`. We did not observe this failing, but if it did, /call-status's machine branch would eventually mark the call missed — probably wrong if the brief actually played. Future belt-and-suspenders: voice server should retry the PATCH on failure.
- The `TEMP` commits that compressed thresholds during testing are in git history as normal commits — not flagged as throwaway. Future debuggers reading `git log` may be confused by the sequence of "compress to 3", "compress to 2", then "permanent 3-cap". The permanent commit (`0b98aa0`, `ca1c798`) documents the final state; the intermediates should be understood as test-scaffolding.

---

*End of SESSION_13_COMPLETE_HANDOFF.md — April 17, 2026, late evening.*
