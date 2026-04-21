# Session 20 — Global Search & Alert

**Status:** upcoming. Scope locked on 2026-04-20 at Session 19 close.
**Previous session:** `SESSION_19_COMPLETE_HANDOFF.md` — read first.

---

## Session headline

Two threads, one session:

1. **Close Global Search.** Every content repo is now adapter-covered as of Session 19; the one remaining task is to resolve the school-calendar PDF read that didn't fire at Session 19 close. After that, Global Search is "done" for Robert's existing data.

2. **Open Alert.** Today Naavi has three trigger types (email, time, calendar). This session starts the expansion into the six missing trigger types enumerated in `project_naavi_alert_scope.md`. Wael specifically flagged location as the highest-leverage one: *"Alert me to call Sarah when I'm at the Great Mall"* and *"Remind me when I'm at Costco"*.

---

## First — resolve the one open item from Session 19

**The school-calendar PDF read didn't produce an answer** on the user's mobile test. Detailed context in `SESSION_19_COMPLETE_HANDOFF.md` → "Open diagnostic" section.

**First-move checklist:**

1. Verify the phone is on **V53.4 build 100** (app → Settings → bottom of screen). If still V53.3, wait for Google Play rollout or force-update via Play Store.
2. Once on V53.4, repeat the test: *"When is the first day of school?"*
3. Immediately (within 30 s) open the Supabase `naavi-chat` logs and search for that user's call:
   - Confirm `[TRACE-3 naavi-chat] userText full:` line has "school" in it.
   - Confirm `[timing] XXms | calendar PDF attached for Claude` appears right after.
4. Decision tree from there:
   - Both lines present + Claude's answer still wrong → prompt-priority fix; tighten naavi-chat to say "use the attached PDF to answer the date question."
   - PDF attach line missing → either regex didn't match (adjust `CALENDAR_INTENT_RE`) or `document_type='calendar'` lookup missed (verify SQL).
   - No TRACE-3 at all → the mobile client took a different code path; trace via `hooks/useOrchestrator.ts`.

Expected answer once working: *"The first day of school is September 2, 2025."*

---

## Then — Alert scope expansion

Full design in `project_naavi_alert_scope.md`. Natural build order:

### 1. `weather` trigger — cheapest, highest-frequency Robert value

*"Text me if it rains tomorrow"* / *"Alert me if temperature drops below zero overnight."*

- Reuses weather API already live in voice server (`fetchWeather`).
- New `trigger_type='weather'` in `action_rules` CHECK constraint.
- Daily cron evaluates matched rules, fires SMS/WhatsApp/email as usual.
- Claude prompt rule to emit this new trigger from weather-sounding user phrases.

Estimated effort: 1-2 days.

### 2. `contact_silence` — "I haven't heard from Sarah in a while"

*"Tell me if my sister Sarah hasn't emailed in 30 days."*

- Inverse of the email trigger. Reads `gmail_messages`.
- Self-contained — no external APIs needed.

Estimated effort: 1 day.

### 3. `list_change` — "Grocery list hit 10 items"

*"Text me when the grocery list is full."*

- Hooks into `manage-list` write path.
- Small code, household value.

Estimated effort: 0.5 day.

### 4. `location` — Wael's flagship use-case

*"Alert me to call Sarah when I'm at the Great Mall."*
*"Remind me to buy milk when I'm at Costco."*

- Biggest architectural piece:
  - Phone-side background geofencing (Expo Location, with background tracking permission).
  - Google Places API to convert a place name ("Great Mall") into lat/lng + radius.
  - New `trigger_type='location'` in `action_rules`.
  - Backend evaluator gets location pings from the phone and fires matched rules.
- Privacy review required: location is sensitive; Robert needs consent at setup and a kill switch.
- AAB required (background location).

Estimated effort: 2-3 weeks if done properly. A toy demo (foreground location only, no background) could ship in a few days.

### 5. `health` trigger — depends on Epic FHIR wiring

Deferred unless Epic integration is actively being built.

### 6. `price` trigger

Deferred — external scraping / API complexity for low-confidence senior-user value.

---

## Secondary — other items parked at Session 19 close

None of these are required for Session 20 but can be tackled if time allows:

- **Voice-side privacy UX** (`project_naavi_voice_privacy.md`) — 4-piece feature. Larger than any single Alert item. Consider for Session 21.
- **Voice first-word truncation fix** — attempted and reverted in Session 19. Re-approach with actual Deepgram log inspection before touching the regex again.
- **Voice stop-word regression** (`project_naavi_stop_word_regression.md`) — "Naavi stop" no longer interrupts TTS.
- **Voice email reconstruction piece 2** — short-form "Bob at gmail.com" in voice server.
- **Mobile mirror of calendar ask-time PDF reader** — queued for the next AAB in `project_naavi_next_mobile_build.md` item #9.

---

## Ground rules — same as Session 18 and 19

1. Do not craft test scripts to make tests pass. Call out known-fragile paths upfront.
2. Test what the end user would actually do (voice input included).
3. Do not re-run with a softer query to turn red into green.
4. "It worked on my side via curl" does not close the loop. It closes on the user's phone.
5. No test theater.
6. Do not assume. When a fix doesn't work, instrument and observe before proposing the next one.
7. Do not blindly mirror patterns across features. Check the actual code path.

---

## Success criterion

Session 20 succeeds when:

1. The school-calendar PDF read works — user asks "when is the first day of school?" on the phone and hears the correct date.
2. At least ONE new trigger type (`weather`, `contact_silence`, or `list_change`) is shipped end-to-end with a working rule in `action_rules` and a verified fire.
3. `project_naavi_alert_scope.md` is updated to reflect which triggers are now live vs. still on the roadmap.

Bonus if time allows:

4. Foundation for `location` trigger — phone-side background location permission + one test fire via manual GPS set.

---

## Work log

*To be filled in when Session 20 starts.*
