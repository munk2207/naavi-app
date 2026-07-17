# F5c — Phase 5: Evidence Package

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5. Implementation completed exactly within the Implementation Boundaries confirmed in `docs/F5C_PHASE3_TECHNICAL_REVIEW_2026-07-17.md` §2.

---

## Summary

`supabase/functions/evaluate-rules/index.ts`'s F5c block (fire-time `task_actions[].to_name` recipient resolution) no longer takes the first `lookup-contact` result unconditionally. Three changes, all inside the same block:

1. **Defense-in-depth guard** — a `to_name` under 2 characters is rejected before any `lookup-contact` call, logged `name_too_short`.
2. **The correctness guarantee** — resolution now requires `data.contacts.length === 1`; zero or multiple matches are logged (`zero_matches` / `ambiguous_multiple_matches`) and the task_action is left unresolved rather than guessed.
3. **Closed a pre-existing silent-drop gap** — an unresolved task_action reaching `taskSends` now logs `no_resolved_destination` instead of vanishing with no log output at all.

This closes the defect proven in `docs/F5C_PHASE1_PROBLEM_DEFINITION_2026-07-17.md`: three real, unconfirmed SMS sent to wrong real contacts on 2026-07-16 (`to_name: "A"/"B"/"C"`, resolved via an unchecked loose match). Simulating the fix's decision logic against the live `lookup-contact` data gathered for Phase 1 §2.3 (same day, 2026-07-17): "A" and "C" (10 loose matches each) would now log `ambiguous_multiple_matches`; "B" (0 matches that same day) would now log `zero_matches` — all three skipped, none sent. This is a code-level simulation against real API data, not a deployed re-fire of the actual rule through `evaluate-rules` — that requires staging deployment and is listed under "Manual tests required" below, not claimed as done here.

Added 5 new regression tests to `tests/catalogue/session-2026-07-17-f5c-taskactions-resolution.ts`, registered in `tests/runner.ts`. Full auto-tester run: 431 tests, 426 passed, 0 failed, 3 errored (all three pre-existing, unrelated — see "Tests executed"), 2 skipped (pre-existing, unrelated — Google OAuth not connected for the test user).

**Not yet committed. Not yet deployed to staging or production.**

---

## Files changed

| File | Repo | Change |
|---|---|---|
| `supabase/functions/evaluate-rules/index.ts` | `munk2207/naavi-app` (this repo) | F5c block only, +19/-2 lines — the three changes in Summary above. |
| `tests/catalogue/session-2026-07-17-f5c-taskactions-resolution.ts` | this repo | New file — 5 regression tests. |
| `tests/runner.ts` | this repo | Import + registration of the new test file (2 lines). |

No other file touched. No schema change, no new table, no new Edge Function. Matches Phase 3 §2's authorization exactly — `lookup-contact/index.ts`, `naavi-chat/index.ts`, and `naavi-voice-server/src/index.js` were explicitly out of scope and were not touched.

---

## Git diff

### `supabase/functions/evaluate-rules/index.ts`

```diff
@@ -1077,6 +1077,12 @@ async function fireAction(
     const resolvedActions = await Promise.all(taskActions.map(async ta => {
       if ((ta.type === 'send_sms' && !ta.to_phone && ta.to_name) ||
           (ta.type === 'send_email' && !ta.to_email && ta.to_name)) {
+        // F5c fix (2026-07-17) — defense-in-depth: a to_name this short can
+        // never safely identify one contact. docs/F5C_PHASE1_PROBLEM_DEFINITION_2026-07-17.md
+        if (ta.to_name.trim().length < 2) {
+          console.warn(`[evaluate-rules] F5c: SKIPPED (name_too_short) to_name="${ta.to_name}"`);
+          return ta;
+        }
         try {
           const res = await fetch(`${supabaseUrl}/functions/v1/lookup-contact`, {
             method: 'POST',
@@ -1085,8 +1091,11 @@ async function fireAction(
           });
           if (res.ok) {
             const data = await res.json() as { contacts?: Array<{ name?: string; phone?: string; email?: string }> };
-            const best = data.contacts?.[0];
-            if (best) {
+            const matches = data.contacts ?? [];
+            // F5c fix — the correctness guarantee: resolve only on exactly one
+            // match. Zero or multiple matches must fail closed, never guess.
+            if (matches.length === 1) {
+              const best = matches[0];
               return {
                 ...ta,
                 to_phone: ta.to_phone || best.phone || '',
@@ -1094,6 +1103,11 @@ async function fireAction(
                 to_name:  ta.to_name  || best.name  || ta.to_name,
               };
             }
+            if (matches.length === 0) {
+              console.warn(`[evaluate-rules] F5c: SKIPPED (zero_matches) to_name="${ta.to_name}"`);
+            } else {
+              console.warn(`[evaluate-rules] F5c: SKIPPED (ambiguous_multiple_matches) to_name="${ta.to_name}" match_count=${matches.length}`);
+            }
           }
         } catch (e) {
           console.warn(`[evaluate-rules] F5c contact lookup failed for "${ta.to_name}":`, e);
@@ -1128,6 +1142,9 @@ async function fireAction(
         }).then(r => ({ ok: r.ok, label: `email→${ta.to_name}` }))
           .catch(() => ({ ok: false, label: `email→${ta.to_name}` }));
       }
+      // F5c fix — closes a prior silent-drop gap (Rule 21): any task_action
+      // reaching here has no resolved destination and will never send.
+      console.warn(`[evaluate-rules] F5c: SKIPPED (no_resolved_destination) to_name="${ta.to_name}" type="${ta.type}"`);
       return null;
     }).filter((p): p is Promise<{ ok: boolean; label: string }> => p !== null);
```

