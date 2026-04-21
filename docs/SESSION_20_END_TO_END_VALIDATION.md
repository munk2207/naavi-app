# Session 20 — End-to-end test and validation handoff

**Dates:** 2026-04-20 → 2026-04-21 (spanned ~30 hours of work)
**Primary builds:** V54.0 build 101 → V54.1 build 102 → **V54.2 build 103 (current, installed on phone)**
**Closing state:** every test from the session's plan passed on the user's end; two bugs remain open and are deferred to a voice-server session.

Session 21 focus (agreed): **end-to-end test and validation** — the framework, tooling, and regression discipline that Session 20 exposed the need for.

---

## 1. What shipped in Session 20

### New trigger types (beyond the original email / time / calendar)

| Trigger | Example phrase | Ship state |
|---|---|---|
| `weather` | *"Text me at 7 AM if rain is forecast tomorrow"* | ✅ shipped, natural-language verified |
| `contact_silence` | *"Tell me if Sarah hasn't emailed in 30 days"* | ✅ shipped, natural-language verified |
| `location` | *"Alert me when I arrive at Costco Merivale"* | ✅ server shipped, mobile shipped (V54.2 build 103), verified-address flow proven |
| `list_change` | *"Alert me when the grocery list hits 10 items"* | ⏸ deferred — 7 design questions logged in `project_naavi_list_change_trigger_deferred.md` |

### Alert fan-out (major reliability lift)

