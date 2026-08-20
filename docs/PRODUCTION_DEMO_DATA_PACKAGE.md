# Production Demo Data Package

Version 1.0 — 2026-07-28. Owned by `docs/PRODUCTION_GOVERNANCE.md` §4.

**Answers:** what permanent demo world does every presentation draw from?

## The principle

Every future MyNaavi demo reuses the same people, places, and accounts — it does not invent a new cast per video. The value isn't in creating demo data; it's in committing to reuse the same dataset consistently, so it becomes part of the product's identity rather than disposable production material. A viewer who's seen more than one demo should recognize Robert, Linda, and Costco the way they'd recognize a recurring character — that recognition is free brand consistency no amount of editing polish can buy.

**When a new scenario needs a person or place not yet in the roster:** add it to this package — don't invent a one-off. Same discipline as the codebase's own Configuration Discipline: extend the existing thing, don't create a parallel one.

## The current roster

Full detail — exact addresses, phone numbers, email content, calendar events — lives in `docs/YOUTUBE_DEMO_SEED_DATA_2026-07-23.md`, which this document formalizes into its governed role rather than replaces. Quick reference:

**Persona:** Robert Sinclair, Ottawa — Senior Project Manager, Kellert & Fife Engineering.

**Household:** Elena (wife), Maya & Ethan (kids), Biscuit (dog).

**Recurring cast (13 contacts):** Elena Sinclair, Maya Sinclair, Ethan Sinclair, Nadia Farah (sister), Priya Nair (manager), Dr. Sarah Osei (dentist), Dr. Aaron Lévesque (family doctor), Tom Reyes (contractor), Grace Lindqvist (work coordinator), Marcus Webb (financial advisor), **Linda Fournier** (neighbour — plays live-trigger roles, real phone/email), **James Okafor** (college friend — layered-lookup demos, no live trigger needed), Dr. Chloe Bennett (vet).

**Recurring places (6 locations, real and geocodable):** Home (Woodlawn, ON), Work (Kellert & Fife, downtown Ottawa), Client site (Riverside Dr), Costco (Merivale Rd), Ottawa Athletic Club (Merivale Rd), Westboro Medical & Dental Clinic.

**Real accounts, for live on-camera triggers only:**
- Robert — `robert.esm.2207@gmail.com`, (343) 326-0166 — the demo account itself.
- Linda — `whwh2207@gmail.com`, (343) 655-3227 — the only cast member who needs to be real, since she's the one live SMS/email trigger goes to.

Everyone else in the roster is fictional-but-well-formed — real enough to search, backfill, and reference, never needing to send or receive anything for real.

## Extending the roster

Before adding a new person or place:
1. Check whether an existing cast member already fits the new scenario's role — reuse before adding.
2. If genuinely new, add it to `docs/YOUTUBE_DEMO_SEED_DATA_2026-07-23.md` with the same rigor as the original build (real, geocodable address if it's a location; real contact info only if a live on-camera trigger needs it).
3. Update this document's Quick Reference roster in the same pass — don't let this summary drift from the source of truth the way the closed-item bloat drifted in the holding list before it got archived.

---

## Changelog

- **v1.0 (2026-07-28):** initial document, formalizing `docs/YOUTUBE_DEMO_SEED_DATA_2026-07-23.md` (built 2026-07-23) into its governed role as the permanent, reusable Demo Data Package. External review, this document in isolation: ChatGPT, 2026-07-28 — PASS, no mandatory changes, Wael's explicit final confirmation given the same day.
- **Correction (2026-07-28):** the isolated-review line above predates the seven-file Production Governance package (Presentation Governance, Presentation Assets, master template, pilot Scenario Package) assembled later the same day. That complete-package cross-document review found corrections needed elsewhere (see `docs/PRODUCTION_GOVERNANCE.md` changelog) — this document's own content was not reopened by that review. This entry is not, and should not be read as, package-wide approval.
