# MyNaavi Production Governance

Version 1.0 — 2026-07-28.

**If you're Wael and you just want to make a video: stop here, go to `docs/PRODUCTION_QUICKSTART.md` instead.** This document and the four it links to are Claude's operating discipline, not a human's day-to-day manual — they exist so consistency holds across sessions, not so you have five documents to personally track.

## Purpose

This is the platform-agnostic reference for producing any MyNaavi demo or presentation video — YouTube today, whatever platform comes next. Its job is the same one `docs/AI_DEVELOPMENT_GOVERNANCE.md` does for code: make a repeatable process out of something that would otherwise be reinvented from scratch every time, and make sure nothing that changes has to be chased across five different documents to find.

**Guiding principle: one responsibility, one owner, one place.** The same architectural discipline already applied to the MyNaavi codebase (Configuration Discipline, single source of truth, no parallel implementations) applies here. Each of the five documents below answers exactly one question. If a rule could plausibly live in two of them, it's misfiled, not doubly-owned.

---

## The Five Documents

| # | Document | Answers | Status |
|---|---|---|---|
| 1 | **Presentation Governance** | How should every MyNaavi presentation communicate — visual identity, tone, pacing? | **Approved** `docs/PRODUCTION_PRESENTATION_GOVERNANCE.md` v1.0 (2026-07-28) — creative defaults still marked `[RECOMMENDED DEFAULT]` per-item, but the document itself is final |
| 2 | **Presentation Assets** | What reusable media exists — logos, CapCut layout template, Notes card library, motion library, typography, audio? | **Approved** `docs/PRODUCTION_PRESENTATION_ASSETS.md` v1.0 (2026-07-28) — inventory + CapCut structural specification; nearly every actual asset file still ✗ not yet created (implementation, not governance, work) |
| 3 | **Technical Readiness** | Is this scenario technically ready to record — infrastructure built, account reset? | `docs/PRODUCTION_TECHNICAL_READINESS.md` |
| 4 | **Demo Data Package** | What permanent demo world does every presentation draw from — which people, which places? | `docs/PRODUCTION_DEMO_DATA_PACKAGE.md` |
| 5 | **Scenario Package** | What's unique to this one video — story, footage, narration, notes timeline, title? | Convention defined below; one folder per scenario, no separate document |

Documents 3 and 4 are drafted first because they depend on implementation details — actual account state, actual seed data, actual infrastructure gaps — that only direct codebase/account access can verify accurately. Documents 1 and 2 depend on creative decisions only Wael can make; they get drafted once those decisions exist, not invented ahead of them.

---

## Why the separation matters

Each document changes independently of the others — that's the whole point of splitting them:

- Replace CapCut next year → only **Presentation Assets** changes.
- Redesign the on-screen visual identity → only **Presentation Governance** changes.
- Twilio changes its API, or the demo account's technical setup changes → only **Technical Readiness** changes.
- A new scenario gets scripted → only a new **Scenario Package** folder is added; nothing else changes.
- The demo world grows (a new recurring contact, a new location) → only **Demo Data Package** changes.

If a change to one of these ever requires editing a second document to stay consistent, that's a sign the boundary between them is wrong and needs fixing — not a normal cost of doing business.

---

## Scenario Package — the convention (not a separate document)

Every scenario lives in its own folder, same shape every time:

```text
<Scenario_Name>/
│
├── Script.md          — the one-sentence story + validated trigger phrasing               [required from the start]
├── Storyboard.md       — scene-by-scene: MyNaavi (left) / Notes (center) / Context (right) / Live Audio / Narration  [required from the start]
├── Notes.md             — the Notes Timeline (time-coded card sequence)                     [required from the start]
├── Exposure.md          — Exposure Classification (see below)                                [required from the start]
├── Title.txt                                                                                 [required from the start, may hold a draft/recommended value]
├── Description.txt      — YouTube description text                                          [required before publishing; may hold a draft value during template validation]
├── Live_Audio.mp4       — captured naturally during the screen recording (Robert's spoken commands, phone sounds, ambient)  [required before recording is complete]
├── Narration.mp3        — ElevenLabs, added after, explains the story to the viewer          [required before recording is complete]
├── MyNaavi_Screen.mp4   — the primary device's screen recording                              [required before recording is complete]
├── Evidence/            — second-device captures: SMS received, email received, calendar invite, notification, call  [required before recording is complete]
├── Context.mp4          — scene-setting footage (walking, driving, entering a location) — own or stock  [required before recording is complete]
├── Thumbnail.png                                                                             [required before publishing]
└── Final.mp4                                                                                  [required before publishing]
```

