# Production Technical Readiness

Version 1.0 — 2026-07-28. Owned by `docs/PRODUCTION_GOVERNANCE.md` §3.

**Answers:** is this scenario technically ready to record?

Two checks, run at two different frequencies — this replaces three earlier draft concepts (Technical Dependencies, Technical Readiness, Demo States/Reset Package) that turned out to be the same responsibility performed at different moments, not three separate ones.

---

## 1. Infrastructure Check

Run once per scenario *type*, or whenever the underlying infrastructure changes — not before every single take.

| Item | Template checklist | Status — YouTube Top 5 series (2026-07-28) |
|---|---|---|
| Demo account exists, OAuth confirmed | ☐ | ✓ Done — `robert.esm.2207@gmail.com`, staging, name + phone confirmed in `user_settings` |
| Twilio dedicated sender number wired | ☐ | ✓ Done — `user_settings.twilio_from_number` added, `evaluate-rules`/`check-reminders` extended, Robert's row set to +13433260166 |
| Second real account for third-party live triggers | ☐ | ✓ Done — `whwh2207@gmail.com` / (343) 655-3227, plays Linda's role |
| `gmail.insert` OAuth scope added (for backfilling historical emails) | ☐ | ✗ Not done — required before the 30 seed emails can be pushed |
| Seed script built (contacts + calendar via Google APIs, emails via Gmail insert, lists via `manage-list`) | ☐ | ✗ Not done |
| 8 PDF files generated (5 invoices + 3 other types) | ☐ | ✗ Not done |
| Geo-arrival simulation script | ☐ | ✓ Done and tested end-to-end — `scripts/simulate-geo-arrival.js`, confirmed `fired: true` against a real test rule |
| Second-device (Evidence) capture method confirmed | ☐ | ⚠ Open — Linda's number is a Twilio virtual number with no native Messages app; still undecided whether Evidence capture is the Twilio Console message log, a forwarded/visible app, or something else. **Constraint on the choice** (per `docs/PRODUCTION_PRESENTATION_GOVERNANCE.md` §2): whichever method is chosen must display light/white background, never dark — check this before committing to a method, not after. Resolve before relying on this for Demo 1/3/5. |

## 2. Pre-Recording Reset

Run before **every** recording session — including re-shooting a scenario already filmed once. State drifts between takes; this is what catches it before 20 minutes get spent wondering why a reminder didn't fire.

- [ ] No pending location alert already matches this take's trigger (Home-arrive, Costco-arrive, etc.) — a same-condition alert from a prior take will block a new one via the duplicate-prevention guard. Delete or disable it first.
- [ ] Every `action_rules` row created by a prior take is either deleted or, if `one_shot`, already auto-disabled and safe to leave (confirm it won't collide with the new take's creation).
- [ ] Inbox state matches what this take expects (no stray test emails from a previous take's `gmail.insert` runs, no un-cleared "Xxx"-style test artifacts).
- [ ] Calendar state matches expected seed data.
- [ ] Reminders/lists reset to expected content (e.g., the Costco list still has real items for Demo 5, not emptied by a prior take).
- [ ] Notifications cleared on both the primary device and the Evidence-capture device.
- [ ] Screen recording confirmed running and correctly framed on both devices before the take starts, not checked after.
- [ ] If using the geo-simulation script: confirm the target rule exists, is enabled, and its `trigger_config.resolved_lat/lng/radius_meters` are populated (the script fails loudly if not — but check before rolling camera, not after).
- [ ] Twilio dedicated sender number (`user_settings.twilio_from_number`) still set — nothing should have reverted it to the shared default between sessions.

---

## Changelog

- **v1.0 (2026-07-28):** initial document, merging the Infrastructure Check / Pre-Recording Reset split agreed during the Production Governance reconciliation. External review, this document in isolation: ChatGPT, 2026-07-28 — PASS, no mandatory changes, Wael's explicit final confirmation given the same day.
- **Correction (2026-07-28):** the isolated-review line above predates the seven-file Production Governance package (Presentation Governance, Presentation Assets, master template, pilot Scenario Package) assembled later the same day. That complete-package cross-document review found corrections needed elsewhere (see `docs/PRODUCTION_GOVERNANCE.md` changelog) — this document's own content was not reopened by that review. This entry is not, and should not be read as, package-wide approval.
- **v1.0, same day — added a constraint to the Evidence-capture-method item:** whichever second-device capture method is chosen must support light/white display, per the new light-mode requirement in `docs/PRODUCTION_PRESENTATION_GOVERNANCE.md` §2.
