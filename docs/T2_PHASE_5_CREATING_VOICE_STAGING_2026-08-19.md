# Phase 5 — Evidence Package — T2 — Creating Voice Staging

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 0:** APPROVED, amended same session. **Phase 1:** APPROVED. **Phase 1A:** PASS WITH CORRECTIONS.
**Phase 2:** Approved with Mandatory Changes (Phase 3), amended §8. **Phase 4:** authorized and implemented.
**Status:** DRAFT — awaiting Phase 6 external review.

**All timestamps EST (America/Toronto), per CLAUDE.md.**

---

## 1. Summary

The Voice platform now has a staging environment. A call to `+13435041572` reaches a dedicated Railway service running the `staging` branch, which reads and writes the **staging** Supabase project, and whose outbound sends are confined to an approved allowlist. Production was not deployed to and its configuration was not changed.

**Delivered:** Tracks A (infrastructure), B (outbound guard), C (staging identity remediation), E (tests), F (caller ID).
**Not delivered:** Track B10 (voice server's own guard) and Track D (runtime environment stamp) — both held, see §7.

---

## 2. Files changed

### `munk2207/naavi-app` — commit `df8aa9a`

| File | Change |
|---|---|
| `supabase/functions/_shared/outbound_guard.ts` | **NEW** — `guardDestination()`, `resolveCallerId()`, `resolveProjectRef()` |
| `send-sms/index.ts` | Guard before the Twilio POST (`:142`) |
| `send-user-email/index.ts` | Guard after recipient resolution, before Gmail send |
| `send-push-notification/index.ts` | Guard on the target user's phone/email |
| `evaluate-rules/index.ts` | Guard + `resolveCallerId()` on the direct `Calls.json` path |
| `check-reminders/index.ts` | Same |
| `report-location-event/index.ts` | Same |
| `outbound-call/index.ts` | Same; module-level const converted to per-call resolution |
| `trigger-morning-call/index.ts` | Same |
| `tests/catalogue/t2-outbound-guard.ts` | **NEW** — 10 behavioral cases |
| `tests/runner.ts` | Registered the suite |

Commit `2df4407` — holding-list entry B11c (see §6).

### `munk2207/naavi-voice-server` — commit `2124150` (branch `staging`)

Merge of `main` into `staging`. No functional change; branch sync only. Pre-merge state archived at `archive/staging-pre-t2-merge-2026-08-19` (pushed).

---

## 3. Tests executed

### Automated — 10/10 green

`tests/catalogue/t2-outbound-guard.ts`. Real behavioral tests, not source-string assertions: the guard's `Deno.env` calls all sit inside function bodies, so stubbing `globalThis.Deno` exercises the shipped logic under Node.

| Case | Result |
|---|---|
| `inert-when-secret-absent` | PASS |
| `inert-when-secret-empty` | PASS |
| `allows-allowlisted-phone-any-format` | PASS |
| `blocks-non-allowlisted-phone` | PASS |
| `email-matching-is-case-insensitive` | PASS |
| `fails-closed-on-empty-destination-when-enforced` | PASS |
| `multi-entry-allowlist` | PASS |
| `caller-id-defaults-to-production-number` | PASS |
| `caller-id-honors-staging-override` | PASS |
| `project-ref-resolved-at-runtime` | PASS |

Run without the suite runner, deliberately — the runner's fixtures perform live DELETEs against whichever project `SUPABASE_URL` names, which defaults to production (see §6, Finding 3).

### Voice server suite — 102/102 green

`node --test test/*.test.js` on the merged `staging` branch. Covers both sides of the merge: F11a's demo tests (staging's unique work) and `resolveEffectiveTimezone` / `f17-self-override` (main's). `node --check` passes on every `src/` file.

### Live verification — the outbound guard, on staging

```
POST https://xugvnfudofuskxoknhve.supabase.co/functions/v1/send-sms
     { to: "+12025550100", ... }
→ HTTP 200
  {"success":false,"blocked":true,"reason":"destination not in OUTBOUND_ALLOWLIST",
   "channel":"sms","to":"+12025550100"}
```

Twilio was never called. A fictional `555` number was used so the test could not reach a real person even if the guard had failed.

### Live verification — the staging voice service

```
GET https://naavi-voice-staging-production.up.railway.app/
→ HTTP 200 in 0.36s
  {"status":"ok","service":"naavi-voice-server", ...}
```

**Boot log, deployment `4b15d2fd`, 2026-08-19 05:09 EST** — the environment proof required by Phase 0 Requirement 4:

```
[Boot] DEMO_TWILIO_NUMBER="" (len=0)
[Boot] DEMO_USER_ID="" (len=0)
[Boot] STAGING_DEMO_TWILIO_NUMBER="" (len=0)
[Voice] SUPABASE_URL: set
[Voice] SUPABASE_SERVICE_ROLE_KEY: set (41 chars)
[Voice] Server running on port 8080
```

### Live verification — Track C identity remediation

Before (3 accounts claiming `+13433332567` in staging):

```
f1bc46b8  phone=+13433332567  phone_numbers=["+13433332567"]
05e821a2  phone=+13433332567  phone_numbers=["+13433332567"]
ae1f3438  phone=+13433332567  phone_numbers=null
```

After — the voice server's own lookup query (`index.js:994`) run verbatim:

```
voice lookup (limit=1) -> [{"user_id":"f1bc46b8-a478-43ad-bf09-e138099c8847"}]
rows claiming +13433332567 -> 1
RESULT: PASS
```

### Live verification — production unaffected

```
$ npx supabase secrets list --project-ref hhgyppbxgmjrwdpdubcx | grep -E "OUTBOUND_ALLOWLIST|VOICE_CALL_FROM_NUMBER"
  NEITHER SECRET PRESENT ON PRODUCTION — guard inert there, as designed
```

Production Edge Functions were not deployed. The production Railway service and the `+12495235394` webhook were not modified — its webhook was confirmed still pointing at `naavi-voice-server-production.up.railway.app` after all work.

### Gate 2 (voice regression) against STAGING — 2026-08-19 09:59 EST

**The first time voice tests have ever run against a staging environment.** Enabled by T2-F1 (§9), which landed after the original draft of this document.

```
════════════════════════════════════════════════════════
  Testing against: STAGING  (xugvnfudofuskxoknhve)
  GATE 2 — VOICE ONLY
  Voice server:    STAGING  (naavi-voice-staging-production.up.railway.app)
════════════════════════════════════════════════════════
GATE 2 — VOICE ONLY → 46/554 case(s) selected

Total: 46   Passed: 42 ✓   Failed: 0 ✗   Errored: 0 ⨯   Timed out: 0 ⧗   Skipped: 4 ○
Duration: 36.3s     exit 0
```

Both halves of the banner name STAGING — the split-brain the T2-F1 guard exists to prevent did not occur.

**Real HTTP calls reached the staging voice server** (not source-inspection tests): `voice.endpoint-reachable` PASS 3168ms · `voice.calendar-today-query` PASS 3417ms · `voice.contact-lookup-known-name` PASS 1290ms · `voice.email-alert-intent` PASS 8055ms, plus 7 `voice-pin` cases.

**The 4 skips are correct behaviour, not failures** — `s060606.*` contact-lookup tests require Wael's *production* Google contacts and self-skip with an explicit reason naming the environment they found themselves in.

**Two incidental confirmations from the same run:**
- `[fixtures] snapshot test-user phones: phone=null numbers=null` — Track C's clearing of `ae1f3438` held; the staging auto-tester account no longer claims `+13433332567`.
- `[fixtures] teardown(calendar_events) scoped to suite-created rows: or=(title.like.Auto-tester*,title.like.AutoTest*,title.like.multiuser-safety-test*)` — B10y's scoped teardown executed correctly against staging.

**This closes Phase 2 §8.3 Addition 2:** Track C did **not** break the auto-tester via the uniqueness trigger. The concern was raised as a self-reported finding and is now disproven by a live run rather than by reasoning.

### ⭐ Live end-to-end verification, and the discovery it produced — 2026-08-19 ~06:08-06:21 EST

Wael called `+13435041572` and worked through the test script. This closed three of the four outstanding manual checks and surfaced the most consequential finding of the work item.

**Test 1-2 — conversational, against staging data.** Passed. Naavi answered from the staging account's data (Blood Test, Amoxicillin schedule, Dr. Sarah follow-up, the `work` list, both alerts reported as disabled). No PIN was requested — the caller was recognised, confirming Track C's identity remediation end to end.

**Test 3 — a reminder, which exposed a silent, total failure of scheduled delivery on staging.**

Wael asked for a reminder 3 minutes out. It was written correctly — `action_rules` row `32dec769`, `trigger_type: time`, `datetime: 2026-08-19T06:09:00-04:00`, `action_type: sms`, `to_phone: +13433332567` (allowlisted), `enabled: true`. **Nothing arrived.** Six minutes past due, `last_fired_at` was still `null` and `sent_messages` was empty.

The chain of elimination, each step verified rather than assumed:

1. **The rule was well-formed** — full row read directly.
2. **`findTimeTriggers` was not at fault** — `evaluate-rules/index.ts:311` fires whenever `triggerTime <= now`; the rule qualified.
3. **The function worked** — invoked manually with a current key it returned `{"fired":1,"errors":[]}`, and Wael confirmed **SMS, WhatsApp and voice call all arrived**. That is the positive-path proof §4 item 1 was waiting for.
4. **The crons were running** — `cron.job_run_details` showed `evaluate-rules-every-minute` and `check-reminders-every-minute` succeeding at 6:14, 6:15, 6:16.
5. **The cron URLs were correct** — both point at `xugvnfudofuskxoknhve`. No environment leak.
6. **`net._http_response` gave the answer:**

```
6:17:00 | HTTP 401 | {"message":"Unregistered API key","hint":"Double check the provided API key..."}
   (x6, every minute)
```

**Root cause: the cron definitions carry a hardcoded Bearer token, and staging's service-role key had been rotated out from under them.** `cron.job_run_details` reported "succeeded" because the *SQL statement* ran fine; the HTTP call inside it was being rejected. The only outward symptom was an empty `sent_messages` table.

**Consequence, stated plainly: nothing time-based had been working on staging at all** — no alerts, no reminders, no morning calls — for an unknown period, invisibly. This is the same defect class as `project_naavi_staging_service_role_key_rotation`, which recorded the symptom on production and left it *"flagged, not touched."*

**Audit and repair (staging only).** Of 11 cron jobs, **7 carried the same stale token**; 4 send no Bearer header and were unaffected. Worth noting for the production discussion: sending *no* key passes the gateway, while sending a *stale* one is rejected. All 7 rewritten via `cron.alter_job` with only the token substituted, the rest of each command preserved verbatim. Full before-state snapshotted for rollback.

**Verified live after the fix** — the 6:21:00 tick:

```
HTTP 200 | {"message":"No active rules","checked_at":"2026-08-19T10:21:00.653Z"}   evaluate-rules
HTTP 200 | {"message":"No reminders due","checked_at":"2026-08-19T10:21:00.297Z"}  check-reminders
HTTP 200 | {"triggered":0}                                                          trigger-morning-call
HTTP 200 | {"processed":0,"candidates":2}
```

Zero 401s. **This closes §4 item 3 (cron-fired path)** — the scheduled path now reaches the function unaided.

**One unrelated failure remains, noted not chased:** `HTTP 404 {"error":"wael user not found"}` from `geofence-health-check-daily` — a production-shaped assumption baked into a function now running against staging. Harmless here; same family as the other cross-environment leaks in Finding 2.

**Production follow-up — and a correction to an inference made in this document's own drafting.**

On being shown the staging cron failure, Wael reported production separately broken: *"production is not working at all"* — the voice line rejecting every caller with "this phone is not registered," then refusing a correct PIN and terminating.

**That was diagnosed and fixed the same session, and it was the same credential rotation in a different place.** The production voice server's Railway `SUPABASE_SERVICE_ROLE_KEY` had been revoked. Proven by running the voice server's own two startup calls against production with both keys: the Railway key returned **401 Unregistered API key** for the phone lookup *and* for PIN verification, while a current key returned **200** (resolving `+16137697957` to `788fe85c`) and reached the PIN function normally. One revoked credential explained all three symptoms — the lookup finds no user, the PIN can never be compared, the call ends. Wael replaced the variable; verified afterwards by querying the running production container through `/test/ask`, which returned real production data. **This closed the open registration bug carried as top priority in `SESSION_HANDOFF_2026-08-18`, against which four hypotheses had already been eliminated.** It was found only because T2's staging work had surfaced the identical error string an hour earlier.

**⚠️ CORRECTION — an inference recorded here was wrong.** From the staging pattern, this document previously implied production's crons were likely dead the same way, citing an empty `sent_messages` table and a last-fired date of Jul 22. **Both were disproven by direct query:**
- Production's crons are **healthy** — `net._http_response` over 2 hours shows **840 × HTTP 200 and zero 401s**.
- `sent_messages` holds **756 rows**, not zero. The earlier query selected a column that does not exist on that table; the error object it returned failed an `Array.isArray` check and was printed as "(none)". **A malformed query returning an error is not a zero result**, and it was reported as evidence without that being verified.
- The Jul 22 last-fired date is unremarkable once the crons are known healthy: one email rule that has not matched an email since, and three location rules that have never had a geofence arrival.

**Production's only real fault was the voice server key.** The rest was pattern-matching from staging onto misread data. Recorded rather than quietly deleted, because the failure mode — generalising from one environment to another and then reading ambiguous output as confirmation — is the kind this project's evidence rules exist to catch.

### First live call — 2026-08-19

Wael called `+13435041572`; Naavi answered. Two defects surfaced, recorded as **B11c** (§6). **Neither is in T2's scope, and both were found without production being touched — the environment doing the job it was built for.**

---

## 4. Manual tests required (not yet done)

1. ~~**Positive-path outbound**~~ — **DONE 2026-08-19.** A staging alert fired to an allowlisted destination and Wael confirmed **SMS, WhatsApp and voice call all arrived**. The allowed path is now proven live, not merely unit-asserted.
2. ~~**Full conversational call**~~ — **DONE 2026-08-19.** Staging call answered from staging data (calendar, memory, lists, alerts), caller recognised without a PIN.
3. ~~**Cron-fired alert**~~ — **DONE 2026-08-19**, though not as expected: the first attempt exposed that *every* staging cron was failing auth with HTTP 401. Repaired, and the scheduled path verified returning 200s unaided. Full account in §3.
4. ~~**`npm run test:auto` (Gate 1) with `SUPABASE_URL` pointed at staging** — required by Phase 2 §8.3 Addition 2, to confirm Track C did not break the auto-tester via the uniqueness trigger.~~ **DONE 2026-08-19 — superseded and exceeded by the Gate 2 staging run above (§3).** Gate 2 exercises the same fixtures *and* the live voice server; the phone snapshot came back `null`, proving Track C held and the uniqueness trigger was not tripped. 42 passed, 0 failed.

**All four manual verifications are now complete.** Items 1-3 were closed by Wael's live call on 2026-08-19 (§3); item 4 was superseded by the Gate 2 staging run.

### ⚠️ Correction — an earlier version of this list was wrong

Item 4 originally read *"`npm run test:auto` against staging"* as though it would verify the new environment. **It does not, and cannot.** Raised by Wael 2026-08-19; verified by direct inspection:

- **46 tests carry `platform: 'voice'`** across 14 catalogue files (`voice-regression.ts`, `voice-pin.ts`, and 12 session files), so voice coverage does exist — but it is **Gate 2** (`npm run test:voice`), and **Gate 1 (`test:auto`) excludes it entirely** (`tests/runner.ts:163-170`).
- Those voice tests make **live calls** — `fetch(\`${url}/test/ask\`)` (`tests/catalogue/voice-regression.ts:45`) — against `process.env.VOICE_SERVER_URL`, which is `https://naavi-voice-server-production.up.railway.app` (`tests/.env:9`).
- A search of all of `tests/` for `naavi-voice-staging` or `STAGING_VOICE` returns **zero matches**. There is no staging-voice configuration in the harness.

**Consequences, stated plainly:**
- Item 4 verifies only the *database* side of Track C. It exercises nothing in the new voice environment.
- **The auto-tester has never tested a voice staging environment, and cannot today** — none existed before this work item.
- Running `npm run test:voice` with `SUPABASE_URL` pointed at staging would produce a **split-brain**: DB fixtures against staging, live voice calls against **production**. This must not be done until the harness is environment-aware.

**Therefore T2 is not fully delivered.** The environment exists and is contained, but nothing automated can reach it — it is verifiable only by Wael dialling it manually. Tracked as **T2-F1** (§9).

---

## 5. Infrastructure state (Track A)

| Item | Value |
|---|---|
| Branch | `staging` in `munk2207/naavi-voice-server`, level with `main` |
| Railway service | `naavi-voice-staging`, deploying from `staging` |
| URL | `https://naavi-voice-staging-production.up.railway.app` (port 8080) |
| Twilio number | `+13435041572` → `…/voice`, HTTP POST |
| Supabase | `xugvnfudofuskxoknhve` |
| Secrets set (staging only) | `OUTBOUND_ALLOWLIST`, `VOICE_CALL_FROM_NUMBER=+13435041572`, `VOICE_SERVER_URL` |
| Credentials | Shared with production (Wael's decision) — both numbers are in one Twilio account |

The hostname contains "production" because Railway's *environment* is named that; it is a separate service with its own variables.

---

## 6. Findings during implementation — reported, not silently fixed

**Finding 1 — the `staging` branch already existed and was 27 commits stale.** Created 2026-07-03 for F2b, missing `action_rule_confirm_gate.js` (B9z) and `resolveEffectiveTimezone.js` (B10x Track 2). Deploying it as-is would have produced a staging environment behaving differently from production for reasons unrelated to T2, making every test result ambiguous. Merged rather than reset, preserving 7 unmerged F11a commits that MEMORY.md lists as field-test pending. Both merge conflicts resolved to main's side, each verified: staging's side would have redeclared consts (a `SyntaxError`) and duplicated the F12 block while dropping B10q's validation.

**Finding 2 — two cross-environment leaks in staging's own configuration.**
- `SUPABASE_URL` on the new Railway service was pointing at **production** (`hhgyppbxgmjrwdpdubcx`) after the first variable attempt silently failed to save. Caught by checking rather than assuming; fixed and re-verified.
- `VOICE_SERVER_URL` on staging Supabase was last set **2026-06-20**, two months before a staging voice server existed — so staging's `evaluate-rules` / `check-reminders` would have driven the **production** voice server for `/prepare-alert` and `/speak-alert`. Fixed to the staging URL. *(The stored value was not directly read — Supabase hashes secrets in list output — so the pre-fix target is inferred from the timestamp, not observed.)*

**Finding 3 — `--grep` does not limit what the auto-tester touches.** During the B10y work, a `--grep`-filtered run was assumed inert; it is not. Fixtures run regardless and perform live DELETEs against whichever project `SUPABASE_URL` names, defaulting to production. A teardown consequently ran against the production auto-tester account. Documented in CLAUDE.md.

**Finding 4 — production has duplicate phone identities too.** `+13433332567` is on two production accounts (`8cd727da` robert.esm.2207, created 2026-08-14; `7739bab9` mynaavi2207), with the same `limit=1` lookup. **Out of T2's scope** — Phase 0 confines Track C to staging. Recorded because it is the same defect class and bears on the open registration bug.

**Finding 5 — B11c, two voice defects from the first staging call.** The caller's name is absent from the timezone-ask prompt and from its confirmation. Located (`index.js:6685`, `:6919` — the name is supported, the fallback branch ran, so `userName` was empty) but **deliberately not investigated**, per Wael. Also captures `parseTimezone.js`'s hardcoded vocabulary (5 region aliases + 29 cities). Commit `2df4407`.

**Finding 6 — the Demo line and the Voice platform are one process, and the coupling produced this phase's only real blocker.** Raised by Wael on reading the B10 analysis: *"One of the big issue is to mix the Demo with the Voice platform, they are different."* The evidence is in §7 item 1 — the sole direct-to-Twilio outbound in the entire voice server belongs to the demo flow, and that is what forced T2 to weigh a duplicate guard implementation at all. A separate demo service would have made the question moot. Two further consequences fall out of the same coupling: `getDemoEnvironment.js`'s `configFor('production')` hardcodes `+18889162284` rather than deriving it, and T2's containment guarantee now depends on a configuration invariant instead of code. **Opened as holding-list item T3, Full Phase 1-8, with an ADR required either way.** Out of T2's scope.

**Finding 8 — every staging cron was failing authentication, silently, and had been for an unknown period.** Found by testing rather than reading: a reminder created on a live call never arrived. The cron definitions carry a hardcoded Bearer token and staging's service-role key had been rotated; `cron.job_run_details` reported "succeeded" because the SQL ran, while the HTTP call inside returned 401. **Nothing time-based worked on staging at all** — no alerts, reminders or morning calls — with an empty `sent_messages` table as the only symptom. 7 of 11 jobs affected; repaired and verified returning 200s. Full account in §3. **This is the most consequential finding of the work item, and T2 is what surfaced it** — the environment existed for barely an hour before its first real test exposed a defect class that had been invisible. Same class as `project_naavi_staging_service_role_key_rotation`, which recorded the identical symptom on production and left it "flagged, not touched." **Production's crons were separately checked and are healthy** — 840 × HTTP 200, zero 401s. Production's own fault from this same rotation was elsewhere: the voice server's Railway key, diagnosed and fixed the same session (§3). An earlier inference in this document that production's crons were also dead was wrong and is corrected in §3.

**Finding 9 — B11c is broader than first recorded.** The original entry covered the name being absent from the timezone-ask prompt and its confirmation. Wael's live call showed **Naavi did not greet him by name at all**, so the defect is not confined to the timezone flow. He also reported the **start of a spoken reply being garbled** — recurring, not new. Both belong to B11c; neither investigated, per the standing instruction to document only.

**Finding 7 — secret exposure.** Production Railway variables were shared as a screenshot during setup, placing several live keys in the session transcript: Anthropic, Deepgram, Azure Speech, Google client secret, Twilio auth token, and the production Supabase service-role key. Staging's service-role key was subsequently also placed in the transcript. **Recommend rotating all of them.** Not yet done.

---

## 7. Known risks and what is NOT delivered

1. **B10 — RESOLVED 2026-08-19: not required, and no Architecture Exception is needed.** The voice server's one direct-to-Twilio SMS (`naavi-voice-server/src/index.js:7224`) is **unreachable on the staging service by configuration**. Chain, each link verified by direct read:

   - That send is the **F2b demo-line recap SMS**, not a registered-user path. Its only three call sites (`:7719`, `:7842`, `:7955`) are inside the demo walkthrough handlers.
   - The demo flow has a single entry gate: `/voice` calls `getDemoEnvironment(calledNumber)` (`:6585`), which returns non-null only when the dialed number matches `DEMO_TWILIO_NUMBER` or `STAGING_DEMO_TWILIO_NUMBER`. Otherwise `isDemoCall` is false and the demo branch (`:6593-6596`) never executes.
   - Both variables are **unset on the staging service**, proven by its own boot log (§3): `DEMO_TWILIO_NUMBER="" (len=0)`, `STAGING_DEMO_TWILIO_NUMBER="" (len=0)`.
   - A second, independent stop exists even if the first were bypassed: `demoSmsFrom` resolves to `STAGING_DEMO_TWILIO_NUMBER || ''` and the function aborts on empty (`:7213-7216`) — *"will not guess a sender number."*
   - The voice server's other `api.twilio.com` calls (`:5433`, `:5456`, `:5484`) manage recordings on an already-connected call. Not third-party outbound.

   **Therefore the containment claim holds as stated:** staging cannot reach a non-allowlisted destination. Implementing B10 would introduce a duplicate implementation of the guard rule in order to protect code that cannot execute — precisely what governance §0.4 forbids. **No Architecture Exception is required because no duplication is being introduced.**

   **⚠️ CONFIGURATION INVARIANT — this safety is configuration-dependent, not code-enforced.** If `DEMO_TWILIO_NUMBER` or `STAGING_DEMO_TWILIO_NUMBER` is ever set on the staging service, the path becomes reachable and B10 must be implemented **first**. Worse: `getDemoEnvironment.js`'s `configFor('production')` carries a **hardcoded** `demoSmsFrom: '+18889162284'`, so a production-tagged demo call would send from the real 888 number regardless of which environment it ran in. Recorded here and in the holding list so this cannot be tripped unknowingly.

2. **Track D is partial.** `resolveProjectRef()` ships inside the guard and logs the resolved project on every guard decision. The voice-server-side `client_diagnostics` stamp was scoped alongside B10 and, with B10 closed as unnecessary, has not been built. The boot-log evidence in §3 currently substitutes for it — weaker, because it proves what the process started with rather than what a given transaction reached. Carried forward as a follow-up, not claimed as delivered.

3. **Only the blocked path is live-proven.** A staging send to an *allowlisted* destination has not been demonstrated end to end.

4. **The additive-only schema rule remains a governance control, not technical isolation** — unchanged from Phase 0.

5. **Mobile-staging is now subject to the allowlist too**, since it calls the same staging Edge Functions. Disclosed in Phase 2 §3; no mobile file changed and no production mobile user is affected.

---

## 8. Rollback

| Change | Rollback |
|---|---|
| Edge Functions (8, staging) | Redeploy the prior version per function; or unset `OUTBOUND_ALLOWLIST` on staging, which makes every guard inert immediately with no redeploy |
| `VOICE_CALL_FROM_NUMBER` | Unset → `resolveCallerId()` returns `+12495235394` |
| `VOICE_SERVER_URL` | Reset to the production Railway URL |
| Track C identity data | Before-state captured; restore `phone`/`phone_numbers` on `05e821a2` and `ae1f3438` |
| `staging` branch merge | `archive/staging-pre-t2-merge-2026-08-19` (pushed) |
| Railway service | Delete `naavi-voice-staging` |
| Twilio webhook | Reset `+13435041572` to `https://demo.twilio.com/welcome/voice/` |

**Production requires no rollback** — it was not deployed to and its configuration was not changed.

---

## 9. Follow-ups opened by this work item

**T2-F1 — make the test harness environment-aware for Voice. ✅ CLOSED 2026-08-19, commit `cced68c`.** Raised by Wael (§4 correction): the harness had exactly one voice URL, hardcoded to production in `tests/.env:9`, so the staging voice environment could not be reached by any automated test.

*Shipped:* `tests/lib/voice_env.ts::resolveVoiceTarget` picks the voice URL from the **same** environment label already derived from `SUPABASE_URL`, and `runner.ts` overrides `process.env.VOICE_SERVER_URL` with it — so none of the 14 catalogue files consuming that variable needed changing, and no two suites can disagree. `STAGING_VOICE_SERVER_URL` added to `tests/.env`. No voice-server change was needed; the staging service runs identical code and already exposed the endpoint the suite calls (`naavi-voice-server/src/index.js:8520`).

*Split-brain hazard closed:* Gate 2 now **refuses to run** when the Supabase project and the voice server name different environments — also on a missing `STAGING_VOICE_SERVER_URL` (which must never silently fall back to production) and on an unrecognised host. Gate 1 is unaffected: it runs no voice tests, so a mismatch there is inert and must not block a mobile run. Verified firing live, and by 7 unit tests.

*Extracted as a pure function deliberately,* rather than left inline: the runner's fixtures perform live DELETEs before any test executes, so "run it and see" is not a safe verification method here. Probing it through shell env vars is also unreliable — the loader only fills *unset* variables (`runner.ts:142`), so an empty test value is silently replaced by `tests/.env`. That defeated exactly such an attempt and caused an unintended live Gate 2 run against staging.

*Proven by outcome:* the Gate 2 staging run in §3 — 42 passed, 0 failed, both banner halves reading STAGING.

**T3 — separate the Demo line from the Voice platform.** See §6 Finding 6 and the holding list. Out of T2's scope, Full Phase 1-8.

**Secret rotation.** §6 Finding 7. Not started.

---

**Awaiting Phase 6 external review, then Wael's own explicit go-ahead** (governance §3, Phase-Gate Approval Rule).
