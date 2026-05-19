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

## Bugs (B)

Active bug list as of 2026-05-19 — both on "watching" status, no active build planned. See the Closed table below for the 9 bugs closed today.

| ID | Description | Surface | Notes | Server/AAB | Status |
|----|-------------|---------|-------|------------|--------|
| B2l | Orphan SDK geofence — deleted action_rule still fires T1 events on user's phone | mobile | After a location rule is deleted from `action_rules`, the Transistorsoft SDK on the user's phone still has the geofence registered → keeps firing T1 ENTER events that the server correctly rejects at `geofence-T1-rule-lookup-null` (no fanout, silent). Identified 2026-05-17 (orphan rule `4446feda` on Wael's phone). **Fix (queued for V57.20.1 build 194, 2026-05-19):** every successful delete path (Alerts screen tap-delete + 3 orchestrator paths: deterministic delete-all intercept, bulk "all" reply on multi-match, DELETE_RULE action handler) now fires `syncGeofencesForUser(userId)` after the delete lands. The sync stops the SDK, removes ALL geofences, and re-adds only the rules still in `action_rules` — so the deleted rule's geofence is dropped. Fire-and-forget; never blocks the chat turn. Only triggers when at least one deleted rule had `trigger_type='location'`. | AAB | queued V57.20.1 build 194 |
| B3g | OAuth silent-revoke detection — users can lose Naavi without any signal | server | Discovered 2026-05-17 — Huss's Google refresh token returned `invalid_grant` (revoked) and Naavi silently failed all his calendar operations. No proactive detection. **Planned fix (formerly tracked as T3b, merged here 2026-05-19):** daily cron pings Google for each `user_tokens.refresh_token`; on `invalid_grant`, marks `user_settings.google_token_revoked = true` and sends a push notification ("Reconnect Naavi to Google"). Tap launches the re-auth flow and stores a fresh token. Server-only build, ~1-2 hours. **Status (Wael 2026-05-19): watching** — Huss's case may have been a deliberate sign-out; keep on the list to see if pattern recurs with other users before building. | Server | watching |

---

## Features (F)

Active feature list as of 2026-05-19 — all kept open for further product discussion (no engineering blocker; product decisions still pending). See the Closed table below for the 5 features closed today.

| ID | Description | Surface | Notes | Server/AAB | Status |
|----|-------------|---------|-------|------------|--------|
| F2a | Onboarding Review (multi-phone + 7 other gaps) | mobile | Onboarding doc + Settings UI covering 8 gaps (multi-phone setup, voice keyterms capture at setup, quiet hours field, verified-address expectation, consolidated privacy callout, post-install rehearsal with starter prompts, re-install / new-phone flow, first-week-vs-week-two expectation calibration). Postponed 2026-05-09 — not all 8 have crisp product decisions; needs a dedicated session looking at onboarding end-to-end. Settings UI changes require AAB; doc is a build-script regen. | Both | open (postponed) |
| F2b | Demo line maturity (richer scenarios + conversion path + telemetry) | voice | Demo phone line gets richer scenarios, a conversion path back to a real account, and telemetry to see what works. Postponed 2026-05-09 — marketing/growth decisions (which metrics matter, which scenarios resonate) need a focused session. Three sub-pieces in sequence: telemetry first (total calls, scenario popularity, opt-in rate, signup conversion), conversion attribution second (per-call token in the SMS link), scenario richness third (medication scheduling, navigation, recurring delegation, variable data, light branching). Already shipped: 5 canned scenarios, name capture, personalized SMS recap. | Server | open (postponed) |
| F2d | Mobile auto-listen after confirmation prompts | mobile | When Naavi finishes a yes/no or numbered-pick prompt (the orchestrator already tracks "pending confirmation" state), mic auto-opens for 20-30s and auto-sends on speech-end. Removes tap-to-talk + tap-to-send friction for confirmations specifically. Only triggers when the prior turn used voice input (not text), so office typers never get surprised. Discussed 2026-05-19 — Wael deferred: voice phone line (1-888-91-NAAVI via "Hey Google, call Naavi") already covers driving + cooking hands-free with full Naavi capability, and the at-desk tap friction is mild because eyes are on screen anyway. Re-open only if hands-full at desk becomes a recurring pain point not already solved by the voice call. ~6-8 hours code + 1 AAB. | AAB | open (deferred) |
| F2e | Alert state visibility — Active / Done / Expired badges on Alerts screen + voice list | both | Today both the Alerts screen and voice `LIST_RULES` show every rule the same way, regardless of whether it has fired, completed (one-shot), or expired (time-trigger past with no fire). Robert can't tell at a glance which alerts are still waiting vs which already fired vs which are done. Proposed state model from action_rules columns: ACTIVE-WAITING (`enabled=true, last_fired_at=null`), ACTIVE-REPEATING (`enabled=true, last_fired_at≠null, one_shot=false`), DONE (`enabled=false`), EXPIRED (`enabled=true, time-trigger datetime<now, last_fired_at=null`). Mobile: add a per-row state badge + group Active first / hide Done behind a toggle. Voice: hide Done by default, offer "do you also want to hear the completed ones?" as a follow-up. Discussion 2026-05-19. Mobile side requires AAB; voice side is server-only. | Both | open (discussion) |

---

## Tooling (T)

Active tooling list as of 2026-05-19. T3a closed (docs shipped, automation gaps absorbed into T2a/T3c). T3b merged into B3g (single tracking item for the OAuth silent-revoke bug + fix). See the Closed table below.

| ID | Description | Surface | Notes | Server/AAB | Status |
|----|-------------|---------|-------|------------|--------|
| T1a | Migrate both surfaces to Anthropic Structured Outputs | both | Migrate phone and mobile to Anthropic's Structured Outputs API (Nov 2025 GA). Voice on tool-use today; mobile on JSON-in-prompt; neither on Structured Outputs. Convergence eliminates the recurring prompt-drift cycle at the API level and mechanically guarantees action-emission parity across surfaces. ~1 focused session. | Server | open |
| T2a | Maestro full-suite mobile UI test coverage | mobile | Mobile UI test suite — 13 scenarios. Smoke passes. Full suite 2026-05-08: 6 pass, 7 fail. Failures look like a mix of stale assertions (UI labels renamed since test was written) and real regressions. Triage required before the suite becomes a pre-build gate. Now also owns the Maestro UI flow automation gaps formerly tracked under T3a. | Server | open (blocked on emulator Internal Testing install) |
| T2b | Phase 2 demo data (Gmail seeding for mynaavidemo) | backend | Demo-data seeding for the demo account — Phase 1 (calendar) shipped; Phase 2 (Gmail) gap. Use cases: mobile-app demo recordings without personal data, deterministic backing for the Maestro spend-summary scenario, and future un-canning of the demo phone line. ~30 min to add and run the seed. | Server | open |
| T3c | Voice automated regression suite (W3 from Voice Completion Roadmap) | voice | Voice surface has no automated regression coverage today. W3 from `docs/VOICE_COMPLETION_ROADMAP_2026-05-08` defines the suite. Pairs with T1a (Structured Outputs convergence) — both together close the cross-surface drift gap that Rule 16's `parity-impact:` discipline currently fills manually. Now also owns the voice action-parity test automation gap formerly tracked under T3a. Server-only. | Server | open |

---

## Ideas (I)

Brainstorming-stage entries. Path or scope not yet chosen. Promote to F when committed as a real feature.

| ID | Description | Surface | Notes | Server/AAB | Status |
|----|-------------|---------|-------|------------|--------|
| I2a | `list_change` alert trigger | backend | Alert when a list changes — e.g., *"alert when grocery list hits 10 items"* or *"alert when to-do is empty."* Deferred — 7 design questions open with stub answers (third-party routing, threshold semantics, etc.). ~½ session design + ½ session build. | Server | deferred (design questions open) |
| I2b | `price` alert trigger | backend | Alert when a price drops — flight, retail item, gas. Deferred — external integration path not chosen (scraping fragility, paid-API costs, vertical fragmentation across flights / hotels / retail / gas). Path-selection decision is a focused session; build is real engineering after that. | Both | deferred (path-selection open) |
| I3a | `health` alert trigger (Epic / wearable integration) | backend | Alert when a health metric changes — *"alert me if my pulse is above 120"*, *"text my wife if BP > 180"*. Blocked — Epic FHIR account, healthcare-data agreement, privacy review, and wearable SDK integration are multi-month wall-clock prereqs. Trigger handler itself is small; compliance + ingestion infrastructure dwarfs it. Parked-deep until any one of those prereqs becomes a live initiative. | Both | blocked (multi-month prereqs) |

---

## Closed without entry

Items walked but not added to any table. Reopen if symptom recurs.

| Holding-list # | Item | Status | Reason closed |
|---|---|---|---|
| 4 | Geofence reliability (pending phone reboot) | deleted: not reproducible 2026-05-08 | Tested per Wael 2026-05-08 — no problems found. Will be reported if recurs. Underlying Google-OAuth disconnect bug (Phase 3 background-mode blocker) noted but not preemptively tracked — same rule. |
| 12 | `naavi-spend-summary` Edge Function | completed (already shipped V57.9.4) | Function exists at `supabase/functions/naavi-spend-summary/index.ts`, aggregates `documents.extracted_amount_cents` directly, multi-user safe, multi-currency aware. Maestro `e2e/06-spend-summary-anthropic.yaml` PASSED 2026-05-08. Holding-list "approved 2026-04-30, not built" was stale. |
| 14 | Demo line "remind me" time-extraction loop | deleted: not reproducible (demo canned) | Symptom impossible by architecture — demo line is fully canned (5 hard-coded scenarios via DTMF + speech routing); no real reminder path on demo. Underlying bug may still affect authenticated users on production line — log if it surfaces. |
| B1a | Voice live-calendar fetch (voice still on stale snapshot) | deleted: not reproducible (validated 2026-05-08) | First item under CLAUDE.md Rule 17. Wael created a fresh Google Calendar event, asked voice (PC) — correct answer. Changed time + location, asked voice and mobile — both correct. Bug as classified does NOT reproduce in real use. The architectural read was correct about the code path but did not predict user-visible behavior; some sync mechanism keeps the snapshot fresh enough that staleness is not perceived. Reopen only if surfaces. |
| B1c | Naavi misses brand-new emails for up to an hour | completed (2026-05-09 both surfaces) | When user asks an email-shaped question, Naavi now reaches Gmail directly so brand-new emails show up even before the hourly cron picks them up. Mobile half verified 2026-05-08. Voice half: root cause traced to missing Railway env vars (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) — without them voice OAuth refresh failed silently. After adding the env vars, both surfaces verified. Companion: live-overlay now states arrival time as clock time. |
| B2b | You can't interrupt Naavi mid-sentence on the phone | completed (2026-05-09 stopMusic drain) | Root cause was Twilio's outbound audio queue holding 5+ seconds of thinking music ahead of Naavi's reply; `stopMusic()` only cancelled the interval but didn't drain the queue. Fix: `stopMusic()` now sends Twilio `event: 'clear'`. After the fix, "Naavi stop" interrupts; first attempt sometimes missed in speakerphone mode, second attempt always works. Reopen if first-interrupt miss becomes recurring. |
| B2c | You can't talk over Naavi on the phone | completed (2026-05-09 same as B2b) | Both interrupts share the `stopMusic()` code path; the queue drain that fixed B2b also fixes B2c. Same first-interrupt-miss limitation in speakerphone mode. |
| B2d | Voice name-search mistranscription ("Hussein") | deleted: F2c approach abandoned, keyterms mitigation remains | Pivoted to F2c (walkie-talkie turn-taking) 2026-05-08, but F2c closed 2026-05-10 (marker-word ambiguity + latency work reduced underlying pain). Remaining mitigation for name-search STT failures is the existing keyterms-capture feature + silence-detection improvements. Reopen if Hussein-style mistranscription recurs as a real user pattern. |
| F1b | Inbound SMS / WhatsApp queryability | deleted: no viable architecture | WhatsApp inbound structurally impossible (Meta restricts API to business-to-customer). SMS via OS-level `READ_SMS` carries Google Play rejection risk + iOS unsupported. SMS via Twilio proxy / carrier forwarding requires per-contact behavior change. Email already covers ~80% of the underlying use case. Reopen if a clean architectural path emerges. Reference memory: `project_naavi_inbound_sms_whatsapp.md`. |
| F1c | Voice privacy UX (4-piece auto-classification bundle) | deleted: superseded by F1d (user-controlled mute) | Auto-classification creates an unfixable social problem — forcing Robert to publicly engage in the privacy dialogue itself reveals he has something to hide. False positives compound. The simpler reactive approach (F1d) — Robert decides in the moment whether to mute — avoids the false-positive social cost entirely. Reference memory: `project_naavi_voice_privacy.md`. |
| F2c | Walkie-talkie style turn-taking on voice — explicit end-of-message signal | deleted: marker-word ambiguity, pain reduced by latency work | Marker-word ambiguity unresolved (*"over"* appears in everyday speech; alternatives each had issues). Voice-call latency work brought answer-to-brief gap from ~13s to ~6s — turn-boundary pain F2c targeted is less acute now. Existing silence-detection improvements remain the right path. Reopen only if a concrete marker-word design plus a real recurring turn-boundary symptom both surface. |
| B3c | Haptic vibration feels too subtle on Samsung long-press | deleted: parked — Samsung haptic API issue, needs new approach | Build 166 shipped `Vibration.vibrate(80)` → `(150)`. On Samsung One UI/Android 14: long-press triggers UI but produces NO perceptible buzz — both `Vibration.vibrate` and `Haptics.impactAsync(Heavy)` silently fail despite OS-level intensity ~80% + all toggles ON. Android 14 / Samsung-specific API issue. Reopen with a new approach (vibration pattern, runtime permission re-check, or `react-native-haptic-feedback`) when haptic UX becomes priority. |
| B3b | Cosmetic ruler leak on long-wrap user bubbles | completed (build 166, awaiting visual retest) | Build 166 shipped the one-line fix (`color: 'transparent'` → `opacity: 0` on the chat-bubble ruler style). Not retested by Wael. Cosmetic-only issue (faint dots behind a long user bubble on Samsung) with no functional impact. Reopen if dots are visibly annoying. |
| B3a | User hears two voices on mobile: Naavi's voice + the phone's built-in voice | deleted: parked — Path 2 only when cloud-voice consistency complaint recurs | Build 166 shipped Path 1 (`staysActiveInBackground: true` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permission). Background-during-reply keeps cloud voice cleanly (Path 1 working), but resume-to-foreground mid-reply still triggers fallback to phone's native voice. Path 2 (custom Expo plugin declaring an Android FG service for media playback) parked until cloud-voice consistency becomes a recurring complaint. |
| F1d | User-controlled mute on PC + Mobile (replaced F1c) | completed (2026-05-13 fully shipped + all live tests passed) | Sub-pieces: (a) Mobile long-press → mute mid-TTS in V57.14.1 build 167 (`663d440`); (b) Voice "no sound"/"quiet"/"shh" → mute on phone via step 3 (`6ba6d2b`); (c) "Want me to text the rest?" offer in step 2+3; (d) SMS hot-link via `/r/<token>` (`6448cb0`+`bc810d9`); (e) Hosted-replies backend + 5 auto-tester tests (`9259887`, 5/5 green); (f) Live Twilio tests 3+4 PASS with 4 voice-server fixes (`4eef2da` `2b86391` `01d4f72` `1f14748`). Doc-vs-reality: spec said OTA, in practice shipped in AAB 167 — same outcome. Memory: `project_naavi_voice_privacy.md`. |
| B1b | LIST_RULES backstop on mobile | completed (V57.14.0 build 166 commit `bd52106`) | Bundle "B1b + B3b + B3c + B3d". Mobile orchestrator now correctly lists user's alerts when asked. Verified on Wael's phone after install. |
| B1d | Pre-search "Nothing matched" gag override | completed (server 2026-05-10 + mobile later AAB) | Server side (`b667115` downgrade gag to defer-to-system-prompt) + mobile soft-gag wording shipped via subsequent AABs (V57.14.x onwards). Issue tracked via `a761220` instrumentation no longer fires under normal use. |
| B2e | Naavi misses recent emails until hourly sync | completed (2026-05-09/10 window+capacity bundle) | Live-overlay window widened to 24h (2026-05-09) + capacity raised 10→30 emails (`ecb6ec1`). Brand-new emails now appear in answers within seconds of arrival on both surfaces. |
| B3d | Verified-address rejection doesn't name the address | completed (V57.14.0 build 166 + V57.15.5 build 177) | Bundle `bd52106` + polish `5ce56ad` (orchestrator lines 830, 924, 1419). Mobile rejection now names the place; voice path covered in same bundle. |
| F1a | Lists wired to entities (alerts / calendar events / reminders) | completed (V57.15.0 build 171 + Waves 2 / 2.5 / 2.6) | Wave 1 server-side (`d49be81`); Wave 2 Phase A orchestrator handlers (`29bc028`); Phase B Lists screen + list-detail + 3-dots menu (`a8fcc29`); Phase C alert-detail "Attached list" card (`4147a61`); Phase E multi-phone identity + Settings UI (`1195b17`); Wave 2.5 M:N pivot (`910561f`); Wave 2.6 Drive↔DB sync (`1afe21b`); V57.15.1 build 172 chat LIST_CONNECTION_QUERY (`429b1ea`); V57.15.4 build 175 newline formatter + tappable rows. Auto-tester `list-connections` + `lists-reconcile` suites green. |
| F3a | Picovoice Eagle voice biometric (caller voiceprint ID) | deleted: Picovoice dropped 2026-05-13, replaced by 4-digit PIN | `b22f5d9` "drop Picovoice voice biometric, queue PIN-flow build instead". Picovoice approval queue stalled 2 weeks; Wael chose industry-standard PIN over biometric (no vendor dependency). PIN shipped V57.15.5 build 176 (`fae265c`) + 177 (`5ce56ad`). Memory: `project_naavi_caller_pin_chosen_over_biometric.md`. Reopen if biometric becomes a real product requirement and a vendor selection unblocks. |
| B2a | Voice promises to schedule medication but doesn't create the events | completed (verified fixed 2026-05-19) | Per Wael 2026-05-19: confirmed fixed in prior session; holding list was stale. Voice now creates calendar events when scheduling medication. Memory-deletion ("forget about X") also matches mobile. Bulk close as part of the 2026-05-19 holding-list cleanup. |
| B2g | Voice live-calendar fetch — voice surface on stale snapshot | completed (verified fixed 2026-05-19) | Per Wael 2026-05-19: confirmed fixed in prior session. Voice now reads the live calendar overlay on top of the snapshot, same as mobile. Bulk close. |
| B2h | Voice "Naavi stop" interrupt regression mid-TTS | completed (verified fixed 2026-05-19) | Per Wael 2026-05-19: confirmed fixed in prior session; `stopMusic()` drain (commits `4eef2da` `2b86391` `01d4f72` `1f14748`) addressed the interrupt path. Bulk close. |
| B2i | Voice Deepgram drops leading word during barge-in | completed (verified fixed 2026-05-19) | Per Wael 2026-05-19: confirmed fixed in prior session. Bulk close. |
| B2j | Voice name-search STT mistranscription | completed (verified fixed 2026-05-19) | Per Wael 2026-05-19: confirmed fixed in prior session (keyterms-capture + silence-detection improvements covered the residual cases). Bulk close. |
| B3e | Two blog articles still on age framing | completed (verified fixed 2026-05-19) | Per Wael 2026-05-19: blogs stay with age framing per the 2026-05-18 decision ("Keep the age, they are part of the target. Blogs stay and narrate") — older adults are part of the blog audience even though banned from app surfaces. Effectively reclassified as not-a-bug. Bulk close. |
| B3f | `resolve-place` radius 100→500 + numbered-address routing | completed (radius bumped to 300m + verified 2026-05-19) | `resolve-place` default radius is now 300m (per code: `body.radius_meters !== undefined ? Number(body.radius_meters) : 300`). Bumped from 100m in V57.16. Bulk close per Wael 2026-05-19. |
| B3h | `isValidE164` strict 10-digit-after-+1 enforcement | completed (verified fixed 2026-05-19) | Per Wael 2026-05-19: confirmed fixed in prior session; validator now requires exactly 10 digits after +1. Bulk close. |
| B3i | Brief reader other than home — all-day events invisible to assistant-fulfillment + person-event lookup | completed (2026-05-19 commit `38470a6`) | Two-query pattern (timed + all-day, combine client-side) applied to `supabase/functions/assistant-fulfillment/index.ts` handleBrief + handleCalendar AND `lib/memory.ts` searchCalendarForPerson. Edge Function deployed; lib/memory.ts lands on next AAB. All-day events now appear in "what's on my schedule today" + "what's on my calendar Monday" + person-event lookups across voice and mobile chat. Wael's full-day event today (2026-05-19) was the canonical test case. |
| F4a | Voice action parity — DELETE_EVENT, LIST_RULES, DELETE_MEMORY on the voice surface | completed (all 3 tools live in voice server; B3i fix 2026-05-19 completed all-day-event visibility) | Verified 2026-05-19: all three tools implemented in `naavi-voice-server/src/anthropic_tools.js` (LIST_RULES at line 259, DELETE_EVENT at line 315, DELETE_MEMORY at line 402). Last blocker was DELETE_EVENT's blindness to all-day events (couldn't see them to delete them) — resolved by today's B3i fix on `assistant-fulfillment`. Voice surface action parity with mobile now complete. |
| F4b | Inbound SMS / WhatsApp queryability | deleted: no viable architecture (same reasoning as F1b) | Per Wael 2026-05-19: bulk close — same conclusion as F1b. WhatsApp Business API has structural limits (B2C only). SMS via OS-level READ_SMS carries Google Play rejection risk. SMS via Twilio proxy / carrier forwarding requires per-contact behavior change. Email + outbound `sent_messages` covers ~80% of the use case. Reopen if a clean architectural path emerges. Reference memory: `project_naavi_inbound_sms_whatsapp.md`. |
| F4c | Help / Discover section + Aura narration | completed (2026-05-18 + 2026-05-19) | Massive scope shipped over the 2026-05-18 / 2026-05-19 sessions: section renamed `/help/` → `/discover/` site-wide; home page hero voice; Quick Start; all 8 recipe pages (arrive, with-list, email, send-message, remember, today, list, call-from-anywhere); FAQ landing + new "Can someone else set MyNaavi up for me" entry; full Cora→Andromeda voice swap (Cora rated too slow by friend-group A/B); blog index audio players beside each "Read article"; vercel.json redirects `/help/*` → `/discover/*` + `/how-to-use` → `/discover/` (preserves legacy bookmarks). Reference pages (settings, troubleshoot, privacy) deferred — not blocking; re-open if they become urgent. |
| F4d | AWS Polly voice unification — mobile → phone | deleted: superseded by voice role split 2026-05-17 (Hera in-app / Andromeda website) | Moved from Features table 2026-05-19. Decision 2026-05-04 (unify on Polly Joanna) was superseded by 2026-05-17 voice role split (Hera in-app + Cora brand) which was further refined 2026-05-19 (Hera in-app + Andromeda brand, after Cora A/B failed). Polly stays as the public demo line voice for latency reasons. Memory: `project_naavi_brand_voice_andromeda.md`. |
| F4e | Public demo line Polly Joanna → Cora migration | deleted: reverted same day (2026-05-18) | Moved from Features table 2026-05-19. Two regressions made Cora unusable on the demo: 8.6s Deepgram fetch latency on long prompts + phone-layer voice deviation on "I heard <name>". Surgical revert preserved the scenario refresh (Hilton/Toronto, airport/Sarah). Architecture for future Cora-on-demo attempt: pre-baked static MP3s in `naavi-voice-server/public/audio/`. Reference memory: `project_naavi_demo_iheard_voice_deviation.md`. |
| T3a | Pre-invite human-tester runbook + sharp test boundary | completed (docs shipped 2026-05-17; automation gaps absorbed into T2a/T3c 2026-05-19) | `docs/PRE_INVITE_SMOKE_TEST.md` (full version) + `docs/TEST_RESPONSIBILITY_MATRIX.md` (26-row 3-bucket classification) shipped. Remaining Bucket A automation gaps reassigned to existing items: Maestro UI flows → T2a; voice action-parity tests → T3c; Twilio E2E for PIN → folds into T2a as a sub-scenario. Bulk close 2026-05-19. |
| T3b | OAuth health monitoring cron | merged into B3g 2026-05-19 | The tooling item (the cron build) was the planned fix for the bug item (B3g). Tracking them separately added bookkeeping overhead. Merged: B3g now carries both the bug description and the planned fix. Status of the work is captured under B3g (watching). |

