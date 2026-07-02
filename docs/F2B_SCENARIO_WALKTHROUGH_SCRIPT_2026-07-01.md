# F2b Scenario Walkthrough — Full Call Script (word-for-word)

Companion to `docs/F2B_SCENARIO_WALKTHROUGH_PHASE2_2026-07-01.md` (Phase 1+2 plan, Phase 3-approved). That plan defines *routing* (which scenario plays when, the cap, the one-way gate). This doc defines the exact *words* Naavi says at every turn, end to end, so wording is reviewed and approved before Phase 4 code changes it.

Every line below is tagged:
- **[EXISTING]** — already live in `naavi-voice-server/src/index.js`, unchanged by this plan. Line refs point at the `staging` branch, commit `34d345d`.
- **[NEW]** — does not exist yet; needs your sign-off on the exact wording before Phase 4 writes it.

Voice throughout: Polly Joanna (per `project_naavi_voice_selection` — phone demo line stays on Polly, not Aura).

---

## 1. Call opens — name ask

**[EXISTING]** `index.js:6754`
> "Hi! This is Naavi. Who do I have the pleasure of speaking with?"

Caller says a name. Naavi reads it back:

**[EXISTING]** `index.js:7270`
> "I heard {name}. Is that right?"

Caller confirms "yes" →

---

## 2. NEW — bridge line into the scenario walkthrough — CONFIRMED (with-name variant)

**ADDED 2026-07-02 — SMS consent disclosure, said first, once per call (F2i):** required so the 888 toll-free number's TFV registration has a true, describable opt-in mechanism (failed twice on "Opt-in - Consent for messaging is a requirement for service" — nothing in the script disclosed a text would be sent). Deliberate partial reversal of the "zero friction" trims — confirmed worth the trade-off.
> "By staying on the line, you agree to receive a text from Naavi, including a recap of this call and any reminder you request. Message and data rates may apply. Reply STOP to opt out."

Immediately followed by the bridge line below, in the same combined `<Say>`:

**[NEW] — confirmed:**
> "Thanks {name}. I'm not connected to your calendar or emails yet, so here's a quick example. First up:"

*(Trimmed per live-call feedback 2026-07-01, 30 words -> 18, reason kept.)*

Reason added per your comment: the line now states *why* the scenarios that follow can't be his actual details — Naavi isn't connected to his accounts during this demo call, so what he's about to hear is illustrative, not his real data. This also protects against a caller assuming "team standup at 9, lunch with David" is really on his own calendar.

...immediately followed by the first scenario (§3). Always uses the with-name variant per your comment — no separate no-name branch needed unless a call reaches this point with no name resolved at all (rare: only after 3 failed name-capture attempts). For that edge case, drop just the name clause:

**[NEW] — no-name edge case only:**
> "I'm not connected to your calendar or emails yet, so here's a quick example. First up:"

**Your question — "Google account" vs. keep it simple:** recommend keeping it simple, no change needed. Reason: the 5 scenarios aren't all Google data — Today/Bills are Google (calendar/Gmail), but History (car service) and Capture (parking note) are personal notes Naavi keeps for him, not anything from a Google account. Naming "Google account" specifically would be accurate for 2 of 5 scenarios and misleading for the other 3. "Not connected to your real calendar or emails yet" stays generic enough to cover all five without overclaiming or underclaiming what's Google vs. what's just Naavi's own memory. Confirmed — no wording change.

---

## 3. Each scenario — conversational turns (line-numbered for review)

Same 5 topics and same facts as the production menu (`DEMO_SCENARIOS`, `index.js:6834-6870`), rewritten as back-and-forth turns instead of one paragraph block. Default order per the approved plan: `today → bills → history → location → capture` (`DEMO_SCENARIO_ORDER`, changeable via one constant).

Line codes are `S{scenario}.{line}` — comment against a code, e.g. "S2.3: change this."  All Naavi lines are **[NEW]** phrasing (turn-split); the underlying facts are **[EXISTING]**, unchanged from production.

