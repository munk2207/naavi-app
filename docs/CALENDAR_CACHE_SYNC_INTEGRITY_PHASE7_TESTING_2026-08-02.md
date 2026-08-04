# Calendar Cache Synchronization Integrity (Ticket C) — Phase 7 — Testing

**Date:** 2026-08-02
**Governance version:** v4.0
**Phase 6:** Approved with Mandatory Follow-Up — `docs/CALENDAR_CACHE_SYNC_INTEGRITY_PHASE6_TECHNICAL_REVIEW_2026-08-02.md`

## Result: 2 of 3 pre-production checks confirmed directly; the 3rd formally dropped, not left open

Phase 6 recommended three deployment-confidence checks before production. Two are directly confirmed; the third turned out to be structurally impossible and is removed as a requirement, not left pending.

### 1. Successful staging synchronization — CONFIRMED

Re-ran `sync-google-calendar` for Robert fresh, immediately before this check: `{"events": 61, "tasks": 0, "sync_ok": true, "pruned": 0}`. Zero pruned this run — the table was already fully reconciled from the prior run, nothing stale left to remove.

### 2. Mobile Brief displays synchronized events — CONFIRMED, directly, by Wael

Live screenshot of the staging app's Brief screen: "CALENDAR 4" section showing "Today — Gym class at 6:00 a.m. — 1660 Merivale Rd, Ottawa, ON," "Today — Team standup at 9:00 a.m. — 340 Albert St, Ottawa, ON," and a third real event, each with correct real addresses. This is the same check that had been blocking Ticket A — now confirmed, which also closes that ticket's outstanding item.

### 3. Voice calendar read — requirement removed (not achievable, not a defect)

**Root cause of why this can't be tested, confirmed directly via Railway dashboard** (`naavi-voice-server` service → Variables → `SUPABASE_URL`): `https://hhgyppbxgmjrwdpdubcx.supabase.co` — production. **Voice has exactly one deployment, wired to production only. There is no staging voice number.** A live call can never exercise staging data, regardless of what this ticket (or any staging-only fix) changes.

This was discovered via a real attempted test: a live call asking "What's on my calendar today?" answered "the calendar is clear for today." Investigated fully rather than accepted at face value — traced to the caller's phone number (`+13433332567`) being registered to 5 different accounts across staging and production, with Voice's caller-lookup (`naavi-voice-server/src/index.js:970`) using an unordered `.limit(1)` query. Since Voice only ever queries production, the call resolved to one of the two production duplicates (`mynaavi2207@gmail.com` or `mynaavidemo@gmail.com`, both confirmed to have genuinely empty calendars today) — never to Robert, who exists only on staging. **Not a defect in Ticket A or Ticket C** — confirmed by elimination and by direct query.

**Wael's decision, 2026-08-02:** formally remove the live-voice-call check as a requirement for this ticket (and for Ticket A), rather than leave it open indefinitely waiting on infrastructure this project doesn't have today. Reasoning: building a Voice staging environment (already an existing, not-yet-started holding list item — see item 18, `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, updated 2026-08-02 with this session's findings) is a separate, larger initiative, correctly out of scope for a narrowly-scoped bug fix ticket. Server-side evidence already exists and stands on its own: voice's exact query pattern, replicated directly against staging with Robert's real `user_id`, returned the correct 17 events including Gym class and Team standup (captured earlier in this session's Phase 7 exchange). That remains valid, cited evidence for "the query logic is correct against the fixed data" — what's missing is only the live end-to-end phone call, which is currently impossible to obtain for staging data, not evidence that anything is broken.

## Consequence

Per Wael's decision, Ticket C (and Ticket A, whose own blocking item is now separately closed by check #2 above) proceed toward production readiness on the strength of checks 1 and 2, with check 3 formally out of scope rather than pending. The separate phone-number-collision finding is tracked as its own item (background task already flagged) and folded into holding list item 18's updated notes — not reopened here.

---

**Status:** Phase 7 complete under the revised (Wael-approved) scope. Ready to move forward without a voice test, per final approval.
