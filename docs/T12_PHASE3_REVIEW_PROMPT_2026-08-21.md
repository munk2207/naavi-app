# T12 — Phase 3: Technical Review Prompt (Before Coding)

**For:** External Technical Reviewer (ChatGPT)
**From:** Claude Code (Implementation Engineer)
**Date:** 2026-08-21
**Risk:** HIGH · **Protected Core:** Notification routing, API contracts
**Governance:** MyNaavi AI Development Governance v4.1

---

## ⭐ Response format required (Governance §1, Reviewer Response Format Rule, v4.1)

**State the verdict first. Then only mandatory changes, blockers, or material risks.**

Do not restate this document, do not repeat evidence already given, and do not explain at length
unless it is needed to justify a rejection or a required change. Read everything and think as hard as
the change warrants — the constraint is on your *output*, not your review.

**Close with the §14 Claude Implementation Handoff:** Decision · Mandatory Changes · Architecture
Requirements · Regression Requirements · Scope Restrictions · Verification Checklist.

**And per Governance Phase 3, close with Implementation Boundaries Confirmed** — which files are
authorized and what change in each, that no additional files are approved, that no opportunistic
refactoring is approved, and what is explicitly excluded.

---

## 1. What T12 is, in one paragraph

Naavi's voice platform has two environments (staging and production Railway services) that both call
Supabase Edge Functions. **The Edge Functions live in a different repository from the voice server**,
so promoting voice — merging `staging` → `main` — moves the voice code and moves **none** of the 32
Edge Functions it calls. Nothing has ever compared those functions between the two Supabase projects.
T12 establishes equilibrium once and then holds it mechanically.

**The controlling question, set by the Product Owner and never to be lost:**

> **What prevents Voice Staging from being a functional replica of Voice Production at the starting
> equilibrium?**

**Phase 1 answered: 26 of 32 functions are already equal.** Four obstacles remain, none structural.
**Conclusion: YES, equilibrium is achievable.** Phases 0, 1, 1A and 2 are approved by Wael.

**Scope is VOICE ONLY** — his explicit decision. Mobile is excluded as a target but is a regression
surface.

---

## 2. What is already decided — please do not re-litigate

| Decided | By | Where |
|---|---|---|
| Voice-only scope; mobile excluded | Wael | Phase 0 |
| The 4 guard-carrying functions may be deployed to production | Wael, on evidence | Phase 1 §6.1 |
| Uncommitted code may not be in the staging baseline | Wael | Phase 1 §6.2 |
| `receive-demo-sms-reply`'s absence is a defect, not an intentional difference | Evidence | Phase 1 §6.3 |
| **Path B**: commit for controlled source, redeploy staging from `HEAD` — do not ship a functional change to production under T12 | Wael | Phase 1 §6 |
| The `send-push-notification` added DB read is accepted | Wael | Phase 2 §3 |
| Test coverage first; never put staging in a knowingly broken state to test it | Wael | Phase 2 §8.1 |
| Gate enforces the 32 voice functions only | Wael | Phase 2 §8.2 |

---

## 3. The plan you are reviewing

### 3a. Tooling to be built (no Edge Function source is modified — Phase 0 forbids it)

**`scripts/deploy-edge-function.js`** — wraps `supabase functions deploy` and:
- **refuses to deploy when the working tree is dirty for that function**;
- records slug, target project, git commit, and a **normalized source hash** (whitespace-collapsed);
- prints the environment resolved from the project ref, not from a variable.

**`scripts/edge-function-parity-check.js`** — two modes:

| Mode | Compares | Speed | Binding |
|---|---|---|---|
| `parity:check` | the recorded manifest, against a baseline of accepted differences | seconds | **pre-push**, fails closed |
| `parity:verify` | **downloaded deployed source from both projects**, diffed | ~10 min | on demand; before any promotion; rewrites the manifest from reality |

Plus a baseline file, a manifest file, a `.githooks/pre-push` entry, `package.json` scripts, a new
auto-tester catalogue file, and a `tests/runner.ts` registration.

**`parity:check` will also assert `OUTBOUND_ALLOWLIST` is unset on production and fail closed if it
ever appears** — see 3c.

### 3b. Deploys

| # | Target | Functions | Behaviour change |
|---|---|---|---|
| D1 | staging | `create-contact` from `HEAD` | **yes, on staging** — gated by the open question in §4.1 |
| D2 | production | `send-sms`, `send-user-email`, `ingest-ticket` | **none** — guard inert, additive-only, zero removals |
| D3 | production | `send-push-notification` | **one added DB read per send** |
| D4 | production | `receive-demo-sms-reply` | **yes — fixes a live defect** |

