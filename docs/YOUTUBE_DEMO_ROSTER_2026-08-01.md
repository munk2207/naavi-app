# MyNaavi — YouTube Demo Roster

**Purpose:** working doc for MyNaavi's YouTube demo videos showcasing orchestration capabilities. Each video target: 90 seconds. Open-ended roster — not capped at 5. New ideas get added here as they come up; scripted ones move from "queued" to a full numbered entry.

**Renamed from `YOUTUBE_TOP5_DEMOS_2026-07-20.md` on 2026-08-01** — the original 5 are now Demos 1-5 below, scripts unchanged. This doc replaces that one going forward.

**Selection method (original, still applies):** cross-checked against Naavi's own live self-description plus a YouTube-demo-strength filter (visual/audio punch, provable on camera, short).

**Scripted demos:**

1. **What's in My Mind** — one open conversation, four systems handled at once. Flagship.
2. **Location + Intelligent Actions** — arrive somewhere → a reminder for you and a message to someone else, split automatically.
3. **Leave-by / Travel Assistant** — real Google Maps travel time, not a guess.
4. **Reminder Delivery** — one time trigger, splits into a multi-channel self-reminder and a separate message to someone else.
5. **One Question, Five Systems** — ask about a person, get calendar + email + notes + contact info in one answer.
6. **Bill Total** — ask how much a vendor has billed you, get one number, no scrolling through invoices.
7. **Email-Arrival Alert** — set it once, Naavi watches for a specific sender and texts you the moment they email.

**Queued (idea only, not yet scripted):**
- *(add more here as they come up — "etc" per Wael 2026-08-01)*

Each scripted demo below is broken into **titled parts** — use these as on-screen chapter titles / lower-third labels.

---

## Demo 1 — "What's in My Mind"

**What it proves:** one natural, open-ended conversation — not a menu, not four separate requests — handles an email, a calendar booking with a linked reminder, and a location-triggered list, all in one breath.

**Status:** each individual piece (draft email, create event, reminder, location+list alert) is tested elsewhere in the codebase, but this exact 4-task combination in one sentence has not been run end-to-end. **Run this exact line live once before filming** to confirm all 4 actions resolve correctly and Naavi's reply doesn't echo the tasks back verbosely (echoing is a known open issue that kills pacing on camera).

**Timing note:** this ask is ~45 words — trimmed down from an original 6-task, ~79-word version that ran too long for a 90-second video once Naavi's reply and proof shots were accounted for.

### Part 1 — "THE ASK"

On-screen title: **THE ASK**

> **"Naavi, send Linda an email asking for her review on the budget. Book a meeting with James next Monday at 11am to discuss our summer plans, and remind me Sunday to prepare. Send me my work list when I arrive at my office."**

### Part 2 — "THE SPLIT"

On-screen title: **THE SPLIT** (freeze-frame here)

Naavi's reply should confirm all 4 in one tight sentence — what was resolved, one blocking question if needed. No task-by-task echo.

Callout text to overlay: *"One conversation. Four systems. Zero app-switching."*

### Part 3 — "THE PROOF (immediate)"

On-screen title: **THE PROOF**

Show, right after the ask: the draft email to Linda, and the calendar event with James (with the linked Sunday reminder visible).

### Part 4 — "THE PROOF (arrival)"

On-screen title: **THE ARRIVAL**

Office arrival triggers the work list — real walk/drive to office, or a controlled simulated-arrival trigger on cue.

### Setup checklist before recording

- [ ] Confirm Linda exists as a contact with her real email address (`whwh2207@gmail.com`).
- [ ] Confirm your office address is already saved/verified in Settings — an unverified address adds an extra clarification turn on camera.
- [ ] Confirm your work list has real items on it before filming — an empty list kills the payoff.
- [ ] Decide: real walk/drive to office for Part 4, or a controlled simulated-arrival take.
- [ ] Run the full ask live at least once before filming — this exact 4-task combination is new and unverified end-to-end.

---

## Demo 2 — "Location + Intelligent Actions" - When I Arrive

**What it proves:** Naavi takes one natural request, correctly splits it into a reminder for *you* and a separate message to *someone else*, and delivers both independently — without you managing two separate alerts.

