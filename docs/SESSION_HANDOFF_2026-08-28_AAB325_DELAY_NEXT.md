# Session handoff — 2026-08-28

## ⭐ NEXT SESSION, THE ONE JOB

**Find the reason for the delay in AAB V57.96.0 (build 325) that does not occur in staging APK 327.**

Unsolved. Seven hypotheses were raised and every one was either measured away or killed by Wael's
own evidence. **Nothing below in "Findings and analysis" is proven — read the Facts section first
and treat the rest as leads, not conclusions.**

---

# PART 1 — FACTS

Everything in this part was directly observed: read from a log, a database, a file, a command's
output, or reported by Wael as his own observation.

## 1.1 The symptom, as Wael observed it

- **AAB V57.96.0 (build 325)**, installed from Play **Open testing**. Play Console: release
  `1.0.325`, *"Released on Aug 19 2:57 AM"*, available to unlimited testers, 1 version code.
- **Staging APK 327 ("Naavi Staging")** on a second phone: *"no issue at all, open and close alert,
  sign google out and in instantly repeat many times no delay."*
- On the AAB: opening **Alerts** or **Settings** is slow, and sometimes aborts with
  **`manage-rules` timed out after 15000 ms**.
- **Fresh install works** — *"when the application is fresh the response to open the setup is OK
  (little slower)"*.
- **It degrades**: *"After time, not long, it start to slow down until it reached 15000 shut down."*
- **Force stop and restart does not change anything.**
- Opening Settings **takes several seconds to display name, phone and the other basic fields**.
- **Signing out of Google is slow**, and the sign-in screen then appears slowly.
- **Reproduced on a second phone**, installed from Play, same account.
- **Reproduced under a different account**: signed out `wael.aggan@gmail.com`, signed in as
  `robert.esm.2207@gmail.com` — *"The same delay exist."*

## 1.2 Measurements taken from a desktop connection

Production `hhgyppbxgmjrwdpdubcx` vs staging `xugvnfudofuskxoknhve`.

| Measured | Production | Staging |
|---|---|---|
| `user_settings` read | 0.13 – 0.25 s | 0.19 s |
| `auth/v1/health`, `/user`, `/settings` | 0.10 s | 0.10 s |
| `manage-rules`, service-key path | 0.45 s warm | 0.39 s |
| `manage-rules`, **token path** (invalid JWT, exercises `getUser()`) | 0.25 s | 0.26 s |
| `manage-rules`, first call after idle | 1.6 – 2.4 s | 0.4 s |
| `list_connections` + `lists` join, first call after idle | 3.1 s | 0.10 s |
| same join, repeat | 0.31 – 0.57 s | 0.10 – 0.13 s |

**Production row counts:** `list_connections` 3 · `lists` 14 · `gmail_messages` 270 ·
`email_actions` 1,155 (growing 30–80/day) · `documents` 404 · `action_rules` 46 for Wael.

**Production reads were also timed using the exact publishable key the AAB ships** — 0.13–0.25 s,
HTTP 200.

## 1.3 What build 325 changed

Commit `608efb6`, 2026-08-15 18:41 EST. Four files:

| File | Change |
|---|---|
| `app.json` | version bump |
| `app/settings.tsx` | **one line** — the displayed version string, 324 → 325 |
| `hooks/useConversationRecorder.ts` | removes a spoken summary that runs **only when a conversation recording finishes** |
| `supabase/functions/extract-actions/index.ts` | model swap to Sonnet — **server-side**, reaches 324 and 325 equally |

## 1.4 Build configuration

**EAS project env, environment `production` (scoped to `production, preview`):**

```
EXPO_PUBLIC_SUPABASE_URL        = https://hhgyppbxgmjrwdpdubcx.supabase.co   (updated Apr 12)
EXPO_PUBLIC_SUPABASE_ANON_KEY   = sb_publishable_Aq3x_...                    (updated Apr 18)
```

Both **last changed in April** — identical for builds 324 and 325.

**`eas.json` profiles:**

| Profile | Supabase | `EXPO_PUBLIC_TEST_LOGIN_ENABLED` | buildType |
|---|---|---|---|
| `staging` | staging URL + **legacy JWT** anon key | `true` | apk |
| `preview` | (inherits production from EAS env) | `true` | apk |
| `production` | (inherits production from EAS env) | **unset** | app-bundle |

**So the production AAB ships the new `sb_publishable_` key format; the staging APK ships the
legacy JWT key format.** `@supabase/supabase-js` installed: **2.105.4**.

## 1.5 The 60-second loop

