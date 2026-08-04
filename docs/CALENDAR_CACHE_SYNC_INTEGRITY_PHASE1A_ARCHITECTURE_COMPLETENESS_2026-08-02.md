# Calendar Cache Synchronization Integrity (Ticket C) — Phase 1A — Architecture Completeness Review

**Date:** 2026-08-02
**Governance version:** v4.0
**Architecture Reference version used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` (2026-07-18, no newer version exists)
**Phase 1:** `docs/CALENDAR_CACHE_SYNC_INTEGRITY_PHASE1_PROBLEM_DEFINITION_2026-08-02.md`

## Required Questions

**Architectural owner:** `calendar_events` (the cache table) is written exclusively by `sync-google-calendar` and `create-calendar-event`; read by multiple independent consumers across both mobile and voice (below).

**Classification:** Architecture Reference line 68 classifies calendar *reads* as Duplicated (mobile and voice each independently call Google Calendar API). **This investigation found that classification is incomplete** — see Cross-Repository finding below.

**Cross-Repository Verification — freshly checked this session, not relying on the existing Reference:**

| Consumer | What it reads | Provenance |
|---|---|---|
| Mobile Brief (`app/index.tsx:1177`, via `lib/calendar.ts::fetchUpcomingEvents`/`fetchTodayEvents`) | The cached `calendar_events` table | Freshly verified this session (also traced in Ticket A). |
| `naavi-chat`'s client-brief fallback (`naavi-chat/index.ts:1345-1347`) | Whatever the mobile app sent as `brief_items`, sourced from the table above | Freshly verified (Ticket A / prior work item this session). |
| `naavi-chat`'s own independent live fetch (`fetchLiveCalendarEvents`, `naavi-chat/index.ts:876`) | Google Calendar API directly, not the cache table | Freshly verified (prior work item this session). |
| **Voice server — 4 separate call sites** (`naavi-voice-server/src/index.js:816-817, 1343, 1373, 11228`) | **The same cached `calendar_events` table, via direct PostgREST REST calls** (`${SUPABASE_URL}/rest/v1/calendar_events?select=...`) — for the voice brief window, person-name lookup, priority events, and specific-time lookup, respectively. All select `location` among other columns. | **Freshly verified this session — new finding, not previously documented.** |
| Voice server — Level A classifier (`voiceClassifyAndHandleIntent`) | Does not include a `READ_CALENDAR`-equivalent shortcut at all (established in the prior work item's Phase 1A) | Relying on that prior session's fresh verification, not re-checked here. |
| `global-search`'s calendar adapter | Google Calendar API directly (own independent implementation, previously found to return inconsistent results — flagged separately, out of scope here) | Relying on the prior work item's Phase 1A finding, not re-checked here. |

**Correction to the Architecture Reference:** voice is not purely independent of the mobile-side cache table, as line 68's "each independently call Google Calendar API" implies. **Voice reads the same shared `calendar_events` cache table directly, in at least 4 places, for purposes distinct from its own independent live-fetch paths.** This means voice was silently affected by the `calendar_events.location` schema drift the same way mobile was, until Ticket A's migration fixed it — and voice remains a stakeholder in this ticket's cache-integrity work, even though it never triggers `sync-google-calendar` itself (confirmed below).

**Does voice write to or trigger sync of `calendar_events`?** Checked directly — no. `grep` for `sync-google-calendar`/`triggerCalendarSync` in `naavi-voice-server/src/index.js` returns zero matches. Voice is read-only against this table.

**Is `sync-google-calendar` triggered anywhere other than the mobile app opening?** Checked directly — no cron job calls it (`grep -rl "sync-google-calendar" supabase/migrations/*.sql` → no matches), and voice never calls it. **The only trigger is `app/index.tsx`'s Brief-loading effect** (on mount, and every 60 seconds while the screen is open, via `lib/calendar.ts::triggerCalendarSync`). This confirms the incident's blast radius is fully understood: the only way the prune behavior fires is a user having the mobile app open.

## Does the documented problem scope match the Architecture Reference?

No — corrected above. This is not a rejection of the existing Reference, it's a documented gap: the Reference's Duplicated classification for calendar reads was accurate for the live-Google-API paths but did not account for voice's direct dependency on the shared cache table. Recommend this correction be folded into the already-queued Architecture Governance item (3-independent-calendar-implementations inventory), since it changes that inventory's count and scope.

## Is any documented implementation excluded from this investigation?

No — all documented calendar-related implementations (mobile Brief, `naavi-chat`'s two paths, voice's cache reads, voice's Level A classifier, `global-search`) were accounted for above, either freshly verified this session or explicitly citing the prior session's fresh verification.

---

**Status:** Awaiting Wael's direction — proceed to Phase 2 for the two Alternatives from Phase 1 (add `attendees` column; add prune safety check), incorporating voice as a confirmed downstream stakeholder even though it isn't a write-path participant.
