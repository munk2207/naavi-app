# F12 — Phase 4 Evidence Package (partial — two tiers complete)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5 ("Evidence Package... If this package is missing, the task is incomplete"). Covers the two tiers of `docs/F12_PHASE2_CHANGE_PLAN_2026-07-05.md` completed so far: the Low-risk Defect B fix, and the standalone `resolve-recipient`/`lookup-contact` piece (Wael's explicit "zero-risk" instruction, 2026-07-05/06). The Medium/High-risk tier (caller wiring, `evaluate-rules`) is **not** covered here because it has not been implemented.

---

## Summary

Two independent pieces of the approved Phase 2 plan, both complete, both tested, **neither committed nor deployed**:

1. **Defect B fix** — the location-alert memory-hit ("you already have one") path now detects a changed recipient as content worth merging, on both mobile and voice, and the write path that actually performs the merge (`manage-rules`) now applies recipient fields instead of silently ignoring them.
2. **`resolve-recipient` + `lookup-contact` extension** — the new Recipient Resolver Edge Function exists and is tested in isolation. `lookup-contact` gained `contact_id` support (both returning it and accepting it for ID-based re-lookup). **Deliberately not wired to any caller** — mobile, voice, and `evaluate-rules` are unchanged in their actual resolution behavior.

## Files changed

| File | Repo | Change | In approved Phase 2 §5? |
|---|---|---|---|
| `hooks/useOrchestrator.ts` | main | Defect B: `hasNewContent` now detects `recipientChanged`; fixed missing 3rd arg to `reArmLocationRule` | Yes |
| `naavi-voice-server/src/index.js` | naavi-voice-server | Defect B: enabled-branch check now detects `recipientChanged`; `pendingNoteUpdate` consumption applies the new recipient fields | Yes |
| `supabase/functions/manage-rules/index.ts` | main | `merge_tasks` op accepts and overwrites `to`/`to_name`/`to_email`/`to_phone` wholesale | **Added to §5 during this pass — flagged explicitly, see Phase 2 §7** |
| `supabase/functions/resolve-recipient/index.ts` | main | **New file.** Recipient Resolver — literal email/phone detection, `create`/`fire` mode contract, six output kinds | Yes |
| `supabase/functions/lookup-contact/index.ts` | main | Added `contact_id` to returned shape; accepts `contact_id` as an alternative to `name` for direct ID-based fetch | Yes |
| `supabase/config.toml` | main | Registered `resolve-recipient` (`verify_jwt = false`, matching `lookup-contact`) | Implied by the new-file row |
| `tests/catalogue/session-2026-07-05-f12-defect-b.ts` | main | New — 5 tests | Yes (§6) |
| `tests/catalogue/session-2026-07-05-f12-resolve-recipient.ts` | main | New — 6 tests, including a guard that fails if `resolve-recipient` gets wired to a caller without updating this test | Yes (§6) |
| `tests/runner.ts` | main | Registered both new test files | Implied |

**Not touched:** `supabase/functions/evaluate-rules/index.ts` (High risk, not started), any file outside the above.

## Traceability matrix

Every approved Phase 2 requirement covered by this evidence package, mapped to its implementation and its verification — so each item's status is auditable in one place rather than reconstructed from prose.

| Phase 2 requirement | Files | Test(s) |
|---|---|---|
| Defect B — recipient change detected as mergeable content (mobile) | `hooks/useOrchestrator.ts` | `f12.mobile-memory-hit-detects-recipient-change`, `f12.mobile-rearm-passes-action-config` |
| Defect B — recipient change detected as mergeable content (voice) | `naavi-voice-server/src/index.js` | `f12.voice-memory-hit-detects-recipient-change`, `f12.voice-pending-note-update-applies-recipient` |
| Defect B — write path applies the merged recipient (added to §5 this pass) | `supabase/functions/manage-rules/index.ts` | `f12.manage-rules-merge-tasks-accepts-recipient` |
| Recipient Resolver — six-output-kind contract, `create`/`fire` mode split | `supabase/functions/resolve-recipient/index.ts` | `f12.resolve-recipient-all-six-output-kinds`, `f12.resolve-recipient-mode-specific-input` |
| Recipient Resolver — deliberately unwired (zero-risk instruction) | *(guard, no production file)* | `f12.resolve-recipient-not-wired-to-any-caller` |
| Identity hierarchy — `contact_id` support added to the People API adapter | `supabase/functions/lookup-contact/index.ts` | `f12.lookup-contact-contact-id-support`, `f12.lookup-contact-name-still-optional-input-unchanged` |
| Deployment registration | `supabase/config.toml` | `f12.resolve-recipient-registered-in-config-toml` |
| **Not yet implemented** | `supabase/functions/evaluate-rules/index.ts`, caller wiring in `useOrchestrator.ts`/`naavi-voice-server` | *(none — no code exists yet)* |

