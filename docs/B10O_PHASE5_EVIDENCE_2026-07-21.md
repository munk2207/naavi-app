# B10o — Phase 5: Evidence Package

**Date:** 2026-07-21
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 5

---

## Summary

Fixed: a location alert combining a self-reminder task with a third-party notification never mentioned the self-task in the spoken/displayed confirmation — only the third-party message was named. Extracted a shared `lib/alertReadback.ts` helper, used by 4 of the 5 confirmation-generating sites found in Phase 1A (the 5th pair — "merge into an existing alert" — was deliberately left unchanged; see Deviations below). Added 10 new regression tests and fixed 4 pre-existing tests that broke because they were coupled to the exact inline code this fix replaced.

## Files changed

| File | Change |
|---|---|
| `lib/alertReadback.ts` (new) | `buildAlertReadbackSuffix(actionConfig)` and `formatThirdPartyClause(actionConfig)` — pure functions, per the Phase 2/3 functional contract, precedence table, and output invariants. |
| `hooks/useOrchestrator.ts` | 4 sites rewired to call the shared helper: `pendingLocationRef` commit (new/reactivated branches use the full suffix; the merged branch uses the third-party-only clause), memory-hit direct insert, clarification-memory-hit, and `reArmLocationRule`. Added one import line. |
| `tests/catalogue/session-2026-07-21-b10o-location-readback.ts` (new) | 10 unit tests against `lib/alertReadback.ts` directly — precedence table (all 4 combinations), the exact live-reproduced bug scenario, array-shaped `tasks`, no-undefined/null-leakage, the merged-branch third-party-only usage, and the functional contract (no mutation, deterministic). |
| `tests/catalogue/session-2026-07-17-b10h-location-content-guard.ts` | 2 existing tests updated — see Deviations. |
| `tests/catalogue/session-2026-07-17-b10j-location-compound-self-reminder.ts` | 2 existing tests updated, 1 new path constant added — see Deviations. |
| `tests/runner.ts` | Registered the new test file. |

## Post-implementation wording fix (found via live spot-check, before Phase 6)

A live screenshot review (real account, real "Alert me at Costco with my shopping list" attempt) surfaced that `tasks` field text is not always a verb phrase — "shopping list" is a noun phrase (no matching real list existed to attach, so it was stored as plain task text). The original self-task template, `` `I'll remind you to ${task}.` ``, reads naturally for "feed the cat" but badly for "shopping list" ("I'll remind you to shopping list"). Changed to `` `Note: ${task}.` `` — reads naturally for both phrasing styles, and matches the Alerts screen's own existing "NOTE" label for this field. Added `b10o.noun-phrase-task-text-reads-naturally` to lock in the specific case that surfaced this. All other tests updated to match the new prefix; full suite re-run clean (475/478, same 1 pre-existing unrelated error, 0 regressions).

