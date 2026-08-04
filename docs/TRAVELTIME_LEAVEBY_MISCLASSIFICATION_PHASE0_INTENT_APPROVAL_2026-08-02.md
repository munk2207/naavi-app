# Travel-Time / Leave-By Misclassification — Phase 0 — Intent Approval

**Date:** 2026-08-02
**Governance version:** v4.0

**Correction (2026-08-02, via Phase 2 Amendment 1):** the Constraints section below originally said "Backend / Shared Core only." That terminology was imprecise — Phase 1A established the affected capability (calendar-read classification) is **Duplicated**, not Shared Core, and this fix touches only the mobile-facing `naavi-chat` entry point. See `docs/TRAVELTIME_LEAVEBY_MISCLASSIFICATION_PHASE2_CHANGE_PLAN_2026-08-02.md`, Amendment 1, for the corrected classification. Left uncorrected below per the project's practice of recording corrections rather than silently rewriting prior phase documents.

## Background (supporting record — established this session, not a governance field)

During live testing on both staging (APK 313) and production (AAB 311), two other issues were found and fixed:
- Staging: `get-travel-time`'s `GOOGLE_MAPS_API_KEY` secret was invalid — corrected.
- Production: `resolve-place` was running code 6 fixes stale relative to staging — redeployed.

After both fixes, one more issue was found and remains open:

- **"Navigate to my next meeting"** → correctly returns the full TRAVEL TIME card (destination, duration, leave-by time).
- **"What time should I leave for my dentist appointment"** and **"What time should I leave for my next meeting"** → return a plain schedule/search listing instead, with no travel time or leave-by shown, on both staging and production.

Evidence traced to `naavi-chat/index.ts:1627` (`classifyIntent`) — a lightweight classifier that runs *before* the full Claude system (`get-naavi-prompt`'s RULE 7, which knows how to call `fetch_travel_time`). Its own instructions (line 1664) list example phrasings for `READ_CALENDAR` ("what's next", "what do I have today", "show me my schedule") with no exclusion for leave-by/travel-time phrasing. When it classifies a message as `READ_CALENDAR`, the message is answered deterministically (`naavi-chat/index.ts:2816-2822`) and never reaches Claude — so RULE 7 is never seen, and the travel-time card can never be rendered for a misclassified message.

## User Intent

Fix `naavi-chat`'s `classifyIntent` classifier so that leave-by / travel-time phrasing ("What time should I leave for my [event]", "When should I leave for [event]", and equivalent phrasings) is never routed to `READ_CALENDAR`, so these questions always reach the part of the system that computes and shows a real travel time and leave-by time — instead of silently returning a generic calendar listing.

## Success Criteria

Asking "What time should I leave for my dentist appointment" (or an equivalent leave-by phrasing) returns the TRAVEL TIME card (destination, duration, leave-by time, "Open in Google Maps") — not a plain schedule/search listing — reliably, on both staging and production.

## In Scope

- The `classifyIntent` prompt/logic in `supabase/functions/naavi-chat/index.ts` (~line 1658–1664) — add an explicit exclusion so leave-by/travel-time phrasing is never classified as `READ_CALENDAR`.
- Phase 1A Cross-Repository Verification — confirm whether the voice server (`naavi-voice-server/src/index.js`) shares this same classifier path or has an independent one that needs a matching fix.
- Regression-testing that currently-correct behavior is preserved: "Navigate to my next meeting," and generic calendar reads ("what's on my calendar today," "what do I have this week").
- A new regression test added to `tests/catalogue/` and registered in `tests/runner.ts`, per Rule 15a.

## Out of Scope

- The two already-fixed issues (staging Maps API key secret, production `resolve-place` stale deploy) — closed, not reopened here.
- Any change to `get-travel-time` or `resolve-place` — both already confirmed working.
- Any change to the TravelTime card's UI/display.
- Any change to the verified-address rejection flow ("I can't confirm '<address>'...") — untouched unless Phase 1A investigation finds it's implicated.
- Any mobile app (APK/AAB) code or build — this is Shared Core (Supabase Edge Function) only.

## Constraints

- Backend / Shared Core only. No mobile app changes anticipated. No voice-server changes unless Phase 1A finds voice needs a parallel fix.
- No database schema changes.
- No architecture changes — this is a scoped fix to existing classifier logic, not a new system or a new routing layer.
- Non-Determinism Rule applies (Phase 3, governance §3): minimum 3 independent trials per test phrasing before any result is considered validated — this is a classifier prompt change.
- Staging deploy and live verification first. Production only after staging is confirmed and explicit approval is given to promote.

## Completion Criteria

- The two reproduction phrasings from this session ("What time should I leave for my dentist appointment," "What time should I leave for my next meeting") trigger the travel-time card reliably (minimum 3/3 trials) on staging.
- No regression in "Navigate to my next meeting" or generic calendar-read phrasings (minimum 3/3 trials each).
- Fix deployed to production and re-verified live with the same trial requirement.
- A regression test exists in `tests/catalogue/`, is registered in `tests/runner.ts`, and passes.

---

**Status:** Awaiting Wael's explicit approval to proceed to Phase 1.
