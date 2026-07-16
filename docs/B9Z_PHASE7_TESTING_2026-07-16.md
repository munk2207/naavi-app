# B9z — Phase 7: Testing

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 7: "Existing automated testing continues unchanged. Manual validation remains mandatory for features such as Voice... Passing automated tests alone is not sufficient." Written after the fact — Phase 6 declared B9z closed before this phase ran, which was premature; this document supersedes that closure until both parts below are done.

---

## Part 1 — Automated testing (`npm run test:auto`)

**Run 1 (2026-07-16T05:41:57Z)** — already existed on disk before this phase began, predates the Phase 7 test additions to `tests/catalogue/data-integrity.ts`. 420 tests, 413 passed, 5 errored, 2 skipped. One of the 5 errors was a real bug in a new B9z test itself (below), the other 4 were pre-existing and unrelated.

**Bug found and fixed:** `integrity.action-rules-label-unique-different-label-allowed` errored with `duplicate key value violates unique constraint "action_rules_unique_enabled_time"` — not the constraint the test was meant to isolate. Root cause: the test's two rows shared the identical `trigger_config.datetime`, so they collided on the *separate* `action_rules_unique_enabled_time` constraint (keyed on `(user_id, datetime)` only) before the label constraint was ever the deciding factor. The sibling test `active-blocks-duplicate` had the same latent flaw — it passed, but for the wrong reason, since it couldn't actually prove *which* constraint rejected the duplicate. Both fixed to use distinct datetimes per row; `active-blocks-duplicate`'s assertion tightened to check for the specific constraint name (`action_rules_user_label_unique`) in the rejection body, so it can no longer pass for the wrong reason. Commit `b044d1c`.

**Run 2 (2026-07-16T05:49:55Z)** — `--grep integrity` only, after the fix: **8/8 passed**, including all 4 B9z tests.

**Run 3 (2026-07-16T05:50:43Z)** — full suite, after the fix:

| Result | Count |
|---|---|
| Passed | 414 |
| Failed | 0 |
| Errored | 4 |
| Skipped | 2 |
| **Total** | **420** |

**The 4 errors — confirmed pre-existing and unrelated to B9z:**
- `b6d.prompt-version-bumped-to-v98` / `session-2026-05-28.b6d-prompt-version-v100` — both assert an old prompt version string (`2026-07-02-v132-...`); the actual deployed prompt has since moved to a newer version (`2026-07-05-v133b-...`). Stale test assertions, not a regression.
- `voice.calendar-today-query` — asserts a specific response shape for a calendar query; the actual response ("You have two events coming up...") looks correct and reasonable, just doesn't match the test's exact expected pattern. Unrelated to `action_rules`.
- `f10a.website-nav-feedback-link-homepage-only` — website nav test, unrelated to backend/database work entirely.

None of these touch `action_rules`, `naavi-voice-server`'s confirm-gate, or anything B9z changed. Not fixed as part of this ticket — out of scope, matching this project's standing discipline (fix only what's proven, don't opportunistically expand).

**The 2 skips — confirmed pre-existing, unrelated:** Google OAuth not connected for the test user (`contacts.no-match-returns-empty`, `calendar.create-event`) — an environment setup gap, not a code issue.

---

## Part 2 — Manual validation (voice)

**Status: Complete — PASSED.** Two real calls placed by Wael to production voice (2026-07-16), traced via Railway logs and direct DB reads.

**Call 1 (~01:55 EDT):** "text 3433332567 in 3 minutes" → confirm-gate correctly caught the "yes" and executed exactly once — `[Process] Action rule confirm — executing SET_ACTION_RULE` (single occurrence) → `status 201` (success). Row `fdabf556-...` created, later fired and auto-disabled as expected. **Found along the way, not a B9z defect:** the phone number captured was `23433332456` instead of `3433332567` — a digit-capture error matching the separate, already-tracked, still-open [[B9y]] ticket. Logged there, not fixed under B9z.

**Call 2 (~02:19 EDT), same phrasing, repeated deliberately:** confirm-gate again executed exactly once, this time with the **correct** phone number — `[Action] SET_ACTION_RULE "SMS to 343-333-2567 in 3 minutes" — status 201`. Row `594ede24-...` created cleanly. Confirms B9y's digit-capture issue is intermittent (as its own ticket already documents), not something this call introduced, and confirms the confirm-gate is stable across repeated real-world use, not just a single lucky run.

**Also found, not a B9z defect:** immediately after Call 2's SMS fired, Railway logs show a `/speak-alert` voice call also placed to Wael's own phone (`[prepare-alert]` → `[Voice] /speak-alert`). Traced to `evaluate-rules/index.ts`'s documented 5-channel self-alert fan-out (`CLAUDE.md` "Alert Fan-Out" design): `self_override_sms` being set makes the rule `isSelfAlert = true`, which fans out to all 5 channels by default. `self_override_sms` only redirects the *SMS* leg to the override number — the other 4 channels (including voice call) still target Wael's own registered contact info, by design. Not a bug, not in scope for this ticket — surfaced for awareness since it produced a confusing result (asked for SMS-only, also got a call) but not investigated further here.

---

## Outcome

**Both parts complete.** Part 1 (automated) green, accounting for pre-existing unrelated gaps. Part 2 (manual voice) passed on two independent real calls, confirming the confirm-gate fix is stable through the actual production code path. B9z is closed.
