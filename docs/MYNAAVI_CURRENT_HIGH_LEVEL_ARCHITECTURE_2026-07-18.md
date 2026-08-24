# MyNaavi — Current High-Level Architecture Reference

**Architecture Version:** 2026.07.18.11 (date-and-revision format — avoids the ambiguity of a bare "latest Architecture Reference" reference elsewhere in the governance doc).

**Revision 11 (2026-08-24, [[B11x]] Phase 6):** adds **§2d** and rewrites §2's Gmail row, which described `sync-gmail` as *"cron-driven"* — **false, and false before B11x began.** There are five triggers; two of them, including the mobile app on a 60-second interval, silently fan out to *every active user* because they pass a parameter `sync-gmail` does not read. **The word cost four months and three migrations:** every attempt to control this pipeline's cost cut the cron cadence (5 → 15 → 30 → 60 min), because the cron is what this document showed. None touched the other four triggers, because nothing recorded that they existed. §2 also gains a row for `extract-email-actions`, which this document had never listed at all despite it being the pipeline's only Claude call and the whole of B11x's blast radius. **This was Outcome 3 under the Architecture Drift Rule — a Reference already stale before the work started — so Phase 6 was blocked until it landed, not deferred to Phase 8.** Bumped in the same commit as the edits.

**Revision 10 (2026-08-23, [[B11k]] Phase 1A):** records a capability this document did not describe at all — **action outcome reporting / failure surfacing** — which turns out to be duplicated three ways. §5a gains a Priority 1c row, §5 the matching narrative, and §2 a row for `naavi-chat` Step 1.4's execute-then-speak contract, which §2b had described only as the marker's read-back point. **This was Outcome 3 under the Architecture Drift Rule, not a Phase 8 tidy-up** — the omission predated B11k, and §5a's title claims a *Full* Duplication Inventory, so omitting a three-way duplication made it inaccurate rather than merely thin. Phase 1A's first revision proposed deferring it and recorded a PASS; external review rejected both, correctly, and implementation stopped until these edits landed. **The cost of the omission is measurable:** the same defect was fixed narrowly three times in three months — 2026-05-12, 2026-07-15, 2026-07-21 — by three people who each had no row telling them it was one class. Bumped in the same commit as the edits.

**Revision 9 (2026-08-21, [[T12]] Phase 8):** the four corrections T12's Phase 6 review made a hard merge precondition under the Architecture Drift Rule (Outcome 2 — divergence from an intentional, approved change). Two are now-false claims this document made about what the project can measure (§0d and §0c both said nothing compares deployed Edge Function code between projects — `parity:verify` now does); one is a stale line reference in §0b; and one is §0b's inaccurate "on every send path", now replaced by a plain statement of what the guard actually covers. **That last one also carries Wael's ruling that the uncovered paths are not a gap to close** — staging is contained by controlled data, not by the guard — so it is closed, not open. Bumped in the same commit as the edits.

**Revision 8 (2026-08-21, [[B11f]] Phase 8):** rewrites §3's "handling barge-in/interruption" bullet, which described as one capability something that is now **two different designs, one per voice branch** — production interrupts on any speech and discards the answer; staging interrupts only on a recognised pause word and resumes from the previous sentence. Mobile is a third design again. The entry also records the trade this creates and that Wael has assigned it to the production-promotion decision. **Also corrects a lapse in revision 7's own commit discipline:** the §0d Railway paragraph was retracted earlier the same day *without* a version bump, so `2026.07.18.7` briefly identified two different documents. Assessed for [[B11f]] per Phase 1A's Version Verification requirement: that edit concerned Railway deployment behaviour, not voice architecture, and invalidated no assumption this work item relied on.

**Revision 7 (2026-08-20, the S1 promotion):** adds **§0d** — a feature is not one deployable thing. Records the four surfaces S1 needed, why their ordering is load-bearing, and the blind spot that nearly cost the promotion: because §2c moved voice-PIN logic into Shared Core, the voice server contains none of S1's identifiers on *either* branch, so the obvious check answers correctly and tells you nothing. Production had been serving Edge Functions three months stale, invisible to every comparison this project owns. Also records that a deploy can be complete while the feature stays dormant behind an undeployable client half, and that a push is not a deployment. Bumped in the same commit as the edit.

**Revision 6 (2026-08-20, T4):** adds §0c — the two Supabase environments are not equal, why they never were, the three categories of difference and why they must not be collapsed, and the drift check that now measures them. Bumped in the same commit as the edit, which is what revision 5's own note asked of whoever came next.

**Revision 5** is [[S1]]'s Phase 8 output (2026-08-19): adds **§2c** — voice-PIN security state (failure counting, alerting, lockdown) moved from the voice server into Shared Core — plus the two voice-PIN rows in §2.

⚠️ **Revision 4's description below does not cover everything in the document, because three sets of edits landed between revisions 4 and 5 without the version being bumped:** T2's §0b (deployment environments), the 2026-08-19 consolidation that folded in §2b and superseded four older architecture documents, and the 2026-08-19 §0b entry recording that the demo line has two numbers and no environment of its own. None of them altered any claim [[S1]] relied on — all three concern deployment topology, not Shared Core boundaries — so no re-evaluation was required at S1's Phase 8 version check. **The lesson is the version line's own: a revision number only means something if bumping it is part of editing.** Whoever next edits this document should bump it in the same commit.

