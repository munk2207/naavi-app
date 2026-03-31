# Naavi — Sync Scheduler Design

> Version 0.2 — March 2026
> How Naavi keeps its data fresh without Robert noticing.
> Updated to reflect actual implementation: Supabase Edge Functions + pg_cron (not Expo Background Fetch).

---

## The Goal

When Robert says "What do I have today?" at 8:15am, the answer should be instant.
Not "give me a moment while I check your calendar." Instant.

That means all the work — fetching the calendar, pulling the health portal, checking the weather — must happen *before* Robert opens his mouth. The sync scheduler is what makes that possible. It runs quietly in the background, keeps the local cache current, and has a fully-assembled morning brief waiting by the time Robert reaches for his phone.

---

## The Two-Layer Timing Problem

Mobile phones (both iPhone and Android) have strict rules about apps running in the background. They do this to protect battery life. The rules matter for Naavi:

**What phones allow:**
- Short bursts of background work, roughly every 15 minutes (iOS) or configurable (Android)
- The app does not control exactly *when* these run — the operating system decides, based on battery, network, and usage patterns

**What phones do not allow:**
- An app running continuously in the background
- An app scheduling a precise 07:00 wake-up on its own

**How Naavi works around this:**

Two mechanisms working together:

```
1. BACKGROUND FETCH (opportunistic)
   ─ Expo registers tasks that the OS runs when conditions are right
   ─ Handles routine 15-min calendar sync, hourly weather, etc.
   ─ Not time-precise — the OS may delay by minutes

2. SCHEDULED LOCAL NOTIFICATION (reliable trigger)
   ─ A silent notification scheduled for 07:00 every morning
   ─ When fired, triggers the morning pre-sync and brief assembly
   ─ More reliable for the one sync that must happen at a specific time
   ─ Robert never sees this notification — it is silent, internal only
```

Together: routine data stays fresh via Background Fetch; the morning brief is reliably ready by 07:00 via the scheduled notification.

---

## Sync Schedule Summary

> **Implementation note:** The original design used Expo Background Fetch (on-device). The actual implementation uses **Supabase Edge Functions triggered by pg_cron** (server-side). This is better: syncs run even when the app is closed, and Robert's tokens never leave the server.

### Currently live (Phase 9–10)

| Integration | Mechanism | Interval | Supabase Function |
|-------------|-----------|----------|-------------------|
| Google Calendar | pg_cron → Edge Function | Every 6 hours | `sync-google-calendar` |
| Gmail | pg_cron → Edge Function | Every hour | `sync-gmail` |
| Weather | On app load (direct API call) | Per session | `mobile/lib/weather.ts` |

### Planned (future phases)

| Integration | Mechanism | Interval | Why |
|-------------|-----------|----------|-----|
| Google Drive | pg_cron → Edge Function | Every 4 hours | Document changes infrequently |
| Withings / Oura | pg_cron → Edge Function | Daily at 07:00 | Health data — daily snapshot |
| MyChart (FHIR) | pg_cron → Edge Function | Every 4 hours | Appointments rarely change same-day |
| Ecobee | pg_cron → Edge Function | Every 30 min | Ambient awareness |

---

## Retry Logic

When a sync fails (network down, token issue, API error), the scheduler does not retry immediately — that would hammer a struggling service. Instead it uses **exponential backoff**:

```
Attempt 1 fails → wait 2 minutes → retry
Attempt 2 fails → wait 4 minutes → retry
Attempt 3 fails → wait 8 minutes → retry
Attempt 4 fails → mark as stale, serve cache, surface once to Robert
```

After 4 failed attempts, Naavi gives up for that cycle. On the next scheduled sync window, it tries again fresh. Robert is told once ("I couldn't reach your calendar — showing what I have from yesterday") and not repeatedly.

---

## Morning Pre-Sync Sequence

The most important sync of the day. Target: complete by 07:05.

```
07:00 ─── Silent notification fires
           │
           ├─ 1. Sync Calendar (highest priority — today's events)
           ├─ 2. Sync MyChart  (upcoming appointments, medication check)
           ├─ 3. Sync Weather  (walking/golf relevance for today)
           ├─ 4. Read Apple Health (yesterday's steps, sleep)
           │
           ├─ 5. Assemble Morning Brief
           │      ├─ Pull integration snapshot
           │      ├─ Run assembleMorningBrief()
           │      └─ Write assembled brief to SQLite
           │
           └─ 6. Mark brief as "ready"

07:15+ ─── Robert opens Naavi
           └─ Brief is read from SQLite — instant response
```

If a step fails, the brief is assembled with what's available. A partial brief is better than no brief.

---

## Battery Impact

The sync schedule above runs approximately:
- 96 calendar syncs per day (every 15 min)
- 24 weather syncs per day (every hour)
- 6 FHIR syncs per day (every 4 hours)

Each sync is a small HTTP request (< 10KB) and a SQLite write. On a modern phone, this is negligible — comparable to a messaging app checking for new messages. Apple's own guidelines allow this pattern. The morning notification adds one silent push per day.

Estimated additional battery drain: **less than 1%** per day.
