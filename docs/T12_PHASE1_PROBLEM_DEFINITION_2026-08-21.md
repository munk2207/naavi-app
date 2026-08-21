# T12 — Phase 1: Problem Definition

**Work item:** [[T12]] — Voice environment equilibrium
**Date:** 2026-08-21
**Scope:** VOICE ONLY (Phase 0, approved with mandatory changes)
**Architecture Reference version used:** 2026.07.18.8
**Revision 2** — restructured on Wael's Phase 1 review: the controlling question governs the
document, his three §6 decisions are applied, and the YES/NO conclusion is now the output.
**Status:** **APPROVED — Wael, 2026-08-21.** The YES conclusion is confirmed and **Path B is
chosen** (§6): commit the change for controlled source, redeploy staging from `HEAD`, and let
`create-contact` become the first change to travel the intended lifecycle —
**equilibrium → change staging → test → promote → equilibrium.**

**No code written in this phase. No deploys performed.** Path B is a Phase 2 plan input, not an
authorization to execute it.

**This approval covers Phase 1 only.** Per Governance §3's Phase-Gate Approval Rule, Phase 1A does
not begin — including drafting the Phase 1A document — until Wael's own separate word for that
transition.

---

## THE CONTROLLING QUESTION

> **What prevents Voice Staging from being a functional replica of Voice Production at the starting
> equilibrium?**

Everything below exists to answer that and nothing else. The answer is in §1; §2–§5 are the evidence
for it.

---

## 1. THE ANSWER — four things prevent it, and none is unresolvable

Of the 32 Edge Functions on the voice boundary, **26 are already functionally equal today.** Four
things stand between here and equilibrium:

| # | What prevents equilibrium | Functions | Nature | Resolvable? |
|---|---|---|---|---|
| 1 | Production lacks the outbound containment guard | `send-sms`, `send-user-email`, `send-push-notification`, `ingest-ticket` | Deployment gap. Guard is **inert on production**, verified | **Yes** — deploy. No behaviour change |
| 2 | Staging runs source that is in no commit | `create-contact` | **Governance defect** — no controlled source | **Yes** — but must be resolved first (Wael, 6.2) |
| 3 | Production is missing a function it actively calls | `receive-demo-sms-reply` | **Live production defect**, not an intentional difference | **Yes** — deploy |
| 4 | Nothing keeps them equal once they are | all 32 | No promotion step, no comparison | **Yes** — Phase 2 builds it |

**Nothing structural prevents equilibrium.** There is no capability that exists only on one side by
necessity, no schema that cannot be matched, no credential that cannot be held in both. The four
items above are a deployment gap, a source-control lapse, a missing deploy, and an absent mechanism.

### ⭐ CONCLUSION — the question Wael requires this phase to answer

> **After resolving these remaining differences, can we establish Voice Staging = Voice Production
> functionally?**

# YES

**Conditions attached to that YES, stated so it cannot later be read as unqualified:**

1. **Item 2 must be resolved before, not during.** A baseline that contains uncommitted code is not a
   baseline. Wael's decision 6.2, and this document agrees with it without reservation.
2. **"Functionally equal" means identical code with deliberately different configuration.** Staging
   holds `OUTBOUND_ALLOWLIST` and `VOICE_CALL_FROM_NUMBER`; production holds neither. Those two
   secrets are *what makes staging safe to test against* — they are the intentional divergence the
   equilibrium model permits, and they must be recorded as such, never removed. Equilibrium is
   sameness of code, not sameness of configuration.
3. **Equal once is not equal ongoing.** Items 1–3 reach equilibrium. Item 4 keeps it. Reaching it
   without item 4 returns the system to today's state within weeks, which is what the last three
   months demonstrate.

---

## 2. Wael's three decisions — evidence and disposition

### 6.1 — Guard functions may exist identically in both, **if** evidence confirms inert in production

**Evidence obtained. Confirmed inert. Two independent lines:**

**Code.** `supabase/functions/_shared/outbound_guard.ts:20-24`:

> *"Both functions no-op when their controlling secret is absent. The secrets are set ONLY on the
> staging Supabase project, so production is protected BY CONSTRUCTION rather than by correct
> configuration — even if this code were deployed to production, every call would fall through to
> existing behavior."*

`parseAllowlist()` (line 66) returns `null` when `OUTBOUND_ALLOWLIST` is absent or empty.
`guardDestination()` (line 99) then returns `{allowed: true, enforced: false}` and emits no log line.

**Configuration, read live 2026-08-21** via `supabase secrets list` on both projects:

| Secret | Production | Staging |
|---|---|---|
| `OUTBOUND_ALLOWLIST` | **absent** | present (set 2026-08-19) |
| `VOICE_CALL_FROM_NUMBER` | **absent** | present (set 2026-08-19) |

