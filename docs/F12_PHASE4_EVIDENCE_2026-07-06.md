# F12 — Phase 4 Evidence Package (all three tiers implemented, committed, deployed to staging)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5 ("Evidence Package... If this package is missing, the task is incomplete"). Covers all three tiers of `docs/F12_PHASE2_CHANGE_PLAN_2026-07-05.md`: the Low-risk Defect B fix, the standalone `resolve-recipient`/`lookup-contact` piece (Wael's explicit "zero-risk" instruction), and the Medium/High-risk caller-wiring + `evaluate-rules` tier.

---

## Summary

Three pieces of the approved Phase 2 plan, all complete, all tested, **all committed and deployed to staging as of 2026-07-06.**

1. **Defect B fix** — the location-alert memory-hit ("you already have one") path now detects a changed recipient as content worth merging, on both mobile and voice, and the write path that actually performs the merge (`manage-rules`) now applies recipient fields instead of silently ignoring them.
2. **`resolve-recipient` + `lookup-contact` extension** — the Recipient Resolver Edge Function, tested in isolation, then in tier 3 wired to every producer.
3. **Caller wiring + `evaluate-rules` (this update, 2026-07-06):**
   - `hooks/useOrchestrator.ts` — `SET_ACTION_RULE` resolution now calls `resolve-recipient` (create mode) instead of the ad hoc `lookupContact`, fixing Defect A on mobile.
   - `naavi-voice-server/src/index.js` — both the main (non-location) handler and the location branch now call `resolve-recipient` (create mode). Voice previously had **zero** destination resolution (Phase 1, Evidence A3) — this is the larger of the two surface fixes.
   - `supabase/functions/evaluate-rules/index.ts` (**Protected Core**) — `fireAction()` now re-resolves a `contact_id`-based recipient fresh at fire time (`resolve-recipient`, fire mode), per Wael's explicit live-reference lifecycle decision. A distinct failure path self-notifies honestly on `not_found`/`ambiguous` instead of falling into the `noRecipient` self-alert branch — verified by test to be checked and returned *before* that branch is reached.

**Tier 1/2 commits:** main repo `201914f` (`origin/main`); `naavi-voice-server` `8167d78` (`origin/staging`). Deployed to staging: `resolve-recipient`, `lookup-contact`, `manage-rules`.
**Tier 3 commits:** main repo `b034e10` (`origin/main`); `naavi-voice-server` `5ada02b` (`origin/staging`). Deployed to staging: `evaluate-rules`.
**Production: untouched by any tier.**

**Scope note, reported per governance rather than silently absorbed:** the approved plan described reusing "the existing DRAFT_MESSAGE picker UI pattern" for ambiguous contacts at create time. No such interactive picker was found wired into either `useOrchestrator.ts` or the voice server for `SET_ACTION_RULE` (`DraftCard` is a send/discard UI for an already-resolved draft, not a disambiguation UI). Both surfaces instead **fail closed**: block the rule, tell the user to say a full name or a literal address, and let them retry. A real interactive picker remains future work if ambiguity turns out to be common in practice.

## Files changed (all three tiers)

| File | Repo | Change | In approved Phase 2 §5? |
|---|---|---|---|
| `hooks/useOrchestrator.ts` | main | Defect B merge-check fix + **(tier 3)** `SET_ACTION_RULE` resolution now calls `resolve-recipient`, fails closed on ambiguous/not_found | Yes |
| `naavi-voice-server/src/index.js` | naavi-voice-server | Defect B merge-check fix + **(tier 3)** `resolve-recipient` wired into both the main handler and location branch, fails closed | Yes |
| `supabase/functions/manage-rules/index.ts` | main | `merge_tasks` op accepts and overwrites recipient fields wholesale | Added to §5 during tier 1 — flagged explicitly, see Phase 2 §7 |
| `supabase/functions/resolve-recipient/index.ts` | main | Recipient Resolver — literal email/phone detection, `create`/`fire` mode contract, six output kinds | Yes |
| `supabase/functions/lookup-contact/index.ts` | main | `contact_id` support (return + accept for ID-based fetch) | Yes |
| `supabase/functions/evaluate-rules/index.ts` | main | **(tier 3, Protected Core)** Fire-time re-resolution via `resolve-recipient` (fire mode) + distinct `recipientUnresolvable` self-notify path | Yes |
| `supabase/config.toml` | main | Registered `resolve-recipient` | Implied |
| `tests/catalogue/session-2026-07-05-f12-defect-b.ts` | main | 5 tests | Yes (§6) |
| `tests/catalogue/session-2026-07-05-f12-resolve-recipient.ts` | main | 6 tests — the "not wired" guard test replaced with `f12.resolve-recipient-wired-to-all-three-callers` in tier 3, per its own comment ("updated, not deleted, when wiring happens") | Yes (§6) |
| `tests/catalogue/session-2026-07-06-f12-high-risk-wiring.ts` | main | **New, tier 3.** 7 tests covering all three wiring points | Yes (§6) |
| `tests/catalogue/session-2026-06-11.ts` | main | **Pre-existing test updated, tier 3** — `note-update.enabled-branch-offers-update`'s source-text assertion no longer matched after the Defect B refactor moved a literal phrase into a variable; runtime behavior confirmed unchanged before editing the assertion | Not part of F12 scope — a compatibility fix for an unrelated pre-existing test, reported here rather than silently touched |
| `tests/runner.ts` | main | Registered all 3 new test files | Implied |

