# T12 — Phase 2: Change Plan

**Work item:** [[T12]] — Voice environment equilibrium
**Date:** 2026-08-21
**Scope:** VOICE ONLY (Phase 0, approved)
**Architecture Reference version:** 2026.07.18.8 (per Phase 1A)
**Risk classification: HIGH**
**Status:** **APPROVED — Wael, 2026-08-21**, with both §8 decisions made. See §8.

**No code written in this phase. No deploys performed.**

**⭐ Wael's stated acceptance point for the whole work item:** *"the most important acceptance point
remains **T8**: after the work, actual measurement must demonstrate equilibrium. That is the proof T4
was missing."* T8 is not a closing formality — it is what T12 is judged on.

---

## The controlling question this plan serves

> **What prevents Voice Staging from being a functional replica of Voice Production at the starting
> equilibrium?**

Phase 1 identified four obstacles and answered **YES**. This plan says exactly how each is removed
and how equilibrium is then held.

---

## ⛔ 0. A BLOCKER FOUND WHILE BUILDING THE REGRESSION MATRIX

**Path B, as approved, may revert staging into a broken state — and production may already be in
that state.**

**What the consumer trace found.** `supabase/functions/naavi-chat/intentHandlers.ts:1091-1094`
calls `create-contact` like this:

```
headers: { Authorization: `Bearer ${serviceKey}` },
body:    JSON.stringify({ name, phone, email, user_id: userId }),
```

It sends a **service-role key** as the bearer token and **`user_id` in the body**. The body-`user_id`
path exists **only in the uncommitted change**. Committed `HEAD` — which is what production runs —
has no body-`user_id` path at all: it resolves the user solely via `userClient.auth.getUser()` on
the Authorization header, and returns 401 when that fails.

**What is proven:**
- `naavi-chat` sends `user_id` in the body. *Evidence: `intentHandlers.ts:1094`.*
- Production's deployed `create-contact` ignores it entirely. *Evidence: full diff, Phase 1 §6.2.*
- The voice server sends **no `user_id` at all** — `{name, email, phone}` only. *Evidence:
  `naavi-voice-server/src/index.js:5265-5269`.*
- **`create-contact` has no auto-tester coverage.** It is absent from the multi-user matrix.
  *Evidence: `grep -rn "create-contact" tests/` returns only two incidental comment mentions.*

**What is NOT proven, and must not be assumed:** whether `auth.getUser()` resolves a user when
handed a service-role JWT. **Root cause not proven.** If it does not, ADD_CONTACT is already broken
on production through both entry points, and Path B would import that breakage into staging.

**This does not invalidate Path B.** It adds one precondition: **establish the behaviour before
reverting staging.** §7 proposes how.

---

## 1. Files that will change

**No Edge Function source is modified by this work item.** Phase 0 forbids source changes. Two
existing files are brought under version control unchanged; everything else is new tooling or
documentation.

| # | File | Classification | Change |
|---|---|---|---|
| 1 | `supabase/functions/create-contact/index.ts` | Backend | **Committed as-is.** Already modified in the working tree; not edited further. Path B's controlled-source step |
| 2 | `supabase/functions/_shared/contact_date_facts.ts` | Backend | **Committed as-is.** Currently untracked |
| 3 | `scripts/edge-function-parity-check.js` | **NEW** — Tooling | The equilibrium gate. §4 |
| 4 | `scripts/deploy-edge-function.js` | **NEW** — Tooling | Deploy wrapper. Refuses a dirty tree, records what was deployed. §4 |
| 5 | `docs/T12_function_parity_manifest.json` | **NEW** — Configuration | What each project has deployed, per function |
| 6 | `docs/T12_accepted_function_differences.json` | **NEW** — Configuration | Deliberate differences, with a written reason each |
| 7 | `.githooks/pre-push` | Configuration | Adds a third gate beside drift and schema/code |
| 8 | `package.json` | Configuration | `parity:check`, `parity:verify`, `deploy:fn` scripts |
| 9 | `tests/catalogue/t12-edge-function-parity.ts` | **NEW** — Tests | Rule 15a coverage |
| 10 | `tests/runner.ts` | Tests | Registers the above |
| 11 | `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` | Documentation | Phase 8. §6 |

## 2. Deploys (not file changes)

| # | Target | Function(s) | Why | Behaviour change |
|---|---|---|---|---|
| D1 | **Staging** | `create-contact` from `HEAD` | Path B — remove ungoverned code | **Yes, on staging.** Gated by §0 |
| D2 | **Production** | `send-sms`, `send-user-email`, `ingest-ticket` | Guard, cleared by Phase 1 §6.1 | **None.** Guard inert; additive-only, zero removals |
| D3 | **Production** | `send-push-notification` | Guard | **One added DB read.** §3 |
| D4 | **Production** | `receive-demo-sms-reply` | Missing function it actively calls | **Yes — fixes a live defect** |

