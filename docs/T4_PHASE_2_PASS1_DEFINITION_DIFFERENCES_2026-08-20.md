# Phase 2 — Pass 1 — Triage and Change Plan — the 42 definition differences

**Date:** 2026-08-20
**Governance version:** v4.0
**Phase 1:** `docs/T4_PHASE_1_MEASUREMENT_2026-08-20.md` — approved
**Scope of this pass:** the **42 columns that exist in both environments with different definitions**. The remaining differences (missing tables, indexes, constraints, policies, secrets, crons) are Pass 2.
**Status:** Plan complete. **Awaiting Wael's go-ahead for Phase 2 → 3.**

**Why this pass is split off:** it is the set actively undermining every test run on staging, and it is self-contained — it does not depend on resolving what the staging-only cron or trigger were for.

---

## 1. ⭐ Validation — is production's version intentional?

The Phase 1 reviewer required that **"replicate" stays provisional**: each difference must be validated against intended production behaviour, not copied because production happens to have it.

**Validated, and the answer is unambiguous.** The migration files declare, for every one of these tables:

```sql
user_id  uuid  REFERENCES auth.users(id) ON DELETE CASCADE,
```

**No `NOT NULL`.** So:

- **Staging matches the migration files exactly.** It is not broken; it is faithful.
- **Production was tightened afterwards**, and the files never captured it.

**That inverts the usual reading of this situation.** Staging is not lagging behind because something failed to apply. Production is *ahead of its own documentation*, and staging is the honest reflection of what was written down.

**Is the tightening intended?** Yes, on three independent grounds:

1. **CLAUDE.md — DATA INTEGRITY, FOUR LAYERS** makes `NOT NULL` on every depended-upon column **Layer 1**, the layer "that cannot be bypassed by any code path".
2. **Rule 10 (multi-user safety)** rests entirely on `user_id` being present. A row without one belongs to nobody.
3. **Production has enforced it in live operation** without incident — the strongest evidence that the constraint matches how the system actually behaves.

## 2. The 42, classified by direction — which matters more than by table

| Bucket | Count | Action |
|---|---|---|
| **A — Production stricter** | 19 | **Replicate to staging** |
| **B — Staging stricter** | 12 | **Do NOT touch. Flag production.** |
| **C — Default only** | 11 | 10 replicate, **1 is debris** |

### 2.1 Bucket A — production stricter (19). Replicate.

These are the ones letting staging accept rows production rejects.

`contacts.name` · `contacts.user_id` · `naavi_notes.title` · `naavi_notes.user_id` · `reminders.datetime` · `calendar_events.title` *(+default `''`)* · `calendar_events.user_id` · `calendar_events.google_event_id` · `gmail_messages.user_id` · `gmail_messages.gmail_message_id` · `push_subscriptions.auth` · `push_subscriptions.p256dh` · `push_subscriptions.user_id` · `push_subscriptions.endpoint` · `knowledge_fragments.type` · `knowledge_fragments.content` · `knowledge_fragments.user_id` · `knowledge_fragments.source` *(+default `'notes'`)* · `knowledge_fragments.classification` *(+default `'PERSONAL'`)*

**Six are `user_id`.** That is the multi-user safety boundary, unenforced on staging.

⚠️ **Applying `NOT NULL` fails if existing staging rows hold NULLs.** The migration must count offenders first and refuse rather than mangle data — §3.2.

### 2.2 Bucket B — staging stricter (12). Do NOT replicate.

`contacts.created_at` · `naavi_notes.created_at` · `user_tokens.updated_at` · `gmail_messages.is_tier1` · `gmail_messages.is_unread` · `gmail_messages.is_important` · `gmail_messages.updated_at` · `calendar_events.updated_at` · `calendar_events.is_priority` · `push_subscriptions.created_at` · `knowledge_fragments.created_at` · `knowledge_fragments.is_priority`

**Here production is the looser one**, and "make staging match production" would mean **removing** constraints from staging.

