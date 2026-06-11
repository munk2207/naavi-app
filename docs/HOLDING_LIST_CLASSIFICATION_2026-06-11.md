# Holding List Classification — 2026-05-08

Research-and-planning session output. Walks the 26-item holding list from `docs/SESSION_HANDOFF_2026-05-07_V57.13.7_BUILD_165.md` and classifies each item.

## Classification scheme

Four lists, each with the same column shape (`ID | Description | Surface | Notes | Server/AAB`):

- **Bugs (B)** — broken or incomplete behavior on a user-facing surface
- **Features (F)** — new user-facing capabilities
- **Tooling (T)** — internal dev / test / measurement infrastructure
- **Ideas (I)** — brainstorming-stage entries; deferred-by-design or path-not-chosen items not yet committed as real features

**Severity** — encoded in the ID: 1 = top, 2 = medium, 3 = low. Letter suffix (`a`, `b`, `c`…) disambiguates within a severity tier (e.g., B1a, B1b, B1c are all top-severity bugs).

**Server/AAB** — where the work lands:
- `Server` — Edge Function, SQL, voice server, web; no AAB build required
- `AAB` — mobile code; requires `npx eas build --auto-submit`
- `Both` — server + mobile pieces

**Surface** — which user-facing surface owns the work; used for cross-surface drift discipline (see CLAUDE.md Rule 16). Values:
- `mobile` — work lands on mobile codebase only; no voice change required
- `voice` — work lands on voice-server codebase only; no mobile change required
- `both` — both surfaces; parity required (when one ships, the other must follow before drift)
- `backend` — shared backend (Edge Functions / SQL); both surfaces benefit automatically
- `website` — `mynaavi-website` repo only; neither mobile nor voice

**Architectural principle (Wael 2026-05-08):** every queryable channel = background sync at per-channel depth + live-overlay at question-time. Applies to calendar, email, SMS, WhatsApp.

**Cross-surface drift mechanism:** classification's `Surface` tag is best-effort interim discipline. The mechanical guarantee comes from Voice Completion Roadmap W2 (Anthropic Structured Outputs) + W3 (Voice Automated Regression Suite) — see `docs/VOICE_COMPLETION_ROADMAP_2026-05-08.docx`. Until W2 + W3 land, Surface column + CLAUDE.md Rule 16 (`parity-impact:` on commits) are the human-discipline net.

---

## Bugs (B) — OPEN