---

## 3. ⭐ The `send-push-notification` DB read — carried explicitly, per Wael's Phase 1A instruction

`supabase/functions/send-push-notification/index.ts:198-218` opens its guard block with an
**unconditional** read:

```
const { data: idn } = await adminClient
  .from('user_settings').select('phone, email').eq('user_id', userId).maybeSingle();
```

It executes before any `enforced` check. On production nothing is blocked, **but this query runs on
every production push send.**

**Decision recorded, not discovered:** accepted as-is. One indexed single-row read on a path that
already performs several. The alternative — moving it inside an `enforced` check — is a source
change, which Phase 0 forbids. **The other three guard deploys have no such cost:** `guardDestination`
is a pure function over an environment variable.

**Phase 5 must measure it** (push latency before/after on production) so Phase 6 can audit that the
acceptance was informed rather than assumed.

---

## 4. The mechanism — how equilibrium is held

Phase 1 §5 named three causes. Two tools address all three.

### 4a. `deploy-edge-function.js` — addresses Cause 1 and Cause 3

Wraps `supabase functions deploy` and:

1. **Refuses to deploy when the working tree is dirty for that function.** This is Cause 3 —
   deployment not coming from git — and it is the one that defeats every other mechanism. Had this
   existed, staging's `create-contact` could not have happened.
2. Records into the manifest: slug, target project, **git commit**, and a **normalized source hash**
   (whitespace-collapsed, so the §0c "one extra space" failure cannot recur).
3. Prints which environment it deployed to, resolved from the project ref — not from a variable.

### 4b. `edge-function-parity-check.js` — addresses Cause 2

**Two modes, because one cannot be both fast and authoritative:**

| Mode | What it does | Speed | Binding |
|---|---|---|---|
| `parity:check` | Compares the **manifest** for the 32 voice-boundary functions against the accepted-differences baseline | seconds | **pre-push**, fails closed |
| `parity:verify` | Downloads deployed source from **both projects** and diffs it — ground truth | ~10 min | On demand, and before any production promotion |

### ⛔ THE MANIFEST IS NEVER PROOF OF EQUILIBRIUM (Phase 3 Mandatory Change 2, 2026-08-21)

**Reviewer's words, adopted:** *"The manifest cannot itself be called proof of equilibrium.
`parity:verify`, which downloads and compares actual deployed source, is the authoritative evidence.
T8 must pass before T12 can claim Voice Staging = Voice Production."*

**Binding consequences:**

1. **`parity:check` is a tripwire, not evidence.** It records what the wrapper *believes* it
   deployed. Anyone using the raw CLI bypasses it entirely. It may catch divergence; it may never be
   cited as demonstrating equality.
2. **`parity:verify` is the only authoritative source**, because it reads deployed source from both
   projects and diffs it. Its result rewrites the manifest from reality rather than trusting it.
3. **T12 may not claim Voice Staging = Voice Production on any basis other than a passing
   `parity:verify` at T8.** Not on the manifest, not on the deploy log, not on this plan being
   followed.
4. **The tooling must enforce this rather than rely on discipline.** `parity:check` output must state
   in its own text that it is not proof of equilibrium and name `parity:verify` as the authority —
   so a future reader of a green `parity:check` cannot mistake it for what it is not.

**This is the same failure this project has already hit three times** — `ezbr_sha256`, raw-hashed
function bodies, and truncated cron commands each produced a confident comparison that was wrong. A
manifest that is trusted rather than verified would be the fourth.

**Why `parity:verify` is not on pre-push:** 32 functions × 2 projects at roughly ten seconds each.
A ten-minute pre-push hook gets disabled by the first person it inconveniences, and a disabled gate
is worse than none.

**⚠ Hard design constraint, from Phase 1 §4:** the gate **must diff source**. `ezbr_sha256` is not a
source hash — it produced 15 false positives out of 20. Deploy timestamps are equally invalid here,
because **code is deployed before it is committed in this project**. Neither may appear in the
implementation.

### 4c. The `OUTBOUND_ALLOWLIST` invariant — Phase 1A §3.3

After D2/D3, production's containment rests on that secret being absent rather than on the code being
absent. **`parity:check` will assert `OUTBOUND_ALLOWLIST` is unset on production and fail closed if
it ever appears.** Per the recorded lesson: make it refuse, don't make it warn.

---

## 5. Change Impact Matrix

