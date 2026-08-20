# B10o — Phase 3: Technical Review (Before Coding)

**Date:** 2026-07-21
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 3 — required, Phase 2's risk classification is Medium.
**Input:** `docs/B10O_PHASE2_CHANGE_PLAN_2026-07-21.md`

No code written in producing this document. This is the implementation plan submitted for external technical review, self-assessed against the five Phase 3 evaluation dimensions before that review.

---

## Self-assessment against the five review dimensions

### Assumptions

- **Assumed:** the `tasks` field on `action_config` can arrive as either a string or a `string[]` — direct evidence for both shapes exists in the current code (`hooks/useOrchestrator.ts:1652` treats it as an array via `Array.isArray(...) ? ... as string[] : []`; the classifier prompt at `naavi-chat/index.ts:1683` documents it as a single string, e.g. `tasks:"X"`). The helper's contract must accept both without assuming one. Not yet verified empirically which shape actually reaches the client in practice today — Phase 4 implementation must handle both defensively rather than assume the prompt-documented shape is what's really received.
- **Assumed:** `task_actions` entries always carry `to_name` and `body` as the fields to read (confirmed directly — `recipientSuffix`/`memoryHitRecipientSuffix` already read exactly these two fields today, at `useOrchestrator.ts:1669-1670` and `:3983-3984`). No new assumption introduced here, just reused.
- **Assumed:** none of the 5 call sites have a reason to want *different* self-task/third-party wording for the same underlying data — stated explicitly in Phase 2, not silently assumed.

### Architecture

- Stays within the mobile entry point's legitimate job (translating stored `action_config` into speech), does not add new business logic about what gets written to `action_rules`.
- Does not touch Protected Core's fire-time half (`evaluate-rules`, `report-location-event`, `_shared/alert_body.ts`) at all — confirmed in Phase 2's Regression Impact table.
- New file `lib/alertReadback.ts` matches the existing convention of pure-logic modules living outside `hooks/` (`lib/list_connections.ts`, `lib/maps.ts`, `lib/memory.ts`) rather than growing `useOrchestrator.ts` further, which is already a very large file.

### Isolation

- The helper takes only `actionConfig` (a plain object) and returns a string — no access to `pendingLocationRef`, no access to network/storage/navigation state. Per the functional contract added in Phase 2 review, it cannot reach into or affect anything outside its own inputs/output.
- Each of the 5 call sites' change is isolated to swapping its own local suffix-construction with a call to the helper — the surrounding headline logic, error handling, and DB-write logic at each site is untouched.

### Hidden coupling

- **Checked:** does any of the 5 sites rely on a side-effect of building the suffix inline (e.g. a variable declared during suffix-building that's reused later in that function)? Reviewed each site's surrounding code in Phase 1A's citations — no evidence of this; `recipientSuffix`/`memoryHitRecipientSuffix` and equivalents are used exactly once, immediately, to build the final speech string, then discarded.
- **Checked:** does `reArmLocationRule` (site #4) get called from any path *other than* the 2 call sites already identified, where a change to its speech might surface somewhere unexpected? Per Phase 1A's investigation, one additional call site exists inside `commitPending` (`useOrchestrator.ts:1427`) — but that call site's own speech is already discarded and rebuilt by its caller (site #1's logic), so it is not a third independent consumer of `reArmLocationRule`'s speech; already correctly excluded from the file list in Phase 2.

### Implementation strategy

- Suffix-only extraction (not full headline unification) — confirmed as the deliberately bounded scope, justified in Phase 2.
- Order of implementation recommended: (1) write `lib/alertReadback.ts` + its own unit tests in isolation first, verifying the precedence table from Phase 2 exactly; (2) wire into the 2 originally-known sites (#1, #2) and re-verify against the original live reproduction; (3) wire into the 3 newly-found sites (#3, #4, #5); (4) full regression suite.

---

## Implementation Boundaries Confirmed

- **Authorized files, and the specific change in each:**
  - `lib/alertReadback.ts` (new) — add `buildAlertReadbackSuffix(actionConfig)` per the Phase 2 functional contract and precedence table. No other exports.
  - `hooks/useOrchestrator.ts` — replace the ad-hoc suffix construction at the 5 identified sites (lines as cited in Phase 1A/Phase 2) with calls to the new helper. No other changes to this file.
  - `tests/catalogue/session-2026-07-21-b10o-location-readback.ts` (new) — regression tests per Rule 15a.
  - `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` — close-out entry once shipped.
- **No additional files are approved beyond those listed.**
- **No opportunistic refactoring is approved** — e.g., no renaming of unrelated variables, no touching the 5 sites' headline logic, no cleanup of adjacent code even if noticed.
- **No architectural changes are approved beyond what Phase 2 describes** — no headline unification, no changes to how `action_config` is stored or validated, no changes to voice or Shared Core.

## Deferred Architectural Decisions

1. **Unifying the 5 sites' headline phrasing (not just the suffix), for a single fully-shared confirmation builder.** Not approved for this implementation — the headlines genuinely differ by mode (new/merged/reactivated/re-armed/clarification-hit) and there's no bug behind unifying them; doing so now would be scope creep with no evidence-backed justification, per Phase 2's explicit boundary. **Reconsider if:** a future bug is found in headline construction itself (not just the suffix), giving a concrete reason to revisit.
2. **Extending the same suffix-naming fix to the `time`/`email` trigger-type resolver's `taskSummary`/`toLabel` gap** (found as a related-but-out-of-scope issue during Phase 1A, `naavi-chat/index.ts:2426-2438`). Not approved for this implementation — different trigger types, different file (server-side, not mobile), and B10o's evidence base doesn't cover it. **Reconsider as:** its own holding-list item, to be opened separately.

---

## Status and next steps

Phase 3 self-assessment complete, ready for external review. Per the Phase-Gate Approval Rule, coding does not begin until that review returns and you give separate explicit go-ahead to Phase 4.
