# Session Handoff — 2026-05-03 — Geofence Investigation + Test PC Setup

**Read this first before doing anything geofence-related in the next session.**

## Status at end of session

- **Geofence fix: NOT COMPLETE.** Made progress diagnosing the root cause but the test drive at 2:02 PM EDT still produced zero geofence events. Phone reboot is the immediate next step before any code changes.
- **Build on phone:** V57.10.5 (build 141)
- **Server-side state:** unchanged from session start
- **Test PC (Maestro): NOT STARTED.** Setup doc exists at `docs/MAESTRO_SETUP.docx`. Wael needs to do steps 1-3 (install Android Studio + emulator + Maestro CLI) before we can build the test scenarios.

---

## Next session — THREE priorities

### PRIORITY 1: Geofence reliability fix

**Where we are:** Wael went on a test drive after Samsung battery settings were changed (see below). Drove deep inside Mark's and Gabe's NOFRILLS radii, stayed 3+ minutes each. **Zero events fired.** Diagnostic logs show silence from 17:50 UTC onwards.

**Hypothesis (untested):** Samsung's battery classifier doesn't recompute in real-time. The settings changes we made require a phone REBOOT to fully apply.

**Immediate next step (Wael action):**
1. Reboot phone
2. Open MyNaavi briefly after reboot
3. Drive to Mark's OR Gabe's, stay 3 minutes
4. Report result

**If reboot doesn't fix it:** the cause is upstream of Samsung battery — likely the Expo geofence library bug ([issue #33433](https://github.com/expo/expo/issues/33433) — re-registers on every app foreground, ~19 times in 6h in our diagnostics) or our `useGeofencing.ts` code.

### PRIORITY 2: Voice — caller-identity architecture (Options 2 + 4 combined)

**Where we are:** Today, voice server identifies inbound callers solely by `caller_phone → user_settings.phone` lookup (`naavi-voice-server/src/index.js:437`). If Robert calls from a different phone (lost his, dead battery, calling from spouse/friend), he is rejected with: *"Sorry, this number isn't registered with Naavi. Please ask the account owner to add your phone in Settings, then try again. Goodbye."* (line 3207).

Wael flagged this as a gap: identity should be tied to Robert as a person, not to a specific device. He chose **Options 2 + 4 combined**:

- **Option 2 — Multi-phone fast path:** Robert lists every phone he might call from (his cell, wife's cell, daughter's cell, home landline) in the mobile app. Voice server matches caller ID against any registered phone. Covers ~80% of "alternate phone" scenarios with zero friction.
- **Option 4 — Voice biometric fallback:** For phones not in the registered list (true unknowns: emergency, lost phone, foreign hotel phone), voice server runs voice biometric verification using Azure Speaker Recognition. Robert says *"my voice is my password"* — voice itself is the credential, not the words. Cannot be spoofed by overhearing the phrase. Enrollment happens on first call to Naavi (no AAB needed for the voice biometric itself).

Plus: the rejection message currently uses misleading wording ("isn't registered with Naavi") — there's no registration concept; the phone lives in `user_settings.phone` because the user typed it in the mobile app's Settings. Fix the wording when fixing the architecture.

**Combined flow:**
1. Caller ID matches `user_settings.phone` OR any entry in `user_settings.additional_phones[]` → instant authentication, normal greeting
2. Caller ID does NOT match → voice biometric verification: *"Hi, I don't recognize this number. Please say: my voice is my password."*
3. Azure verifies voice → match → proceed as that user
4. No match → 1 retry, then fall through to demo experience (never just hang up)

**Enrollment flow (first call to Naavi, ever):**
1. *"Hi Robert, welcome. Before we get started, I want to learn your voice so I can recognize you when you call from any phone. Please say: my voice is my password."*
2. Robert says it
3. *"Thanks. Please say it again."*
4. Robert says it
5. *"One more time, please."*
6. Robert says it
7. *"Got it. Your voice is now learned. How can I help you today?"*

**Architectural changes required:**

| Work unit | What | AAB needed? |
|---|---|---|
| **DB schema** | Add `user_settings.additional_phones` (text[]), `user_settings.azure_voice_profile_id` (uuid), `user_settings.voice_enrollment_completed_at` (timestamptz) | No |
| **Azure setup** | Create Azure account, enable Speaker Recognition service, get API keys, store in Supabase secrets | No (Wael does account setup) |
| **Backend Edge Function** | New function for voice profile enroll + verify (proxies to Azure) | No |
| **Voice server** | (a) `getUserIdByPhone` matches against phone AND additional_phones any-match. (b) On first call, run enrollment ritual. (c) On unknown caller, run verification. (d) Fix the misleading rejection wording. | No (server-only) |
| **Mobile app UI for Option 2** | Settings → "My phones" section, list/add/edit/remove additional phone numbers | **Yes** (AAB build) |
| **Privacy/compliance** | Biometric data per GDPR/CCPA: encrypt at rest, retention policy, deletion on user request, privacy policy update | No |

