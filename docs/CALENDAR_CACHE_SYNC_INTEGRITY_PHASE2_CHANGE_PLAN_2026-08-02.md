# Calendar Cache Synchronization Integrity (Ticket C) — Phase 2 — Change Planning

**Date:** 2026-08-02
**Governance version:** v4.0
**Phase 1A:** `docs/CALENDAR_CACHE_SYNC_INTEGRITY_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-08-02.md`

No code is written in this phase.

## Two independent problems, two independent fixes (per Phase 1's Alternative 3)

### Fix 1 — Add the missing `attendees` column to staging

Same pattern as Ticket A. Restores `sync-google-calendar`'s ability to actually write on staging — currently every upsert fails silently (`sync-google-calendar/index.ts:169-173`) because `attendees` doesn't exist there.

**File:** new migration, `supabase/migrations/<date>_calendar_events_attendees_staging.sql`:
```sql
ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS attendees jsonb;
```
Production's definition must be verified before finalizing (per Ticket A's Mandatory Change 2 precedent — do not assume; production's OpenAPI schema showed `"attendees": { "format": "jsonb" }`, not in the `required` array, no `default` shown — Phase 4 must re-confirm this directly, the same discipline that caught a real discrepancy on `location`).

**Classification:** Database, Protected Core (§4) — same review requirement as Ticket A regardless of risk tier.
**Risk:** Low — additive, nullable, no existing-row impact, matches an already-proven-safe production column.

**Fix 1 approved exactly as proposed, per Wael's review — no changes.**

### Fix 2 — Make synchronization atomic (approved design, per Wael's review)

**Decided, not left open.** Reconciliation and pruning become one logical operation per user, per sync run: **prune executes only if every event write for that user succeeded.** If any write fails, the run aborts before pruning, logs the failure, and reports failure for that user — leaving the existing local rows untouched rather than deleting against an incompletely-reconciled state.

```
Fetch Google events
      ↓
Write/update every event
      ↓
Did every write succeed?
   NO  → Abort prune. Log error. Return failure for this user.
   YES → Run prune.
```

This directly targets the actual defect: writes were failing (silently) while deletes kept executing anyway — two halves of what should be one operation, running independently. The system should reconcile everything or nothing, never delete-without-repair.

**Why not the alternatives originally proposed:**
- *Manual approval before every delete* — rejected. Synchronization exists so users don't have to think about it; requiring approval for every deletion degrades the normal case (a user who genuinely deletes a meeting in Google would see it linger in Naavi until someone approves removing it) to guard against an edge case. Not worth that trade-off.
- *`dry_run` mode alone* — useful for engineering, not for users; doesn't prevent a production recurrence by itself. Optional, not required (see below).

**Fix 3 — Logging (mandatory, alongside Fix 2).** Every sync run logs, per user: events fetched, events written/updated, events deleted (count and the actual IDs/titles), and whether the run completed or aborted. Makes any future incident diagnosable immediately from logs rather than discovered later as missing data.

**Optional — `dry_run` diagnostic mode.** Not required. Add only if useful for future investigation; not a safety mechanism on its own given Fix 2 already makes the dangerous state (broken writes + working deletes) structurally impossible.

## Files That Would Change

| File | Classification | Modification |
|---|---|---|
| New migration under `supabase/migrations/` | Database | Add `attendees jsonb` column, staging only (Fix 1). |
| `supabase/functions/sync-google-calendar/index.ts` | Backend Edge Function | Track per-user write success; only run the prune step if all writes succeeded for that user; abort + log on any write failure (Fix 2). Add structured per-run logging — fetched/written/deleted counts and deleted IDs/titles (Fix 3). |
| New regression test under `tests/catalogue/` | Tests | Lock in: (a) prune does not run when a write fails (simulate/force a failure), (b) prune runs normally when all writes succeed, per Rule 15a. |

## Risk Classification

**Fix 1: Low**, same reasoning as Ticket A's `location` migration.
**Fix 2/3: Medium** — modifies Protected Core (Calendar integration) logic in a Shared-adjacent Edge Function (voice is a downstream stakeholder per Phase 1A, even though not a writer). Mandatory external review before coding applies. Lower risk than the originally-considered approval-gate design (2a) — no new confirmation workflow, no new table, no change to the normal-case user experience; the change is a single success/abort gate around the existing prune call.

## Change Impact Matrix (Fix 2, whichever sub-option)

| Layer | Affected? | Details |
|---|---|---|
| Mobile | Yes | `triggerCalendarSync`'s caller (the Brief-loading effect) will see a different response shape if 2a or 2b add new response fields — must confirm the mobile client tolerates this without a required update (it currently just logs the response, `lib/calendar.ts:255`, so likely safe, but must be confirmed in Phase 3/4, not assumed). |
| Voice | No — voice never calls `sync-google-calendar` (confirmed, Phase 1A) — but voice **is** a downstream consumer of the table's correctness, so it benefits from the fix without needing any voice-side change. |
| Shared Core | Yes — `sync-google-calendar` itself. |
| Database | Yes (Fix 1 only). |
| Cron | No — confirmed nothing schedules this function (Phase 1A). |
| API contracts | Possibly, for 2a/2b — new optional request/response fields. Additive, should not break existing callers if designed carefully. |
| Tests | Yes — new regression coverage required. |

## Mandatory Architecture Impact Checklist

- **Modifies Shared Core?** Yes — `sync-google-calendar` is Shared Core infrastructure (written once, the only writer of a table multiple surfaces read).
- **Modifies an Entry Point?** No — this is not mobile/voice translating logic, it's the shared write path itself.
- **Introduces new duplication?** No.
- **Eliminates existing duplication?** No — out of scope; the 3-independent-read-implementations question stays with the separate architecture governance item.
- **Modifies Protected Core?** Yes — Calendar integration (§4). Mandatory review before and after applies to both fixes.

## Regression Impact

- **Voice commands:** Not directly affected (voice doesn't call this function) — but voice's calendar answers depend on this table staying correct, so regression testing should confirm voice reads are unaffected by whichever Fix 2 option ships.
- **Calendar integration:** Directly affected — this is the fix's target.
- **Reminders, SMS/call alerts, Onboarding, Gmail, Geofencing:** Not affected.
- **Staging build:** Not a client build — staging Edge Function + migration only.

## Regression Matrix

`sync-google-calendar` has one caller: `lib/calendar.ts::triggerCalendarSync`, called from exactly one place, `app/index.tsx`'s Brief-loading effect (on mount + every 60s). No other file calls it (confirmed, Phase 1A). Downstream consumers of the table it writes: mobile Brief, `naavi-chat`'s client-brief fallback, and voice's 4 direct-read call sites (Phase 1A) — none of these call `sync-google-calendar` itself, so none need code changes; they only need the table to stay correct, which is this fix's entire purpose.

---

**Status:** Plan finalized per Wael's review — Fix 1 (attendees column) and Fix 2 (atomic sync: prune only after successful reconciliation) mandatory, Fix 3 (logging) mandatory, `dry_run` optional/not required. Ready for Phase 3 external review.
