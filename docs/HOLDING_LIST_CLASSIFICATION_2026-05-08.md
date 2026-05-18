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

| ID | Description | Surface | Notes | Server/AAB |
|----|-------------|---------|-------|------------|
| B2a | Voice promises to schedule medication but doesn't create the events | voice | Voice says *"I'll set up your aspirin schedule"* but nothing lands in Google Calendar. Mobile already does this correctly. Server-side fix copies the mobile path. While there, verify voice memory-deletion (*"forget about X"*) matches mobile. Validated broken 2026-05-09; fix still deferred 2026-05-17. | Server |
| B2g | Voice live-calendar fetch — voice surface on stale snapshot vs mobile | voice | Voice uses the cached `calendar_events` snapshot (refreshed every 6h via cron) while mobile reads a live overlay on top of the snapshot. Voice answers to "what's on my calendar today" can lag real changes by hours. Mobile already does this correctly per V57.11.6. Server-side fix copies the mobile live-overlay pattern into the voice prompt path. | Server |
| B2h | Voice "Naavi stop" interrupt regression mid-TTS | voice | "Naavi stop" no longer reliably interrupts TTS on a live Twilio call; sometimes gets recorded as the next question instead. Observed Session 19. Server-side voice-server fix. | Server |
| B2i | Voice Deepgram drops leading word during barge-in | voice | When user starts speaking while TTS is still finishing, Deepgram STT silently drops the first word of the user's reply ("What time is it?" → "Time is it?"). Breaks fast-path regex routing → falls back to slow Sonnet. Proven April 19. Server-side voice-server fix. | Server |
| B2j | Voice name-search STT mistranscription (e.g., "Hussein") | voice | Voice STT fails on certain names that text input handles cleanly. Probable Deepgram-side phonetic limitation. Mitigations exist (keyterms-capture); a phonetic-fallback path on lookup-contact would close the remaining gap. Server-side. | Server |
| B2l | Orphan SDK geofence — deleted action_rule still fires T1 events on user's phone | mobile | After a location rule is deleted from `action_rules`, the Transistorsoft SDK on the user's phone still has the geofence registered → keeps firing T1 ENTER events that the server correctly rejects at `geofence-T1-rule-lookup-null` (no fanout, silent). Identified 2026-05-17 (orphan rule `4446feda` on Wael's phone). `syncGeofencesForUser` should remove deleted rules — investigation needed. Mobile-side fix. | AAB |
| B3e | Two blog articles still on age framing (banned-terms violation) | website | Two blog articles still use age framing (banned per 2026-05-05). Three options: delete both; rewrite in time-scarcity tone; or rewrite cards only and delete posts (avoid — broken links). Pick before next content session. Mynaavi-website repo only. | Server |
| B3f | `resolve-place` radius 100→500 + numbered-address routing | server | New rules created via voice still default to 100m radius (too tight for real-world arrivals). Also: queries that start with a street number (e.g. "1200 Terranova") should route through Google Geocode API, not textsearch — textsearch falls back to a centroid for street names. Both fixes are small server-side updates to `resolve-place`. | Server |
| B3g | OAuth silent-revoke detection — users can lose Naavi without any signal | server | Discovered 2026-05-17 — Huss's Google refresh token returned `invalid_grant` (revoked) and Naavi silently failed all his calendar operations. No proactive detection. Build a daily cron that pings Google for each user's token; on `invalid_grant`, mark `user_settings.google_token_revoked=true` and send a push notification ("Reconnect Naavi to Google"). Server-only. | Server |
| B3h | `isValidE164` strict 10-digit-after-+1 enforcement | mobile | `+1234567891` (only 9 digits after +1) currently passes validation and pretty-prints as `+123 4567891` (greedy regex matches +123 as country code). Tighten validator to require exactly 10 digits when number starts with +1. Rare typo case. ~15 min, ships with next AAB. | AAB |
| B3i | Brief reader other than home — `lib/memory.ts` + `assistant-fulfillment` Edge Function read only `start_time` | both | After CLAUDE.md Rule 18 fix 2026-05-17, all-day events store with `start_time=NULL` + `start_date` populated. The home-brief reader was updated. `lib/memory.ts::searchCalendarMemory` and `supabase/functions/assistant-fulfillment` still read only `start_time` → all-day events silently invisible to calendar memory search + voice fulfillment. Add `is_all_day` branch to both. | Both |

---

## Features (F)

| ID | Description | Surface | Notes | Server/AAB |
|----|-------------|---------|-------|------------|
| F2a | Onboarding Review (multi-phone + 7 other gaps) | mobile | Onboarding doc + Settings UI covering 8 gaps (multi-phone setup, voice keyterms capture at setup, quiet hours field, verified-address expectation, consolidated privacy callout, post-install rehearsal with starter prompts, re-install / new-phone flow, first-week-vs-week-two expectation calibration). Postponed 2026-05-09 — not all 8 have crisp product decisions; needs a dedicated session looking at onboarding end-to-end. Settings UI changes require AAB; doc is a build-script regen. | Both |
| F2b | Demo line maturity (richer scenarios + conversion path + telemetry) | voice | Demo phone line gets richer scenarios, a conversion path back to a real account, and telemetry to see what works. Postponed 2026-05-09 — marketing/growth decisions (which metrics matter, which scenarios resonate) need a focused session. Three sub-pieces in sequence: telemetry first (total calls, scenario popularity, opt-in rate, signup conversion), conversion attribution second (per-call token in the SMS link), scenario richness third (medication scheduling, navigation, recurring delegation, variable data, light branching). Already shipped: 5 canned scenarios, name capture, personalized SMS recap. | Server |
| F4a | Voice action parity — DELETE_EVENT, LIST_RULES, DELETE_MEMORY on the voice surface | voice | Mobile chat surfaces these actions; voice surface does not. User asks voice to delete a calendar event or list their alerts and voice can't complete. Server-side voice-server + voice-prompt updates. Related to B2a (voice SCHEDULE_MEDICATION) but covers separate actions. | Server |
| F4b | Inbound SMS / WhatsApp queryability — capture path for incoming messages | both | Outbound is covered (sent_messages table + Global Search). Inbound has no capture path — user can't ask "did anyone text me?". Reopened from F1b-closed 2026-05-09 only if a clean architectural path emerges (WhatsApp Business API has structural limits; SMS via Twilio proxy needs carrier-level config most users can't manage). Queued for revisit, not for build. | Both |
| F4c | Help section / user-manual website — recipe pages + Aura narration | website | New `/help/` section on mynaavi-website. Landing page + Quick Start (`/help/start`) + first recipe (`/help/i-want-to/arrive`) shipped 2026-05-17 with Aura Hera audio. Remaining: 7 more recipe pages (send-message, remember, today, list, email, call-from-anywhere, someone-set-up-for-me) + reference pages (settings, troubleshoot, privacy) + audio for each. Plus repoint `/how-to-use` → `/help/` with content fold. Marketing site only. | Server |
| F4d | AWS Polly voice unification — mobile → phone | both | Decision 2026-05-04: unify mobile + phone TTS on Polly Joanna (rejected Aura speed parameter approach). Migration not yet started. Today both surfaces use Aura Hera; the unification would be a switch to Polly. Memory: `project_naavi_voice_unification_open.md`. | Both |

