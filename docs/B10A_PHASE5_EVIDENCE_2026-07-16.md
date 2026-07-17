# B10a — Phase 5: Evidence Package

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5. Implementation completed exactly within the Implementation Boundaries confirmed in `docs/B10A_PHASE3_TECHNICAL_REVIEW_2026-07-16.md`.

---

## Summary

Moved the B4y default-to-self block to run after the F12 named-recipient resolution block, inside the general (non-location) `SET_ACTION_RULE` handler in `naavi-voice-server/src/index.js`. No condition logic changed — the two guard conditions are byte-identical to before; only their order changed. This closes the defect proven in `docs/B10A_PHASE1_PROBLEM_DEFINITION_2026-07-16.md`: a time-triggered SMS/WhatsApp alert naming a real third-party contact ("text Bob... in 3 minutes") no longer silently redirects to the user's own phone — it now resolves the named contact correctly, or fails closed (row not created) if the name can't be resolved.

Added three regression tests to `tests/catalogue/session-2026-07-16-b10a-recipient-order.ts`, registered in `tests/runner.ts`. Full auto-tester run: 423 tests, 418 passed, 0 failed, 3 errored (all three pre-existing and unrelated to this change — see "Tests executed" below), 2 skipped (pre-existing, unrelated).

---

## Files changed

| File | Repo | Change |
|---|---|---|
| `naavi-voice-server/src/index.js` | `munk2207/naavi-voice-server` (separate repo) | Block reorder only, within the `SET_ACTION_RULE` case. |
| `tests/catalogue/session-2026-07-16-b10a-recipient-order.ts` | `munk2207/naavi-app` (this repo) | New file — 3 regression tests. |
| `tests/runner.ts` | `munk2207/naavi-app` (this repo) | Import + registration of the new test file (2 lines). |

No other files touched. `naavi-voice-server/src/action_rule_confirm_gate.js` was explicitly not touched — deferred to B10b per the Implementation Boundaries.

---

## Git diff

### `naavi-voice-server/src/index.js` (separate repo, uncommitted)

```diff
@@ -4693,10 +4693,6 @@ async function executeAction(action, userIdOverride) {
             normalizedTriggerConfig = {};
           }
         }
-        // 2026-05-24 (Wael, B4y) — default to_phone from user_settings
-        // when action_type='sms'/'whatsapp' and no to_phone resolved.
-        // Without this, rules land with no destination phone and
-        // silently fail at evaluate-rules fire time.
         const actionConfigNorm = { ...(action.action_config || {}) };
         const actType = action.action_type;
 
@@ -4722,22 +4718,6 @@ async function executeAction(action, userIdOverride) {
           delete actionConfigNorm.to_name;
         }
 
-        if (!hasSelfOverride && (actType === 'sms' || actType === 'whatsapp') && !actionConfigNorm.to_phone) {
-          try {
-            const settingsRes = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?select=phone&user_id=eq.${uid}`, {
-              headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
-            });
-            const settingsData = await settingsRes.json();
-            const userPhone = settingsData?.[0]?.phone;
-            if (userPhone) {
-              actionConfigNorm.to_phone = userPhone;
-              console.log('[Action] B4y: defaulted SET_ACTION_RULE to_phone from user_settings:', userPhone);
-            }
-          } catch (err) {
-            console.warn('[Action] B4y: user_settings phone fetch failed:', err?.message ?? err);
-          }
-        }
-
         // F12 Phase 4 (2026-07-06) — resolve a named/literal recipient via
         // the shared Recipient Resolver. Voice previously had NO resolution
         // step at all for this path (Phase 1, Evidence A3) — a literal
