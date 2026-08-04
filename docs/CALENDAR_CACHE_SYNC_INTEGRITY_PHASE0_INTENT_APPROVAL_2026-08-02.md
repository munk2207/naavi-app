# Calendar Cache Synchronization Integrity (Ticket C) — Phase 0 — Intent Approval

**Date:** 2026-08-02
**Governance version:** v4.0
**Origin:** Surfaced as an incident during Ticket A's Phase 4 (`docs/CALENDAR_CONTEXT_RELIABILITY_INCIDENT_SYNC_DELETION_2026-08-02.md`) — a governance deviation (an unauthorized `sync-google-calendar` call during "validation") led to `sync-google-calendar`'s prune step deleting two `calendar_events` rows ("Gym class," "Team standup") for events independently confirmed still live on Google Calendar (via direct API read and Wael's own phone). Kept as its own ticket, not folded into Ticket A or Ticket B, per Wael's explicit direction.

## Background (supporting record — not a governance field)

Proven in the incident investigation:
- `sync-google-calendar/index.ts:247-256` deletes any local `calendar_events` row whose `google_event_id` is not present in a fresh live Google Calendar fetch.
- Both deleted events are confirmed live on Google right now (independent server-side read + direct phone check).
- Why the local rows' `google_event_id` didn't match Google's live IDs is **not proven** — several explanations remain open (synthetic seed IDs, a historic import bug, an earlier migration, a failed sync write, duplicate-event handling, an ID normalization problem).
- Secondary finding: the same sync's upsert writes an `attendees` field that, like `location` before Ticket A's fix, may not exist as a column on staging — not yet confirmed as contributing, not yet investigated.

## User Intent

Determine why local `calendar_events` rows can carry a `google_event_id` that doesn't match the live Google Calendar event they represent, and make `sync-google-calendar`'s prune step safe against deleting rows for events that are actually still live — without assuming either the prune logic or the ID-writing path is at fault before it's proven.

## Success Criteria

1. Root cause of the `google_event_id` mismatch is proven with direct evidence (not "one of the six possible explanations" left open) — for at least one reproducible case.
2. A safety mechanism exists (or is explicitly designed) so that a future sync cannot silently delete rows for events genuinely still live on Google, without a review step.
3. The `attendees` column gap on staging is confirmed as either contributing to this incident or ruled out, with evidence.

## In Scope

- Full trace of how `calendar_events` rows for recurring/seeded events acquire their `google_event_id` — every write path (seed process, `sync-google-calendar`, `create-calendar-event`, any manual/direct insert).
- `sync-google-calendar`'s prune logic (`index.ts:247-256`) — whether a report-first/dry-run mode (per Wael's safety recommendation) is the right fix, or whether the actual fix belongs upstream in whatever writes mismatched IDs.
- The `attendees` column gap on staging, insofar as it's implicated in this specific incident.
- Cache reconstruction for the two specific rows lost in this incident, once root cause is understood (not before).

## Out of Scope

- Ticket A (schema drift on `calendar_events.location`) — separate, already in Phase 4, not reopened here.
- Ticket B (event-selection semantics) — separate, not started yet, not affected by this ticket.
- The 3-independent-calendar-implementations architecture governance item — already flagged separately, related but not merged in here.
- Any broader redesign of the calendar sync architecture beyond what's needed to make prune safe.

## Constraints

- No further `sync-google-calendar` invocations against any real account until a safety mechanism (at minimum, a manual pre-check) is in place — this incident must not repeat during its own investigation.
- No code changes in this phase.
- Investigate on staging only; production's `sync-google-calendar` and its data are not touched.

## Completion Criteria

All 3 Success Criteria items answered with direct evidence. A concrete recommendation (dry-run/report-first mode, an ID-matching fix, or both) ready for Phase 2 change planning.

---

**Status:** Awaiting Wael's explicit approval to proceed to Phase 1.