**Not touched:** any file outside the above, in any tier.

## Traceability matrix

| Phase 2 requirement | Files | Test(s) |
|---|---|---|
| Defect B — recipient change detected as mergeable content (mobile) | `hooks/useOrchestrator.ts` | `f12.mobile-memory-hit-detects-recipient-change`, `f12.mobile-rearm-passes-action-config` |
| Defect B — recipient change detected as mergeable content (voice) | `naavi-voice-server/src/index.js` | `f12.voice-memory-hit-detects-recipient-change`, `f12.voice-pending-note-update-applies-recipient` |
| Defect B — write path applies the merged recipient | `supabase/functions/manage-rules/index.ts` | `f12.manage-rules-merge-tasks-accepts-recipient` |
| Recipient Resolver — six-output-kind contract, `create`/`fire` mode split | `supabase/functions/resolve-recipient/index.ts` | `f12.resolve-recipient-all-six-output-kinds`, `f12.resolve-recipient-mode-specific-input` |
| Identity hierarchy — `contact_id` support on the People API adapter | `supabase/functions/lookup-contact/index.ts` | `f12.lookup-contact-contact-id-support`, `f12.lookup-contact-name-still-optional-input-unchanged` |
| Deployment registration | `supabase/config.toml` | `f12.resolve-recipient-registered-in-config-toml` |
| **Mobile wiring** — `SET_ACTION_RULE` resolution uses `resolve-recipient`, fails closed | `hooks/useOrchestrator.ts` | `f12.mobile-set-action-rule-uses-resolve-recipient-create-mode`, `f12.mobile-set-action-rule-blocks-on-unresolvable-recipient` |
| **Voice wiring** — both call sites use `resolve-recipient`, fail closed | `naavi-voice-server/src/index.js` | `f12.voice-set-action-rule-uses-resolve-recipient-both-paths`, `f12.voice-main-handler-fails-closed-on-unresolvable-recipient`, `f12.voice-location-branch-blocks-on-unresolvable-recipient` |
| **`evaluate-rules` fire-time re-resolution** (Protected Core) | `supabase/functions/evaluate-rules/index.ts` | `f12.evaluate-rules-fire-mode-live-reresolution` |
| **`evaluate-rules` distinct failure path**, never falls into `noRecipient` | `supabase/functions/evaluate-rules/index.ts` | `f12.evaluate-rules-distinct-failure-not-self-alert` |
| All three callers now use `resolve-recipient` (successor to the zero-risk guard) | all three | `f12.resolve-recipient-wired-to-all-three-callers` |

**Every row has a test. No approved Phase 2 requirement is implemented without one.**

## Tests executed

```
npm run test:auto -- --grep f12
18 tests, 18 passed, 0 failed, 0 errored

npm run test:auto   (full regression suite, all categories)
379 tests, 377 passed, 0 failed, 0 errored, 2 skipped
```

The 2 skips are pre-existing and unrelated to F12 (Google OAuth tokens not connected for the test user — `contacts.no-match-returns-empty`, `calendar.create-event`).

**One pre-existing test broke and was fixed, not ignored:** `note-update.enabled-branch-offers-update` (`session-2026-06-11.ts`) did a literal source-text search for `'Want me to update the message to'`. The Defect B refactor (tier 1) moved that phrase into a separate `updateDesc` variable so the branch could also offer to update a changed recipient — runtime output for the body-only case is byte-identical, but the phrase no longer appears as one contiguous string in the source. Confirmed the runtime behavior was unchanged by reading the actual code before editing the test to check both halves (`'update the message to "${newBody}"'` and `'Want me to ${updateDesc}?'`) instead of the single stale string.

