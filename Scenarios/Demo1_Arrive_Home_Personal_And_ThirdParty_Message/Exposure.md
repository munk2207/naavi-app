# Exposure Classification — Arrive Home: Personal Reminder + Third-Party Message

Per `docs/PRODUCTION_GOVERNANCE.md`'s Scenario Package convention. This scenario uses real accounts and a real address — this classification is not a formality here, it's the actual guardrail.

## Internal-only — must never appear in footage or published metadata

- Linda's real phone number, (343) 655-3227 — this is a real, working Twilio number. If it becomes visible/legible in the published video (e.g., in the caller-ID field of her SMS notification), it's exposed to the public and can start receiving real calls/texts from viewers.
- Robert's real phone number, (343) 326-0166 — same risk.
- Robert's real Google account address, `robert.esm.2207@gmail.com`.
- Linda's real Google account address, `whwh2207@gmail.com`.
- The exact street address, 500 Bayview Dr, Woodlawn, ON K0A 3M0 — if it appears legibly anywhere in the app UI during recording (e.g., a Settings screen showing the saved home address), it identifies a real, physical location.

## Safe-to-record — approved to appear in captured footage

- The names "Robert" and "Linda" as spoken/displayed in-app.
- The message content itself: "You've arrived at Home — lock the door," "I'm home."
- The general app UI (Settings, alert confirmation screens) as long as the specific address/phone number fields aren't legible in frame.
- "Home" as a place label (not the specific street address).

## Safe-to-publish — permitted in the final video, thumbnail, title, description

- The story itself: one voice command splitting into a self-reminder and a third-party text.
- The names Robert and Linda, and the message content above.
- Generic location reference ("home," "arriving home") — not the specific street address.

## Required handling (per `Storyboard.md`)

- Any shot where Linda's or Robert's phone number would be legible (caller ID on a received SMS, a contact card, a Settings screen) must be cropped, blurred, or reframed before export.
- Any shot where the exact street address would be legible (a Settings home-address field, a map pin with the full address) must be cropped, blurred, or reframed before export.
- `MyNaavi_Screen.mp4` and `Evidence/` captures should be reviewed specifically for these two exposure risks before handoff to editing — don't rely on catching it during the final edit pass alone.
