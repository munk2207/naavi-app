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

**Status: Pending.** Per governance, manual validation is mandatory for voice-touching changes regardless of automated test results. Needed: a real phone call reproducing the original B9z scenario end-to-end through the actual `naavi-voice-server` code path (not the SQL-simulated tests, which bypass STT/Claude/voice orchestration entirely) — confirm "text me at X in [time]" can be repeated on a different occasion (after the first alert is disabled) without hitting the label conflict.

Steps given to Wael, not yet completed.

---

## Outcome

*Pending Part 2. Part 1 is complete and green (accounting for pre-existing, unrelated gaps).*
