# B10o — Phase 1: Problem Definition

**Date:** 2026-07-21
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 1
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4

No code was written in producing this document.

---

## 1. What exactly is broken?

When a user creates a location alert that combines a self-reminder task with a third-party notification (e.g. "When I arrive home remind me to feed the cat and sms Bob saying I'm home"), Naavi's spoken/displayed confirmation names the third-party message but **never mentions the user's own self-task**. The user hears "Alert set — one time you arrive at Home. Bob will get 'I'm home'." with no mention of "feed the cat" anywhere.

The underlying data is saved correctly — this is not a repeat of B10h (which was a data-loss bug, the self-task body was silently dropped from the DB row). Here the self-task is correctly extracted and stored; it simply never appears in what Naavi says back to the user.

## 2. What evidence proves the problem?

**Live reproduction, 2026-07-21, Wael's phone, production build 311, real account.** Screenshot evidence: user message "When i arrive home remind me to feed the cat and sms bob saying I'm home." → Naavi's confirmed alert: "Alert set — one time you arrive at Home. Bob will get "I'm home"." — "feed the cat" absent.

**Root cause located in code, both known insert paths:**

1. **`pendingLocationRef` commit path** (`hooks/useOrchestrator.ts:1650-1682`) — line 1652 extracts `newTasks` from `action_config.tasks`. The `speech` template for a newly-created alert (line 1681, `` `Alert set — ${modeText} you arrive at ${pending.resolved.place_name}.${recipientSuffix}` ``) never references `newTasks`. `newTasks` is only used in the unrelated `merged` branch (line 1678, "adding to an *existing* alert" case) — for a brand-new alert, it's extracted and then discarded.

2. **Memory-hit commit path** (`hooks/useOrchestrator.ts:3955-3996`) — same shape. `memoryHitRecipientSuffix` (lines 3979-3989) covers only `to_name`/`to`/`task_actions` (the third-party half); there is no equivalent extraction of the self-task text in this path at all, and the `turnSpeechOverride` template at line 3991 has nowhere to put it even if there were.

Both paths carry the comment "B10h/B10j readback fix (2026-07-17) — name the recipient + message when this alert targets a third party" — confirming these fixes were scoped specifically to the third-party half and never extended to also name the self-task when one is present alongside it.

## 3. Root cause

**Proven, by direct code citation:** the B10h/B10j readback fix (2026-07-17) added third-party-naming logic to both commit paths but did not extend it to also surface the self-task text, in either path. This is not "probably" — the `recipientSuffix`/`memoryHitRecipientSuffix` construction is visibly scoped to `to_name`/`to`/`task_actions` only, and `newTasks` (path 1) is extracted but unused for the new-alert case.

**Not proven:** whether this was a deliberate scope decision at the time (e.g. "the self-task is implied by the user's own request, only the third-party surprise needs confirming") or a plain oversight. No comment or commit message states a reason for the narrower scope. Given CLAUDE.md Rule 12's own stated purpose — "so the user can verify Naavi acted on the correct interpretation and detect mis-resolutions immediately" — a self-task that was mis-transcribed or mis-extracted would be just as invisible to the user as a mis-resolved third-party message, so there's no evidence-backed reason to treat the two asymmetrically.

## 4. What alternatives were considered?

Not yet — this is Phase 1 (investigation only), no fix proposed here. Candidate directions to weigh in Phase 2 (Change Planning): (a) extend both `recipientSuffix` builders to prepend the self-task text before the third-party clause, mirroring the existing pattern; (b) a unified readback-builder helper shared between both commit paths, since the two paths currently duplicate the same logic independently (itself a smaller instance of the intra-file duplication pattern already tracked elsewhere in this codebase's architecture debt).

## 5. Architecture Reference ownership (Phase 1 citation requirement)

Per `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` §4 (Protected Core table): **Action Rules** — `hooks/useOrchestrator.ts (mobile write paths)` is explicitly named. Mobile-only (both affected commit paths are client-side React Native code; no server-side or voice-server equivalent exists for this specific readback construction). **Full Phase 1-8** review level required.

## 6. No Assumptions Rule compliance check

Every claim above is backed by a specific citation (file:line, live screenshot, or explicit "not proven" label). §3 explicitly separates what's proven (the code scope gap) from what isn't (whether the narrow scope was intentional).

## 7. Status and next steps

Phase 1 complete. Per the Phase-Gate Approval Rule, this requires your explicit separate go-ahead before Phase 1A (Architecture Completeness Review) begins.
