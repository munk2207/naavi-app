# B10p — Phase 3: Technical Review (Before Coding)

**Date:** 2026-07-21
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.6, Phase 3 — required, Phase 2's risk classification is Medium.
**Input:** `docs/B10P_PHASE2_CHANGE_PLAN_2026-07-21.md`

No code written in producing this document.

---

## Self-assessment against the five review dimensions

### Assumptions

- **Assumed:** the existing `speakResponse`/`sanitiseForSpeech` pipeline handles a numbered, multi-line confirmation acceptably for *this* trigger, based on the compound-plan precedent. Direct evidence exists that `sanitiseForSpeech` doesn't strip numbering (confirmed by source read, B10p Phase 1), and Wael has confirmed sound/text stay in sync *for compound-plan turns specifically*. **Not yet proven for this specific new confirmation shape** — Phase 2 already flagged this as a regression concern requiring a fresh Phase 7 by-ear check, not assumed to transfer automatically.
- **Assumed:** newlines within the single `speech`/`assistantSpeech` string render as visible line breaks on screen. Not an unproven assumption — directly evidenced by the live screenshot in B10p's Phase 1 (the compound-plan turn visibly shows each numbered item on its own line).
- **Assumed:** `emitPendingTurn`'s single-string mechanism (no separate display/speech fields) needs no modification. Supported by the same precedent — compound-plan already ships successfully through this exact mechanism.

### Architecture

- Stays within the mobile entry point's job (formatting), no new business logic, no change to what's written to `action_rules`.
- No Shared Core or Voice involvement (re-confirmed independently in Phase 1A).
- One new pure function, reused by all 4 applicable call sites — no per-site duplication introduced.

### Isolation

- `combineHeadlineAndFacts` takes only a headline string and a facts array, returns a string — no access to component state, network, or storage. Same isolation profile as B10o's helpers.

### Hidden coupling

- **Checked:** does any new headline text risk colliding with `app/index.tsx:1305`'s `isCompoundPlan` detection (`/^Here are your \d+ actions:/`), which drives auto-scroll-to-top behavior? The location-alert headline text (e.g., "Here's what happens when you arrive at Home:") does not match that regex's exact opening phrase ("Here are your... actions:") — confirmed no collision, but the exact final headline wording chosen in Phase 4 must be checked against this regex again before implementation is considered done, since a coincidental future wording change could accidentally trigger it.
- **Checked:** do any existing tests assert an exact full confirmation string (headline + suffix combined), which this change would break? B10o's own tests (`session-2026-07-21-b10o-location-readback.ts`) assert only on the *suffix*-building functions (`buildAlertReadbackSuffix`, `formatThirdPartyClause`) in isolation, not on any call site's fully-assembled string — so they are not coupled to the headline/suffix combination this change restructures. No other test file was found asserting a full confirmation string for these sites (confirmed via the same source sweep used in B10o's Phase 6).
- **Checked:** does `formatSelfTaskClause`/`formatThirdPartyClause`'s current output shape (leading space, trailing period, formatted for string concatenation) work directly as array elements for a numbered list, or does it need adjustment? **Not yet resolved — flagged for Phase 4.** These functions currently return strings like `" Note: feed the cat."` (leading space for suffix-append). A numbered list needs clean sentence fragments without the leading space. Phase 4 must either trim these before array insertion or add a facts-array-specific accessor that returns untrimmed-for-concatenation text separately from trimmed-for-listing text — an implementation detail, not an architecture change, so it doesn't require returning to Phase 2.

### Implementation strategy

Recommended order, refined per Phase 3 review to separate helper correctness from integration correctness:

1. **Unit-test `combineHeadlineAndFacts` in isolation** — validate the full count-tier table (0/1/2/3+) directly against the function, including the leading-space/trailing-punctuation cleanup noted above, before it's wired into anything.
2. **Verify each of the 4 call sites assembles its `facts[]` array correctly** — each site is exercised only against the tier(s) it can actually produce given its own inputs (e.g., a site that can only ever carry a self-task and a third-party message is tested at 0/1/2, not fabricated up to 3+; a site is not tested against a count shape it cannot structurally produce).
3. **Full regression suite**, once (1) and (2) both pass independently — isolates whether any failure is in the helper, the wiring, or an unrelated regression.
4. **Manual by-ear validation in Phase 7** — the one part of the plan not fully provable from source alone, per the Assumptions section above.

---

## Implementation Boundaries Confirmed

- **Authorized files, and the specific change in each:**
  - `lib/alertReadback.ts` — add `combineHeadlineAndFacts(headline: string, facts: string[]): string` per the Phase 2 count-tier table and functional contract (pure, deterministic, formatting-only). Add whatever minimal facts-array accessor is needed to feed it cleanly (resolved in Phase 4, per Hidden Coupling above). No other exports beyond what this requires.
  - `hooks/useOrchestrator.ts` — the same 4 sites converted in B10o (`449, 1671-1672, 1802, 3978`), switched from suffix string-concatenation to building a facts array and calling the new combiner. No other changes to this file.
  - `tests/catalogue/session-2026-07-21-b10p-...ts` (new) — regression tests per Rule 15a.
  - `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` — close-out entry once shipped.
- **No additional files are approved beyond those listed.**
- **No opportunistic refactoring is approved** — the 2 merge-into-existing-alert sites, any other confirmation type, and any unrelated code in the touched files stay untouched.
- **No architectural changes are approved beyond what Phase 2 describes.**

## Deferred Architectural Decisions

1. **Including `list_name` as a third fact type.** Not approved for this implementation — depends on the separate, not-yet-scoped list-attachment bug. **Reconsider when:** that bug is fixed and list_name becomes reliably present to name.
2. **Applying numbered-facts treatment to the 2 merge-into-existing-alert sites.** Not approved — same reasoning as B10o's Deviation #2, those sites would need their own logic work first. **Reconsider if:** those sites are ever extended for other reasons and their own readback gets revisited.
3. **Applying this presentation pattern to other confirmation types elsewhere in the app** (beyond location alerts). Not approved — out of this item's evidence base entirely. **Reconsider if:** a similar multi-fact-crammed-into-one-sentence pattern is found elsewhere and evidenced separately.

---

## Status and next steps

Phase 3 self-assessment complete, ready for external review. Per the Phase-Gate Approval Rule, coding does not begin until that review returns and you give separate explicit go-ahead to Phase 4.
