# B10q — Phase 2: Change Planning

**Date:** 2026-07-21
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.6, Phase 2
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4

No code written in producing this document.

---

## Design decision: duplicate the validation independently on both surfaces, not a shared cross-repo module

Per Phase 1A, "Action Rules — creation (the classifier)" is a **Duplicated, two independent implementations** capability, already accepted as an Architecture Exception (`docs/adr/0001-action-rules-classifier-duplication-accepted.md`). Mobile/Shared-Core (`naavi-app`) and Voice (`naavi-voice-server`) are separate repos, separate runtimes (Deno Edge Functions vs. Node.js on Railway) — there is no existing mechanism to share a literal code module between them (unlike `_shared/*.ts`, which only shares across Edge Functions within the `naavi-app` repo).

**Decision: implement the same validation rule independently in both places**, matching the existing accepted duplication pattern rather than introducing a new cross-repo sharing mechanism to avoid it. Per the Mandatory Architecture Impact Checklist below, this does not introduce *new* duplication — it adds matching logic to an already-duplicated capability, which is the documented, accepted shape of this part of the system.

**Why not a shared module within `naavi-app` at least (for `manage-rules` + `naavi-chat`'s two `op:'create'` callers)?** Not needed — both `naavi-chat` callers funnel through `manage-rules` before reaching the database (confirmed by trace in "Regression Matrix" below), so `manage-rules` alone is the single mobile/Shared-Core chokepoint. No duplication exists to eliminate on that side.

---

## Files that will change

| File | Repo | Classification | Change |
|---|---|---|---|
| `supabase/functions/manage-rules/index.ts` | `naavi-app` | Backend | Add validation to the `op:'create'` handler: when `trigger_type === 'email'` and `trigger_config` has none of `from_name`/`from_email`/`subject_keyword`, reject the insert and return a structured, machine-readable error (e.g. `{error: 'email_alert_unscoped'}`) instead of writing the row. Scoped strictly to `trigger_type === 'email'` — every other trigger type's `create` behavior is unchanged. |
| `supabase/functions/naavi-chat/index.ts` | `naavi-app` | Backend | Two changes: (1) the pending-confirmation commit handler (~line 2420-2472) must recognize `email_alert_unscoped` from `manage-rules`'s response and speak the agreed decline wording instead of the generic "I had trouble saving that alert — please try again." (2) The existing Layer-2-classifier check (`:1851`) stays as-is (already correct) but its `missingParam` wording should be reconciled with the newly-agreed exact decline phrasing so both surfaces say the same thing, not two different near-equivalent sentences. |
| `naavi-voice-server/src/index.js` | `naavi-voice-server` | Backend (Voice entry point) | Two changes: (1) `SET_EMAIL_ALERT` case inside `executeAction` (~line 4627-4668): add the identical validation (reject if `trigger_config` would be empty), return `{success: false, error: 'email_alert_unscoped'}` instead of performing the insert. (2) Fix the adjacent label bug on the same lines — `Emails with "${action.subjectKeyword}" in subject` when `subjectKeyword` is also absent currently produces `Emails with "undefined" in subject`; becomes unreachable once the request is rejected before a label is ever built, but confirm this explicitly as part of implementation rather than leaving it as an assumed side-effect. |
| `naavi-voice-server/src/index.js` (speech surfacing) | `naavi-voice-server` | Backend (Voice entry point) | The primary single-action speech path (~line 3915-3936, `ACTION_DEFAULT_SPEECH` map) does **not** check `executeAction`'s result at all for `SET_EMAIL_ALERT` — it falls through to the generic `'Done.'` default regardless of success or failure. This must be changed so a `{error: 'email_alert_unscoped'}` result overrides the default and speaks the agreed decline wording. The multi-action queue path (~line 9818-9835) already checks `result?.error` but only surfaces a generic `"That one failed — I'll move on."` — decision needed on whether to special-case `email_alert_unscoped` there too or accept the generic message for the compound-request case (see "Deferred decision" below). |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | `naavi-app` | Docs | Close-out entry once shipped, on both surfaces. |
| New test file, `tests/catalogue/session-2026-07-21-b10q-email-alert-validation.ts` | `naavi-app` | Test infra | Regression tests per Rule 15a — see "Tests" below. |

**Deferred decision, not resolved in this plan:** should the multi-action queue caller (voice, compound requests like "remind me to X and alert me on emails") get the specific decline wording, or is the existing generic "That one failed — I'll move on" acceptable there? Recommend deferring to Phase 3 review or Wael's direct call — it's a narrower, lower-frequency path (compound requests specifically containing an unscoped email-alert clause) and doesn't block the primary fix.

**One-time cleanup (§1 item 5, both Phase 1 documents):** no code change — a one-time query against production `action_rules` for `trigger_type='email' AND enabled=true` with empty `trigger_config`. Per Phase 1 §2, this currently returns zero rows, so the cleanup is confirmatory (documenting that nothing needs disabling today), not a required data migration. Re-run at Phase 5 (Evidence) to confirm the finding still holds immediately before this ships.

---

## Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | No | Mobile has no independent email-alert-creation path of its own (confirmed Phase 1A §3) — it routes through the Shared-Core files listed above. No mobile-native (`app/`, `hooks/`) file changes beyond what's already covered under Shared Core. |
| Voice | **Yes** | `naavi-voice-server/src/index.js` — `SET_EMAIL_ALERT` case and its speech-surfacing call site, per "Files that will change" above. This is the duplicated implementation Phase 1A found. |
| Shared Core | **Yes** | `manage-rules/index.ts` (validation) and `naavi-chat/index.ts` (decline-speech surfacing for the commit path). |
| Database | No | No schema change, no migration. The fix is application-level validation before an insert, not a constraint. (A DB-level `CHECK` constraint requiring non-empty `trigger_config` for `trigger_type='email'` was considered and rejected for this pass — see "Alternatives" in Phase 1 §4's spirit: a DB constraint can't produce a friendly spoken decline message, only a hard failure, and both surfaces need the specific wording, not a generic DB error.) |
| Cron | No | `evaluate-rules`'s matching logic (`:299-303`) is unchanged — the fix prevents the unscoped row from ever being written, it doesn't change how an (now impossible) unscoped row would be matched. |
| API contracts | **Yes** | `manage-rules`'s `op:'create'` response gains a new possible error shape (`{error: 'email_alert_unscoped'}`) for this one case. `naavi-voice-server`'s `executeAction` gains the same shape for its `SET_EMAIL_ALERT` case. Both are additive (existing success/other-error shapes unchanged) — no existing consumer's handling of a *different* error breaks. |
| Tests | **Yes** | New regression tests, per Rule 15a — see "Tests" below. |

**Duplicated capability — both implementations change, confirmed explicitly:** yes, both `manage-rules` (mobile/Shared-Core) and `SET_EMAIL_ALERT` (voice) change, independently, with the same validation rule. Neither is excluded — per Phase 1A, excluding either would leave the exact gap this investigation exists to close.

---

## Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** Yes — `manage-rules/index.ts` and `naavi-chat/index.ts`.
- **Does this change modify an Entry Point (mobile or voice translating logic, rather than Shared Core)?** Yes — `naavi-voice-server/src/index.js`, voice's own translating/entry-point logic (per Architecture Reference §3, voice's alert-creation classifier and reasoning loop is explicitly named as voice-owned entry-point logic, not Shared Core).
- **Does this change introduce new duplication?** No — it adds matching validation logic to a capability already documented and accepted as duplicated (ADR 0001). No new independent implementation is created; no previously-shared logic is split into two.
- **Does this change eliminate existing duplication?** No — the two implementations remain independent, as accepted by ADR 0001. This plan does not attempt unification.
- **Does this change modify Protected Core?** Yes — Action Rules, per Architecture Reference §4 line 119, confirmed in both Phase 1 documents.