| ID      | Description                                                                                                      | Surface | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Server/AAB            | Status                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------- |
| **B6a** | **Voice parity gap — voice server does not re-arm expired location alerts (mobile fixed)**                       | voice   | **Mobile half CLOSED 2026-06-10 (fix committed `318e522`; ships with next AAB).** Voice server does NOT have the re-arm fix. On voice, when a caller says *"Alert me when I arrive at Movati Athletic"*, the picker shows all locations including the already-active/expired one (no dedup), the caller picks one, a NEW alert is created instead of reactivating the existing one, and the new alert lands with missing address/coordinates (see B6g). **Fix path:** port `reArmLocationRule` logic into `naavi-voice-server/src/index.js` SET_ACTION_RULE handler.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Server (voice)        | open — voice parity gap                                               |
| B6g     | Voice location alert created via picker lands with missing address/coordinates — geofence never arms             | voice   | **Discovered 2026-06-10 by Wael during voice testing.** When a caller says *"Alert me when I arrive at Costco"*, the location picker shows all candidates including already-active ones (no dedup). When the caller picks one, a new `action_rules` row is created but lands without address details or coordinates — the geofence never registers with the OS so the alert never fires. Three distinct symptoms: (1) active/expired alert not recognized — picker shows it as fresh; (2) picking creates a duplicate new rule instead of reactivating; (3) the new rule is incomplete (missing lat/lng/address). Root cause: voice server `SET_ACTION_RULE` handler does not call `resolve-place` to obtain coordinates before writing the row, and has no equivalent of the mobile `reArmLocationRule` helper. Paired with B6a voice parity gap. **Fix path:** port `reArmLocationRule` logic + resolve-place coordinate lookup into `naavi-voice-server/src/index.js` SET_ACTION_RULE handler for `trigger_type='location'`. | Server                | open (discovered 2026-06-10; voice-only; paired with B6a)             |
| B6h     | ⭐ TRUST BREACH — DELETE_RULE says "Done" but alert is not deleted + no disambiguation when multiple alerts match | mobile  | **Discovered 2026-06-10 by Wael. Live evidence (mobile chat, 8:29–8:30 AM EST):** Wael said *"Delete Canadian tires alert."* Naavi asked for confirmation (correct). Wael said *"Yes."* Naavi replied *"Done — deleted your Canadian Tire arrival alert."* — but the Canadian Tire alert remained visible in the Alerts screen. **Two violations:** (1) **Silent failure** — Naavi said "Done" but the `action_rules` row was NOT deleted. Speech contradicted DB state — direct trust breach per CLAUDE.md Rule 21. (2) **No disambiguation** — user has 10 location alerts; Naavi should ask *"Which one — Canadian Tire at 391...?"* before confirming. **Fix path:** (a) DELETE_RULE handler in `hooks/useOrchestrator.ts` must verify the row was actually deleted (check affected rows count) and surface an error if not; (b) when DELETE_RULE intent matches multiple rules by name, Naavi must present the list and ask the user to pick before executing.                                                             | AAB + Server (prompt) | open — CRITICAL (discovered 2026-06-10; trust breach; silent failure) |
| B6i     | Naavi executes state-changing actions without asking the user to confirm first                                   | both    | **Root cause identified 2026-05-24, tracked separately from B4y 2026-06-10.** The gate is inconsistent — not all state-changing actions go through the same confirm-then-act flow. **Actions that must ALWAYS confirm before executing:** DELETE_RULE, DELETE_EVENT, DELETE_MEMORY, CREATE_EVENT, SCHEDULE_MEDICATION, UPDATE_MORNING_CALL, SET_REMINDER, SET_ACTION_RULE (non-email), REMEMBER, ADD_CONTACT, LIST_CREATE, LIST_DELETE, LOG_CONCERN, UPDATE_PROFILE. **What must happen:** (1) Naavi states the exact action; (2) waits for user yes/confirm; (3) executes; (4) reads back what was actually done. **Fix path:** universal server-side confirm gate in `naavi-chat` + voice server; prompt rule for specific post-action readback; ~40-120 test rewrites to match the 2-turn confirm pattern. ~3-5 hour dedicated session.                                                                                                                                                                                      | Both                  | open — dedicated session required                                     |
| B7a     | Duplicate `client_diagnostics` log events — every DB log event fires in pairs                                    | mobile  | **Discovered 2026-06-01 during drive test (SESSION_HANDOFF_2026-06-01_BUILD223_WEBVIEW_REVERTED.md).** Every log event in `client_diagnostics` fires twice at the same millisecond — two `isCalendarConnected-start`, two `app-state-change`, two `home-foreground-recheck` entries per trigger. Not yet diagnosed. **Likely cause:** two AppState listeners registered simultaneously, OR two React Native root component instances mounted. **Impact:** `client_diagnostics` data is polluted — every query returns double counts, making geofence health-check cron (B4o) and any future diagnostics unreliable. May also cause double geofence sync calls. **Fix path:** audit AppState listener registration in `hooks/useGeofencing.ts` and `app/_layout.tsx` — confirm listeners are registered once and cleaned up on unmount. Add a guard to `logClientDiagnostic` to deduplicate writes within a 100ms window as a backstop.                                                                                          | AAB                   | open (discovered 2026-06-01; undiagnosed)                             |
| B7b     | Voice bare-name transcription loss — Deepgram drops leading verb, falls through to hallucination                 | voice   | **Discovered 2026-06-07 during voice testing (SESSION_HANDOFF_2026-06-07_BUILD238_PHONE_OPERATOR.md).** When user says *"find Fatma"*, Deepgram STT transcribes *"Fatima."* — the verb "find" is dropped and only the (mis-transcribed) name is returned. The voice server's intent detection sees a bare name with no verb and falls through to Claude, which hallucinates a contact instead of routing to the phone-operator confirmation flow. **Fix path:** add a bare-name intercept in `naavi-voice-server/src/index.js` — when STT returns a single-token result that matches a name pattern (no verb, no question word), route directly to phone-operator confirmation flow ("Did you mean to call or find [name]?") instead of calling Claude. Pairs with F5a (picker robustness).                                                                                                                                                                                                                                     | Server                | open (discovered 2026-06-07)                                          |
| B7c     | Homepage storyboard iframes not running                                                                          | website | **Discovered 2026-06-09 by Wael (SESSION_HANDOFF_2026-06-09_BUILD241_BLOG_REFRESH.md).** Wael reported *"the video did not run"* for the homepage demo storyboard iframes. Not investigated. Affected iframes (to verify): notes, brakes, granddaughter, doctor, insurance scenarios. **Fix path:** investigate which iframe(s) are broken — check if the storyboard HTML files in `mynaavi-website/` are missing, have incorrect paths, or have a JS error preventing playback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Server (website)      | open (discovered 2026-06-09; uninvestigated)                          |