---

## Tooling (T)

| ID | Description | Surface | Notes | Server/AAB |
|----|-------------|---------|-------|------------|
| T1a | Migrate both surfaces to Anthropic Structured Outputs | both | Migrate phone and mobile to Anthropic's Structured Outputs API (Nov 2025 GA). Voice on tool-use today; mobile on JSON-in-prompt; neither on Structured Outputs. Convergence eliminates the recurring prompt-drift cycle at the API level and mechanically guarantees action-emission parity across surfaces. ~1 focused session. | Server |
| T2a | Maestro full-suite mobile UI test coverage | mobile | Mobile UI test suite — 13 scenarios. Smoke passes. Full suite 2026-05-08: 6 pass, 7 fail. Failures look like a mix of stale assertions (UI labels renamed since test was written) and real regressions. Triage required before the suite becomes a pre-build gate. | Server |
| T2b | Phase 2 demo data (Gmail seeding for mynaavidemo) | backend | Demo-data seeding for the demo account — Phase 1 (calendar) shipped; Phase 2 (Gmail) gap. Use cases: mobile-app demo recordings without personal data, deterministic backing for the Maestro spend-summary scenario, and future un-canning of the demo phone line. ~30 min to add and run the seed. | Server |
| T3a | Pre-invite human-tester runbook + sharp test boundary | testing | Per Wael 2026-05-17: every new tester needs a defined runbook before going live. Draft v1 was 34 rows of generic onboarding QA (too broad — handled by standard support). Sharpened to 3-row pre-release-specific test (drive geofence + voice stop-word + inset corruption opportunistic). Wael then re-framed: separate "always human" tests (intrinsic, ~8 items) from "currently human" tests (gap, ~4 items). `docs/PRE_INVITE_SMOKE_TEST.md` (full version) + `docs/TEST_RESPONSIBILITY_MATRIX.md` (26-row 3-bucket classification) shipped. Open: implement the Bucket A automation gaps (Maestro UI flows, Twilio E2E for PIN, voice action parity tests). | Server |
| T3b | OAuth health monitoring cron — replaces silent token-revoke discovery | backend | Pairs with B3g (the bug). Daily cron pings Google for each `user_tokens.refresh_token`; on `invalid_grant`, marks user as needing re-auth + sends a push notification. Server-only, ~1-2 hours build. | Server |
| T3c | Voice automated regression suite (W3 from Voice Completion Roadmap) | voice | Voice surface has no automated regression coverage today. W3 from `docs/VOICE_COMPLETION_ROADMAP_2026-05-08` defines the suite. Pairs with T1a (Structured Outputs convergence) — both together close the cross-surface drift gap that Rule 16's `parity-impact:` discipline currently fills manually. Server-only. | Server |

