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
| B1b | LIST_RULES backstop on mobile (revised 2026-05-08 after user-test) | mobile | Phone (PC) lists alerts correctly. Mobile (MV) says *"I don't have any alerts in your records"* when 7+ alerts exist in Settings. Mobile-side fix queued for next AAB. | AAB |
| B1d | Pre-search "Nothing matched" gag overrides server-side live-overlay | mobile | After app reopen, the first email question answers correctly but a similar follow-up answers *"I don't have an email"* even when the email exists. Server-side fixes shipped 2026-05-10: search now finds naturally-phrased queries; recent-emails window covers up to 30 emails over 24 h; a TRUTH AT USER LAYER prompt rule makes Naavi answer the source the user named; deleted/trashed emails are excluded. Mobile-side soft-gag wording change is in `main` — queued for next AAB to fully close. | AAB |
| B2a | Voice promises to schedule medication but doesn't create the events | voice | Voice says *"I'll set up your aspirin schedule"* but nothing lands in Google Calendar. Mobile already does this correctly. Server-side fix copies the mobile path. While there, verify voice memory-deletion (*"forget about X"*) matches mobile. | Server |
| B2e | Naavi misses recent emails (1+ hours old) until the hourly sync runs | both | Naavi missed emails between 1 hour old and the next hourly sync. Shipped 2026-05-09 (window widened to 24 h on both surfaces) + 2026-05-10 (capacity raised from 10 to 30 emails on both surfaces). Effectively closed; move to Closed at next session. | Server |
| B3d | Verified-address rejection doesn't name the address | both | When Naavi rejects an unverified destination, she says *"I can't confirm that address"* without naming the address. Add the destination to the rejection on both surfaces (e.g., *"I can't confirm '<destination>' for your meeting today"*). Mobile change requires AAB; voice prompt is server-only. | Both |
| B3e | Two blog articles still on age framing (banned-terms violation) | website | Two blog articles still use age framing (banned per 2026-05-05). Three options: delete both; rewrite in time-scarcity tone; or rewrite cards only and delete posts (avoid — broken links). Pick before next content session. Mynaavi-website repo only. | Server |

---

## Features (F)

| ID | Description | Surface | Notes | Server/AAB |
|----|-------------|---------|-------|------------|
| F1a | Lists wired to entities (alerts / calendar events / reminders) | mobile | A list is a first-class entity that can be CONNECTED to any alert / calendar event / reminder. One list ↔ many entities; each entity ↔ at most one list. Voice vocabulary (connect / attach / link / disconnect / query), confirmation flow, cascade behavior, and migration of today's two patterns (inline tasks + shared-list name) all defined. New Lists section in the 3-dots menu with three subcategories (All / Connected / Standalone). **Spec locked 2026-05-09 — no open design questions.** ~1.5–2 focused sessions: backend migration + mobile UI. | Both |
| F2a | Onboarding Review (multi-phone + 7 other gaps) | mobile | Onboarding doc + Settings UI covering 8 gaps (multi-phone setup, voice keyterms capture at setup, quiet hours field, verified-address expectation, consolidated privacy callout, post-install rehearsal with starter prompts, re-install / new-phone flow, first-week-vs-week-two expectation calibration). Postponed 2026-05-09 — not all 8 have crisp product decisions; needs a dedicated session looking at onboarding end-to-end. Settings UI changes require AAB; doc is a build-script regen. | Both |
| F2b | Demo line maturity (richer scenarios + conversion path + telemetry) | voice | Demo phone line gets richer scenarios, a conversion path back to a real account, and telemetry to see what works. Postponed 2026-05-09 — marketing/growth decisions (which metrics matter, which scenarios resonate) need a focused session. Three sub-pieces in sequence: telemetry first (total calls, scenario popularity, opt-in rate, signup conversion), conversion attribution second (per-call token in the SMS link), scenario richness third (medication scheduling, navigation, recurring delegation, variable data, light branching). Already shipped: 5 canned scenarios, name capture, personalized SMS recap. | Server |
| F3a | Picovoice Eagle voice biometric (caller voiceprint ID) | both | Naavi recognizes who's speaking on a shared phone via voiceprint ID. Deferred until unknown-number caller confusion shows up as a real user pattern. Decoupled from F2a multi-phone work — multi-phone ships first via the additional-phones list, no biometric coupling. Vendor: Picovoice Eagle primary, ID R&D backup. Stays in Features (not Ideas) — solution exists; only vendor selection is open. | Both |

---

## Tooling (T)

