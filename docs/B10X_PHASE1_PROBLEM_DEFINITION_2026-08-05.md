# B10x — Phase 1 — Problem Definition

**Date:** 2026-08-05
**Governance version:** v4.0
**Phase 0:** Approved — `docs/B10X_PHASE0_INTENT_2026-08-05.md`

---

## What exactly is broken?

`fetchLiveCalendarEvents` (`supabase/functions/naavi-chat/index.ts:962-965`) hardcodes the literal string `"America/Toronto"` when computing "today" for its all-day-event current/past/upcoming filter, instead of using the timezone the mobile client already sends with every request. For a user outside Eastern time, an all-day event (holiday, birthday, multi-day trip) can be reported as already past when it's still current in the user's own timezone, or vice versa.

## Evidence (freshly verified this session, 2026-08-05 — all file:line citations re-checked against current code, not copied from the 2026-08-03 holding-list note without re-verification)

1. **The function's signature never accepts a timezone.** `index.ts:962-965`:
   ```ts
   async function fetchLiveCalendarEvents(
     supabase: ReturnType<typeof createClient>,
     userId: string,
   ): Promise<MobileBriefItem[]> {
   ```
2. **The hardcoded literal, inside the function.** `index.ts:1109`: `const todayTorontoStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Toronto' });` — this is the "today" anchor the all-day filter (`index.ts:1112-1141`, `isAllDay`/`isValid` filtering and date-label formatting) compares every all-day event against.
3. **The client's timezone is already captured and reliably threaded to one line above the bug, then dropped.** `index.ts:1420-1444`, inside `assembleSystemPromptServerSide`:
   ```ts
   opts.clientTimezone,     // line 1420 — used for a DIFFERENT call, same statement group
   opts.clientTime,         // line 1421
   ...
   needsLiveCalendar
     ? fetchLiveCalendarEvents(supabase, userId)   // line 1444 — opts.clientTimezone NOT passed
   ```
4. **`opts.clientTimezone` is itself reliably populated from the request body**, confirmed at `assembleSystemPromptServerSide`'s only call site, `index.ts:3370-3378`:
   ```ts
   const assembled = await assembleSystemPromptServerSide(supabase, userId, {
     ...
     clientTimezone: typeof bodyClientTimezone === 'string' ? bodyClientTimezone : undefined,
     clientTime: typeof bodyClientTime === 'string' ? bodyClientTime : undefined,
     ...
   });
   ```
   `bodyClientTimezone` is itself destructured directly from the request body at `index.ts:2057` (`client_timezone: bodyClientTimezone`), which mobile populates via `lib/supabase.ts:291-294` on every single request (`client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone`).
5. **Every other call site of `fetchLiveCalendarEvents` has the same value in scope and doesn't use it either** — confirmed by direct read of all 6 call sites: `index.ts:1444` (inside `assembleSystemPromptServerSide`, `opts.clientTimezone` in scope), `index.ts:2193, 2217, 2311, 2944, 2950` (all inside the main `Deno.serve` handler, after `bodyClientTimezone` is destructured at line 2057 — directly available via closure at every one of these lines).
6. **There is already a working precedent for exactly this "value-or-Toronto-fallback" pattern in this same file** — `fmtDtLocal`, `index.ts:1826-1827`: `function fmtDtLocal(iso: string, tz?: string): string { const timeZone = tz || 'America/Toronto'; ... }`.

## Root cause

Confirmed, not inferred: `fetchLiveCalendarEvents` was written before the client-timezone capture existed (or before it was wired through this particular call chain), and nothing has since threaded the value the last one step from `opts.clientTimezone` (available at its primary call site) or `bodyClientTimezone` (available via closure at its other 5 call sites) into this function's signature. Every other piece of the plumbing — client capture, request transport, server-side destructuring, `opts` threading into the containing function — already works correctly and is already proven in use by adjacent code in the same statements. The gap is narrowly the function signature itself and its 6 call sites never passing the value through.

## Alternatives considered