---

## Shipped this session (2026-05-09)

Items not in the original 26-item holding list but addressed during the session:

- **PC outbound latency** — user-perceived gap from "you finish speaking" to "Naavi starts replying" on phone calls reduced from ~14 s to ~4 s on trivial questions. Wave-test ground truth showed ~7 s of stale thinking-music tail blocking Naavi's reply (Twilio's outbound audio queue held up to 5 s of music ahead of every reply). Fix: `stopMusic()` now drains Twilio's outbound buffer immediately via `event: 'clear'`. Companion change: chunk size aligned to Twilio's documented 20 ms expectation (was 1 s). Reverses the 2026-04 "do NOT drain queue" memory directive — the original cost was assumed to be 1.3–1.5 s but was actually 5–7 s. Memory file `project_naavi_music_queue_latency.md` updated. **Bonus:** the same fix also closes B2b and B2c (interrupts now work) since they shared the `stopMusic()` code path.

---

## Final tally

**Major bulk closure 2026-05-19.** 17 items moved to Closed without entry: B2a, B2g, B2h, B2i, B2j, B3e, B3f, B3h, B3i (9 bugs verified fixed or shipped today) + F4a, F4b, F4c, F4d, F4e (5 features completed or deleted) + T3a, T3b (2 tooling items completed or merged). Net active list shrank from 27 to 9.