**Lifecycle status matters more than file presence.** A scenario folder used only to validate the template (no recording yet) legitimately has the planning files populated and the media files absent — that's not an incomplete package, it's a package at an earlier lifecycle stage. Don't read "file missing" as "convention violated" without checking which stage the scenario is actually at.

**Exposure Classification.** Every Scenario Package must identify, in `Exposure.md`:

- **Internal-only data** — real phone numbers, email addresses, residential addresses, account identifiers, credentials, and operational setup details. Necessary to build and run the scenario; must never appear in production footage or published metadata.
- **Safe-to-record data** — names, messages, locations, and screen content approved to appear in captured footage.
- **Safe-to-publish data** — information permitted to remain visible in the final exported video, thumbnail, title, and description.

Internal-only data must never appear in production footage or published metadata. When real operational data is required to execute the scenario (a real phone number the product actually has to text, a real address the geofence actually has to resolve), `Storyboard.md` must state how that data is hidden, cropped, blurred, or replaced in the final presentation — this is not optional documentation, it's the guardrail that keeps a real, live phone number or address from ending up visible in a published video.

**Live_Audio vs. Narration — never confuse these.** Live Audio is what actually happened, captured in the moment (Robert talking to Naavi, notification sounds). Narration is ElevenLabs voiceover added afterward to explain what the viewer is seeing. They are recorded through entirely different processes and must stay in separate tracks/files — a Storyboard that puts both under one "Narration" column, as an earlier draft did, invites someone to try generating the live dialogue in ElevenLabs by mistake.

**Evidence vs. Context — a real distinction, not a stylistic one.** Context is scene-setting (walking toward home) and proves nothing about the product. Evidence is the second device's screen — Linda's phone receiving the SMS, the email arriving — and is the actual proof the feature worked. Treating Evidence as a subtype of Context loses the fact that it needs its own capture setup, its own device, and its own verification step (see Technical Readiness).

---

## Implementation Readiness (2026-07-28)

Status of the pilot build (`Scenarios/Demo1_Arrive_Home_Personal_And_ThirdParty_Message/`), validating the master template against Demo 1.

**Already available, no blocker:**
- Demo Data Package content (cast, locations, real accounts) — complete.
- Geo-arrival simulation script — built and tested end-to-end.
- Twilio dedicated sender number for Robert's account — built and set.
- Brand system to ground Presentation Governance defaults — found and cited (`mynaavi-website/shared.js`).
- Script.md, Storyboard.md, Notes.md, Title.txt for the pilot — drafted, this pass.

**Creative decisions awaiting Wael (each has a recommended default, none are final):**
- All of Presentation Governance §4–§9 (branding reuse, opening/closing, pacing, subtitles, transitions, proof-hold-time) — see that document's `[RECOMMENDED DEFAULT]` markers.
- Whether Context footage needs a frame/treatment at all, or plays full-bleed (Presentation Assets §1, marked undecided).
- Narration voice — recommended Andromeda (already the brand voice for outward-facing content per `CLAUDE.md`), not yet confirmed for this specific use.
- Pilot title (`Title.txt` — drafted with alternates, awaiting approval).
- Logo files — existence unconfirmed; needs Wael to locate or commission.

**Technical blockers (from `docs/PRODUCTION_TECHNICAL_READINESS.md`, unchanged by this pass):**
- `gmail.insert` OAuth scope not added — blocks backfilling the 30 seed emails.
- Seed script not built — nothing writes contacts/calendar/emails/lists yet.
- 8 PDF files not generated.
- **Second-device (Evidence) capture method still unresolved** — Linda's number is a Twilio virtual number with no native Messages app; whether Evidence capture is the Twilio Console log, a forwarded/visible app, or something else is still open. This directly blocks filming scenes 5–7 of the pilot Storyboard (the Evidence beats) even though the planning documents for those scenes are complete.

