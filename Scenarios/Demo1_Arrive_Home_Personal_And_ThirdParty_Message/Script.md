# Script — Arrive Home: Personal Reminder + Third-Party Message

**Source:** Demo 1 in `docs/YOUTUBE_TOP5_DEMOS_2026-07-20.md` ("One sentence, two people, two different messages"), updated for the current cast per `docs/PRODUCTION_DEMO_DATA_PACKAGE.md` (Bob → Linda Fournier).

**What it proves:** one natural request splits into a reminder for the user and a separate message to someone else, delivered independently.

**Pilot-selection note:** chosen as the template-validation pilot because it exercises the full region set at once — MyNaavi, Notes, Context, *and* Evidence — making it the most demanding single test of the master template, not the easiest one.

## The one-sentence story

> "When I arrive home, remind me to lock the door and send SMS to Linda saying I'm home."

## The ask (validated phrasing)

Say to Naavi, phone or voice call:

> **"When I arrive home, remind me to lock the door and send SMS to Linda saying I'm home."**

Validated alternate: *"Remind me when I arrive home to lock the door and send SMS to Linda."*

## The expected split

Naavi's reply (Demo Mode on, one-take phrasing — live LLM output, expect minor wording variance):

> "I'll set up a location alert for when you arrive home. This will remind you to lock the door and send Linda a text saying you're home."

## The proof

Robert's reminder appears first — self-reminder notification, "You've arrived at Home — lock the door." Linda's SMS follows approximately two seconds later — "I'm home." That gap is real (confirmed in prior testing) and shouldn't be compressed or presented as simultaneous; the closing proof frame then holds both results side by side once both have actually landed.

## Cast and location for this scenario

- **Robert Sinclair** — `robert.esm.2207@gmail.com`, (343) 326-0166 — the demo account.
- **Linda Fournier** — neighbour, plays the third-party SMS recipient. Real account: `whwh2207@gmail.com`, (343) 655-3227.
- **Home** — 500 Bayview Dr, Woodlawn, ON K0A 3M0 (per Demo Data Package Location #1).

## Pre-recording requirements (see Technical Readiness for the full checklist)

- No pre-existing "arrive at Home" alert for Robert — the duplicate-prevention guard blocks a same-condition rule. Clear it before every take, not just the first.
- Home address confirmed saved/verified in Robert's account before filming (avoids an extra address-confirmation exchange on camera).
- Real-time arrival: use `scripts/simulate-geo-arrival.js home` in place of a physical drive, once the alert rule exists.
- Decide before filming: real drive/walk vs. simulated arrival (recommend simulated for the pilot — removes a variable while validating the template itself).