---

## Features (F) — OPEN

| ID | Description | Surface | Notes | Server/AAB | Status |
|----|-------------|---------|-------|------------|--------|
| F2a | Onboarding Review (multi-phone + 7 other gaps) | mobile | Onboarding doc + Settings UI covering 8 gaps (multi-phone setup, voice keyterms capture at setup, quiet hours field, verified-address expectation, consolidated privacy callout, post-install rehearsal with starter prompts, re-install / new-phone flow, first-week-vs-week-two expectation calibration). Postponed 2026-05-09 — not all 8 have crisp product decisions; needs a dedicated session looking at onboarding end-to-end. Settings UI changes require AAB; doc is a build-script regen. | Both | open (postponed) |
| F2b | Demo line maturity (richer scenarios + conversion path + telemetry) | voice | Demo phone line gets richer scenarios, a conversion path back to a real account, and telemetry to see what works. Postponed 2026-05-09 — marketing/growth decisions need a focused session. Three sub-pieces in sequence: telemetry first (total calls, scenario popularity, opt-in rate, signup conversion), conversion attribution second (per-call token in the SMS link), scenario richness third (medication scheduling, navigation, recurring delegation, variable data, light branching). Already shipped: 5 canned scenarios, name capture, personalized SMS recap. | Server | open (postponed) |
| F5a | Picker robustness on voice (multi-option scenarios) | voice | V57.13.3 no-cache architecture surfaces a Google picker on every "alert me at X". Voice STT for picker responses ("the second one" / "the Innes Road one" / "two" / barge-in mid-list) is the gate. Caller can't reliably pick from a 3-option list because STT either misses the digit, hears the wrong street name, or interrupts the list. Fix: pre-train picker-response grammar + tighter speech-end detection + structured "say one, two, or three" prompts. **Additional behavior confirmed 2026-06-10 (Wael):** (1) picker reads all candidate locations including any already-active/expired alert — does not filter existing alerts out; (2) when caller picks from the list, a new alert is created without address details or coordinates (geofence never arms). This overlaps with B6g; F5a covers the picker UX fix, B6g covers the missing-coordinates data fix. | Server | open |
| F5b | Self-cleansing memory on voice | voice | STT mistranscriptions create malformed entries — one "Hussein" can become three knowledge_fragments rows under "Houssain", "Hussein", "Hoosein". Fix: phonetic-merge on read (Soundex / Metaphone variant matching) + detect-and-flag malformed memory at fetch time. **POSTPONED 2026-06-10 (Wael) — needs design decision first.** The `knowledge_fragments` table stores free-text with no structured slot/key column. Schema redesign (adding a structured `slot` column at write time) or Claude-judges-at-read-time are the only viable paths. Design decision required before any code. | Server | postponed — design decision required |
| F6a | Mini AI-triage support system — two gaps remaining | server | **Core ticket system + staff portal (staff.mynaavi.com) fully built and working** — OTP login, ticket view, reply, close flow, Claude-drafted responses, interleaved thread view. **Two gaps remaining before F6a is fully done:** (1) **Auto-tester coverage** — no tests exist in `tests/` for ticket creation, CREATE_TICKET bypass, or staff OTP flow; violates Rule 15a; (2) **Staffer admin** — adding a new staffer currently requires running a SQL INSERT in the Supabase Dashboard; no UI or Edge Function exists for staffer management. | Server | open — two gaps remaining: auto-tester coverage + staffer admin UI |

