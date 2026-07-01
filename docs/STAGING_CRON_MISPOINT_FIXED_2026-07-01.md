# Staging cron mis-pointing at production — Fixed and Verified (2026-07-01)

Companion to `docs/STAGING_CRON_MISPOINT_PHASE2_2026-07-01.md` (Phase 2 plan, ChatGPT-approved with 5 required verification steps) and `docs/staging_cron_snapshot_2026-07-01_before_fix.json` (pre-fix audit snapshot).

## What was wrong

All 10 of staging's `cron.job` rows called production's URL (`hhgyppbxgmjrwdpdubcx.supabase.co`) with a production-scoped JWT, instead of staging's own (`xugvnfudofuskxoknhve.supabase.co`). Root cause: the shared migration files that create these jobs hardcode one literal URL with no per-environment awareness. Confirmed via direct query against staging Postgres. Practical effect: staging's own reminders, alerts, dwell-fires, gmail sync, and ticket automation had never actually fired since the earliest of these migrations (2026-04-07) — staging's scheduler was calling production's functions instead.

## What was done

1. **Audit snapshot taken first** (`docs/staging_cron_snapshot_2026-07-01_before_fix.json`) — full `command` text for all 10 rows, captured before any change, per ChatGPT's Phase 3 requirement.
2. **Staging service-role key verified working** as a Bearer token against a real Edge Function call (`evaluate-rules`, HTTP 200) before using it in the fix — directly answers ChatGPT's "is the key confirmed correct" question with empirical proof rather than assumption.
3. **All 10 rows corrected** via `cron.alter_job()` (not a raw `UPDATE` — `cron.job` blocks direct table writes; not a new shared migration file either, since that would reintroduce the same hardcoding problem for whichever environment it runs against next). URL and Authorization header both replaced with staging's own values. **Production was not touched** — this operates only on staging's own `cron.job` table.

## Verification (all 5 of ChatGPT's required steps)

1. ✅ **Audit snapshot** — done first, see file above.
2. ✅ **Staging-only update** — confirmed zero rows still reference `hhgyppbxgmjrwdpdubcx` after the fix.
3. ✅ **One cron verified manually** — checked `net._http_response` (pg_net's actual response log, not just `cron.job_run_details` which only confirms the SQL queued without error) for the minutes after the fix. Real HTTP 200s from staging's own functions with correctly-shaped bodies, e.g. `evaluate-rules` → `{"fired":0,"details":[],"errors":[],"checked_at":"2026-07-01T15:46:01.389Z"}`.
4. ✅ **F2b reminder verified** — created a fresh test reminder (`CronVerification`, rule id `47387a19-bb64-4d06-9a1a-c6c350783f89`) 2 minutes in the future via `create-demo-reminder`, with zero manual intervention afterward. Confirmed it fired automatically at 11:50:02 AM Eastern — ~2 minutes after its target time, `enabled` flipped to `false` (one-shot behavior working correctly).
5. ✅ **One unrelated scheduled task verified** — `check-reminders`, `fire-pending-dwells`, and the ticket-analysis jobs are all now returning real 200s from staging via the same `net._http_response` check, proving this isn't F2b-specific — staging's entire cron-driven feature set is now self-contained.

**One incidental finding during verification, not a new problem:** `trigger-morning-call` returned a 404 (`"wael user not found"`) — expected, not a regression. Staging was deliberately cleaned to a single account (`mynaavidemo@gmail.com`) earlier this session; `wael.aggan@gmail.com` no longer exists there by design. Noted for the record in case it looks alarming in logs later. Separately worth a look sometime: if this function is hardcoded to look up a user named "wael" specifically, that's its own pre-existing multi-user-safety smell, unrelated to tonight's fix — flagging, not fixing.

## Rollback

The pre-fix snapshot (`docs/staging_cron_snapshot_2026-07-01_before_fix.json`) has every original `command` value. Reverting means calling `cron.alter_job(job_id, command := <original command from snapshot>)` for each of the 10 jobs — same mechanism used to apply the fix.

## Deferred (per Phase 2 plan and Wael's agreement)

The underlying architectural gap — migrations hardcoding a literal project URL instead of resolving it dynamically per environment — is not fixed here. Flagged as a backlog item. Also deferred: confirming whether production was actually double-invoked by staging's misconfigured cron over the past ~3 months (would require a production read credential this session doesn't have) — a fact worth Wael independently confirming if he wants certainty, not something this fix needed to resolve.