**Effort classification by complexity:**
- DB schema: **Trivial**
- Azure setup: **Low** (mostly account/billing work by Wael)
- Backend Edge Function: **Low**
- Voice server enrollment + verification flow: **Moderate**
- Mobile UI for additional phones: **Low** (form-based UI, similar to existing Settings fields)
- Privacy/compliance: **Low** (mostly documentation + policy update)
- Testing/tuning Azure thresholds: **Moderate** (requires real-world voice samples + iteration)

**Sequence:**
1. Wael sets up Azure account + provides API keys (1 session, mostly his work)
2. DB migration + Edge Function (1 session)
3. Voice server enrollment + verification flow (1-2 sessions)
4. End-to-end test with Wael's real voice (1-2 sessions, may need tuning)
5. Mobile UI for additional phones (1 session + 1 AAB build)
6. Privacy/compliance write-up (0.5 session)

### PRIORITY 3: Test PC (Maestro mobile UI testing)

**Where we are:** Setup doc complete at `docs/MAESTRO_SETUP.docx`. Wael needs to do the user-side setup before we can write test scenarios.

**Wael's setup (3 steps, ~1.5 hours mostly waiting for downloads):**
1. Install Android Studio
2. Create "Naavi-Test" virtual device (Pixel 7, API 34)
3. Install Maestro CLI on PC

**Claude's setup (parallel, ~3-4 hours):**
- Write `e2e/` test scenarios covering bug classes:
  - 5-consecutive-sends (catches RN connection-leak class)
  - Voice-then-typed sequence
  - Sign-in then force-close then reopen
  - Mic record/transcribe
  - Routine: sign in, send message, navigate menus
- Wire up `npm run test:mobile` script

---

## What was done this session — geofence chain

### Real evidence gathered (not theory)

1. **Wael's V57.10.5 phone is correctly registering 12 of 12 enabled location rules** with the OS. Diagnostic confirmed (`syncGeofences-end` shows `registered: 12`).
2. **The OS now wakes the app on geofence events** — 28 `geofence-T1-task-fired` events in the test window. (BEFORE Samsung battery settings change: 0 task fires in 6 hours. So Samsung battery change DID help at the OS level.)
3. **But during the actual 2:02 PM drive: zero events.** The app went silent at 17:50 UTC and stayed silent through the drive.
4. **18 location rules total in `action_rules`** for Wael (12 enabled). Many "never_fired_at = NEVER" despite repeat visits — Movati and home are the only rules that fire reliably.
5. **`client_diagnostics` table is the canonical log** for geofence chain (steps `geofence-T1-task-fired` → `T1-suppressed-phantom` → `T2-about-to-post` → `T3-server-received` → `T4-fanout-done`). The `T4-fanout-done` step has NEVER been observed for a non-Movati rule.

### Samsung battery settings — final state on Wael's phone

| Setting | Value |
|---|---|
| Per-app Battery (Settings → Apps → MyNaavi → Battery) | **Optimized** (changed from Unrestricted) |
| Never auto sleeping apps list | **MyNaavi added** (count went from 12 → 13) |
| Adaptive Battery | **OFF** (was ON) |
| Background location for MyNaavi | **Allow all the time + Use precise location** |
| "Put unused apps to sleep" toggle | Still ON (irrelevant — MyNaavi exempt) |

### Important Samsung quirks discovered

- **The "+Add apps" picker for "Never auto sleeping apps" hides apps that are at "Unrestricted" battery.** You must drop to "Optimized" first to make the app appear in the picker, then add it. (Found by Wael; not in any documentation we located.)
- The "+Add" picker also filters out apps already in Sleeping/Deep Sleeping lists.
- 156 of 341 installed apps are in an uncategorized pool — recently used / actively running. Samsung does not document the exclusion criteria.
- `ACCESS_BACKGROUND_LOCATION` exempts from Android's Restricted standby bucket but **does NOT exempt from Samsung's One UI sleeping system** (definitively researched).

### Paths investigated and definitively eliminated

For arbitrary-place location alerts on a default-configured Samsung phone in 2026:

