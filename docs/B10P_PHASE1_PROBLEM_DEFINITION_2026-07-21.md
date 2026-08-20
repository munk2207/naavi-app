# B10p — Phase 1: Problem Definition

**Date:** 2026-07-21
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.6, Phase 1
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4

No code was written in producing this document.

---

## 1. What exactly is broken?

Not a functional defect — a formatting inconsistency. The location-alert confirmation (just fixed for content-completeness in B10o) renders as a single run-on sentence carrying 2-3 distinct pieces of information ("Alert set — one time you arrive at Home. Note: feed the cat. Bob will get 'I'm home'.") — while the app already has an established, accepted numbered-list pattern for exactly this situation (multiple distinct outcomes in one confirmation): the compound-plan format ("Here are your 3 actions:\n1. ...\n2. ...\n3. ...\n\nSay yes to confirm all, or no to cancel."). Wael has confirmed directly, from live use, that for the compound-plan pattern the spoken audio and displayed text are 100% in sync — this is not a hypothetical risk, it's an already-shipped, already-validated pattern.

The location-alert confirmation should use the same established pattern instead of its own bespoke prose template.

## 2. What evidence proves the problem?

**Live screenshot, 2026-07-21** — compound-plan pattern in actual use: "Naavi, alert me when I arrive to office, and send bob say review the plan, and schedule a meeting with hussein tomorrow at 11:00 am" → "Here are your 3 actions:\n1. Alert me when I arrive at the office\n2. Send Bob a message saying 'review the plan'\n3. Schedule a meeting with Hussein tomorrow at 11:00 AM\n\nSay yes to confirm all, or no to cancel."

**Direct code citation for the compound-plan mechanism:** `supabase/functions/naavi-chat/index.ts:3443` (system prompt instructs Claude: `Start your response with exactly this line: "Here are your [N] actions:"`), `hooks/useOrchestrator.ts:4306` (`isCompoundResult` detection), `app/index.tsx:1305` (`isCompoundPlan` regex match on `assistantSpeech`). Confirmed via direct read of `sanitiseForSpeech` (`hooks/useOrchestrator.ts:4846-4908`, the function `speakResponse` always runs text through before TTS) that it does **not** strip numbered-list markers or newlines — the literal "1. 2. 3." text is what reaches TTS, matching Wael's direct confirmation that sound and text stay in sync for this pattern.

**Contrast — the location-alert confirmation's current shape**, from this session's own live screenshots and B10o's Phase 5 evidence: single-sentence templates built in `hooks/useOrchestrator.ts` (`buildAlertReadbackSuffix` + each site's own headline), never restructured into a list even as B10h/B10j/B10o each added more content onto the same sentence shape.

## 3. Root cause

**Proven:** the location-alert confirmation was originally a single-sentence template, predating B10h/B10j/B10o. Each of those three fixes added another clause onto the same sentence (third-party naming, then self-task naming) rather than restructuring the output — so it now carries up to 3 distinct facts (place/time, self-task, third-party message) crammed into one sentence, which is exactly the shape the compound-plan numbered pattern already exists to solve elsewhere in the app. That established pattern was simply never applied to this confirmation.

**Not proven / not applicable:** this isn't a defect with an unclear cause — it's a design gap (an existing good pattern not yet reused here), so Phase 1's usual "root cause of the bug" framing is answered as above rather than a traditional defect trace.

## 4. What alternatives were considered?

1. **Reuse the exact compound-plan numbered format** ("Here's what happens when you arrive at [place]:\n1. [self-task]\n2. [third-party message]") — **recommended**, reuses an already-proven, already-accepted pattern rather than inventing a new one. **UX rationale, stated explicitly (per Phase 1 review):** this is a different interaction shape than the compound-plan case — one trigger with multiple consequences, not multiple independently-requested operations. The numbered-list presentation is being carried over on its own merits for *this* scenario, not merely because the code already exists: it improves readability whenever multiple outcomes are attached to one confirmation, which is exactly this case (a single arrival triggering both a self-reminder and a third-party message). Code reuse is a secondary benefit, not the justification.
2. **Invent a new bespoke multi-line format specific to location alerts** — not recommended; adds a second pattern to maintain for the same underlying problem (multi-part confirmation) the compound-plan format already solves.
3. **Leave as prose** — status quo, doesn't address the readability/consistency concern that prompted this item.

## 5. Architecture Reference ownership (Phase 1 citation requirement)

Same as B10o: per the Architecture Reference §4 Protected Core table, **Action Rules** — `hooks/useOrchestrator.ts` (mobile write paths). Mobile-owned. **Full Phase 1-8** required.

**Relationship to B10o, stated explicitly (not left implicit):** this touches the exact same confirmation-building code B10o just finished (Phase 6 Approved, committed, not yet built/manually tested). Kept as its own separate item per earlier explicit agreement this session (different kind of change — formatting vs. content-completeness) — but Phase 2's Regression Matrix must trace against B10o's *just-shipped* `lib/alertReadback.ts` helper, not the pre-B10o code, since B10o's commit is already the current baseline.

## 6. No Assumptions Rule compliance check

Every claim is backed by a citation (file:line, live screenshot, or Wael's direct confirmation of sound/text sync) or labeled as a design gap rather than a traditional defect where that framing doesn't fit.

## 7. Status and next steps

Phase 1 complete. Per the Phase-Gate Approval Rule, this requires your explicit separate go-ahead before Phase 1A begins.
