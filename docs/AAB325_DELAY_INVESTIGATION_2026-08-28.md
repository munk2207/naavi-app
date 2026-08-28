# AAB 325 delay — investigation record

**Status: UNSOLVED, PARKED 2026-08-28 by Wael.** Not abandoned. This document exists so that if the
symptom returns, nobody re-derives a day's work from scratch.

**The resumption point is §8.** Everything before it is evidence.

**Read §2 before §3.** §2 is what was proven and will not change. §3 is a graveyard of hypotheses,
including four of Claude's own, each killed by a measurement named alongside it. A future session
that skips §3 will propose one of them again.

---

## 1. The symptom

Opening **Alerts** or **Settings** on production build **AAB 1.0.325** is sometimes slow, and
sometimes aborts with `manage-rules timed out after 15000 ms`. In Wael's words: *"After time, not
long, it start to slow down until it reached 15000 shut down."*

Reproduced on a second phone, installed from Play, same account. Also reproduced under a second
account (`robert.esm.2207@gmail.com`). **The staging APK does not show it** — *"no issue at all,
open and close alert, sign google out and in instantly repeat many times no delay."*

**Wael's own timeline, which turned out to be the correct frame and is what redirected this
investigation:** he installed AAB 325 on **19 August**, tested it, and it was fine. The binary never
changed afterwards.

---

## 2. What is PROVEN

Every claim here is a direct observation from a log, a database, or a command's output.

### 2.1 The delay happens on the phone, before a single byte reaches Supabase

This is the central finding and it is not an inference.

At **12:54 EST** Wael opened Alerts three times, five seconds apart, with the app in the foreground
throughout. Supabase's own **Invocations** log for `manage-rules` shows:

| Phone sent at | Server received | Result |
|---|---|---|
| 12:54:11.871 | **12:54:12** | 200 |
| 12:54:16.749 | **12:54:16** | 200 |
| 12:54:21.097 | **never — no entry at all** | stalled 25 s, client gave up |

The corroboration is stronger than the absence. The slow-but-**successful** load earlier that day —
14,135 ms — appears in the server log as an invocation at **12:43:44**, *one second before the phone
finished*. **The request arrived at the END of its delay, not the start.**

The function also cold-booted in **26 ms** (`booted (time: 26ms)`, Logs tab, 12:54:11) and answered
`200` to every request it actually received.

### 2.2 It is a failure rate, not a slowdown

Measured across 1,068 paired Alerts opens spanning months of `client_diagnostics`:

| Build | n | median invoke | p90 | slow ≥3 s |
|---|---|---|---|---|
| 290 | 39 | 467 ms | 1,238 | 0% |
| 301 | 48 | 366 ms | 1,783 | 2% |
| 311 | 15 | 285 ms | 550 | 7% |
| **325** | 118 | **351 ms** | 3,421 | **10%** |

Split for build 325 around the controlled testing:

| Build 325 | n | median | p90 | slow ≥3 s |
|---|---|---|---|---|
| Wael's normal use (before 13:11 EST) | 43 | 749 ms | 7,524 | **28%** |
| Controlled tests (13:14–13:41 EST) | 75 | 316 ms | 467 | **0%** |

**The median was never the problem** — 351 ms on 325 against 285 ms on 311. What is real is that
**28% of opens stall in normal use**, against 0–7% on the three preceding production builds.

> ⚠ An earlier reading of this data reported a "3.5× median degradation." That was an artifact of the
> mismeasured field described in §6.1 and is **withdrawn**. The conclusion — that something about 325
> in real use is worse — survived; the number did not.

### 2.3 The client binary never changed across the good→bad transition

`app.json` reached versionCode **325** at commit `608efb6` (2026-08-15 18:41 EST). The production AAB
was **built 2026-08-17 21:16 EST** from build-clone commit `3f754a6` and **released to Play on
2026-08-19 02:57**. No client-side commit landed between the version bump and the build:

```
git log --since='2026-08-15 18:42' --until='2026-08-17 21:16' -- app/ hooks/ lib/ components/
(empty)
```

So the same binary was fast for five days and then was not. **Whatever changed was not in the app.**

