# Session Handoff — 2026-07-15 — F17 shipped to production, Phase 7 live validation in progress, one critical deployment gap found

## Next session priority (explicit, from Wael): continue Phase 7 (live phone call validation) of F17

F17 itself (Phases 1-6, 8) is complete and deployed. Phase 7's test matrix is partially run — 3 of 7 items confirmed passing, 4 remain. One critical, unrelated deployment gap was found mid-testing (`resolve-recipient` missing from production) that blocks the next test (third-party control) and needs a decision before continuing.

---

## F17 — status: shipped to production

Full governance trail: `docs/F17_PHASE1_PROBLEM_DEFINITION_2026-07-14.md`, `docs/F17_PHASE2_CHANGE_PLAN_2026-07-14.md` (10 revisions — includes a post-Phase-6 rewrite after a deployment-dependency discovery, see below), `docs/F17_PHASE5_EVIDENCE_2026-07-14.md` (revised once, after a Phase 2 amendment for a 5th call site found mid-Phase-4).

**What shipped:** voice (`naavi-voice-server`) now has parity with mobile's F15 Defect A — a self-alert with an explicit per-channel destination override ("text me at X when I arrive at Y") is stored with a `self_override_*` field and stays classified as self, instead of being misrouted as third-party. Five write-time call sites guarded (schema + 2 creation paths + 2 update/clarification paths + 1 reactivate path with a bidirectional guard). 14 new tests, full suite 82/82 green on the deploy branch.

**Critical mid-flight discovery (post-Phase-6, before Phase 8):** while verifying which branch Railway actually deploys from (confirmed: `main`, via the Railway dashboard), found that `naavi-voice-server`'s `main` was missing 10 commits that only existed on a `staging` git branch — 3 of them (F12's `resolve-recipient`/`SET_ACTION_RULE` wiring, F12 Defect B's memory-hit merge fix, `commitLocationRule`'s address fix) were hard prerequisites for F17's own patches. Phase 2 was rewritten (§0) to document this, risk raised to High, and Phase 8's mechanics were built around bringing those 3 commits forward correctly — cherry-picked onto a fresh branch off `main` (not `staging`, to leave the other 7 unrelated F11a/pacing commits out), F17's own commit on top, full suite re-run, then pushed.

**What's now live on `naavi-voice-server`'s `main`** (pushed this session, `eb10698..aeca218`):
```
73b5847 fix: commitLocationRule was dropping resolved address from trigger_config
50df358 fix: memory-hit merge check now detects a changed recipient (F12 Defect B)
4c8a6ce fix: wire resolve-recipient into SET_ACTION_RULE (F12 tier 3)
aeca218 fix(voice): F17 - self-alert destination override parity with mobile (F15 Defect A)
```
Local `main` is synced to this; the temporary deploy branch was deleted (its commits are now permanent `main` history). `staging` branch still has 7 unrelated F11a/demo-pacing commits not on `main` — untouched, not part of this session's scope, still diverged.

## Phase 7 — live validation status