**CONFIRMED per your comment — opening turn changed for all 5 scenarios:** the old open-ended invite ("Go ahead — ask me about your day") required the caller to come up with their own phrasing, which is slower and less reliable to match than a closed question. Every scenario now opens with a plain yes/no question instead — caller just says "yes," Naavi answers. `S{n}.2` is now a simple "Yes" rather than an example query.

### Scenario 1 — Today

| # | Speaker | Line |
|---|---------|------|
| S1.1 | Naavi | "Hear what's on your day?" |
| S1.2 | Caller | "Yes." |
| S1.3 | Naavi | "You've got three. Nine — team standup. Noon — lunch with David, he just confirmed. Four — Sam's recital." |
| S1.4 | Naavi | "Quick heads-up — rain's rolling in around three, give yourself a few extra minutes." |
| S1.5 | Naavi | "Want to hear another example, or should we set up a reminder for you?" |

> **Your comment:**

### Scenario 2 — Bills

| # | Speaker | Line |
|---|---------|------|
| S2.1 | Naavi | "Hear about your bills and emails?" |
| S2.2 | Caller | "Yes." |
| S2.3 | Naavi | "Three this week. Hydro — eighty-two dollars, due Friday. Bell — ninety-six, on autopay." |
| S2.4 | Naavi | "Hilton from your Toronto trip — three hundred forty-five came in this morning." |
| S2.5 | Naavi | "Want to hear another example, or should we set up a reminder for you?" |

