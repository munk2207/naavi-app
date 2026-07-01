# F2b — Phase 5 Evidence Package

Governance: AI_DEVELOPMENT_GOVERNANCE.md v2.1, Phase 5 (Evidence Package).
Implements: docs/F2B_PHASE2_CHANGE_PLAN_2026-07-01.md (Phase 3-approved by ChatGPT, twice).
Code has NOT been deployed anywhere. Nothing has been pushed, migrated, or built. This package is for review before Phase 6 (ChatGPT reviews the diff) and before any deploy.

**Phase 6 status: APPROVED — "Ready for staging: Yes."** ChatGPT's review confirmed the diff matches the approved plan, all deviations are documented and justified, and the regression/testing/rollback strategy is strong. Two follow-up items from that review are addressed below (§9).

---

## 1. Summary

Implemented the demo line's reminder capture + confirmation SMS flow exactly as approved in the Phase 2 plan: two new deterministic parser modules (timezone, reminder-time — no LLM), a new environment-selector module, two new Supabase Edge Functions, one new migration, and a modification to `evaluate-rules`'s `fireAction()`. The existing 5-scenario canned demo menu is replaced as the live post-name-confirm experience (explicit decision this session) but its code is untouched and still present.

## 2. Files changed

### `naavi-voice-server` (separate repo, uncommitted working tree)

| File | Classification | Status |
|---|---|---|
| `src/voice/parseTimezone.js` | Backend, isolated/testable | New |
| `src/voice/parseReminderTime.js` | Backend, isolated/testable | New |
| `src/voice/getDemoEnvironment.js` | Backend, isolated/testable | New |
| `test/parseTimezone.test.js` | Test | New (16 cases) |
| `test/parseReminderTime.test.js` | Test | New (11 cases) |
| `src/index.js` | Backend (Protected Core: Voice orchestration) | Modified — 441 insertions, 24 deletions |

### `supabase` (main repo)

| File | Classification | Status |
|---|---|---|
| `supabase/functions/create-demo-reminder/index.ts` | Backend | New |
| `supabase/functions/receive-demo-sms-reply/index.ts` | Backend | New |
| `supabase/functions/evaluate-rules/index.ts` | Backend (Protected Core: Reminder Engine) | Modified — 2 additions, both additive/conditional |
| `supabase/migrations/20260701000001_demo_optouts.sql` | Database | New |
| `docs/F2B_PHASE2_CHANGE_PLAN_2026-07-01.md` | Doc | Written this session |

## 3. Deviations from the approved Phase 2 plan (all discovered during implementation, none silent)

1. **Inbound SMS STOP handler is a new Edge Function (`receive-demo-sms-reply`), not a voice-server route.** The plan said `/sms/inbound` in `index.js`. Implementation found `supabase/functions/receive-sms-reply/index.ts` already exists as the established pattern for Twilio inbound-SMS webhooks (per-Twilio-number, dedicated Deno function) — scoped to ticket replies, wrong domain for demo opt-outs, but proves the convention. Mirroring it keeps the change out of the Protected Core voice-server file entirely, which is strictly lower risk than the original plan.
2. **`action_config` field is `body`, not `message`.** The plan used `message` informally; `_shared/alert_body.ts::buildAlertBody()` (used by `fireAction`) reads `action_config.body`. `create-demo-reminder` uses the correct field name.
3. **No `demoUserId`/`supabaseClient` object threaded through the voice server.** The voice server never uses the Supabase JS client — every call site uses `fetch()` with a bearer token (confirmed by reading `callResolvePlace` and others). `getDemoEnvironment()` returns `{supabaseUrl, supabaseServiceRoleKey, demoUserId, environment}` matching that shape. Additionally, only the short `environment` tag (`staging`/`production`) is threaded through Twilio action URLs — **never** the actual Supabase URL or service-role key, since Twilio/Railway access logs would leak a secret placed in a URL. Downstream handlers re-derive the full config via `getDemoEnvironmentByName(environment)`.
4. **One caught-and-fixed bug:** `parseReminderTime`'s `normalize()` originally stripped `:` as punctuation, silently destroying clock-time patterns like "3:30" before the parser ever saw them. Caught by the unit tests failing on first run (both bare-clock-time test cases failed with `null` instead of a resolved time) — fixed by excluding `:` from the strip set. Documented in a code comment.
5. **Added a yes/no confirmation gate for the reminder time itself**, beyond what the literal spec text showed (the spec reads as a statement — "Got it, I'll text you X" — not a question). This is required by CLAUDE.md Absolute Rule #12 (every state-changing commitment needs pre-confirmation + post-action readback), which applies project-wide to `SET_REMINDER`-class actions and wasn't explicitly re-derived in the Phase 2 plan. The post-action readback after actually creating the reminder satisfies the second half of Rule #12 and doubles as the spec's own closing line.
6. **One correctness fix inside `evaluate-rules`, not in the original plan text:** the opt-out-skip branch returns `true` (not `false`) from `fireAction`. Returning `false` would have marked the skip a transient failure — the cron would retry the same rule every minute forever for a number that will never be un-opted-out. `true` lets the normal success path write the dedup log entry and disable the one-shot rule, which is the correct terminal outcome for "this rule was evaluated and its answer is don't send."
7. **Confirmation sentence now states a day, not just a clock time** (Phase 6 follow-up, ChatGPT). Previously "I'll text you 3 PM Pacific" — a day-parsing bug would never be audible to the caller at the confirm step, since the day itself was never spoken. `formatSpokenTime` (local to `index.js`) was replaced with `formatSpokenDateTime` (moved into `parseReminderTime.js`, isolated/testable), which now says "tomorrow at 3 PM Pacific" / "today at 9 AM Eastern" / "Friday at 2 PM Central" etc.

