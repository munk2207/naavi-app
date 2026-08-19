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

### First live call — 2026-08-19

Wael called `+13435041572`; Naavi answered. Two defects surfaced, recorded as **B11c** (§6). **Neither is in T2's scope, and both were found without production being touched — the environment doing the job it was built for.**

---

## 4. Manual tests required (not yet done)

1. **Positive-path outbound** — a staging alert firing to an allowlisted destination and actually arriving. Only the *blocked* path is proven; the allowed path is asserted by unit test, not by a live send.
2. **Full conversational call** — a staging call exercising alerts, lists, memory, calendar against staging data.
3. **Cron-fired alert** — create a rule on staging, let `evaluate-rules` fire it, confirm the guard is consulted on the cron path (only the direct HTTP invocation is proven).
4. **`npm run test:auto` against staging** — required by Phase 2 §8.3 Addition 2, to confirm Track C did not break the auto-tester via the uniqueness trigger. **Not yet run.**

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

**Finding 6 — secret exposure.** Production Railway variables were shared as a screenshot during setup, placing several live keys in the session transcript: Anthropic, Deepgram, Azure Speech, Google client secret, Twilio auth token, and the production Supabase service-role key. Staging's service-role key was subsequently also placed in the transcript. **Recommend rotating all of them.** Not yet done.

---

## 7. Known risks and what is NOT delivered

1. **B10 — the voice server's own outbound SMS is still unguarded** (`naavi-voice-server/src/index.js:7224`). It cannot import the Deno `_shared` module, so it needs a small equivalent check — a second implementation of the same rule. Governance §15 makes unexcepted duplication an automatic rejection, and **Phase 3 has not ruled on whether it warrants an Architecture Exception despite being asked across three exchanges.** Until resolved, "staging cannot reach outside the allowlist" is true of everything routed through Supabase but **not** of the voice server itself.

2. **Track D is partial.** `resolveProjectRef()` ships inside the guard and logs the resolved project on every guard decision. The voice-server-side `client_diagnostics` stamp sits in B10's held file. The boot-log evidence in §3 currently substitutes for it.

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

**Awaiting Phase 6 external review, then Wael's own explicit go-ahead** (governance §3, Phase-Gate Approval Rule).