Every row answered explicitly. An omitted row is not "not affected."

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **YES — as a regression surface only, not a target** | Mobile calls `send-sms`, `send-push-notification` and `ingest-ticket`. D2/D3 are additive with the guard inert, so no behaviour change is expected — but mobile is exercised in Phase 7 regardless |
| **Voice** | **YES** | All five deployed functions are on the voice boundary. D4 fixes a live voice/demo defect |
| **Shared Core** | **YES** | All five are Shared Core Edge Functions. **No source is modified** — they are deployed, not changed |
| **Database** | **NO** | No migration, no schema change, no new table, no new column. T4/T5 already closed schema parity |
| **Cron** | **NO** | No cron job added, removed or rescheduled. `evaluate-rules` and `check-reminders` are consumers of the changed functions, not themselves changed |
| **API contracts** | **NO** | No request or response shape changes. The guard's `200 {blocked:true}` response can only be produced when `OUTBOUND_ALLOWLIST` is set, which is staging-only |
| **Tests** | **YES** | New catalogue file plus a `runner.ts` registration, per Rule 15a |

## 5a. Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** **No** — it deploys existing Shared Core code. Files 1
  and 2 are committed unchanged.
- **Does this change modify an Entry Point?** **No.** No change to `useOrchestrator.ts`, `app/`, or
  `naavi-voice-server/src/`.
- **Does this change introduce new duplication?** **No.** Phase 1A §2a verified there is no second
  guard implementation on any surface.
- **Does this change eliminate existing duplication?** **No.** It eliminates *deployment divergence*,
  which is not duplication in the §0.4 sense.
- **Does this change modify Protected Core?** **Yes — by deployment, not by edit.** Notification
  routing (three of the five functions). This is why Phase 3 and Phase 6 external review are
  mandatory.

---

## 6. Regression Impact — the fixed checklist

Each answered explicitly; silence is not acceptable.

| Area | Affected | Basis |
|---|---|---|
| **Voice commands** | **Yes** | Five voice-boundary functions deployed. Phase 7 must exercise ADD_CONTACT, an SMS-sending alert, and the demo STOP path |
| **Geofencing** | **No** | `report-location-event` and `geofence-health-check` are unchanged. They *call* `send-sms`/`send-push-notification`, so they appear in the Regression Matrix as consumers, but no geofence code or config changes |
| **Gmail integration** | **No** | `sync-gmail` is byte-identical across both projects and is not deployed |
| **Calendar integration** | **No** | `create-calendar-event` and `delete-calendar-event` are byte-identical across both projects and are not deployed |
| **Reminders** | **Yes, indirectly** | `check-reminders` calls three of the four guard functions. Not itself deployed; its send path gains the inert guard |
| **SMS / call alerts** | **Yes — the highest-risk area in this plan** | `send-sms` is the single most-consumed function here: 8 Shared Core callers plus mobile and voice |
| **Onboarding** | **No** | No auth, no `store-google-token`, no `user_settings` write-path change |
| **Staging build** | **Yes** | D1 changes staging behaviour. No APK or AAB is produced by this work item |

## 6a. Regression Matrix — consumer trace

Produced by searching, not from memory. Every consumer of every function being deployed.

| Function | Shared Core consumers | Mobile | Voice |
|---|---|---|---|
| `send-sms` | `_shared/task_actions.ts`, `check-reminders`, `evaluate-rules`, `geofence-health-check`, `ingest-ticket`, `manage-voice-pin`, `report-location-event`, `send-ticket-reply` | `app/index.tsx`, `hooks/useOrchestrator.ts` | `src/index.js` |
| `send-user-email` | `_shared/task_actions.ts`, `check-reminders`, `evaluate-rules`, `global-search/adapters/contacts.ts`, `report-location-event` | **none** | `src/index.js` |
| `send-push-notification` | `check-reminders`, `evaluate-rules`, `geofence-health-check`, `report-location-event` | `lib/push.ts` | `src/index.js` |
| `ingest-ticket` | `naavi-chat/intentHandlers.ts` | `app/contact.tsx`, `app/report.tsx` | `src/index.js` |
| `receive-demo-sms-reply` | none | none | `src/index.js:7762` |
| `create-contact` | `naavi-chat/intentHandlers.ts:1091` | **none** | `src/index.js:5259` |

**Why each consumer is safe for D2/D3:** the deploy is additive with zero removals (Phase 1A §3.1),
and the added code returns `{allowed: true, enforced: false}` on production because
`OUTBOUND_ALLOWLIST` is absent (verified live, Phase 1 §6.1). **No consumer's contract changes.**

**The exception is `create-contact` (D1)**, whose two consumers both depend on behaviour that differs
between `HEAD` and the working tree. That is §0's blocker.

---

## 7. Proposed order, and the one live test that must come first

### ⛔ T0 IS A HARD GATE ON ALL DEPLOYMENT (Phase 3 Mandatory Change 1, 2026-08-21)

**T0 — Establish `create-contact`'s real behaviour on `HEAD`.**