---

## Regression Impact

- **Voice commands:** Affected, narrowly — only the `SET_EMAIL_ALERT` action and any compound request containing it. All other voice commands (contacts, calendar, lists, other `SET_ACTION_RULE` trigger types, etc.) are untouched — confirmed by scope of the code changes (a single `case` block and its speech-surfacing call site).
- **Geofencing:** Not affected — no location-trigger code touched.
- **Gmail integration:** Not affected at the sync/read layer (`sync-gmail`, `harvest-attachment`, live Gmail reads) — this change is entirely at the alert-creation layer built on top of Gmail data, not the Gmail integration itself.
- **Calendar integration:** Not affected — no calendar-trigger or calendar-read code touched.
- **Reminders:** Not affected — `reminders` table and `check-reminders` untouched; this is `action_rules`-only.
- **SMS / call alerts:** Not affected for any *other* trigger type. For `trigger_type='email'` specifically, the change is the entire point — an unscoped rule can no longer be created, so it can no longer fire an SMS/call alert per received email.
- **Onboarding:** Not affected — no onboarding-flow code touched.
- **Staging build:** Not affected structurally — this ships as an Edge Function deploy (mobile side) + a Railway deploy (voice side), no AAB/APK build required for either half of the fix (per CLAUDE.md's Two-Phase Build Process, this is Shared Core + voice server work, not client code).

---

## Regression Matrix (per-change consumer trace)

**`manage-rules`'s `op:'create'` handler** — found by searching, not recalled: exactly **two** callers in the entire codebase (`grep -rln "manage-rules"` across `hooks/`, `app/`, `supabase/functions/`, `naavi-voice-server/src/` narrowed to `op:\s*'create'` specifically):
1. `hooks/useOrchestrator.ts:4196-4198` — mobile's own direct-insert path for non-location `SET_ACTION_RULE` actions (time, weather, calendar, contact_silence triggers, per its own comment). Regression check: this caller creates rules for trigger types **other than** `email` in its typical use (location alerts have their own separate path per CLAUDE.md's Rule Store section) — confirmed the new validation is scoped to `trigger_type === 'email'` only, so this caller's behavior for every other trigger type is unaffected. If this caller can also create `trigger_type='email'` rules, it inherits the same fix automatically (desired) — not yet independently confirmed whether it does; flagged for Phase 4 to check directly rather than assumed either way.
2. `supabase/functions/naavi-chat/index.ts:2442-2472` — the shared pending-confirmation commit handler both Layer 2 (classifier) and Path B (Claude tool-use) funnel through after a "yes." Confirmed by direct read: this handler already inspects `manage-rules`'s response for `_mrData.error` (line 2464) — the new error shape slots into an existing branch, not a new one, but the *speech* for that branch (line 2465-2466) needs the new specific wording rather than the current generic fallback, per "Files that will change" above.