`app/index.tsx:1267`:

```js
if (process.env.EXPO_PUBLIC_TEST_LOGIN_ENABLED !== 'true') {
  runSync();
  const syncInterval = setInterval(runSync, 60 * 1000);
  return () => clearInterval(syncInterval);
}
```

`runSync` (`app/index.tsx:1249`) performs six network operations:
`triggerCalendarSync()` · `registry.email.sync()` · `fetchUpcomingEvents(7)` ·
`fetchUpcomingBirthdays()` · `registry.email.fetchImportant()` · `fetchTodayTimeAlerts()`.

**It runs in production builds and not in staging or preview builds.** The guard was added
2026-06-23 in `c846c25`, whose message is *"skip background sync in test mode to prevent ANR on
emulator"*.

`lib/gmail.ts:33` `triggerGmailSync()` posts to `sync-gmail` **with no body**, so it takes the
no-body default — all active users, 7 days. That is the already-open item **B11y**.

**The email-cycle client code is identical between 325 and 327** — no commit between them touches
`lib/gmail.ts` or the guard, which sits at the same line number in both.

## 1.6 Code differences between build 325 and 327

Ten client-side commits. The one that touches a screen in the symptom is **`0452e53` (T8),
2026-08-21**, which removed from the live path:

> `lib/naavi-client.ts` — `getEpicHealthContext()` **ran on EVERY chat turn with a 6s timeout
> budget** · `app/settings.tsx` — `isEpicConnected()` **ran twice per Settings open** … *"Five
> tables that nothing writes to, queried on every message, result discarded."*

**That code is present in 325 and absent in 327.**

## 1.7 Deploy state of the relevant backend functions

| Function | Production | Staging |
|---|---|---|
| `manage-rules` | v28, 2026-07-22 05:01 EST | v23, 2026-07-21 21:48 EST |
| `sync-gmail` | **v70, 2026-06-13 19:04 EST** | v20, 2026-06-20 19:28 EST |

`sync-gmail` source commits: `2cd4ca2` 18:46 · `9ed4b39` 18:55 · **`00ce446` 19:05
"exclude trash from Gmail fetch query"** — all 2026-06-13.

**Production's deploy timestamp (19:04) precedes the last commit (19:05) by one minute.**
*(Ordering read from timestamps; the deployed source itself was not diffed. `npm run parity:verify`
downloads and diffs deployed source from both projects and would settle it.)*

**Production Edge Functions deployed since 2026-08-14:**

```
Aug 17  upload-conversation, poll-conversation, extract-actions   (all v1)
Aug 21  sync-active-email-alerts (v1 — first appearance on production)
Aug 21  manage-voice-pin, receive-sms-reply, send-sms, send-user-email,
        ingest-ticket, send-push-notification, receive-demo-sms-reply, create-contact
Aug 24  extract-email-actions, backfill-email-actions
Aug 27  naavi-chat, get-naavi-prompt
```

## 1.8 `manage-rules` auth paths, and test coverage

`supabase/functions/manage-rules/index.ts` resolves the caller two ways:

- **(a) JWT** — `Authorization` header → `sb.auth.getUser(token)`. **This is the path the mobile app
  uses.**
- **(b) Body `user_id`** — voice server and server-side callers.

`tests/lib/adapters.ts:147` calls it as
`callEdgeFunction(ctx, 'manage-rules', { ...args, user_id: ctx.testUserId })`.

**Every test uses path (b). Path (a) — the app's path — is exercised by no test.**

## 1.9 Other configuration read

- `expo-updates` ~55.0.18, `updates.url = https://u.expo.dev/be293d9d-...`,
  `runtimeVersion: {"policy":"appVersion"}`. AAB is on channel `production`, staging APK on
  `staging`.
- `lib/supabase.ts` auth config is complete: `storage: dualAuthStorage` (AsyncStorage with a
  SecureStore fallback and back-fill), `autoRefreshToken: true`, `persistSession: true`, plus an
  `AppState` listener calling `startAutoRefresh` / `stopAutoRefresh`.
- All AsyncStorage writes in the app are small bounded values (flags, ids, a geofence registry, a
  timestamp).

## 1.10 Changes made to production data this session

- **`action_rules` `c616d38f-4834-4a5a-8193-62b29a3007bb`** ("Alert when Bob emails", Wael's
  account) — Claude set `enabled = false` at Wael's request, to test whether removing him from the
  `sync-active-email-alerts` qualifying set changed anything. **Wael then deleted the row himself.**
  Before the change he was the **only** user qualifying; after it, **zero** users qualify.
