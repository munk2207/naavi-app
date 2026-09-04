# FAQ — Mobile Stage, Phase 3: Technical Review (Before Coding)

**Date:** 2026-09-04
**Item:** F25 Stage 2
**Risk:** Medium (Phase 2 §5) — Phase 3 review is therefore mandatory
**Phases 0, 1, 1A, 2:** all approved by Wael, 2026-09-04
**Architecture Reference:** `2026.09.03.17`
**Governance:** v4.3, Phase 3. **No code written.**

Claude's technical self-review of its own Phase 2 plan, prepared for external review. **It is not an
approval.** Seven findings. **Two are pre-existing defects in the exact code the plan modifies**, and
one of them is a shape this project has already paid for once.

---

## Part A — Findings

### A1 — ⚠️ The rate limiter fails open, silently, on any database error

**Severity: highest in this review. Pre-existing — Stage 1's code, not introduced here.**

`match-faq/index.ts:117-135`:

```
const { data: rl } = await admin.from('faq_rate_limit').select(...)   // error DISCARDED
const used = (rl as ...)?.request_count ?? 0;                          // error -> null -> 0
...
await admin.from('faq_rate_limit').upsert({...});                      // result DISCARDED
```

Neither call checks its error. **A failed read yields `used = 0`, so the limit never trips**, and a
failed write is invisible. The only control standing between a public, unauthenticated, paid AI
endpoint and an unbounded bill can stop working without producing a single log line.

**This is not hypothetical for this plan.** Phase 2 §6 deploys the migration before the function.
Between those two steps the deployed function queries a column that no longer exists — and under
A1, that is silent. The limiter is simply off for the duration, and nothing says so.

**It also violates CLAUDE.md Rule 21 (no silent failures)** — *"anywhere Naavi could silently stop
working for a user — log it."*

**Options:**

| | Approach | Assessment |
|---|---|---|
| a | Check both errors; on a read failure, **fail closed** (refuse) | Safest for cost. But a transient DB blip then blocks the public FAQ matcher for real customers |
| b | Check both errors; on failure, **log loudly and proceed** | Preserves availability, ends the silence. The bill is exposed only while the DB is unhealthy |
| c | Leave it, record it as its own item | Defensible — it is out of this stage's scope — but the plan's own migration will trip it |

**Claude's recommendation: (b), plus ordering the deploy to avoid the window** (A3). Refusing real
customers to protect against a cost that only materialises during a database outage is the wrong
trade for a support form.

### A2 — ⚠️ The counter has a lost-update race, and this project has seen this exact bug before

**Pre-existing. Same lines.**

`:117-135` is read → compute → write across three network operations:

```
select request_count   ->  used
upsert { request_count: used + 1 }   // onConflict replaces, does not increment
```

Two concurrent requests both read `5` and both write `6`. The count under-reports, so the ceiling
is reached later than it should be — or never, under sustained parallel load, which is precisely the
shape an abuser produces.

**This is the S1 voice-PIN defect, rediscovered.** Architecture Reference §2c records it verbatim:
*"the counter did read → calculate → write as three separate network operations, so concurrent
failures overwrote each other. Measured against staging before the fix: 3 concurrent failures
recorded 2, and 5 recorded 2."* And its lesson: *"When correctness requires atomicity, that is
itself evidence about where the logic belongs."*

**The remedy is already built and proven in this codebase** — `record_voice_pin_failure()` collapses
the window decision and the increment into one `UPDATE` under a row lock. The same shape applies:
`INSERT … ON CONFLICT DO UPDATE SET request_count = faq_rate_limit.request_count + 1 RETURNING`.

**Why it matters more after this stage than before:** today the limiter's callers are web visitors
arriving one at a time. Adding the app adds a population that can generate genuinely concurrent
calls against **one** subject once identity is per-user.

**Options:**

