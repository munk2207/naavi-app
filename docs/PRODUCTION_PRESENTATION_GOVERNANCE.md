# Production Presentation Governance

Version 1.0 — 2026-07-28. Owned by `docs/PRODUCTION_GOVERNANCE.md` §1.

**Answers:** how should every MyNaavi presentation communicate? This document is rules, not inventory — asset files live in `docs/PRODUCTION_PRESENTATION_ASSETS.md`, and no scenario-specific content (Robert, Linda, Home, Costco, or any other demo-world specifics) belongs here. If a rule references a specific person or place, it's misfiled — move it to the Scenario Package.

**Status note:** every rule below marked **[RECOMMENDED DEFAULT]** is a proposal grounded in the existing MyNaavi brand system, not an invented one — awaiting your approval, not yet binding. Unmarked rules are structural: they define what a presentation must distinguish (MyNaavi, Notes, Context, Evidence; Evidence replaces Context during proof beats) rather than how it looks, and don't require a creative decision. Where a section states a structural requirement and then a specific geometry or value on top of it, only the geometry/value carries the `[RECOMMENDED DEFAULT]` marker — the requirement itself is binding.

---

## 1. Screen Regions and Hierarchy

**Structural, binding:** every presentation distinguishes four roles — MyNaavi (the live screen recording, the proof), Notes (plain-language tracking of what's happening), Context (scene-setting footage), and Evidence (second-device proof). Evidence does not get a permanent region of its own — it replaces Context temporarily, only during the beat where a second device's screen is the proof (SMS received, email received). Reserving a permanent region for something active only a few seconds per video wastes space the other regions need the rest of the time.

**[RECOMMENDED DEFAULT]** Three-region horizontal layout, in this priority order (most important to least, left to right): MyNaavi (left, ~40% width, most visual weight), Notes (center, ~25% width), Context (right, ~35% width, present but visually secondary). The exact split, the horizontal arrangement, and the left-to-right ordering are all part of this default — only the four roles above and the Evidence-replaces-Context rule are structural.

**Why this order, not some other:** the MyNaavi screen is the only region that can't be faked or reused across scenarios — it's live proof of the actual product. Everything else exists to help the viewer understand what they're looking at.

## 2. Region Usage Rules

- **MyNaavi:** always live screen recording, never a mockup or a screenshot sequence. If the real screen isn't ready to record, the scenario isn't ready to film — see Technical Readiness, not a workaround here.
- **Notes:** one active card at a time, matching the Storyboard's Notes Timeline. Never two cards on screen simultaneously — see Visual-Clutter Limits (§9).
- **Context:** silent or ambient-only audio (see §3). Never carries dialogue or narration itself.
- **Evidence:** always framed as a real device (see device-frame requirement in Presentation Assets), never a bare screenshot floating with no framing — a raw screenshot reads as an edited claim, a framed device reads as something that actually happened. **The captured device/app must be in light mode — white or light background, never dark.** MyNaavi's region is dark by default (§4); if Evidence is also dark, the two proof sources blur together visually. Light-vs-dark is the fastest signal a viewer has that "this is a different device, a different proof" — faster than any label. This is a hard constraint on which second-device capture method gets chosen (see `docs/PRODUCTION_TECHNICAL_READINESS.md`'s still-open Evidence-capture-method item): whichever method is picked must support a light-mode display.

## 3. Live Audio vs. Narration

Defined structurally in `docs/PRODUCTION_GOVERNANCE.md` — restated here as a communication rule, not a file-format rule:

- **Live Audio** (what actually happened — Robert's spoken command, phone/notification sounds) is the primary audio track under the MyNaavi and Evidence regions. It is never replaced by narration paraphrasing what was said — if the live audio is unclear, subtitle it (§7), don't re-voice it.
- **Narration** (ElevenLabs, added after) explains context and stakes the live audio doesn't carry on its own — never repeats verbatim what Live Audio already said.
- **When both would play at once:** Narration ducks under Live Audio, never the reverse. Live Audio is the evidence; Narration is the guide.

## 4. Branding and Typography

**[RECOMMENDED DEFAULT]** Reuse the existing MyNaavi brand system already live in production — don't create a second one for video. The actual tokens (fonts, hex values, source files) are inventoried in `docs/PRODUCTION_PRESENTATION_ASSETS.md` §1; this section states the rule for *how* to apply them, not what they are.

**[RECOMMENDED DEFAULT]** MyNaavi region keeps the app's own real dark UI, unaltered (it's a screen recording — the app's actual chrome IS the app's actual chrome). Notes and surrounding production chrome use the brand system's light/cream palette. The primary accent is the one color that appears in both, functioning as the visual thread connecting the product to the production around it.

**[RECOMMENDED DEFAULT]** The alert/attention accent is reserved for a Notes card's "issue" state — never for general emphasis, which would dilute it.

**[RECOMMENDED DEFAULT]** The existing type scale is reused proportionally at the video canvas size, not reinvented with new proportions for video.

**Logo:** no dedicated logo asset file was located during this pass — status tracked in Presentation Assets, not here.

## 5. Opening and Closing Structure