**Order:** T0 test → T1 commit → T2 build tooling → T3 capture baseline → T4 (D2) → T5 (D3, separate
so its cost is measurable in isolation) → T6 (D4) → T7 (D1) → **T8 `parity:verify` to demonstrate
equilibrium by measurement.**

**Wael's stated acceptance point is T8:** *"after the work, actual measurement must demonstrate
equilibrium. That is the proof T4 was missing."*

### 3c. Why the guard deploys are safe

`supabase/functions/_shared/outbound_guard.ts` no-ops when `OUTBOUND_ALLOWLIST` is unset. Verified
two independent ways: the code's own early return, and **live secret lists showing the variable
absent on production and present on staging**. Full diffs of all four functions show **zero removals**
— every changed line is the guard import plus one guard block.

**Consequence worth your attention:** today production is protected two ways (no guard code *and* no
secret). After T12 it is protected one way (no secret). That is the design's stated model, but it
converts a structural property into a configuration invariant.

---

## 4. What I most want challenged

**4.1 — An unproven behaviour that gates D1.** `naavi-chat` calls `create-contact` with a
**service-role key and `user_id` in the body**. Committed `HEAD` — what production runs — has no
body-`user_id` path and resolves the user only via `auth.getUser()` on the Authorization header.
**Whether `auth.getUser()` resolves a user from a service-role JWT is not proven.** If it does not,
ADD_CONTACT is already broken on production through both entry points, and Path B would import that
into staging. The plan's T0 answers this before D1. **Is deferring this to T0 correct, or should it
block Phase 4 entirely?**

**4.2 — Does the manifest create the very false confidence T12 exists to remove?** `parity:check` is
fast because it trusts a file the deploy wrapper writes. Anyone using the raw CLI bypasses it, and
the manifest would then assert equilibrium that does not exist. My mitigation is `parity:verify` as
ground truth. **Is a fast-but-trusting pre-push gate plus a slow-but-true on-demand check the right
split, or is it a gate that reports confidently and means nothing — the exact failure mode this
project has now hit three times?**

**4.3 — Is the dirty-tree refusal the right enforcement point for "deploy from git"?** It is the
mechanism intended to prevent a recurrence of staging running uncommitted code. It can be bypassed by
using the CLI directly. **Is there a stronger point of enforcement that does not require CI, which
this project does not have?**

**4.4 — Hidden coupling in `send-sms`.** It has **eight Shared Core consumers** (`_shared/task_actions.ts`,
`check-reminders`, `evaluate-rules`, `geofence-health-check`, `ingest-ticket`, `manage-voice-pin`,
`report-location-event`, `send-ticket-reply`) plus mobile and voice. The deploy is additive and inert
on production. **Is "additive with zero removals, and the added path cannot activate without a secret
that is absent" sufficient to consider these ten consumers unaffected, or does the Regression Matrix
need per-consumer testing?**

**4.5 — Deploy ordering and rollback.** All deploys are additive and revertible by redeploying a prior
source; copies of every current deployed version have already been captured. No migration, no data
change. **Is anything in the T0–T8 order wrong, and is "redeploy the previous source" a sufficient
rollback for Protected Core notification routing?**

**4.6 — Accepting the `send-push-notification` DB read.** An unconditional `user_settings` read runs
before the inert check, so it executes on every production push send. Accepted because the fix would
be a source change, which Phase 0 forbids. Phase 5 will measure latency before and after.
**Is accepting a permanent cost to avoid a scope violation the right trade here, or should Phase 0 be
amended?**

---

## 5. Deferred Architectural Decisions (recorded, not proposed for this implementation)

- **Deploying Edge Functions from CI.** Would solve the enforcement problem properly. **Not
  approved** — no CI exists in this repository at all, and introducing it is far beyond T12's scope.
  Reconsider if a second class of deployment drift appears.
- **Extending parity enforcement to all 82 functions.** **Not approved** — Wael ruled T12 must not
  drift into non-voice parity. Reconsider when voice equilibrium has held for a period.
- **Moving the `send-push-notification` guard query inside the `enforced` check.** **Not approved** —
  it is a source change and Phase 0 excludes those. Reconsider if Phase 5's measurement shows a real
  cost.

---

## 6. Required output

Per §13's Mandatory Review Gates, evaluate in order: Scope Compliance · Governance Compliance ·
Architecture Compliance · Technical Correctness · Evidence Sufficiency.

Decision: **Approved** / **Approved with Mandatory Changes** / **Rejected**.

Note: your approval is **not** authorization to begin Phase 4. Per Governance §3's Phase-Gate
Approval Rule, only Wael's own separate word starts the next phase.
