# F11a Scenario Walkthrough — Full Call Script (word-for-word)

Companion to `docs/F11A_PHASE2_CHANGE_PLAN_2026-07-04.md` (architecture, closed — see that doc's "Resolved" section). That plan defines *what* exists and *in what order*: bridge line → Unified Search → Geofencing → Automatic Alerts → (cap reached, transition to reminder), with Scheduling and Lists as positions 4-5, reached only if the caller declines one of the first three. This doc defines the exact *words* Naavi says, so wording is reviewed and confirmed before Phase 4 touches `scenarioWalkthrough.js`.

Every line is tagged:
- **[EXISTING]** — unchanged, already live, kept for continuity between scenarios.
- **[NEW]** — needs sign-off before Phase 4 writes it into code.

Voice: Polly Joanna (unchanged — per `project_naavi_voice_selection`, demo line stays on Polly, not Aura).

**Writing constraints applied throughout (Wael, 2026-07-04):**
1. Every scenario reads like one real conversation, not a feature description — no "I can..." lists. Concrete, specific examples only.
2. Each scenario demonstrates exactly one "wow" moment — no stacking multiple capabilities into one example.
3. Every scenario hands control back to the caller with a natural question, not a checklist-feeling prompt.

**Effort allocation (Wael, 2026-07-04):** Unified Search gets the most refinement — it sets the tone the other two default-heard scenarios ride on. Scheduling and Lists are written to a good, usable standard but are explicitly secondary (only heard if a caller declines one of the first three) — lighter review pass is fine for those two.

---

## 1. Call opens — name ask, SMS consent (unchanged)

**[EXISTING]** — no changes anywhere in this section.
> "Hi! This is Naavi. Who do I have the pleasure of speaking with?"

Caller says a name, Naavi confirms it, then the SMS consent disclosure (F2i requirement, untouched):
> "By staying on the line, you agree to receive a text from Naavi, including a recap of this call and any reminder you request. Message and data rates may apply. Reply STOP to opt out."

---

## 2. NEW — bridge line (Capture, one sentence)

Per Phase 2 A.4 (resolved): Capture doesn't get its own gated scenario — it's one sentence explaining *how* Naavi knows any of what's about to be demonstrated, said once, then straight into Scenario 1. No lingering, no second sentence.

**[NEW] — ✅ CONFIRMED (revised, Round 2 review):**
> "Thanks {name}. Everything I'm about to show you starts with remembering what matters to you."

*(Revised from "Everything I show you today comes from remembering what you tell me and organizing it automatically" — same meaning, less "explaining," more conversational. Alternate considered and rejected in favor of this one: "Everything I'm about to show you starts with simply remembering what you tell me" — both were offered as warmer options; this one was chosen as slightly more natural to say aloud.)*

**✅ CONFIRMED — old "I'm not connected to your calendar..." disclaimer dropped.** Every scenario below already frames its example as a hypothetical ("say you told me...", "say you asked me..."), which makes the point obvious without a separate disclaimer sentence.

Immediately followed, same `<Say>`, by Scenario 1's gate question (§3).

---

## 3. Scenario 1 — Unified Search (most-refined scenario, sets the tone)

| #    | Speaker    | Line                                                                                                                                                                                                                                                                                                                                     |
| ---- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #    | Speaker    | Line                                                                                                                                                                                                                                                                                                                                     |
| S1.1 | Naavi      | "Can I show you something that might surprise you?"                                                                                                                                                                                                                                                                                      |
| S1.2 | Caller     | "Yes."                                                                                                                                                                                                                                                                                                                                   |
| S1.3 | Naavi      | "Say you asked me: what's going on with the accountant? I'd check your calendar, your email, and anything you've ever told me to remember — all at once." *(✅ CONFIRMED, revised 2026-07-04 — live-call feedback: "we need to provide a more business/life example, not knee." Replaces the original "Dr. Smith" / medical framing.)*        |
| S1.4 | Naavi      | "I'd tell you you're meeting them Thursday at ten, their office emailed this morning about your tax documents, and you wanted to ask about the home office deduction." *(✅ CONFIRMED, revised — same structure as before (calendar fact + email fact + a question to raise), now business/life instead of medical.)*                        |
| S1.5 | Naavi      | "One question — three different places I looked, all in the same breath." *(✅ CONFIRMED, kept near-exactly — "reinforces the takeaway without sounding like marketing.")*                                                                                                                                                                |
| —    | *(pacing)* | **1-second pause after S1.5**, before S1.6. Per Round 2 review: "phone conversations need silence... that's where the emotional reaction happens." Implement as `<break time="1000ms"/>` in the TwiML, same SSML pattern already used elsewhere in `scenarioWalkthrough.js`.                                                             |
| S1.6 | Naavi      | "Want to hear something else I can do?"                                                                                                                                                                                                                                                                                                  |

**Self-check against the writing constraints:**
- Real conversation, not a feature list: yes — "say you asked me... I'd check... so I'd tell you..." reads as one continuous answer, no "I can search calendars, emails, and notes" enumeration.
- One wow moment: yes — the single takeaway is *one question, three sources, at once* (S1.5 states it explicitly as the takeaway line, so the caller doesn't have to infer it).
- Hands control back naturally: S1.6 is a plain, non-checklist question.
- Checked against Guiding Design Principle (Phase 2): this is the scenario most likely to produce "I didn't know software could do that" — it's the first thing a caller hears, deliberately (per B.3.1's Round 3 resolution).
- Checked against B.3.2 emotional-progression table: target emotion is Curiosity. S1.1's gate ("something that might surprise you") is written to seed curiosity before the answer, not just ask permission.

> **Your comment:**

---

## 4. Scenario 2 — Geofencing

| # | Speaker | Line |
|---|---------|------|
| S2.1 | Naavi | "Ever wish your family knew the second you got somewhere, without you having to text them yourself?" |
| S2.2 | Caller | "Yes." |
| S2.3 | Naavi | "Say you told me: text Sarah the moment I get to the cottage." |
| S2.4 | Naavi | "The moment you arrived, I'd send that text myself — you'd never have to remember to do it." *(✅ CONFIRMED, revised — "every time" → "the moment," per Round 2 review: more vivid, leans into the immediacy that's the whole point of this capability.)* |
| — | *(pacing)* | **1-second pause after S2.4**, before S2.5 — same rationale as S1.5's pause. |
| S2.5 | Naavi | "Want to hear something else I can do?" |

*(Example uses "the cottage" per your own phrasing — kept concrete and personal rather than a generic "your destination.")*

**Self-check:**
- One wow moment: the arrival-triggered send, stated once, not combined with any other mechanism (no "and it can also alert you about weather" tacked on).
- Emotional progression target: Surprise — it's not just search anymore, it now knows where the caller physically is and acts on it.

> **Your comment:**

---

## 5. Scenario 3 — Automatic Alerts (cap reached after this one)

| # | Speaker | Line |
|---|---------|------|
| S3.1 | Naavi | "What if I could watch for something, and only speak up the moment it actually happened?" |
| S3.2 | Caller | "Yes." |
| S3.3 | Naavi | "Say you told me: wake me only if my flight's delayed." *(✅ CONFIRMED, revised — replaces the email-trigger example. Round 2 review: the email version "feels a little ordinary — almost everyone expects email notifications." A flight-delay watch makes it unmistakable that Naavi is doing the watching itself, not just forwarding a message that already arrived.)* |
| S3.4 | Naavi | "I'd keep watching in the background for as long as you needed — and the second it happened, you'd hear from me. Otherwise, not a word." *(✅ CONFIRMED, revised — "sit with that quietly in the background" → "keep watching in the background," per Round 3 review: the original "felt written," not something people naturally say; this reads as spoken English while keeping the same meaning.)* |
| — | *(pacing)* | **1-second pause after S3.4**, before S3.5. |
| S3.5 | Naavi | "That's a quick look at what I can do. Now let's make one of those work for you." *(✅ CONFIRMED, revised — second half replaces "Let's set up a real one for you now" per Round 2 review: shifts the caller from observer to user right before the reminder offer. Same functional role — cap-reached line, fires regardless of what the caller says next.)* |

**Self-check:**
- One wow moment: a single trigger (flight delay), chosen specifically because it demonstrates Naavi actively monitoring something external, not merely relaying an email that landed in an inbox.
- Emotional progression target: Trust — this is the scenario meant to make the caller believe Naavi is reliable enough to actually set something up with, right before the reminder offer.
- Wording check (Round 3): "sit with that quietly" replaced — see S3.4.

> **Your comment:**

---

## 6. Scenario 4 — Scheduling (secondary — reached only if caller declines one of Scenarios 1-3)

*Lighter polish pass, per your instruction — still usable as written, revisit further only if this gets promoted into the default three later.*

| # | Speaker | Line |
|---|---------|------|
| S4.1 | Naavi | "Want to hear how I can put something on your calendar for you?" |
| S4.2 | Caller | "Yes." |
| S4.3 | Naavi | "Say you told me: schedule my blood pressure pill for eight every morning." |
| S4.4 | Naavi | "I'd set that up right then — no app, no typing. From that morning on, it's just on your calendar." |
| S4.5 | Naavi | "Want to hear something else I can do?" |

> **Your comment:**

---

## 7. Scenario 5 — Lists (secondary — reached only if caller declines Scenarios 1-4)

*Lighter polish pass. Last in order — reaching this scenario means the walkthrough ends here regardless of the caller's answer (same "noneLeft" mechanism as the current shipped Capture scenario).*

| # | Speaker | Line |
|---|---------|------|
| S5.1 | Naavi | "Want to hear how I keep track of a list for you?" |
| S5.2 | Caller | "Yes." |
| S5.3 | Naavi | "Say you told me: start a Costco list, and add milk and eggs." |
| S5.4 | Naavi | "Next time you called, I'd have it — and I could even text it to you before you walked in the store." |
| S5.5 | Naavi | "That's everything I wanted to show you today. Now let's make one of those work for you." *(end-of-list line, same role as S3.5's cap-reached line but for the "ran out of scenarios via declines" path — updated to match S3.5's revised second half, per Round 2 review, for consistency across both exit points.)* |

> **Your comment:**

---

## 8. Decline path (unchanged, [EXISTING])

If the caller says "no" at any `S{n}.1`:
> "No problem — let's try a different one."

...then straight into the next scenario's own gate question, same combined-`<Say>` pattern already shipped (no re-ask, no menu). Not re-litigated here — Phase 1/2 found no problem with this mechanism (Track B B.5).

---

## 9. Bridge into the reminder flow (unchanged, [EXISTING])

No changes proposed — the existing reminder flow (timezone ask, reminder-time ask, confirm, Recap SMS, Reminder SMS) is untouched by F11a per Phase 2's Files-that-will-change table. See `docs/F2B_SCENARIO_WALKTHROUGH_SCRIPT_2026-07-01.md` §4-5 for that copy, still current.

---

## 10. Pacing (Round 2 review — implementation note, not wording)

Not a script-content change, but must be carried into Phase 4's `scenarioWalkthrough.js` encoding: **pause about 1 second after every wow-moment line**, before the next line speaks. Reasoning (Round 2): phone conversations have no visual space to think in — silence after the payoff line is where the caller's "wait..." reaction actually happens, and talking over it removes that beat entirely.

Confirmed pause points (implement as `<break time="1000ms"/>`, consistent with the shorter 300-800ms breaks already used elsewhere in this file):
- After S1.5 ("...all in the same breath.")
- After S2.4 ("...I'd send that text myself.")
- After S3.4 ("...otherwise, not a word.")

## 11. Summary — status

**🔒 FROZEN — approved for implementation (Wael, final review, 2026-07-04).** No further document revisions planned. All items below resolved:

| Item | Status |
|---|---|
| Bridge line | ✅ FROZEN — "Everything I'm about to show you starts with remembering what matters to you." Left exactly as written — "doesn't sound technical, doesn't over-explain, creates a foundation for everything that follows." |
| Scenario order | ✅ FROZEN — `unified_search → geofencing → automatic_alerts → scheduling → lists`. |
| Scenario 1 — Unified Search | ✅ FROZEN, unchanged from Round 2 — "the biggest improvement over F2b... I would not change this anymore." |
| Scenario 2 — Geofencing | ✅ FROZEN, unchanged from Round 2. |
| Scenario 3 — Automatic Alerts | ✅ FROZEN — S3.4's "sit with that quietly in the background" → "keep watching in the background" (final wording fix, Round 3 — "the only line that still feels slightly literary"). |
| Scenario 4 — Scheduling | ✅ FROZEN, no changes. |
| Scenario 5 — Lists | ✅ FROZEN, no changes. |
| Pacing (§10) | ✅ FROZEN — three 1-second pauses. |
| Decline line, reminder flow, Recap SMS, Reminder SMS | **[EXISTING]** — untouched, not in scope for F11a. |

**Product observation on record (Wael, final review):** the walkthrough shifted from being organized around *features* to being organized around *progressive trust* — "Naavi understands me → Naavi knows where I am → Naavi watches things for me → now I trust it with a real task." That narrative arc is the actual design win of this rebuild, beyond the individual capability fixes.

## 12. Phase 4 field-test plan (Wael, 2026-07-04)

Once implemented and deployed to staging, run 20-30 real demo calls and track four metrics before treating this script as the new baseline:
1. Where callers interrupt.
2. Which scenario gets the strongest verbal reaction.
3. Whether callers stay on the line through all three default scenarios.
4. What percentage proceed to actually set a reminder.

If those metrics hold up, this script becomes the baseline and future iteration comes from observed caller behavior, not further document revisions — this document is not expected to get a Round 4.

**Governance status:** architecture and wording are both closed. Next step is Phase 4 implementation (encode this script into `scenarioWalkthrough.js`), staging deploy, then the field test above — matching the F2b precedent.