| List | Count | IDs |
|---|---|---|
| Bugs (B) | 2 | B2l (queued V57.20.1 build 194), B3g (watching, absorbed T3b) |
| Features (F) | 4 | F2a, F2b (both postponed pending product discussion), F2d (mobile auto-listen — deferred), F2e (alert state visibility — discussion) |
| Tooling (T) | 4 | T1a, T2a, T2b, T3c |
| Ideas (I) | 3 | I2a, I2b, I3a |
| Closed without entry | 38 | All prior closures + the 17 closed 2026-05-19 |
| **Total** | **49** | Active: 9 (6 truly active + 2 on watch + 1 expanded count). Closed: 38 + 2 watching = 40 effectively-not-blocking. F4d had been listed in the F table with "deleted" status; now properly moved to Closed without entry. |

### Tally by Server/AAB (active items only)

| Scope | Count | Implication |
|---|---|---|
| Server-only | 5 | T1a (partly), T2b, T3c, B3g (watching), F2b. Ship without AAB cycle. |
| AAB-only | 3 | F2a, F2d (deferred), B2l (in flight — V57.20.1 build 194). F2e split — mobile side AAB, voice side server. |
| Both | 2 | T1a (Server + Mobile), T2a (Mobile + emulator infra) |

### Tally by Surface (cross-surface drift discipline)

