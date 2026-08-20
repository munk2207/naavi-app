# Production Presentation Assets

Version 1.0 — 2026-07-28. Owned by `docs/PRODUCTION_GOVERNANCE.md` §2.

**Answers:** what reusable production assets exist? This document is inventory — status and location, not rules. Every rule referenced below (why a color, why a pacing target) lives in `docs/PRODUCTION_PRESENTATION_GOVERNANCE.md`; this document doesn't restate it.

**Status key:** ✓ Exists and ready · ⚠ Defined but not yet in video-ready form · ✗ Not yet created.

---

## 1. Asset Inventory

| Asset | Source | Format | Location | Status |
|---|---|---|---|---|
| Logo (light) | Unconfirmed — no dedicated logo file located in `mynaavi-website` during this pass | — | — | ✗ Locate or produce |
| Logo (dark) | Same as above | — | — | ✗ Locate or produce |
| Icon only | Site favicon may already cover this — unconfirmed | — | `mynaavi-website` (favicon via `shared.js`) | ⚠ Verify suitability for video use |
| Brand colors | `shared.js` `:root` token block | CSS custom properties | `mynaavi-website/shared.js` | ⚠ Defined for web; needs export as a CapCut/editor color-preset file |
| Fonts | Nunito + Inter, Google Fonts | Web font (`.woff2` via Google Fonts CDN) | `mynaavi-website/shared.js`, `index.html` | ⚠ Defined for web; needs local font files installed in the editing environment (CapCut needs local font files, not a CDN link) |
| Backgrounds | None produced for video | — | — | ✗ Not yet created — recommend deriving from `--bg-app`/`--bg-card` cream tones per Presentation Governance §4 |
| Notes cards (library) | Card list drafted in the original template proposal (Voice command, Location detected, Reminder scheduled, Calendar updated, Email sent, SMS delivered, List updated, Task completed, Appointment booked, Waiting…, Done) | CapCut card template, one per state | — | ✗ Not yet built — content list exists, visual design doesn't |
| Evidence frames | Device-frame graphic for the second-device proof shot | Image/CapCut overlay | — | ✗ Not yet created |
| Context frames | Any framing treatment applied to context footage (if any — TBD whether Context needs a frame at all or plays full-bleed) | — | — | ✗ Undecided — see Implementation Readiness |
| Device frames | Phone-bezel overlay for both MyNaavi and Evidence regions | Image/CapCut overlay | — | ✗ Not yet created |
| Intro asset | Logo reveal animation (teal glow) | CapCut animation preset | — | ✗ Not yet created — spec in Presentation Governance §5 |
| Closing asset | Outro logo + CTA card | CapCut animation preset | — | ✗ Not yet created — spec in Presentation Governance §5 |
| Transitions | Hard cut (scenes), teal wipe (Context→Evidence), fade+pulse (open/close) | CapCut transition presets | — | ✗ Not yet created — spec in Presentation Governance §8 |
| Live Audio preset | Recording chain for on-camera dialogue/phone sounds (levels, noise floor) | Audio preset/settings | — | ✗ Not yet defined — this is a capture-setup spec, not just an editing preset; depends on final recording device/mic choice |
| Narration preset | ElevenLabs voice + settings for MyNaavi presentation narration | ElevenLabs voice ID + export settings | — | ✗ Not yet chosen. **Related, not identical:** the app itself already has two governed voices (Andromeda = brand/outward-facing, Hera = in-app) per `CLAUDE.md`'s VOICE ROLE SPLIT. Presentation narration should very likely use **Andromeda** — she's already the brand voice for exactly this kind of outward-facing explainer content — but this needs Wael's confirmation since it's a genuinely new use, not an automatic extension. |
| Subtitle preset | Style per Presentation Governance §7 | CapCut caption style | — | ✗ Not yet created |
| Thumbnail template | — | Image template | — | ✗ Not yet created |
| CapCut master-project | — | `.capcut` project | — | ✗ Not yet created — structure defined below (§2); actual file must be hand-built in CapCut, no tool available to author it programmatically |

## 2. CapCut Master-Template Structural Specification

This is a structural outline for the master project, not yet a buildable specification — the actual `.capcut` file has to be built by hand in the CapCut app, and it is not yet precise enough that two editors would independently build the same template from it. **Not yet specified, required before this can be called mechanical:**

