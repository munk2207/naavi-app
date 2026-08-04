# Calendar Cache Synchronization Integrity (Ticket C) — Phase 1 — Problem Definition

**Date:** 2026-08-02
**Governance version:** v4.0
**Phase 0:** Approved 2026-08-02 — `docs/CALENDAR_CACHE_SYNC_INTEGRITY_PHASE0_INTENT_APPROVAL_2026-08-02.md`

No code written in this phase. All evidence below from direct, read-only queries against staging, or direct source reads.

## What exactly is broken

`sync-google-calendar`'s writes to staging's `calendar_events` table have been silently failing — for every event, on every run — for as long as the `attendees` column has been missing from staging's schema. The function's own prune step runs regardless of write success, meaning it has been able to delete local rows without ever being able to correctly (re-)create or reconcile them.

## Evidence

**Directly confirmed, right now:** `SELECT attendees FROM calendar_events` on staging → `column calendar_events.attendees does not exist`.

**Directly confirmed by source read**, `sync-google-calendar/index.ts:146-173`:
```js
const baseRow: Record<string, unknown> = {
  user_id, google_event_id: event.id, item_type: 'event', title: event.summary ?? 'Event',
  description: event.description ?? '', location: event.location ?? '',
  attendees: event.attendees ?? [],   // <- line 153, this column doesn't exist on staging
  updated_at: new Date().toISOString(), is_all_day: isAllDay,
};
...
const { error } = await adminClient.from('calendar_events').upsert(baseRow, { onConflict: 'user_id,google_event_id' });
if (!error) eventCount++;   // <- line 173: error is captured, never logged, never surfaced
```
Every upsert attempt on staging includes a column that doesn't exist, so every upsert fails. The error is silently discarded — `if (!error) eventCount++` only skips the counter; nothing is logged, nothing is returned to the caller beyond a lower `events` count in the response. This is confirmed consistent with what was directly observed during Ticket A's incident: `sync-google-calendar` reported `{"events":0,"tasks":0}` for Robert — not because Robert has zero live events (proven false — 20+ events exist live on his real Google Calendar), but because every write attempt errored out before incrementing the counter.

**Critically, the prune step does not depend on write success.** `liveIds` (the set used to decide what to delete) is populated at line 136, *before* the upsert is even attempted, directly from Google's API response. So even though writes have never succeeded on staging, deletion has been fully functional the entire time — an asymmetric failure mode: the function can delete but cannot create or repair.

## Root Cause — both of Ticket C's original questions, now answered together

**Why did the local rows' `google_event_id` not match live Google's IDs (Success Criterion #1)?** Given `sync-google-calendar` could never successfully write an event to staging (proven above), the ~20 events present in staging's `calendar_events` before the incident (including "Gym class" and "Team standup") could not have arrived there through this function. They must have been inserted through a different path — direct database writes, consistent with this session's own earlier finding that the YouTube demo seeding work (referenced throughout this session's handoff docs) was run ad hoc in a prior session with no committed, inspectable script. No committed seed script was found (checked: `grep -rl "Gym class\|Team standup"` across the repo found nothing but this session's own diagnostic scripts). Directly-seeded rows have no reason to carry real Google-issued IDs, and — proven by the incident — did not.

**Is the deletion "expected behavior" (Success Criterion originally framed this way in the incident report, now resolved)?** No — the prune step's own stated purpose (`sync-google-calendar/index.ts:87-90`) is to remove events the user genuinely deleted from Google. It is not designed to handle "the write half of this sync has been broken the entire time, so anything not written through it is inherently unreconciled" — that is a genuine defect in the function's safety assumptions, not intended behavior.

## Alternatives Considered

1. **Add the missing `attendees` column to staging** (same pattern as Ticket A's `location` fix). Restores `sync-google-calendar`'s ability to actually write on staging going forward. Does not, by itself, fix already-mismatched IDs on existing rows (those would still be pruned on the next sync unless separately reconciled) — but stops the underlying cause of *future* mismatches from this specific gap.
2. **Add a report-first/dry-run mode to the prune step** (Wael's explicit recommendation from the incident report) — compute the to-be-deleted set and require review before executing. Addresses the *symptom* (unsafe deletion) regardless of the *cause* (write failures / ID mismatches), and would have prevented the incident even without the schema fix.
3. **Both.** Not mutually exclusive — #1 fixes the write path so future syncs actually reconcile correctly; #2 makes any remaining mismatch (from this or any other future cause) fail safe instead of silently deleting.

## Architecture Location

**Capability:** Calendar — reads/writes (sync). Per Architecture Reference (`docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md:68`), calendar reads are classified **Duplicated** across mobile/`naavi-chat`/voice. `sync-google-calendar` specifically is the *write* path feeding the mobile-side cache table (`calendar_events`) that both the mobile Brief and `naavi-chat`'s client-brief-fallback depend on — not previously broken out as its own line item in the Architecture Reference. This ticket's scope (cache contract, sync correctness) sits underneath that Duplicated classification, not a new capability.

---

**Status:** Awaiting Wael's direction — proceed to Phase 1A, or straight to Phase 2 given how directly this Phase 1 already points to a scoped fix (Alternative 3).
