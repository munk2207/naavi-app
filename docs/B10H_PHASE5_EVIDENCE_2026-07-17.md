# B10h — Phase 5: Evidence Package

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5. Implementation completed within the Implementation Boundaries confirmed in `docs/B10H_PHASE3_TECHNICAL_REVIEW_2026-07-17.md` §5, with one design correction made during implementation and documented in that same file's §2 (the "resume" mechanism), and one file (`evaluate-rules/index.ts`) found to need no functional change at all.

---

## Summary

Location-triggered third-party alerts phrased as bare "text NAME MESSAGE" (no self-reminder, no "saying") saved with the recipient resolved but the message content silently dropped — the alert fired and sent a real person the generic fallback ("You've arrived at [place].") instead of what the user actually asked to be sent, with zero warning anywhere. Proven twice independently in Phase 1.

**Fix, two layers:**
- **Layer 2/3 (write-time, mobile):** a guard in `hooks/useOrchestrator.ts`'s location-alert branch blocks saving a third-party alert with no `body`/`tasks`/`list_name`, and asks the user what to say instead.
- **Layer 4 (fire-time, server):** `report-location-event/index.ts` now checks for real content *before* applying the self-alert fallback text, and skips the third-party send (never the self-alert send) when content is still missing. `evaluate-rules/index.ts` was found, during implementation, to already have an equivalent unconditional guard — no functional change needed there, documented in-source rather than silently skipped.

**Design correction made during implementation, not silently deviated from the plan:** Phase 3 originally sketched a Claude-skipping "mid-flow resume" for the clarification reply, mirroring `pendingLocationRef`. Building it revealed that would require either extracting ~400 lines of address-resolution logic into a new function, or duplicating it — the exact "two independently-maintained copies" failure this project has already paid for three times (F5c, B10d, B10g). **Wael's explicit call:** retry through Claude instead — store just the recipient and place name, rebuild a complete sentence when the user answers, and re-enter the normal Claude pipeline. Zero duplicated logic. Documented in `docs/B10H_PHASE3_TECHNICAL_REVIEW_2026-07-17.md` §2 at the time the decision was made, not after the fact.

Added 7 new regression tests (`tests/catalogue/session-2026-07-17-b10h-location-content-guard.ts`), registered in `tests/runner.ts`. Full auto-tester run: 443 tests, 437 passed, 0 failed, 4 errored (all pre-existing/unrelated — same set as F5c's and B10g's own evidence packages), 2 skipped (pre-existing, Google OAuth). **No test that was passing before this change is now failing.**

**Not yet committed. Not yet deployed to staging or production.**

---

## Files changed

