# B10o — Phase 1A: Architecture Completeness Review

**Date:** 2026-07-21
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 1A
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4
**Trigger:** ChatGPT's Phase 1 review (Approved) required this phase explicitly verify whether `pendingLocationRef` and the memory-hit commit path are the *complete* set of location-alert confirmation-generating code paths, or merely the two found so far.

No code was written in producing this document.

---

## Finding: Phase 1 undercounted the affected paths. Scope expands from 2 to 5 within mobile alone.

A full-codebase investigation (mobile, `naavi-chat` server, voice server) found **3 additional mobile code paths** with the same class of gap, confirmed the server never independently builds a location post-confirmation message, and confirmed voice has its own separate implementation that is structurally unable to reach this bug's exact scenario.

## 1. What is the architectural owner of the affected capability?

Per the Architecture Reference's Ownership Model (§0a): **Mobile** (`munk2207/naavi-app`, client code under `hooks/`). Confirmed — every confirmation-generating site found lives in `hooks/useOrchestrator.ts`.

## 2. Is the capability Shared Core, Duplicated, or Platform-specific?

**Duplicated, two ways:**
1. **Intra-file duplication within mobile itself** — 5 distinct sites in `hooks/useOrchestrator.ts` independently construct location-alert confirmation speech, each with its own copy of the naming logic (or lack of it), rather than one shared builder.
2. **Mobile vs. Voice** — voice (`naavi-voice-server/src/index.js`) has its own, entirely separate location-alert confirm-then-commit implementation (`commitLocationRule`), consistent with this codebase's already-documented pattern of duplicated Action Rules creation/confirmation logic (Architecture Reference §2a).

## 3. All documented implementations — investigated and disposed

### Mobile (`hooks/useOrchestrator.ts`) — 5 sites found, all investigated

| # | Location | Self-task named? | 3rd-party named? | Status |
|---|---|---|---|---|
| 1 | `1609-1682` — `pendingLocationRef` yes-confirm commit | Only in the "merged into existing alert" variant (line 1678); **no** in the "new"/"reactivated" variants (1680-1681) | Yes (`recipientSuffix`, 1665-1675) | **In Phase 1's original scope** |
| 2 | `3890-3996` — memory-hit direct insert | No | Yes (`memoryHitRecipientSuffix`, 3979-3989) | **In Phase 1's original scope** |
| 3 | `1748-1808` — clarification-memory-hit (mid-clarification query resolves via memory/settings) | **No** | **No** | **New finding** — omits both; never received the 2026-07-17 B10h/B10j readback fix at all |
| 4 | `389-456` (`reArmLocationRule` helper) + call sites `3725-3728`, `3859-3886` | No | No | **New finding** — generic re-arm speech, used directly and unmodified by 2 call sites |
| 5 | `3696-3699`, `3859-3860` — merge-into-*existing*-alert paths | Partial (tasks/list_name only where handled) | **No** — no `task_actions` merge handling exists here at all | **New finding**, different scenario (existing alert, not first creation) but same completeness gap |

All 5 are confirmed real, user-reachable code paths, not speculative. Site #1 (Phase 1's original finding) turns out to be *partially* fixed already, in a branch Phase 1 didn't distinguish — the "merged" variant does name the self-task; only the "new"/"reactivated" variants (the ones in the live screenshot reproduction) don't.

### `supabase/functions/naavi-chat/index.ts` — investigated, confirmed no independent post-confirmation path for location

- `buildActionConfirm`'s location branch (`1860-1915`) builds only a first-turn proposal stub (`"Setting up an alert for when you arrive at {place}."`, line 1866) — by design (comment at 1861-1862: mobile's `resolve-place` flow must run before the rule can be written), and it mentions neither the self-task nor the third-party recipient at this stage.
- Location alerts are explicitly routed as an **immediate-emit** action (`3138-3141`, comment: `"Immediate-emit intents: DRAFT_MESSAGE, SET_ACTION_RULE(location)"`), bypassing the server's own Step-1.4 "Done. Alert set..." resolver (`2310-2472`) entirely — that resolver is confirmed reachable only for `time`/`email` trigger types, gated at `2892`/`2436`.
- **Related-but-out-of-scope finding:** that same `time`/`email` resolver (`2426-2438`) has the identical *class* of bug — `taskSummary`/`toLabel` only ever describe third-party `task_actions`/`to`, never a self-task (`tasks`/`list_name`). This is not a location-alert path and is explicitly **not** folded into B10o's fix scope — flagging for its own future holding-list item rather than scope-creeping this one.

### `naavi-voice-server/src/index.js` — investigated, confirmed out of scope with justification (not silence)

Voice has 5 of its own confirmation-speech sites (`10729`, `10679`, `10804`, `11783`, `4400`) with the same *class* of gap (generic "Alert set" text, no self-task or third-party naming). **However, voice is structurally unable to construct this bug's exact scenario:**

- Zero matches for `task_actions` anywhere in `naavi-voice-server/src/index.js`.
- Zero matches for a per-utterance self-task string field (mobile's `tasks`) on `SET_ACTION_RULE` — voice's only "attach self content" mechanism is `list_name` (an existing/new to-do list), a coarser, different construct.
- Voice's action_config model enforces an explicit invariant (code comment + logic, `4699-4719` and repeated at `11443-11450`): **a stored row must never carry both a `self_override_*` field and any third-party destination field** — i.e., voice treats an alert as self-only *or* third-party-only, with no overlay concept equivalent to mobile's `task_actions`.

Per the Architecture Scope Rule, this is not silence about an unchecked implementation — it's a directly verified, evidence-based exclusion. Caveat, stated at the same confidence level the investigation itself used: this is an absence-of-evidence finding from a targeted search across a ~12,000-line file, not a formal proof of impossibility — the full Haiku/Claude classification prompt's JSON schema wasn't traced in exhaustive detail. Treated here as sufficient to exclude voice from this fix's scope; would need to be revisited if a future voice session adds a `task_actions`-equivalent construct.

## 4. Does the documented problem scope match the Architecture Reference?

**Not fully — Phase 1 must be corrected before Phase 2 planning.** Phase 1 documented 2 mobile paths; this review found 5. The Architecture Reference's classification (Mobile-owned, Protected Core, Full Phase 1-8) still holds, but the *specific implementations requiring a fix* is materially larger than Phase 1 stated.

## 5. Is any documented implementation excluded from the investigation?

No. All three surfaces named in the Architecture Reference's ownership model for this capability (Mobile, Voice, Shared Core) were investigated. Voice is excluded from the *fix*, with direct evidence, not from the *investigation*.

---

## Governance note for Phase 2

Phase 2's Change Impact Matrix and Regression Matrix must now account for 5 mobile sites, not 2 — including the two genuinely new scenarios (clarification-memory-hit omitting both fields entirely; the re-arm/merge paths' broader gap). This likely strengthens the case (already raised in Phase 1 §4) for a single shared readback-builder helper used by all 5 sites, rather than patching each independently — Phase 2 should weigh that against a narrower per-site patch, same tradeoff this codebase has faced before (see B10g's `_shared/task_actions.ts` extraction as precedent for the "shared module over N independent patches" pattern).

## Status and next steps

Phase 1A complete. Per the Independent Review Rule, this needs its own review pass before Phase 2 begins. Per the Phase-Gate Approval Rule, your own explicit go-ahead is required before Phase 2 work starts, regardless of that review's verdict.