- **(Recommended) Add an optional third parameter, `clientTimezone?: string`, to `fetchLiveCalendarEvents`; use `clientTimezone || 'America/Toronto'` in place of the hardcoded literal at `index.ts:1109` (and any other Toronto literal inside the function's own body); pass the already-in-scope `opts.clientTimezone` / `bodyClientTimezone` at each of the 6 call sites.** Matches the existing `fmtDtLocal` pattern already used elsewhere in this file (evidence #6 above) — minimal, consistent with codebase convention, zero new capture/storage mechanism needed since the value already exists and is already proven reliable.
- **Look up a stored `user_settings.timezone` field instead of the per-request client value.** Rejected for this ticket — over-engineered; the client-sent value is already captured fresh on every request and is already trusted for other date/time logic in this same file (evidence #4, #6). Introducing a stored fallback is a reasonable future defensive layer (e.g., for requests that somehow arrive without the header) but is not required to fix the reported bug and would expand scope beyond Phase 0's approved boundary.
- **Do nothing / accept as a permanent Toronto-only limitation.** Rejected — this is the exact truth-integrity violation Wael flagged as the project's top priority (Rule 18 bug family), with real user-facing impact for any non-Toronto user.

## Architecture ownership

Per `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md:68`: **"Calendar — reads (live event fetch) | Duplicated | Both `naavi-chat` and the voice server independently call the Google Calendar API themselves — see `docs/adr/0002-calendar-reads-remain-duplicated.md`."**

This is Protected Core (Calendar integration) per the Architecture Reference's own risk table (`:122`). Classification: **Duplicated**, not Shared Core — meaning the Architecture Scope Rule requires verifying voice's equivalent code, not assuming this fix covers it.

### Cross-Repository Verification (Architecture Scope Rule)

**Freshly verified this session — evidence: `naavi-voice-server/src/index.js`, grep for `America/Toronto`, 40+ matches across the file.**

Voice's hardcoded-Toronto usage is structurally different from mobile's bug, in two respects that matter for scoping this ticket:

1. **Far larger surface.** Mobile's bug is one function, one hardcoded literal. Voice hardcodes `'America/Toronto'` in dozens of places across many unrelated functions — calendar all-day windowing (`:810-811`), brief date formatting (`:1396-1406, 1751-1771`), "now" computation for date-arithmetic prompt context (`:1902-1911`), medication-schedule defaults (`:5927-5944`), and more.
2. **No equivalent client-captured value exists to plumb through.** Mobile's fix works because a real value (`client_timezone`, captured from the phone's OS) already flows end-to-end and just needs its last hop connected. A phone call carries no device timezone the way an HTTP request from a mobile app does — there is no `client_timezone` equivalent for voice to draw from. Fixing voice's all-day-event handling would require inventing a new mechanism entirely (e.g., a stored `user_settings.timezone` preference, populated some other way) — a materially different, larger-scoped problem, not "thread through an already-captured value."

**Conclusion at the time this was written: voice is out of scope for this track**, per Phase 0's original constraint and confirmed here with fresh evidence rather than assumed — a different-shaped fix, and conflating the two would violate the "one governed item, one clearly-scoped fix" discipline this project already enforces.

**Superseded 2026-08-05, same session:** Phase 0 was subsequently amended to bring voice in as **Track 2** of this same ticket (B10x), once a real, evidenced solution for voice was identified (see `docs/B10X_PHASE0_INTENT_2026-08-05.md`'s AMENDMENT section and `docs/B10X_TRACK2_PHASE1_PROBLEM_DEFINITION_2026-08-05.md`). Voice is not "out of scope for B10x" anymore — it's scoped as its own track within it, kept structurally separate from this track (Track 1) for the reasons stated above, which still hold: different root cause, different risk profile, different repo/deploy. This track's own findings and recommended fix are unaffected by that amendment.

---

**No code written during this phase**, per governance.

**Status:** **Approved** (external review, 2026-08-05). Root cause proven with direct evidence at every claim (no "probably"/"likely" used). Per the Phase-Gate Approval Rule, this reviewer verdict is not itself authorization to proceed — awaiting Wael's own separate, explicit go-ahead before Phase 1A begins.
