# B10q — Phase 5: Evidence Package

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5. Implementation completed within the Implementation Boundaries confirmed in `docs/B10Q_PHASE3_TECHNICAL_REVIEW_2026-07-21.md` (both the original approval and the mid-Phase-4 correction, both externally reviewed and APPROVEd).

---

## Summary

An email-trigger alert with no `from_name`/`from_email`/`subject_keyword` matched every incoming email instead of none, on two independent implementations (mobile/Shared-Core's `manage-rules`, and voice's `SET_EMAIL_ALERT`) — confirmed via the Architecture Scope Rule that "Action Rules — creation" is a documented Duplicated capability. Fix: matching validation added independently to both write chokepoints, rejecting the write with a structured `email_alert_unscoped` error instead of silently creating a fire-on-everything rule. Both surfaces' speech-generation updated to speak the agreed decline wording on this error, including a mid-implementation correction on voice (the originally-planned fix targeted a code region `SET_EMAIL_ALERT` never actually reaches — corrected to an explicit awaited dispatcher branch, externally re-reviewed and approved).

**Deployed to staging** (`manage-rules`, `naavi-chat` — Supabase project `xugvnfudofuskxoknhve`). **Voice server change not yet deployed anywhere** — no staging Railway environment exists for voice (a known, separately-tracked gap); the only real deploy target is production, and that requires Wael's explicit separate authorization per the staging-first rule, not bundled into this Evidence Package. **Not yet committed to git** on either repo.

---

## Files changed

