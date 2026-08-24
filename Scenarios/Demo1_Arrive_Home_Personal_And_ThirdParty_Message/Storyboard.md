# Storyboard — Arrive Home: Personal Reminder + Third-Party Message

Per `docs/PRODUCTION_PRESENTATION_GOVERNANCE.md`: MyNaavi (left) / Notes (center) / Context (right), Evidence replaces Context only during its beat, Live Audio and Narration kept on separate tracks. Target 2–4s per scene per the pacing rule.

| # | MyNaavi (left) | Notes (center) | Context / Evidence (right) | Live Audio | Narration |
|---|---|---|---|---|---|
| 1 | App open, idle | **Voice command** | Context: Robert approaching front door, exterior | "Naavi, when I arrive home, remind me to lock the door and send SMS to Linda saying I'm home." | — |
| 2 | Naavi's reply rendering on screen | **Request understood** | Context: continues, hand reaching for door | *(Naavi's spoken/text reply — see Script.md)* | "One sentence. Two different messages." |
| 3 | Location alert confirmed in-app | **Location alert set** | Context: door opens, Robert steps inside | ambient only | "Naavi splits it automatically — a reminder for him, a message for someone else." |
| 4 | — | **Waiting for arrival** | Context: brief interior moment, settling in | ambient only | "The moment stays quiet until he actually arrives." |
| 5 | Arrival notification appears | **Arrived — reminder delivered** | *(Evidence begins)* Robert's phone: "You've arrived at Home — lock the door" | notification sound | — |
| 6 | — | **SMS sent to Linda** | Evidence: Linda's phone receiving "I'm home." (~2s after scene 5, per the real delivery gap) | notification sound (Linda's device) | "Two people. Two different messages. One sentence." |
| 7 | Both screens held, side by side | **Done** | Evidence: both proofs framed together | — | *(closing line, per Title/Description)* |

**Timing note:** scene 5→6's ~2 second gap is real (confirmed in prior testing per the source demo doc) — don't compress it in editing; it's part of what makes the proof credible rather than staged.

**Exposure handling (per `Exposure.md`):** in scenes 5–7, any frame where Linda's or Robert's real phone number, or the exact street address, would be legible (caller ID, contact card, Settings address field) must be cropped, blurred, or reframed before export — see `Exposure.md` for the full classification.

**Simulation-integrity note (per `docs/PRODUCTION_PRESENTATION_GOVERNANCE.md` §11):** scene 4→5's Context footage must not be edited to imply the walking/arrival footage was what triggered the notification if the rule was actually fired via `scripts/simulate-geo-arrival.js` rather than a genuine crossing captured on camera at that moment. Evidence (scenes 5–6) proves the product result; Context (scenes 1–4) illustrates the situation — the edit must not fabricate a causal link between them that didn't happen.