---

## Tooling (T) — OPEN

| ID | Description | Surface | Notes | Server/AAB | Status |
|----|-------------|---------|-------|------------|--------|
| T2a | Maestro full-suite mobile UI test coverage | mobile | Mobile UI test suite — 13 scenarios. Smoke passes. Full suite 2026-05-08: 6 pass, 7 fail. Failures look like a mix of stale assertions (UI labels renamed since test was written) and real regressions. Triage required before the suite becomes a pre-build gate. Real blocker: Maestro dadb driver times out on port 7001 on Windows (confirmed 2026-05-29). | AAB | open (triage of 7 failing scenarios required) |
| T2b | Phase 2 demo data (Gmail seeding for mynaavidemo) | backend | Demo-data seeding for the demo account — Phase 1 (calendar) shipped; Phase 2 (Gmail) gap. Use cases: mobile-app demo recordings without personal data, deterministic backing for the Maestro spend-summary scenario, and future un-canning of the demo phone line. ~30 min to add and run the seed. | Server | open |
| T3c | Voice automated regression suite (W3 from Voice Completion Roadmap) | voice | Voice surface has no automated regression coverage today. W3 from `docs/VOICE_COMPLETION_ROADMAP_2026-05-08.docx` defines the suite. Pairs with T1a (Structured Outputs convergence) — both together close the cross-surface drift gap that Rule 16's `parity-impact:` discipline currently fills manually. | Server | open |
| T4b | Refreshed Parity Baseline audit (W0 from Voice Completion Roadmap) | docs | The mobile-vs-phone audit (`docs/MOBILE_VS_PHONE_AUDIT_2026-05-04`) is stale and predates V57.12 / V57.13 / V57.15.x / canned demo / Structured Outputs. W0 from the Voice Completion Roadmap defines a refresh: action coverage, prompt context comparison, backstop coverage, knowledge access parity, TTS normalization deltas, latency baseline. Produces a current-dated audit doc. ~1 focused session. | Server | open |
| T4c | Soft-tick presence audit on voice | voice infra | Soft-tick thinking sound must play in every silent gap during a call — including during the ~1s Google Places fetch on every "alert me at X". Today there's no systematic audit of every silent moment; some new code paths may have re-introduced silence. ~30 min audit + targeted fixes per gap found. | Server | open |

---

## Architecture (ARCH) — OPEN

| ID | Description | Surface | Notes | Server/AAB | Status |
|----|-------------|---------|-------|------------|--------|
| ARCH-1 | Deterministic-first architecture — Layer 2 intent gate | backend | **Design decided 2026-05-29.** Three-layer model: (1) Pre-Claude bypass for known intents (Layer 1 — B6e pattern, already proven); (2) Intent verification gate — Claude classifies intent into structured object {type, confidence, params}, server routes: high confidence + handler → deterministic execution, low confidence → ask Robert to confirm, out of scope → honest-out (Layer 2 — not yet built); (3) Path B transparent best-effort — when no deterministic handler exists, Naavi explicitly tells Robert "I can't give you a verified answer, here is my best understanding…" then Claude runs. **Prerequisites before coding:** define complete intent taxonomy. **Scope:** ~3-5 hour dedicated session. Do NOT start during pre-AAB build sessions. | Both | open — dedicated session required |

---

## Ideas (I) — Deferred

