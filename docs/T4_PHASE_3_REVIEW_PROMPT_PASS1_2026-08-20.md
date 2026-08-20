# Phase 3 Review Prompt — T4 Pass 1 — Definition Parity

Paste everything below the line into ChatGPT. No attachments needed.

---

You are the External Technical Reviewer for the MyNaavi project, performing a **Phase 3 — Technical Review (Before Coding)** under Release Gate Workflow v4.0. **No migration has been written.**

## The work item

**T4 — make staging and production functionally equal, and keep them that way.**

Opened after the product owner called both phone lines within a minute of each other. Production greeted him normally; staging announced *"this is our first call"* and played a thirty-second, uninterruptible onboarding monologue — on **every** call. Cause: `user_settings.first_call_completed_at` exists in production and not in staging.

His expectation had been that staging was a copy of production. **It never was.** Staging is a reconstruction from the migration files: it contains what those files describe and nothing else.

## What the measurement found

`docs/T4_SCHEMA_FINGERPRINT.sql` — a read-only catalogue query — was run against both projects at **definition level** (types, defaults, nullability, index and constraint definitions, RLS expressions, function bodies, cron schedules).

**An earlier name-level comparison found 14 differences. Definition-level found 184:** 89 missing from staging, 44 staging-only, and **51 present in both but defined differently** — a category the name-level pass reported as matching.

*(A raw count of 207 missing was corrected to 89 before reporting: 118 were pgvector/pg_trgm functions sitting in production's `public` schema and staging's `extensions` schema. Same extensions, same versions, different placement. Real project functions missing: zero.)*

**This pass covers only the 42 columns defined differently.** The rest is Pass 2.

## ⭐ The finding that drives this pass

**Production enforces `NOT NULL` where staging does not — including `user_id` on six tables.**

`contacts` · `calendar_events` · `gmail_messages` · `knowledge_fragments` · `push_subscriptions` · `naavi_notes`

**Staging is more permissive than production.** A row with a NULL `user_id` inserts happily on staging and is rejected by production. So a test can pass on staging and fail in production — the inverse of what staging is for. The project's own standard (CLAUDE.md, DATA INTEGRITY — FOUR LAYERS) makes `NOT NULL` **Layer 1**, "the layer that cannot be bypassed by any code path". Staging cannot exercise Layer 1 on those tables.

## Validation — is production's version intentional?

The Phase 1 reviewer required that "replicate" stay provisional: each difference must be validated against intended production behaviour, not copied because production has it.

**The migration files declare, for every one of these tables:**

```sql
user_id  uuid  REFERENCES auth.users(id) ON DELETE CASCADE,
```

**No `NOT NULL`.** So staging matches the files exactly — it is faithful, not broken. **Production was tightened afterwards and the files never captured it.** Production is ahead of its own documentation.

The tightening is judged intentional on three grounds: the project's Layer-1 standard; the multi-user safety rule, which rests on `user_id` being present; and production having enforced it in live operation without incident.

## The plan — one migration, three buckets, classified by DIRECTION

| Bucket | Count | Action |
|---|---|---|
| **A — production stricter** | 19 | `SET NOT NULL` on staging (+3 defaults) |
| **B — staging stricter** | 12 | **Nothing.** Not in the migration at all |
| **C — defaults only** | 11 | 10 × `SET DEFAULT`, 1 × `DROP DEFAULT` (debris) |

**Bucket B is the part most worth your attention.** Here production is the *looser* one — 12 timestamps and booleans, each with a default, that are `NOT NULL` on staging and nullable in production. "Make staging match production" would mean **removing** constraints from staging. That is what a mechanical parity script would do, and it is the wrong direction. They are excluded, tracked separately as holding-list item **T5**, and **parity is deliberately not achieved for them.**

**Bucket C debris:** `user_settings.morning_call_phone` has a `DEFAULT` of the product owner's **real phone number** on staging. Any row created without an explicit phone silently inherits a live number.

## Two properties the plan rests on — please test both

**1. The migration is applied to BOTH environments, and is a no-op on production.**

Pass 1 originally said "staging only". The Phase 2 reviewer corrected it: a staging-only migration makes the **migration history** diverge — staging carrying a migration production has never seen — which is a *new* parity problem created by the work meant to end parity problems.

It is safe on production because **every statement restates a definition that already holds there**, verified against the production fingerprint. Not `IF NOT EXISTS`; actual definition equivalence, per the Phase 0 clarification that existence is not equivalence.

**2. `SET NOT NULL` fails if any existing row holds NULL.**

Guarded by counting first and aborting with a named exception:

```sql
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM contacts WHERE user_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'T4: % contacts rows have NULL user_id. '
      'Decide what they belong to before tightening — do not delete blindly.', n;
  END IF;
END $$;
```

…for each of the 19, before any `ALTER`. Orphan rows are a **data question for the owner**, never something a migration resolves silently.

## What to evaluate

- **Is Bucket B's exclusion right?** It leaves 12 known differences unresolved and parity incomplete. The alternative is loosening staging. Is deliberate incompleteness the correct call, or is there a third option?
- **Is the no-op claim on production sound?** It rests on the fingerprint being accurate and complete for these 42 columns. What would make it wrong?
- **Is the abort-and-report guard sufficient?** Should the migration also report *which rows*, or is a count enough to act on?
- **Ordering within the migration** — the guards all run before any `ALTER`, in one transaction. Is that the right structure, or should each column be guarded immediately before its own `ALTER`?
- **Anything that becomes newly enforced.** Tightening `NOT NULL` on staging means any code path that has been inserting NULL there starts failing. That is intended — it would already fail in production — but is there a case where staging legitimately needs the looser column?
- **What this does NOT cover:** missing tables, indexes, constraints, RLS policies, secrets and crons are all Pass 2. Is splitting there sound, or does something in this pass depend on something in that one?

## Required output

A decision per §13: **Approved / Approved with Mandatory Changes / Rejected**.

Close with **Implementation Boundaries Confirmed** — the specific files and the specific change in each, so Phase 4 has a boundary to implement against and Phase 6 has one to audit against.
