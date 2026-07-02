# F2b Production Promotion — Final Approval Package

Governance: AI_DEVELOPMENT_GOVERNANCE.md v2.1, Phase 6/7/8. This is the consolidated diff for final review before promoting `naavi-voice-server`'s `staging` branch to `main` (production) and deploying the three shared Edge Functions to production Supabase.

Full diff text: `docs/F2B_PRODUCTION_PROMOTION_FULL_DIFF_2026-07-02.txt` (2030 lines).

---

## 1. What this covers

This is **everything currently on staging that isn't on production yet** — not just tonight's work. Two things are bundled:

1. **15 commits on `naavi-voice-server` `staging`**, none on `main` yet. 4 are from an earlier session (the original F2b reminder flow, already reviewed and shipped to staging then); 11 are from tonight (scenario walkthrough + every live-call fix).
2. **3 Edge Functions already merged to `naavi-app` `main`** (`create-demo-reminder`, `evaluate-rules`, `send-sms`) but only *deployed* to staging Supabase — production Supabase still runs the old code. No further code review needed for these (already shown/discussed in full); what's pending is purely the deploy step + one secret.

`naavi-voice-server` `main` confirmed untouched throughout: still `d7fafdc`.

## 2. Commit list (chronological)

| # | Commit | Summary |
|---|---|---|
| 1 | `c6ee469` | F2b demo line — reminder capture, timezone confirm, staging env support *(prior session)* |
| 2 | `eb83cd0` | Reminder-time prompt — Say outside Gather, not nested *(prior session)* |
| 3 | `382d71b` | Reminder parser — "p.m."/"a.m." with periods misread as 24-hour clock *(prior session)* |
| 4 | `34d345d` | Past-time rejection now states the misunderstood time *(prior session)* |
| 5 | `64a221f` | **Scenario walkthrough** — Phase 4 build (this session) |
| 6 | `e90ab54` | Closer line wording fix — "another example" |
| 7 | `0b58134` | Recap SMS moved to true end-of-call (was firing mid-call) |
| 8 | `81c04a7` | Chattiness trim round 1 |
| 9 | `039629a` | Chattiness trim round 2 (zero-friction philosophy) |
| 10 | `cce1ee9` | Recap SMS environment-aware From number |
| 11 | `ff83aac` | 3 bugs found via real staging call transcript |
| 12 | `e711046` | SMS consent disclosure added (888 TFV prerequisite) |
| 13 | `f859fd6` | Consent disclosure pause 400ms → 2000ms |
| 14 | `379f23a` | Consent disclosure paced with breaks between clauses |
| 15 | `2803553` | Verbal "STOP" recognition + opt-out |

## 3. Files changed

| File | Classification | Note |
|---|---|---|
| `naavi-voice-server/src/index.js` | Backend (Protected Core: Voice orchestration) | +854 lines net across all 15 commits |
| `naavi-voice-server/src/voice/scenarioWalkthrough.js` | Backend (new) | Scenario content, intent regex, consent/decline/closer lines |
| `naavi-voice-server/src/voice/recapSms.js` | Backend (new) | Recap SMS builder |
| `naavi-voice-server/src/voice/getDemoEnvironment.js` | Backend (extended) | Added `demoSmsFrom` per environment |
| `naavi-voice-server/src/voice/parseTimezone.js`, `parseReminderTime.js` | Backend (prior session) | Deterministic parsers, untouched tonight |
| `naavi-voice-server/test/*.test.js` (6 files) | Test | 68 unit tests total |
| `naavi-app/supabase/functions/create-demo-reminder/index.ts` | Backend (Protected Core: Reminder Engine) | Reads new `DEMO_SMS_FROM_NUMBER` secret |
| `naavi-app/supabase/functions/evaluate-rules/index.ts` | Backend (Protected Core: Reminder Engine, shared with every real user) | Forwards optional `from_number` override — no-op unless a rule sets it |
| `naavi-app/supabase/functions/send-sms/index.ts` | Backend (Protected Core, shared with every real user) | Accepts optional `from` override — no-op unless caller passes it |

**No changes to:** `DEMO_SCENARIOS` (old menu, dead code, untouched), mobile app, any migration, any function's real-user code paths (the `send-sms`/`evaluate-rules` additions are both opt-in fields that default to existing behavior — see §5).

## 4. Tests

```
npm test (naavi-voice-server) → 68/68 passing
```

No automated tests exist for the 3 Edge Function changes (Deno runtime, this repo's test:auto harness doesn't cover Edge Functions) — acknowledged coverage gap, verified instead by: clean `supabase functions deploy` to staging (no compile errors) + manual real-call testing on staging.

## 5. Why the shared Edge Function changes are safe for real users

This is the part that most needs a second look — `send-sms` and `evaluate-rules` fire on every real registered user's alert, not just demo traffic.

- `send-sms`: `from` is a new optional field. `const fromNumber = from || Deno.env.get('TWILIO_FROM_NUMBER')!;` — if `from` is absent (every real-user call site), behavior is byte-identical to before.
- `evaluate-rules`: `from: config.from_number || undefined` — reads a field that only `create-demo-reminder` ever sets. No real-user rule's `action_config` has this key, so it's always `undefined` for real users, and `undefined` in a JSON body is the same as omitting the field.
- `create-demo-reminder`: only touches demo-line rows (`user_id: demoUserId`, `source: 'demo_line'`) — never touches real user data.

## 6. Real-call verification this session

Multiple real staging calls, each surfacing and then confirming a fix:
- Original walkthrough flow (scenarios, cap, closer)
- Closer wording, Recap SMS timing
- 3 bugs from a full transcript (bare "reminder" not recognized, false retry after decline, ambiguous "When should I remind you")
- Consent disclosure content, pacing, and reaction-time window
- Verbal STOP recognition

## 7. Known risks (carried from earlier evidence packages, still true)

- Recap SMS won't fire if the caller hangs up *during* the walkthrough itself, before any end-of-call point — no Twilio call-status webhook wired for this line.
- `DEMO_MOVE_TO_REMINDER_RE` / `DEMO_STOP_RE` are bounded keyword sets, not exhaustive — unrecognized phrasing falls through to safe defaults (advance to next scenario / treated as a normal answer), never a crash or silent misroute.
- Declined scenarios don't count toward the 3-scenario cap (confirmed intentional).
- Verbal STOP's `demo_optouts` write is fire-and-forget, not awaited before hangup — no real exposure for this call (no SMS is ever attempted from the STOP branch itself), theoretical only for a hypothetical concurrent request to the same number.

## 8. Rollback

`naavi-voice-server`: `git reset --hard d7fafdc` on `staging` (if pushed to `main`, `git revert` the merge instead). `naavi-app`: `git revert c57e672`, then redeploy the 3 functions. Undo the `DEMO_SMS_FROM_NUMBER` production secret with `supabase secrets unset`. No migrations to unwind.

## 9. Outstanding before production

1. Merge/push `naavi-voice-server` `staging` → `main` (Railway auto-deploys production from `main`).
2. Deploy `create-demo-reminder`, `evaluate-rules`, `send-sms` to production Supabase (`hhgyppbxgmjrwdpdubcx`).
3. Set `DEMO_SMS_FROM_NUMBER=+14313006228` on production Supabase secrets.

None of these have been done yet — held pending this review.