### 2.4 Everything server-side is cleared

- **Live probe, 2026-08-28**, five production Edge Functions, cold then warm:
  `manage-rules` 453/190/227/416 ms · `get-naavi-prompt` 134/121/105/121 · `lookup-contact`
  168/136/113/107 · `global-search` 214/202/198/175 · `resolve-place` 150/115/108/105.
  **Staging measured the same.** Production is not slow and its Edge runtime is not saturated.
- **`manage-rules` cannot itself be slow:** 393 lines, two imports, no chained function calls, and it
  queries exactly one table — `action_rules`, 52 rows project-wide.
- **Production database reads**: `user_settings` min 79 ms / p50 91 ms at the time of measurement.
- **Auth is not involved:** `getSession` on the *failing* attempt took **2 ms**. Across 200 samples
  its p50 is 3 ms and p90 is 24 ms.
- **Data volume is trivial:** `action_rules` 52, `gmail_messages` 283, `email_actions` 1,169,
  `list_connections` 3, `lists` 14. Five users hold Google tokens on production.

### 2.5 The staging APK is immune for a structural reason

`eas.json` sets `EXPO_PUBLIC_TEST_LOGIN_ENABLED=true` on the **staging** and **preview** profiles;
the **production** profile does not set it, and the EAS `production` environment holds only the
Supabase URL and key. [app/index.tsx:1267](../app/index.tsx) skips the 60-second background sync
whenever that flag is true.

**Consequence: there is no build installable outside Google Play that behaves like production.** A
preview APK is not the production app with a different backend — it is a different app. This is now
recorded permanently as **Architecture Reference §0e** (revision 16).

---

## 3. What was REFUTED, and by what measurement

Nothing in this section is an open question. Each was killed by evidence.

| Hypothesis | Killed by |
|---|---|
| The server / Edge Function saturation | Live probe: production ≈ staging, 105–453 ms (§2.4) |
| `manage-rules` itself | 393 lines, one 52-row table, no chained calls |
| Auth / session refresh | `getSession` = 2 ms on the failing attempt |
| Number of alerts | 45 rules returned in 751 ms; median flat from 0 to 39 rules |
| Edge Function cold start | Server log: `booted (time: 26ms)` |
| **B11x / the Aug 24 caching change** | Server never sees the stalled request at all (§2.1) |
| The Aug 27 `naavi-chat` / `get-naavi-prompt` deploys | Same — nothing server-side is in the path |
| Data growth / sentinel rows | 252 sentinels total, ~50/day; DB reads 79–91 ms |
| `client_diagnostics` volume | A few hundred rows/day now; unrelated to the request path |
| The 60-second background sync | **55 consecutive opens, 0 failures**, covering every offset in the 60-second cycle (§4.1) |
| Chat turns poisoning the screen | 5 opens at 292–505 ms immediately after four chat turns |
| Brief backgrounding | 2-second background at 13:23:57, no effect |
| Long suspension | **8 min 7 s** background, then 5 opens: 1,336 / 356 / 318 / 301 / 308 ms |
| The Google sign-in flow | Real sign-out 13:40:46, sign-in 13:40:59, then 10 opens at 284–469 ms |
| Process age / accumulation | Flat across 1,068 opens: median 351–480 ms in every age bucket from 0–5 min to over 4 hours |
| Network-state changes | 2 of 12 stalls within 30 s of one, vs 9% of fast opens — noise at n=12 |
| Duplicate auth listeners | Measured across 960 events: 1 listener, occasionally 2, rarely 3 |
| A leaking 4-second poll | `setError` calls `clearTimers()` — [useConversationRecorder.ts:132](../hooks/useConversationRecorder.ts) |

**Four of these were Claude's own hypotheses.** The pattern worth carrying forward: every structural
explanation that sounded right died on contact with a measurement, and the one thing that actually
narrowed the problem was Wael's recollection of when the phone was last fine (§1).

---

## 4. The controlled test protocol, and its results

Repeat this before proposing anything. It took about 30 minutes and produced **75 opens with zero
failures**, which is why the trigger is known to be absent from all of it.

