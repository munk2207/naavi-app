# Travel-Time / Leave-By Misclassification — Phase 1 — Problem Definition

**Date:** 2026-08-02
**Governance version:** v4.0
**Phase 0:** Approved 2026-08-02 — `docs/TRAVELTIME_LEAVEBY_MISCLASSIFICATION_PHASE0_INTENT_APPROVAL_2026-08-02.md`

## What exactly is broken?

On mobile (both staging APK 313 and production AAB 311), asking a leave-by/travel-time question phrased as "What time should I leave for my [event]" returns a plain schedule/search listing with no travel time and no leave-by time — instead of the TRAVEL TIME card the feature exists to show.

## Evidence

Direct, live, reproduced this session:

- **Staging**, "What time should I leave for my dentist appointment" → reply: *"Yes — here's what I found for 'dentist': 1. Dentist — Dr. Osei — Aug 3 at 10:00 AM."* No travel time, no leave-by. (screenshot, this session, 2026-08-02 4:51 a.m.)
- **Staging**, "Navigate to my next meeting" (same session, same account) → reply: *"Your next meeting is Team standup at 9:00 AM today. Let me get the travel time."* + TRAVEL TIME card: 340 Albert St, 47 min, 53.6 km, Leave by 8:08 a.m. (screenshot, 4:52 a.m.)
- **Production**, "What time i should leave for my next meeting" → reply: *"Here's your schedule for the next 7 days: 1. Dentist check — Aug 2 at 8:00 AM... 2. Hadi Aggan's birthday..."* No travel time, no leave-by. (screenshot, 2026-08-02 4:56 a.m.)

Same failure mode on both environments, both phrasings — confirms this is not an environment-config issue (unlike the two issues already fixed this session) and not a client-build issue.

## Root Cause

**Proven, not inferred.**

`supabase/functions/naavi-chat/index.ts:1627` (`classifyIntent`) runs a lightweight Haiku classifier *before* the full Claude system that owns `get-naavi-prompt`'s RULE 7 (the rule that knows how to call `fetch_travel_time`). Its own system prompt, `naavi-chat/index.ts:1664`, instructs:

> "READ_CALENDAR (no keyword param) for general schedule reads with no specific event named: 'what do I have today', 'what's coming up', 'show me my schedule', 'do I have anything tomorrow', 'what's next' — use READ_CALENDAR, NOT CALENDAR_SEARCH..."

There is no exclusion in this instruction for leave-by/travel-time phrasing. When the classifier returns `intent: 'READ_CALENDAR'`, `naavi-chat/index.ts:2816-2822` handles it deterministically and returns immediately — the message never reaches Claude, so RULE 7 is never evaluated and `fetch_travel_time` can never be called for a message classified this way.

Confirmed the regex-based Layer 2 gate (`CALENDAR_READ_INTENT_RE`, `naavi-chat/index.ts:486`) is **not** the cause — tested directly, it does not match either failing phrase (`"What time should I leave for my dentist appointment"` → `false`; `"What time i should leave for my next meeting"` → `false`). The misroute happens at the separate Level A Haiku classification step, not the deterministic regex layer.

## Alternatives Considered

1. **Add an explicit exclusion to the `classifyIntent` prompt** so leave-by/travel-time phrasing is never returned as `READ_CALENDAR`, falling through to full Claude/RULE 7 instead. — Smallest change, matches the Minimal Change Principle (governance §0.3). Leading candidate; Phase 2 will confirm exact wording.
2. **Remove `READ_CALENDAR` from Level A entirely**, always routing calendar-shaped questions to full Claude. — Rejected as a first option: broader blast radius, removes a working deterministic fast-path for genuinely generic reads ("what's on my calendar today"), higher regression risk than the scope requires.
3. **Add a new Level A intent specifically for travel-time/leave-by**, handled deterministically without Claude. — Bigger architectural change (new intent, new deterministic handler, would need `fetch_travel_time`/`resolve-place` orchestration reimplemented outside Claude's existing flow) — disproportionate to the bug; not pursued for this item.

## Architecture Location

**Capability:** Calendar — reads (live event fetch).
**Classification, per Architecture Reference (`docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md:68`): Duplicated.** *"Both `naavi-chat` and the voice server independently call the Google Calendar API themselves"* — see `docs/adr/0002-calendar-reads-remain-duplicated.md`.

**This bug is specific to the mobile-facing implementation (`naavi-chat`).** Freshly checked this session — the voice server's independent Level A classifier (`naavi-voice-server/src/index.js:2255-2352`, `voiceClassifyAndHandleIntent`) has its own separate intent list (line 2273: `LIST_RULES, LOOKUP_CONTACT, CALENDAR_SEARCH, LIST_READ, REMINDER_READ, MEMORY_SEARCH`) — **`READ_CALENDAR` is not one of voice's Level A intents at all**, and its `switch` statement (line 2300-2348) falls through to `default: return null` for anything else, meaning voice always falls through to full Claude for this phrasing. Voice's independent implementation does not have this shortcut, so it does not have this bug by construction — not because it was fixed, but because it was never built with a calendar-read short-circuit.

**Not yet confirmed by a live voice call** — this is a code-level finding, not a live test. Phase 7 (Testing) must include a live voice call with the same phrasing before this is treated as proven-working on voice, per the Cross-Repository Verification Rule's evidence bar.

---

**Status:** Awaiting Wael's explicit approval to proceed to Phase 1A.
