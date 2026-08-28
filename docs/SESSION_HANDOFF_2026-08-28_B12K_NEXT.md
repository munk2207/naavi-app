# Session handoff — 2026-08-28 (evening)

**⚠ Two handoffs carry today's date.** This one is later and supersedes
`SESSION_HANDOFF_2026-08-28_AAB325_DELAY_NEXT.md`, whose Part 2 analysis was investigated and largely
disproved. Do not start from that file.

---

## ⭐ NEXT SESSION, THE ONE JOB: B12K

**B12k — Naavi is too slow to answer on voice.** Top of the priority list, taking T14's slot on its
closure. **Start at Phase 0.**

**Read the B12k row in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` first.** It already holds
every measurement, so this handoff does not repeat them. The three things that shape the work:

1. **Full Phase 0–8 governance.** The voice server file is Protected Core in its entirety
   (Architecture Reference §4, Voice orchestration). Every phase transition needs Wael's own separate
   word — a reviewer's "Approved" is never authorization.
2. **The time is server-side, and intermittent.** On the 110-second call: Claude's reasoning 3.6 s,
   the calendar fetch **16.6 s**, the notes search **18.3 s** — and those same two operations took
   1.0 s and 2.3 s ninety seconds earlier *in the same call*. A further 71 s sat between the answer
   being ready and audio starting.
3. **One fast call is not evidence a fix worked.** The row says so explicitly. Any remedy must be
   measured across repeated trials. If a prompt or classifier is touched, the Non-Determinism Rule
   requires a minimum of three trials per behaviour-changing case.

**⚠ Do NOT inherit this session's conclusion.** Today's investigation proved that a *mobile* delay
was entirely client-side and that the backend was innocent. **B12k's evidence points the opposite
way.** Carrying that prior across subsystems would be exactly the error this project keeps paying
for.

**Architecture Reference is at revision 16** (bumped today). Phase 1A's Version Verification should
record that number.

---

## What happened this session

### AAB 325 delay — investigated hard, PARKED UNSOLVED by Wael

Full record: **`docs/AAB325_DELAY_INVESTIGATION_2026-08-28.md`**. Do not re-derive it.

- **Proven:** the delay happens on the phone, **before a byte reaches Supabase**. Supabase's own
  Invocations log has no entry for the stalled request, and the slow-but-successful 14.1 s load
  arrives one second before the phone finishes. The server cold-boots in 26 ms and returns 200 to
  everything it receives.
- **Proven:** it is a failure **rate**, not a slowdown — 28% of opens in normal use against 0–7% on
  builds 290/301/311. The median never moved (351 ms vs 285 ms).
- **17 hypotheses refuted**, each with the measurement that killed it (§3), including the 60-second
  sync loop, chat, backgrounding, sign-in, process age, and the whole Aug 24 B11x caching theory.
- **75 controlled opens, zero failures** across every constructible condition (§4, repeatable as
  written).
- **Resumption point** is §8: an instrumented production AAB delivered through Internal app sharing.
- **Open consequence:** build 325 is still on Open Testing, so testers carry the same 28%.

**Wael's ruling on gates, recorded and scoped:** the three test gates do **not** apply to a build
distributed by Internal app sharing — *"we do not need any gate, we will not publish this one."*
**Diagnostic builds only.** Any AAB reaching a Play track still needs all three.

### Also landed

- **Architecture Reference → revision 16**, new **§0e**: staging and preview builds set
  `EXPO_PUBLIC_TEST_LOGIN_ENABLED`, which skips the 60-second background sync, so **no build
  installable outside Google Play behaves like production**. A preview APK is a different app, not
  the production app with another backend. Records the Internal app sharing route that does work.
- **T15 opened** — `client_diagnostics` holds **1,255,686 rows**, a temporary April table never
  switched off, no retention, no index on `step`. The item is the decision — keep with an index and a
  cutoff, or retire — not a predetermined fix. Explained and approved individually per Rule 1b.
- **`app/alerts.tsx` fixed** — `alerts-load-invoke-end.ms` measured from load start, not invoke
  start, so a field named for the call silently included `getSession` and the `user_settings` query.
  It produced a false "3.5× slower" reading, now withdrawn. `since_load_start_ms` preserves the old
  number. **Rule 15a gap surfaced:** no auto-tester coverage, mobile client logging the harness
  cannot reach.

---

## Repository state

- **Commit `1328b7b`** pushed to `main` — four files. Pre-push hooks passed: schema/code check clean
  on both projects (163 files, 1,553 column references), parity tripwire no divergence.
- **Left dirty deliberately, not mine:** `docs/.obsidian/workspace.json` and
  `supabase/.temp/cli-latest`, both modified before this session began.
- **Nothing is pending, nothing is half-applied.**

---

## Things worth carrying forward

- **A version number is not a source revision.** "APK 327" covers two builds from two different
  commits, and 230 commits have landed since `app.json` was last bumped. Identify builds by commit
  hash from `eas build:list`.
- **Suspension contaminates timing data.** Values like `ms: 494784` are frozen JS timers, not
  latency. Check for a nearby `lifecycle-appstate` row before believing any large number.
- **`client_diagnostics` queries need keyset pagination** on `created_at`; `offset` paging times out
  because there is no index on `step`.
- **The thing that actually broke the investigation open was Wael's own recollection** — that build
  325 was fine when he installed it on 19 August. Every structural theory had failed; the timeline
  he supplied is what redirected it. Ask him what he saw and when, earlier rather than later.

---

*Session closed 2026-08-28. All times EST.*
