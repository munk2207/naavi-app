# B10p — Phase 5: Evidence Package

**Date:** 2026-07-21
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.6, Phase 5

---

## Summary

Location-alert confirmations carrying 2+ distinct facts (self-task, third-party message) now render as a numbered list instead of a run-on sentence, per the approved count-tier table. 0 and 1-fact cases are unchanged. New `combineHeadlineAndFacts` + `getAlertReadbackFacts` functions in `lib/alertReadback.ts`, wired into the same 4 sites B10o converted.

## Files changed

| File | Change |
|---|---|
| `lib/alertReadback.ts` | Added `getAlertReadbackFacts(actionConfig): string[]` (clean fact fragments, no leading space) and `combineHeadlineAndFacts(headline, facts): string` (the count-tier presentation logic). `buildAlertReadbackSuffix` kept for the one site still using it (the merged branch's own headline construction is unaffected by B10p). |
| `hooks/useOrchestrator.ts` | Same 4 sites B10o converted (`449, 1671-1672, 1804-1809, 3981-3983` post-edit) switched from suffix string-concatenation to a facts array + `combineHeadlineAndFacts`. Removed the now-unused `buildAlertReadbackSuffix` import (dead code from this same edit, cleaned up, not opportunistic). |
| `tests/catalogue/session-2026-07-21-b10p-location-numbered-facts.ts` (new) | 12 tests: full count-tier table (0/1/2/3+) against `combineHeadlineAndFacts` directly, `getAlertReadbackFacts`'s array shape/omission behavior, each of the 4 call sites' wiring, and confirmation the 2 merge sites remain untouched. |
| `tests/catalogue/session-2026-07-17-b10h-location-content-guard.ts`, `tests/catalogue/session-2026-07-17-b10j-location-compound-self-reminder.ts` | 4 existing tests updated — see below. |
| `tests/runner.ts` | Registered the new test file. |

## Predictable regression caught and fixed before it shipped

The same 4 tests updated during B10o's Phase 4 (to check the B10o-era `buildAlertReadbackSuffix`/`recipientSuffix`/`memoryHitReadbackSuffix` wiring) broke again here, for the identical reason: B10p's call-site changes removed the exact variable names those tests asserted on. Anticipated this from B10o's own experience and fixed all 4 in the same pass as the implementation, rather than discovering it via a broken suite afterward. Updated to check the new `getAlertReadbackFacts`/`combineHeadlineAndFacts` wiring, same IDs preserved.

## Implementation strategy followed (per Phase 3's required sequencing)

1. Unit-tested `combineHeadlineAndFacts` + `getAlertReadbackFacts` in isolation first — 8 tests, all passing, before touching any call site.
2. Wired the 4 call sites, with structural tests confirming each one's wiring.
3. Full regression suite — clean.
4. Manual by-ear validation — deferred to Phase 7, as planned (this is the one part not provable from source alone).

## Tests executed

```
✓ 487 passed   ✗ 0 failed   ⨯ 1 errored   ⧗ 0 timed out   ○ 2 skipped
```

- **12/12 new B10p tests pass**, including all 4 count tiers and the exact live-reproduced scenario.
- **4/4 previously-broken structural tests (B10h/B10j) fixed and passing**, same pattern as B10o's own Phase 5.
- 1 error, unrelated and pre-existing, 2 pre-existing OAuth skips — **verified identical to the pre-B10p baseline by direct comparison of saved test result files, not assumed:**

  | | Pre-B10p baseline (`tests/results/2026-07-21T11-51-11-969Z.md`) | Post-B10p (`tests/results/latest.md`) |
  |---|---|---|
  | Error | `f10a.website-nav-feedback-link-homepage-only` | `f10a.website-nav-feedback-link-homepage-only` |
  | Skip 1 | `contacts.no-match-returns-empty` | `contacts.no-match-returns-empty` |
  | Skip 2 | `calendar.create-event` | `calendar.create-event` |

  Exact same test IDs in both runs — no new instability introduced.
- `npx tsc --noEmit`: zero errors in any of the 5 touched files.

## Test coverage mapping (per Phase 5 review request)

| Requirement | Test(s) |
|---|---|
| 0 facts | `b10p.zero-facts-unchanged-sentence` |
| 1 fact | `b10p.one-fact-unchanged-sentence` |
| 2 facts | `b10p.two-facts-numbered-list-the-original-bug` |
| 3+ facts | `b10p.three-plus-facts-same-numbered-treatment` |
| Facts array shape (no leading space, correct order) | `b10p.facts-array-no-leading-space` |
| Absent facts omitted, not empty strings | `b10p.facts-array-omits-absent-facts` |
| Headline whitespace handling | `b10p.headline-whitespace-trimmed` |
| Call site: `pendingLocationRef` commit | `b10p.pendingLocationRef-commit-uses-combiner` |
| Call site: memory-hit direct insert | `b10p.memory-hit-uses-combiner` |
| Call site: clarification-memory-hit | `b10p.clarification-memory-hit-uses-combiner` |
| Call site: re-arm | `b10p.rearm-uses-combiner` |
| Merge sites unchanged | `b10p.merge-sites-remain-untouched` |

## Manual tests required

Per Phase 3's flagged assumption: the numbered/multi-line confirmation's actual spoken audio for *this specific* trigger has not been heard yet — the compound-plan precedent validates the pipeline generally, not this exact confirmation. Recreate the B10o/B10p scenario on the batched staging build and listen, not just read the screen.

## Rollback instructions

Revert the 5 changed/added files. No database, no Edge Function, no server-side state.

## Known risks

- Numbered-list speech for this specific confirmation type is unvalidated by ear until Phase 7.
- The 2 merge-into-existing-alert sites still present their content as plain prose, inconsistent with the new/reactivated/re-arm paths — a known, deliberate scope boundary, not a regression.

## Status and next steps

Phase 4/5 complete. Per the Phase-Gate Approval Rule, your own explicit go-ahead is required before Phase 6.
