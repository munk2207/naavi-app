# B10x — Track 2 (Voice) — Phase 3 — Technical Review (Before Coding)

**Date:** 2026-08-05
**Governance version:** v4.0
**Reviewed:** `docs/B10X_TRACK2_PHASE2_CHANGE_PLAN_2026-08-05.md` (Revision 2)
**Risk classification:** Medium

---

## Reviewer evaluation

- **Assumptions:** The single most important correction across this review cycle was an assumption, not a fact — Revision 1 assumed the demo line's stateless TwiML ask/confirm pattern was reusable transport for a registered caller's lazy-ask flow. It wasn't (Blocker 3). The parser (`parseTimezone.js`) was correctly identified as reusable; the surrounding mechanism was not, and only in-memory investigation (finding `pendingActionRuleCreate`) surfaced the correct one. Also corrected: Phase 1's claim that `user_settings.timezone` was "completely unused" (it has one real consumer, `trigger-morning-call`), found and fixed during Blocker 2's resolution.
- **Architecture:** Consistent with ADR 0002 (Duplicated Calendar reads) and Phase 1A. Confirmed `user_settings` is genuinely shared (not duplicated) between mobile and voice — this track's writes to it don't introduce a new architectural pattern.
- **Isolation:** Contained to the voice repository (`naavi-voice-server`) and one migration. Confirmed no cron file needs to change (Blocker 2) — `trigger-morning-call` is already correct by construction given this track's paired-write design (decision 2).
- **Hidden coupling:** Traced by direct code read, not memory, for every one of the 13 call-site groups — execution boundary and `userId`/`userSettings` availability confirmed for each (Blocker 1's table). Group L's possible coupling to an SMS/alert composition path is honestly left open rather than guessed, carried into Phase 4 as an explicit trace item.
- **Implementation strategy:** Revised from "reuse the demo's TwiML pattern" to "reuse voice's own proven in-call session-state mechanism" — a materially safer strategy, since it resolves the tamper/expiration/idempotency/abandoned-call concerns by construction rather than by adding new compensating machinery.

## Decision: **Approved**

All 8 blockers from the first review round resolved with concrete evidence (not just design assertions), plus one non-blocking refinement adopted (resolved timezone cached on `opts.effectiveTimezone`, reusing `askClaude`'s existing context-object parameter rather than inventing a new one).

## Implementation Boundaries Confirmed

- **Authorized files, and the specific change in each:**
  - `supabase/migrations/[new]_user_settings_timezone_confirmed_at.sql` — add exactly one column, `timezone_confirmed_at timestamptz NULL`, to `user_settings`. No other schema change.
  - `naavi-voice-server/src/voice/resolveEffectiveTimezone.js` — new file, one exported function, per the Phase 2 spec (confirmed-or-Toronto logic + IANA validation).
  - `naavi-voice-server/src/voice/requiresConfirmedTimezone.js` — new file, one exported gate function, per the Phase 2 spec (intent-category classification).
  - `naavi-voice-server/src/index.js` — specifically: (a) new `pendingTimezoneCapture` in-memory state, declared and scoped identically to the existing `pendingActionRuleCreate` (`:8394-8421` region), with ask/confirm/persist/resume logic; (b) the gate call at turn dispatch; (c) `buildVoiceSystemPrompt` signature extended to accept `effectiveTimezone` (or read `opts.effectiveTimezone` per the adopted refinement); (d) `askClaude`'s entry extended to resolve once and populate `opts.effectiveTimezone`; (e) the `processCallRecording` call site (`:645`) extended to pass `userId` from the already-available `ctx`; (f) each of the 13 classified call-site groups (A-N, per Phase 2's table) updated to consume the resolved value instead of the literal, per that table's stated action for each group — Group N updated to use the resolver; no other file is touched to support Group N. (g) Group J's `SCHEDULE_MEDICATION` handling updated so the naive-ISO-string construction and the `timeZone` argument passed to `create-calendar-event` change together, never independently.
  - `naavi-voice-server/test/resolveEffectiveTimezone.test.js`, `naavi-voice-server/test/timezoneCapture.test.js`, `naavi-voice-server/test/requiresConfirmedTimezone.test.js` — new test files, per Phase 2's Blocker 6 resolution.
- **No additional files are approved beyond those listed.** In particular: `supabase/functions/trigger-morning-call/index.ts` is explicitly **not** authorized to change (Blocker 2 concluded it's already correct); `naavi-voice-server/src/voice/parseTimezone.js` is explicitly **not** authorized to change (reused as-is); `naavi-chat/index.ts` and any mobile file are explicitly **not** authorized under this track (Track 1's boundary, separate document).
- **No opportunistic refactoring is approved** — the existing `pendingActionRuleCreate` mechanism itself is reused, not refactored; no cleanup of unrelated code in the touched functions.
- **No architectural changes are approved beyond what the plan describes** — this does not unify voice's calendar-read implementation with mobile's (ADR 0002's duplication remains intentional), does not modify `create-calendar-event`'s own code (only the arguments voice passes to it, per Group J), and does not introduce mobile writing to `user_settings.timezone` (explicitly out of scope — see Deferred below).
- **Explicitly excluded from this authorization:**
  - Group L's SMS/alert-composition coupling — investigation only in Phase 4 (trace and report), not pre-authorized to change until that trace is complete and, if a change is needed, separately confirmed.
  - The outbound-call UX decision for unconfirmed users (Blocker 5) — the *mechanism* is authorized (reuse the pending-capture flow), but Wael's explicit product sign-off on *whether* to interrupt an outbound brief this way is still outstanding, separate from this technical authorization.
  - `executeAction` / `processCallRecording`'s exact context-object shape for the `effectiveTimezone` refinement — Phase 4 must check for an existing equivalent to `opts` in each before introducing a new one; not pre-decided here.

## Deferred Architectural Decisions

1. **Mobile auto-writing its per-request `client_timezone` into `user_settings.timezone`.** Raised during the Phase 0 amendment discussion as a complementary idea — mobile users' real-time captured value could also populate the same shared column, giving voice a second, passive source in addition to its own explicit ask. **Not approved for this implementation** — Track 2's ask/confirm path is required regardless (a voice-only caller who never opens the mobile app gets no benefit from a mobile-write-only approach), so this would add scope without being load-bearing for Track 2's own completion. **Reconsider if:** a future session finds that most registered users already have mobile-captured timezone data sitting unused while frequently calling voice unconfirmed — at that point, passively seeding `user_settings.timezone` from mobile (still requiring explicit voice confirmation before *trusting* it, per decision 2's schema) could reduce how often voice needs to interrupt a call to ask.

2. **A fifth `requiresConfirmedTimezone` gate category — "requests where the Toronto fallback is acceptable for the current call."** Raised by the external reviewer as a suggested category. **Not adopted, and not merely deferred — considered and rejected on principle**, per this project's Rule 18 (never present an unconfirmed default as though it were a confirmed fact): there is no case in this design where silently using Toronto for a timezone-sensitive answer is acceptable. When the gate doesn't interactively ask (e.g., attempt cap reached), Toronto is used *and disclosed*, never silent. This is recorded here rather than left implied, so a future session doesn't re-propose the same category without re-litigating Rule 18's stance.

---

**Status:** Phase 3 complete. Ready for Phase 4 (Implementation), strictly within the Implementation Boundaries above — pending Wael's separate product decision on the outbound-call question noted above, which should be resolved before Group M/N's outbound-specific behavior is implemented (the rest of Phase 4 is not blocked by it).