## 4. Tests executed

`naavi-voice-server`: `node --test test/*.test.js` — **47 passed, 0 failed** (16 pre-existing `list_confirm_gate` tests unaffected; 25 parser tests from Phase 5, including the exact 7 cases specified in ChatGPT's Phase 3 review: tomorrow 3pm, today morning, next week, now, 3:30, 15:00, Friday afternoon; 6 new snapshot tests added per Phase 6 review, covering the full utterance → parseTimezone → parseReminderTime → formatSpokenDateTime chain — including ChatGPT's own example, "Vancouver" + "tomorrow 3 pm" → exactly "tomorrow at 3 PM Pacific").

`naavi-voice-server/src/index.js`: `node -c` syntax check passed. Manually verified no duplicate route registrations (11 unique `/voice/demo/*` paths) and no dangling references to the pre-existing menu code (`buildDemoMenuTwiml`/`buildDemoConnectTwiml` remain defined and valid, just unreached from the live call path per this session's decision).

`supabase/functions/*`: no Deno CLI available in this environment to run/typecheck — manually re-read both new files end-to-end for structural correctness against the `receive-sms-reply` reference pattern. **Not yet run.**

**Not yet run (requires deployment):** any end-to-end call test, any actual Edge Function invocation, any migration apply. That is Phase 7.

## 5. Manual tests required (Phase 7 — after deploy, before merge to staging)

1. Real call to the **staging** demo number: name capture → timezone ask/confirm → reminder time ask/confirm (try a relative day+time, "now", and a vague time that should trigger the morning/afternoon/evening follow-up) → optional message → hang up. Confirm SMS arrives at the stated time with the correct wording variant.
2. Reply STOP to the confirmation SMS from a second test number; confirm a subsequent reminder creation attempt from that number is refused (`create-demo-reminder` returns `opted_out`).
3. Confirm a real (non-demo) call to a registered user's normal flow is completely unaffected — this is the regression check for the Protected Core touch in `index.js` and `evaluate-rules`.
4. Confirm an existing real third-party SMS+WhatsApp alert (unrelated to F2b) still fires on both channels — regression check for the `fireAction()` change.
5. **Timezone default (Phase 6 review — highest-risk parser edge case).** Say "Mars" or another unrecognized place when asked for a timezone. Verify: the retry loop fires (up to `DEMO_TIMEZONE_MAX_ATTEMPTS` = 3 attempts), and after the final failed attempt the caller hears the default disclosed out loud ("I'll go with Eastern time then...") before the reminder-time question — never a silent default.

## 6. Rollback instructions

- `naavi-voice-server`: `git checkout -- src/index.js` and `git clean -fd src/voice test/parseTimezone.test.js test/parseReminderTime.test.js` reverts to the pre-F2b state. No deploy has happened yet, so there is nothing live to roll back.
- `supabase`: `git checkout -- supabase/functions/evaluate-rules/index.ts`, delete the two new function folders, delete the new migration file. If the migration has already been applied to staging/production, roll back with a matching `DROP TABLE IF EXISTS demo_optouts;` migration rather than editing history.
- No existing table, function, or route is deleted or renamed by this change — every modification is additive or conditionally gated, so rollback carries no data-loss risk for existing features.

## 7. Known risks (carried over from the Phase 2 plan, still open)

- Single shared `DEMO_USER_ID` per environment for all anonymous demo callers' `action_rules`/`sent_messages` rows (accepted per Wael's decision).
- Remaining theoretical STOP/cron race (accepted, documented in code comments and in the plan).
- No click-tracking on the install link in v1 (deferred, plan §3).
- Deterministic parser vocabulary is fixed and governed by the Parser Contract (plan §8a) — any future phrase support needs its own Phase 2 plan.

## 8. What still needs to happen before this can be tested (not done, needs Wael's go-ahead)

1. Deploy `create-demo-reminder` and `receive-demo-sms-reply` to **staging** first: `npx supabase functions deploy create-demo-reminder --no-verify-jwt --project-ref xugvnfudofuskxoknhve` (and same for `receive-demo-sms-reply`).
2. Push the `demo_optouts` migration to staging (per CLAUDE.md's documented staging `db push` command).
3. Set Supabase secrets for both new functions on the staging project: `DEMO_USER_ID` (a real staging user id for demo-owned rows — needs to exist in staging `auth.users`).
4. Provision a second Twilio number for the staging demo line; set its voice webhook to the same Railway URL and its SMS webhook to the staging `receive-demo-sms-reply` URL.
5. Set Railway env vars: `STAGING_DEMO_TWILIO_NUMBER`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `STAGING_DEMO_USER_ID`.
6. Commit + push `naavi-voice-server` (Railway auto-deploys from `main`) and `supabase` repos.
7. Run the Phase 7 manual tests above.
8. Only then repeat the same 5 steps for production, and only after Wael explicitly approves promoting to production.
