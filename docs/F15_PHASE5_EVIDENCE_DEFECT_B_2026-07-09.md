# F15 — Phase 5: Evidence Package — Defect B (third-party recipient dropped on location alerts)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5. Covers Defect B only. Defect A is designed (`docs/F15_PHASE2_CHANGE_PLAN_2026-07-09.md` §1) but not yet implemented — separate Evidence Package once that lands.

---

## 1. Summary

Root cause: `docs/F15_PHASE1_PROBLEM_DEFINITION_2026-07-09.md` (fourth revision), Evidence B9-B11. `naavi-chat/index.ts`'s `buildActionConfirm` function, `tt === 'location'` branch, built `action_config` only from `params.action_config`/`params.tasks` — never reading a recipient (`params.to_name`/`params.to`) even when Layer 2's classifier had already extracted one (confirmed live via runtime diagnostic, Evidence B11).

Fix: three-line, guarded addition to that branch, forwarding the recipient into `action_config.to` when present. No change to any other component — `resolve-recipient`, contact lookup, and the DB write path were already correct (F12) and needed no modification.

**Status: CLOSED. Entire feature verified — write path AND fire path, both confirmed with real, physical drive tests.** (Supersedes the "Code fix verified, not Entire feature verified" status from the prior revision, per external review's own stated closing criterion: one real arrival producing a real send.) Two live drive tests were run this session:

- **First drive (13:40 EST):** all 3 test alerts failed to fire. Root-caused (not to this fix) to an unrelated device/OS-level condition — logged separately as `B9d` in the holding list (`react-native-safe-area-context` insets race + a force-stop that occurred ~4 minutes before departure). See `docs/F15_PHASE1_PROBLEM_DEFINITION_2026-07-09.md`-adjacent session record and `project_naavi_f15_geofence_forcestop` memory. **This was not a regression in this fix** — the write-path evidence (§5 original trace) already independently proved the fix correct before this drive was even attempted.
- **Second drive (17:16-17:19 EST), app kept foregrounded, no force-stop involved:** all 3 fired correctly. Confirmed via `action_rules.last_fired_at` (all 3 set), `geofence_events` (enter events recorded at 253m/293m/287m from center, well within the 300m radius), and `sent_messages` for the SMS test (`{"channel":"sms","to_name":"Bob","to_phone":"(343) 333-2567","body":"You've arrived at 304 Bayview Dr."}` — a real message to Bob's real number) and the baseline self-alert (SMS+WhatsApp+voice all logged for 588 Bayview Dr).

First successful third-party location alert of this entire investigation: *"Text Bob when I arrive at 77 McBrien St"* → DB row `85269325-3973-4a48-8410-d3ed5a80cc8c` with fully resolved `action_config: {"to":"Bob","to_name":"Bob","to_phone":"(343) 333-2567","contact_id":"people/c4635196459157606649"}`, and the Alerts UI correctly showing *"Naavi sends Bob a text message at (343) 333-2567."*

## 2. Files changed

| File | Change | Scope |
|---|---|---|
| `supabase/functions/naavi-chat/index.ts` | `buildActionConfirm`'s location branch (~line 1802-1829): added the guarded recipient-forwarding fix (Phase 2 §2.5, required tier). Classifier prompt (~line 1665): added one worked example for location+recipient (Phase 2 §2.5, recommended tier — not required for the fix, ships alongside it for robustness). **Also still present, not yet removed:** two temporary diagnostics added earlier this session for root-cause investigation (the Layer 2 `classification` logger at ~line 2750, and the raw `tool_use` logger at ~line 3353) — see §6. | Backend, Protected Core-adjacent |
| `tests/catalogue/session-2026-07-09-f15-defect-b.ts` (new file) | Two regression tests per Phase 2 §2.7 — see §4. | Testing |
| `tests/runner.ts` | Registered the new test file (import + spread into the catalogue array). | Testing |

**Flagged, not part of this fix (Phase 4's "No Extra Changes Rule" — reported, not silently folded in):**
- `supabase/functions/_shared/anthropic_tools.ts` has an uncommitted, leftover change from the Hypothesis Validation experiment (Phase 1 §2, Evidence B5) that was tested and ruled out — a worked example added to `set_location_rule_address`'s tool description. It is inert (that tool is never reached for the failing pattern, per B9-B11) but was never reverted. Does not affect this fix's correctness either way. Recommend reverting as cleanup, not bundled into this change.
- `supabase/functions/get-naavi-prompt/index.ts` shows as modified in `git status` but was **not touched by this session's F15 work** — pre-existing uncommitted change from before this investigation started (present in the very first `git status` of this session). Not part of this diff; called out so it isn't mistaken for part of this fix.

## 3. Git diff

`supabase/functions/naavi-chat/index.ts` (the actual fix; full diff, all three additions — prompt example, the fix itself, and the two temporary diagnostics):

```diff
@@ -1662,7 +1662,7 @@ ADD_CONTACT → name, phone (E.164 if given), email (if given)
 DRAFT_MESSAGE → to_name (recipient name), body (message text), to_phone (E.164 if known)
 DELETE_EVENT → query (event name/keyword to find and delete)
 SCHEDULE_MEDICATION → medication (name + dosage), frequency (e.g. "once daily", "twice a day"), duration (e.g. "10 days"), start_date (ISO8601 Toronto or "today"). Use for "take X mg of Y", "take amoxicillin", "remind me to take my medication", any prescription or supplement schedule.
-SET_ACTION_RULE → location/email/time/contact-silence alerts. Params: trigger_type (email|location|time|contact_silence), from (email sender name/address), subject_keyword (keyword in subject line, e.g. "board meeting"), location (place name for location trigger), direction (arrive|leave), tasks (...). e.g. "alert me when I arrive at X" → {trigger_type:"location",location:"X",direction:"arrive"}; "remind me with Bob kid Sam when I arrive to Bob home" → {...};
+SET_ACTION_RULE → ... tasks (...), to_name (for location alerts that name a THIRD PARTY to notify, not just self — e.g. "text Bob when I arrive at X" ... → to_name:"Bob"/"wife" — same extraction as the time-trigger case below, applied to location triggers too). e.g. "alert me when I arrive at X" → {trigger_type:"location",location:"X",direction:"arrive"}; "text Bob when I arrive at 50 Elm St" → {trigger_type:"location",location:"50 Elm St",direction:"arrive",to_name:"Bob"}; "remind me with Bob kid Sam when I arrive to Bob home" → {...};

@@ -1813,6 +1813,18 @@ function buildActionConfirm(
         if (haikuTasks && !Array.isArray(baseActionConfig.tasks)) {
           baseActionConfig.tasks = [haikuTasks];
         }
+        // F15 (2026-07-09) — forward a Haiku-extracted recipient (from "text
+        // Bob when I arrive at X" style phrasing) into action_config.to. ...
+        const haikuToName = String((params as any).to_name ?? (params as any).to ?? '').trim();
+        if (haikuToName && !baseActionConfig.to) {
+          baseActionConfig.to = haikuToName;
+        }
         return { speech: s, display: s, actions: [{ type: 'SET_ACTION_RULE', ... }] };

@@ -2735,6 +2747,26 @@ Deno.serve(async (req) => {
           } else if (classification.level === 'action' && HANDLED_ACTION_INTENTS.has(classification.intent)) {
+            // ── F15 TEMPORARY DIAGNOSTIC (2026-07-09) ...
+            if (String(classification.params?.trigger_type ?? '') === 'location') { ... }
             // ── Deterministic action — skip Claude entirely ───────────────────

@@ -3318,6 +3350,34 @@ Deno.serve(async (req) => {
     const toolUseBlocks = response.content.filter((b: any) => b.type === 'tool_use');
+    // ── F15 TEMPORARY DIAGNOSTIC (2026-07-09) ...
+    for (const _diagBlock of toolUseBlocks) { ... }
```

(Full, un-truncated diff available via `git diff -- supabase/functions/naavi-chat/index.ts` in the working tree.)

## 4. Tests executed

**New regression tests** (`tests/catalogue/session-2026-07-09-f15-defect-b.ts`), both passing:
- `f15.location-branch-forwards-recipient-into-action-config` — confirms the location branch reads `to_name`/`to` and assigns into `baseActionConfig.to` before the action is returned.
- `f15.location-branch-recipient-forwarding-is-guarded-no-op-by-default` — confirms the exact guard shape (`if (haikuToName && !baseActionConfig.to)`) and that the extraction defaults to falsy when neither field is present.

**Disclosed coverage gap (per CLAUDE.md Rule 15a, not silently absorbed):** both are source-pattern assertions, not live execution of `buildActionConfirm`. That function lives inside a Deno-only file (`Deno.serve(...)` at module scope) and can't be safely imported into this Node/tsx test runner without a structural refactor outside this fix's scope. This is the same style and the same accepted limitation as every F12 test in this catalogue (see that catalogue's own docstrings). The stronger "byte-for-byte identical output" behavioral test requested during Phase 2 review was achieved instead via a **live, manual, staging trace** (§5) rather than an automated unit test — a real end-to-end run is arguably stronger evidence than a mocked unit test would have been, but it is not repeatable by `npm run test:auto` on every future change the way a true unit test would be.

**Full suite run:** `npm run test:auto` (381 cases) — **378 passed, 0 failed, 1 errored, 2 skipped.** The 2 new F15 tests are both in the passing set. The 1 error (`f10a.website-nav-feedback-link-homepage-only`) is a pre-existing website-nav test, unrelated to `naavi-chat`/`action_rules`/this fix — not caused by this change. The 2 skips are pre-existing OAuth-connection gaps for the test account, also unrelated. **No regressions from this fix.** Full report: `tests/results/2026-07-09T10-51-45-902Z.md`.

## 5. Manual/live validation (staging, this session)

Full trace per Phase 2 §2.6, every link confirmed independently:

1. **`classification.params.to_name`** — confirmed present (`"Bob"`) via a temporary runtime diagnostic at the Layer 2 decision point, for the live message "Text bob when I arrive at 1130 klondike rd" (Phase 1 Evidence B11).
2. **`buildActionConfirm`'s `action_config.to`** — confirmed via the final DB row for a post-fix test ("Text Bob when I arrive at 77 McBrien St"): `action_config.to = "Bob"`.
3. **`useOrchestrator.ts`'s `resolve-recipient` invocation** — confirmed indirectly (the resolved fields below could not exist otherwise) and directly, by an intermediate failed attempt ("36 Kettlewell Way") that correctly triggered the `recipientBlocked` fail-closed path with the exact `useOrchestrator.ts:3284` wording, proving the call reaches that code. (That attempt's "not found" was a transient Google API hiccup — verified by calling `resolve-recipient` directly moments later with identical parameters and getting `resolved_contact`; the very next live retry succeeded end-to-end.)
4. **`resolve-recipient`'s resolution result** — confirmed correct: `to_phone: "(343) 333-2567"`, `contact_id: "people/c4635196459157606649"`, matching Bob's real Google Contacts card exactly.
5. **DB `action_rules.action_config`** — confirmed via direct service-role query: `{"to":"Bob","to_name":"Bob","to_phone":"(343) 333-2567","contact_id":"people/c4635196459157606649"}`.
6. **Alerts UI** — confirmed via screenshot: *"Arrive at 77 McBrien St → Alert Bob"*, *"Naavi sends Bob a text message at (343) 333-2567."* — the first correct third-party-recipient display of this entire investigation.

**Done — closed via the second live drive (§1).** Location fires go through `report-location-event` (not `evaluate-rules`), which has its own phantom-GPS-jump rejection logic — a real physical drive was the correct way to satisfy that legitimately, rather than attempting to construct a request that passes anti-spoofing heuristics artificially.

**Email delivery confirmed directly by Wael** — Bob received the email at aggan2207@gmail.com. This closes the gap even though `send-user-email` itself doesn't write to `sent_messages` (a pre-existing asymmetry in this codebase — SMS/WhatsApp/voice are tracked there, email never has been; not a defect introduced by this fix, flagged for awareness only). All 3 drive-test channels now have direct delivery confirmation: SMS (via `sent_messages`), self-alert fan-out (via `sent_messages`), and email (via Wael's direct inbox confirmation).

## 6. Rollback instructions

Single file, single logical change, cleanly revertible:
```
git checkout -- supabase/functions/naavi-chat/index.ts
npx supabase functions deploy naavi-chat --no-verify-jwt --project-ref xugvnfudofuskxoknhve
```
This reverts the fix, the prompt example, and the two temporary diagnostics together (all in the same file, same commit boundary once committed). If only the diagnostics need removing (fix confirmed stable, cleanup pass): manually delete the two `F15 TEMPORARY DIAGNOSTIC` blocks (search for that exact comment marker, two occurrences) and redeploy.

No DB migration, no schema change, no other Edge Function touched — rollback is a single-function redeploy with no data cleanup required (the two diagnostics only ever wrote to `client_diagnostics`, a pre-existing diagnostic-only table with no product dependency on its contents).

## 7. Known risks

- **The two temporary diagnostics are still live in production code on staging.** Low risk (fire-and-forget, `.catch(() => {})`, cannot block or alter the response even on failure) but should be removed once F15 fully closes (both defects), per Phase 1 §8's cleanup note — not yet done.
- **The recommended-tier classifier prompt example (§2.5 item 2) has not been independently tested in isolation** — it shipped in the same deploy as the required fix, and the validation run (§5) exercised both together. If a future regression appears specifically in Layer 2's recipient extraction, this example is a candidate to check, but it was not the cause of anything this session (B11 showed extraction already worked without it).
- **`resolve-recipient`/`lookup-contact` showed one transient failure during validation** (§5, step 3) — resolved on retry, root cause not investigated further (out of scope for this fix; Google API transient failures are a known class of issue, not new). If this recurs with any frequency, it deserves its own investigation — not raised as a new defect here, only noted as observed.
- **Leftover, inert Hypothesis Validation change in `anthropic_tools.ts`** (§2) — no functional risk, but is uncommitted stray diff that should be reverted before this work is committed, to keep the commit boundary clean.

## 8. Next step

Full-suite regression confirmed clean (§4: 378/381 passed, 0 failed, no regressions). Commit this change scoped to `naavi-chat/index.ts`, the new test file, and `tests/runner.ts` — explicitly excluding the unrelated `anthropic_tools.ts` and `get-naavi-prompt/index.ts` diffs noted in §2. Then §9 (actual-fire gate) before Defect B is considered closed; Defect A implementation can proceed in parallel or after, per Wael's preference.

## 9. Gate closed — Defect B fully verified (2026-07-09)

**Status: CLOSED.** Write path and fire path both confirmed. Recipient resolved → rule fired on real arrival → SMS delivered to Bob's real phone, confirmed via `sent_messages`. Email delivery confirmed at the fire level, not independently confirmed at the delivery level, per the `send-user-email`/`sent_messages` gap noted in §5.

**Phase 6 requirement, still standing, for whenever the two temporary diagnostics (§2, §7) are removed:** that removal must not be treated as a trivial no-op cleanup commit. Required evidence at that time:
```
diagnostics removed
  ↓
re-run one smoke test (e.g. "Text Bob when I arrive at [address]" once more, live)
  ↓
confirm no behavior change (same DB result shape as this Evidence Package's §5)
```
Removing a fire-and-forget diagnostic *should* be behaviorally inert, but "should be" is not evidence — per this project's own standard, it gets a one-line smoke-test confirmation before being called done, not an assumption.