- **`action_rules` `dc92ee64` ("Walmart Orleans arrival")** was observed `enabled: true`,
  `last_fired_at: null` at 07:10 EST, and observed **not enabled** at roughly 09:00 EST.
  **Claude did not change it.** Unexplained.

---

# PART 2 — FINDINGS AND ANALYSIS (NOT PROVEN)

**None of this is established. It is retained so the next session does not re-derive it, and it
must not be inherited as fact.**

## 2.1 Ruled out, and on what basis

| Ruled out | By |
|---|---|
| Wael's account / the 5-minute email sync | Wael reproduced under `robert.esm.2207@gmail.com` |
| His phone, or state stored on it | Reproduced on a second phone, fresh Play install |
| Anything held in memory | Force stop and restart changes nothing |
| Build 325's client source | Its only client changes are a version string and a conversation-recording branch — neither reachable from Alerts or Settings |
| Backend responsiveness | Measured: database 0.2 s, auth 0.1 s, `manage-rules` 0.25 s on both auth paths |
| Data volume | Measured: 3, 14, 270, 404, 1,155 rows |
| The API key format | supabase-js 2.105.4 supports it; reads with the publishable key returned 200 in 0.13–0.25 s |

## 2.2 Leads that remain, with what each fails to explain

1. **The 60-second loop.** The clearest structural difference — runs in production builds, not in
   staging or preview. **Fails "why now":** it has been in every production build since before June,
   so it cannot by itself explain a regression at 325.
2. **T8's Epic queries** (`0452e53`) — two extra queries per Settings open and a 6-second-budget
   health fetch per chat turn, **present in 325, absent in 327**. Matches Settings being slow, is
   not account- or device-specific, and survives force-stop. **Does not obviously explain**
   `manage-rules` timing out, nor why a fresh install is briefly fine.
3. **Production `sync-gmail` predating the third trash fix**, so production may fetch trashed mail
   on every sync where staging excludes it at the query. **Not verified against deployed source.**
4. **`sync-active-email-alerts` first appearing on production 2026-08-21**, two days after the AAB
   was released. **Killed as an account-specific cause** by the second-account reproduction; retained
   only as a general load source.

## 2.3 The proposed next experiment, and what each outcome would mean

**Build a preview APK from commit `608efb6` — build 325's exact source.** That gives the production
backend, the same source as the AAB, and the 60-second loop **off**. One variable against the AAB.

- **Preview 325 fast, AAB slow** → the loop is the cause; the 325 timing was coincidence.
- **Both slow** → the loop is exonerated, and **that is all it proves.** Preview 325 still differs
  from the fast staging APK 327 by **backend and code version**, so a second build — preview from
  327 — would be needed: fast means the 325→327 code delta (T8 the leading suspect), slow means the
  production environment.

Installing it requires uninstalling the Play version first — same package name, different signature.

## 2.4 A coverage gap found while investigating

The test suite calls `manage-rules` only with `user_id` in the body. **The JWT path the app uses is
untested**, which is why no gate caught this. Not raised as an item; recorded here.

---

# PART 3 — THE REST OF THIS SESSION

All committed and pushed. Not related to the delay.

- **[[T14]] Voice Alert & Reminder Test — CLOSED.** All six creation paths passed (time, location,
  email × with and without "set"), plus firing on all three and recurrence on email. Full record:
  `docs/T14_VOICE_ALERT_REMINDER_TEST_2026-08-28.md`.
- **Five items opened**, each explained and approved individually before its row existed (Rule 1b):
  **B12h** an alert is sometimes processed more than once · **B12i** alerts do not send WhatsApp
  although Settings shows it on · **B12j** Naavi does not say she has something paused · **B12k**
  Naavi is too slow to answer on voice · **B12l** an alert you already have is refused with "please
  try again".
- **Four existing items corrected:** **B11m**'s root cause was wrong and is fixed — she does look,
  she looks in the wrong table · **B4z** widened · **B4b** to eight reproductions · **B10d**
  confirmed still live six weeks on.
- **Priority list, 5 of 5:** **B12k**, B11m, B10c, B11l, S2. B12k took T14's slot on closure.
- **Architecture Reference at `2026.07.18.15`** — two corrections: the demo-staging Railway service
  is named `generous-tenderness` (the long string is its domain), and §3's "two interruption designs,
  one per branch" is superseded now that both voice branches resolve to the identical tree.
- **Known and untouched:** `B10s` and `B11i` are malformed rows in the holding list from before
  today. `B11i` is missing its Server/AAB and Status values, which is a content decision.
