# Calendar Tickets A & C — Phase 7 / Production-Readiness Review Package

**Date:** 2026-08-02
**Governance version:** v4.0
**For:** External Technical Reviewer (ChatGPT), per governance §1.
**Full record:** `docs/CALENDAR_CONTEXT_RELIABILITY_*` (Ticket A) and `docs/CALENDAR_CACHE_SYNC_INTEGRITY_*` (Ticket C), all dated 2026-08-02.

Condensed per §14 Cost-Aware AI Collaboration — this is the update since your Phase 6 review of Ticket C, not a re-transmission of the full history.

## Since your Phase 6 review

Your Phase 6 decision (Approved with Mandatory Follow-Up) recommended three pre-production checks: a successful staging sync, the mobile Brief displaying events, and a representative voice calendar read. Status on each:

**1. Staging sync — confirmed.** Re-ran fresh: `{"events": 61, "sync_ok": true, "pruned": 0}`.

**2. Mobile Brief — confirmed, live screenshot.** "CALENDAR 4" section, Gym class and Team standup both showing correct real addresses (1660 Merivale Rd; 340 Albert St). This was also the exact item that had been blocking Ticket A separately — its own outstanding blocker is now cleared by this same evidence.

**3. Voice calendar read — requirement formally removed, not left open.** Attempted a real live call first: asked "what's on my calendar today," got "the calendar is clear" — investigated rather than accepted, and root-caused fully: `naavi-voice-server`'s `SUPABASE_URL` (confirmed directly via its Railway dashboard) points to **production only** — there is no staging voice deployment, so a live call can never exercise staging data regardless of what any staging-only fix changes. The specific wrong-answer call was further traced to a second, independent, previously-undiscovered bug: the caller's phone number (`+13433332567`) is registered to 5 different accounts across staging and production, and voice's caller-lookup (`naavi-voice-server/src/index.js:970`) uses an unordered `.limit(1)` query with no disambiguation — exactly the anti-pattern this project's own CLAUDE.md Rule 10 forbids. Since voice only queries production, the call resolved to one of two production duplicates, both confirmed (by direct query) to have genuinely empty calendars today — never reaching Robert, who exists only on staging. Confirmed by elimination, not assumed.

**Wael's decision:** remove the live-voice-call check as a requirement for both tickets, rather than block on infrastructure that doesn't exist. A Voice Staging platform is already a known, not-yet-started holding-list item (item 18) — updated today with this finding; building it is correctly out of scope for these two narrowly-scoped bug fixes. The server-side evidence already in the record stands: voice's exact query pattern, replicated directly against staging with Robert's real `user_id`, returned the correct 17 events including both previously-missing titles.

## New, separate finding — not part of either ticket

The phone-number collision (5 accounts sharing `+13433332567`) and voice's `.limit(1)` caller resolution are flagged as their own follow-up item (not folded into Ticket A or C), same treatment as the sync-health-monitoring follow-up from your Phase 6 review of Ticket C.

## What we're asking you to evaluate

Given the above, do you agree both tickets are ready for production consideration, with the voice-call check formally waived (not silently skipped) for the documented infrastructure reason? Please confirm or flag any remaining concern before Wael's final production-promotion decision.

---

## Reviewer Response — received 2026-08-03

**No remaining technical concerns that should block production promotion of Ticket A or Ticket C.**

Three items confirmed as separate, non-blocking governance follow-ups (not folded into A or C):
1. Voice staging environment.
2. Voice caller-resolution (duplicate phone number / `.limit(1)` lookup) — tracked as background task `task_b77ce85e`.
3. Synchronization health monitoring — tracked from Ticket C's Phase 6 Mandatory Follow-Up.

**Reviewer conclusion:** both tickets are technically complete and ready for production promotion, subject to Wael's final approval under the governance process.

---

**Status:** CLOSED 2026-08-03 — Wael approved Phase 8 ("Yes, approved"). Full closure record: `docs/CALENDAR_TICKETS_AC_PHASE8_MERGE_2026-08-03.md`.