**What can be built now, despite the blockers above:** the CapCut master-project itself (structure fully specified, doesn't depend on seed data or Evidence resolution), any Notes card / device-frame / transition assets (Presentation Assets §1), and Robert's own screen-recording rehearsal for the non-Evidence beats (scenes 1–4) — none of that needs the email backfill, the PDFs, or the second-device answer to proceed. What can't proceed yet is the full pilot recording end-to-end, since scenes 5–7 need the Evidence question resolved first.

---

## Changelog

- **v1.0 (2026-07-28):** initial document. Reconciles the original MyNaavi Presentation Kit draft with ChatGPT's Phase-3-style review — Evidence Capture split from Context, Live Audio split from Narration, Technical Dependencies/Technical Readiness/Demo States merged into one Technical Readiness document organized by check frequency (infrastructure vs. pre-recording reset), Demo Data Package formalized from the existing `docs/YOUTUBE_DEMO_SEED_DATA_2026-07-23.md` rather than invented fresh.
- **v1.0, same day:** added Presentation Governance and Presentation Assets drafts (grounded in the existing `mynaavi-website` brand system), the CapCut master-template structure, the pilot Scenario Package (`Scenarios/Demo1_Arrive_Home_Personal_And_ThirdParty_Message/`), and this Implementation Readiness section. Documentation and template definition only — no recording performed, per explicit scope.
- **v1.0, same day — corrections from ChatGPT's complete-package review ("Revision required," architecture/scope/evidence-integrity: Pass; scenario-package compliance, template precision, document provenance: Revision required):** eight mandatory corrections applied — (1) removed premature "Approved" changelog language from Technical Readiness and Demo Data Package, replaced with a factual note distinguishing their own isolated review from the still-in-progress complete-package review; (2) reconciled Presentation Governance's screen-layout section so only the exact geometry is a recommended default, not the four region roles themselves; (3) renamed the CapCut section to "Structural Specification" and listed every setting not yet decided; (4) split the CapCut spec into a persistent track stack vs. time-based sections, and corrected "one file per track" to "one scenario per project copy, multiple clips allowed per track"; (5) added the pilot's missing `Description.txt` and a lifecycle-status note to the Scenario Package convention so an earlier-stage package isn't mistaken for an incomplete one; (6) fixed a Notes/Storyboard synchronization error (the "Voice command" card was mapped to the reply scene, not the scene where the command is actually spoken); (7) corrected the pilot Script's proof description from simultaneous "side by side" to the actual sequence, preserving the real ~2-second delivery gap; (8) replaced an unsupported "every platform" subtitle justification with an accessibility-based rationale. A title alternative was surfaced but not changed (reviewer's own recommendation: keep it for the pilot, evaluate later) — narrow-correction scope only, no redesign, no footage, no CapCut build.
- **v1.0, same day — adopted both of ChatGPT's remaining recommendations:** (1) added an **Exposure Classification** requirement to the Scenario Package convention (`Exposure.md`, required from the start) — Internal-only / Safe-to-record / Safe-to-publish data, with a hard rule that internal-only data (real phone numbers, real addresses, account identifiers) must never appear in footage or published metadata, and `Storyboard.md` must state how any required real operational data gets hidden/cropped/blurred/replaced. Applied immediately: `Scenarios/Demo1_.../Exposure.md` created, classifying the pilot's two real Twilio numbers and real street address as internal-only, with handling notes added to its Storyboard. This is not hypothetical for this pilot — Linda's and Robert's phone numbers are real, working numbers; publishing them would expose them to public calls/texts. (2) added `docs/PRODUCTION_PRESENTATION_GOVERNANCE.md` §11 Simulation and Evidence Integrity, and applied it to the pilot Storyboard's scene 4→5 transition.
- **v1.0, same day — Wael's addition:** Evidence must be captured in light/white mode, never dark, so it reads as visually distinct from MyNaavi's dark app UI. Added to Presentation Governance §2, constraining the still-open Evidence-capture-method decision in Technical Readiness.
- **v1.0, finalized 2026-07-28:** ChatGPT's complete-package review — "Approved for production governance" — explicitly scoped as approval of the documentation framework, not of the videos themselves or of technical readiness to record. Wael's own explicit confirmation the same day: "governance work complete." All five documents now final: this master doc, Presentation Governance, Presentation Assets, Technical Readiness, Demo Data Package. Remaining work (CapCut master build, Notes card library, device frames, resolving the Evidence-capture-method blocker, recording the pilot, end-to-end validation) is implementation work the framework exists to organize, not further governance work.