| ID | Description | Surface | Notes | Server/AAB | Status |
|----|-------------|---------|-------|------------|--------|
| I2a | `list_change` alert trigger | backend | Alert when a list changes — e.g., *"alert when grocery list hits 10 items"* or *"alert when to-do is empty."* Deferred — 7 design questions open with stub answers (third-party routing, threshold semantics, etc.). ~½ session design + ½ session build. | Server | deferred (design questions open) |
| I2b | `price` alert trigger | backend | Alert when a price drops — flight, retail item, gas. Deferred — external integration path not chosen (scraping fragility, paid-API costs, vertical fragmentation across flights / hotels / retail / gas). Path-selection decision is a focused session; build is real engineering after that. | Both | deferred (path-selection open) |
| I3a | `health` alert trigger (Epic / wearable integration) | backend | Alert when a health metric changes — *"alert me if my pulse is above 120"*, *"text my wife if BP > 180"*. Blocked — Epic FHIR account, healthcare-data agreement, privacy review, and wearable SDK integration are multi-month wall-clock prereqs. | Both | blocked (multi-month prereqs) |

---

---

# CLOSED ITEMS

All items confirmed done. Moved here to keep active tables clean.

---

## Closed Bugs (B)

| ID | Description | Surface | Closed | Reason |
|----|-------------|---------|--------|--------|
| B4v | Naavi rejects user location pick with "closer to you" — intermittent | mobile/server | 2026-06-11 | Cannot be reproduced. Confirmed 2026-05-23 and again 2026-06-11. The phrase is not hardcoded — was Claude generating it editorially. No recurrence since. Reopen if it surfaces again with a captured transcript. |
| B2a | Voice promises to schedule medication but doesn't create the events | voice | 2026-05-19 | Confirmed fixed in prior session; voice now creates calendar events for medication scheduling. |
| B2b | You can't interrupt Naavi mid-sentence on the phone | voice | 2026-05-09 | `stopMusic()` now drains Twilio's outbound buffer via `event: 'clear'`. |
| B2c | You can't talk over Naavi on the phone | voice | 2026-05-09 | Same fix as B2b. |
| B2d | Voice name-search mistranscription ("Hussein") | voice | 2026-05-08 | F2c approach abandoned; keyterms mitigation remains. Reopen if recurs. |
| B2e | Naavi misses recent emails until hourly sync | server | 2026-05-10 | Live-overlay window widened to 24h + capacity raised 10→30 emails. |
| B2g | Voice live-calendar fetch — voice surface on stale snapshot | voice | 2026-05-19 | Confirmed fixed in prior session. Voice now reads the live calendar overlay. |
| B2h | Voice "Naavi stop" interrupt regression mid-TTS | voice | 2026-05-19 | `stopMusic()` drain commits fixed the interrupt path. |
| B2i | Voice Deepgram drops leading word during barge-in | voice | 2026-05-19 | Confirmed fixed in prior session. |
| B2j | Voice name-search STT mistranscription | voice | 2026-05-19 | Confirmed fixed; keyterms-capture + silence-detection improvements covered residual cases. |
| B2l | Orphan SDK geofence — deleted action_rule still fires T1 events on user's phone | mobile | 2026-05-23 | `syncGeofencesForUser` called from all 4 delete paths. Live in V57.20.1 build 194. |
| B3a | User hears two voices on mobile: Naavi's voice + phone's built-in voice | mobile | parked | Build 166 shipped Path 1. Path 2 parked until cloud-voice consistency becomes a recurring complaint. |
| B3b | Cosmetic ruler leak on long-wrap user bubbles | mobile | 2026-05-08 | Build 166 `color: 'transparent'` → `opacity: 0`. Not retested by Wael — cosmetic only. |
| B3c | Haptic vibration feels too subtle on Samsung long-press | mobile | parked | Samsung Android 14 haptic API issue. Reopen with new approach when haptic UX is priority. |
| B3d | Verified-address rejection doesn't name the address | mobile | 2026-05-15 | Bundle `bd52106` + polish `5ce56ad`. Mobile + voice paths covered. |
| B3e | Two blog articles still on age framing | website | 2026-05-19 | Reclassified as not-a-bug — blogs stay with age framing per 2026-05-18 decision. |
| B3f | `resolve-place` radius 100→500 + numbered-address routing | server | 2026-05-19 | Default radius now 300m. Bumped from 100m in V57.16. |
| B3g | OAuth silent-revoke detection | server | 2026-05-23 | Deleted — pattern did not recur. Reopen if second user hits silent-revoke. |
| B3h | `isValidE164` strict 10-digit-after-+1 enforcement | server | 2026-05-19 | Confirmed fixed in prior session. |
| B3i | Brief reader — all-day events invisible to assistant-fulfillment + person-event lookup | server | 2026-05-19 | Two-query pattern applied to `assistant-fulfillment` + `lib/memory.ts`. |
| B3z | OAuth refresh_token rotation not written back to user_tokens | mobile | 2026-06-10 | Removed `naavi_google_oauth_pending` gate at `lib/calendar.ts:154`. Fix committed; ships with next AAB. |
| B4a | Stop-word interrupt regression — "Naavi stop" no longer cuts TTS | voice | 2026-05-23 | Doesn't reproduce — barge-in catch-all fires before stop-words matcher. |
| B4b | Deepgram first-word truncation on barge-in | voice | 2026-05-23 | Trivial-fast-path regex covers name-truncation variant. |
| B4c | Voice name-search mistranscription (Hussein, etc.) | voice | 2026-05-23 | Spell-out fallback `processSpelling` verified shipped and live. |
| B4d | SCHEDULE_MEDICATION action missing on voice | voice | 2026-05-23 | Duplicate of B2a. Tool defined in `anthropic_tools.js:349`, handler at `index.js:3101`. |
| B4e | DELETE_MEMORY voice vs mobile behavior diff | voice | 2026-05-23 | No drift confirmed; entry was stale. Both surfaces trim identically. |
| B4f | Mobile TTS reads addresses wrong — postal codes + street abbreviations + province codes | mobile | 2026-06-10 | Fix committed (`sanitiseForSpeech` normalization before char-splitter); ships with next AAB. |
| B4g | Province codes on mobile TTS | mobile | 2026-05-23 | Merged into B4f. |
| B4h | Ordinal expansion on voice TTS | voice | 2026-05-23 | Merged into B4i. |
| B4i | Address read-back trust bar on voice (3 pieces) | voice | 2026-05-23 | 2 of 3 pieces shipped on voice server (`normalizeAbbrevForTTS`). Third piece (ordinal) deferred as low-impact. |
| B4j | Rule with `list_name` reference doesn't create/connect the list | both | 2026-05-23 | `ensureListAttachedToRule` helper shipped mobile + voice. Live V57.22.2 build 198. |
| B4k | HubSpot Reply Send shows cosmetic "automation error" banner | server | 2026-06-10 | HubSpot retired from Naavi. |
| B4l | Auto-re-prompt for location permission on every app foreground | mobile | 2026-05-23 | Fix shipped V57.21.0 build 195. `hooks/useGeofencing.ts:617-666`. |
| B4m | Mutex around `BackgroundGeolocation.start()` to eliminate concurrent-start throws | mobile | 2026-05-23 | Mutex shipped V57.21.0 build 195. `_startGeofencesPromise` pattern at `hooks/useGeofencing.ts:544-561`. |
| B4n | Permission-status banner on Alerts screen | mobile | 2026-05-23 | Banner shipped V57.21.0 build 195. `app/alerts.tsx` lines 610-624. |
| B4o | Server-side daily geofence health-check cron | server | 2026-05-23 | `geofence-health-check` Edge Function live. Daily cron at `0 12 * * *` UTC (job ID 22). |
| B4p | TRUST BREACH — Naavi says "Added" while silently skipping LIST_ADD on short/test-shaped items | server | 2026-05-23 | RULE 21 added to `get-naavi-prompt`. Both regression tests green. |
| B4q | All-day events invisible to voice brief AND mobile chat live overlay | both | 2026-05-23 | Two-query Promise.all (timed + all-day) on both voice and mobile chat paths. |
| B4r | Mobile TTS reads bulleted lists as one continuous sentence | both | 2026-05-23 | Two-field architecture (speech + display) live in V57.22.2 build 198. |
| B4s | Voice-server entity-existence parity | voice | 2026-05-28 | Code audit confirmed all missing pieces already ported. No code change needed. |
| B4t | HubSpot auto-acknowledgment email never reaches gmail.com recipients | server | 2026-05-23 | Verified working — symptom did not reproduce. |
| B4u | Location-clarification UX exposes attempt counter ("1 try left") | mobile | 2026-05-23 | Counter removed from `hooks/useOrchestrator.ts:1104-1109`. Ships in next AAB. |
| B4w | Postal-code search (no-space format) missed contacts stored with space | server | 2026-06-11 | Root cause: anchor-term filter in `global-search/index.ts` compared anchor word "k1c5m3" against snippet "k1c 5m3" — space mismatch caused match to fail. Fix: `anchorMatch` now also checks space-stripped `hayNorm` against space-stripped anchor word. 243/243 tests green. |
| B4x | TRUST BREACH — Naavi denies existence of disabled alerts visible on Alerts screen | server | 2026-05-24 | Alerts context now injects ACTIVE + DISABLED sections. Auto-reactivate preprocessor live. |
| B4y | TRUST BREACH — Naavi creates unauthorized email-alert rules from search-shape utterances | both | 2026-06-10 | HAS_CREATE_INTENT gate shipped. Remaining confirm gap → B6i. |
| B6a | Orchestrator bails to UI tap instead of re-arming expired location alert (mobile) | mobile | 2026-06-10 | Fix committed `318e522`; ships with next AAB. Voice parity gap still open — see active table. |
| B6b | One-time cleanup migration: collapse duplicate disabled location rules | backend | 2026-05-26 | Migration `20260526_action_rules_one_row_per_place.sql` applied. Tests green. |
| B6c | Keyboard flicker / jump on chat input | mobile | 2026-06-10 | `app.json` `"pan"` → `"resize"` + KAV disabled on Android. Fix committed; ships with next AAB. |
| B6d | Choice/option lists rendered as bullets instead of numbered | server | 2026-06-10 | Multiple live tests passed. Reopen if regression observed. |
| B6e | Calendar query misroutes to LIST_READ | server | 2026-05-28 | `isCalendarReadIntent()` bypass gate in `naavi-chat`. Regression tests green. |
| B6f | Supabase migration tracking misaligned with prod state | backend | 2026-06-10 | All 52 migration files renamed to 14-digit format. CLI push now works cleanly. |