No other caller of `manage-rules` uses `op:'create'` — `app/alerts.tsx` and `naavi-chat/intentHandlers.ts` were checked directly and use other ops (list/update/delete for the Alerts screen), and voice's nine `manage-rules` call sites were checked directly and use `op: verify/list/set/delete/reactivate` exclusively, never `create` (voice creates rules via its own direct-insert paths instead — confirming Phase 1A's finding that voice's creation path is genuinely independent, not a hidden caller of this same chokepoint).

**`executeAction`'s `SET_EMAIL_ALERT` case (voice)** — found by searching: `executeAction` is called from 5 sites (`naavi-voice-server/src/index.js:3821, 9828, 11053, 11184`, plus the primary single-action confirm-and-execute path). Traced individually:
- Line 3821 (`LIST_CONNECTION_QUERY` inline handler) — only ever passes a `LIST_CONNECTION_QUERY` action; cannot reach the `SET_EMAIL_ALERT` case. Not affected.
- Line 11053 (`LIST_READ` inline handler) — only ever passes `LIST_READ`. Not affected.
- Line 11184 (`GLOBAL_SEARCH` inline handler) — only ever passes `GLOBAL_SEARCH`. Not affected.
- Line 9828 (multi-action queue) — generic dispatcher, **can** reach `SET_EMAIL_ALERT`; already checks `result?.error` but surfaces a generic message (see "Deferred decision" above).
- The primary single-action path (`ACTION_DEFAULT_SPEECH`, ~line 3915-3936) — generic dispatcher, **can** reach `SET_EMAIL_ALERT`; confirmed by direct read to **not check the execution result at all** for this path today — this is the main gap this plan closes on the voice side.

Confirmed separately: `actionRuleGate.shouldGateAction` (the confirm-gate mechanism B10b's fix touches) only gates `action.type === 'SET_ACTION_RULE' && action.trigger_type === 'time'` (`action_rule_confirm_gate.js:36-37`) — `SET_EMAIL_ALERT` never passes through this gate at all, confirmed by direct read, not assumed from B10b's similar-sounding scope.

---

## Tests

Per Rule 15a, new regression tests required before this is considered done, covering both surfaces:

1. **Mobile/Shared-Core:** `manage-rules` rejects `op:'create'` with `trigger_type:'email'` and empty `trigger_config` — positive control (rejection happens) and negative control (a rule with `from_name` or `subject_keyword` set still creates successfully, proving the fix doesn't over-block).
2. **Mobile/Shared-Core:** `naavi-chat`'s commit handler speaks the exact agreed decline wording (not the generic fallback) when `manage-rules` returns `email_alert_unscoped`.
3. **Voice:** `SET_EMAIL_ALERT` rejects an empty-filter request the same way — same positive/negative control shape as #1.
4. **Voice:** the primary single-action speech path speaks the decline wording for a rejected `SET_EMAIL_ALERT`, not the `'Done.'` default.
5. **Both surfaces:** the label bug (`Emails with "undefined" in subject`) is either unreachable (confirmed by test — request is rejected before the label is built) or fixed directly, whichever the implementation lands on.

---

## Risk classification

**Medium.** Touches Protected Core (Action Rules) on two independent codebases and changes real user-facing behavior (a previously-silent-success case now visibly declines) — not Low. Not High: the change is purely additive validation (reject-before-write), does not alter any existing successful path's behavior for a properly-scoped request (confirmed by the negative-control tests above), has a small, well-traced blast radius (two call sites on the Shared-Core side, a handful of call sites on voice, all individually confirmed above rather than assumed), and no schema/migration risk. Per Governance, Medium/High risk requires Phase 3 (Technical Review Before Coding).

---

## Status and next steps

Phase 2 complete. Per the Phase-Gate Approval Rule, this requires your explicit separate go-ahead before Phase 3 (Technical Review Before Coding, required for Medium risk) begins.
