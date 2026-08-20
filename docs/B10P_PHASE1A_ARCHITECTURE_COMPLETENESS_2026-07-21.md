# B10p — Phase 1A: Architecture Completeness Review

**Date:** 2026-07-21
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.6, Phase 1A
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4

No code was written in producing this document.

---

## 1. What is the architectural owner of the affected capability?

Per the Architecture Reference's Ownership Model (§0a): **Mobile** — same as B10o. Confirmed unchanged.

## 2. Is the capability Shared Core, Duplicated, or Platform-specific?

**Platform-specific to mobile, not duplicated with voice — re-verified directly, not assumed from B10o's carryover.** Re-ran the check B10o's Phase 1A used: `naavi-voice-server/src/index.js` still has zero matches for `task_actions`. Voice remains structurally unable to construct the self+third-party location-alert scenario this presentation change would apply to (no `task_actions`/per-utterance `tasks` mechanism exists in its action_config model). Since voice can never produce the multi-part confirmation this fix reformats, there is nothing on voice to change — not a gap, a non-applicability, same reasoning as B10o, independently re-confirmed rather than inherited on assumption.

**Within mobile, this reuses an existing pattern rather than duplicating one.** The compound-plan numbered format (`app/index.tsx:1305`, `hooks/useOrchestrator.ts:4306`) is the single existing implementation of "present multiple confirmation facts as a numbered list." B10p does not create a second, independent numbered-list mechanism — it applies that same presentational idea to the location-alert confirmation's own text construction (still built via B10o's `lib/alertReadback.ts` + the 5 call sites), it does not literally invoke the compound-plan code path itself (different trigger conditions, different turn shape — `isCompoundResult` is keyed off multiple independently-requested *actions*, not multiple facts about one alert).

## 3. All documented implementations — investigated and disposed

Reuses B10o's Phase 1A inventory of the 5 confirmation-generating sites in `hooks/useOrchestrator.ts` (re-verification, not blind reuse — confirmed the same 5 sites still exist post-B10o via source read): `pendingLocationRef` commit (new/reactivated/merged variants), memory-hit direct insert, clarification-memory-hit, `reArmLocationRule`, and the 2 merge-into-existing-alert sites. All 5 are in scope for B10p's presentation question, since all 5 can carry more than one fact (self-task, third-party, list_name, or a combination).

**Open design question surfaced for Phase 2, not resolved here:** the existing compound-plan format only triggers at **3 or more** items (`hooks/useOrchestrator.ts:4306`, `compoundBreakdownLines.length >= 3 && dedupedActions.length >= 3`). A location alert's confirmation typically carries at most 2 facts (self-task + third-party). Phase 2 must not jump straight to "2 facts becomes numbered" — it must explicitly evaluate and state the intended presentation at each count tier, separately:
- **1 fact** (only a self-task, or only a third-party message, no other content) — keep the existing single-sentence form, or number it too?
- **2 facts** (the common case — self-task + third-party) — numbered list, or a different lightweight separation?
- **3+ facts** (e.g., self-task + third-party + a list_name reference all present at once) — same layout as 2, or does it converge with the compound-plan format's own behavior?
- **Should every count use one consistent format, or is a different treatment for 1 vs. 2+ legitimate?**

This must be a stated design decision in Phase 2, not an implicit consequence of whatever threshold gets coded first.

## 4. Does the documented problem scope match the Architecture Reference?

**Matches.** Same Mobile ownership, same Protected Core classification (Action Rules), no Shared Core or Voice involvement — consistent with B10o and re-verified independently above, not merely inherited.

## 5. Is any documented implementation excluded from the investigation?

No implementation is excluded from investigation. Voice is excluded from the *fix* (nothing to change, re-verified with direct evidence, not assumed).

---

## Status and next steps

Phase 1A complete. Per the Independent Review Rule, this needs its own review pass before Phase 2. Per the Phase-Gate Approval Rule, your own explicit go-ahead is required before Phase 2 begins.
