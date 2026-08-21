# sync-epic-data — EMPTY ON PURPOSE, AND NEVER BUILT

**There is no code here, and there never was.** This folder is not a
work-in-progress and not a deployment that failed — the function was designed
and never written.

It was meant to pull health data from Epic on a schedule. No cron job
references it on either project, so nothing has ever attempted to call it.

Epic as a whole was never built: no user interface, no working server side, and
the only data anywhere is 12 rows of sandbox test data on production under a
placeholder user id, from a token that expired an hour after it was issued on
24 March 2026.

This README exists because an empty folder communicates nothing. Its emptiness
was repeatedly read as "trialled and postponed" rather than "never started",
which is why Epic kept resurfacing as though it were an open question.

**Do not delete this folder** — Wael's decision, 2026-08-21: Epic code is kept
for a possible future effort, not removed. See `lib/epic.ts` and
`docs/T8_PHASE0_INTENT_2026-08-21.md`.