**The reviewer strengthened this and the strengthening is adopted verbatim:** *"4.1 / T0 must be a
hard gate before any deployment. Establish `create-contact` behavior first. D1 cannot proceed without
a conclusive result."*

**This is broader than the plan originally had it.** The first draft gated only D1 on T0 and allowed
D2, D3 and D4 to proceed first. **That is now prohibited: no deployment of any kind — D1, D2, D3 or
D4, staging or production — may occur until T0 returns a conclusive result.**

**Why the reviewer is right and the original ordering was wrong:** T0's question is whether a
service-role caller can resolve a user against committed `HEAD`. If the answer is no, then
ADD_CONTACT is already broken on production, which means **the assumption that "production == HEAD is
a healthy baseline" is false** — and that assumption is load-bearing for every other deploy in this
plan, not only D1. Deploying D2–D4 first would mean building equilibrium on top of a baseline not yet
known to be sound.

**"Conclusive" means:** the service-role + body-`user_id` case has been exercised against the project
running `HEAD`, and the resulting status and body are recorded in the Phase 5 evidence package. An
inference from reading the code is not conclusive.

**T1 — Commit files 1 and 2.** Controlled source. No deploy.

**T2 — Build the tooling** (files 3–10). No deploys. Gate verified in **both directions** — green at
baseline, and exit non-zero with the push refused on an injected divergence — the same standard T4's
drift check was held to.

**T3 — `parity:verify` to capture the true starting state**, and write the baseline.

**T4 — D2 to production** (`send-sms`, `send-user-email`, `ingest-ticket`). Highest-consumer
functions, no behaviour change.

**T5 — D3 to production** (`send-push-notification`), separately from T4 so the added DB read can be
measured in isolation.

**T6 — D4 to production** (`receive-demo-sms-reply`). Fixes the demo STOP defect.

**T7 — D1 to staging**, contingent on T0.

**T8 — `parity:verify` again.** Equilibrium demonstrated by measurement, not asserted.

**Rollback.** Every deploy is `supabase functions deploy` of a known prior source, recoverable from
the downloaded copies already captured this session and from git. D2/D3/D4 are additive, so rollback
is redeploying the previous version — no data migration, nothing to undo. **T1 is a commit and is
revertable. Nothing in this plan is irreversible.**

---

## 8. Decisions — MADE by Wael, 2026-08-21

### 8.1 — DECIDED: Option 3. Automated coverage first; Option 1 only if the result is ambiguous.

**Wael's words:** *"Add `create-contact` to the automated test coverage first. If the result remains
ambiguous, use Option 1. **Do not knowingly put Staging into a potentially broken state just to test
it.**"*

**Option 2 is therefore ruled out explicitly** — deploying `HEAD` to staging in order to observe it
break is exactly the thing prohibited. This also constrains T7: D1 may only run once the behaviour is
known, never as the experiment that determines it.

**⚠ A refinement Phase 4 must implement, found while reading the harness.** The stock matrix's test
(b) calls with `mode: 'anon'` (`tests/lib/multiUserMatrix.ts:125`) — anon key plus body `user_id`.
**Neither real caller uses that shape.** Both send the **service-role** key:

| Caller | Auth | Body `user_id` |
|---|---|---|
| `naavi-chat/intentHandlers.ts:1093-1094` | `Bearer ${serviceKey}` | **yes** |
| `naavi-voice-server/src/index.js:5263-5269` | `Bearer ${SERVICE_ROLE_KEY}` | **no** |

The helper already supports `mode: 'service'` (`multiUserMatrix.ts:72-75`); the generated test simply
does not use it for test (b). **So the `create-contact` entry needs a third case — service-role key
plus body `user_id` — or it will answer a question nobody asked.** A stock matrix entry alone would
confirm only what the diff already proved.

**And it must be run against PRODUCTION to answer the question**, because production is the project
running `HEAD`; staging runs the fixed copy and would report success regardless. Per CLAUDE.md, a
production run of the auto-tester writes and wipes rows on the gates account
`mynaavi2207@gmail.com` — that is by design for that account, but it is a production write and needs
Wael's explicit go-ahead at execution time, not merely this plan's approval.

### 8.2 — DECIDED: enforcement strictly on the 32 voice functions.

**Wael's words:** *"I would **not gate all 82** in T12. Reporting the other 50 is acceptable if
essentially free, but T12 must not drift into solving non-Voice parity."*

**Implementation consequence:** the gate's failure set is the 32-function voice boundary, full stop.
The other 50 may appear in output **only if reporting them costs nothing extra** — i.e. they are
already in the same fetched data. **If reporting them requires additional work, additional runtime,
or a second baseline file, they are omitted.** No non-voice function may ever fail the build under
T12.

---

## Required output

Decide 8.1 and 8.2. Per Governance §3's Phase-Gate Approval Rule, Phase 3 does not begin until
Wael's own separate go-ahead.