- Self-alerts (recipient matches user's own phone or email) fan out to **SMS + WhatsApp + Email + Push** in parallel.
- Third-party alerts targeting a phone number fan to SMS + WhatsApp.
- Third-party alerts targeting an email stay single-channel.
- Rationale + phrasings saved to [project_naavi_alert_fanout.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_alert_fanout.md).

### Context-aware alerts

- Every alert rule can carry an optional `tasks: string[]` (inline one-off reminders) and `list_name: string` (dynamic list reference resolved at fire time).
- Shared helper `supabase/functions/_shared/alert_body.ts::buildAlertBody()` applied to every trigger type, so *"Alert me at Costco with my grocery list"* works across weather / contact_silence / location / time / calendar rules without per-trigger code.
- Tested end-to-end on V54.1: tasks + list items both delivered via SMS + WhatsApp + Email + Push.

### Verified-address flow (location trigger's UX core)

A strict promise: **Naavi never creates a location alert from a guessed address.** Implementation:

- `resolve-place` Edge Function rewritten with three tiers:
  1. Personal keyword (`home` / `office` / `work` / etc.) → user_settings address
  2. `user_places` cache (previously confirmed) → instant reuse
  3. Fresh Google Places lookup biased by reference coords → must be user-confirmed
- Mobile orchestrator intercepts `SET_ACTION_RULE` for `trigger_type='location'`, calls resolve-place, branches on status:
  - `memory` / `settings_*` → insert immediately, reply includes *"from your saved locations"* or *"from Settings"*
  - `fresh` → stores pending state, reads address back, waits for *"yes"*
  - `not_found` → pending state with 3-attempt clarification cap; after 3 failures: *"Please check the exact location and call me back."*
  - `personal_unset` → *"Please add your home/work address in Settings first."*
- Confirmation saves to memory under **two aliases** (spoken name + canonical name) for future natural-language matching.

Full design locked in [project_naavi_location_verified_address.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_location_verified_address.md).

### Mobile side: `useGeofencing` + OS-level background geofencing

- New hook `hooks/useGeofencing.ts` owns registration lifecycle.
- Module-level `TaskManager.defineTask` handles OS-delivered geofence events (survives app kill).
- Three-event re-sync: auth change → foreground → after every background fire.
- Layer 1 (wipe-on-auth-change) + Layer 2 (user-id match at fire time) multi-user safety.
- DWELL mapping for `arrive` / `inside` directions; EXIT for `leave`.

### Voice-loss bug — root-caused and fixed

Symptom on V54.1 build 102: voice playback stops working mid-session; only force logout/login restored it.

Diagnosis: Supabase client on React Native was created without storage options. Session lived in memory only; auto-refresh timer died on backgrounding; after ~1h JWT expired silently; every `supabase.functions.invoke()` began failing — including `text-to-speech`. The user perceived this as "lost voice" because the TTS fallback (expo-speech) also didn't recover.

Fix in V54.2 build 103 (`lib/supabase.ts`):
- AsyncStorage as persistent session store.
- `autoRefreshToken: true` + `persistSession: true` explicit.
- AppState listener that calls `supabase.auth.startAutoRefresh()` on every foreground.

This also fixed silent failures across location rules, weather triggers, and any other Edge Function the mobile app invokes — same root cause.

### Global Search polish

- `reminders` adapter confirmed live (the "last gap" from Session 19).
- Contacts adapter now returns `url` field (`tel:` for phone / `mailto:` for email) so contact cards are tappable instead of disabled.
- Mobile UI: "N more in {source}" converted from static text to expand/collapse TouchableOpacity.

### UX polish

- Pending-state replies list valid options and a tries-left countdown (*"Say yes to set the alert, cancel to skip, or give me a different area. (2 tries left.)"*).
- Fresh-command detection drops stuck pending state when user sends a new *"alert me…"* command (fixes the V54.1 concatenation bug).
- Button labels: "Record" → "Meet", "Send" button uses `adjustsFontSizeToFit` to prevent "Sen" clipping.
- Clarification hard-cap of 2 turns in the prompt — Naavi stops asking after 2 vague answers instead of looping forever.

### Prompt version

Current: `2026-04-21-v13-location-clarify-cap` (deployed).

---

## 2. End-to-end test results

Every test below was executed by the user on the actual phone with their real Google account and live Supabase data. "Pass" means the user confirmed from their end.

| # | Test | Channel | Result |
|---|---|---|---|
| A | Settings UI — home/work address fields render | text UI | ✅ pass |
| B | Save home address to `user_settings` | text UI | ✅ pass |
| C | *"Alert me when I arrive home"* → uses Settings address, reply contains *"from Settings"* | text | ✅ pass (after enabling Geocoding API + rotating API key) |
| C' | Same for *"my office"* | text | ✅ pass |
| D | *"Alert me when I arrive at Costco"* → Naavi asks *"Which Costco?"* | text | ✅ pass (Claude-driven disambiguation) |
| E | 3-attempt clarification cap — fake place 3×, Naavi says "call me back" | text | ✅ pass |
| F | *"Alert me when I arrive at 1280 Merivale Road, Ottawa"* → readback + yes → cached under two aliases | text | ✅ pass |
| G | Fresh command during stuck pending state → dropped cleanly, new command handled | text | ✅ pass |
| H | Pending-state phrasing lists options + tries-left | text | ✅ pass |
| I | Contact card tap → dial / email | text | ✅ pass |
| J | "N more" expand/collapse on Global Search results | text | ✅ pass |
| K | Button labels (Meet / Send) visible and correct | visual | ✅ pass |

**Commands tested end-to-end (weather + contact_silence + context fields + fan-out)**: all fired SMS + WhatsApp + Email + Push correctly. Verified in Twilio console (delivered status) and inbox.

---

## 3. Known bugs — deferred to dedicated sessions

| Bug | Memory file | Scope | Planned session |
|---|---|---|---|
| Voice name search fails while text works | [project_naavi_voice_name_search.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_voice_name_search.md) | Voice server (Deepgram STT mangling proper nouns) | Voice-server focused session |
| Mobile chat text response cut off (e.g. *"Nothing stored on"* missing the name) | [project_naavi_next_mobile_build.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_next_mobile_build.md) item #1 | Mobile — `isBroadQuery` regex or `buildFallback` in naavi-client.ts | Session 21 or 22 |
| Voice stop-word regression (*"Naavi stop"* no longer interrupts TTS) | [project_naavi_stop_word_regression.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_stop_word_regression.md) | Voice server | Voice session |
| Voice first-word truncation | [project_naavi_deepgram_first_word_truncation.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_deepgram_first_word_truncation.md) | Voice server | Voice session |
| Voice privacy UX (4-piece feature, not started) | [project_naavi_voice_privacy.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_voice_privacy.md) | Voice server + mobile | Its own session |

---

## 4. Validation approach for Session 21

### What Claude CAN do in E2E validation

1. **Guided test execution** — numbered step-by-step scripts; user executes; Claude tracks pass/fail.
2. **Server-side automation** — direct curl/Bash against Edge Functions; proves server path independent of mobile.
3. **Log analysis from screenshots** — Supabase Edge Function logs, Twilio logs; diagnose to exact line.
4. **SQL-based state assertions** — post-test queries that verify the database changed correctly.
5. **Synthetic test data** — SQL inserts simulating conditions (pending rules, stale cache, specific timezones).
6. **Long-running process monitoring** — Monitor tool for EAS builds, cron ticks, etc.
7. **Regression checklists** — standard pre-ship smoke sheet.
8. **Parallel diagnosis** — sub-agents for multi-file failure traces.
9. **Fix-and-redeploy loop** — patch → deploy Edge Function → user retests in under a minute.
10. **Memory of prior test runs** — carry-forward history so Session 22 starts informed.

### What Claude CANNOT do

1. Control the phone remotely (no ADB, emulator, device automation).
2. Hear Naavi's voice / capture audio output.
3. Simulate geofence crossings without real physical movement OR manual state insertion.
4. See UI without screenshots.
5. Validate hour-long timing flows without user's phone awake.
6. Test multi-user flows concurrently (one sign-in at a time).

### The productive hybrid pattern

| Step | Who | What |
|---|---|---|
| 1 | Claude | Design test plan (features × channels × scenarios) |
| 2 | Claude | Server-side curl + SQL harness for non-mobile paths |
| 3 | Claude | Numbered test sheet for user |
| 4 | User | Execute one test at a time, report back |
| 5 | Claude | Pass → mark; fail → fetch logs, diagnose, propose fix |
| 6 | Both | Server-side fix: deploy, user retests |
| 7 | Both | Mobile fix: queue for next AAB |
| 8 | Claude | Maintain regression matrix across sessions |

---

## 5. Recommended Session 21 agenda

1. **E2E test matrix** — all 15 orchestration commands × 3 channels (mobile text, mobile voice, phone call) as a tracked spreadsheet. Clear "tested today" vs "never tested" vs "known broken" columns.
2. **Pre-ship smoke checklist** — 10-test 5-minute sheet the user runs on every new AAB before uploading to Internal Testing.
3. **Server-only Node.js harness** — curl/invoke every Edge Function with canned inputs, assert against known-good responses. Automatable; runs in seconds; catches regressions in Edge Function changes.
4. **Voice + text parity tester** — prove that for each feature, both input channels produce the same DB side-effect (rule inserted, cache written, etc.).
5. **Bug triage workflow** — when a test fails, documented diagnostic path (which log first, which SQL, common fix patterns).
6. **Fix items from this session's deferred list** (voice name search, response truncation) if time.

---

## 6. Build + deployment state (as of close)

- **On phone:** V54.2 build 103 (rolled out via Internal Testing).
- **Main repo HEAD:** `74b27b9` on `main`, pushed to `origin/main`.
- **Build clone (`C:\Users\waela\naavi-mobile`):** synced to `origin/main`.
- **Edge Functions deployed (recent changes):** `resolve-place` v6, `get-naavi-prompt` v20, `global-search` v27, `evaluate-rules` v19, `check-reminders` v30, `report-location-event` v5.
- **Uncommitted:** only local state (`.claude/settings.local.json`, `supabase/.temp/*`) and the separate `naavi-voice-server` repo. No code drift.
- **Migrations applied:**
  - `20260420_action_rules_weather.sql`
  - `20260421_action_rules_contact_silence.sql`
  - `20260421_action_rules_location.sql` (+ user_places table)
  - `20260421_user_settings_addresses.sql` (home_address + work_address columns)
- **Supabase secrets:** `GOOGLE_PLACES_API_KEY` set; Google Cloud project `naavi-490516` has both Places API and Geocoding API enabled; API key rotated on 2026-04-21 (old key was cached by Google with REQUEST_DENIED for Geocoding).

---

## 7. Memory files that matter for Session 21

The ones a new Claude session should read first to continue without re-asking:

- [project_naavi_location_verified_address.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_location_verified_address.md) — the core UX rule for location alerts.
- [project_naavi_alert_fanout.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_alert_fanout.md) — self-alert = all 4 channels.
- [project_naavi_alert_context_fields.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_alert_context_fields.md) — tasks + list_name universal pattern.
- [project_naavi_location_trigger_plan.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_location_trigger_plan.md) — 6-phase location plan; Phase 2 shipped, Phase 3+ remaining.
- [project_naavi_next_mobile_build.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_next_mobile_build.md) — open items needing the next AAB.
- [project_naavi_mobile_tts_loss.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/project_naavi_mobile_tts_loss.md) — voice-loss root cause (now fixed; kept for reference).
- [feedback_test_passes_user_end.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/feedback_test_passes_user_end.md) — test verdict discipline.
- [feedback_expose_options_in_constrained_states.md](../../../.claude/projects/C--Users-waela-OneDrive-Desktop-Naavi/memory/feedback_expose_options_in_constrained_states.md) — UX rule for pending states.

CLAUDE.md at the repo root has **Rule 11** (no clock-based stopping recommendations) and the **ALERT FAN-OUT** section under the rule store.

---

## 8. Docs produced this session

- [docs/NAAVI_ORCHESTRATION_DEMO.md](NAAVI_ORCHESTRATION_DEMO.md) + `.docx` — 15 multi-plug commands + 4 extended scenarios (dialog-formatted) for a stakeholder-friendly product demo sheet.
- [docs/NAAVI_CLIENT_ONBOARDING.md](NAAVI_CLIENT_ONBOARDING.md) + `.docx` — private-preview welcome letter for beta testers.
- This file — Session 20 end-to-end test and validation handoff.

Generator scripts: `build_orchestration_demo_docx.js`, `build_client_onboarding_docx.js`. `.docx` files are `.gitignore`d; regenerate with `node build_*.js`.

---

## 9. Session 21 kickoff message suggestion

For the next session, open with:

> *"Session 21 focus: end-to-end test and validation. Read SESSION_20_END_TO_END_VALIDATION.md and any memory file in its §7 list, then propose the E2E test matrix from §5 item 1 as the first deliverable."*

That single sentence puts the next Claude in the right state to produce the E2E matrix without backtracking.