| File | Repo | Change |
|---|---|---|
| `hooks/useOrchestrator.ts` | this repo | New `pendingContentClarificationRef` (declared near `pendingLocationRef`); new check at the top of `send()`; new Layer 2/3 guard inside the location branch, placed after the existing empty-placeName check and before any address-resolution work. ~76 lines added, nothing removed. |
| `supabase/functions/report-location-event/index.ts` | this repo | `rawBody` captured separately from the fallback-applied `body`; the two third-party send branches (`toPhone`, `toEmail`) now gate on `rawBody` and log a distinct skip reason when empty. Self-alert branch untouched. ~19 lines added. |
| `supabase/functions/evaluate-rules/index.ts` | this repo | **No functional change.** A 6-line comment added to the existing `if (!body) { return false; }` guard, documenting that this file already failed closed for third-party sends before this investigation started — confirmed during implementation, not assumed. (This file's diff also still carries B10g's earlier, separately-evidenced extraction, uncommitted from that work — not part of B10h's own change.) |
| `tests/catalogue/session-2026-07-17-b10h-location-content-guard.ts` | this repo | New file — 7 regression tests. |
| `tests/runner.ts` | this repo | Import + registration of the new test file (2 lines). |

No schema change, no new table, no new Edge Function. No change to `fire-pending-dwells/index.ts`, `naavi-voice-server/src/index.js`, or `_shared/alert_body.ts`, matching Phase 3 §5's explicit exclusions.

---

## Git diff (key excerpts)

### `hooks/useOrchestrator.ts` — Layer 2/3 guard (inside the location branch)

```diff
+                // B10h — fail-closed content guard...
+                {
+                  const hasThirdPartyRecipient = Boolean(actionConfig.to_phone || actionConfig.to_email);
+                  const hasContent = Boolean(
+                    String(actionConfig.body ?? '').trim() ||
+                    (Array.isArray(actionConfig.tasks) && actionConfig.tasks.length > 0) ||
+                    String(actionConfig.list_name ?? '').trim()
+                  );
+                  if (hasThirdPartyRecipient && !hasContent) {
+                    const clarifyToName = String(actionConfig.to_name || actionConfig.to || 'them');
+                    pendingContentClarificationRef.current = {
+                      toName: clarifyToName,
+                      placeName: spokenLabel,
+                      direction: String((action.trigger_config as any)?.direction ?? 'arrive'),
+                      createdAt: Date.now(),
+                    };
+                    locationIntercepted = true;
+                    turnSpeechOverride = `What should I tell ${clarifyToName}?`;
+                    continue;
+                  }
+                }
```

### `hooks/useOrchestrator.ts` — resume mechanism (top of `send()`)

```diff
+    if (pendingContentClarificationRef.current) {
+      const pendingContent = pendingContentClarificationRef.current;
+      const contentMsg = userMessage.trim();
+      const contentAgeMs = Date.now() - pendingContent.createdAt;
+      const contentIsStale  = contentAgeMs > 5 * 60 * 1000;
+      const contentIsEscape = QUESTION_ESCAPE_RE.test(contentMsg) || FRESH_COMMAND_RE.test(contentMsg);
+      if (contentIsStale || contentIsEscape) {
+        pendingContentClarificationRef.current = null;
+      } else if (contentMsg) {
+        pendingContentClarificationRef.current = null;
+        const directionWord = pendingContent.direction === 'leave' ? 'leave' : 'arrive at';
+        const correctedMessage = `Text ${pendingContent.toName} saying ${contentMsg} when I ${directionWord} ${pendingContent.placeName}`;
+        if (sendRef.current) sendRef.current(correctedMessage);
+        return;
+      }
+    }
```

### `report-location-event/index.ts` — rawBody separated from fallback, third-party branches gated

```diff
-  const body = await buildAlertBody(config, rule.user_id, supabaseUrl, interFnKey, rule.id)
-    || `You've arrived at ${rule.label ?? 'your destination'}.`;
+  const rawBody = await buildAlertBody(config, rule.user_id, supabaseUrl, interFnKey, rule.id);
+  const body = rawBody || `You've arrived at ${rule.label ?? 'your destination'}.`;
...
   } else if (toPhone) {
-    sends.push(callSMS('sms', toPhone));
-    sends.push(callSMS('whatsapp', toPhone));
+    if (rawBody) {
+      sends.push(callSMS('sms', toPhone));
+      sends.push(callSMS('whatsapp', toPhone));
+    } else {
+      console.warn(`[report-location-event] B10h: SKIPPED third-party SMS/WhatsApp (no_content) rule=${rule.id} to=${toName || toPhone}`);
+    }
   } else if (toEmail) {
-    sends.push(callEmail(toEmail));
+    if (rawBody) {
+      sends.push(callEmail(toEmail));
+    } else {
+      console.warn(`[report-location-event] B10h: SKIPPED third-party email (no_content) rule=${rule.id} to=${toName || toEmail}`);
+    }
   } else {
```

**Net effect confirmed by direct diff read:** the self-alert branch (`if (isSelfAlert) { ... }`, immediately above the third-party branches) is byte-identical before and after — confirmed by `b10h.fire-time-guard-self-alert-branch-unaffected`, which asserts the self-alert block contains no reference to `rawBody` or `B10h`.

### `evaluate-rules/index.ts`

```diff
   if (!body) {
+    // B10h (2026-07-17) — confirmed during implementation that this existing
+    // guard already fails closed for third-party sends when content is
+    // missing, unconditionally, before the self/third-party branch below
+    // even runs. No change needed here...
     console.error(`[evaluate-rules] Rule ${rule.id}: empty body after buildAlertBody`);
     return false;
   }
```
Comment only. `if (!body) { return false; }` already existed, unconditionally, before this investigation — confirmed by direct read, not assumed correct.

---

## Tests executed

**Command:** `npm run test:auto`

**Result:** 443 tests — 437 passed, 0 failed, 4 errored, 2 skipped.

**New tests (all 7 passed):**
- `b10h.write-time-guard-blocks-third-party-with-no-content` — the Layer 2/3 guard exists, runs after the placeName check, before any `resolve-place` call.
- `b10h.write-time-guard-checks-same-three-fields-as-buildAlertBody` — the guard checks exactly `body`/`tasks`/`list_name`.
- `b10h.pending-content-clarification-ref-exists-and-is-checked-early` — the new ref is separate from `pendingLocationRef` and checked early in `send()`.
- `b10h.clarification-reply-retries-through-claude-not-mid-flow-resume` — confirms the corrected design (retry via `sendRef`, not a hand-rolled resume).
- `b10h.fire-time-guard-separates-real-content-from-self-alert-fallback` — `rawBody` gates third-party sends, with distinct logged skip reasons.
- `b10h.fire-time-guard-self-alert-branch-unaffected` — regression guard confirming the self-alert branch has zero B10h-related changes.
- `b10h.evaluate-rules-already-fail-closed-no-change-needed` — confirms the pre-existing guard and the in-source documentation of the finding.

**Pre-existing, unrelated errors (4) — identical set to F5c's and B10g's own evidence packages, not caused by this change:** `b6d.prompt-version-bumped-to-v98`, `session-2026-05-28.b6d-prompt-version-v100` (stale prompt-version strings), `f10a.website-nav-feedback-link-homepage-only` (pre-existing wording mismatch), `voice.calendar-today-query` (live-calendar-data-dependent, no relationship to any file this change touched).

**Pre-existing skips (unrelated):** two Google OAuth-not-connected skips.

**No test that was passing before this change is now failing.**

**TypeScript check, informational only:** an ad-hoc `tsc` invocation against `useOrchestrator.ts` (this project's real build goes through Expo/Babel, not raw `tsc`) surfaced one error unrelated to this change — a pre-existing type looseness in the multi-candidate address-picker code (`candidatesSource: 'memory'|'fresh'` vs. a type declared as `'fresh'` only), confirmed present in the file before this session's edits and unrelated to anything touched by B10h. Not fixed here — out of scope, flagged for visibility rather than silently ignored.

---

## Manual tests required (not yet performed — pending deployment)

Per `CLAUDE.md`'s STAGING-FIRST rule, nothing has been deployed yet. Per Phase 3's extended acceptance criterion 7 (added by review, end-to-end not persistence-only):

1. Create a location alert with the bare "text NAME MESSAGE" phrasing (Phase 1's exact reproduced shape). Confirm Naavi asks *"What should I tell [name]?"* instead of silently saving.
2. **Full end-to-end chain, verified at every step (strengthened per review feedback — the negative check matters as much as the positive one, since it's what proves the fallback was completely bypassed, not just that a message arrived):**
   1. User says: *"Text Bob goodnight when I arrive home."*
   2. Clarification question appears (*"What should I tell Bob?"*).
   3. User replies: *"Goodnight."*
   4. Database: the saved row's `action_config.body` is exactly `"Goodnight"`.
   5. **Positive check** — the delivered SMS body is exactly *"Goodnight"* (or Naavi's minimally-formatted version of it).
   6. **Negative check** — the delivered SMS does **not** contain *"You've arrived at Home."* anywhere in it. Confirming the message arrived is not sufficient on its own; confirming the fallback text is completely absent is what proves the fix, not just that something got sent.
3. Confirm a third-party location alert with real content (from Phase 1's own reproductions, or a fresh one) is completely unaffected — same save, same delivery as before this change.
4. Confirm a self-alert with no content (e.g. "alert me when I arrive at Costco") is completely unaffected at both layers — still saves, still fires, still sends the generic fallback, exactly as today.
5. Confirm the clarification question's staleness (5 min) and escape-pattern (a fresh command/question) handling behave the same way `pendingLocationRef`'s already do — a stale or escaped pending clarification doesn't hijack an unrelated later message.

---

## Rollback instructions

Revert the three uncommitted implementation files (`hooks/useOrchestrator.ts`, `report-location-event/index.ts`, and the comment-only `evaluate-rules/index.ts` change) and the new test file, via `git checkout` (nothing committed yet). No migration, no schema change, no other file affected. No data cleanup needed — this change only affects whether a third-party location alert with no content can be saved/fired; no rows are written differently for alerts that already had content.

---

## Known risks

- **Not yet deployed anywhere** — staging deployment and the manual tests above should happen before Phase 6 approval is treated as sufficient for production.
- **The retry-through-Claude mechanism costs one extra round-trip** per clarification, and depends on Claude correctly parsing the reconstructed sentence (`"Text Bob saying Goodnight when I arrive at Home"`) the same way it already reliably parses the "saying X" pattern per Phase 1 §2.5's own evidence (the prompt's worked examples already demonstrate this exact phrasing succeeding) — this is a lower-risk dependency than it might first appear, since it reuses a pattern already proven to work, not a novel one.
- **`evaluate-rules`'s "no change needed" finding is based on static code read, not a fresh live reproduction attempt** — consistent with this project's evidentiary standard elsewhere (e.g. F5c's own "root cause not proven" sub-questions), stated as a code-level fact (the guard exists and runs unconditionally), not a claim that every possible third-party time-triggered content-loss scenario has been live-tested.
- **Risk shape is a strict tightening for Layer 2/3 and Layer 4** (fewer/no wrong-content sends, never new ones) — same bounded-downside reasoning as F5c and B10g's own risk classifications.

---

## Phase 5 review record (2026-07-17)

Reviewer feedback received via Wael. One item adopted:

1. **Manual test 2 expanded into a full 6-step end-to-end chain**, with an explicit negative check added: confirming the fallback text ("You've arrived at Home.") is completely absent from the delivered SMS, not just that the clarification text is present. The negative check is what proves the fallback was bypassed, not merely that a message arrived — a positive-only check could pass even if both the real content and stale fallback text ended up concatenated in the same message.

Reviewer's stated assessment: across the full lifecycle, Phase 1 separated evidence from hypothesis precisely, Phase 2 produced a layered fail-closed design, Phase 3 resolved outstanding questions with direct investigation, and Phase 4/5 implemented within approved boundaries, documented the one implementation change transparently, and backed it with targeted tests. No return to Phase 2 or Phase 3 required. Remaining work is operational, not architectural: deploy to staging, complete manual end-to-end validation (including the strengthened negative check), then proceed to Phase 6.

**This is the reviewer's assessment of the evidence package's quality — it is not, by itself, authorization to deploy or begin Phase 6.** Per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3): both require Wael's own separate, explicit go-ahead, regardless of this review verdict.

---

## Status

**Phase 5 written and reviewed 2026-07-17, revision above adopted.** **Edge Functions deployed to STAGING 2026-07-17** (Wael's explicit "deploy") — `report-location-event` (Layer 4 fix) and `evaluate-rules` (comment-only) both deployed via `npx supabase functions deploy <name> --no-verify-jwt --project-ref xugvnfudofuskxoknhve`, both succeeded. **Production untouched.**

**Not yet deployed: the mobile write-time guard (Layer 2/3, `hooks/useOrchestrator.ts`).** This is app code, not an Edge Function — it requires a staging APK build (`eas build --profile staging`) and installing it on a device, a separate action from the Edge Function deploys above. Until that build exists, the fire-time backstop (Layer 4, now live on staging) is the only protection in effect for third-party content loss — it will correctly skip a bad send, but the write-time guard (blocking the save and asking "what should I tell X?") is not yet active anywhere. Needs Wael's separate go-ahead to kick off.

Manual end-to-end validation (§ above) and Phase 6 have NOT started and will not start until Wael gives explicit, separate approval for each.
