# F19 — Phase 5: Evidence Package (Track A)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5. Covers Track A only (`docs/F19_PHASE2_CHANGE_PLAN_2026-07-15.md`), approved at Phase 3 by ChatGPT (two review rounds, final verdict: approve). Track B (1c/1d/1e) and Track C (mobile promotion, 1f) are unaffected and remain open — see that document's §4/§5.

---

## Summary

Production was behind staging on two Edge Functions (`report-location-event`, `get-naavi-prompt`) and missing a third entirely (`resolve-recipient`), all traced to F19 Phase 1. Three deploys were made to production in the planned order, each verified live before the next proceeded, using two temporary test rows created and removed by Wael directly in the production SQL editor. No rollback was needed — every verification passed on the first attempt.

---

## Files changed

| File | Action | Commit |
|---|---|---|
| `supabase/functions/report-location-event/index.ts` | Committed (was uncommitted since 2026-06-27) + deployed to production | `a13b07c` |
| `supabase/functions/get-naavi-prompt/index.ts` | Committed (was uncommitted since 2026-07-03) + deployed to production | `a13b07c` |
| `supabase/functions/_shared/anthropic_tools.ts` | Committed only — no deploy needed (confirmed already byte-identical on production via `naavi-chat`'s last deploy, Phase 2 §0) | `a13b07c` |
| `supabase/functions/resolve-recipient/*` | Deployed to production for the first time (new function, zero prior existence there) | N/A — deploy only, no local diff |

Full diff: `git show a13b07c`.

---

## Tests executed

**Deployment 1 — `resolve-recipient`:**
- `npx supabase functions list --project-ref hhgyppbxgmjrwdpdubcx` confirms the function is now `ACTIVE` (previously absent from all 71 listed functions).
- Live call with a known contact name ("Bob") against Wael's real `user_id` returned `{"kind":"resolved_contact","name":"Bob","email":"aggan2207@gmail.com","phone":"+13433332567"}`, HTTP 200 — correct, well-formed response from the real code path (not a 404 stub).

**Deployment 2 — `report-location-event`:**
- Two temporary `action_rules` rows created directly by Wael via the production Supabase SQL editor (not by me — I have no production DB write credentials, by design; this itself is a positive governance signal, not a gap).
  - Test 1 (`self_override_email: whwh2207@gmail.com`) fired via direct call to the deployed function (`{"ok":true,"fired":true}`). Wael confirmed: the test email arrived **only** at whwh2207@gmail.com (not his own personal inbox), and his own phone received SMS/push/voice as normal — exactly the designed channel-scoped override behavior.
  - Test 2 (no override, plain self-alert) fired the same way. Wael confirmed his own email/SMS/voice all received it as a normal self-alert baseline (push not separately checked — unaffected by this change, since `callPush()` is unconditional in both branches, confirmed by direct code read).
  - Both test rows deleted by Wael afterward (`DELETE FROM action_rules WHERE label LIKE 'F19 TEST%'`).

**Deployment 3 — `get-naavi-prompt`:**
- Direct fetch of the deployed prompt confirms `version` field = `2026-07-05-v133b-revert-schema-impossible-to_email` (matching the new commit, not the stale `2026-07-02-v132...` that was live before), and prompt body contains both `self_override` and `set_location_rule_chain` content.
- Live reproduction: sent `"Email me at whwh2207@gmail.com in 3 minutes saying test"` directly to production `naavi-chat` (using Wael's `user_id`, no JWT — this endpoint accepts `user_id` in the body per its multi-user design). Response correctly emitted a `SET_ACTION_RULE` pending intent with `action_config: {"body":"test","self_override_email":"whwh2207@gmail.com"}` — not a `draft_message` call, and no stray `to`/`to_email`. The response was a confirmation question ("Say yes to confirm") — never confirmed, so **no row was created**; this was a read-only verification of Claude's tool-call emission, not a state change.

---

## Manual tests required

None outstanding for Track A — all three deployments were verified live per the plan in `F19_PHASE2_CHANGE_PLAN_2026-07-15.md` §3 before proceeding to the next.

---

## Rollback instructions

Not exercised — no deployment failed verification. For reference, pre-deploy production snapshots were saved to `C:\Users\waela\naavi-f19-rollback\` before either overwrite (`report-location-event.PRE-DEPLOY-2026-07-15.ts`, `get-naavi-prompt.PRE-DEPLOY-2026-07-15.ts`). If a problem surfaces later, redeploying those files restores the exact prior production behavior.

---

## Deployment summary

Added per Phase 6 review feedback — everything below was already stated in prose above; this table exists purely to make it checkable at a glance.

| Deployment | Planned (Phase 2) | Verified (this doc) | Rollback needed |
|---|---|---|---|
| `resolve-recipient` | ✅ | ✅ | No |
| `report-location-event` | ✅ | ✅ | No |
| `get-naavi-prompt` | ✅ | ✅ | No |

## Known risks / what's still open

- **Track B (1c, 1d, 1e)** — voice recipient-name capture, self/third-party misclassification, and voice SMS confirmation-loop/digit-capture are unchanged by this work and remain open, each needing its own Phase 1 investigation per Phase 2 §4.
- **Track C (1f)** — mobile production promotion (build 307/308) is now unblocked from a dependency standpoint (`resolve-recipient` and `report-location-event` both live on production), but has not been started. Per Phase 1 §4, this should not proceed until F17's frozen Phase 7 test matrix is explicitly re-run and passes under current production conditions.
- ~~Local commit not yet pushed to GitHub~~ — **resolved 2026-07-15, same day.** Commit `a13b07c` pushed to `origin/main`; `git fetch` + `git rev-parse main` vs `origin/main` confirmed byte-identical SHAs. Per Phase 6 review, this was elevated from a recommendation to a required close-out step before starting any other implementation work, since leaving deployed-but-uncommitted code on a local machine — even briefly — recreates a smaller instance of the exact drift class F19 exists to fix. The integrity loop is now closed: repository, staging, and production all reflect the same code for these three files.

---

## Next step

Phase 6 (Technical Review, After Coding) is complete — see `docs/F19_PHASE6_TECHNICAL_REVIEW_2026-07-15.md`. Track A is fully closed. Wael has elected not to add an additional monitoring window (2026-07-15).