| # | Test | Status |
|---|---|---|
| 1 | Self-override email | ✅ Confirmed end-to-end — email received |
| 2 | Self-override SMS | ✅ Confirmed end-to-end — delivered correctly (initial confusion was Wael's own phone having multiple carrier profiles, one of which is the +13433332567 test number — not a bug, resolved) |
| 3 | Location-triggered self-override | ✅ Confirmed via direct DB check (no physical drive needed) — `self_override_sms` cleanly isolated, no `to`/`to_phone` contamination |
| 4 | Third-party control ("text Bob when I arrive at home") | ⬜ **Blocked** — see critical finding below |
| 5 | Plain self-alert control (no destination) | ⬜ Not yet run |
| 6 | Negative case ("email Bob at bob@example.com...") | ⬜ Not yet run |
| 7 | Existing-alert update case (call site 4) | ⬜ Not yet run |

**Test 4 is currently failing, deterministically, for a reason unrelated to F17 — see next section. Do not re-attempt it until that's resolved or explicitly deferred.**

## ⭐ Critical finding — `resolve-recipient` Edge Function is not deployed to production

While running Phase 7 test #4, "text Bob when I arrive at home" repeatedly failed with "I don't have a contact named Bob" — three times in a row, despite direct proof (`lookup-contact` called directly) that Bob resolves cleanly. Traced to the actual cause: **`resolve-recipient` — the F12 Recipient Resolver that `naavi-chat`/voice/mobile all depend on for third-party contact resolution — returns `{"code":"NOT_FOUND","message":"Requested function was not found"}` when called directly against production** (`hhgyppbxgmjrwdpdubcx`). It was never deployed there. Voice's code (correctly) calls it, gets this error shape back, and falls through to the generic "not found" speech every time — deterministic, not the Google API flakiness (B9m) it initially looked like. That earlier diagnosis in this session was wrong and was corrected once this was found.

**Impact: every third-party alert on voice (text/email to anyone by name) is currently broken in production** — not just this test, not just "Bob." This predates F17 entirely (F12 shipped 2026-07-05/06) and is unrelated to anything F17 changed — but it was discovered during F17's own Phase 7 validation and blocks test #4.

**Not yet deployed — awaiting Wael's explicit go-ahead.** Recommended action for next session: deploy `resolve-recipient` to production (`npx supabase functions deploy resolve-recipient --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx`), confirm it resolves Bob correctly via a direct curl test (same method used to diagnose it), then retry Phase 7 test #4.

## Other bugs found during F17 Phase 7 testing — flagged separately, not fixed, not blocking F17

All confirmed live, all pre-existing, all unrelated to F17's own change. Chips are up for each (dismiss if stale); full detail in each task's own write-up.

1. **`task_95ebf7ed` — SpellingBypass hijacks mid-flow alert setup.** A feature meant for spelling out a *contact name* phonetically ("spell H-E-A-G-G-A-N") has no awareness of conversation state — it intercepted an in-progress alert-setup turn when the user spelled an email address, derailing into an unrelated contact-lookup confirmation. Its "no" handler also has no clean escape hatch if `parseYesNo()` doesn't recognize the reply, causing a repeat-question loop.
2. **`task_9611da6f` — location clarification concatenates instead of replacing.** When `resolve-place` fails to find an address and the user tries to correct it with a different street name, the retry logic (`naavi-voice-server/src/index.js:10656`) glues the correction onto the *original wrong* address string instead of replacing it — so corrections always fail too.
3. **`task_28b73719` — regressed unbiased geocoding for numbered addresses (mobile + voice, shared).** This is a **regression**, not new design work — Wael requested, tested, and approved a fix for this exact problem on 2026-05-16 (full street addresses shouldn't be distance-restricted the way ambiguous place names are). It was silently removed 2026-06-25 as a side effect of fixing an unrelated bug (an overly strict postal-code-completeness gate). Needs restoring, with the actual gate fixed this time (loosen Gate 3, don't remove the whole path). **Separately confirmed during this investigation:** production's `resolve-place` Edge Function is itself a month stale (deployed before the June 25 regression even landed; staging has the newer, regressed code) — so production and staging currently fail this class of address for two *different* reasons. Both need addressing.
4. **Not yet flagged as a task — needs logging next session:** duplicate SMS send. One `evaluate-rules` fire produced two identical Twilio sends (117ms apart, same number, same body, two different SIDs) for the self-override SMS test. Not investigated further — noted, not chased, given everything else found. Should get its own `spawn_task` or holding-list entry next session.

## What did NOT change this session

No mobile app code touched. No mobile build (APK/AAB) created — explicitly discussed and rejected as unnecessary (the Bayshore-address discrepancy was fully explained by Supabase deployment staleness, not app-binary differences; see task_28b73719's write-up for the full reasoning chain). No other Edge Function deployed. `resolve-recipient`'s missing-from-production status was diagnosed, not fixed.

## State at handoff

- F17: Phases 1-6 and 8 complete, live on `naavi-voice-server` `main`/production. Phase 7: 3/7 confirmed, 1 blocked, 3 not yet attempted.
- Four separate pre-existing bugs found during Phase 7 testing, three flagged as spawn_task chips, one (duplicate SMS) still needs logging.
- `resolve-recipient` production-deployment gap is the single highest-priority item to resolve before Phase 7 can continue past test #4 — needs Wael's explicit deploy approval, not something to do unilaterally.
- No holding-list document updates made this session (`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` was not touched) — worth reconciling next session alongside the duplicate-SMS logging.

## Next session — pick up here

1. Get Wael's go-ahead to deploy `resolve-recipient` to production; deploy it; verify with a direct curl test.
2. Re-run Phase 7 test #4 (third-party control).
3. Continue tests #5, #6, #7 (plain self-alert control, negative case, existing-alert update case) — each documented with expected DB state in `docs/F17_PHASE2_CHANGE_PLAN_2026-07-14.md` §6 / `docs/F17_PHASE5_EVIDENCE_2026-07-14.md` §5.
4. Log the duplicate-SMS-send bug as its own tracked item.
5. Update `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` and memory once Phase 7 fully closes.
