# B10x — Track 1 (Mobile) — Phase 3 — Technical Review (Before Coding)

**Date:** 2026-08-05
**Governance version:** v4.0
**Reviewed:** `docs/B10X_TRACK1_PHASE2_CHANGE_PLAN_2026-08-05.md`
**Risk classification:** Low

---

## Reviewer evaluation

- **Assumptions:** Confirmed sound — every claim in Phase 1/2 (client timezone already captured, already threaded to one line above the bug, existing fallback precedent) was verified by direct code read, not inferred.
- **Architecture:** Consistent with the Architecture Reference's Duplicated classification (ADR 0002) and Phase 1A's completeness review. No new duplication introduced, no existing duplication eliminated.
- **Isolation:** Change is contained to one function's signature and its 6 call sites, all in one file. No spillover into mobile client code, no schema change, no API contract change.
- **Hidden coupling:** None found — `fetchLiveCalendarEvents` has no callers outside `naavi-chat/index.ts` (the two other-file mentions found by search are comments, confirmed not real callers).
- **Implementation strategy:** Additive optional parameter with a validated fallback (see amendment below), matching an existing proven pattern (`fmtDtLocal`) already in the same file.

## Decision: **Approved**, after the required amendment below

**Required amendment (from Phase 2 review):** `clientTimezone || 'America/Toronto'` must not be used bare — an invalid non-empty value (e.g. `"Not/AZone"`) would reach `toLocaleDateString()` unvalidated and could throw. Phase 4 must use:

```ts
function resolveClientTimezone(value?: string): string {
  if (!value) return 'America/Toronto';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return value;
  } catch {
    console.error('[fetchLiveCalendarEvents] Invalid client timezone:', value);
    return 'America/Toronto';
  }
}
```

Already incorporated into `docs/B10X_TRACK1_PHASE2_CHANGE_PLAN_2026-08-05.md`'s Files table and Amendment section.

## Implementation Boundaries Confirmed

- **Authorized files, and the specific change in each:**
  - `supabase/functions/naavi-chat/index.ts` — add `resolveClientTimezone(value?: string): string` helper; add optional `clientTimezone?: string` parameter to `fetchLiveCalendarEvents`; replace the hardcoded `'America/Toronto'` literal at `:1109` with `resolveClientTimezone(clientTimezone)`; pass `opts.clientTimezone` / `bodyClientTimezone` at each of the 6 call sites (`:1444, 2193, 2217, 2311, 2944, 2950`) — no other line in this file changes.
  - `tests/catalogue/calendar.ts` — add `calendar.create-event-db-mirror...`-style new test case(s) covering the 3 required scenarios (valid non-Toronto, valid Toronto negative control, missing/invalid-safe-fallback). No existing test in this file is modified.
- **No additional files are approved beyond those two.**
- **No opportunistic refactoring is approved** — the existing 6 call sites' surrounding logic, `fmtDtLocal`, and any other function in `naavi-chat/index.ts` are untouched beyond the specific lines listed above.
- **No architectural changes are approved beyond what the plan describes** — this does not touch `create-calendar-event`, does not touch voice, does not touch any schema.
- **Explicitly excluded from this authorization:** Track 2 (Voice) is a separate track under the same ticket with its own Phase 2/3 — nothing here authorizes any voice-server change.

## Deferred Architectural Decisions

None for this track. The one open design question this track originally carried (whether to look up a stored `user_settings.timezone` instead of the per-request value) was resolved in Phase 1 as rejected, not deferred — the per-request value is already reliable and required no further architectural consideration.

---

**Status:** Phase 3 complete. Ready for Phase 4 (Implementation), strictly within the Implementation Boundaries above.