**That would be the wrong action, and it is exactly what a mechanical parity script would do.** Every one of these is a timestamp or a boolean with a default — columns that should never be NULL. Staging is right.

**Proposed handling: change nothing, and flag production separately.** Phase 0 puts changing production out of scope, and tightening a live table is not something to slip into a parity pass. Recorded here as a genuine finding for its own decision.

**Consequence, stated:** parity is **not** achieved for these 12 by this work. That is deliberate, and better than silently loosening staging to make a number reach zero.

### 2.3 Bucket C — defaults (11)

**Replicate (10):** `reminders.user_id` → `auth.uid()` · `gmail_messages.labels` → `'{}'` · `snippet`/`subject`/`body_text`/`sender_name`/`sender_email` → `''` · `calendar_events.attendees` → `'[]'` · `calendar_events.description` → `''` · `knowledge_fragments.confidence` → `1.0`

**⚠️ Debris — DELETE (1):** `user_settings.morning_call_phone` has a **DEFAULT of `'+16137697957'`** on staging — Wael's real phone number, hardcoded into the schema. Production has none.

Flagged as high priority by the Phase 1 reviewer, and it deserves it: **any staging row created without an explicit phone silently inherits a real, live number** — one that receives real calls and texts. Under the T2 outbound guard staging sends are allowlisted, but that guard is a second line of defence, not a reason to leave a real number in a column default.

## 3. The change

### 3.1 One migration

`supabase/migrations/20260820000000_t4_pass1_definition_parity.sql`

- 19 × `ALTER COLUMN … SET NOT NULL` (Bucket A)
- 10 × `ALTER COLUMN … SET DEFAULT` (Bucket C)
- 1 × `ALTER COLUMN morning_call_phone DROP DEFAULT` (debris)
- **Zero statements for Bucket B.**

**No-op on production by construction:** every target already has the intended definition there, so each statement is a redundant restatement rather than a change. That satisfies Phase 0's Success Criterion 3 as tightened — equivalence by *definition*, not by `IF NOT EXISTS`.

### 3.2 ⚠️ Guard: `SET NOT NULL` fails on existing NULLs

A hard failure is the *safe* outcome — it stops rather than mangles. But a migration that dies halfway leaves the schema part-applied.

**Therefore: count first, and abort with a clear message.**

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

…for each of the 19, before any `ALTER`. Rows without an owner are a **data question**, not a migration question, and they must reach Wael rather than be silently removed.

### 3.3 Verification

Re-run `T4_SCHEMA_FINGERPRINT.sql` on both. The 42 becomes **12** — Bucket B, deliberately.

## 4. Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **No** | No app file changes |
| **Voice** | **No** | No voice-server changes |
| **Shared Core** | **No** | No Edge Function changes |
| **Database** | **Yes** | One migration, staging only. Constraints and defaults; no data written, no column dropped |
| **Cron** | **No** | Pass 2 |
| **API contracts** | **No** | No request/response shape changes |
| **Tests** | **No** *(this pass)* | The parity drift-check is Pass 3 |

## 5. Risk

| Risk | Likelihood | Mitigation |
|---|---|---|
| `SET NOT NULL` fails on existing NULL rows | **Medium** | §3.2 counts first and aborts with a message naming the table and count |
| Existing staging code inserts NULL `user_id` and starts failing | **Low–Medium** | **That is the point.** It would already fail in production. Better surfaced now |
| Migration partially applies | Low | Single transaction; all guards run before any ALTER |
| Applied to production by accident | **Low, high impact** | Every statement is a no-op there — verified against the fingerprint, not assumed |
| Bucket B silently loosened | **None** | Not in the migration at all |

## 6. Open for Phase 3

1. **Bucket B** — is leaving 12 differences unresolved acceptable, or should production be tightened in its own item?
2. **The NULL-row guard** — abort-and-report is proposed. If staging holds orphan rows, does Wael want them listed, deleted, or assigned?
3. **Ordering** — should this land before B11f finishes, given both touch staging?

## 7. Not authorized

No migration written or applied. Phase 3 review, then Phase 4 on Wael's explicit go-ahead.