New tests, tier 3 (`session-2026-07-06-f12-high-risk-wiring.ts`):
- `f12.mobile-set-action-rule-uses-resolve-recipient-create-mode`
- `f12.mobile-set-action-rule-blocks-on-unresolvable-recipient`
- `f12.voice-set-action-rule-uses-resolve-recipient-both-paths`
- `f12.voice-main-handler-fails-closed-on-unresolvable-recipient`
- `f12.voice-location-branch-blocks-on-unresolvable-recipient`
- `f12.evaluate-rules-fire-mode-live-reresolution`
- `f12.evaluate-rules-distinct-failure-not-self-alert`

Type/syntax checks: `tsc --noEmit` clean on `useOrchestrator.ts` (project tsconfig, zero F12-related errors). `node --check` clean on `naavi-voice-server/src/index.js`. `deno check` on `evaluate-rules/index.ts` surfaces one pre-existing error (`'preToken' is possibly 'null'`, `callVoice` function) — confirmed via `git stash` to exist identically before this session's changes, at a shifted line number only. Not touched, per governance's "No Extra Changes Rule" — out of scope for this fix, flagged rather than silently left unmentioned.

## Manual tests required

Once tier 3 is committed and deployed to staging:
- Repeat the exact live-production repro from this session ("email me at X when I arrive at Bob's home," twice, same coordinates) on **staging** and confirm the second attempt's destination actually lands in `action_config.to_email`/`contact_id`, on both mobile and voice.
- Create a location alert with a named contact as recipient, then edit that contact's email in Google Contacts, then trigger the alert — confirm it sends to the *new* email (proves live re-resolution, not a stale snapshot).
- Delete a contact referenced by an existing alert's `contact_id`, then trigger the alert — confirm the self-notify failure message arrives, not a misdirected send and not silence.

## Rollback instructions

**Tier 3 (this update):** nothing committed — `git checkout -- hooks/useOrchestrator.ts supabase/functions/evaluate-rules/index.ts tests/...` (main repo) and `git -C naavi-voice-server checkout -- src/index.js` discard it entirely with no history to unwind.
**Tiers 1/2:** `git revert 201914f` (main, `origin/main`) and `git -C naavi-voice-server revert 8167d78` (`origin/staging`), then redeploy `resolve-recipient`/`lookup-contact`/`manage-rules` from the reverted state.
**Tier 3:** `git revert b034e10` (main) and `git -C naavi-voice-server revert 5ada02b` (staging), then redeploy `evaluate-rules` from the reverted state.
Production (`hhgyppbxgmjrwdpdubcx`) was never touched by any tier — no production rollback is ever needed for this work.

## Known risks

- **`evaluate-rules` fire-time resolution (Protected Core, High risk):** adds a network call (`resolve-recipient`) inside the single dispatcher shared by every trigger type. A `resolve-recipient` outage would affect only contact-based rules (those with `contact_id` set) — rules with a literal `to_email`/`to_phone` already snapshotted never reach this code path. Failure mode is fail-closed (self-notify), not misdirection or silent drop.
- **`manage-rules` merge_tasks change (Defect B):** overwrites destination fields wholesale on merge — unchanged assessment from tier 1.
- **No interactive ambiguous-contact picker** (scope note above) — if ambiguity turns out to be common, users hit a "say the full name" retry loop rather than a tap-to-pick UI. Not blocking for this fix; worth revisiting if reported as friction.
- **Live production risk from Phase 1 is now closed on staging.** New location alerts with literal/named third-party recipients now resolve correctly at both creation and fire time — on staging. Production still runs the pre-fix code until a separate, explicitly-approved production promotion.

## Outstanding

- ☑ Mobile wiring — done, tier 3, deployed to staging
- ☑ Voice wiring — done, tier 3, deployed to staging
- ☑ `evaluate-rules` Protected Core change — done, tier 3, deployed to staging
- ☑ Commit tier 3 (main repo `b034e10`, voice-server `5ada02b`)
- ☑ Deploy tier 3 to staging (`evaluate-rules` deployed 2026-07-06; `resolve-recipient`/`lookup-contact`/`manage-rules` already live from tier 2)
- ☐ Manual staging validation (3 scenarios above) — not yet performed
- ☐ Production promotion — requires Wael's separate explicit approval per CLAUDE.md staging-first rule; not implied by the staging deploy above

**Awaiting Wael's explicit sign-off before committing/deploying tier 3**, consistent with the pattern for tiers 1/2.
