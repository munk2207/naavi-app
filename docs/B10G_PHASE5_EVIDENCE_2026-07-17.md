# B10g — Phase 5: Evidence Package

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5. Implementation completed exactly within the Implementation Boundaries confirmed in `docs/B10G_PHASE3_TECHNICAL_REVIEW_2026-07-17.md` §3, using the context-object interface decided in §2 of that document.

---

## Summary

`task_actions` (structured third-party sends attached to an alert) attached to a **location**-triggered rule previously had zero execution path — `report-location-event` (the real-time geofence-crossing handler) never read `config.task_actions` at all, so a user who set up "when I arrive at Costco, text my son I'm on my way" as a location alert would get silence for the third party, indefinitely, with no error.

Fix: extracted the existing, already-fail-closed `task_actions` resolution-and-send logic from `evaluate-rules/index.ts`'s F5c block into a new shared module, `supabase/functions/_shared/task_actions.ts`, exporting `executeTaskActions(ctx)`. Both `evaluate-rules` (pure refactor — replaces its inline block with a call) and `report-location-event` (the actual fix — first time this function reads `task_actions`, call placed strictly after the existing fan-out completes) now call the identical shared function. `fire-pending-dwells` needed no change — confirmed it delegates dwell-completion fires back into `report-location-event`'s own `fireLocationAction` via HTTP POST, so the fix covers dwell-based alerts automatically.