## Git diff (stat)

```
main repo:
 hooks/useOrchestrator.ts                    | 54 +++++++++++++++++++++++-------
 supabase/config.toml                        |  3 ++
 supabase/functions/lookup-contact/index.ts  | 54 +++++++++++++++++++++++++++---
 supabase/functions/manage-rules/index.ts    | 16 ++++++++-
 4 files changed, 109 insertions(+), 18 deletions(-)
 (plus 2 new test files + resolve-recipient/index.ts, new/untracked)

naavi-voice-server repo:
 src/index.js | 51 +++++++++++++++++++++++++++++++++++++++++++++------
 1 file changed, 45 insertions(+), 6 deletions(-)
```

Full diffs available via `git diff` in each repo — nothing has been committed, so this is the complete working-tree change.

## Tests executed

```
npm run test:auto -- --grep f12
11 tests, 11 passed, 0 failed, 0 errored
```

Explicitly including `manage-rules` per this evidence package's requirement:
- `f12.manage-rules-merge-tasks-accepts-recipient` — **PASS** (`session-2026-07-05-f12-defect-b.ts`) — confirms the `MergeTasksRequest` interface declares the recipient fields and the handler overwrites them wholesale when `to` is provided.

Full list (all passing):
- `f12.mobile-memory-hit-detects-recipient-change`
- `f12.mobile-rearm-passes-action-config`
- `f12.voice-memory-hit-detects-recipient-change`
- `f12.voice-pending-note-update-applies-recipient`
- `f12.manage-rules-merge-tasks-accepts-recipient`
- `f12.resolve-recipient-all-six-output-kinds`
- `f12.resolve-recipient-mode-specific-input`
- `f12.resolve-recipient-not-wired-to-any-caller`
- `f12.lookup-contact-contact-id-support`
- `f12.lookup-contact-name-still-optional-input-unchanged`
- `f12.resolve-recipient-registered-in-config-toml`

Type/syntax checks: `tsc --noEmit` clean on `useOrchestrator.ts` (project tsconfig); `node --check` clean on `naavi-voice-server/src/index.js`; `deno check` clean on `manage-rules/index.ts`, `lookup-contact/index.ts`, `resolve-recipient/index.ts`.

## Manual tests required

None yet — nothing is deployed or wired to a live caller. Once committed and deployed to staging:
- Defect B: repeat the "email me at X when I arrive at Y" twice at the same coordinates test (the exact repro from the live production call this session) and confirm the second attempt's destination actually lands in `action_config`, on both mobile and voice.
- `resolve-recipient`: no manual test needed yet — it's unreachable by any real user flow until wired.

## Rollback instructions

Nothing is committed, so rollback is trivial: `git checkout -- <file>` (main repo) / `git -C naavi-voice-server checkout -- src/index.js` discards all of the above with no history to unwind. Once committed: each tier is an independent, revertable commit (Defect B fix; `resolve-recipient` addition) — the latter is inert (unwired) so reverting it has zero behavioral impact; the former touches live merge logic and should be reverted with a new commit, not a force-push, if ever needed.

## Known risks

- **`manage-rules` merge_tasks change (Defect B):** overwrites destination fields wholesale on merge. If a future caller ever wanted additive (not replacing) recipient behavior, this would need revisiting — not anticipated by any current use case.
- **`resolve-recipient`/`lookup-contact`:** zero risk as shipped — unreachable by any existing flow. Risk is deferred to the (not-yet-done) wiring step.
- **Outstanding from Phase 1:** the live "Arrive at Parliament Street" production rule was disabled this session but the underlying bug it demonstrated (Defect A) is not yet fixed — `evaluate-rules` still has no fire-time resolution step. Any new location alert with a literal/named third-party recipient created between now and the completion of the High-risk tier will have the same live misdirection risk.

## Outstanding (not implemented — not a checklist of this package's claims, a map of what's left)

- ☐ Mobile wiring — replace `useOrchestrator.ts`'s inline `lookupContact` call with `resolve-recipient`
- ☐ Voice wiring — replace the absent resolution step in `naavi-voice-server`'s `SET_ACTION_RULE` handling with `resolve-recipient`
- ☐ `evaluate-rules` Protected Core change — fire-time re-resolution, `not_found`/`ambiguous` failure path
- ☐ Manual staging validation (once the above are committed and deployed)
- ☐ Production promotion (only after staging validation and explicit approval, per CLAUDE.md staging-first rule)

This section exists so anyone reading this package can tell "implemented" from "still outstanding" at a glance, without inferring it from the rest of the document.