| File | Repo | Change |
|---|---|---|
| `supabase/functions/manage-rules/index.ts` | `naavi-app` | Added validation to the `op:'create'` handler — rejects `trigger_type==='email'` with all three filter fields empty, returns `{error:'email_alert_unscoped'}`, status 400. |
| `supabase/functions/naavi-chat/index.ts` | `naavi-app` | (a) Pending-confirmation commit handler recognizes `email_alert_unscoped` and speaks the full decline wording. (b) Layer-2-classifier's `missingParam` text reworded to the same wording (was a bare clarifying question). |
| `tests/runner.ts` | `naavi-app` | Import + registration of the new test file (2 lines). |
| `tests/catalogue/session-2026-07-21-b10q-email-alert-validation.ts` (new) | `naavi-app` | 7 regression tests — 2 live against `manage-rules` (positive + negative control), 5 source-level structural checks (naavi-chat wording ×2, voice validation + speech-surfacing ×3). |
| `naavi-voice-server/src/index.js` | `naavi-voice-server` | (a) `SET_EMAIL_ALERT` case: identical validation added. (b) New explicit awaited dispatcher branch for `SET_EMAIL_ALERT` (mid-implementation correction — see Phase 3's revision note; the originally-planned `ACTION_DEFAULT_SPEECH`-region fix was found unreachable for this action type). (c) Multi-action queue: specific terse decline instead of the generic failure message. |

No other file touched. No schema change, no migration, no new Edge Function, no new dependency.

---

## Git diff

### `supabase/functions/manage-rules/index.ts`
```diff
@@ -302,6 +302,21 @@ serve(async (req) => {
     }
 
     if (body.op === 'create') {
+      // B10q — an email-trigger rule with no from_name/from_email/subject_keyword
+      // matches every incoming email instead of none (evaluate-rules treats an
+      // absent filter field as "match anything"). The chat classifier already
+      // asks a clarifying question before reaching here, but this is the actual
+      // write chokepoint — any other caller must be blocked here too.
+      if (body.trigger_type === 'email') {
+        const tc = (body.trigger_config ?? {}) as Record<string, unknown>;
+        const hasFilter = !!(tc.from_name || tc.from_email || tc.subject_keyword);
+        if (!hasFilter) {
+          return new Response(JSON.stringify({ error: 'email_alert_unscoped' }), {
+            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
+          });
+        }
+      }
+
       // Service-role insert — bypasses RLS that blocks direct client writes.
       // Used by useOrchestrator for non-location SET_ACTION_RULE actions
       // (time, weather, calendar, contact_silence triggers).
```

### `supabase/functions/naavi-chat/index.ts`
```diff
@@ -1849,7 +1849,10 @@ function buildActionConfirm(
       const tt = String(params.trigger_type ?? '');
       if (tt === 'email') {
         if (!params.from && !params.subject_keyword) {
-          return { speech: '', display: '', actions: [], missingParam: "Who should the email be from, or what keyword should be in the subject?" };
+          // B10q — full decline+clarify wording (not a bare clarifying question),
+          // so the message itself already covers a user who insists on "all
+          // emails" without needing separate loop-detection logic.
+          return { speech: '', display: '', actions: [], missingParam: "I can't set an alert for every email — that's what your email app is already for. Who should it be from, or what should it be about?" };
         }
         const fromPart = params.from ? `from ${params.from}` : '';
         const kwPart   = params.subject_keyword ? `about "${params.subject_keyword}"` : '';
@@ -2462,11 +2465,13 @@ Deno.serve(async (req) => {
               let _mrData: any = {};
               try { _mrData = JSON.parse(_mrRawText); } catch { /* ignore */ }
               const insErr = (!_mrRes.ok || _mrData.error) ? (_mrData.error ?? 'manage-rules failed') : null;
-              const speech = insErr
-                ? `I had trouble saving that alert — please try again.`
-                : _mrData.merged
-                  ? `Done. Added to your existing reminder at that time.`
-                  : `Done. ${desc}`;
+              const speech = insErr === 'email_alert_unscoped'
+                ? `I can't set an alert for every email — that's what your email app is already for. Who should it be from, or what should it be about?`
+                : insErr
+                  ? `I had trouble saving that alert — please try again.`
+                  : _mrData.merged
+                    ? `Done. Added to your existing reminder at that time.`
+                    : `Done. ${desc}`;
               if (insErr) console.error(`[timing] ${elapsed()} | SET_ACTION_RULE manage-rules failed: ${insErr}`);
               else console.log(`[timing] ${elapsed()} | SET_ACTION_RULE manage-rules succeeded | merged=${!!_mrData.merged}`);
               return jsonResponse({ rawText: JSON.stringify({ speech, display: speech, actions: [], pendingThreads: [] }) });
```

### `naavi-voice-server/src/index.js`
```diff
@@ -4643,6 +4643,15 @@ async function executeAction(action, userIdOverride) {
         if (action.fromName)       triggerConfig.from_name = action.fromName;
         if (action.fromEmail)      triggerConfig.from_email = action.fromEmail;
         if (action.subjectKeyword) triggerConfig.subject_keyword = action.subjectKeyword;
+        // B10q — same gap as manage-rules (mobile/Shared-Core): an email alert
+        // with no filter matches every incoming email instead of none. This
+        // path bypasses manage-rules entirely (raw insert below) and defaults
+        // to one_shot:false, so an unscoped rule created here would never
+        // self-disable — reject before it can be written.
+        if (!triggerConfig.from_name && !triggerConfig.from_email && !triggerConfig.subject_keyword) {
+          console.warn(`[Action] SET_EMAIL_ALERT rejected — no filter (from_name/from_email/subject_keyword all empty)`);
+          return { success: false, error: 'email_alert_unscoped' };
+        }
         const label = action.label || (action.fromName ? `Emails from ${action.fromName}` : `Emails with "${action.subjectKeyword}" in subject`);
         const res = await fetch(`${SUPABASE_URL}/rest/v1/action_rules`, {
@@ -9826,7 +9835,11 @@ wss.on('connection', (twilioWs) => {
                 } else {
                   const result = await executeAction(action, userId);
-                  if (result?.error) {
+                  if (result?.error === 'email_alert_unscoped') {
+                    // B10q — specific decline, not the generic failure message.
+                    // Kept terse to match this queue's other per-item results.
+                    resultPrefix = `Couldn't set that email alert — needs a sender or subject.`;
+                  } else if (result?.error) {
                     resultPrefix = `That one failed — I'll move on.`;
@@ -11063,6 +11076,27 @@ wss.on('connection', (twilioWs) => {
         } catch (err) {
           console.error('[Process] LIST_READ failed:', err.message);
         }
+      } else if (action.type === 'SET_EMAIL_ALERT') {
+        // B10q — must await here rather than fall through to the generic
+        // fire-and-forget backgroundActions bucket (Promise.all, not awaited,
+        // runs after finalSpeech is already dispatched to Twilio).
+        try {
+          const result = await executeAction(action, userId);
+          if (result?.error === 'email_alert_unscoped') {
+            finalSpeech = `I can't set an alert for every email — that's what your email app is already for. Who should it be from, or what should it be about?`;
+            speechWasModified = true;
+          } else if (result?.success === false) {
+            finalSpeech = `I had trouble saving that alert — please try again.`;
+            speechWasModified = true;
+          }
+        } catch (err) {
+          console.error('[Process] SET_EMAIL_ALERT failed:', err.message);
+          finalSpeech = `I had trouble saving that alert — please try again.`;
+          speechWasModified = true;
+        }
       } else if (action.type === 'FETCH_TRAVEL_TIME') {
```
(`tests/runner.ts`'s diff is 2 additive import/registration lines, omitted here for brevity — see file directly.)

---

## Tests executed

**B10q-specific suite, staging, after deploy** (`npm run test:auto -- --grep b10q`):

```
Testing against: STAGING (xugvnfudofuskxoknhve)
b10q.manage-rules-rejects-unscoped-email-alert          ✓ PASS
b10q.manage-rules-still-creates-scoped-email-alert      ✓ PASS
b10q.naavi-chat-commit-handler-speaks-decline-wording   ✓ PASS
b10q.naavi-chat-classifier-wording-matches-agreed-phrasing ✓ PASS
b10q.voice-set-email-alert-rejects-unscoped             ✓ PASS
b10q.voice-primary-path-awaits-set-email-alert          ✓ PASS
b10q.voice-multi-action-queue-specific-decline          ✓ PASS
7/7 passed, 0 failed, 0 errored
```

Two bugs found and fixed in the test file itself during this run, both environmental/path issues, not code-under-test problems: (1) `VOICE_SERVER_PATH` assumed a sibling directory (`../naavi-voice-server`) — corrected to the real location (`naavi-voice-server`, a subdirectory of this repo). (2) The multi-action-queue test's search window (300 chars) was too narrow given the source file's CRLF line endings — widened to 400.

**Full regression suite, staging** (`npm run test:auto`, no filter): first run — 370 passed, 0 failed, 128 errored, 2 skipped. **All 128 errors traced, none are regressions:**
- ~120 were `get-naavi-prompt failed: status=401 ... "This API key might also be owned by another Supabase project"` — caused by my own test invocation using the production `SUPABASE_ANON_KEY` against the staging URL (I had overridden `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` for staging but not `SUPABASE_ANON_KEY`, which isn't in `tests/.env` for staging). Not a code defect.
- `voice-pin.verify-without-service-role-returns-401`, 4× `s060606.lookup-*` (contact lookup) — unrelated to B10q's changed files, same auth-cascade cause.
- `f10a.website-nav-feedback-link-homepage-only` — pre-existing, already documented as unrelated in prior evidence packages (e.g. B10g's Phase 5).

**Zero failures in this run, and zero errors touched B10q's actual changed code** (`manage-rules`, `naavi-chat`'s email path, voice's `SET_EMAIL_ALERT`).

**Second full-suite run, staging, with the correct anon key** (retrieved via `npx supabase projects api-keys --project-ref xugvnfudofuskxoknhve`): **490 passed, 0 failed, 10 errored, 0 skipped.** All 10 remaining errors traced and confirmed unrelated to B10q:
- `memory.search-knowledge-smoke`, `memory.ingest-then-search`, `multiuser.search-knowledge.body-userid-resolves` — staging is missing the Postgres function `search_knowledge_fragments` (schema-cache error) — a pre-existing staging-environment gap unconnected to `action_rules`.
- `b6d.prompt-version-bumped-to-v98`, `session-2026-05-28.b6d-prompt-version-v100` — stale expected prompt-version strings, already documented as pre-existing in prior evidence packages (e.g. B10g's Phase 5).
- 4× `s060606.lookup-*` — contact-lookup 400s, staging test-account Google-contacts data gap, unrelated to email alerts.
- `f10a.website-nav-feedback-link-homepage-only` — confirmed pre-existing across multiple prior sessions.

**Net result across both runs: zero failures, zero regressions, nothing touching B10q's changed files (`manage-rules`, `naavi-chat`, `action_rules` generally) affected in either run.**

**Non-Determinism Rule note:** this fix does not touch classifier/prompt behavior (`get-naavi-prompt` untouched, no Claude tool-use routing changed) — it's deterministic application-code validation. The 3-trial requirement for prompt/classifier changes (Governance §Phase 3) does not apply here.

---

## Manual test — performed by Wael on the real mobile app (2026-07-21), addendum

Real device testing surfaced a chain of three interlocking bugs the API-level testing above did not catch, all found, fixed, and re-verified before this addendum:

1. **`trigger_config` mapping gap** — `naavi-chat`'s pending-confirmation commit handler read the classifier's captured filter (`pendingParams.from`/`subject_keyword`) only to build the spoken description, never copying it into `trigger_config`, the field actually sent to `manage-rules`. A correctly-specified request ("email alert from Bob") could reach the DB write with an empty `trigger_config` — before this fix, silently creating an unscoped rule while speaking a false "Done"; after B10q's validation alone (before this addendum), correctly rejected but for the wrong apparent reason. **This is very likely the actual mechanism behind the original production "someone" incident** (Phase 1's evidence row had `trigger_config: {}` despite presumably following a real user request). Fixed: map `from`/`subject_keyword` into `trigger_config.from_name`/`from_email`/`subject_keyword` before the write.
2. **Bypass regex too narrow** — the pre-Haiku email-alert bypass (`naavi-chat/index.ts`, added to counter a documented Haiku misclassification) only matched "when," not "if"/"whenever." Broadened.
3. **The real root cause of the manual-test failures** — the bypass only checked `.speech`, but the no-filter case (exactly the case B10q's decline exists for) returns `speech: ''` with the real message in `.missingParam` instead (same pattern already established elsewhere in the file). So the unscoped case was **never actually protected by this bypass at all** — every "no filter" request fell through to Haiku's classifier, which is non-deterministic (per Governance's Non-Determinism Rule) and — exactly as the bypass's own comment predicted — often misclassified "alert me" as a request to *list* alerts. Fixed to check both `.speech` and `.missingParam`, and to not attach a stray confirmation prompt to a decline that has nothing pending.

**Re-verified after all three fixes, both via direct API call and by Wael on the real mobile app:**
- "Alert me when/if/whenever I get emails" (no filter) → consistently declines with the correct wording, response time ~0.4-0.8s confirming the bypass fires (not the ~1.4s Haiku round-trip).
- "Alert me when I get emails from Bob" (scoped) → proposes correctly → "Yes" → **"Done. Email alert from bob set."** — confirmed created correctly via the Alerts screen: correct sender filter, "fires once, then stops," correct multi-channel fan-out description.

Full B10q test suite re-run after these fixes: 7/7 pass.

## Manual tests required

Per this project's Two-Phase Build Process, no AAB/APK build was needed for the mobile-facing pieces (Shared Core only, no mobile client code touched).

1. ~~Live conversation on staging: "Alert me when I get emails" (no filter)~~ — **DONE**, performed by Wael on the real mobile app, 2026-07-21. See addendum above.
2. ~~Live conversation on staging: "Alert me when I get an email from Bob"~~ — **DONE**, same session, same addendum. Confirmed created correctly via the Alerts screen.
3. **Voice, once deployed:** still outstanding — same phrasings by phone call, both standalone and inside a compound/multi-action request, confirming the primary single-action and multi-action-queue speech paths.

---

## Rollback instructions

**Staging (already deployed):** redeploy the pre-fix versions —
```
git stash  # or checkout the pre-change commit for these two files
npx supabase functions deploy manage-rules --no-verify-jwt --project-ref xugvnfudofuskxoknhve
npx supabase functions deploy naavi-chat --no-verify-jwt --project-ref xugvnfudofuskxoknhve
```
No data cleanup needed — this change only affects whether an unscoped email rule CAN be created; no existing rows are modified by it.

**Voice (not yet deployed):** N/A — nothing to roll back until it's pushed.

**Git:** nothing committed yet on either repo — reverting is simply discarding the uncommitted working-tree changes (`git checkout -- <files>` in each repo) if needed before commit.

---

## Known risks

- **Voice-server change is uncommitted and undeployed.** The fix is incomplete in practice until it ships — the validation exists in code but a live caller today still hits the old, unvalidated behavior.
- ~~Full-suite regression confidence is currently based on a run with a known auth-configuration gap~~ — resolved: the corrected re-run (490 passed, 0 failed, 10 pre-existing/unrelated errors) confirms zero regressions.
- **Multi-action-queue and primary-path voice fixes are untested live** (only source-level checks + the isolated `node --check` syntax pass) — voice's classifier routing (which path a given phrasing reaches) can't be reliably forced in an automated test, per the same non-determinism reasoning documented in B10j's own test suite. Manual test #3 above is the real verification for this.
- **Two production Edge Function callers of `manage-rules`** (`useOrchestrator.ts:4196`, `naavi-chat`'s commit handler) were traced and confirmed unaffected for non-email trigger types (Phase 2/3's Regression Matrix) — not re-verified by a live test against every other trigger type in this Evidence Package; relying on the source-level trace plus the full-suite regression pass (370 passed) as coverage for that.

---

## Status

Phase 5 (staging portion) complete, clean. Awaiting: (1) Wael's decision on voice-server deployment (production is the only environment — requires separate explicit authorization, not assumed as part of this package), (2) Phase 6 (Technical Review After Coding) — including the Invalidated Planning Assumption record flagged in Phase 3's revision.