**Status:** the core split (self-reminder + third-party text from one location trigger) is the most rigorously tested capability in the codebase (B10j — full governance cycle, 3/3 live trials confirmed correct on real devices, real SMS delivered and screenshotted). The "wife" relationship resolution is new — "My wife's name is Linda Fournier" has been backfilled into memory (not spoken on camera), and Claude is expected to resolve "my wife" → Linda from that saved fact. **Run this exact line live once before filming** to confirm the relationship resolution works.

### Part 1 — "THE ASK"

On-screen title: **THE ASK**

> **"When I arrive home, remind me to feed the cat and send my wife a text saying I'm home."**

*(Exact phrase validated in the test suite — `tests/catalogue/session-2026-07-17-b10j-location-compound-self-reminder.ts`.)*

### Part 2 — "THE SPLIT"

On-screen title: **THE SPLIT** (freeze-frame here — this is the whole point of the demo)

**Actual tested line** (live call, production, 2026-07-20 — captured after fixing and re-verifying the backend, 3/3 trials correct):

> "I'll set up a location alert for when you arrive home. This will remind you to feed the cat and send your wife a text saying you're home."

*(Demo Mode removed 2026-07-22 — this confirm-then-act reply is now the only path; there's no skip-confirmation option anymore. Say "yes" after this line, then cut to Part 3. Live LLM phrasing — exact wording may vary slightly take to take.)*

Callout text to overlay: *"One request → one reminder for you, one message for someone else — automatically separated."*

### Part 3 — "THE ARRIVAL"

On-screen title: **THE ARRIVAL**

Show the geofence trigger — either a real drive/walk home on camera, or a sped-up/cut transition if filming logistics don't allow a real drive.

### Part 4 — "THE PROOF"

On-screen title: **THE PROOF**

Show two things side by side:
- **Your phone**: the self-reminder notification ("You've arrived at Home — feed the cat") on whichever channels you have enabled.
- **Linda's phone**: the actual received text, "I'm home." — arrives ~2 seconds after your own notification (real delivery gap confirmed in testing).

Callout text to overlay: *"Two people. Two different messages. One sentence."*

### Setup checklist before recording

- [ ] Confirm Linda exists as a contact with her real phone number ((343) 655-3227) that can receive the demo text live.
- [ ] Clear any pre-existing "arrive at Home" alert first — a same-label alert can hit a duplicate-prevention guard and block the new one from being created.
- [ ] Confirm your Home address is already saved/verified in MyNaavi (Settings).
- [ ] Decide: real drive/walk for Part 3, or a controlled simulated-arrival take.
- [ ] Plan for the "say yes" confirm turn on camera — Demo Mode (which used to skip it) was removed 2026-07-22 and no longer exists.

---

## Demo 3 — "Leave-by / Travel Assistant" - When Should I Leave?

**What it proves:** Naavi doesn't guess travel time — it pulls real Google Maps data and calculates exactly when you need to leave, before you ask twice.

**Status:** real. `lib/maps.ts` computes the leave-by time client-side from a live Google Maps Directions call (`get-travel-time` Edge Function) — Claude is explicitly forbidden from estimating the number itself (`get-naavi-prompt/index.ts:702`), which is regression-locked (`tests/catalogue/prompt-regression.ts`, id `navigate-no-claude-estimate`) to prevent a hallucinated guess ever slipping through.

### Part 1 — "THE ASK"

On-screen title: **THE ASK**

> **"Navigate to my next meeting."**

*(Finalized 2026-08-04 — the earlier alternate phrasing, "What time should I leave for my dentist appointment?", was removed. It routed through a different, unfixed code path exposed to an address-fabrication risk; this single line is verified safe end-to-end and re-confirmed live.)*

### Part 2 — "THE REAL NUMBER"

On-screen title: **THE REAL NUMBER**

Show the leave-by card/label ("Leave by 2:15 PM") appearing — call out on screen that this is a live traffic calculation, not a guess.

Callout text to overlay: *"Not an estimate. Real Google Maps traffic, calculated live."*

### Setup checklist

- [ ] The calendar event used needs a real, resolvable physical address attached — a virtual/no-location event produces no leave-by time at all.
- [ ] **Mobile only** — the leave-by card is app UI; not available on a phone call.
- [ ] Pick an event far enough away that the leave-by time is visibly different from "now," so the calculation is obviously doing real work.

---

## Demo 4 — "Reminder Delivery" - Remind Me Everywhere

**What it proves:** one time trigger splits into a multi-channel self-reminder (SMS, WhatsApp, Email, Push, Voice Call all firing at once) and a separate message to someone else — same "one trigger, two actions" shape as Demo 2, but time-based instead of location-based.

**Status:** the multi-channel self-reminder fan-out is real and shipped — self-alerts fire on all 5 channels by default unless the user has opted out of a channel in Settings. The time-triggered third-party message (the Linda text) uses a less-unified code path than location-triggered third-party messages — **run this exact line live once before filming** to confirm it resolves Linda correctly and both halves fire on schedule.

### Part 1 — "THE ASK"

On-screen title: **THE ASK**

> **"At 8pm tonight, remind me to take my medication and text Linda asking if she's free for lunch tomorrow."**

### Part 2 — "THE CONFIRM"

On-screen title: **THE CONFIRM**

Expect a confirm-then-act reply naming both halves; say "yes." *(Demo Mode, which used to skip this step, was removed 2026-07-22 — this confirm turn always happens now.)*

### Part 3 — "THE TRIGGER"

On-screen title: **THE TRIGGER**

8pm arrives — both actions fire from the same trigger.

### Part 4 — "THE PROOF"

On-screen title: **THE PROOF**

Show multiple channels landing on your phone at once (SMS + push + voice call ringing + email) side by side with Linda's text arriving on her phone. This is a multi-shot edit, not a single screenshot — plan the coverage in advance.

Callout text to overlay: *"One reminder. Every channel. Automatically."*

### Setup checklist before recording

- [ ] Confirm which channels are enabled in Settings for the filming account — decide whether to show all 5 or a representative subset.
- [ ] Confirm Linda exists as a contact with her real phone number ((343) 655-3227).
- [ ] Plan the multi-screen proof shot before filming day — this needs more coverage than the other demos.
- [ ] Run this exact line live before filming — the third-party half is on a less-tested code path.

---

## Demo 5 — "One Question, Five Systems" 

**What it proves:** ask about a person, and Naavi pulls their calendar events, recent emails, saved notes, and contact info together automatically — no switching between apps.

**Status:** the underlying lookup (`getPersonContext` in `lib/memory.ts`) is real and combines calendar + email + notes + contact data in one call. Trigger phrasing is regression-locked (`tests/catalogue/session-2026-05-30.ts`).

### Part 1 — "THE ASK"

On-screen title: **THE ASK**

> **"Tell me about James."** *(or "What do you have on James?" — trigger phrasing validated with the placeholder name "Hussein"; same pattern, just swap the name)*

### Part 2 — "THE PULL"

On-screen title: **THE PULL** (freeze-frame here — this is the whole point)

Naavi's answer combines multiple sources in one reply — e.g., his upcoming calendar event with you, a recent email from him, and his contact info, all in one paragraph.

Callout text to overlay, timed to when each piece appears in the answer: *"Calendar →"* / *"Email →"* / *"Contacts →"* — visually tagging which system each sentence came from.

### Setup checklist

- [ ] Pick a real contact in the filming account with genuine data in at least 2-3 systems (an upcoming calendar event, a recent real email, ideally a saved note) — an empty/sparse contact just returns "no data found," which kills the demo.
- [ ] **Mobile only** — this specific combined lookup is client-side app code; a phone call won't produce the same layered answer. Film this one in the app.

---

## Demo 6 — "Bill Total" - How Much Did I Spend?

**What it proves:** ask how much a vendor has billed you, and Naavi returns one number — not a list to scroll through, not a guess. A server-side SUM over the real invoice records.

**Status:** real, documented mechanism (`get-naavi-prompt/index.ts` RULE 19a, `spend_summary`). The orchestrator runs a server-side aggregation and speaks exactly one number; Claude is explicitly told never to invent the number itself. **Not yet live-tested with this specific ask** — recommend one test run before filming.

**Important framing note:** `spend_summary` is **vendor-scoped**, not an all-vendors grand total — the prompt rules are explicit that "how much have my bills been" style asks without a vendor name aren't the documented pattern (list-style asks like "show me my bills" route to `global_search` instead, returning individual items, not a sum). This script asks about ONE vendor by name, which is the proven, tested shape.

### Part 1 — "THE ASK"

On-screen title: **THE ASK**

> **"How much has Reyes Build billed me?"**

Uses the seeded Reyes Build invoices as the real data behind the number — total **$7,975.00** (two `documents` rows: $3,125.00 + $4,850.00, verified live in the staging DB 2026-08-04).

### Part 2 — "THE NUMBER"

On-screen title: **THE NUMBER**

Naavi's reply should NOT speak a number on the first line (per the prompt rule, the initial reply is forward-looking only — "Let me check your Reyes Build total…" — then the real total follows once the aggregation completes). Let this play out on camera; don't cut the pause, it's proof the number isn't invented.

Callout text to overlay: *"Not a guess. A real sum, calculated server-side."*

### Setup checklist before recording

- [ ] Confirm the two Reyes Build invoices ($3,125.00 + $4,850.00 = $7,975.00 total, `source: demo-seed` in `documents`) are still present before filming. **Note:** the original $4,200.00 invoice described in `docs/YOUTUBE_DEMO_SEED_DATA_2026-07-23.md` (email #10) was never actually harvested into `documents` — that figure does not exist in the account. These two rows, seeded directly 2026-08-03, are the real numbers Naavi will report.
- [ ] Run this exact line live once before filming to confirm the number comes back correctly and the "no number in the first reply" pacing reads naturally on camera, not awkwardly.
- [ ] If a true "all bills total" ask is wanted instead, that's a different, unproven code path — flag before scripting further.

---

## Demo 7 — "Email-Arrival Alert" -Watch My Email

**What it proves:** set a rule once, and Naavi watches for a specific person's emails — no re-checking, no re-asking. The moment they email, you're texted.

**Status:** real, end-to-end tested under a different name in the original doc (old "Demo 3" — `tests/catalogue/wael-cases.ts`, `tests/catalogue/voice-regression.ts`). Same mechanism, this entry just points it at James instead of Bob.

**✅ Logistics problem RESOLVED, 2026-08-04.** The original concern was that James had no real, controllable email account for a live on-camera send. That's no longer true: `james.esm.2207@outlook.com` is now a real, working inbox — proven with multiple live sends to Robert's staging Gmail during Demo 5/6 seed-data work this session, each one delivering and syncing correctly. **Finalized: James stays the live sender, no swap to Linda and no pre-send fallback needed.**

### Part 1 — "THE ASK"

On-screen title: **THE ASK**

> **"Alert me when I get an email from James."**

### Part 2 — "THE CONFIRM"

On-screen title: **THE CONFIRM**

> "I'll alert you when an email from James arrives. Say yes to confirm, no to cancel, or tell me what to change."

Say "yes." *(Demo Mode, which used to skip this step, was removed 2026-07-22 — this confirm turn always happens now.)*

### Part 3 — "THE TRIGGER"

On-screen title: **THE TRIGGER**

The real email arrives, sent live on camera from `james.esm.2207@outlook.com`.

### Part 4 — "THE PROOF"

On-screen title: **THE PROOF**

Show the notification landing on your phone within moments — unprompted, no app open, no question asked.

Callout text to overlay: *"You didn't check your email. Naavi did."*

### Setup checklist before recording

- [x] ~~Resolve the sender-account question~~ — done, James's real inbox confirmed working 2026-08-04.
- [ ] Confirm the sending account's address (`james.esm.2207@outlook.com`) matches exactly what the alert rule will watch for.
- [ ] Have the sending email client open and ready to send on cue — this is the one moment that depends on someone else's timing, rehearse the cue once.
- [ ] Decide push vs. SMS vs. voice call for THE PROOF's visible channel — whichever is most legible on camera.
