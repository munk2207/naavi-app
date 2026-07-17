# B10b — Phase 5: Evidence Package

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5. Implementation completed exactly within the Implementation Boundaries confirmed in `docs/B10B_PHASE3_TECHNICAL_REVIEW_2026-07-16.md`.

---

## Summary

`action_rule_confirm_gate.js`'s `failSpeechForAction` now branches on `result.error` — speaking a message naming the multi-contact problem for `ambiguous`, a no-contact-found message for `not_found`/`invalid`/`resolve_failed`, and falling back to the original duplicate-alert message when `result.error` is absent (the duplicate-timestamp-conflict case, unchanged). This closes the defect proven in `docs/B10B_PHASE1_PROBLEM_DEFINITION_2026-07-16.md`: once B10a made F12's fail-closed resolution errors reachable from this call site, the old hardcoded message would have given the user an inaccurate explanation despite the real reason already being available in `result.error`.

Added three regression tests to `tests/catalogue/session-2026-07-16-b10b-fail-speech.ts`, registered in `tests/runner.ts`. Full auto-tester run: 426 tests, 421 passed, 0 failed, 3 errored (all three pre-existing and unrelated — same as B10a's run), 2 skipped (pre-existing, unrelated).

---

## Files changed

| File | Repo | Change |
|---|---|---|
| `naavi-voice-server/src/action_rule_confirm_gate.js` | `munk2207/naavi-voice-server` (separate repo) | `failSpeechForAction` rewritten to branch on `result.error`. |
| `tests/catalogue/session-2026-07-16-b10b-fail-speech.ts` | `munk2207/naavi-app` (this repo) | New file — 3 regression tests. |
| `tests/runner.ts` | `munk2207/naavi-app` (this repo) | Import + registration of the new test file (2 lines). |

No other files. `naavi-voice-server/src/index.js` was not touched, as authorized — B10a already wired `result.error` through to this call site.

---

## Git diff

### `naavi-voice-server/src/action_rule_confirm_gate.js` (separate repo, uncommitted)

```diff
@@ -59,19 +59,44 @@ function buildConfirmationSpeech(action) {
 
 /**
  * Build the user-facing failure speech when a gated time-trigger action
- * fails post-confirmation. executeAction()'s SET_ACTION_RULE branch only
- * returns { success: boolean } (naavi-voice-server/src/index.js:4830) —
- * no granular error code — so this stays general rather than claiming a
- * certainty the result doesn't support. The only failure mode proven so
- * far (Phase 1 §2g) is a duplicate-timestamp conflict, so the message
- * names that as the likely cause without asserting it as the only one.
+ * fails post-confirmation.
  *
- * @param {{ label?: string }} action
- * @param {{ success?: boolean }} result
+ * B10b (2026-07-16) — branches on result.error when present. F12's
+ * resolve-recipient failures (naavi-voice-server/src/index.js:4782, :4786)
+ * return a granular reason ('ambiguous' / 'not_found' / 'invalid' /
+ * 'resolve_failed'), reachable from this call site for the first time once
+ * B10a's block reorder shipped (docs/B10A_PHASE1_PROBLEM_DEFINITION_2026-07-16.md).
+ * The duplicate-timestamp-conflict case (executeAction()'s SET_ACTION_RULE
+ * branch returning only { success: false } with no error field,
+ * naavi-voice-server/src/index.js:4831) has no result.error and falls
+ * through to the original message, unchanged — see
+ * docs/B10B_PHASE1_PROBLEM_DEFINITION_2026-07-16.md.
+ *
+ * `action.action_config.to` is the name Claude originally emitted, read
+ * here from the same object passed into executeAction() — executeAction()
+ * only ever copies action.action_config into a local actionConfigNorm, it
+ * never mutates the original, so this is guaranteed present unchanged.
+ *
+ * @param {{ label?: string, action_config?: { to?: string } }} action
+ * @param {{ success?: boolean, error?: string }} result
  * @returns {string}
  */
 function failSpeechForAction(action, result) {
-  return "I couldn't set that up — you may already have an identical alert. Say what you'd like to change.";
+  const toName = String(action?.action_config?.to ?? '').trim();
+  switch (result?.error) {
+    case 'ambiguous':
+      return toName
+        ? `You have more than one contact named ${toName} — say their full name and try again.`
+        : "You have more than one contact with that name — say their full name and try again.";
+    case 'not_found':
+    case 'invalid':
+    case 'resolve_failed':
+      return toName
+        ? `I don't have a contact named ${toName}. Tell me their email or phone number directly, or save them to your contacts first.`
+        : "I couldn't find that contact. Tell me their email or phone number directly, or save them to your contacts first.";
+    default:
+      return "I couldn't set that up — you may already have an identical alert. Say what you'd like to change.";
+  }
 }
 
 module.exports = {
```

**Net effect confirmed by direct diff read:** the only behavior change is the new branching inside `failSpeechForAction` itself. Its caller (`index.js:9944`) and every upstream code path are unchanged.

---

## Demonstration: `action.action_config.to` is available at the call site (required by Phase 3)

Phase 3 required this be shown explicitly, not just assumed. Traced directly through the source, not inferred:

1. **Where the object comes from:** `naavi-voice-server/src/index.js:12088` — `pendingActionRuleCreate = action;` — stores the raw `action` object exactly as converted from Claude's tool call (`convertToolUseToAction`, `anthropic_tools.js`), before any resolution or mutation. For a "text Bob" style request, this object's shape is confirmed in B10a's Phase 1 evidence: `"action_config":{"to":"Bob","body":"Good morning"}`.

2. **What happens to it at execution time:** `naavi-voice-server/src/index.js:9953-9956` —
   ```js
   const saved = pendingActionRuleCreate;
   pendingActionRuleCreate = null;
   ...
   const result = await executeAction(saved, userId);
   ```
   `saved` is the exact same object from step 1, passed directly into `executeAction`.

3. **Confirmed `executeAction` does not mutate it:** inside the `SET_ACTION_RULE` case (`index.js:4693`), the very first line is:
   ```js
   const actionConfigNorm = { ...(action.action_config || {}) };
   ```
   This is a shallow **copy**. Every subsequent line in the case operates on `actionConfigNorm`, never on `action.action_config` itself. Based on the reviewed implementation, `action.action_config.to` (i.e. `saved.action_config.to`) is never written to, deleted, or reassigned by `executeAction` within this execution path.

4. **Where it's read again:** `naavi-voice-server/src/index.js:9944` —
   ```js
   : actionRuleGate.failSpeechForAction(saved, result || {});
   ```
   `saved` — the same object, unmutated per step 3 — is passed in. Inside `failSpeechForAction`, `action.action_config.to` reads `saved.action_config.to`, which by steps 1-3 remains unchanged throughout this execution path (e.g. still `"Bob"`).

**Conclusion: the assumption holds by direct code trace, not by runtime observation alone** (no live call exercised the `ambiguous`/`not_found` branch specifically during this Phase 5 pass — see "Manual tests required" below for that). Based on the reviewed implementation, `executeAction` copies rather than mutates `action.action_config` — confirmed by reading every line of the `SET_ACTION_RULE` case that touches `action` vs. `actionConfigNorm`.

---

## Tests executed

**Command:** `npm run test:auto`

**Result:** 426 tests — 421 passed, 0 failed, 3 errored, 2 skipped. Same three pre-existing, unrelated errors as B10a's run (stale prompt-version strings, one website-nav wording mismatch) and the same two pre-existing OAuth-not-connected skips.

**New tests (all passed):**
- `b10b.fail-speech-branches-on-ambiguous-error`
- `b10b.fail-speech-branches-on-not-found-error`
- `b10b.fail-speech-preserves-original-duplicate-alert-message`

**No test that was passing before this change is now failing.**

---

## Manual tests required

Same gap as B10a: `naavi-voice-server` has no staging tier, so a real call is the closest equivalent to a staging gate. Not yet performed — pending Wael's approval to push.

Required scenario, once pushed: trigger a time-trigger SMS/WhatsApp naming a contact that doesn't exist (or is ambiguous), confirm with "yes," and listen for the new specific message ("I don't have a contact named X..." / "You have more than one contact named X...") instead of the old generic "you may already have an identical alert."

---

## Rollback instructions

Revert the single commit in `naavi-voice-server` (no schema change, no migration, no other file affected, no data written differently — this only changes what Naavi says on an already-existing failure path). `git revert` on `naavi-voice-server`'s `main`, Railway auto-deploys the revert.

---

## Known risks

- **No staging tier for the voice server** — same pre-existing gap as B10a; the manual call test is the mitigation, not yet performed.
- **Not yet observed live** — the `ambiguous`/`not_found` branches are proven correct by static trace (see demonstration above) and by source-assertion tests, but have not yet been exercised by an actual failing voice call. The manual test above is what closes that gap.
- **Regression risk Low per Phase 3's classification** — single function, single caller, original behavior preserved as the explicit default branch.

---

## Phase 5 review record (2026-07-16)

Technical review based on ChatGPT's review, documented by Wael.

**Editorial refinement (adopted):** "is guaranteed present unchanged" reworded to "remains unchanged throughout this execution path" / "based on the reviewed implementation" — ties the claim to what was demonstrated in the reviewed code, rather than an absolute, universal guarantee. Applied both in the evidence doc's demonstration section and in the corresponding code comment in `action_rule_confirm_gate.js`.

**Confirmed as sound:** rollback (one commit, no schema/data migration, deterministic revert); the Phase 1→5 structural consistency with B10a.

**Verdict: Approved.** "The implementation remained within the approved implementation boundaries, the regression evidence matches the approved test strategy, and the additional verification requested during Phase 3 has been satisfactorily demonstrated through a direct code trace. The remaining manual voice-call validation is appropriately documented as an operational verification step rather than an implementation uncertainty. This Phase 5 evidence package is complete and ready to proceed to the final post-implementation technical review."
