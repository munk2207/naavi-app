# 2026-04-30 Session Handoff — 90s Hang Unsolved

**Status of the central problem: I don't actually know what's causing the 90s hang.**

This session shipped three builds, deployed multiple server-side fixes, and made
real improvements to other bugs — but the user-facing 90-second "Thinking..."
spinner on chat messages **was not solved**. This handoff is honest about that.

---

## CRITICAL — READ FIRST

1. **Read `CLAUDE.md`** — house rules unchanged.
2. **Read this handoff.**
3. **The 90s hang is the top priority.** Every fix attempted today made other
   things better but did not solve the hang. Going in with a working hypothesis
   is dangerous — the next session should start by gathering device-level
   evidence (option 1 below), not by patching code based on a code-reading
   guess.

---

## The unsolved problem (be honest)

**Symptom:** On Wael's phone, V57.9.1 build 127 (and V57.9 build 126 and
V57.8 build 125 before that), typing a simple message like `Hi` shows a
"Thinking…" spinner for 60–90 seconds. The orange Stop button is often
inactive (taps don't release the lock). Eventually either auto-resets to idle,
or the user force-stops the app.

**Server-side observation:** API Gateway logs show **NO `/functions/v1/naavi-chat`
entry** at the time of the failed turn. The phone's HTTP request never reaches
Supabase.

**What I do NOT know:**
- Whether the orchestrator's JS code reaches `callNaaviEdgeFunction` at all
- Whether the `fetch()` is called and just stalls at the OS layer
- Whether some upstream helper (`getUserProfile`, `searchKnowledge`,
  `fetchSharedPrompt`) hangs longer than its `withTimeout` cap
- Whether the Supabase JS SDK has stuck connections that block our raw fetch
- Whether the body upload itself (system prompt is ~57 KB) is stalling on
  cellular / weak signal
- Whether my V57.9.1 patches are actually executing in the deployed AAB

**What we know works:**
- Server-side `naavi-chat` returns 200 in ~1.4s when called directly via curl
  with `Authorization: Bearer ${anon}` + `user_id` in body.
- Other Edge Functions called from the phone (e.g., `text-to-speech`,
  `resolve-place`, `manage-rules`) DO appear in API Gateway during the same
  test windows — so it's not a blanket network outage.
- The 90s hang is intermittent in the abstract sense — sometimes a fresh-install
  first message returns in 15–20s, sometimes it hangs.

**Why I avoided device debugging today:**
- `feedback_no_dev_build_setup` memory says no Expo Metro / dev client.
- I conflated `adb logcat` with that (it's actually unrelated — logcat doesn't
  need a dev build), and didn't push back. **Next session should push to
  enable USB debugging + adb logcat OR ship a remote-log Edge Function**
  before touching code.

---

## What WAS solved (deployed, verified)

| Fix | Status | Verified |
|---|---|---|
| Prompt v45 — universal truthfulness rule + CREATE_EVENT phantom-action block | LIVE on `get-naavi-prompt` | "Schedule lunch with Mike" produced a real Google Calendar event |
| TTS address-expander (Dr → Drive) | LIVE on `text-to-speech` | Deployed; not directly retested verbally on V57.8/9/9.1 due to other test interrupts |
| `send-push-notification` self-prunes stale FCM tokens on 404 / NOT_FOUND / UNREGISTERED | LIVE | Test push delivered after 6 stale tokens cleaned + fresh token registered |
| Wael's 6 stale push tokens cleaned + 1 fresh token registered | DONE | Push test ("V57.9 self-healing FCM verified") arrived |
| `sync-gmail` accepts `days_back`, `before_days_back`, `target_user_id`, `tier1_only` for one-shot backfills | LIVE | Cron path unchanged (default 7 days) |
| Wael email cache backfilled to 442 days (114 → **1,735 tier-1**) | DONE | Verified via DB count |
| Hussein email cache backfilled to 360 days (~25 → **210 tier-1**) | DONE | Verified via DB count |
| V57.9 build 126 — `getSessionWithTimeout` (5s race) wraps 33 call sites of `supabase.auth.getSession()` | SHIPPED | Reduces but does NOT eliminate 90s hang |
| V57.9 — speech-on-409 (duplicate location alert) says "You already have an alert set" instead of generic failure | SHIPPED | Not directly retested |
| V57.9 — orchestrator outer-catch auto-resets `status='error'` to `'idle'` after 4s | SHIPPED | Partial: Stop button still observed inactive in some hangs |
| V57.9 — phantom-action client backstop overrides speech if commit verb spoken without matching structured action | SHIPPED | Not directly retested |
| V57.9.1 build 127 — `callNaaviEdgeFunction` adds `user_id` to body (uses `getCachedUserId()` fallback) | SHIPPED | **Did NOT solve the 90s hang** — see below |
| V57.9.1 — `app/_layout.tsx` re-registers FCM token on every launch when permission is granted (idempotent, fixes long-term token rot) | SHIPPED | Not directly retested |

---

## Hypotheses tested today and why each was incomplete

### H1: JWT refresh `getSession()` hangs indefinitely (V57.9 fix)
- **Patch:** `getSessionWithTimeout()` 5s race in `lib/invokeWithTimeout.ts`,
  applied at 33 call sites in `lib/`, `hooks/`, `app/`.
- **Outcome:** Reduced unbounded hang to ~80s, but not fully. Hang is still
  visible.

### H2: After getSession times out, anon-key fetch gets 401 from naavi-chat (V57.9.1 fix)
- **Patch:** `callNaaviEdgeFunction` now passes `user_id` in body via
  `getCachedUserId()` (in-memory module-level cache populated when
  `getSessionWithTimeout` resolves successfully).
- **Outcome:** **DID NOT FIX.** First call after force-stop has empty cache
  (no prior successful getSession yet), so no `user_id` in body, so back to
  401.
- **Plus:** even with body user_id, the API Gateway shows the phone's fetch
  never reaches Supabase. So this can't be the only issue.

### H3: SDK has stuck connections that jam OkHttp's pool, blocking the raw fetch
- **Status:** Plausible but unverified. I have no device-level evidence.
- **Proposed V57.9.2 fix (NOT applied):** persist `lastKnownUserId` to
  AsyncStorage so it survives force-stop, AND short-circuit the helpers
  (`getUserProfile`, `getEpicHealthContext`, `searchKnowledge`,
  `fetchSharedPrompt`) on the very first turn after force-stop.
- **Reason not applied:** would be a 4th hypothesis-driven build today, and
  the user (correctly) called out that a handoff is more honest than another
  guess.

### H4: This regression was introduced by server-side commit `8e6719a` (multi-user safety, removed `user_tokens` "first user wins" fallback)
- **Reasoning:** Pre-`8e6719a` deploy, naavi-chat resolved user from
  `user_tokens` even when no JWT and no body user_id were sent. So even a
  stuck-JWT phone would get a 200 reply. Hang was masked.
- **Status:** Probably true that this exposed the problem, but doesn't
  explain the 90s hang itself (401 should be fast).

---

## Recommended next-session order of attack

### 1. Get device-level evidence FIRST. Don't patch code blind.
- **Easiest:** plug Wael's phone into a PC, enable USB debugging, run
  `adb logcat | grep -i naavi`, reproduce the hang. The orchestrator has
  generous `console.log` and `console.warn` calls (`[orch:T#X]`,
  `[getSessionWithTimeout]`, `[withTimeout]`, etc.). 5 minutes will tell
  us where the chain hangs.
- **Alternative:** ship a remote-log Edge Function (one more build cycle)
  that the orchestrator POSTs diagnostic events to.

### 2. Once we know where it hangs, the fix may be obvious
- If `getUserProfile` hangs → its inner `queryWithTimeout` isn't firing
- If the helpers complete fast and `callNaaviEdgeFunction` hangs in `fetch` → connection-pool / network issue
- If `await getSessionWithTimeout` itself takes 60s → my 5s timeout isn't firing (would be a deeper React Native quirk)

### 3. If we can't get device evidence, the most likely-to-actually-help fix is:
- Persist `lastKnownUserId` to AsyncStorage in `lib/invokeWithTimeout.ts`
  (read on module load, write on every successful getSession)
- Short-circuit the helpers if any prior `getSessionWithTimeout` returned
  null in the same session (i.e., "JWT is known stuck" → skip everything,
  use defaults, go straight to callNaaviEdgeFunction with anon + body user_id)
- This is V57.9.2. ~25 lines, ~25 minutes for build cycle.

---

## Other open follow-ups (lower priority than the 90s hang)

| Item | Notes |
|---|---|
| Geofence Arrive miss at Movati (2 hours inside, no fire) | Hypothesis: 100m radius too small for big indoor venues. Bump default to ~300m for self-alerts. Server-side change in `useGeofencing.ts`. |
| Push registration "first install only" | **Already fixed in V57.9.1 build 127** (`app/_layout.tsx` now re-registers when status is `granted`). Verify on next launch by checking `push_subscriptions` row updated_at. |
| Cleanup cron to prune non-tier-1 emails older than 7 days | Optional. Not urgent. Storage is cheap. |
| `home_address` / `work_address` fields show placeholder text instead of saved values | UI display bug. The values ARE in `user_settings` (Wael: 962 Terranova Dr / 688 Bayview Dr). The Settings screen inputs just don't hydrate from DB on mount. Pre-existing, not introduced today. |
| Stop button "inactive" during long thinking | Observed today. Different code path from the auto-reset V57.9 added. Probably the Stop button's `disabled` prop is bound to wrong state, OR the orchestrator's `cancel` ref isn't reachable from there. Worth investigating alongside the 90s hang. |
| Geofence Leave should also fire voice call? | Design call. Currently by-design that only Arrival fires `callVoice`. Defer. |
| Email cache 365-day extension to ALL users (not just Wael+Hussein) | Logic is in place. When new users sign up, run the same backfill chunks for them. Could be added to a setup wizard. |

---

## What's on Wael's phone right now

- **AAB:** V57.9.1 build 127 (installed via Play Store ~3:00 PM EDT).
- **Push token:** Fresh, registered today after stale cleanup. Verified by test push delivery.
- **GPS permission:** "Allow all the time" (confirmed in Android system
  Settings — banner gone).
- **Email cache:** 442 days of tier-1 (1,735 emails) searchable via voice +
  mobile.

## What's on Robert's phone right now

- **AAB:** V56.6 build 115 (per V57.8 handoff — has not been updated since
  2026-04-28). V57.x has not been distributed to Robert yet because it's
  still mid-test. **Do not promote V57.9.1 to Robert until the 90s hang is
  diagnosed and fixed.**

---

## Final honest note

I shipped three builds today (V57.9 build 126, V57.9.1 build 127, plus the
sync-gmail patch) and three server-side Edge Function deploys. Lots of fixes
landed. But the central user-facing problem — typing "Hi" and waiting 90
seconds — is still there. I don't know why. Don't trust any of my
hypothesis-driven fixes for the next attempt. **Get device evidence first.**

— Claude (2026-04-30)