- Exact canvas resolution and frame rate
- Exact pixel or percentage coordinates for every region (Presentation Governance §1 gives a percentage split for MyNaavi/Notes/Context, but not margins, corner radii, or gutter width)
- Region margins, gaps, and corner radii
- Notes-card dimensions and text-safe area
- Subtitle safe-zone, and its relocation position when it would conflict with an active Notes card (Presentation Governance §10 states Notes wins the position — the exact fallback position isn't specified)
- Evidence full-width vs. overlay geometry (Presentation Governance §1 says "full-width or a prominent overlay" — which, and its exact geometry, isn't decided)
- Intro and outro exact durations
- Transition exact durations
- Target audio levels and Narration-under-Live-Audio ducking values
- Export resolution, frame rate, codec, and bitrate
- Whether Context is cropped, blurred, framed, or full-bleed (Presentation Assets §1 already flags this as undecided)

Until these are decided (a mix of Wael's creative calls and mechanical settings that follow once the creative calls are made), treat what follows as the shape of the template, not a build sheet.

**Canvas:** 16:9 — confirmed as the target aspect ratio; exact resolution/frame rate still pending per the list above.

**Visual/audio track stack** — persistent layers present in every scenario, top to bottom (highest z-order first). A track's role is fixed by the master; a track may hold multiple clips belonging to the scenario currently loaded (Evidence in particular is a folder of potentially several captures, not one file):

1. Subtitle track (Live Audio captions) — empty, placeholder text "LIVE AUDIO SUBTITLE"
2. Notes card track — empty, placeholder card labeled "NOTES CARD — replace per scene"
3. Evidence overlay track — empty, activates only during Evidence beats, placeholder device frame with "EVIDENCE — second device proof" label
4. MyNaavi screen region (left, ~40% width per Presentation Governance §1) — empty video slot, labeled "MYNAAVI SCREEN RECORDING"
5. Context region (right, ~35% width) — empty video slot, labeled "CONTEXT FOOTAGE"
6. Live Audio track (synced to MyNaavi region) — empty, labeled "LIVE AUDIO"
7. Narration track — empty, labeled "NARRATION (ElevenLabs)"
8. Background/chrome track — cream background per Presentation Governance §4, static, always present

**Timeline sections** — these are time-based sections (compound clips/grouped sequences), not persistent z-order tracks, and shouldn't be modeled as if they were:

- **Intro** — logo reveal + title card, per Presentation Governance §5
- **Core scenario** — the scenario's own Storyboard sequence, running through the track stack above
- **Proof hold** — the Evidence beat's minimum hold time, per Presentation Governance §9
- **Outro** — end card, per Presentation Governance §5

**Explicitly excluded from the master:** any Robert/Linda/Home/Costco content, any specific Notes card text beyond the placeholder labels above, any specific narration script, any specific footage. The master is regions and timing, not content — a scenario's actual content gets dropped into these slots per the Scenario Package convention, never edited into the master itself.

**Replacement workflow (how a scenario actually uses the master):**
1. Duplicate the master project — never open and edit the master file directly.
2. Rename the duplicate to match the Scenario Package folder name.
3. Drop that scenario's `MyNaavi_Screen.mp4` into track 4, `Context.mp4` into track 5, `Evidence/` clips into track 3, `Live_Audio.mp4` into track 6, `Narration.mp3` into track 7. One scenario only per project copy — a track may contain multiple clips belonging to that scenario (Evidence in particular is commonly more than one capture), but never clips from two different scenarios.
4. Populate the Notes card track (track 2) and subtitle track (track 1) from that scenario's `Notes.md` and `Storyboard.md`, in order.
5. Export. The master itself is never touched again until the template itself changes — a scenario-level fix never edits the master, and a master-level fix (e.g. a new transition default from Presentation Governance) gets made once in the master and only affects scenarios duplicated *after* that point, not retroactively.

**Who builds this:** this is a manual CapCut build task, not something producible from this session. Recommend Wael (or whoever does the first edit) builds it directly in CapCut following the track list above, saves it as the master, and follows the replacement workflow per scenario from then on.

---

## Changelog

- **v1.0 draft (2026-07-28):** initial inventory + master-template structure, drafted per the Production Governance implementation sequence. Nearly every asset is ✗ not yet created — this document's value right now is the specification, not the inventory (there's little to inventory yet). Colors/fonts ⚠ exist as web tokens but need export to video-ready form. Awaiting Wael's review and ChatGPT's governance-quality pass.
- **v1.0, same day — self-correction before external review:** added the explicit Replacement Workflow (§2) — the master-template structure had regions and tracks but no stated procedure for how a scenario actually populates them, a gap in template completeness caught during self-check against ChatGPT's stated review criteria.
- **v1.0, same day — corrections from ChatGPT's complete-package review ("Revision required"):** (1) renamed §2 from "CapCut Master-Template Structure" to "CapCut Master-Template Structural Specification" and added an explicit list of settings not yet decided (canvas resolution/frame rate, exact region coordinates/margins/corner radii, Notes-card dimensions, subtitle safe-zone relocation position, Evidence full-width-vs-overlay geometry, intro/outro/transition durations, audio levels and ducking values, export codec/bitrate, Context treatment) — the document previously called the build "mechanical" when it wasn't yet. (2) Split §2 into a persistent "Visual/audio track stack" and separate "Timeline sections" (Intro/Core scenario/Proof hold/Outro) — intro and outro had been listed as z-order tracks 9–10 alongside Notes/subtitles/footage, which they are not; they're time-based sections. (3) Revised the Replacement Workflow's "one file per track" instruction to "one scenario only per project copy — a track may contain multiple clips belonging to that scenario," since Evidence is explicitly a folder of potentially several captures, not a single file.
- **v1.0, finalized 2026-07-28:** ChatGPT's complete-package review — "Approved for production governance." Wael's explicit confirmation given the same day: "governance work complete." Draft status removed.