---

## Ideas (I)

Brainstorming-stage entries. Path or scope not yet chosen. Promote to F when committed as a real feature.

| ID | Description | Surface | Notes | Server/AAB |
|----|-------------|---------|-------|------------|
| I2a | `list_change` alert trigger | backend | Alert when a list changes — e.g., *"alert when grocery list hits 10 items"* or *"alert when to-do is empty."* Deferred — 7 design questions open with stub answers (third-party routing, threshold semantics, etc.). ~½ session design + ½ session build. | Server |
| I2b | `price` alert trigger | backend | Alert when a price drops — flight, retail item, gas. Deferred — external integration path not chosen (scraping fragility, paid-API costs, vertical fragmentation across flights / hotels / retail / gas). Path-selection decision is a focused session; build is real engineering after that. | Both |
| I3a | `health` alert trigger (Epic / wearable integration) | backend | Alert when a health metric changes — *"alert me if my pulse is above 120"*, *"text my wife if BP > 180"*. Blocked — Epic FHIR account, healthcare-data agreement, privacy review, and wearable SDK integration are multi-month wall-clock prereqs. Trigger handler itself is small; compliance + ingestion infrastructure dwarfs it. Parked-deep until any one of those prereqs becomes a live initiative. | Both |

---

## Closed without entry

Items walked but not added to any table. Reopen if symptom recurs.