| | Approach | Assessment |
|---|---|---|
| a | **Atomic increment in the migration this plan already ships** — `INSERT … ON CONFLICT DO UPDATE SET request_count = faq_rate_limit.request_count + 1 RETURNING`, replacing the select-then-upsert | One statement, in a migration already being written. The proven pattern from `record_voice_pin_failure()`. Cost: the limiter is no longer expressible in the client library alone, and the function's read path changes shape |
| b | **A Postgres function**, mirroring `record_voice_pin_failure()` exactly — window decision and increment inside one call | Closest to the established precedent, and testable in isolation. More machinery than a one-table counter warrants |
| c | **Record it as its own item; change nothing here** | Respects Rule 0.3 and the No Extra Changes Rule most strictly. Cost: this stage ships per-user limiting on a counter that under-counts per user, and the population most able to trigger the race is the one being added |
| d | **Accept the race permanently** — document that the limit is approximate | Honest and cheapest. Defensible for a cost control rather than a security boundary, but it makes the ceiling unreliable in exactly the sustained-parallel case an abuser produces |

**Claude's recommendation: (a).** It is one statement inside a migration already being written, the
pattern is proven in this codebase, and the alternative under (c) is shipping a per-user limit that
under-counts per user. **(d) is the option to choose if the reviewer judges the whole control
disproportionate** — but that is a decision about the control, not about this stage.

### A3 — The deploy window in Phase 2 §6 is unsafe while A1 stands

Schema-before-code is correct (Reference §0d). But with A1 unfixed, the gap between the two steps
means the limiter is silently off, and nothing reports it.

**Options:**

| | Approach | Assessment |
|---|---|---|
| a | **Fix A1 first, keep the single rename** | The window still exists but it is now loud — the failure appears in the logs instead of passing as "no requests yet". Simplest, and depends on A1 being resolved as (a) or (b) |
| b | **Backward-compatible two-migration sequence** — add `subject_hash`, backfill, deploy the function, drop `ip_hash` in a second migration | No window at all. Costs two migrations, two deploys and two drift-baseline updates on a table whose rows expire within five minutes |
| c | **Keep `ip_hash` as the column name** and store `sha256('user:'+id)` in it — no migration, so no window | Smallest possible change under Rule 0.3. Rejected in Phase 2 §1 because the name would then misdescribe its contents, which is the failure class §2d and §0b already record. **Listed because it is the option that makes A3 disappear entirely**, and a reviewer may weigh that differently than I did |

**Claude's recommendation: (a).** The two-migration dance in (b) costs more than it buys on a
five-minute-window table, and (c) trades a documented, recurring failure class for a one-time
convenience.

### A4 — `--no-verify-jwt` must stay, and nothing in the plan says so

`scripts/deploy-edge-function.js:214` deploys with `--no-verify-jwt`. **This is load-bearing for the
website**, which sends no credentials: with gateway JWT verification on, `mynaavi.com/report` would
receive a 401 *before the function runs*, and no amount of correct in-function fail-open would help.

The plan adds token handling to a function that must remain callable without a token. That is
exactly the situation in which someone later "tightens" the deploy flag. **It should be stated as a
constraint in Phase 2, not left to the wrapper's default.**

### A5 — The app needs a timeout on the match-faq call; the website has none

`match-faq` measured **~1265 ms** uncached. On the web a hang means a stuck Send button. **On mobile
it is worse** — the customer is holding a phone, has pressed Send, and has no console to inspect.

The app already has the pattern: `lib/invokeWithTimeout.ts` exports `invokeWithTimeout` and
`queryWithTimeout`, used across the codebase. **A timeout must be specified in the plan** (proposed:
4 s), and expiry must fall through to sending — identical to any other failure.

**Noted, not proposed:** `report.html:300` has no timeout either, relying on the browser default.
That is a latent issue on the live site and **out of this stage's scope**; recorded so it is not
lost.

### A6 — Identity resolution must short-circuit when no token is present

Phase 2 §1 lists the resolution order but does not state the performance consequence. If the
implementation calls `getUser()` before checking whether an `Authorization` header exists, **every
website call pays the measured 132 ms for a token that was never sent.**

The check must be: no header, or the header equals the anon key → skip verification entirely. **A
constraint on the implementation, not a redesign.**

### A7 — The Non-Determinism Rule does not strictly apply, and the tests should behave as if it did

Governance Phase 3 requires 3 trials for *"any change to a Claude/Haiku classifier prompt or Claude
system prompt."* **No prompt changes in this stage** — `match-faq`'s model call is untouched. So the
rule is not triggered.

**But the function it calls remains non-deterministic**, and a single-trial mobile test would carry
the same false confidence the rule exists to prevent. **The mobile positive-control cases should run
3 trials with the distribution reported**, clearing the cache between them exactly as Stage 1's
tests do — and for the same reason: the cache would otherwise replay one answer three times.