@@ -4752,6 +4732,13 @@ async function executeAction(action, userIdOverride) {
         // landing with an unresolved destination) cannot happen anymore.
         // Tailoring the spoken message at each call site is left as a
         // follow-up, not silently skipped — see F12 evidence package.
+        //
+        // 2026-07-16 (Wael, B10a) — moved to run BEFORE the B4y no-recipient
+        // default below (previously after — see
+        // docs/B10A_PHASE1_PROBLEM_DEFINITION_2026-07-16.md). B4y's
+        // unconditional default used to satisfy this block's own guard
+        // (!actionConfigNorm.to_phone) before this block ever ran, silently
+        // skipping resolution for every request where a name was present.
         const toNameVoice = String(actionConfigNorm.to ?? '');
         if (!hasSelfOverride && toNameVoice && !actionConfigNorm.to_phone && !actionConfigNorm.to_email) {
           try {
@@ -4787,6 +4774,34 @@ async function executeAction(action, userIdOverride) {
           }
         }
 
+        // 2026-05-24 (Wael, B4y) — default to_phone from user_settings
+        // when action_type='sms'/'whatsapp' and no to_phone resolved.
+        // Without this, rules land with no destination phone and
+        // silently fail at evaluate-rules fire time.
+        //
+        // 2026-07-16 (Wael, B10a) — moved to run AFTER the F12 resolution
+        // block above. By the time execution reaches here, either F12
+        // already resolved to_phone/to_email (condition below is false,
+        // skipped), F12 already returned early on a resolution failure
+        // (this code is never reached), or no name (`to`) was ever present
+        // — the only case this default is actually meant for. See
+        // docs/B10A_PHASE1_PROBLEM_DEFINITION_2026-07-16.md.
+        if (!hasSelfOverride && (actType === 'sms' || actType === 'whatsapp') && !actionConfigNorm.to_phone) {
+          try {
+            const settingsRes = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?select=phone&user_id=eq.${uid}`, {
+              headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
+            });
+            const settingsData = await settingsRes.json();
+            const userPhone = settingsData?.[0]?.phone;
+            if (userPhone) {
+              actionConfigNorm.to_phone = userPhone;
+              console.log('[Action] B4y: defaulted SET_ACTION_RULE to_phone from user_settings:', userPhone);
+            }
+          } catch (err) {
+            console.warn('[Action] B4y: user_settings phone fetch failed:', err?.message ?? err);
+          }
+        }
+
         const res = await fetch(`${SUPABASE_URL}/rest/v1/action_rules`, {
           method: 'POST',
           headers: {
```

**Net effect confirmed by direct diff read:** the executable logic inside both conditional blocks (guard conditions, fetch calls, switch cases, catch blocks) is unchanged; only the execution order was altered, with accompanying explanatory comments updated. No new logic, no new branches, no deleted behavior.

### `tests/runner.ts` (this repo, unstaged)

2 lines added: one import, one array-spread registration for the new test file — same pattern as every other catalogue entry.

### `tests/catalogue/session-2026-07-16-b10a-recipient-order.ts` (this repo, new file)

New file, 3 tests. Full content in the file itself.

---

## Tests executed

**Command:** `npm run test:auto`

**Result:** 423 tests — 418 passed, 0 failed, 3 errored, 2 skipped.

**New tests (all passed):**
- `b10a.f12-resolution-runs-before-b4y-default` — asserts F12's guard condition appears before B4y's guard condition in source.
- `b10a.resolution-failure-return-precedes-b4y-default` — asserts the fail-closed `return` on an unresolvable recipient appears before B4y's guard, proving it can no longer fall through to self-default.
- `b10a.b4y-no-recipient-self-default-preserved` — asserts B4y's guard condition and its `console.log` marker are byte-identical to before, proving the genuine no-recipient case ("text me...") is unaffected.

**Pre-existing, unrelated errors (all three match the "Groundwork already done" section of `docs/SESSION_HANDOFF_2026-07-16_F19_TRACKB_CLOSED_B10A_FOUND.md`, confirmed not touched by this change):**
- `b6d.prompt-version-bumped-to-v98` — stale expected prompt-version string.
- `session-2026-05-28.b6d-prompt-version-v100` — same stale-string cause.
- `f10a.website-nav-feedback-link-homepage-only` — pre-existing wording mismatch, unrelated to voice/Action Rules.

**Pre-existing skips (unrelated):** two Google OAuth-not-connected skips for the test user (`contacts.no-match-returns-empty`, `calendar.create-event`).

**No test that was passing before this change is now failing.**

---

## Manual tests performed (2026-07-16, real production voice calls, after push)

Pushed to `naavi-voice-server` `main` at 2026-07-16T10:09:25-04:00 (commit `5e81e76`). All three scenarios run live after Railway's deploy completed.

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | "Text Bob... in 3 minutes" (Bob = real saved contact) | **Pass** | `action_rules` row created 10:13 AM EDT with `to_phone: "+13433332567"` (Bob's real number). `sent_messages` shows both SMS and WhatsApp delivered to that number at 10:14 AM EDT — correct third-party fan-out (SMS+WhatsApp only, per alert design). Wael confirmed by direct observation: Bob received the SMS on his own phone. No duplicate row, no wrong-number row created after the push. |
| 2 | "Text me... in 5 minutes" (no named recipient) | **Pass** | `action_rules` row created with `to_phone: "+16137697957"` (Wael's own number). `sent_messages` confirms the "Hello" SMS delivered to that number. B4y's self-alert default confirmed intact after the reorder. |
| 3 | Name with no matching contact | **Pass** | No `action_rules` row exists for this attempt — consistent with fail-closed: nothing inserted, nothing sent to anyone. |

**One open, unexplained detail:** Wael reported test #1 needed "two repetitions" during the call before completing. The database shows only one `action_rules` row and one correct SMS+WhatsApp send after the push — no duplicate or wrong-destination row was created. Whatever needed repeating (recognition of "Text Bob," the yes-confirmation, or something else) did not affect the stored outcome or the real-world delivery, and did not surface as a second insert. Root cause of the repetition itself was not determined — flagged here rather than silently dropped, per governance's evidence discipline. If this recurs, it most likely maps to the pre-existing, already-tracked STT/barge-in issue (`project_naavi_deepgram_first_word_truncation`) or the pre-existing B9y digit-capture inconsistency — neither caused by this change, both already open items independent of B10a.

---

## Rollback instructions

Revert the single reorder commit/change in `naavi-voice-server/src/index.js` (no migration, no schema change, no other file affected). Since this repo has no staging tier, rollback means: `git revert` the commit on `naavi-voice-server`'s `main` and let Railway auto-deploy the revert. No data cleanup needed — no rows were written differently by this change (it only changes which resolution path a row's fields come from before insertion).

---

## Known risks

- **No staging tier for the voice server** — this change went live on push; the real-call manual test (above) served as the safety net, per Phase 2 §6 / Phase 3's pre-existing process-gap note. Manual test now complete and passed.
- **B10b is not yet implemented** — until B10b ships, a resolution failure on this path will still speak the generic "you may already have an identical alert" message (not yet the accurate per-error message). The failure itself is handled correctly (row not created, no misdirection) — only the spoken explanation to the user is still imprecise in that one failure case.
- **Regression risk is Medium per Phase 3's classification** — because this is Protected Core (Action Rules, Voice orchestration), independent of how small the diff is. The regression tests and the passed manual call test are the mitigations; they do not eliminate the Protected Core designation.
- **"Two repetitions" on test #1, cause undetermined** — see "Manual tests performed" above. Did not affect the stored outcome or real-world delivery; not investigated further.

---

## Phase 5 review record (2026-07-16)

Technical review based on ChatGPT's review, documented by Wael.

**Editorial refinement (adopted):** "only their relative position moved" reworded to "the executable logic inside both conditional blocks is unchanged; only the execution order was altered, with accompanying explanatory comments updated" — more precise, since comments were also added/relocated alongside the reorder, not just executable statements.

**Confirmed as sound:** rollback (simple, deterministic, no schema/data migration, no cleanup); risk section's honesty about B10b not yet shipping (behavior is correct, user messaging remains generic in the one still-open failure case); the Phase 1→5 traceability chain.

**Verdict: Approved.** "The implementation appears to have remained within the authorized scope established during Phase 3, the automated regression evidence aligns with the approved test plan, and the remaining risks are clearly documented rather than obscured. The only remaining verification before considering the change operationally complete is the planned real voice-call testing."