| Holding-list # | Item | Reason closed |
|---|---|---|
| 4 | Geofence reliability (pending phone reboot) | Tested per Wael 2026-05-08 — no problems found. Will be reported if recurs. Underlying Google-OAuth disconnect bug (Phase 3 background-mode blocker) noted but not preemptively tracked — same rule. |
| 12 | `naavi-spend-summary` Edge Function | Already shipped — function exists at `supabase/functions/naavi-spend-summary/index.ts`, aggregates `documents.extracted_amount_cents` directly, multi-user safe, multi-currency aware. Maestro `e2e/06-spend-summary-anthropic.yaml` PASSED in 2026-05-08 full-suite run. Holding-list "approved 2026-04-30, not built" was stale. |
| 14 | Demo line "remind me" time-extraction loop | Symptom impossible by architecture — demo line is now fully canned (5 hard-coded scenarios via DTMF + speech routing); no real reminder path exists on demo. Underlying bug (time-extraction loop) may still affect authenticated users on production line — log if it surfaces. |
| B1a | Voice live-calendar fetch (voice still on stale snapshot) | **Validated by user test 2026-05-08 (first item under CLAUDE.md Rule 17).** Wael created a fresh Google Calendar event, asked voice (PC) — correct answer. Changed time + location, asked voice and mobile — both correct. Bug as classified does NOT reproduce in real use. The architectural read (voice reads from Supabase snapshot table populated every 6h) was correct about the code path but did not predict user-visible behavior; some sync mechanism (frequent cron, app-trigger, or push notification) keeps the snapshot fresh enough that staleness is not perceived. Reopen only if surfaces. |
| B1c | Naavi misses brand-new emails for up to an hour | **Closed 2026-05-09 — fully verified on both surfaces.** When the user asks an email-shaped question, Naavi now reaches Gmail directly so brand-new emails show up even before the hourly cron sync picks them up. Mobile half verified 2026-05-08 (Bob Invitation email found 3 min after arrival). Voice half initially appeared inconsistent on 2026-05-08; root cause traced 2026-05-09 to missing Railway env vars (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) — without them the voice OAuth refresh failed silently and the live-overlay never reached Gmail. After adding the env vars, both surfaces verified working with fresh emails (Football Game and Birthday Cake tests). Companion enhancement same session: live-overlay now states arrival time as clock time (e.g. "arrived at 10:59 AM") instead of relative minutes, on both surfaces. |
| B2b | You can't interrupt Naavi mid-sentence on the phone | **Closed 2026-05-09 — improved by music-queue drain fix.** Root cause was Twilio's outbound audio queue holding 5+ seconds of thinking music ahead of Naavi's reply; `stopMusic()` only cancelled the music interval but didn't drain the queue. Fix: `stopMusic()` now sends Twilio `event: 'clear'` to drain the outbound buffer. After the fix, "Naavi stop" successfully interrupts; first attempt sometimes missed (likely phone-side echo cancellation in speakerphone mode), second attempt always works. Was "broken" → now "works on second attempt 100%, first attempt sometimes missed." Real usability gain. Reopen if first-interrupt miss becomes a recurring complaint. |
| B2c | You can't talk over Naavi on the phone | **Closed 2026-05-09 — same root cause and fix as B2b.** Both interrupts share the `stopMusic()` code path; the queue drain that fixed B2b also fixes B2c. Same first-interrupt-miss limitation in speakerphone mode. |
| B2d | Voice name-search mistranscription ("Hussein") | **Closed 2026-05-10 — the F2c structural fix was decided not to implement.** Originally pivoted to F2c (walkie-talkie turn-taking) on 2026-05-08, but F2c was closed 2026-05-10 (marker-word ambiguity + today's latency work reduced the underlying pain). The remaining mitigation for name-search STT failures is the existing keyterms-capture feature and the continuing silence-detection improvements. Reopen if Hussein-style mistranscription recurs as a real user pattern. |
| F1b | Inbound SMS / WhatsApp queryability | **Closed 2026-05-09 — no viable architecture identified.** WhatsApp inbound is structurally impossible (Meta restricts the WhatsApp Business API to business-to-customer messaging; would require Robert's contacts to message a separately-verified business number, not viable). SMS via OS-level `READ_SMS` carries Google Play rejection risk (use case not on Google's allowlist for AI assistants) and iOS isn't supported at all. SMS via Twilio proxy / carrier forwarding requires every contact to change behavior or carrier-level config most users can't set up alone. Email already covers ~80% of the underlying use case. Reopen if a clean architectural path emerges. Reference memory: `project_naavi_inbound_sms_whatsapp.md`. |
| F1c | Voice privacy UX (4-piece auto-classification bundle) | **Closed 2026-05-09 — superseded by F1d (user-controlled mute).** The 4-piece bundle would have auto-classified items as private (medical / financial / legal) and offered SMS alternatives at read time. Wael 2026-05-09: auto-classification creates an unfixable social problem — forcing Robert to publicly engage in the privacy dialogue (*"want me to text it?"*) itself reveals he has something to hide. False positives compound this: a pharmacy newsletter wrongly tagged "medical" would force the dialogue for nothing. Robert can't gracefully recover from misclassification in a public setting. The simpler reactive approach (F1d) — Robert decides in the moment whether to mute — avoids the false-positive social cost entirely while solving the same underlying privacy need. Reference memory: `project_naavi_voice_privacy.md`. |
| F2c | Walkie-talkie style turn-taking on voice — explicit end-of-message signal | **Closed 2026-05-10 — decided not to implement.** Marker-word ambiguity remained unresolved (*"over"* appears in everyday speech; alternatives like *"go ahead"* / sentence-ending *"Naavi"* each had their own issues). Today's voice-call latency work (Polly gate prompt, pre-fetch on call connect, Haiku for brief, Twilio AMD removal) brought the answer-to-brief gap from ~13s to ~6s — the turn-boundary pain F2c targeted is less acute now. Existing silence-detection improvements (echo cancellation, smarter timing) remain the right ongoing path. Reopen only if a concrete marker-word design plus a real recurring turn-boundary symptom both surface. |
| B3c | Haptic vibration feels too subtle on Samsung long-press | **Parked 2026-05-10 — duration bump did NOT solve the bug.** Build 166 shipped `Vibration.vibrate(80)` → `Vibration.vibrate(150)`. On Wael's Samsung One UI / Android 14 device: long-press triggers the recording UI (function fires correctly) but produces NO perceptible buzz — both `Vibration.vibrate` and `Haptics.impactAsync(Heavy)` silently fail despite OS-level vibration intensity ~80% and all System vibration toggles ON. Suggests an Android 14 / Samsung-specific API issue, not a code-logic issue. Reopen with a new approach (vibration pattern instead of single shot, runtime VIBRATE permission re-check, or a different library like `react-native-haptic-feedback`) when haptic UX becomes a priority again. |
| B3b | Cosmetic ruler leak on long-wrap user bubbles | **Parked 2026-05-10 — cosmetic, low priority.** Build 166 shipped the one-line fix (`color: 'transparent'` → `opacity: 0` on the chat-bubble ruler style). Not retested by Wael (haptic distraction took precedence). The fix is shipped and ready to verify in a future session; until then it's parked because it's a cosmetic-only issue (faint dots behind a long user bubble on Samsung) with no functional impact. Reopen if the dots are visibly annoying when next viewed on a long bubble. |
| B3a | User hears two voices on mobile: Naavi's voice + the phone's built-in voice | **Parked 2026-05-10 — Path 1 only partially solved the bug.** Build 166 shipped Path 1 (`staysActiveInBackground: true` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permission). Wael's test result: background-during-reply keeps the cloud voice cleanly (Path 1 working), but resume-to-foreground mid-reply still triggers fallback to phone's native voice (Path 1 doesn't cover the resume case). Path 2 (custom Expo plugin declaring an Android foreground service for media playback) is the next step but parked until cloud-voice consistency becomes a recurring complaint. Reopen with Path 2 when the foreground-resume audio fragmentation becomes annoying. |
| F1d | User-controlled mute on PC + Mobile (replaced F1c) | **Closed 2026-05-13 — fully shipped across mobile + voice + backend + web page, all live tests passed.** Sub-pieces shipped: (a) Mobile long-press → mute mid-TTS in V57.14.1 build 167 (commit `663d440`); (b) Voice phrases "no sound" / "quiet" / "shh" → mute on phone via step 3 backend (`6ba6d2b`); (c) "Want me to text the rest?" offer wired in step 2 + 3; (d) SMS hot-link delivery via `/r/<token>` web page (`6448cb0` + route fix `bc810d9`); (e) Hosted-replies backend storage + Edge Functions + 5 tests in auto-tester (`9259887`, still 5/5 green as of 2026-05-17); (f) Live Twilio tests 3 + 4 PASS with 4 voice-server fixes (`4eef2da` `2b86391` `01d4f72` `1f14748`) — recursive mute, 30-sec silence false-positive guard, Deepgram confusables regex, aggregated-text UtteranceEnd check, SMS confirmation TTS clarity, idle-prompt suppression during quiet windows. Doc-vs-reality note: spec said mobile half would ship via EAS Update (OTA); in practice it shipped bundled in AAB build 167 — same outcome, just AAB not OTA. Reference memory: `project_naavi_voice_privacy.md`. |
| B1b | LIST_RULES backstop on mobile | **Closed 2026-05-11 — V57.14.0 build 166 (commit `bd52106`, "B1b + B3b + B3c + B3d bundle").** Mobile orchestrator now correctly lists user's alerts when asked. Verified on Wael's phone after install. |
| B1d | Pre-search "Nothing matched" gag override | **Closed 2026-05-10 — server side (`b667115` downgrade gag to defer-to-system-prompt) + mobile soft-gag wording shipped via subsequent AABs (V57.14.x onwards).** Issue tracked via `a761220` instrumentation no longer fires under normal use. |
| B2e | Naavi misses recent emails until hourly sync | **Closed 2026-05-10 — V57.13.x bundle.** Live-overlay window widened to 24h (2026-05-09) + capacity raised 10→30 emails (commit `ecb6ec1`). Brand-new emails now appear in answers within seconds of arrival on both surfaces. |
| B3d | Verified-address rejection doesn't name the address | **Closed 2026-05-14 — V57.14.0 build 166 (`bd52106` mobile orchestrator) + V57.15.5 build 177 (`5ce56ad` polish completing remaining sites at orchestrator lines 830, 924, 1419).** Mobile rejection now names the place; voice path covered in same bundle. |
| F1a | Lists wired to entities (alerts / calendar events / reminders) | **Closed 2026-05-12 — V57.15.0 build 171 (`a705196`) and follow-ups.** Sub-pieces shipped: Wave 1 server-side `resolve-entity-ref` + 6 prompt-regression tests (`d49be81`); Wave 2 Phase A orchestrator handlers (`29bc028`); Phase B Lists screen + list-detail + 3-dots menu entry (`a8fcc29`); Phase C alert-detail "Attached list" card (`4147a61`); Phase E multi-phone identity migration + Settings UI (`1195b17`); Wave 2.5 list↔entity cardinality M:N pivot (`910561f`); Wave 2.6 Drive↔DB hard sync (`1afe21b`). V57.15.1 build 172 mobile chat injects LIST_CONNECTION_QUERY answer (`429b1ea`). V57.15.4 build 175 added newline formatter + tappable list rows. Auto-tester `list-connections` + `lists-reconcile` suites green. |
| F3a | Picovoice Eagle voice biometric (caller voiceprint ID) | **Closed 2026-05-13 — vendor dropped, replaced by 4-digit caller PIN (commit `b22f5d9` "drop Picovoice voice biometric, queue PIN-flow build instead").** Picovoice approval queue stalled 2 weeks; Wael chose industry-standard PIN pattern over biometric (no vendor dependency, ~1 hour to build vs unknown timeline). PIN flow shipped V57.15.5 build 176 (`fae265c`) + build 177 (`5ce56ad`). Memory: `project_naavi_caller_pin_chosen_over_biometric.md`. Reopen if biometric becomes a real product requirement and a vendor selection unblocks. |

---

## Shipped this session (2026-05-09)

Items not in the original 26-item holding list but addressed during the session:

- **PC outbound latency** — user-perceived gap from "you finish speaking" to "Naavi starts replying" on phone calls reduced from ~14 s to ~4 s on trivial questions. Wave-test ground truth showed ~7 s of stale thinking-music tail blocking Naavi's reply (Twilio's outbound audio queue held up to 5 s of music ahead of every reply). Fix: `stopMusic()` now drains Twilio's outbound buffer immediately via `event: 'clear'`. Companion change: chunk size aligned to Twilio's documented 20 ms expectation (was 1 s). Reverses the 2026-04 "do NOT drain queue" memory directive — the original cost was assumed to be 1.3–1.5 s but was actually 5–7 s. Memory file `project_naavi_music_queue_latency.md` updated. **Bonus:** the same fix also closes B2b and B2c (interrupts now work) since they shared the `stopMusic()` code path.

---

## Final tally

| List | Count | IDs |
|---|---|---|
| Bugs (B) | 11 | B2a, B2g, B2h, B2i, B2j, B2l, B3e, B3f, B3g, B3h, B3i |
| Features (F) | 6 | F2a, F2b, F4a, F4b, F4c, F4d |
| Tooling (T) | 6 | T1a, T2a, T2b, T3a, T3b, T3c |
| Ideas (I) | 3 | I2a, I2b, I3a |
| Closed without entry | 21 | Items 4, 12, 14, B1a, B1b, B1c, B1d, B2b, B2c, B2d, B2e, B3a, B3b, B3c, B3d, F1a, F1b, F1c, F1d, F2c, F3a |
| **Total** | **47** | (26 original holding-list + 5 items added across earlier sessions: B1c B1d B2e F1d F2c + 16 items added 2026-05-17: B2g B2h B2i B2j B2l B3f B3g B3h B3i F4a F4b F4c F4d T3a T3b T3c. Net active: 26; closed: 21.) |

### Tally by Server/AAB

| Scope | Count | Implication |
|---|---|---|
| Server-only | 8 | Ship without AAB cycle |
| AAB-only | 2 | Mobile build required (B1b, B1d already shipped in build 166 — verified) — bundle into next AAB |
| Both | 6 | Cross-surface coordination |

### Tally by Surface (cross-surface drift discipline)

| Surface | Count | IDs |
|---|---|---|
| voice | 6 | B2a, B2g, B2h, B2i, B2j, F2b, F4a |
| mobile | 4 | B2l, B3h, F2a, T2a |
| both | 5 | B3i, F4b, F4d, T1a, T3c |
| backend | 6 | B3f, B3g, T2b, T3b, I2a, I2b, I3a |
| website | 2 | B3e, F4c |
| testing | 1 | T3a |

Items tagged `both` are the ones where Voice Completion Roadmap discipline matters most — when one surface ships, the other must follow before drift accumulates.

### Tally by severity (active items, excluding closed)

Severity buckets are best-estimate per item; refine as the inventory matures.

| Severity | B | F | T | I | Total |
|---|---|---|---|---|---|
| 1 (top) | 4 | 1 | 2 | 0 | 7 |
| 2 (medium) | 4 | 4 | 3 | 2 | 13 |
| 3 (low) | 3 | 1 | 1 | 1 | 6 |
| **Total** | 11 | 6 | 6 | 3 | **26** |

(Total active = 26. Add 21 closed-without-entry to reach the 47-item total. Last bulk inventory refresh: 2026-05-17.)

---

## Session method

- Walked all 26 holding-list items one at a time, with explicit user "done" signal between items.
- Each item: research the codebase + memory, propose classification + severity + notes, user accepts / pushes back / closes.
- One missed item surfaced post-walk (B1c email instant-search) and was added on Wael's catch.
- Architectural principle (sync + live-overlay per channel) crystallized via B1c discussion.
- Three holding-list items closed without entry (Items 4, 12, 14) where the symptom was already gone or already shipped.
- Surface column added 2026-05-08 (post-walk) as cross-surface drift discipline. See CLAUDE.md Rule 16 + Voice Completion Roadmap W2 / W3 for the full discipline / automation story.

This document is the canonical output. Future implementation work should reference IDs (e.g., "ship B1a + B1c together; both port the live-fetch pattern").