---

## Part B — The five Mandatory Review Gates (§13)

**Gate 1 — Scope Compliance.** **PASS**, with one flag. Every file in Phase 2 §1 serves a Phase 0
in-scope item. **A1 and A2 are pre-existing defects in a file the plan already modifies — fixing
them is a scope decision for Wael, not an implementation choice.** Flagged, not assumed.

**Gate 2 — Governance Compliance.** **CONDITIONAL FAIL, self-reported.** A1 leaves a Rule 21
violation in place in code this plan edits, and A5's missing timeout is not in the plan. Both are
remedied by amending Phase 2 before Phase 4.

**Gate 3 — Architecture Compliance.** **PASS.** No new duplication; two implementations become one.
No Shared Core bypass. No ownership change (Phase 1A §1). Cross-repository verification completed
with provenance tags. The Outcome 3 drift finding is recorded and deferred to Phase 8 per v4.3.

**Gate 4 — Technical Correctness.** **FAIL as written.** A1 (silent fail-open) and A2 (lost update)
are defects in the control this plan extends, and A3 makes A1 reachable during the plan's own deploy
sequence. Building per-user rate limiting on a counter that under-counts and fails silently is
building on sand.

**Gate 5 — Evidence Sufficiency.** **Not yet reachable.** Depends on the amended test plan from A7
and the decisions on A1/A2.

**Overall recommendation: APPROVED WITH MANDATORY CHANGES** — A1, A2, A3 and A5 resolved and Phase 2
amended; A4, A6 and A7 folded into the plan as written constraints.

---

## Part H — Review outcome, 2026-09-04

**APPROVE WITH 7 MANDATORY CHANGES — Wael, 2026-09-04.** Decisions returned:

1. **A1 — fix now, option (b):** fail open **loudly**. Log rate-limit DB failures; preserve FAQ
   availability.
2. **A2 — fix now, option (a):** make the counter atomic using the proven database increment
   pattern.
3. **A3 — option (a):** single rename plus the A1 fix. No two-migration sequence.
4. **A4 / A5 / A6 / A7 — all four added as explicit Phase 2 constraints:** preserve
   `--no-verify-jwt`; mobile timeout with submit fall-through; skip identity verification when no
   real token exists; 3-trial, cache-cleared positive controls.
5. **F1 — Phase 4 is NOT blocked** on running the live suite. **Phase 5 must run the real suite
   against the explicitly verified intended environment, and must not run it accidentally against
   production.**
6. **F2 — separate item.** Cross-environment classifier reproducibility is a Stage 1 / content
   issue, not part of this mobile change.
7. **Part G — correct the Stage 1 governed record before Phase 4.** Create the retrospective Phase 8
   record and correct the stale holding-list and FOR WAEL'S EYES state. **Do not rewrite history** —
   record the actual deployment and manual-validation sequence and the defects discovered.

All seven are resolved: #7 landed in commit `28b40f9`, and #1–#6 are amended into **Phase 2 §6a**.
Gate 2 and Gate 4, which this document self-reported as failing, are resolved by that amendment.

**Proceed to Phase 4.**

---

## Part C — Implementation Boundaries

**No implementation is authorized by this document.** When authorization is given, it covers exactly
the six files in Phase 2 §1 and the change described for each, plus whatever A1/A2 resolution Wael
approves. Specifically:

- **No additional files** beyond those six.
- **No opportunistic refactoring.** In particular `get-faq`, `manage-faq`, `check-staff` and every
  website and staff-portal file are untouched.
- **No change to `match-faq`'s response contract.**
- **No architectural changes** beyond adding one consumer to an existing Shared Core function.
- **Explicitly excluded:** the voice server; `app/help.tsx`; the website's own missing timeout (A5);
  the Architecture Reference (Phase 8); production deployment; and the AAB.

---

## Part D — Deferred Architectural Decisions

**D1 — Sharing the Send-gate glue between `app/contact.tsx` and `app/report.tsx`.** Not approved.
~40 lines repeat across the two screens, mirroring the same accepted repetition between
`report.html` and `contact.html`. Reconsider if a third surface needs it — at three, a hook earns
its existence.