**Net effect confirmed by direct diff read:** the primary self/third-party alert fan-out logic (the code above this block, ~lines 950-1063) is untouched. The three `send_sms`/`send_email` execution branches inside `taskSends` are unchanged — only the resolution step feeding them, and one added log line at the existing fallback, changed.

### `tests/runner.ts`

2 lines added: one import, one array-spread registration — same pattern as every other catalogue entry.

### `tests/catalogue/session-2026-07-17-f5c-taskactions-resolution.ts`

New file, 5 tests. Full content in the file itself.

---

## Tests executed

**Command:** `npm run test:auto`

**Result:** 431 tests — 426 passed, 0 failed, 3 errored, 2 skipped.

**New tests (all 5 passed):**
- `f5c.name-too-short-guard-precedes-lookup-fetch` — asserts the length guard exists and runs before the `lookup-contact` fetch call.
- `f5c.exact-match-count-required-not-unconditional-index-zero` — asserts `matches.length === 1` is required, and asserts the old unconditional `data.contacts?.[0]` line is gone (negative control).
- `f5c.ambiguous-and-zero-match-log-distinct-reasons` — asserts `zero_matches` and `ambiguous_multiple_matches` are logged as distinct reasons.
- `f5c.unresolved-task-action-no-longer-silently-dropped` — asserts `no_resolved_destination` is logged inside the `taskSends` build step.
- `f5c.primary-alert-fanout-unaffected` — regression guard: asserts the primary alert fan-out logic still runs before the F5c block, unchanged.

**3 pre-existing `f5c.*` tests, unaffected, still pass** (from the 2026-06-15 partial implementation this defect reopened): `f5c.orchestrator-resolve-task-actions-present`, `f5c.orchestrator-injects-task-actions-into-action-config`, `f5c.evaluate-rules-executes-task-actions`.

**Pre-existing, unrelated errors (not caused by this change):**
- `b6d.prompt-version-bumped-to-v98` — stale expected prompt-version string.
- `session-2026-05-28.b6d-prompt-version-v100` — same stale-string cause.
- `f10a.website-nav-feedback-link-homepage-only` — pre-existing wording mismatch, unrelated to Action Rules.

**Pre-existing skips (unrelated):** two Google OAuth-not-connected skips for the test user (`contacts.no-match-returns-empty`, `calendar.create-event`).

**No test that was passing before this change is now failing.**

---

## Manual tests required (not yet performed — pending deployment; mandatory for Phase 6 approval)

Per `CLAUDE.md`'s STAGING-FIRST rule, this Edge Function has not been deployed anywhere yet — deploying is a separate, explicit action not covered by this Evidence Package. The automated tests above are structural/source-level (guard exists, exact-count check exists, old unconditional pick is gone, log lines exist) — they prove the fix is shaped correctly, not that it behaves correctly at runtime against live Twilio/Supabase/Google data. **Per Phase 5 review, these three manual tests are mandatory gates before Phase 6 can approve** — Phase 6 must confirm all three passed, not just that this document lists them:

1. Re-create the exact incident shape (a rule with `task_actions: [{to_name:"A"}, {to_name:"B"}, {to_name:"C"}]`) and confirm the fired rule sends nothing for those entries, with `ambiguous_multiple_matches`/`zero_matches` visible in Supabase Edge Function logs.
2. A `task_actions` entry with a `to_name` that resolves to exactly one real contact still sends correctly (no regression on the safe path) — e.g. reproduce a "Call Natalie"/"message X"-shaped rule.
3. A rule with both a primary self-alert and a `task_actions` entry still delivers the primary alert regardless of the task_action's outcome (ordering unchanged).

---

## Rollback instructions

Revert this single, uncommitted change to `supabase/functions/evaluate-rules/index.ts` (no migration, no schema change, no other file affected). If already deployed: redeploy the prior version of the function (`npx supabase functions deploy evaluate-rules --no-verify-jwt --project-ref <ref>` from the pre-fix commit), or `git revert` the commit and redeploy. No data cleanup needed — this change only affects which `task_actions` entries get a destination resolved before sending; no rows are written differently by this change.

---

## Known risks

- **Not yet deployed anywhere** — this Evidence Package covers the code change and automated tests only. Per governance Phase 7/8, manual validation (above) and staging deployment must happen before production.
- **Regression risk is High per Phase 3's classification** — Protected Core (Action Rules, Notification routing), independent of how contained the diff is. The change is a strict tightening (fewer sends, never more) — the only plausible regression is a legitimate task_action that used to send now failing closed; the defense-in-depth length guard is the one piece of this fix that could theoretically do that (the correctness-guarantee match-count check cannot, since it only withholds sends that were already guesses). No evidence today of any real contact identified by a 1-character name.
- **Voice still has zero write-time resolution for `task_actions`** (Phase 1 §2.5) — this fix protects the fire-time path regardless, but voice-originated rules still rely entirely on this one resolution point; no defense-in-depth exists earlier in that pipeline. Explicitly deferred, not part of this fix (Phase 2 §5).
- **Mobile's first-entry-only resolution gap** (`naavi-chat/index.ts`, Phase 1 §2.5) is unaffected by this fix — a second/third `task_actions` entry on mobile still bypasses write-time resolution, but now falls through to this fixed, fail-closed fire-time path instead of the previously-unsafe one.