---

## Closed Features (F)

| ID | Description | Surface | Closed | Reason |
|----|-------------|---------|--------|--------|
| F1a | Lists wired to entities (alerts / calendar events / reminders) | both | 2026-05-15 | Waves 1 / 2 / 2.5 / 2.6 all shipped. Live V57.15.x. |
| F1b | Inbound SMS / WhatsApp queryability | backend | 2026-05-08 | No viable architecture. WhatsApp API is B2C only; SMS via OS-level READ_SMS carries Play rejection risk. |
| F1c | Voice privacy UX (4-piece auto-classification bundle) | voice | 2026-05-10 | Superseded by F1d (user-controlled mute). Auto-classification creates unfixable social problem. |
| F1d | User-controlled mute on PC + Mobile | both | 2026-05-13 | All sub-pieces shipped. Long-press mute, voice "no sound", SMS hot-link, hosted-replies backend. |
| F2c | Walkie-talkie style turn-taking on voice | voice | 2026-05-10 | Marker-word ambiguity unresolved; latency work reduced pain. |
| F2d | Mobile auto-listen after confirmation prompts | mobile | 2026-05-23 | Irrelevant — voice phone line provides hands-free. |
| F2e | Alert state visibility + Reactivate button | both | 2026-05-23 | Both halves live in V57.21.0 build 195. `manage-rules` reactivate op + `app/alerts.tsx` UI. |
| F2f | Multi-entry alert discouragement (UI warning + Naavi prompt steering) | both | 2026-05-23 | Shipped V57.21.0 build 195. Default `one_shot=true` + Reactivate path. |
| F2g | Per-user alert channel preferences (opt out of SMS/WhatsApp/Email/Push/Voice Call) | both | 2026-05-23 | Phase 1 (server) + Phase 2 (mobile UI) shipped. Phase 3 (voice readback) deferred. |
| F2h | Contacts adapter — match by postal-address fields | server | 2026-05-28 | `addresses` added to personFields + readMask. Live-verified by Wael. |
| F3a | Picovoice Eagle voice biometric (caller voiceprint ID) | voice | 2026-05-13 | Dropped — Picovoice approval stalled. Replaced by 4-digit PIN (shipped V57.15.5 build 176). |
| F4a | Voice action parity — DELETE_EVENT, LIST_RULES, DELETE_MEMORY, SCHEDULE_MEDICATION | voice | 2026-05-19 | All three tools verified in `naavi-voice-server/src/anthropic_tools.js`. |
| F4b | Inbound SMS / WhatsApp queryability | backend | 2026-05-19 | Same conclusion as F1b. |
| F4c | Help / Discover section + Aura narration | website | 2026-05-19 | All 8 recipe pages + FAQ + Cora→Andromeda swap shipped. |
| F4d | AWS Polly voice unification — mobile → phone | voice | 2026-05-19 | Superseded by voice role split 2026-05-17 (Hera in-app / Andromeda website). |
| F4e | Public demo line Polly Joanna → Cora migration | voice | 2026-05-18 | Reverted same day — 8.6s Deepgram fetch latency + phone-layer voice deviation. |
| F5c | Email instant-search live-overlay | server | 2026-06-10 | Already shipped — `fetchLiveRecentEmails` confirmed in `naavi-chat/index.ts`. |