Interface: `executeTaskActions({ config, rule, userName, supabaseUrl, interFnKey })` — a context object rather than positional parameters (Phase 3 §2's decision), passing the whole `rule` object rather than separate `ruleId`/`userId` strings specifically to eliminate a same-typed-string transposition risk.

Added 5 new regression tests (`tests/catalogue/session-2026-07-17-b10g-location-taskactions-fix.ts`), retargeted 5 existing F5c tests plus 1 older F5c test (`session-2026-06-13.ts`) whose source-assertions pointed at code that moved, registered in `tests/runner.ts`. Full auto-tester run: 436 tests, 430 passed, 0 failed, 4 errored (all pre-existing/unrelated — see "Tests executed"), 2 skipped (pre-existing, Google OAuth). **No test that was passing before this change is now failing.**

**Not yet committed. Not yet deployed to staging or production.**

---

## Files changed

| File | Repo | Change |
|---|---|---|
| `supabase/functions/_shared/task_actions.ts` | this repo | **New file.** Exports `executeTaskActions(ctx)` — the extracted, logic-unchanged F5c resolution-and-send block. |
| `supabase/functions/evaluate-rules/index.ts` | this repo | Inline F5c block (was 102 lines) replaced with one import + one call. Pure extraction, no behavior change. |
| `supabase/functions/report-location-event/index.ts` | this repo | One import + one call added inside `fireLocationAction`, placed after the existing fan-out summary log and before the function's return. This is the actual fix. |
| `tests/catalogue/session-2026-07-17-b10g-location-taskactions-fix.ts` | this repo | **New file.** 5 regression tests. |
| `tests/catalogue/session-2026-07-17-f5c-taskactions-resolution.ts` | this repo | 5 existing tests retargeted from `evaluate-rules/index.ts` to `_shared/task_actions.ts` (same assertions, new file location, since the code moved). One test's marker string updated (old F5c comment removed during extraction; test now checks for the `executeTaskActions` call instead). |
| `tests/catalogue/session-2026-06-13.ts` | this repo | One older F5c test (`f5c.evaluate-rules-executes-task-actions`) updated the same way — now checks `evaluate-rules` calls `executeTaskActions`, and checks the shared module for the actual send-execution assertions it used to check inline. |
| `tests/runner.ts` | this repo | Import + registration of the new B10g test file (2 lines). |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | this repo | B10g entry updated across the Phase 1/2/3 governance sequence (not a Phase 4 change — pre-existing from earlier this session). |

No other file touched. No schema change, no new table, no new Edge Function beyond the shared module (a library file, same category as the pre-existing `_shared/alert_body.ts`). No change to `fire-pending-dwells/index.ts` or `hooks/useOrchestrator.ts`, matching Phase 3 §3's explicit exclusions.

---

## Git diff

### `supabase/functions/_shared/task_actions.ts` (new file, full content)

See the file directly — 113 lines, a logic-preserving extraction of `evaluate-rules/index.ts`'s prior F5c block (current-as-of-this-commit lines removed from that file, shown below), with variable access adapted to the `ctx` parameter per Phase 3 §2. Log line prefixes changed from `[evaluate-rules] F5c:` to `[task_actions]` (the module now serves two callers, an evaluate-rules-specific prefix would be misleading from `report-location-event`) — the distinct reason strings themselves (`SKIPPED (name_too_short)`, `SKIPPED (zero_matches)`, `SKIPPED (ambiguous_multiple_matches)`, `SKIPPED (no_resolved_destination)`) are unchanged. **To be precise about what "unchanged" means here:** the two things that changed are the function's call interface (six positional parameters → one context object, per Phase 3 §2) and the log-line prefix described above. The functional behavior — which matches resolve, which fail closed, what gets sent and to whom — is identical to the pre-extraction F5c code. "Logic unchanged" should be read as "functional behavior unchanged," not as a claim that no character of the file differs from its prior location.

### `supabase/functions/evaluate-rules/index.ts`

```diff
@@ -22,6 +22,7 @@
 import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
 import { buildAlertBody } from '../_shared/alert_body.ts';
+import { executeTaskActions } from '../_shared/task_actions.ts';
@@ -1064,102 +1065,11 @@ async function fireAction(
-  // F5c — execute structured task_actions stored at alert-set time.
-  // [... 98 lines of inline resolution + send logic, verbatim in the
-  //      original F5c block, removed here and now living in
-  //      _shared/task_actions.ts ...]
+  // B10g — extracted to _shared/task_actions.ts so report-location-event can
+  // execute task_actions too (previously had zero execution path for them).
+  // Runs after the main notification so the primary alert always fires
+  // first, even if task execution fails. Logic unchanged from F5c.
+  await executeTaskActions({ config, rule, userName, supabaseUrl, interFnKey });

   return successCount > 0;
 }
```
**Net effect confirmed by direct diff read:** every line of this function above the F5c block (the primary self/third-party alert fan-out, ~lines 655-1064) is byte-identical before and after. The only change is the block replacement itself.

### `supabase/functions/report-location-event/index.ts`

```diff
@@ -30,6 +30,7 @@
 import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
 import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
 import { buildAlertBody } from '../_shared/alert_body.ts';
+import { executeTaskActions } from '../_shared/task_actions.ts';
@@ -922,6 +923,11 @@ async function fireLocationAction(
   const mode = isSelfAlert ? 'self' : (toPhone ? 'third-party-phone' : 'third-party-email');
   console.log(`[report-location-event] Rule ${rule.id} fan-out (${mode}): ${parts.join(' ')} — ${successCount}/${sends.length} ok`);

+  // B10g — task_actions previously had zero execution path for location-
+  // triggered alerts. Runs after the main notification so the primary
+  // alert always fires first, even if task execution fails.
+  await executeTaskActions({ config, rule, userName, supabaseUrl, interFnKey });
+
   return successCount > 0;
 }
```
**Net effect confirmed by direct diff read:** every line of `fireLocationAction` above this addition (the entire existing self/third-party fan-out — self-override handling, channel selection, SMS/WhatsApp/Email/Push/Voice sends) is byte-identical before and after. This is a pure addition, placed after the fan-out's own summary log and before the function's `return successCount > 0`.

---

## Tests executed

**Command:** `npm run test:auto`

**Result:** 436 tests — 430 passed, 0 failed, 4 errored, 2 skipped.

**New tests (all 5 passed):**
- `b10g.shared-module-exports-executeTaskActions` — the shared module exists, exports `executeTaskActions` with the context-object signature.
- `b10g.evaluate-rules-uses-shared-function-not-inline-copy` — evaluate-rules imports and calls the shared function.
- `b10g.report-location-event-now-executes-task-actions` — **the fix itself**: report-location-event imports and calls the identical shared function.
- `b10g.report-location-event-existing-fanout-unaffected` — regression guard: the new call sits strictly between the existing fan-out's summary log and the function's return, never before or interleaved.
- `b10g.fire-pending-dwells-unaffected-by-design` — confirms `fire-pending-dwells` still has no direct `task_actions` reference, i.e. it's still delegating to `report-location-event` rather than gaining an independent (driftable) copy.

**Retargeted tests (all still pass, same guarantees, new file location):**
- 5 tests in `session-2026-07-17-f5c-taskactions-resolution.ts` (name-too-short guard, exact-match-count requirement, distinct log reasons, no-silent-drop, primary-fanout-unaffected regression guard) — now check `_shared/task_actions.ts` instead of `evaluate-rules/index.ts` for the resolution logic; the primary-fanout-unaffected guard still checks `evaluate-rules/index.ts` for ordering, updated to look for the new `executeTaskActions` call marker instead of the removed F5c comment.
- `f5c.evaluate-rules-executes-task-actions` in `session-2026-06-13.ts` — updated to check `evaluate-rules` calls `executeTaskActions`, and checks the shared module for the send-execution assertions it used to check inline.

**Regression caught and fixed during this implementation, not left for Phase 6 to find:** the first `npm run test:auto` run after the code change surfaced `f5c.evaluate-rules-executes-task-actions` newly erroring — an older test (from `session-2026-06-13.ts`, not touched during Phase 1-3 planning since it predates F5c's own 2026-07-17 fix) also asserted on `evaluate-rules/index.ts`'s source directly. Fixed by retargeting, per above. Re-ran; confirmed 0 failures.

**Pre-existing, unrelated errors (not caused by this change) — 3 match F5c's own Phase 5 evidence exactly, 1 is new but unrelated to this diff:**
- `b6d.prompt-version-bumped-to-v98` — stale expected prompt-version string (pre-existing).
- `session-2026-05-28.b6d-prompt-version-v100` — same stale-string cause (pre-existing).
- `f10a.website-nav-feedback-link-homepage-only` — pre-existing wording mismatch, unrelated to Action Rules (pre-existing).
- `voice.calendar-today-query` — a live-calendar-data-dependent test; identical failure content appeared in both this session's test runs (before and after the regression fix above), and no file this implementation touched has any relationship to calendar queries, voice, or `get-naavi-prompt`. Not investigated further — out of scope for B10g, flagged here for visibility rather than silently ignored.

**Pre-existing skips (unrelated):** two Google OAuth-not-connected skips for the test user.

**No test that was passing before this change is now failing.**

---

## Manual tests required (not yet performed — pending deployment)

Per `CLAUDE.md`'s STAGING-FIRST rule, this has not been deployed anywhere yet. The automated tests above are structural/source-level — they prove the fix is shaped correctly (both call sites use the identical shared function, the new call is strictly additive, the fail-closed logic is unchanged), not that it behaves correctly at runtime against a live geofence crossing. Recommended before Phase 6 approval, mirroring F5c's own discipline:

1. Create a location-triggered alert with a `task_actions` entry whose `to_name` resolves to exactly one real contact (the safe path) and confirm the third party actually receives the message when the geofence fires — the first time this will ever be true for any real alert. Confirm via `sent_messages` (new rows with `source: 'alert_task'` for a location-trigger rule, not previously possible). **Also confirm exactly one message was sent, not more** — check `sent_messages` for a single row (single `provider_sid`) for that `to_name`/`rule_id`, not a duplicate pair. This guards specifically against accidental double-execution, the same failure shape already seen once in this codebase (B10e — task_actions sent twice on a combined self-reminder alert, staging, 2026-07-17) though from an unrelated cause; worth ruling out here too since it's cheap to check.
2. Confirm the existing self/third-party location-alert fan-out (self-alerts, primary third-party sends, self-overrides) is completely unaffected by firing a location alert that has NO `task_actions` — same channels, same behavior as before this change.
3. **Confirm ordering:** in test 1's fire, the primary self-alert notification (if the rule has one) must be observable in `sent_messages` at or before the `task_actions` send, never after — matching the code's `primary notification → task_actions` ordering guarantee (Phase 2's regression protection, source-tested by `b10g.report-location-event-existing-fanout-unaffected`, not yet observed live). Compare `sent_at` timestamps between the primary alert row(s) and the `alert_task` row(s) for the same fire.
4. Optionally: a location alert with an ambiguous `task_actions` name, confirming it fails closed (no send, `ambiguous_multiple_matches` in the logs) — same discipline as F5c's own Test 1, though given F5c's own Test 1 was ultimately waived as testing a contrived scenario (see F5c's closure record), this is not being treated as mandatory here either; the underlying fail-closed logic is unchanged, already tested, and already proven against F5c's real incident data.
5. A dwell-based location alert (not just instant enter/exit) with a `task_actions` entry, confirming the fix covers that path too without any change to `fire-pending-dwells`.

---

## Nearby improvement identified, not made (per Phase 4's "report separately, don't fix silently" rule)

While implementing, considered adding a short note to `report-location-event/index.ts`'s top-of-file architecture-note docstring (which currently only describes the "duplicated fan-out, keep both in sync" risk in the abstract) explaining that `task_actions` execution is now the one piece that's shared, not duplicated. **Not made** — Phase 3 §3 authorized only the specific call inside `fireLocationAction`, stating "nothing else in this file changes." Reverted after drafting it, to stay strictly within the approved boundary. Worth adding in a future, separately-approved documentation pass.

---

## Rollback instructions

Revert the three uncommitted implementation files (`supabase/functions/_shared/task_actions.ts` deletion, `supabase/functions/evaluate-rules/index.ts`, `supabase/functions/report-location-event/index.ts`) and the three test files, via `git checkout` (nothing committed yet) or `git revert` (if committed before a rollback is needed). No migration, no schema change, no other file affected. If already deployed: redeploy the prior versions of `evaluate-rules` and `report-location-event` (`npx supabase functions deploy <name> --no-verify-jwt --project-ref <ref>` from the pre-fix commit). No data cleanup needed — this change only affects whether `task_actions` get executed for location-triggered rules; no rows are written differently.

---

## Known risks

- **Not yet deployed anywhere** — staging deployment and manual validation (above) should happen before Phase 6 approval is treated as sufficient for production, per governance Phase 7/8.
- **Risk shape is the opposite of F5c's** (Phase 2 §4) — this is a new-capability risk (sends that never happened before), not a tightening (fewer sends). Mitigated by reusing F5c's exact already-hardened, already-incident-tested resolution logic rather than a fresh implementation.
- **Zero current blast radius, confirmed directly** — `scripts/diag-b10g-location-taskactions-exposure.js` (run during Phase 2 planning, re-runnable) showed 0 of 11 staging and 0 of 19 production location rules currently carry `task_actions`. This fix has no effect on any alert that exists today; it only matters for alerts created after it ships.
- **The two call sites could still drift again in the future** if someone changes one and not the other directly rather than editing the shared module — mitigated architecturally (both call the same function, a source-level fact the new tests assert on directly, `b10g.evaluate-rules-uses-shared-function-not-inline-copy` / `b10g.report-location-event-now-executes-task-actions`), but not physically impossible (someone could still inline a divergent copy in one file later). This is the residual risk the deferred T1a audit (Phase 1 §7, Phase 2 §7) is meant to catch systematically rather than case-by-case.

---

## Phase 5 review record (2026-07-17)

Reviewer feedback received via Wael. Three items, all adopted:

1. **"Logic unchanged" clarified in the Git Diff section** — added an explicit sentence stating precisely what changed (call interface, log prefix) versus what didn't (functional behavior — which matches resolve, fail-closed rules, sends), so "unchanged" isn't read as a literal no-diff claim.
2. **Manual test 1 strengthened** — added an explicit check that exactly one message was sent per third party per fire (not a duplicate pair), specifically as a guard against accidental double-execution — the same failure shape already seen once in this codebase (B10e, an unrelated cause, but cheap to rule out here too).
3. **Manual test 3 added — ordering verification** — the primary-notification-before-task_actions ordering is currently only source-tested (`b10g.report-location-event-existing-fanout-unaffected`); added an explicit step to observe it live via `sent_messages` timestamps during manual verification, since it's one of Phase 2's stated regression protections and hadn't been called out as its own manual check.

Reviewer's stated assessment: adherence to approved implementation boundaries, comprehensive test reporting, transparent discussion of unrelated failures, explicit manual validation requirements, rollback instructions, and known residual risks are all present — "exactly the elements I would expect in a mature Phase 5 evidence package." Specifically praised "No test that was passing before this change is now failing" as a concise, strong regression-outcome summary. No substantive issues identified.

**This is the reviewer's assessment of the evidence package's quality — it is not, by itself, authorization to begin Phase 6.** Per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3): Phase 6 begins only when Wael says so explicitly, in a separate instruction, regardless of this or any review verdict.

---

## Status

**Phase 5 written and reviewed 2026-07-17, revisions above adopted. Phase 6 (Technical Review After Coding) has NOT started and will not start until Wael gives explicit, separate approval for this specific transition.**