**[RECOMMENDED DEFAULT]**
- **Open:** MyNaavi logo reveal (teal glow, matching the pulse/glow treatment already used in the site's own demo animations) → title card (Nunito, h1 scale) → cut directly into "THE ASK." No cold open before branding — the viewer should know what they're watching within 2 seconds.
- **Close:** final proof beat holds for 1–2 extra seconds after the last Notes card completes (let the payoff land before cutting away) → end screen with title recap + a single call-to-action → outro logo, same treatment as the open, not a different one.

## 6. Pacing

**[RECOMMENDED DEFAULT]** Each Storyboard scene (per the Notes Timeline convention) targets 2–4 seconds on screen — long enough to read the active Notes card, short enough that a 5-part demo stays under 60–90 seconds total. If a scene needs longer than 4 seconds to make its point, that's a signal the scene is doing two jobs and should split into two, not that the pacing rule should bend.

## 7. Subtitles

**[RECOMMENDED DEFAULT]** Live Audio (Robert's spoken commands, any dialogue) is always subtitled, so the command and dialogue remain understandable when audio is unavailable, muted, unclear, or difficult for the viewer to hear. Narration is not subtitled by default (it's explanatory audio, not evidence) unless a specific platform requires full captioning. Subtitle style: Inter, body-scale, white text with a soft dark backing (not a hard box) positioned in the lower third, clear of the Notes region.

## 8. Transitions

**[RECOMMENDED DEFAULT]** One transition style per boundary type, used consistently, not varied per video:
- Between Storyboard scenes: hard cut (no dissolve) — matches the pacing rule's snappy target.
- Context → Evidence swap: quick teal-accented wipe, signaling "this is proof," not just a scene change.
- Open/close logo reveal: fade + teal glow pulse (matching the existing site animation language).

## 9. Proof Visibility

Evidence must be on screen, full-width or clearly dominant, for a minimum hold time before any cut — **[RECOMMENDED DEFAULT: 2 seconds minimum]**. A proof beat that flashes by faster than a viewer can read it defeats the entire purpose of filming Evidence instead of just asserting the feature works.

## 10. Visual-Clutter Limits

Hard rules, not defaults — these prevent the template from degrading over time as more elements get added per video:

- Never more than one Notes card active at once.
- Never more than two regions carrying information-dense content simultaneously (MyNaavi + Notes, or MyNaavi + Evidence — never all three information-dense at once; Context is allowed to run alongside anything since it's intentionally low-information).
- Subtitles and Notes cards never overlap on screen — if both would occupy the lower-third at once, the Notes card wins the position and the subtitle moves, never the reverse (Notes is diegetic to the product, subtitles are an accessibility layer, both matter, but they cannot collide).

## 11. Simulation and Evidence Integrity

Added 2026-07-28, per ChatGPT's complete-package review (recommended, adopted).

Simulation is permitted for controlled production and template validation, provided the resulting product behavior is real — e.g., `scripts/simulate-geo-arrival.js` genuinely fires the real alert rule, it just supplies the GPS input a physical drive would otherwise provide. What's not permitted: presenting Context footage as documentary proof of the triggering event unless it was actually captured during the same genuine arrival that fired the rule. **Evidence proves the product result; Context illustrates the situation** — the two must never be edited to imply a causal link between them that didn't actually happen (e.g., showing Robert cross a real geofence and cutting directly to the notification as if that exact crossing caused it, when the rule was actually fired separately by a script).

No prominent on-screen "simulation" disclaimer is required. The restriction is narrower and more durable than that: the edit must not fabricate the causal sequence, regardless of whether it's disclosed.

---

## Changelog

- **v1.0 draft (2026-07-28):** initial document, drafted per the Production Governance implementation sequence. Branding/typography/pacing/opening-closing/transitions/proof-visibility recommendations grounded in the existing `mynaavi-website` brand system (verified via `shared.js`, `index.html`, and the site's existing demo-animation components), not invented. Awaiting Wael's review of all `[RECOMMENDED DEFAULT]` items and ChatGPT's governance-quality pass.
- **v1.0, same day — self-correction before external review:** §4 previously restated the full color/font token table that also lives in `docs/PRODUCTION_PRESENTATION_ASSETS.md` §1 — an ownership-boundary violation caught during self-check against ChatGPT's stated review criteria, before submission. Replaced with a pointer to Assets for the actual values; §4 now states only the application rule (dark app UI unaltered, accent as connector, alert accent reserved, scale reused proportionally).
- **v1.0, same day — corrections from ChatGPT's complete-package review ("Revision required"):** (1) §1 previously marked the entire three-region layout `[RECOMMENDED DEFAULT]`, conflicting with the document's own status note that screen regions were structural. Reconciled: the four region roles and the Evidence-replaces-Context rule are now stated as structural/binding; only the exact percentage split and left-to-right ordering carry the `[RECOMMENDED DEFAULT]` marker. (2) §7's subtitle rationale claimed silent-autoplay viewing is "the majority case on every platform this content will run on" — broader than the evidence supplied. Replaced with an accessibility-based rationale (audio unavailable, muted, unclear, or hard to hear) that doesn't depend on an unverified platform-behavior claim.
- **v1.0, same day — added §11 Simulation and Evidence Integrity**, adopted from ChatGPT's recommended (non-mandatory) findings: simulation may trigger real product behavior, but Context footage must never be edited to imply a causal link to the triggering event that didn't actually happen. Applied immediately to the pilot's own Storyboard (scene 4→5).
- **v1.0, same day — Wael's addition:** §2's Evidence rule now requires light/white background on the captured second device, never dark — MyNaavi is dark by default (§4), and Evidence needs to read as visually distinct rather than blur into more MyNaavi footage. Constrains the still-open Evidence-capture-method decision in Technical Readiness.
- **v1.0, finalized 2026-07-28:** ChatGPT's complete-package review — "Approved for production governance" — approval is for the documentation framework, not for the videos themselves or technical readiness to record. Wael's explicit confirmation given the same day: "governance work complete." Draft status removed.