**Disposition:** the four guard-carrying functions are cleared to be deployed to production. This
**supersedes the Phase 0 constraint** that they must never reach production — that constraint was
inherited from the session handoff and is contradicted by both the code and the configuration.

**One consequence to carry into Phase 2:** once the guard is on production, staging's containment
stops depending on production *not having the code* and starts depending on production *not having
the secret*. That is the design's own stated model, but it means `OUTBOUND_ALLOWLIST` must never be
set on production, and that invariant should be gated, not remembered.

### 6.2 — Uncommitted `create-contact` is not acceptable in a staging baseline

**Agreed without reservation. Evidence:**

| | |
|---|---|
| production's deployed copy | **byte-identical to committed `HEAD`** |
| staging's deployed copy | **byte-identical to the working tree, which is not committed** |
| working tree vs `HEAD` | 37 lines — 23 insertions, 14 deletions |

`git status` also shows an untracked `supabase/functions/_shared/contact_date_facts.ts`.

**The assumption this overturns:** production was believed stale. Production is exactly what git
says. **Staging is the environment running ungoverned code.**

What the uncommitted change does: replaces JWT-only auth with the 3-step `user_id` resolution
CLAUDE.md Configuration Discipline Rule 4 requires, so a server-side caller can pass `user_id` in
the body.

**Disposition:** must be resolved before the baseline is declared. Two paths, in §6.

**A defect found alongside it, belonging to neither environment:** the voice server calls
`create-contact` with a service-role bearer token and a body of `{name, email, phone}` — **no
`user_id`** (`naavi-voice-server/src/index.js:5259-5270`), identically on both branches. So the
uncommitted change adds a body-`user_id` path the voice server does not use. **Whether voice
`ADD_CONTACT` works on production is not established by this document** — it needs a live call, not
a code read. Out of T12's scope; logged for a separate item.

### 6.3 — Is `receive-demo-sms-reply` an intentional environmental difference required by function?

# NO — and its absence is a live production defect

**Trace, all freshly verified this session:**

1. `naavi-voice-server/src/voice/getDemoEnvironment.js:28-35` — for `environment === 'production'`,
   `supabaseUrl` resolves to `env.SUPABASE_URL`, the **production** Supabase project.
2. A call to the production demo number `+18889162284` selects that config
   (`getDemoEnvironment`, line 56, matching `DEMO_TWILIO_NUMBER`).
3. When the caller says "stop", `handleDemoStopRequest` (`src/index.js:7758`) POSTs to
   `${demoEnv.supabaseUrl}/functions/v1/receive-demo-sms-reply` — line 7762 — i.e. **production**.
4. `receive-demo-sms-reply` **is not deployed on production.** It is the single staging-only slug on
   the voice boundary.
5. The fetch is fire-and-forget with only `.catch()` (line 7769). **A 404 resolves rather than
   throws**, so the catch never fires, nothing is logged, and no caller checks `r.ok`.
6. Naavi then says: *"Got it — you won't hear from us again."* (line 7777).

**The opt-out row is never written to `demo_optouts`, and the caller is told it was.**

The function is committed (`fc85dc7`, F2b demo backend) and its source is in the repo. It was simply
never deployed to production — precisely the failure mode T12 exists to eliminate.

**Disposition:** not an intentional difference. Deploy to production. Per Architecture Reference §0b
the production demo line runs *on the production voice server*, so this is also a demo-line fix.

**Not claimed here:** whether inbound SMS "STOP" to the production demo number is equally broken.
That depends on where Twilio's messaging webhook for that number points, which was not read. The
verbal path above is verified; the SMS path is not.

---

## 3. The boundary — corrected

**32 Edge Functions.** Extracted from real call sites:

```
grep -rhoE "functions/v1/[a-z0-9-]+" naavi-voice-server/src
```

No other invocation pattern exists — searches for `supabase.functions`, `invoke(`, `invokeFn`,
`callFn` and `edgeFn` across `src/` returned nothing.

**Phase 0's 39 is withdrawn.** It matched the slug as a string anywhere in `src/`, counting seven
prose mentions in comments: `naavi-chat` (`anthropic_tools.js:5`), `sync-gmail` (`index.js:692`),
`text-to-speech` (`:1960`), `evaluate-rules` (`:4885`), `trigger-morning-call` (`:8661`),
`assistant-fulfillment` (`:837`), `extract-email-actions` (`:1456`).

**The session handoff's 32 was correct.** Phase 0 asserted the opposite and was wrong.

---

## 4. Why the drift looked like 20 and is 5

Phase 0 classified drift by comparing `ezbr_sha256` between projects. **That field is not a content
hash of the function source.**