**Revision 4** was T1a's Phase 4 output: corrects the "Action Rules — execution/firing" row (§2) to reflect an intra-Shared-Core duplication proven by three incidents, cross-references ADR 0003 from the "Reminders" row, and adds two previously-missing rows to §5a's Duplication Inventory. See `docs/T1A_PHASE2_CHANGE_PLAN_2026-07-18.md` and `docs/T1A_PHASE5_EVIDENCE_2026-07-18.md` for the full audit trail.
**Diagram Version:** 1 (the Data Flow diagram in §6 — increments independently of the document's overall version when the diagram itself changes)
**Last Verified:** 2026-07-18
**Verified Against:** direct code inspection of `munk2207/naavi-app` and `munk2207/naavi-voice-server`, both at their `main` branch HEAD as of the date above. **Note (T2, 2026-08-19):** `naavi-voice-server` now also has a `staging` branch, merged level with `main` at `2124150`. Section 0b describes the topology; this line is retained as written because it records what was verified on 2026-07-18.
**Repositories:** `munk2207/naavi-app`, `munk2207/naavi-voice-server`
**Architecture Owner:** Wael. Claude proposes architecture changes and updates to this document; ChatGPT reviews them; only Wael approves an architectural ownership change (per Governance §4's Ownership Change Rule) or a new Architecture Version.

**Purpose:** a single reference for where things actually live in this codebase — not where they were designed to live, not where a comment claims they live, but where direct code verification confirms they live. This document exists because assumptions about "shared vs. duplicated" have caused real bugs this project has already paid for (see §5 and the Appendix). Every claim below was checked against the actual source, not inferred from file names or comments.

**Scope:** high-level only, no source code. File paths are given as location references, the way a floor plan gives room names — not as code to read.

**How to read this document:** if you're about to add a feature or fix a bug, read §2 to find where the capability actually lives, §4 to check if you're touching Protected Core, and §7 before deciding whether to reuse or duplicate.

---


> **⭐ This is the ONLY architecture reference document for Naavi.** No other architecture document is
> current or authoritative. Four earlier ones are marked SUPERSEDED and retained as history only:
> `ARCHITECTURE.md`, `ARCHITECTURE_2026-05-13.md`, `ARCHITECTURE_OVERVIEW_2026-04-30.md`,
> `ARCHITECTURE_NAAVI_CHAT_ACTION_SYSTEMS.md`.
>
> **Creating a new architecture document is forbidden** (Wael, 2026-08-19). Extend this file instead.
> Rationale: five parallel architecture documents accumulated, only this one was maintained, and the
> one believed to be live had a single commit in four months. See CLAUDE.md, ARCHITECTURE DOCUMENTATION.


## 0. The Three Codebases

Naavi is not one program — it's three, talking to one shared database:

1. **Mobile app** (`munk2207/naavi-app`, this repo) — the Android app itself (React Native/Expo), plus its backend Edge Functions (`supabase/functions/*`), which run on Supabase.
2. **Voice server** (`munk2207/naavi-voice-server`, separate repo, `naavi-voice-server/src/index.js`) — a single large Node.js program on Railway that answers phone calls via Twilio.
3. **Supabase** — the shared Postgres database, Edge Functions, and cron jobs both the mobile backend and the voice server call into.

The mobile app and the voice server **do not call each other**. They are two independent clients of the same backend. Whether a capability is "shared" depends entirely on whether both clients call the *same* Edge Function, or whether each has written its own version of the same logic.

### 0a. Ownership Model

| Component | Owner |
|---|---|
| Shared Core (Supabase Edge Functions + Postgres) | The Edge Functions codebase, `munk2207/naavi-app/supabase/functions/*` |
| Voice | The Voice Server, `munk2207/naavi-voice-server` |
| Mobile | The React Native App, `munk2207/naavi-app` (client code under `app/`, `hooks/`) |

Each component's owner is the single codebase responsible for that component's correctness. "I thought the other side handled it" is not a valid explanation for a gap — if a capability's owner is genuinely ambiguous, that ambiguity is itself a defect to resolve, not a reason to skip verification.

---

### 0b. Deployment Environments (added by T2, 2026-08-19)

Each codebase — and the demo line that rides on one of them — has a different number of environments. This asymmetry is load-bearing: it decides where a change can be exercised before it reaches a real user, and it was undocumented until T2. Note that the row count below is **not** the count of deployable units: the demo line has two numbers but no environment of its own, so there are three Railway services, not four.

| Codebase | Environments | How they are separated |
|---|---|---|
| Mobile app | 2 | Supabase project `xugvnfudofuskxoknhve` (staging) / `hhgyppbxgmjrwdpdubcx` (production); app packages `ca.naavi.app.staging` / `ca.naavi.app` |
| Voice server | 2 (since 2026-08-19) | Two Railway services in one project: `naavi-voice-staging` deploying from branch `staging`, and `naavi-voice-server` deploying from `main`. Separated by which Twilio number is dialled: `+13435041572` reaches staging, `+12495235394` reaches production. |
| Demo line | 2 numbers, but **0 independent code paths** | Not a platform. A routing mode of the voice server, selected by `DEMO_USER_ID` and by which number is dialled. `+18889162284` (production demo) runs on the **voice production server itself**; `+18734462284` (staging demo) runs on a separate Railway service, `generous-tenderness-production-9235`, which deploys the **same `staging` branch** as voice-staging. |
| Supabase | 2 | The two projects above. |

**Before 2026-08-19 the voice server had ONE environment.** Every voice change for real callers was developed and deployed straight against production. T2 built the staging half; see `docs/T2_PHASE_0_CREATING_VOICE_STAGING_2026-08-19.md` onward for the full governed record.

**The two voice environments share the staging Supabase project with mobile-staging.** This was a deliberate, recorded decision (T2 Phase 0, Option 1 over Option 2) rather than an accident: a third Supabase project would have meant a third copy of the schema, the Edge Functions and the cron jobs to keep in sync forever. The consequence is that voice-staging and mobile-staging are isolated by `user_id` scoping, not by separate databases.

**⭐ The demo line has two phone numbers and no environment of its own** (established 2026-08-19, by direct query rather than from documentation — Wael asked whether Mobile, Voice and Demo each now had two environments, and the answer turned out to be no).

Three Railway services exist, not six:

| Number | Purpose | Server it actually runs on |
|---|---|---|
| `+12495235394` | Voice production | `naavi-voice-server-production` |
| `+13435041572` | Voice staging | `naavi-voice-staging-production` |
| `+18889162284` | **Demo production** | `naavi-voice-server-production` — *the voice production server* |
| `+18734462284` | **Demo staging** | `generous-tenderness-production-9235` |

**How this was established, so a later reader does not have to re-derive it:** the four Twilio numbers' `voice_url` values were read from the Twilio API, and each service was then probed for the S1 `/voice/identify-result` endpoint. Both staging services answered `200`; voice production answered `404`. Since S1 was pushed to the `staging` branch and deployed only to voice-staging, the demo staging service having the same code proves it deploys that same branch. Nobody deployed to it.

**Two consequences that are easy to miss:**

1. **T2's isolation does not cover the demo line.** T2 separated Voice-staging from Voice-production. The public 1-888-91-NAAVI demo line still runs *inside* voice production, so any voice production deploy changes the demo line at the same instant, and any voice production incident is simultaneously a demo outage. A work item that promotes voice changes to production is also, silently, a demo release.
2. **The two staging services are not isolated from each other.** They deploy the same branch, so a change intended for voice-staging lands on demo-staging too. They differ only by environment variables.

`generous-tenderness-production-9235` is an auto-generated Railway name recorded in exactly one place before this entry — `docs/SESSION_HANDOFF_2026-07-01_F2B_STAGING_LIVE_SCENARIOS_NEXT.md`. Nothing in either codebase refers to it. It is written down here because a service that exists only in someone's memory is a service that gets orphaned.

This is the underlying problem [[T3]] exists to fix. Until T3 lands, treat "the voice platform" and "the demo line" as **one deployable unit** in any release plan.

**Outbound containment.** Because staging shares a real Twilio account and real Google credentials, an allowlist guard sits in Shared Core (`supabase/functions/_shared/outbound_guard.ts`). It is inert unless the `OUTBOUND_ALLOWLIST` secret is present, which it is only on staging — so production is protected by construction rather than by correct configuration. A second export resolves the outbound voice caller ID the same way, so a staging call never presents as production Naavi.

It covers the SMS, WhatsApp, push and voice send paths. It does not cover `send-email` or `send-drive-file`, which send through the Gmail API, nor the F2b demo recap, which goes direct to Twilio. *(Corrected 2026-08-21 — this paragraph previously said "every send path".)*

**⭐ And that is not a gap to close. Wael's ruling, 2026-08-21 — do not re-raise it.** **Staging is contained by controlled data, not by the guard.** Every contact, phone number and email address on the staging test account is deliberately controlled — the same discipline that produced the YouTube roster — so a staging send has no uncontrolled recipient to reach in the first place. **Measured, all 34 staging sends ever recorded:** every destination was `+1 343 333 2567`, `whwh2207@gmail.com`, `abc@gmail.com` or `robert.esm.2207@gmail.com`. Not one uncontrolled recipient, and zero email sends at all since the guard was enabled on 2026-08-19. Wael's assessment of the residual exposure — *"where is the risk in a world that we receive hundreds of spam emails daily, and it will be one or two emails, it does not justify"* — is the ruling. **Adding the guard to those two functions was proposed and rejected.** The roster is the control that has a track record; guarding the code protects against nothing the data does not already prevent, and would not help if the data ever stopped being controlled. Record the coverage accurately, which the sentence above now does, and leave the code alone.

**⚠️ Invariant this environment depends on.** `DEMO_TWILIO_NUMBER` and `STAGING_DEMO_TWILIO_NUMBER` must remain unset on the `naavi-voice-staging` service. The voice server contains one direct-to-Twilio SMS path (the F2b demo recap, `naavi-voice-server/src/index.js:7637`, the only `Messages.json` call in the file) that the Shared Core guard cannot see; it is unreachable only because those variables are unset. Setting either makes it reachable and requires a voice-server-side guard first. See [[T3]] for the underlying problem — the demo line and the registered-user voice platform being one process.

**Test harness.** Gate 2 (`npm run test:voice`) selects its voice server from the same environment choice that drives `SUPABASE_URL` and refuses to run if the two disagree (`tests/lib/voice_env.ts`). Before T2 it always tested production.

### 0c. The two Supabase environments are not equal (added by T4, 2026-08-20)

§0b says there are two Supabase projects. It does not say they hold the same schema, and they do
not.

**Staging is a reconstruction from the migration files, not a copy of production.** It contains
what those files describe and nothing else. Production holds objects the files never captured —
created by hand, or by code since deleted — and staging has objects production never received,
because work is deployed there first and not always promoted. Neither drifted from the other;
they were never the same.

**How this surfaces:** Wael called both lines within a minute of each other and got different
behaviour. That is the only reason it was found.

**Measured at definition level, not name level.** A name-level comparison reported 14
differences. Comparing types, defaults, nullability, index and constraint definitions, policy
expressions, function bodies and cron schedules reported **184**. An object can exist in both
environments, under the same name, and behave differently — that category is invisible to any
comparison that only checks whether a name is present, and it is where the real defects were.

**Three categories, which must not be collapsed into one number:**

| Category | Meaning |
|---|---|
| **Missing from staging** | The real gap — the reconstruction is incomplete |
| **Staging-only** | Almost always work not yet promoted. **Not debris.** S1 is exactly this and is correct |
| **Defined differently** | The dangerous one. Identical to any name-level check, different at runtime |

Collapsing these loses the signal: the first is a defect, the second is a promotion queue, and
the third is what actually breaks.

**Examples of the third category, all found 2026-08-20 and all real:** staging rejected the
`calendar` document type this document's own product spec lists as valid, and every ticket
raised from the website; staging granted write access to `calendar_events` and `gmail_messages`
where production grants read only; production allows a blank value in 12 columns where staging
does not.

**The mechanism that keeps this from recurring: `npm run drift:check`.** It reads staging live,
compares against a captured production fingerprint, and exits non-zero on any difference NEW
since the recorded baseline. Known differences live in `docs/T4_accepted_differences.json` and
are not failures; the check is about the two environments separating *further*.

**What it cannot see, and this is load-bearing:**

- It compares staging **live** against a production **snapshot**. Production changing is
  invisible until the snapshot is recaptured by running `docs/T4_SCHEMA_FINGERPRINT.sql` in
  production's SQL editor. That is deliberate — it means no production database credentials need
  to exist anywhere — and it is sound only because production changes solely by deliberate act
  under the staging-first rule. Supabase upgrading an extension underneath is the one exception.
- It compares **schema**, not data. It does not compare Edge Function code — **but as of
  2026-08-21 something else does.** [[T12]] built `npm run parity:verify`, which downloads the
  deployed source of every voice-boundary Edge Function from both projects and diffs it, and
  `npm run parity:check`, a fast manifest-based tripwire bound to pre-push that **states in its own
  output that it is not proof**. The drift check's blind spot here is therefore covered for the 32
  functions on the voice boundary, and still open everywhere else. **Corrected in revision 9 — this
  bullet previously ended "A function deployed to one project and not the other is invisible to it",
  which stopped being true the day the parity tool shipped.**
- **Neither tool can see code deployed to both projects and committed to neither.** They compare the
  two projects *to each other*, so identical-and-uncommitted passes clean. This is not hypothetical:
  T12 found staging running 37 lines of `create-contact` that existed in no commit, and then found
  `global-search/adapters/calendar.ts` in the same state **on production, live, for real users**.
  Both are now under version control (`8e24aae`), and `scripts/deploy-edge-function.js` refuses to
  deploy uncommitted source — but **nothing has swept the remaining Edge Functions for existing
  instances.**

**Its own measurements have been wrong, three times, in ways worth remembering.** Function bodies
were hashed raw, so one extra space made two identical functions look different. Cron commands
were truncated before the service key was redacted, so production's longer key pushed the tail of
the statement out of the comparison. Extensions recorded name and version but not schema —
pgvector lives in `extensions` on staging and is reachable from `public` on production, which is
why a function pinning `search_path` to `public` alone works on one and cannot find the `<=>`
operator on the other. **Each was found only when something failed, never by inspection**, and
each had been quietly inflating the difference count. A parity check's own defects present
exactly like real drift.

**Direction of travel, decided by Wael 2026-08-20:** where the two differ and staging is ahead,
the answer is to **promote to production, never to delete from staging**. Parity is about
capability — *"functions not data that belong to the individual testing each system"* — so rows
belonging to whoever tests an environment are out of scope entirely.

**And parity is not always the goal.** Production's Epic policies use `using = true`, letting any
authenticated user read every user's rows; staging scopes them per user. Staging is correct.
Copying production would have imported the weaker rule. **A difference is a question, not
automatically a defect on the staging side.**

Full record: `docs/T4_PHASE_5_EVIDENCE_ALL_PASSES_2026-08-20.md`.

### 0d. A feature is not one deployable thing (added by the S1 promotion, 2026-08-20)

§0b maps the environments and §0c maps how their databases differ. This section records what the
first real promotion between them proved: **"promote S1 to production" was not one action, and
nothing in the system knew that.**

**S1 needed four surfaces, each deployed independently, three of them per-environment:**

| Surface | Deployed how | What was actually there before |
|---|---|---|
| Supabase schema | migration, per project | absent — production had neither S1 migration |
| Edge Functions | `functions deploy`, per project | `manage-voice-pin` v19 from **14 May**, `receive-sms-reply` v11 from **19 June** |
| Voice server code | git push → Railway, per branch | `main` had no S1 |
| Mobile client | Play Store AAB | pre-S1, and **the only surface that cannot be deployed on demand** |

**The ordering is load-bearing, not stylistic.** Schema before functions before code. Reversed, the
code arrives and reads columns that do not exist, and PostgREST fails the *whole* query when any
selected column is missing — so the failure is total and silent. That is the B11c mechanism, which
had already cost this project a 30-second uninterruptible greeting on every staging call.

**The blind spot, which is the part worth carrying forward.** §2c records that S1 moved voice-PIN
security state *out of* the voice server and into Shared Core. The consequence was not recorded and
nearly cost the promotion: **grepping the voice server for S1's identifiers returns nothing — on
either branch.** `record_voice_pin_failure` and `voice_pin_failed_count` appear in
`manage-voice-pin`, not in `src/index.js`. So "is S1 in the voice code?" is the wrong question, and
answering it correctly ("no, on both branches, identically") looks reassuring while being
irrelevant. The two stale Edge Functions were found by reading a call log, not by any check.

**Nothing enforces that these surfaces move together, and the gaps are asymmetric:**

- The drift check (§0c) compares **schema**. It is the only mechanical parity gate that exists.
- **⭐ Something now compares deployed Edge Function code between projects — as of 2026-08-21.**
  When this section was written it said *"Nothing compares deployed Edge Function code between
  projects"*, and that sentence is what [[T12]] was opened to answer. `npm run parity:verify`
  downloads deployed source from both projects and diffs it; `npm run parity:check` is a fast
  manifest tripwire bound to pre-push. **Only `parity:verify` is entitled to claim equilibrium**, and
  `parity:check` says so in its own output. The three months of `manage-voice-pin` staleness that
  cost the S1 promotion would be caught today. **Coverage is the 32 functions on the voice boundary,
  not all of them** — and the gap that remains is described in §0c: code deployed to both projects
  and committed to neither passes both tools clean.
- **The measurement itself was the hard part, and two obvious comparators are wrong.** `ezbr_sha256`
  from `functions list` is **not** a source hash — it flagged 20 differences of which 15 were
  byte-identical across production, staging and the repo. **Deploy timestamps are equally useless,
  because code is deployed before it is committed here**, so a deploy predating a fix proves nothing.
  Four separate claims died to these two. Diff the source or measure nothing.
- **Nothing catches "edited in the repo, never deployed."** The prompt is the sharpest case: it
  lives in `get-naavi-prompt`, a **per-environment Edge Function**, so CLAUDE.md's "shared source of
  truth" means shared *in the repo*, not in deployment. Production's copy was five days older than
  S1, and Naavi consequently read callers a four-digit PIN instruction that `manage-voice-pin` was
  guaranteed to refuse ([[B11h]]). Found by Wael on a live call; 102 tests and two external reviews
  had passed over it, because every check asked what the feature *does* and none asked what Naavi
  *says* about it.

**A deploy can be complete and the feature still dormant — by construction, not by fault.** S1 is
live on production and refuses every unregistered caller, because the path requires an account with
a PIN, setting a PIN requires the mobile client, and the shipped client sends four digits where the
new function requires six. **Server-side promotion is not user-visible capability whenever a client
half exists**, and the client is the one surface gated behind the three test gates and a store
review. Plan the dormancy window deliberately; it is not a bug to be fixed at deploy time.

**Operationally: verify a deployment from the running process, not from the push and not from the
code.** Both the voice server's `/` route and its per-turn `commit=` marker are hardcoded literals
from April and report the same value no matter what is running — each briefly looked like evidence
on 2026-08-20 and was not. **A log line from the started container is the only reliable signal.**

**⭐ Corrected 2026-08-21 — the original version of this paragraph claimed Railway "does not
reliably auto-deploy on push", and that claim was itself an artifact of checking too early.** On
2026-08-21 a push to `staging` was followed within seconds by `railway logs -b --since 4m`, which
returned nothing; a `redeploy --from-source` was fired, and the Railway dashboard then showed the
**GitHub auto-deploy had started on its own** and was merely superseded by the manual one. A
Railway build takes appreciably longer to appear than a push takes to complete. **Wait and re-check
before concluding a deploy did not happen** — the earlier production observation (no build logs
across a 24-hour window) is a different and stronger measurement, and is not retracted, but the
general "Railway is unreliable" reading was wrong and would have led future sessions to fire
redundant redeploys.

The narrower lesson survives: **do not infer a deployment from a successful push.** Confirm it —
just allow the build time to start before deciding it never will.

**And every voice production deploy is simultaneously a demo release**, because 1-888-91-NAAVI runs
on the production voice server itself (§0b). That is [[T3]]'s subject; noted here because it is a
property of *promoting*, not only of hosting.

## 1. Architecture Principles

The architecture follows these principles. They are the lens every future decision should be evaluated through:

- One source of truth wherever practical.
- Shared business logic belongs in Shared Core.
- Entry points translate requests rather than implement business logic.
- Platform-specific capabilities remain platform-specific.
- Duplication is allowed only by explicit architectural decision.
- Architecture documents describe verified implementation, not intended design.

---

## 2. Shared Core Boundaries

For each capability, where the authoritative implementation actually lives — verified against source, not assumed.

| Capability | Authoritative implementation | Status |
|---|---|---|
| Contacts / name resolution | `lookup-contact`, `resolve-recipient` (Shared Core) | Genuinely shared — voice calls the real Edge Functions, no inline reimplementation |
| Action Rules — execution/firing | `evaluate-rules`, `report-location-event` (Shared Core) | Shared in the sense that voice has no separate copy of this logic (confirmed by exhaustive grep of the voice codebase) — but **internally duplicated**: `evaluate-rules` and `report-location-event` are two independently-maintained Shared-Core functions with overlapping fan-out logic (channel selection, self-alert detection, `task_actions` execution) and only a code comment ("keep both in sync") holding them together. Proven by three separate drift incidents (F5c's partial recipient-resolution fix, B10d's channel-preference gap, B10g's `task_actions` gap) — see ADR 0005 |
| `task_actions` (third-party sends attached to an alert) | Mobile-only creation, Shared Core execution | Voice cannot currently create this — its own action-creation path never populates the field |
| Notification sending (SMS/email) | `send-sms`, `send-email` (Shared Core) | Genuinely shared senders — every alert-firing function funnels through these |
| Global Search | `global-search` (Shared Core) | Genuinely shared — voice calls the same 10-adapter search |
| Claude system prompt (non-classifier) | `get-naavi-prompt` (Shared Core) | Genuinely shared — voice fetches this Edge Function live, same bytes mobile uses |
| List creation | `manage-list` (Shared Core) | Genuinely shared for writes |
| List reading | Duplicated | Both mobile-backend and voice independently query the `lists` table directly, rather than through one read function |
| Calendar — writes (create/delete event) | `create-calendar-event`, `delete-calendar-event` (Shared Core) | Genuinely shared |
| Calendar — reads (live event fetch) | Duplicated | Both `naavi-chat` and the voice server independently call the Google Calendar API themselves — see `docs/adr/0002-calendar-reads-remain-duplicated.md` |
| Gmail — background sync | `sync-gmail` (Shared Core) | Genuinely shared, writes to `gmail_messages`. **NOT cron-only — it has five triggers, two of them client-initiated. See §2d.** |
| Gmail — action classification | `extract-email-actions` (Shared Core) | Genuinely shared, single classifier. **Idempotent per `(user_id, gmail_message_id)` since B11x** — see §2d |
| Gmail — live/recent read | Duplicated | Both sides independently call the Gmail API directly for "what's new" reads |
| Drive saves (notes, transcripts, lists) | `save-to-drive` (Shared Core) | Genuinely shared — both mobile client and voice call it |
| Document harvesting (attachments → Drive) | Mobile-backend only | Voice never calls this; it's wired into the email-sync pipeline only |
| Reminders (`reminders` table) | Voice-only in current practice | Mobile's equivalent requests are redirected into `action_rules` instead of the `reminders` table; a mobile client function that writes to `reminders` exists but is dead code (never called). **This is a documented divergence, not a settled design** — ADR 0003 recommends bringing voice's write path in line with mobile's `action_rules` redirect rather than treating this as permanent; tracked as holding-list item `B10l` — see `docs/adr/0003-voice-reminders-write-path-diverges-from-mobile.md` |
| Geofencing (background location) | Mobile-only, by nature | A phone call has no background location; this capability structurally cannot exist on voice |
| **Action Rules — creation (the classifier)** | **Duplicated, two independent implementations** | The single most important duplication in the system — see §2a below |
| Conversation/turn state (pending confirmations) | Duplicated, two independent state machines | Mobile and voice each track "what are we in the middle of" separately; neither reads the other's state |
| Authentication / user identity | Two genuinely different mechanisms, not a duplication | Mobile identifies the user via login (JWT). Voice identifies the user via caller phone number lookup. Different problems, correctly solved differently — both ultimately read the same `user_settings` table |
| **Voice PIN — authentication of a caller on an unregistered phone** | `manage-voice-pin` (Shared Core) | Genuinely shared. The caller claims an identity (last 4 digits of their registered number), which resolves to **one** account, and the PIN is verified against that account alone. Before [[S1]] (2026-08-19) the voice server tested an entered PIN against **every** account holding one, so a guess succeeded if it matched anyone and the odds worsened as the user base grew |
| **Voice PIN — failure counting, alerting, and lockdown state** | `manage-voice-pin` (Shared Core), atop the `record_voice_pin_failure()` Postgres function | **Ownership moved out of the voice server at S1 Phase 6** (2026-08-19) — see §2c |
| **Action execution and outcome-truthful reply (app path)** | `naavi-chat` Step 1.4 executors (Shared Core) | Genuinely shared for the seven intents it covers (`SET_REMINDER`, `CREATE_EVENT`, `REMEMBER`, `DELETE_RULE`, `DELETE_MEMORY`, `ADD_CONTACT`, `DELETE_EVENT`), and the **reference contract** for this capability: execute, then derive the reply's speech from the result. §2b previously described Step 1.4 only as the marker's read-back point; that it also owns the execute-then-speak contract was unrecorded until [[B11k]] Phase 1A. **Voice does not call it** — see §5's Priority 1c |
| **Action outcome reporting / failure surfacing** | **Duplicated, three independent implementations** | The capability [[B11k]] exists to fix. See §5's Priority 1c |

### 2a. Why "Action Rules creation" is the important one

This is the capability most likely to surprise you, and the one that produced this session's most expensive lesson. When a user asks to create an alert — "remind me when I arrive at Costco," "text Bob at 9am" — **mobile and voice each decide what to do independently**, using separately-written classification logic. Voice never calls the mobile backend's Edge Function for this at all. It has its own, much simpler classifier that only recognizes read-only questions (contacts, calendar, lists) — anything resembling "create an alert" falls straight through to voice's own full Claude reasoning, which is a different code path (though it does successfully use the genuinely-shared `get-naavi-prompt` system prompt once it gets there).

**Practical consequence:** a bug fixed in mobile's alert-creation classifier does not fix voice's alert-creation behavior, and vice versa. A fix must be evaluated against both, deliberately, every time — never assumed to transfer.

---

### 2b. `naavi-chat` runs TWO action-generation systems

*Folded in from `ARCHITECTURE_NAAVI_CHAT_ACTION_SYSTEMS.md` on 2026-08-19, when this document became the single architecture reference. That file is now superseded.*

**Read this before debugging any action or recipient bug.** F15 (2026-07-09) spent substantial diagnostic effort instrumenting the wrong pipeline before discovering the split existed. F16 wrote it down so the next investigation would start from an accurate map.

**The split.** Every user message that is not a fast-path greeting goes first through **Layer 2** — a small, separate, stateless Haiku call (`classifyIntent()`) that sees only the current message text: no conversation history, no tools. If it confidently recognises a single well-known action, it handles the whole thing deterministically with hand-written templates and never invokes Claude tool-use at all. Otherwise the message falls through to **Path B** — a full Claude tool-use call with `NAAVI_TOOLS`, the entire conversation history, and native tool-calling.

**Layer 2's statelessness is structural, not incidental.** `classifyIntent(client, userText)` receives one string, not the conversation array. It therefore cannot resolve a bare follow-up like "Halo" or "3pm" on its own — anything depending on earlier turns falls to Path B by construction, every time, regardless of how long the conversation is.

**Both systems converge on one executor.** When either produces a "here is what I'll do, say yes to confirm" reply, it embeds the same marker (`<!--PENDING_INTENT:{...}-->`). A single shared block — informally "Step 1.4" — is the only place that reads it back on the user's "yes" and performs the write. That marker is the entire contract between the two systems and the database. **If either system produces a confirm-sounding reply without a valid marker, the "yes" turn has nothing to execute and Naavi still says "Done"** — the B9i failure mode.

**⚠️ Recipient resolution is NOT unified.** F12 built `resolve-recipient` as *the* shared resolver. It is shared only for **location** triggers:

| Trigger type | Mechanism | Shared? |
|---|---|---|
| Location (third-party or self) | `resolve-recipient` Edge Function | Yes — one function, used by mobile, voice (2 call sites), and `evaluate-rules`' fire-time re-resolution |
| Time-trigger, third-party by name | **Three separate, independent `lookup-contact` call sites**, sharing no code: Layer 2's own fallthrough branch, Step 1.4's `lookupWithPhone` helper, and a third intercept that resolves Claude's tool output before the marker is embedded | **No** |
| Self-override, any trigger | None needed — the user gave a literal address directly | N/A |

**Practical consequence:** a third-party time-trigger recipient bug can live in any of those three call sites, and fixing one does not fix the others. That is exactly the shape B9g/B9n turned out to be.

**Self-override contract.** The four fields (`self_override_email` / `_sms` / `_whatsapp` / `_voice`) redirect **one channel** of a self-alert to a literal address the user gave, while every other enabled channel still reaches them normally. Two dispatchers implement the same `override || userDefault` pattern — `report-location-event` (location fires) and `evaluate-rules` (time / email / weather / contact_silence fires). They are duplicated code, so drift is possible if one is edited without the other.

**Never valid:** a `self_override_*` field AND `to`/`to_name` populated on the same `action_config`. That is a third-party recipient colliding with a self-override, and it is the contamination shape of B9g/B9n. `hooks/useOrchestrator.ts` guards against it; **the database does not enforce it**, so any new write path to `action_rules` must carry the same guard.

**Line numbers drift.** Treat any cited line as a starting point for a grep, not a permanent address. The superseded source was written from a single read-through, not an exhaustive per-branch audit — verify specifics against current code before relying on a claim for a fix.

### 2c. Voice-PIN security state moved into Shared Core (S1, 2026-08-19)

**What changed.** The voice server used to own the whole of voice-PIN failure handling: it read the failure count, computed the 7-day window, wrote the new value, decided whether the alert threshold had been crossed, and sent the alert SMS. `receive-sms-reply` separately mutated the lockdown flag itself. Both now **translate**: the voice server reports "a PIN attempt failed for this account", and `receive-sms-reply` routes the `BLOCK` command. `manage-voice-pin` owns the state.

**Why it is recorded here rather than left in the work item.** This is an intentional architectural change, so under the Architecture Drift Rule the Reference update is a hard merge precondition, not a follow-up.

**The two reasons it moved, which are the same reason.** S1's Phase 6 review returned FAIL on both Technical Review and Architecture Completeness:

1. *Architecture* — failure-window calculation, counter mutation and alert triggering are business and security logic, and §3 states that entry points translate rather than implement.
2. *Correctness* — the counter did read → calculate → write as three separate network operations, so concurrent failures overwrote each other. Measured against staging **before** the fix: 3 concurrent failures recorded 2, and 5 recorded 2. That is not a lost statistic — the alert fires when the count *reaches* the threshold, so an attacker issuing attempts in parallel rather than in sequence could hold it below indefinitely and never be reported.

**The remedy was one design, because the operation became atomic *by* moving to where it belonged.** `record_voice_pin_failure()` collapses the window decision and the increment into a single `UPDATE` under one row lock, and returns the resulting count — so "did this attempt cross the threshold" is answered by the same atomic statement that produced the count, rather than by a second read that could itself race. After the fix, 3/5/10 concurrent failures record 3/5/10, and each caller receives a **distinct sequential** value, which is what guarantees exactly one caller sees the threshold and the alert still fires exactly once.

**The generalisable lesson.** The race was not a coding slip that happened to sit in the wrong layer — it was *available* because the logic sat in the wrong layer. An entry point talking to the database across the network cannot make a read-modify-write atomic; only the owner of the data can. When correctness requires atomicity, that is itself evidence about where the logic belongs.

**Extended rather than added.** `manage-voice-pin` already existed in Shared Core and already owned the PIN, so it gained `record_failure` / `clear_failures` / `set_blocked` instead of a fifth function being created (AI Coding Discipline #19, refactor over layer).

**Reachability.** `record_voice_pin_failure()` is revoked from `PUBLIC`, `anon` and `authenticated`, and granted only to `service_role`. Postgres makes functions executable by everyone by default; without the revoke, any signed-in client could inflate another user's failure count and trigger alerts on their account.

**⭐ Consequence for deployment, learned the hard way on 2026-08-20 — see §0d.** Because this state
lives in Shared Core, **the voice server contains none of these identifiers on either branch.**
Searching `src/index.js` for `record_voice_pin_failure` or `voice_pin_failed_count` returns nothing
on `staging` and nothing on `main` — identically, and reassuringly, and uselessly. Promoting the
voice code therefore does **not** promote this capability; `manage-voice-pin` and
`receive-sms-reply` must be deployed to the target project separately, and production was running
both three months stale when S1 was promoted.

### 2d. The email pipeline has five triggers, not one — and two of them fan out to every user

**Added by [[B11x]] Phase 6, 2026-08-24, under the Architecture Drift Rule (Outcome 3).** This
document previously described `sync-gmail` as *"cron-driven"* in one word. That was false, it was
false before B11x began, and the falsehood is load-bearing: **every attempt to control this
pipeline's cost for four months targeted the cron, because the cron is what the map showed.**
Three migrations cut the cadence 5 → 15 → 30 → 60 minutes. None of them touched the other four
triggers, because nothing recorded that the other four existed.

| # | Trigger | `file:line` | Params sent | Actual scope |
|---|---|---|---|---|
| 1 | Hourly cron | `20260430000001_gmail_sync_cron_60min.sql:24` (`'0 * * * *'`) | none | all active users, 7 days |
| 2 | `sync-active-email-alerts` — **5-minute** cron | `sync-active-email-alerts/index.ts:68` | `target_user_id` | one user, 7 days |
| 3 | **Mobile app, 60-second interval** | `lib/gmail.ts:33` ← `app/index.tsx:1269` | **none** | **all active users, 7 days** |
| 4 | `naavi-chat` email-search intent | `naavi-chat/intentHandlers.ts:346` | **`user_id`** | **all active users, 7 days** |
| 5 | `naavi-chat` live-recent + billing intent | `naavi-chat:1265`, `:3478` | `target_user_id`, `days_back: 1` | one user, 1 day |

**Triggers 3 and 4 pass a parameter `sync-gmail` does not read.** It accepts only
`target_user_id` (`sync-gmail:131-132`); there is no `body.user_id` branch. An unrecognised key is
silently ignored, so both fall through to the no-body default at `:118-132` — `daysBack = 7`,
`targetUserId = null`, every active user. Trigger 3's adapter (`email.adapter.ts:75-77`) even
*accepts* a `userId` and discards it. **Tracked as [[B11y]]; not fixed by B11x.**

**⭐ Mobile is a client-side trigger of a capability classified Shared Core.** That is not a
contradiction — the *implementation* is genuinely shared and lives in one Edge Function — but any
reader who takes "Shared Core, cron-driven" to mean "no client reaches this" will be wrong, and
that is precisely the mistake this row previously invited.

**Classification (`extract-email-actions`) has two callers, not one:** `sync-gmail:363` and
`backfill-email-actions:67`. The second bypasses `sync-gmail` entirely, which is why B11x's guard
was placed in the classifier rather than at the caller — a guard in `sync-gmail` would not have
covered it.

**Since B11x, classification is idempotent per `(user_id, gmail_message_id)`.** Emails that produce
no action — whether rejected by the keyword pre-filter or judged non-actionable by Claude — record a
**sentinel row** in `email_actions` with `action_type` NULL. So **`email_actions` no longer means
"emails with actions"; it means "emails Naavi has looked at."** `force: true` bypasses that guard
and nothing else, and is set only by `backfill-email-actions`. **No cron may set it** — a cron that
did would reinstate B11x exactly.

## 3. Entry Point Responsibilities

An "entry point" should only translate between the user and the Shared Core — not reimplement business logic. Current state, honestly:

**Mobile app should own:**
- UI rendering, navigation, screens
- Sign-in / session management
- Capturing what the user typed or said (text input, voice-to-text for hands-free mode)
- Rendering Naavi's response (chat bubbles, alert cards, TTS playback)
- Local-only concerns: settings screen, permission prompts, background task registration (geofencing is a mobile-only capability by nature, not a violation of this principle)

**Mobile app currently also contains (drift from the ideal):**
- Its own alert-creation classifier and confirmation-speech logic (`hooks/useOrchestrator.ts`) — this is genuinely part of the mobile entry point's job today, not a violation, but it's also NOT shared with voice, which is the drift worth naming.

**Voice server should own:**
- Answering the Twilio call, managing the WebSocket audio stream
- Speech-to-text (Deepgram) and text-to-speech (Deepgram/Polly)
- Caller identification (phone number → user)
- Playing audio back, handling interruption — **⭐ but "interruption" is now TWO different designs,
  one per branch, and calling it one thing hides the difference that matters (recorded by [[B11f]]
  Phase 8, 2026-08-21):**

  | | `main` (production) | `staging` ([[B11f]]) |
  |---|---|---|
  | How a caller interrupts | **any transcript at all** — barge-in | only a recognised pause word |
  | Background noise / a radio / another person | **silences her** | ignored |
  | If the word is misheard | n/a — every word works | **cannot interrupt at all** |
  | Resume where she left off | no — the answer is discarded | yes, from the previous sentence |

  **B11f did not add a stop control alongside barge-in; it replaced barge-in.** `main:9946` clears
  playback on any transcript; `staging` removed that block deliberately (Wael's decision — a radio
  or another person in the room would otherwise silence her) and holds the remainder of the answer
  for resume. Mobile is a third design again: `hooks/useOrchestrator.ts:5068` `stopSpeaking()`
  terminates and discards, with no resume — closer to production voice than to staging voice.

  **The trade is real and has been ruled on:** an open mechanism always works but is triggered by
  noise; a closed vocabulary ignores noise but fails entirely when Deepgram mishears the word — and
  `pauseCommand.js` documents against itself that "naavi stop" arrives as "stop by actions penny
  threads" on 8 kHz mulaw. Wael's ruling (2026-08-21) is that this belongs to the **production
  promotion decision**, not to the hardening work that recorded it. Until that decision, production
  keeps barge-in and staging keeps the vocabulary.

**Voice server currently also contains (drift from the ideal):**
- Its own alert-creation classifier and reasoning loop, its own turn-state tracking, its own direct Gmail/Calendar API calls, its own direct database inserts for reminders and rules — none of which route through the mobile backend's equivalent logic. This is the single biggest gap between "what an entry point should do" and "what voice actually does."

---

## 4. Protected Core

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` §4, these areas require technical review before *and* after any change, regardless of how small the change looks. Mapped to actual files:

| Protected Core area | Files | Why | Review level |
|---|---|---|---|
| Voice orchestration | `naavi-voice-server/src/index.js` (entire file) | Controls every phone call; a mistake here is heard live by a real caller with no undo | Full Phase 1-8 |
| Action Rules | `naavi-chat/index.ts` (classifier + confirm logic), `manage-rules`, `evaluate-rules`, `report-location-event`, `_shared/task_actions.ts`, `_shared/alert_body.ts`, `hooks/useOrchestrator.ts` (mobile write paths) | Governs every alert a user creates; a mistake here silently misdirects or drops real messages to real people | Full Phase 1-8 |
| Reminder Engine | `check-reminders`, the `reminders`-table write paths | Same class of risk as Action Rules — a dropped reminder is invisible until the user notices it never happened | Full Phase 1-8 |
| Geofencing | `hooks/useGeofencing.ts`, `report-location-event`, `fire-pending-dwells` | Background location on a phone is fragile by nature (OS kills, permission changes); a regression here is hard to notice and hard to reproduce | Full Phase 1-8 |
| Calendar integration | `create-calendar-event`, `delete-calendar-event`, both sides' live-fetch code | Touches the user's real Google Calendar — a bug can create or delete a real event | Full Phase 1-8 |
| Gmail integration | `sync-gmail`, both sides' live-fetch code, `extract-email-actions`, `harvest-attachment` | Reads a real inbox; privacy-sensitive, and feeds several other features (document harvesting, alerts) | Full Phase 1-8 |
| Authentication | `lib/supabase.ts` (mobile session config), `naavi-chat`'s JWT resolution, voice's caller-phone resolution | A mistake here can leak one user's data to another (see CLAUDE.md's Rule 10, multi-user safety) | Full Phase 1-8 |
| Permissions | `hooks/useGeofencePermissions.ts`, Android manifest entries | Getting this wrong silently breaks location alerts with no error the user can see | Full Phase 1-8 |
| Background scheduling | Cron definitions (`cron.job` entries) for `evaluate-rules`, `check-reminders`, `sync-gmail`, dwell timers | A duplicate or missing cron job either double-fires alerts or silently stops them | Full Phase 1-8 |
| Notification routing | `send-sms`, `send-email`, the fan-out logic inside `evaluate-rules`/`report-location-event`, `user_settings.alert_channels_enabled` | Directly controls whether and how a real message reaches a real phone | Full Phase 1-8 |
| Database schema | All migrations, RLS policies, unique constraints on `action_rules`/`reminders`/`lists`/`contacts` | A bad migration or a missing constraint is the hardest category of mistake to reverse safely | Full Phase 1-8, migration reviewed separately |
| API contracts | The shape of `action_config`, `trigger_config`, `task_actions`, and every Edge Function's request/response shape | An undocumented shape change breaks whichever caller wasn't updated — exactly the failure class this document exists to prevent | Full Phase 1-8 |

**Who is allowed to modify Protected Core:** per the project's standing rule, any AI session working in this codebase — but only by following the full governance process (Phase 1 Problem Definition through Phase 8 Merge), with Wael's own explicit go-ahead required between every phase. No phase's "Approved" review verdict is itself permission to proceed to the next phase.

**What is NOT Protected Core** (candidate for a lighter process, but still requires asking first): pure UI/display code with zero shared-logic or backend touch — e.g., how a screen renders existing data, wording-only changes with no behavior change. Even these should be confirmed with Wael before assuming the lighter path applies.

---

## 5. Current Architecture Debt

Ranked by priority. Debt that isn't visible stops being tracked and becomes a permanent trap — this section exists specifically so that doesn't happen here.

**Priority 1 — Action Rule classifier duplicated.** Mobile (`naavi-chat`'s classifier + `buildActionConfirm`) and voice (its own Claude reasoning loop) each independently decide what a new alert should be, using separately-written logic. This is the duplication that directly caused B10k (a mobile-side fix that never reached voice callers). No unification planned — formally accepted as an Architecture Exception, dated, reviewable 2027-07-18 or at the next Architecture Audit Trigger. See `docs/adr/0001-action-rules-classifier-duplication-accepted.md`.

**Priority 1b — Action Rules execution (fan-out) duplicated intra-Shared-Core.** `evaluate-rules` and `report-location-event` independently implement overlapping fan-out logic (channel selection, self-alert detection, `task_actions` execution) for different trigger types, with only a code comment enforcing "keep both in sync." Proven by three confirmed drift incidents (F5c's partial fix, B10d's channel-preference gap, B10g's `task_actions` gap) — found during T1a (Architecture Integrity Audit, 2026-07-18). No full unification planned — the narrower "extract the specific drifted piece into a shared module" pattern (B10g's `_shared/task_actions.ts`) is the accepted approach instead. See `docs/adr/0005-action-rules-execution-fanout-duplication-accepted.md`.

**Priority 1c — Action outcome reporting / failure surfacing duplicated three ways.** Whether a user
is told the truth about an action that failed is decided independently in three places, with no
shared module and nothing enforcing consistency: voice's action loop
(`naavi-voice-server/src/index.js` — speaks before executing and discards the result), mobile's
`hooks/useOrchestrator.ts` (`turnSpeechOverride`, correct for most actions), and `naavi-chat`'s Step
1.4 executors (correct, and Shared Core). **Not an accepted Exception** — voice's instance is a live
defect tracked as [[B11k]]. **The cost of this row's previous absence is the argument for its
existence:** the voice instance was found and fixed narrowly three times — the list confirm gate
(2026-05-12), the time-trigger gate (2026-07-15), and B10q's email-alert branch plus its own
independently-discovered follow-up (2026-07-21) — each fixing only the action in front of the person
who found it, because no inventory row said they were one class. Added 2026-08-23 by B11k Phase 1A.

**Priority 2 — Calendar reads duplicated.** Both sides independently call the Google Calendar API for live event data, instead of sharing one fetch. No unification planned — formally accepted as an Architecture Exception, dated, reviewable 2027-07-18 or at the next Architecture Audit Trigger. See `docs/adr/0002-calendar-reads-remain-duplicated.md`.

**Priority 3 — Gmail reads duplicated.** Both sides independently call the Gmail API for "what's new" reads — separate from the genuinely-shared `sync-gmail` background cron. Voice itself has two independent internal call sites, not just one vs. mobile's one. No unification planned — formally accepted as an Architecture Exception. See `docs/adr/0006-gmail-live-reads-remain-duplicated.md`.

**Priority — List reads duplicated (previously unranked).** Both sides independently query the `lists` table directly (different client mechanisms, same pattern) instead of sharing one read path, even though list *writes* already go through the shared `manage-list` function. No unification planned — formally accepted as an Architecture Exception. See `docs/adr/0007-list-reads-remain-duplicated.md`.

**Priority 4 — Conversation state duplicated.** Mobile and voice each track pending-confirmation state independently, in incompatible ways (different runtimes, different session models). Unlike Priorities 1/1b/2/3/List reads, this one has a substantive technical reason to remain duplicated (no shared cross-runtime session layer exists for either side to unify into) rather than simply being unexamined debt — formally accepted as an Architecture Exception on those grounds. See `docs/adr/0008-conversation-turn-state-remains-duplicated.md`.

**Priority 5 — Reminders write-path divergence.** Voice writes directly to the `reminders` table; mobile redirects the same request into `action_rules` instead (for a real, documented reason — Alerts-screen visibility). Voice's side has no equivalent documented reasoning and most likely predates mobile's redirect. Unlike the other priorities above, this one is **not** formally accepted — ADR 0003 recommends bringing voice's path in line with mobile's, and it is tracked as its own fix candidate, holding-list item `B10l`, not an indefinite Exception. See `docs/adr/0003-voice-reminders-write-path-diverges-from-mobile.md`.

### 5a. Full Duplication Inventory

| Capability | Shared | Duplicated | Planned to unify |
|---|---|---|---|
| Contacts / name resolution | ✅ | | |
| Notification sending | ✅ | | |
| Global Search | ✅ | | |
| Claude system prompt (non-classifier) | ✅ | | |
| List creation | ✅ | | |
| Calendar writes | ✅ | | |
| Gmail background sync | ✅ | | |
| Drive saves | ✅ | | |
| **Action Rules creation (classifier)** — Priority 1 | | ✅ | Not scheduled — Accepted as Architecture Exception (ADR 0001), dated, review 2027-07-18 or next Audit Trigger |
| **Action Rules execution (fan-out), intra-Shared-Core** — Priority 1b | | ✅ | Not fully scheduled — Accepted as Architecture Exception (ADR 0005); narrower per-drift extraction pattern (B10g's `_shared/task_actions.ts`) is the accepted ongoing approach, review 2027-07-18 or next Audit Trigger. **Corrected 2026-07-18 (T1a):** this row previously appeared only in the ✅ Shared section above, worded "genuinely shared" — true only for the mobile-vs-voice axis; the intra-Shared-Core duplication between `evaluate-rules` and `report-location-event` was unstated until this audit |
| **Action outcome reporting / failure surfacing** — Priority 1c (**new row 2026-08-23, was missing entirely**) | | ✅ | **Not** an accepted Exception. Three independent implementations: voice's action loop (broken — speaks before executing, discards the result), mobile's `useOrchestrator` (`turnSpeechOverride`, correct for most actions), and `naavi-chat`'s Step 1.4 executors (correct, and Shared Core). Nothing enforces consistency. Three narrow fixes to the voice instance landed independently — 2026-05-12, 2026-07-15, 2026-07-21 — without the class being named. Tracked as [[B11k]] |
| Calendar reads — Priority 2 | | ✅ | Not scheduled — Accepted as Architecture Exception (ADR 0002), dated, review 2027-07-18 or next Audit Trigger |
| Gmail live reads — Priority 3 | | ✅ | Not scheduled — Accepted as Architecture Exception (ADR 0006), dated, review 2027-07-18 or next Audit Trigger |
| List reads | | ✅ | Not scheduled — Accepted as Architecture Exception (ADR 0007), dated, review 2027-07-18 or next Audit Trigger |
| Conversation/turn state — Priority 4 | | ✅ | Not scheduled — Accepted as Architecture Exception (ADR 0008) for a substantive technical reason (no shared cross-runtime session layer exists), not just unprioritized debt; review 2027-07-18 or next Audit Trigger |
| **Reminders write-path divergence** — Priority 5 (**new row, was missing despite having ADR 0003**) | | ✅ | **Not** an accepted Exception — ADR 0003 recommends a fix (align voice's write path with mobile's `action_rules` redirect); tracked as holding-list item `B10l` |
| `task_actions` on location alerts, real-world reach | | ✅ (voice literally cannot produce this input) | Deferred pending a production-promotion or voice-staging decision (see Appendix) |

**Reading this table:** every ✅ in the "Duplicated" column is a place where a fix applied to one side silently does not apply to the other, and nothing in the codebase enforces that they stay in sync. This has already caused at least four confirmed incidents in this project's history (see Appendix's T1a reference) — it is the single highest-leverage category of future bug.

---

## 6. Data Flow

*Diagram Version 1 — see the version block at the top of this document. Bump this label independently when the diagram itself changes, per the Architecture Change Procedure (§8).*

```
Voice caller
     │
     ▼
naavi-voice-server (Twilio + Deepgram STT/TTS)
     │
     ├──► shared Edge Functions (lookup-contact, resolve-recipient,
     │     evaluate-rules-fired-sends via send-sms/send-email,
     │     global-search, manage-list writes, save-to-drive,
     │     create/delete-calendar-event, get-naavi-prompt)
     │
     └──► voice's OWN logic (classifier, Gmail/Calendar live reads,
           list reads, action_rules/reminders inserts, turn state)
                                                              │
                                                              ▼
                                                          Supabase
                                                       (Postgres + cron)
                                                              ▲
     ┌──► shared Edge Functions (same list as above) ─────────┤
     │                                                        │
Mobile app (React Native)                                     │
     │                                                        │
     └──► mobile's OWN logic (hooks/useOrchestrator.ts —      │
           classifier confirm, address resolution, task      │
           creation, its own Gmail/Calendar live reads) ──────┘
```

**The one-sentence version:** both clients share the database and a real set of Edge Functions for read-only lookups, sending messages, and firing alerts — but each independently decides *what an alert should be* before it ever reaches that shared layer, and each independently re-fetches live Calendar/Gmail data rather than sharing one fetch.

---

## 7. Decision Rules

When adding new functionality, in order:

1. **Can it live in Shared Core (an Edge Function both mobile and voice call)?** If yes, it must be built there — not duplicated separately inside `hooks/useOrchestrator.ts` and `naavi-voice-server/src/index.js`.
2. **Entry points may only translate.** Mobile should convert taps/typed text into a request and convert the response into UI. Voice should convert speech into a request and convert the response into audio. Neither should independently decide business logic that the other surface also needs.
3. **Duplication requires explicit approval, named as duplication, not discovered later.** If a capability truly cannot be shared (e.g., geofencing is mobile-only by nature — that's fine, it's not duplication, it's a mobile-specific capability), say so explicitly in the Phase 2 Change Plan. If two surfaces really do need independent implementations of the same idea, that decision needs its own stated reason, not silence.
4. **Before claiming "this is already shared," verify it against the actual other codebase.** This document exists because that exact assumption, unverified, was wrong once this session and cost real re-work. Grep the other codebase for the specific function or logic in question before writing "shared" anywhere.
5. **A shared Edge Function does not guarantee shared behavior.** Confirm both callers actually reach the code path you changed — see §2a: `evaluate-rules`/`report-location-event` are genuinely shared, but voice's own creation path can't produce the input (`task_actions`) that exercises the shared fix. "The backend is shared" and "both surfaces can actually trigger this" are two separate claims — check both.
6. **Protected Core changes always follow the full governance process** (`docs/AI_DEVELOPMENT_GOVERNANCE.md`), regardless of how small the diff looks. Size of change and required rigor are not correlated in this codebase's history — several of its cheapest-looking fixes caused the most expensive regressions.

### 7a. Never

- Copy Shared Core logic into an entry point.
- Declare functionality shared without verification.
- Modify Protected Core outside governance.
- Introduce duplicate implementations without explicit approval.

---

## 8. Architecture Change Procedure

Whenever a change:
- moves responsibility between components,
- introduces duplication,
- removes duplication, or
- changes Shared Core ownership,

this document must be updated in the same implementation — the same commit or session as the code change, not deferred to a later cleanup pass. An architecture document that lags the code it describes is worse than no document at all, because it creates false confidence that a check happened when it didn't.

---

## Appendix — Where this document came from

This reference was written 2026-07-18, immediately after a session that surfaced exactly the risk this document is meant to prevent: a governance document confidently claimed a classifier fix was "shared across mobile and voice, no voice-server change needed" — a claim that turned out to be false when actually checked against the voice codebase. That specific gap is tracked as **B10k** in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` (Tier 1, top of the priority queue as of this writing) — the fix exists in mobile's Shared-Core-adjacent prompt file, but has not been promoted to the production environment voice actually runs against.

The broader pattern — features added to one of two independently-maintained implementations and never mirrored to the other — is tracked as **T1a** (architecture integrity audit) in the same holding list, with four confirmed instances at the time of writing (recipient resolution, channel-preference handling, `task_actions` execution, and the alert-creation classifier itself).

**Update, 2026-07-18 (T1a Phase 4 execution):** the audit's coverage check dispositioned seven items total (the four above, plus Calendar reads, Gmail live reads, and List reads, which had no confirmed incident but were verified as genuinely duplicated) and surfaced one item that wasn't previously in this table at all (Reminders write-path divergence, ADR 0003 — pre-existing but never cross-referenced here). Six are now formally Accepted Architecture Exceptions with dated review triggers (ADRs 0001, 0002, 0005, 0006, 0007, 0008); one (Reminders) is explicitly **not** accepted and is tracked as a fix candidate, holding-list item `B10l`. Full execution record: `docs/T1A_PHASE5_EVIDENCE_2026-07-18.md`.

This document is authoritative until superseded by a newer verified version. Any architectural claim not reflected here must be verified directly against the code before implementation.
