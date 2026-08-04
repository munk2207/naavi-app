# Calendar Context Reliability — Phase 1B — Root Cause Proven

**Date:** 2026-08-02
**Governance version:** v4.0
**Phase 1A:** `docs/CALENDAR_CONTEXT_RELIABILITY_PHASE1A_LIVE_CONTEXT_TRACE_2026-08-02.md`

## Method — no new deploy needed for the decisive evidence

Temporary diagnostic logging was added to `naavi-chat` (as agreed), deployed to staging, and one reproduction was fired. Before relying on those logs, a better source was found: the mobile app already logs `brief_count` on every real send via `remoteLog` (`lib/naavi-client.ts:662`, unconditional — `diagSession` is created for every send, `hooks/useOrchestrator.ts:2041`) straight to the `client_diagnostics` table. This required no new deploy and captured the **real live phone session**, not a reproduction. The temporary `naavi-chat` logging was then removed and staging redeployed clean, per the agreed plan.

## Direct evidence: the real app's `brief_items` on every failing turn

Queried `client_diagnostics` for Robert's staging account across the exact window of Wael's live phone tests (2026-08-02, 5:55 AM – 6:15 AM EST):

```
5:55:28 AM | "What time should I leave for my dentist appointment"  | brief_count: 2
5:56:49 AM | "What's my schedule today"                              | brief_count: 2
5:59:00 AM | "What time i should leave for my next appointment"      | brief_count: 2
6:04:22 AM | "Drive me to my next meeting"                           | brief_count: 2
6:05:43 AM | "Drive me to my next appointment"                       | brief_count: 2
6:11:55 AM | "Drive me to my next appointment" (new app session, turn resets to 1) | brief_count: 2
6:15:02 AM | "What time should I leave for my team standup"          | brief_count: 2
```

**`brief_count` is exactly 2 on every single turn, across two separate app sessions (including after a full app restart).** Not empty — persistently, structurally small, and never includes calendar events, as traced below.

## Root cause — traced to the same schema drift found at the start of this session

`app/index.tsx:1176-1190` — the mobile app's Brief-loading effect:

```js
Promise.all([
  fetchUpcomingEvents(7, currentUserId),
  fetchUpcomingBirthdays(currentUserId),
  registry.email.fetchImportant(currentUserId),
  fetchTodayTimeAlerts(currentUserId),
]).then(async ([calendarItems, birthdayItems, emailItems, timeAlerts]) => {
  const enriched = await enrichWithTravelTime(calendarItems);
  setBrief(prev => {
    const weather = prev.find(i => i.id === 'weather');
    return [...enriched, ...birthdayItems, ...emailItems.map(emailToBriefItem), ...timeAlerts, ...(weather ? [weather] : [])];
  });
});
```

`fetchUpcomingEvents` is `lib/calendar.ts`'s function, which explicitly `.select('google_event_id, title, start_time, end_time, location, description, ...')` against the `calendar_events` table (`lib/calendar.ts:380,394`). **Staging's `calendar_events` table does not have a `location` column** — this was directly confirmed earlier in this same session (`SELECT location FROM calendar_events` on staging fails with `"column calendar_events.location does not exist"`; confirmed present on production). The query errors, is caught (`lib/calendar.ts:428-431`), and falls through to `events ?? []` — an **empty array**, logged only as a `console.error`, never surfaced to the user.

**The chain, now fully closed:**
1. Staging's `calendar_events` table is missing the `location` column (schema drift vs. production, root-caused earlier this session).
2. `fetchUpcomingEvents` (the mobile Brief's calendar source) selects that column and silently fails, returning zero calendar events, every time, on staging.
3. `setBrief` therefore only ever receives birthdays + emails + time-alerts + weather — never calendar events — which is why the count sits at a small, stable number (2, for this account) instead of the ~20 calendar events actually on the calendar.
4. This broken, calendar-empty brief is exactly what `sendToNaavi`/`callNaaviEdgeFunction` ships to `naavi-chat` as `brief_items` on every turn (`lib/naavi-client.ts:662-673`).
5. For any phrase where `LIVE_CALENDAR_RE` does not match (named events like "Team standup," "Gym class," or "next class" — proven in Phase 1A), `naavi-chat` does no fetch of its own and falls back entirely to this broken `brief_items` (`naavi-chat/index.ts:1344-1347`) — so Claude correctly, from its actual (broken) input, reports the event doesn't exist.
6. For phrases where `LIVE_CALENDAR_RE` *does* match ("next meeting," "next appointment," "what's on my calendar"), `naavi-chat` ignores the broken client brief and does its own independent, correctly-working live Google Calendar fetch (`fetchLiveCalendarEvents`) — which is why those phrasings worked despite the client-side brief being empty of calendar data the entire time.

This is not a new, separate bug. **It is the same staging `calendar_events.location` schema-drift bug identified at the very start of this session, now traced through to a second, previously-unconnected symptom.**

## Answering Phase 0's original 7 questions, and Phase 1A's remaining gap

1. **Real mobile payload:** proven — `brief_count: 2` on every real turn, via live `client_diagnostics` data, not inference.
2. **Inline `system` bypass:** disproven as a cause (Phase 1A) — confirmed not relevant.
3. **Where events are fetched/filtered/omitted:** proven — `fetchUpcomingEvents`'s `location` column selection fails on staging, silently zeroing calendar data before it ever reaches the brief.
4. **Why "next meeting" skipped Gym:** the *client-side* data starvation is now fully explained, but this specific question is about the *server-side* fresh-fetch path (`fetchLiveCalendarEvents`), which was proven in Phase 1A to correctly include Gym class. The event-selection question for that specific path (does Claude apply an undocumented "is this a meeting" filter) remains open — it is a distinct, narrower question than the one just closed, per Wael's Requirement 1 discipline against merging causes.
5. **Why identical phrases selected different events across attempts:** still open, same reasoning as #4 — the fresh-fetch path is proven reliable at the data layer; any remaining inconsistency is in Claude's own selection reasoning, not yet independently characterized.
6. **Why the named "Team standup" produced a false negative:** **fully proven.** `needsLiveCalendar = false` for that phrasing (Phase 1A) + real `brief_items` was calendar-empty (this document) = the exact, complete, evidenced mechanism.
7. **Event type / date range / timezone / recurring expansion / stale context:** date range, timezone, and recurring-expansion were already ruled out in Phase 1A for the server-fetch path. Stale *client* context is now proven as the mechanism for the `needsLiveCalendar = false` path specifically.

## What remains genuinely open (not closed by this document)

- Whether Claude applies an undocumented event-type filter ("meeting"/"appointment" excluding Gym class) when reasoning over a *correctly fetched* event list — a live-LLM-reasoning question, independent of the schema bug just closed.
- The `global-search` calendar adapter's own empty-result finding (Phase 1A) — already scoped out of this ticket per Wael's instruction, recorded separately.

---

**Status:** Root cause for the primary failure mode (false "not found" on named events) is fully proven with direct evidence, not inference, and traces back to the already-known staging `calendar_events.location` schema drift. Awaiting Wael's direction on whether to proceed to Phase 2 for this proven piece, whether to separately scope the remaining open event-selection-reasoning question, and whether/when to fix the underlying staging schema drift itself (which affects far more than this one ticket).