**D2 — A timeout on the website's own `match-faq` call.** Not approved and out of scope (A5).
Reconsider as its own small item.

**D3 — Extracting the rate limiter into a reusable module.** Not approved. It has one caller. Revisit
only if a second public paid endpoint appears.

---

## Part F — Open items this stage does NOT address

Added 2026-09-04 after Wael asked whether Part A reflected everything open. **It did not.** Part A
covers only defects in the code this plan touches; these are open, known, and have no other home.

### F1 — ⚠️ The 30 F25 test cases have never run inside the real runner

`tests/runner.ts:28,300` registers `faqTests`, so they are wired. But **10 of the 30 were written
today**, after Stage 1's Phase 7, and the suite has not been executed since. What has run is a
scratch harness that imports the catalogue directly and executes only the 12 file-reading cases —
**it bypasses `runner.ts` entirely, including its fixtures.**

**So the 18 live cases are unproven against the current deployed functions**, and the 10 new ones
have never run in the harness that Gate 1 actually uses.

**⚠️ And running the suite is not free.** CLAUDE.md is explicit: `--grep` does not limit what the
auto-tester touches — `setupSuite`/`teardownSuite` execute regardless and perform live DELETEs
against whichever project `SUPABASE_URL` names. **It is set to PRODUCTION in `tests/.env`**
(verified this session). Whoever closes Gate 1 for this stage must read the environment banner
first.

**Not a defect in this plan — a gap in its evidence base.** Phase 5 must run the real suite and
report it, not a filtered subset.

### F2 — A capability demonstrated on staging does not reproduce on production

Stage 1's Phase 5 §4f recorded that searching `"password"` finds *"What does MyNaavi remember?"* —
a word in neither its question nor its answer, matched through the AI's generated search terms. It
was presented as proof that meaning-based search works.

**Measured today, both environments:**

```
STAGING     23 answers | "password" present in: what-remembers
PRODUCTION  26 answers | NO answer carries "password" anywhere
```

**The documents are not wrong.** Phase 5 §4f is headed *"Browser verification — against staging"*
and Phase 7 §3 says the same. They labelled their environment correctly.

**What is unrecorded is the consequence:** the classifier runs per environment, so the same 23
answers produced *different search terms* in each. A capability proven on staging can be absent on
production without anything failing, and no check compares them — the drift check compares schema,
`parity:verify` compares function source, and neither looks at generated content.

**This bears directly on A7.** The reason the mobile tests should run 3 trials is the same reason
this happened: the model's output is not stable, and evidence gathered in one environment does not
transfer to another.

**Recommendation: record it as its own item rather than fix it here** — it is Stage 1 content, not
Stage 2 code, and "make classification reproducible across environments" is a real piece of work.

### F3 — Stage 1 deferrals, still open

Both recorded in Stage 1's Phase 6 §8; cross-referenced here so a reader of this document knows
they exist:

- **`extractJson` exists in three copies** — `match-faq`, `manage-faq`, and `naavi-chat:72`. This
  session found the same parsing bug in two of the three. Deferred because fixing it means editing
  `naavi-chat`, a Protected Core file outside the approved boundary.
- **The support-form glue is duplicated** between `report.html` and `contact.html`. This stage adds
  a third and fourth instance in the app — see D1, where that is a deliberate decision rather than
  an oversight.

### F4 — Housekeeping, unresolved

- `docs/SESSION_HANDOFF_2026-09-03_F25_INCOMPLETE_AND_UNTESTED.md` is untracked. Wael has been asked
  whether to commit it as history or delete it; no answer yet.
- `docs/.obsidian/workspace.json` and `supabase/.temp/cli-latest` remain uncommitted as incidental
  tool churn, deliberately.

---

## Part G — ⚠️ The governed record of Stage 1 does not describe what happened

Added 2026-09-04, after Wael asked a **second** time whether Part A reflected everything open. Part F
was the answer to the first asking and it was still incomplete: it audited the code and the tests
and never audited the documents. **Stage 2 is being planned on top of a Stage 1 whose own record
says it never shipped.**

**Every item below is the same failure**: a document that was true when written, stopped being true,
and had nothing forcing it to update. That is the failure CLAUDE.md names about architecture
documents, and the one the FOR WAEL'S EYES gate explicitly warns it cannot catch — *"it checks that
a line EXISTS and is still SHORT AND PLAIN. It cannot check that it is still TRUE."*

