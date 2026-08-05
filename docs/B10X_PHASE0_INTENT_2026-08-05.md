# B10x — Phase 0 — Intent Approval

**Date:** 2026-08-05
**Governance version:** v4.0
**Status:** APPROVED (amended) — Wael's explicit approval given for the original scope 2026-08-05, and for this amendment the same session.

---

## AMENDMENT — 2026-08-05, same session

**What changed:** Phase 0 originally scoped B10x to mobile only, with voice explicitly listed as "not yet confirmed to share or duplicate this exact function... a Phase 1 question, not assumed in or out of scope." Phase 1 (below, unchanged) then confirmed with fresh evidence that voice's calendar-reads are genuinely Duplicated (ADR 0002) and structurally different — no client-timezone equivalent exists for a phone call the way it does for a mobile HTTP request.

**Why the amendment:** Wael's original intent, stated directly, was to fix timezone truth **across the whole product**, not mobile alone — the mobile-only scope was accepted provisionally only because voice appeared to have no viable solution. That premise no longer holds: this session's discussion surfaced that (a) `user_settings.timezone` already exists as an unused column (`20260415000002_user_settings.sql`, defaults `'America/Toronto'`), with existing code comments (`naavi-chat/index.ts:3410`, `naavi-voice-server/src/index.js:3334`) already pointing at it as the intended fix, and (b) the F2b demo line already has a proven, deterministic, no-LLM ask/parse/confirm mechanic (`naavi-voice-server/src/voice/parseTimezone.js` + the demo's Gather/Say TwiML flow) that just needs its output persisted instead of discarded. With a real, evidenced solution now identified for voice too, artificially limiting B10x to mobile would leave the ticket short of what was actually asked for.

**Resolution — one ticket, two tracks**, mirroring the pattern already used for Ticket B (Tracks A/B/C):

- **Track 1 — Mobile.** The originally-scoped fix below, unchanged. Low-risk, additive, no schema change. Phase 1 already complete (`docs/B10X_PHASE1_PROBLEM_DEFINITION_2026-08-05.md`) — ready for Phase 2.
- **Track 2 — Voice.** New. Persist a confirmed timezone to `user_settings.timezone` via a reused ask/confirm flow, and read it in place of voice's own hardcoded `America/Toronto` literals. Real schema addition + new voice UX + separate repo/deploy (Railway) — different root cause, different blast radius from Track 1, requires its own Phase 1 (`docs/B10X_TRACK2_PHASE1_PROBLEM_DEFINITION_2026-08-05.md`).

Kept as two tracks under one ticket, not one undifferentiated scope, because the two fixes have genuinely different root causes, risk profiles, and deploy mechanisms — Phase 3/6 review needs to evaluate each on its own terms — but they close together against one shared intent and one shared completion criterion: timezone truth fixed everywhere, not just mobile.

---

## User Intent

**Track 1 (Mobile):** `fetchLiveCalendarEvents` (`supabase/functions/naavi-chat/index.ts`) hardcodes the literal string `"America/Toronto"` when deciding whether an **all-day** calendar event (a holiday, a birthday, a multi-day trip) is currently active, upcoming, or already past — even though the mobile client already captures and sends the device's real timezone (`client_timezone`, `lib/supabase.ts:291-294`) with every request. That captured value never reaches this function. Fix it so all-day event currency is judged using the user's actual timezone, not an assumed Toronto one.

**Track 2 (Voice):** Voice has no equivalent captured timezone at all — a phone call carries no device timezone signal — and hardcodes `America/Toronto` across dozens of call sites (calendar windowing, date formatting, "now" computation, medication defaults). Fix it by asking a registered caller their timezone once (reusing the proven demo-line mechanic), persisting the confirmed answer to `user_settings.timezone`, and reading that value in place of the hardcoded literal everywhere voice currently assumes Toronto.

## Success Criteria

**Track 1 (Mobile):** For a user whose device timezone differs from America/Toronto, an all-day event's presence/absence and "is this today/past/upcoming" status in Naavi's schedule answers matches what is true in **that user's own timezone** — not what it would be in Toronto. Reproduction test: simulate a non-Toronto `client_timezone` on a request, confirm an all-day event's placement in the schedule list changes correctly to match that timezone's calendar day, where it previously would not have.

**Track 2 (Voice):** A registered caller whose real timezone differs from America/Toronto, once they've confirmed it with Naavi over a call, gets calendar/date/time answers over voice computed against their real timezone — not an assumed Toronto one. Reproduction test: a test account with a confirmed non-Toronto `user_settings.timezone`, verify voice's date/time-dependent answers (all-day event currency, "now," etc.) reflect that timezone.

*(Per governance's note for bug fixes: the root cause doesn't need to be re-derived here for Track 1 — it's already confirmed by direct code read, cited below. Track 2's root cause — no capture mechanism exists at all for voice — is established in Track 2's own Phase 1. Phase 0 fixes what "done" means; Phase 1 documents how to get there in full.)*

## In Scope

**Track 1 (Mobile):**
- `fetchLiveCalendarEvents(supabase, userId)` in `supabase/functions/naavi-chat/index.ts` — extending its signature to receive and use the client's timezone.
- The all-day-event date-boundary comparison specifically (`index.ts:1023`, `:1032-1044` — hardcoded `"America/Toronto"`).
- Plumbing `client_timezone` (already captured client-side, already sent on every request) through to this function — not inventing new capture logic.

**Track 2 (Voice):**
- A schema addition to distinguish "timezone confirmed" from "never asked, defaulted" on `user_settings` (the existing `timezone` column defaults to `'America/Toronto'` for every row today, so presence alone can't distinguish the two).
- Reusing `naavi-voice-server/src/voice/parseTimezone.js` and the demo line's proven ask/confirm TwiML pattern, adapted to persist to `user_settings.timezone` for a registered caller instead of passing the value through ephemeral URL params for one call.
- A trigger-point decision for when to ask (first-ever call vs. lazy-ask on first need) — to be resolved in Track 2's own Phase 1/2.
- Updating voice's own hardcoded `America/Toronto` read sites (`naavi-voice-server/src/index.js`, 40+ occurrences found this session) to read the confirmed `user_settings.timezone` where relevant, falling back to the same Toronto default when unconfirmed.

## Out of Scope

- **Timed events' past/future check (Track 1)** — confirmed by direct read to be a pure epoch comparison (`startDate.getTime() > now`, `index.ts:1043`), already timezone-independent. Not touched.
- **`create-calendar-event`'s own `timeZone: 'America/Toronto'` field** — that usage is deliberate and correct (it tells Google what timezone a naive local string represents when *creating* an event) and is unrelated to either track, which are both about *reading*. Must not be touched under this ticket.
- **This session's three earlier fixes** (confirmation-text date arithmetic, `create-calendar-event`'s DB-mirror timezone storage) — different mechanisms, already fixed and deployed, not part of B10x.
- **Mobile auto-writing its `client_timezone` into `user_settings.timezone`** — discussed as a complementary idea (mobile users' real-time value could also populate the same shared column) but not adopted into either track's scope here; flagged as a possible future follow-up, not committed to in this ticket.
- **F2b demo line's own behavior** — Track 2 reuses `parseTimezone.js` and the TwiML pattern by reference; the demo line's own ephemeral, unregistered-caller flow is not modified.

## Constraints

- **Full Phase 1-8 governance required for both tracks** — Protected Core (Calendar integration for Track 1; Voice orchestration + Calendar integration for Track 2), per `docs/AI_DEVELOPMENT_GOVERNANCE.md` §4. Mandatory Phase 3 + Phase 6 external review, evaluated separately per track.
- **No regression for America/Toronto users, either track.**
- **Staging first** — per CLAUDE.md's staging-first rule, no production deploy without Wael's explicit go-ahead after staging verification. Track 2 additionally requires its own staging validation on the voice server (Railway), separate from Track 1's Supabase Edge Function deploy.
- **One governed item per session** — Track 1 and Track 2 may each complete their own Phase 1-8 cycle in separate sittings; per the holding list's own priority-queue rule, Phase 4 (implementation) for either track should not be crammed into the same session as other unrelated shipped work. Phase 0/1 (writing, no code) for either track is safe to do in parallel with other in-flight work.
- **Track 2 vocabulary change note** — `parseTimezone.js`'s own header comment states any vocabulary change requires "a new Phase 2 plan + tests + review, not a casual edit" (inherited from its F2b origin). If Track 2 needs to extend the recognized city/region vocabulary, that constraint carries over.

## Completion Criteria

**Track 1:**
- Fix deployed to staging; live-tested with a simulated non-Toronto `client_timezone`, confirming an all-day event's current/past/upcoming determination is now correct for that timezone.
- Confirmed zero regression for America/Toronto-timezone requests (explicit before/after comparison).
- Auto-tester regression test added per Rule 15a, covering both the non-Toronto fix and a Toronto-timezone negative control.

**Track 2:**
- Voice can ask, parse, confirm, and persist a caller's timezone to `user_settings.timezone`, live-tested on staging with a real call.
- Voice's date/time-dependent answers reflect the confirmed timezone once set.
- Confirmed zero regression for unconfirmed/default-Toronto accounts.
- Regression test added to the voice test suite (or documented as a coverage gap with Wael's explicit sign-off, per Rule 15a's exception path, if the voice suite can't cover it).

**Both tracks:**
- Full Phase 1-8 cycle completed for each track, including Phase 3 and Phase 6 external review sign-off.
- Holding list (`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`) B10x entry updated to CLOSED, covering both tracks, with the final evidence trail.

---

**Source citation for the root cause claim above** (already established, not re-derived here): `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, P1 entry, `[[B10x]]` — confirmed by direct code read 2026-08-03, Wael's explicit priority call: *"This is a very BIG issue, and it breaks major component of naavi, the truth... It is my mistake that I TRUSTED."*

**Approved.** Original scope approved 2026-08-05; this amendment (expanding to Track 2 — Voice) approved the same session, same date, per Wael's explicit direction: *"my intension is to fix Time zone across all, if we can not, then we limit. Now we have a solution. Then why we do not expand the B10x."*
