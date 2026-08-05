# B10x — Track 1 (Mobile) — Phase 2 — Change Plan

**Date:** 2026-08-05
**Governance version:** v4.0
**Phase 1A:** Approved — `docs/B10X_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-08-05.md`

---

## Files that will change

| File | Classification | Explanation |
|---|---|---|
| `supabase/functions/naavi-chat/index.ts` | Backend (Shared Core Edge Function) | Add optional `clientTimezone?: string` parameter to `fetchLiveCalendarEvents`; replace the hardcoded `'America/Toronto'` literal at the all-day "today" anchor (`:1109`) with the output of a new `resolveClientTimezone(clientTimezone)` helper (below), not a bare `\|\|` fallback; pass the already-in-scope `opts.clientTimezone` / `bodyClientTimezone` at each of the 6 call sites (`:1444, 2193, 2217, 2311, 2944, 2950`). |
| `tests/catalogue/calendar.ts` | Tests | Regression test now covers **three** cases per the amendment below: (1) valid non-Toronto timezone, (2) valid Toronto timezone negative control, (3) missing/invalid timezone safely retaining Toronto behavior without throwing. |

No other files change. No new file is created; no file is deleted.

## Amendment — 2026-08-05, external review: validate the supplied timezone

`clientTimezone || 'America/Toronto'` handles a missing value but not an invalid non-empty one — a malformed request value (e.g. `"Not/AZone"`) would reach `toLocaleDateString()` inside `fetchLiveCalendarEvents` and could throw a `RangeError`, breaking the calendar response instead of degrading safely. Phase 4 must use a small resolver instead of the bare fallback:

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

The exact implementation may differ in Phase 4, but an arbitrary request string must never reach `toLocaleDateString()` unvalidated. Does not change the approved architecture or risk classification (still Low).

**Risk classification: Low.** Additive-only change to one function's signature (new parameter is optional, defaults to the exact previous hardcoded value when absent — a call site that's somehow missed degrades to today's existing behavior, not a new failure mode). No schema change. No new dependency. Matches an existing, already-proven pattern in the same file (`fmtDtLocal`, `:1826-1827`).

---

## Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | No | Mobile already sends `client_timezone` on every request (`lib/supabase.ts:291-294`) — no mobile-side code changes; it's already producing the value this fix consumes. |
| Voice | No | Voice has its own, separately-implemented calendar-handling code (Duplicated per ADR 0002) — untouched by this track. Addressed instead by Track 2, same ticket. |
| Shared Core | Yes | `naavi-chat`'s `fetchLiveCalendarEvents` is the function being changed. |
| Database | No | No schema change, no new column, no migration. |
| Cron | No | Not called from any cron-triggered function — confirmed by search: `fetchLiveCalendarEvents` has no callers outside `supabase/functions/naavi-chat/index.ts` (checked `evaluate-rules/index.ts` and `naavi-chat/intentHandlers.ts`, both of which only reference it in comments/type-parameter-passing, not as direct callers — see Regression Matrix below). |
| API contracts | No | `client_timezone` is already an existing, accepted request body field (`index.ts:2057`) — no new field added, no existing field's shape changed, no breaking change to the request/response contract. |
| Tests | Yes | New regression test added per Rule 15a (see Files table above). |

**Duplicated-capability statement:** Calendar reads are Duplicated (ADR 0002). This track changes **only** `naavi-chat`'s implementation. Voice's implementation is **not** left unaddressed — it's in scope under Track 2 of this same ticket (`docs/B10X_TRACK2_PHASE1_PROBLEM_DEFINITION_2026-08-05.md`), tracked and reviewed separately because its root cause and fix shape are structurally different (Phase 1A, both tracks).

## Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** Yes — `naavi-chat` is Shared Core infrastructure, and this specific capability (Calendar reads) is Duplicated within it, per Phase 1A.
- **Does this change modify an Entry Point** (mobile or voice translating logic, rather than Shared Core)? No — no mobile or voice client-side code changes.
- **Does this change introduce new duplication?** No.
- **Does this change eliminate existing duplication?** No — ADR 0002's accepted duplication between mobile and voice's calendar-read implementations remains; this fix corrects `naavi-chat`'s own instance without unifying it with voice's (voice gets its own, differently-shaped fix under Track 2).
- **Does this change modify Protected Core?** Yes — Calendar integration, per the Architecture Reference's risk table (`:122`).

## Regression Impact

| Function area | Affected? | Details |
|---|---|---|
| Voice commands | No | Voice never calls `naavi-chat`'s `fetchLiveCalendarEvents` — it has its own independent implementation (ADR 0002). |
| Geofencing | No | Unrelated capability, no shared code path. |
| Gmail integration | No | Unrelated capability, no shared code path. |
| Calendar integration | Yes | This *is* the calendar-integration change. Regression risk is specifically: Toronto-timezone users must see zero behavior change (verified by explicit before/after comparison in Phase 5 Evidence); the timed-event path is untouched (confirmed timezone-independent, pure epoch comparison, `index.ts:1043` — not modified by this change at all). |
| Reminders | No | `fetchLiveCalendarEvents` reads live Google Calendar events for schedule/brief context — it is not part of the `action_rules` reminder-firing engine (`evaluate-rules`'s `findCalendarTriggers`, checked this session: pure epoch comparisons only, no all-day/Toronto hardcoding, structurally unaffected either way). |
| SMS / call alerts | No | Unrelated capability. |
| Onboarding | No | Unrelated capability. |
| Staging build | No app rebuild required | This is a Supabase Edge Function change only — deploys independently via `npx supabase functions deploy naavi-chat --no-verify-jwt --project-ref xugvnfudofuskxoknhve`, no mobile APK build needed to take effect. |

## Regression Matrix (per-change consumer trace)

`fetchLiveCalendarEvents` has **6 callers, all within `supabase/functions/naavi-chat/index.ts`**, confirmed by search (`grep -n "fetchLiveCalendarEvents("`), no callers found in any other file:

| Call site | Context | Post-change behavior |
|---|---|---|
| `:1444` | Inside `assembleSystemPromptServerSide`, populating the general system prompt's calendar context | Passes `opts.clientTimezone` (already in scope, used on the immediately preceding line for a different purpose) |
| `:2193` | B6e bypass — deterministic "what's on my calendar" (`isCalendarReadIntent`) handler | Passes `bodyClientTimezone` (in scope via closure, destructured at `:2057`) |
| `:2217` | Deterministic next-event travel-time bypass (`isUnnamedNextEventTravelTimeIntent`, this session's Ticket B fix) | Passes `bodyClientTimezone` |
| `:2311` | Pending-intent `CALENDAR_SEARCH` handler (multi-turn flow) | Passes `bodyClientTimezone` |
| `:2944` | Level A classifier `CALENDAR_SEARCH` handler (`liveEventsL2`) | Passes `bodyClientTimezone` |
| `:2950` | Level A classifier `READ_CALENDAR` handler (`liveEventsRC`) | Passes `bodyClientTimezone` |

Two files reference `fetchLiveCalendarEvents` by name in comments only, confirmed **not** actual callers: `supabase/functions/evaluate-rules/index.ts:323` ("Same pattern as naavi-chat's fetchLiveCalendarEvents" — its own separate `findCalendarTriggers` function, not a call) and `supabase/functions/naavi-chat/intentHandlers.ts:236` (`handleCalendarSearch` receives already-fetched events as a parameter, per its own comment: "imported as a parameter so this file has no circular dependency on index.ts").

All 6 real call sites will be updated in the same commit — none left passing the old two-argument form, so there's no partial-rollout state to reason about.

---

**No code written during this phase.**

**Status:** **Approved** (external review, 2026-08-05), after the timezone-validation amendment above. Per the Phase-Gate Approval Rule, awaiting Wael's own separate go-ahead before Phase 3/4 begins.