### G1 — Stage 1 has no Phase 8 document

`docs/FAQ_REBUILD_PHASE*` contains 0, 1, 1A, 2, 3, 5, 6, 7. **There is no Phase 8.** The Phase 8
*work* was done and pushed — the Architecture Reference reconciliation, commit `f1811e3`, version
`2026.09.03.17` — but no document records the merge, what it covered, or that Stage 1 closed.

### G2 — Stage 1's Phase 7 still says the work is held

`FAQ_REBUILD_PHASE7_TESTING_2026-09-02.md` currently reads, verbatim:

- `:8` — *"STATUS: HELD — awaiting Wael's authorisation to deploy to production"*
- `:131` — *"Phase 8 is not authorized by this document."*
- `:147` — *"Status: awaiting Wael's authorisation."*

**All three are false now.** Production was deployed, the staff portal and the website were pushed,
and Phase 8's edit is committed. A reader coming to this item cold is told it is waiting for
permission it received.

### G3 — Phase 7 still says the staff surface is unverified

`:129` — *"Manual: PARTIAL. The staff-facing surface is not verified at all, and this document does
not pretend otherwise."*

Wael has since used it and **found six defects by using it.** The sentence was scrupulously honest
when written and is now simply wrong.

### G4 — The six defects Wael found exist only in commit messages

Staff list ordering · category management missing · the faded **Publish again** · the empty-state
blaming the wrong filter · the one-hour cache · no staff search. All six were found by Wael on live
surfaces, all six were fixed and shipped across three repositories, and **not one has a phase
document.** Each has a commit message and a regression test; neither is the governed record.

**This is the gap that matters most**, because those six are the only real evidence of what manual
validation actually produced — and Phase 7 is where that belongs.

### G5 — F25's holding-list row and FOR WAEL'S EYES line are stale

The line still reads: *"Staff **will** add and edit FAQ answers… Today the same answers live in
three files and **the app knows only 12 of 23**."*

- **"12 of 23"** — there are **26** published answers now
- **Future tense** — staff have been adding answers on production since yesterday
- **"three files"** — it is two, since the website copy was collapsed
- The row says nothing about Stage 2, the production deploy, or that the item is live

**CLAIMS this line makes that its own gate cannot check.** The pre-push gate passed on it an hour
ago, correctly, because it only checks that a line exists and is short.

### What this needs, and where it belongs

**None of it belongs in Stage 2's Phase 3.** It is recorded here because Wael asked what is open and
this is the register he is reading. The repairs belong in:

| Item | Belongs in |
|---|---|
| G1, G2, G3, G4 | A **Stage 1 Phase 8 document**, written retrospectively and honestly labelled as such — including that manual validation happened *after* the deploy, which is not the order the plan specified |
| G5 | The holding list, in the same edit |

**Recommendation: write Stage 1's Phase 8 document before Stage 2 reaches Phase 4.** Not for
tidiness — because Stage 2's Phase 8 will have to update the same row and the same Reference, and
doing that on top of a record that still says Stage 1 is awaiting permission would bake the error in
one layer deeper.

---

## Part E — What the external reviewer is asked to decide

1. **A1** — fail closed, fail open loudly, or defer? A public paid endpoint's only cost control
   currently fails silently.
2. **A2** — fix the lost-update race in this stage, given the plan already ships a migration and the
   remedy is a proven pattern in this codebase?
3. **A3** — single rename plus an A1 fix, or a two-migration backward-compatible sequence?
4. Whether A4, A5, A6 and A7 are correctly assessed as constraints to record rather than redesigns.
5. **F1** — is it acceptable to reach Phase 4 with 18 live test cases unproven against the currently
   deployed functions, provided Phase 5 runs the real suite? Or must Gate 1 be closed first?
6. **F2** — record the cross-environment classification difference as its own item, or treat it as
   in scope here?
7. **Part G** — should Stage 1's Phase 8 document be written, and the holding-list row corrected,
   **before** Stage 2 proceeds to Phase 4? The record currently states that Stage 1 is awaiting
   permission to deploy, that its staff surface is unverified, and that the app knows 12 of 23
   answers. All three are false, and Stage 2's own Phase 8 will edit the same row.