| ID | Description | Surface | Notes | Server/AAB |
|----|-------------|---------|-------|------------|
| T1a | Migrate both surfaces to Anthropic Structured Outputs | both | Migrate phone and mobile to Anthropic's Structured Outputs API (Nov 2025 GA). Voice on tool-use today; mobile on JSON-in-prompt; neither on Structured Outputs. Convergence eliminates the recurring prompt-drift cycle at the API level and mechanically guarantees action-emission parity across surfaces. ~1 focused session. | Server |
| T2a | Maestro full-suite mobile UI test coverage | mobile | Mobile UI test suite — 13 scenarios. Smoke passes. Full suite 2026-05-08: 6 pass, 7 fail. Failures look like a mix of stale assertions (UI labels renamed since test was written) and real regressions. Triage required before the suite becomes a pre-build gate. | Server |
| T2b | Phase 2 demo data (Gmail seeding for mynaavidemo) | backend | Demo-data seeding for the demo account — Phase 1 (calendar) shipped; Phase 2 (Gmail) gap. Use cases: mobile-app demo recordings without personal data, deterministic backing for the Maestro spend-summary scenario, and future un-canning of the demo phone line. ~30 min to add and run the seed. | Server |

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

---

## Shipped this session (2026-05-09)

Items not in the original 26-item holding list but addressed during the session:

- **PC outbound latency** — user-perceived gap from "you finish speaking" to "Naavi starts replying" on phone calls reduced from ~14 s to ~4 s on trivial questions. Wave-test ground truth showed ~7 s of stale thinking-music tail blocking Naavi's reply (Twilio's outbound audio queue held up to 5 s of music ahead of every reply). Fix: `stopMusic()` now drains Twilio's outbound buffer immediately via `event: 'clear'`. Companion change: chunk size aligned to Twilio's documented 20 ms expectation (was 1 s). Reverses the 2026-04 "do NOT drain queue" memory directive — the original cost was assumed to be 1.3–1.5 s but was actually 5–7 s. Memory file `project_naavi_music_queue_latency.md` updated. **Bonus:** the same fix also closes B2b and B2c (interrupts now work) since they shared the `stopMusic()` code path.

---

## Final tally

| List | Count | IDs |
|---|---|---|
| Bugs (B) | 6 | B1b, B1d, B2a, B2e, B3d, B3e |
| Features (F) | 4 | F1a, F2a, F2b, F3a |
| Tooling (T) | 3 | T1a, T2a, T2b |
| Ideas (I) | 3 | I2a, I2b, I3a |
| Closed without entry | 15 | Items 4, 12, 14, B1a, B1c, B2b, B2c, B2d, F1b, F1c, F1d, F2c, B3c, B3b, B3a |
| **Total** | **31** | (26 holding-list + 1 missed item B1c added 2026-05-08 + 1 new feature F2c added 2026-05-08 — closed 2026-05-10 + 1 new feature F1d added 2026-05-09 superseding F1c — closed 2026-05-13 + 1 new bug B2e added 2026-05-09 + 1 new bug B1d added 2026-05-10) |

### Tally by Server/AAB

| Scope | Count | Implication |
|---|---|---|
| Server-only | 8 | Ship without AAB cycle |
| AAB-only | 2 | Mobile build required (B1b, B1d already shipped in build 166 — verified) — bundle into next AAB |
| Both | 6 | Cross-surface coordination |

### Tally by Surface (cross-surface drift discipline)

| Surface | Count | IDs |
|---|---|---|
| voice | 2 | B2a, F2b |
| mobile | 5 | B1b, B1d, F1a, F2a, T2a |
| both | 4 | B2e, B3d, F3a, T1a |
| backend | 4 | T2b, I2a, I2b, I3a |
| website | 1 | B3e |

Items tagged `both` are the ones where Voice Completion Roadmap discipline matters most — when one surface ships, the other must follow before drift accumulates.

### Tally by severity (active items, excluding closed)

| Severity | B | F | T | I | Total |
|---|---|---|---|---|---|
| 1 (top) | 2 | 2 | 1 | 0 | 5 |
| 2 (medium) | 1 | 1 | 2 | 2 | 6 |
| 3 (low) | 3 | 1 | 0 | 1 | 5 |
| **Total** | 6 | 4 | 3 | 3 | **16** |

(Total active = 16. Add 15 closed-without-entry to reach the 31-item total. F1d closed 2026-05-13.)

---

## Session method

- Walked all 26 holding-list items one at a time, with explicit user "done" signal between items.
- Each item: research the codebase + memory, propose classification + severity + notes, user accepts / pushes back / closes.
- One missed item surfaced post-walk (B1c email instant-search) and was added on Wael's catch.
- Architectural principle (sync + live-overlay per channel) crystallized via B1c discussion.
- Three holding-list items closed without entry (Items 4, 12, 14) where the symptom was already gone or already shipped.
- Surface column added 2026-05-08 (post-walk) as cross-surface drift discipline. See CLAUDE.md Rule 16 + Voice Completion Roadmap W2 / W3 for the full discipline / automation story.

This document is the canonical output. Future implementation work should reference IDs (e.g., "ship B1a + B1c together; both port the live-fetch pattern").