All runs: build 325, production backend, app kept **on screen** throughout unless the step says
otherwise. Timestamps are the phone's own, read back from `client_diagnostics`.

### 4.1 Baseline after force-stop — 55 opens, 0 failures

Force-stop, reopen, then open Alerts continuously for ~4 minutes. Invoke times **209–693 ms**,
median ~310 ms. Offsets covered every second of the 60-second sync cycle (1, 3, 5, 8 … 57, 58, 59,
60). This is what refuted the sync-loop theory.

### 4.2 After chat — 5 opens, 0 failures

Four chat turns first (each 6–12 s end to end). Alerts then returned in **505 / 292 / 425 / 417 /
316 ms**.

### 4.3 After an 8-minute background — 5 opens, 0 failures

Background 13:30:53 → active 13:38:59 (**487 s**). Alerts: **1,336** ms on the first tap back, then
356 / 318 / 301 / 308 ms. The single elevated first value is ordinary reconnection.

### 4.4 After sign-out and sign-in — 10 opens, 0 failures

`SIGNED_OUT` 13:40:46, `SIGNED_IN` 13:40:59, then ten opens at **284–469 ms**.

---

## 5. What normal use contains that the protocol did not

This is the gap, stated honestly rather than filled with a guess.

28% of opens fail in Wael's real use; 0 of 75 failed under every condition that could be
constructed. The trigger is therefore something in real usage that §4 does not reproduce, and
**nothing currently logged distinguishes the two.** The app records the moment a request starts and
the moment it ends. The entire fault lives in the gap between, and that gap is empty.

Candidates that were considered and could **not** be tested from the desk: physical movement,
cellular versus WiFi, weak signal, network handover mid-request, and whatever else differs between a
phone in use and a phone on a desk. NetInfo is **not installed**, so network type is not recorded
anywhere.

---

## 6. Measurement caveats — read these before trusting any number

### 6.1 The mismeasured field (fixed 2026-08-28)

`alerts-load-invoke-end.ms` was computed as `Date.now() - t0`, where `t0` is set at
**`alerts-load-start`** — so the field named for the `manage-rules` call silently included
`getSession` and the `user_settings` query before it. It reported roughly double the call's duration
and produced the withdrawn "3.5×" finding in §2.2.

**Fixed** in [app/alerts.tsx](../app/alerts.tsx): `ms` now measures from `tInvoke`, and
`since_load_start_ms` preserves the old number so rows written before that build stay comparable.
**Rows logged before this fix must be read with the old meaning.**

The reliable measurement, and the one used throughout this document, is the **difference in
`ms_since_start` between the `alerts-load-invoke-start` and `alerts-load-invoke-end` rows** — the
device's own monotonic clock.

### 6.2 Suspension contaminates the tail

When Android suspends the app, JS timers freeze with requests in flight and fire on resume. This
produces absurd values — `ms: 494784`, `932566`, `35271618` — that are *not* network latency. Always
check for a `lifecycle-appstate` row near any large number. The 12:37 EST timeout was exactly this:
an 8 min 15 s "load" whose preceding row was `{"state":"active"}`.

### 6.3 `client_diagnostics` queries time out

There is no index on `step`, so filtered queries return
`57014 canceling statement due to statement timeout` intermittently. Use **keyset pagination on
`created_at`** (`&created_at=lt.<cursor>&order=created_at.desc&limit=120`); `offset` paging fails.
This is tracked as **T15**.

### 6.4 A version number is not a source revision

"APK 327" refers to two different builds from two different commits (2026-08-19 18:35 and
2026-08-21 04:56 EST), and 230 commits have landed since `app.json` was last bumped. Identify builds
by **commit hash from `eas build:list`**, never by version.

---

## 7. Corrections to the previous handoff

`docs/SESSION_HANDOFF_2026-08-28_AAB325_DELAY_NEXT.md` §1.6 contains two false claims. They are
corrected here rather than there, because that document is the record of what was believed at the
time.