| Surface | Count | IDs |
|---|---|---|
| voice | 1 | F2b |
| mobile | 5 | B2l, F2a, F2d, F2e (mobile side), T2a |
| both | 2 | T1a, T3c |
| backend | 4 | B3g, T2b, I2a, I2b |
| (Ideas, deferred) | 1 | I3a (health trigger) |

Items tagged `both` (T1a + T3c) are the cross-surface drift discipline items — when one surface ships changes, the other must follow before drift accumulates.

### Tally by severity (active items only)

| Severity | B | F | T | I | Total |
|---|---|---|---|---|---|
| 1 (top) | 0 | 0 | 1 | 0 | 1 (T1a) |
| 2 (medium) | 1 | 3 | 2 | 1 | 7 (B3g, F2a, F2b, F2e, T2a, T3c, I2a) |
| 3 (low) / watching / deferred | 1 | 1 | 1 | 2 | 5 (B2l, F2d, T2b, I2b, I3a) |
| **Total** | 2 | 4 | 4 | 3 | **13** |

(Total active = 11 distinct items. Last bulk closure: 2026-05-19 — 17 items closed in one pass after B3i fix shipped, F4a completed by B3i, Cora→Andromeda voice swap finalized, and Wael's strategic close-down decision. Same-day additions: F2d mobile auto-listen for confirmations [deferred], F2e alert state visibility badges [discussion].)

---

## Session method

- Walked all 26 holding-list items one at a time, with explicit user "done" signal between items.
- Each item: research the codebase + memory, propose classification + severity + notes, user accepts / pushes back / closes.
- One missed item surfaced post-walk (B1c email instant-search) and was added on Wael's catch.
- Architectural principle (sync + live-overlay per channel) crystallized via B1c discussion.
- Three holding-list items closed without entry (Items 4, 12, 14) where the symptom was already gone or already shipped.
- Surface column added 2026-05-08 (post-walk) as cross-surface drift discipline. See CLAUDE.md Rule 16 + Voice Completion Roadmap W2 / W3 for the full discipline / automation story.

This document is the canonical output. Future implementation work should reference IDs (e.g., "ship B1a + B1c together; both port the live-fetch pattern").