*(Trimmed per live-call feedback 2026-07-01 — dropped "I tagged it for expenses" and "All three are filed in your Drive under Bills," ~14 words of detail that wasn't the point of the demo. Old S2.5/S2.6 renumbered to S2.5.)*

> **Your comment:**

### Scenario 3 — History

| # | Speaker | Line |
|---|---------|------|
| S3.1 | Naavi | "Know when you last got your brakes done?" |
| S3.2 | Caller | "Yes." |
| S3.3 | Naavi | "Brakes were done last September twelfth at Henderson's — eight hundred forty dollars." |
| S3.4 | Naavi | "You also asked me to flag after fifty thousand kilometers — you're at forty-six now. Plenty of road left." |
| S3.5 | Naavi | "Want to hear another example, or should we set up a reminder for you?" |

> **Your comment:**

### Scenario 4 — Location

**Per your comment, S4.1 is now generic** — it no longer names Sarah or the airport up front (that was too specific for an opening question). Instead the specific example is voiced by Naavi herself, framed as a hypothetical ("say you told me...") once the caller has already said yes — so it's clear the detail is an illustration, not something Naavi already knew about him.

| # | Speaker | Line |
|---|---------|------|
| S4.1 | Naavi | "Hear how I can text someone when you arrive somewhere?" |
| S4.2 | Caller | "Yes." |
| S4.3 | Naavi | "Say you told me: text Sarah the moment I land at the airport." |
| S4.4 | Naavi | "From then on, every time you land, I'll text her — even if your phone's on silent, you'll know it sent." |
| S4.5 | Naavi | "Want to hear another example, or should we set up a reminder for you?" |

> **Your comment:**

### Scenario 5 — Capture

**Fixes your question "from where does it know Row B5?"** — it didn't, and that was a real gap. The old yes/no version had Naavi state "Row B5" as if she already knew it, with no line where the caller (or anyone) ever said it. Fixed the same way as Scenario 4: Naavi voices the example herself as a hypothetical ("say you told me...") rather than asserting she already has it.

| # | Speaker | Line |
|---|---------|------|
| S5.1 | Naavi | "Hear how I can remember something for you?" |
| S5.2 | Caller | "Yes." |
| S5.3 | Naavi | "Say you told me: remember I parked in row B5." |
| S5.4 | Naavi | "From then on, whenever you ask me where you parked, I'll have it for you — row B5." |
| S5.5 | Naavi | "That's a quick look at what I can do. Let's set up a real one for you now." *(cap-reached line — replaces the "want another" question since this is the 3rd/last scenario played; fires regardless of what the caller says, per plan §8 test 8)* |

> **Your comment:**

**Decline path for the S{n}.1 yes/no gate — ✅ CONFIRMED:** if the caller says "no" to a scenario's opening question, Naavi skips straight to the next scenario in `DEMO_SCENARIO_ORDER` rather than jumping to the reminder flow.

**[NEW] — decline line, used at any `S{n}.1`:**
> "No problem — let's try a different one."

...then goes straight into the next scenario's own `S{n}.1` question (no re-ask, no menu). One knock-on design point worth confirming: a declined scenario shouldn't count against the 3-scenario cap (`DEMO_MAX_SCENARIOS`) — only scenarios the caller actually said yes to and heard should count as "played," otherwise a caller who declines 2 could get cut off after only 1 real scenario. Proposed rule: `scenarioCount` increments on yes+played, not on decline. Comment if you want it counted either way.

**Open item still baked into this section (comment against this directly, or against a line code above):**
- The repeated closer "Want to hear another example, or should we set up a reminder for you?" (S1.5, S2.6, S3.5, S4.5) is matched against two things behind the scenes: an explicit "no," or a new intent regex catching phrases like "let's do the reminder," "that's enough," "let's continue," "set up a reminder." Full phrase list is a separate review item, not scripted here since it's not spoken by Naavi.

---

## 4. Bridge into the existing reminder flow

**REVISED — trimmed per live-call feedback (2026-07-01).** It did feel repetitive in the actual test call, as flagged as a possibility here originally — the caller had just heard 1-3 live examples of exactly those capabilities in the walkthrough.

> "Let's set up a real one for you. What city or time zone are you in?"

30 words -> 12. **One wrinkle caught in local smoke-testing:** when arriving via the cap-reached path, the walkthrough's own closing line already says "...Let's set up a real one for you now." — so this sentence is skipped entirely in that case (the cap-reached line already does the job) to avoid saying it twice in a row. Only said when arriving via a direct "no" at the closer (no cap-reached line said first).

**Timezone confirm** — **[EXISTING]**, untouched:
> "Got it — {zone label} time. Is that right?"

**Reminder time ask** — **REVISED TWICE**, first attempt, zone not defaulted:
> "What time should I remind you{, name}?"

*(2026-07-01: trimmed from "Pick any time — today, tomorrow, next week. I'll text you exactly then. When should I remind you{, name}?" — ~15 words cut. 2026-07-02: a real call showed this went too far — "When should I remind you?" was ambiguous enough that the caller answered "Say hi to my wife" three times, thinking it asked what to be reminded of, not when. Changed "When" → "What time" — same length, unambiguous, call never failed to set a reminder again in testing after this fix.)*

**Reminder confirm** — **[EXISTING]**, untouched:
> "Got it. I'll text you {spoken time}{, name}. Is that right?"

**Optional message ask** — **REVISED, trimmed per live-call feedback (2026-07-01)**:
> "Anything specific to include?"

*(Was: "Is there anything specific you'd like me to include in that reminder?" — 12 words -> 4.)*

**Closing / post-action readback** (`index.js:7711`):
> "Got it{, name}. I'll text you {spoken time}. Take care."

**Reminder SMS** (`index.js:7346-7354`) — fires later, at the scheduled reminder time, not right after the call:
> "Hi {name}, it's Naavi. You asked me to remind you: {message}. Want me to help with more than reminders? I can organize your calendar, remember things you tell me, and help you stay on top of life — all by voice. Connect your account here: https://mynaavi.com/start Reply STOP to opt out."

---

## 5. NEW — Recap SMS (separate from the Reminder SMS)

**REVISED per your note — ✅ CONFIRMED auto-send, no permission ask.** Reasoning (yours): the caller already gave their phone number by calling; the message includes STOP; asking permission first adds friction and weakens demo momentum right at the close. This reverses the §5 draft from the previous round of this doc — no extra Yes/No turn, no `buildDemoClosingTwiml`-style branch. The call's existing closing line (§4, "Got it{, name}. I'll text you {spoken time}. Take care.") stays exactly as-is; the Recap SMS just fires in the background alongside it, right after hangup.

The recap-line data itself isn't new — it reuses `SCENARIO_RECAP_LINES` (`index.js:6894-6900`), already sitting untouched in the file:

- Today: your day in one breath.
- Bills: PDFs read straight from your inbox.
- History: when you last did anything.
- Location: an alert when you arrive somewhere.
- Capture: anything you want me to remember.

**✅ CONFIRMED Recap SMS body — shortened per your version** (only includes the lines for scenarios the caller actually heard):
> "Hi {name}, thanks for trying Naavi.
>
> Here's what you heard:
> - {recap line}
> - {recap line}
> - {recap line}
>
> Set up your own MyNaavi:
> https://mynaavi.com/start
>
> Reply STOP to opt out."

### ⭐ Implementation rule — Recap SMS and Reminder SMS stay fully separate

Your instruction, verbatim intent: no merging, no replacing.

| | Recap SMS | Reminder SMS (§4, existing) |
|---|---|---|
| Sent when | Immediately after hangup, every call | Later, at the scheduled reminder time |
| Content | Which scenarios were played | The actual reminder message the caller asked for |
| Trigger | Automatic, always (once at least 1 scenario played) | Only if the caller completed the reminder flow |
| Code path | New — separate send call | `buildDemoReminderSmsBody` (`index.js:7342-7355`), untouched |

These are two independent messages, sent at two different times, built from two different templates. Phase 4 must not fold the recap content into the Reminder SMS, and must not have one suppress or delay the other — a caller who completes the whole call gets both messages, at their own respective times.

---

## 6. Summary — status

1. **§2** — ✅ CONFIRMED. With-name variant, states the reason (not connected to real calendar/email yet), and confirmed to stay generic rather than naming "Google account."
2. **§3** — ✅ CONFIRMED opening-turn format (yes/no gate, all 5 scenarios). ✅ Scenario 4 genericized, Scenario 5 fixed (both now voice the specific example as a hypothetical, not asserted fact). ✅ CONFIRMED decline path at `S{n}.1` — skip to next scenario, doesn't count toward the 3-scenario cap.
3. **§4** — ✅ CONFIRMED. Bridge line trimmed (30 -> 12 words) after live-call feedback that it felt repetitive; skipped entirely on the cap-reached path to avoid double-saying "let's set up a real one."
4. **§5** — ✅ CONFIRMED (revised). Recap SMS auto-sends, no permission ask, shortened body, and stays fully separate from the Reminder SMS (own trigger, own timing, own template — never merged). Trigger point corrected after live-call feedback: fires at the true end of the call (declined reminder, error, or success), not at the walkthrough→reminder handoff.

**Phase 7 round 2 — "zero friction call, real message is in SMS" (2026-07-01):**
- ✅ CONFIRMED — 3-scenario cap stays at 3 (considered reducing to 1, rejected).
- ✅ CONFIRMED — name-ask line stays as originally written ("Who do I have the pleasure of speaking with?") — kept on purpose, not filler.
- ✅ CONFIRMED and applied — all 5 scenario gate questions trimmed, reminder-time ask trimmed (~15 words cut), message ask trimmed (12 -> 4 words).
- ✅ CONFIRMED — the walkthrough bridge line's reason ("I'm not connected to your calendar or emails yet") stays spoken on the call. Wael: "important to keep." No code change (this was already the current implementation) — resolves the open question, doesn't reverse anything.

Only remaining non-wording item anywhere in the doc: the phrase list for `DEMO_MOVE_TO_REMINDER_RE` (§3, not spoken by Naavi, so not a script review item — just needs a read-through when it's written in code).

Everything else in the call (name ask/confirm, the reminder flow after the timezone ask, the Reminder SMS itself) is existing, reviewed, shipped copy — untouched.