---

## Closed Tooling (T)

| ID | Description | Surface | Closed | Reason |
|----|-------------|---------|--------|--------|
| T1a | Migrate both surfaces to Anthropic Structured Outputs | both | 2026-05-28 | Migration already complete — both surfaces on `tools: NAAVI_TOOLS` with typed JSON schemas. |
| T3a | Pre-invite human-tester runbook + sharp test boundary | docs | 2026-05-19 | `docs/PRE_INVITE_SMOKE_TEST.md` + `docs/TEST_RESPONSIBILITY_MATRIX.md` shipped. Automation gaps absorbed into T2a/T3c. |
| T3b | OAuth health monitoring cron | server | 2026-05-19 | Merged into B3g (now closed). |

---

## Closed without entry

Items walked but not added to any table. Reopen if symptom recurs.

| Holding-list # | Item | Status | Reason closed |
|---|---|---|---|
| 4 | Geofence reliability (pending phone reboot) | deleted | Tested 2026-05-08 — no problems found. |
| 12 | `naavi-spend-summary` Edge Function | completed | Function exists; Maestro test PASSED 2026-05-08. Holding-list entry was stale. |
| 14 | Demo line "remind me" time-extraction loop | deleted | Impossible by architecture — demo line is fully canned. |
| B1a | Voice live-calendar fetch (voice still on stale snapshot) | deleted | Validated 2026-05-08 — does not reproduce in real use. |
| B1b | LIST_RULES backstop on mobile | completed | V57.14.0 build 166 commit `bd52106`. Mobile orchestrator correctly lists alerts. |
| B1c | Naavi misses brand-new emails for up to an hour | completed | Live-overlay + Railway env vars fix 2026-05-09. Both surfaces verified. |
| B1d | Pre-search "Nothing matched" gag override | completed | Server side `b667115` + mobile soft-gag via subsequent AABs. |
| B3b | Cosmetic ruler leak on long-wrap user bubbles | completed (not retested) | Build 166 `opacity: 0` fix. Cosmetic only — reopen if visibly annoying. |

---

## Session notes

- Walked all 26 holding-list items one at a time with explicit user "done" signal between items (2026-05-08).
- Surface column added 2026-05-08 as cross-surface drift discipline. See CLAUDE.md Rule 16 + Voice Completion Roadmap W2/W3 for the full story.
- Major bulk closure 2026-05-19: 17 items moved to closed.
- Holding list confirmed as the single master inventory for all bugs and features 2026-06-11.