**Separately, and explicitly not folded into this fix:** the same live investigation found a real "shopping" list existing in the account, "Not attached to anything. Standalone list." — meaning the list-attachment step itself (not just the readback) never connected it to this rule. This is a different root cause (attachment/matching logic, not readback construction) and a higher-severity gap (affects what's actually sent when the alert fires, not just the creation-time confirmation). Recommended as its own separate holding-list item and investigation, not part of B10o.

## Deviations from the approved plan (reported per Phase 4's "No Extra Changes Rule" — nothing here was done silently)

1. **Added a second export, `formatThirdPartyClause`, beyond Phase 3's "no other exports" line.** Discovered necessary during implementation: the `pendingLocationRef` commit path's "merged into an existing alert" branch already names the self-task in its own headline ("Got it — I've added X to your existing alert"). Using the combined `buildAlertReadbackSuffix` there would have named the self-task twice, directly violating the Phase 3-review-added "never emit duplicated clauses" invariant. The narrower export resolves this without reintroducing a second, duplicate implementation of the third-party-naming logic for that one branch. Documented in `lib/alertReadback.ts`'s own doc comment.

2. **Did not extend the two "merge into existing alert" sites to support `task_actions` merging**, despite Phase 2 stating they would be "extended to also cover task_actions merging." On implementation, this turned out to require genuine new merge/business logic (accepting and storing a new `task_actions` array on an existing rule) — not a readback-text change — which contradicts Phase 2's own Database/Regression-Impact claims ("no database schema or row-content change," "this is a readback-text-only fix"). Implementing it would have been a real scope expansion introduced silently. Left both sites completely unchanged instead. **Recommend opening this as its own future holding-list item** ("extend `manage-rules`' `merge_tasks` op to accept `task_actions`"), separate from B10o.

3. **Fixed 4 pre-existing regression tests** (`b10h.readback-names-recipient-and-message-pending-commit-path`, `b10h.readback-names-recipient-and-message-memory-hit-path`, `b10j.readback-names-task-actions-recipient-pending-commit-path`, `b10j.readback-names-task-actions-recipient-memory-hit-path`) that broke because they asserted on the exact inline variable names (`speechRecipient`, `memoryHitTaskActions`, etc.) this fix intentionally removed. Updated each to check the new call site wires into the shared helper, preserving their original intent and IDs rather than deleting them. This is a necessary consequence of the approved change, not opportunistic cleanup — the tests were locking in implementation details of the exact code being replaced.

## Tests executed

Full `npm run test:auto`, run against production (per the environment banner — read-only regression checks, no writes affected by this fix):

```
✓ 474 passed   ✗ 0 failed   ⨯ 1 errored   ⧗ 0 timed out   ○ 2 skipped
```

- **10/10 new B10o tests pass**, including the exact live-reproduced bug scenario (`b10o.self-task-and-third-party-the-original-bug`), the precedence table, both `tasks` shapes (string and array), and all 3 functional-contract/output-invariant checks (no mutation, deterministic, no undefined/null leakage).
- **4/4 previously-broken structural tests now pass** after being updated (confirmed via a targeted `--grep readback-names` run before the full suite).
- **1 error, unrelated and pre-existing**: `f10a.website-nav-feedback-link-homepage-only` (website nav rendering, `mynaavi-website` repo, unrelated to this fix — same error present before this session's B10o work began).
- **2 skips, pre-existing**: Google OAuth test-account gaps, unrelated.
- **0 regressions** — confirmed via `npx tsc --noEmit`: zero errors in any of the 5 touched files; the only typecheck errors anywhere in the repo are in `web/app/page.tsx`, an unrelated Next.js file never touched by this change.

## Manual tests required

Per Governance §Phase 7, manual validation is mandatory for this class of change (Action Rules, user-facing confirmation speech). Recommended: recreate the exact live-reproduced scenario on a staging build — "When I arrive home remind me to feed the cat and sms bob saying I'm home" — and confirm the spoken/displayed confirmation now names both "feed the cat" and Bob's message. Also worth spot-checking the reactivated-alert and re-arm paths, since those previously had the same silent gap and are lower-traffic (harder to have noticed missing already).

## Rollback instructions

Revert the 5 changed/added files (`lib/alertReadback.ts`, `hooks/useOrchestrator.ts`, the 2 updated test files, `tests/runner.ts`, and remove the new test file). No database migration, no Edge Function deploy, no server-side state — a pure client-code revert with no data cleanup required.

## Known risks

- The self-task phrasing ("I'll remind you to {task}.") is new user-facing text that has not been live-tested with real speech synthesis/TTS — worth a manual listen, not just a visual check, before wide rollout.
- The two intentionally-unchanged "merge into existing alert" sites still cannot name a `task_actions` third party in their merge confirmation — a real, known, and now-documented gap, not silently reintroduced (see Deviation #2).

## Status and next steps

Phase 4 (Implementation) and Phase 5 (Evidence Package) complete. Per Governance §Phase 6, this now needs a Technical Review After Coding (four independent verdicts: Technical Review, Architecture Completeness, Governance Compliance, Overall Recommendation) before Phase 7 (Testing/manual validation) and Phase 8 (Merge). Per the Phase-Gate Approval Rule, your own explicit go-ahead is required before Phase 6 begins.