| Path | Verdict |
|---|---|
| Custom foreground service polling | ❌ Samsung kills it after 3 days idle (dontkillmyapp.com Samsung rated 5/5 worst) |
| Transistorsoft react-native-background-geolocation ($399-999) | ❌ Same Samsung kill issue + multi-year unresolved Samsung GitHub issues |
| Google Calendar + location reminders | ❌ Deprecated; migrated to Tasks which removed location |
| Google Tasks API | ❌ No location field |
| Google Maps Saved Places | ❌ No public API (open issuetracker since 2017) |
| Google Assistant arrival routine | ❌ Wael's phone test: "I can only do time-based" + Assistant sunsetting March 2026 |
| Google Home presence | ❌ Single-address only ("home/away") |
| Google Wallet alone | ⚠️ Reliable trigger BUT Google controls notification text |
| Wallet + NotificationListenerService → Twilio | ❌ NLS dies on Samsung same as foreground service (XDA + KDE Connect + Pushbullet evidence) |
| Google "Hey Google, read my notifications" | ❌ Wael's phone test: "I cannot read messages on this device" |
| TalkBack as audio fallback | ❌ Too disruptive — changes every gesture, not viable for non-blind primary user |

### The honest residual technical gap

Even with Samsung battery exemptions correctly set:
- **Expo's geofence library has a known unresolved bug** ([#33433](https://github.com/expo/expo/issues/33433)) — re-registers on every app foreground, which Google's GeofencingClient may throttle. We re-registered 19 times in a single 6-hour window.
- Android's native geofence API has 2-6 minute documented latency.
- Movati fires reliably; 9+ other rules never fire, despite identical config. **No code-level explanation found** in the investigator agent's trace.

The next session should explore: is the Expo bug the actual root cause once Samsung is no longer interfering?

---

## Files created this session

- `docs/SESSION_HANDOFF_2026-05-03_GEOFENCE_INVESTIGATION.md` — this file
- `docs/MAESTRO_SETUP.docx` — Maestro test infrastructure setup guide
- `scripts/diag-drive-1003.js` — diagnostic script for action_rules + action_rule_log queries
- `scripts/diag-schema.js` — schema discovery script (one-shot, can delete)
- `scripts/diag-check-clientlogs.js` — table existence checker (one-shot, can delete)
- `scripts/diag-geofence-trace.js` — pulls last 6h of client_diagnostics + groups by step
- `scripts/diag-drive-202.js` — pulls events from a specific time window (parameterize for next test)

The four `diag-*.js` scripts are useful — keep them. The two one-shot ones (`diag-schema.js`, `diag-check-clientlogs.js`) can be deleted in cleanup.

---

## What NOT to do in the next session

- **Don't propose more "fix this OS-level issue with code" theories without evidence.** This session burned a lot of time on unproven hypotheses. Always pull `client_diagnostics` first to see what actually happened.
- **Don't recommend the Wallet path again.** Researched and eliminated — it requires user interaction (tap) and the audio fallbacks ("Hey Google, read my notifications") don't work on Wael's device.
- **Don't recommend buying Transistorsoft.** Same Samsung kill issue + open multi-year GitHub issues.
- **Don't propose dropping the location feature.** Wael was clear: "Dropping the challenge is not a solution."
- **Don't recommend pausing for the day or based on time** (Rule 11). Recommendations on technical scope only.

---

## Open questions for Wael (deferred)

1. After reboot + retest, if geofences STILL don't fire, is he willing to investigate replacing the Expo geofence library with Transistorsoft? (Even with the Samsung kill issue, it might be more reliable when Samsung is exempted.)
2. The premature "home arrival" fire that triggered while driving toward the garage yesterday — separate bug (likely radius too large or Google's enter-detection firing early). Address after the basic "fires when I actually arrive" works.
3. Whether the AAB build pipeline needs to bump for any code changes proposed by next session.
4. **Demo line "ask name + confirm" feature** — agreed in principle this session but not coded. Demo greeting should change from hardcoded *"Hi, this is Nah-vee. You've reached the public demo line..."* to: *"Hi, this is Naavi. May I have your name?"* → caller responds → *"I heard [name]. Is that right?"* → caller confirms → name stored in call session and threaded into prompt for every turn. Real line still pulls from `user_settings.name`. This is a small voice-server-only change (~half-day work, no AAB needed). Coordinate with PRIORITY 2 work since both touch the voice greeting path — may want to bundle.

---

## Last successful work shipped this session

None — purely investigation. No code changes deployed. No builds bumped.

**Versions on phones:**
- Wael: V57.10.5 (build 141)
- "Robert": V56.6 (build 115) — do NOT promote V57.x until geofence is solved

---

## Where to start the next session

1. Read this handoff in full
2. Read `CLAUDE.md` (project rules — especially Rule 8 "no trial and error" and Rule 11 "no time-based recommendations")
3. Check if Wael has rebooted his phone and re-tested. If yes, run `node scripts/diag-drive-202.js` (update the timestamp) to see what fired.
4. If still nothing fired post-reboot, the next investigation is the **Expo geofence library bug ([#33433](https://github.com/expo/expo/issues/33433))** — see if there's a workaround or if migrating to a different library is necessary.
5. In parallel: check whether Wael completed Maestro setup steps 1-3. If yes, start writing `e2e/` test scenarios.