1. **"T8's Epic queries … present in 325, absent in 327" is false.** T8 is commit `0452e53`,
   committed **2026-08-21 07:04 EST**. The staging APK 327 was built **2026-08-21 04:56 EST** — two
   hours and eight minutes *earlier*. The Epic code is in **both** builds. It is not a difference and
   explains nothing.
2. **"Ten client-side commits" is false.** There are **five** between the two builds, and four of
   them *add* 133 lines to `app/settings.tsx` (the S1 PIN work). The fast build has *more* Settings
   code than the slow one, which kills the code-delta theory in both directions.

Also corrected: the AAB was **built 2026-08-17 21:16 EST**; 19 August is the Play *release* date.

---

## 8. RESUMPTION POINT — the instrumented AAB

If the symptom returns, this is the next step. It was designed, approved in principle, and **not
built** — Wael parked the work first.

### 8.1 What to add

One file, [lib/invokeWithTimeout.ts](../lib/invokeWithTimeout.ts). A module-level counter of
in-flight requests, and **a single timed retry when one times out**:

```ts
let inFlight = 0;
const inFlightNames = new Set<string>();

// on timeout only:
const retryStart = Date.now();
const retry = await Promise.race([runInvoke(), timeoutAfter(10_000)]);

remoteLog(diagSession, 'invoke-stall', {
  fn: fnName,
  first_wait_ms: Date.now() - started,   // what the stall cost
  retry_ms: Date.now() - retryStart,     // what a fresh attempt costs
  retry_ok: retry !== TIMEOUT,
  concurrent_at_start: concurrentAtStart,
  concurrent_names: concurrentNames,     // what else was running
});
```

### 8.2 Why this one measurement decides it

If the request fails at 15 s and an immediate retry returns in ~300 ms, **the first connection was
dead and the phone waited on it** — proven, not inferred. If the retry also stalls, it is not the
connection, and that eliminates the last standing candidate.

It also captures what else was in flight at that instant, which nothing currently records (§5).

**Note deliberately:** that retry is a diagnostic, but if it succeeds it is also the mitigation. Such
a build would make Alerts appear to work while measuring why it did not. The numbers matter more than
the behaviour.

### 8.3 What cannot be measured, and must not be promised

- **Network type (WiFi vs cellular)** — needs NetInfo, which is not installed; adding it changes the
  native build.
- **DNS, connect and TLS phase timings** — React Native's networking does not expose them.

Both were promised during this investigation before being checked. They are not available.

### 8.4 How to get it onto the phone

**Do not use a preview or staging APK** — §2.5 explains why it would measure a different app.

1. Bump `app.json` and `app/settings.tsx` to the next versionCode.
2. `eas build --platform android --profile production` — **no `--auto-submit`**.
3. Upload the AAB to **Play Console → Internal app sharing**. No track, no testers, no review.
4. Install from the private link. It carries Play's signing certificate, so Google Sign-In works.
5. Use the phone normally. **One stall is enough.**

**Gates:** Wael ruled on 2026-08-28 that the three test gates do **not** apply to a build distributed
this way — *"we do not need any gate, we will not publish this one."* They guard the path to real
users, and this build never enters it. **This ruling covers diagnostic builds only.** Any AAB going
to a Play track still requires all three.

---

## 9. Open consequence of parking

**Build 325 is live on Open Testing.** Any tester on it has the same ~28% Alerts/Settings failure
rate. That is the cost of parking, stated so the decision stays visible.

---

## 10. Related records

- **Architecture Reference §0e** (revision 16, 2026-08-28) — staging and preview builds cannot
  exercise production behaviour, and the Internal app sharing route that can.
- **T15** — `client_diagnostics`: 1,255,686 rows, no retention, no index on `step`; keep-with-limits
  or retire. Opened 2026-08-28.
- **B12k** — Naavi too slow to answer on voice. Chat turns measured 6–12 s during §4.2, consistent
  with that item; not investigated here.
- `docs/SESSION_HANDOFF_2026-08-28_AAB325_DELAY_NEXT.md` — the prior record. **Read §7 above before
  trusting its §1.6.**

---

*Investigation 2026-08-28, Wael and Claude. Parked by Wael the same day. All times EST.*