Method used instead: `supabase functions download` for all 20 flagged slugs from both projects, then
`diff -r` against each other and against the repo.

| | |
|---|---|
| flagged different by hash | 20 |
| **byte-identical in deployed source** | **15** |
| genuinely different | **5** |

The 15: `create-calendar-event`, `delete-calendar-event`, `fetch-calendar-pdf`, `get-travel-time`,
`ingest-note`, `list-contact-names`, `manage-list`, `naavi-spend-summary`, `resolve-entity-ref`,
`resolve-place`, `save-hosted-reply`, `save-to-drive`, `search-google-drive`, `search-knowledge`,
`send-email` — identical on production, on staging, **and** in the repo.

**Three claims die with them, all made by Claude:**

- *"Production is ahead on `create-calendar-event` and `ingest-note`"* — **false**, identical
  everywhere. **There is no bidirectional drift.** Neither environment is ahead of the other except
  where §1 records.
- *"Production `fetch-calendar-pdf` runs code with no matching commit"* — **false**, identical to
  repo.
- *"Production `search-knowledge` carries the forbidden `user_tokens` fallback"* — **false.** Its
  deployed source contains the fix, line 86: *"V57.7 — REMOVED user_tokens 'first-google-user'
  fallback."* The claim rested on the deploy timestamp preceding the commit timestamp; **in this
  project code is deployed first and committed after**, so that ordering is normal and proves
  nothing. **No conclusion in this document uses a deploy timestamp.**

**This is the third time a parity check here has failed the same way.** Architecture Reference §0c
already records it: *"Function bodies were hashed raw, so one extra space made two identical
functions look different… A parity check's own defects present exactly like real drift."* Phase 2's
gate must compare source, not this field.

---

## 5. Root cause

**Cause 1 — nothing deploys Edge Functions as part of promoting.** Promoting voice merges `staging` →
`main` in `munk2207/naavi-voice-server`. Edge Functions live in a different repository
(`munk2207/naavi-app/supabase/functions/*`, Architecture Reference §0a), so no merge in the voice
repo can move them. Deployment is a manual per-project CLI command. Evidence: `.github/workflows`
**does not exist**; `grep -rlE "functions deploy" scripts package.json .github` returns **nothing**.

**Cause 2 — nothing compares deployed Edge Function code between projects.** Recorded before T12
opened. §0c: *"It compares schema, not data, and not Edge Function code."* §0d: *"Nothing compares
deployed Edge Function code between projects. T4 recorded this as a known weakness; this is the
first time it bit."* The two `.githooks/pre-push` gates cover schema drift and code-vs-schema;
neither covers this.

**Cause 3 — deployment does not come from git, and this one defeats the others.** Staging's
`create-contact` is in no commit. A promotion mechanism keyed on git would never have moved it, and a
comparison against the repo calls staging "correct" only because the edit happens to sit in this
clone's working tree. **On any other clone the same check would report the opposite.** Causes 1 and 2
are missing mechanisms and can be built; Cause 3 is a discipline question, and building on top of it
produces a gate that reports confidently and means nothing.

---

## 6. The one decision remaining

**6.2 requires a resolution path.** Wael has ruled that uncommitted code cannot be in the staging
baseline. Two ways to satisfy that:

**Path A — commit the change, then deploy it to both.** Equilibrium includes the Rule 4 conformance
fix. But it ships a **functional change to production** under T12, which Phase 0 puts out of scope
("no source changes"), so Phase 0 would need amending.

**Path B — preserve the change in a commit, redeploy staging from `HEAD`.** Both environments equal
committed `HEAD` immediately, **zero production behaviour change**, Phase 0's scope intact. The
`create-contact` improvement then becomes the **first change to travel the new staging → test →
promote path** once it exists.

**Recommendation: Path B.** It establishes the starting equilibrium without T12 itself becoming a
functional release, keeps the "no source changes" constraint Wael approved, and turns the loose
change into the proof that the new process works end to end. Nothing is lost — the code is committed
either way.

---

## 7. What this phase did NOT establish

- Whether voice `ADD_CONTACT` currently works on production (§6.2). Needs a live call.
- Whether inbound SMS "STOP" on the production demo line is broken as well as the verbal path (§6.3).
- Whether the 50 non-voice Edge Functions carry real differences. Out of scope by Phase 0.
- Why `ezbr_sha256` differs for identical source. Not needed — the field is unused from here — but
  Phase 2's gate must not depend on it.

---

## Required output

Confirm the YES conclusion and choose Path A or Path B in §6. Per Governance §3's Phase-Gate
Approval Rule, Phase 1A does not begin until Wael's own separate go-ahead.
