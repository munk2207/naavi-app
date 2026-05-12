# Session Handoff — 2026-05-11 → V57.14.3 build 169

**Status at session close:** V57.14.3 build 169 on Wael's phone. Auto-tester
85/85 green. F1d shipped end-to-end (with 3 edge-case tests pending live
verification). F1a server foundation shipped (Session 2 — orchestrator
wiring + mobile UI — pending). Geofence reliability NOT fixed; investigation
narrowed root cause to Android's native `GeofencingClient` API not delivering
events even when every Naavi-side prerequisite is correct.

**Three big things shipped today (one session, 10+ commits):**

1. **F1d — User-controlled mute / SMS-the-rest** (privacy feature). Caller
   says "no sound" / "quiet" / "shh" / "shush" mid-response → voice-server
   intercepts → offers "Want me to text the rest to your phone?" → on yes,
   mints a token, stores response under `hosted_replies`, sends SMS with
   `mynaavi.com/r/<token>` link + email with full content. End-to-end
   verified by Wael on real call. Memory: F1d steps 1–4 across multiple
   files.

2. **F1a server foundation — Lists wired to events**. `list_connections`
   table with one-list-per-entity UNIQUE; `manage-list-connections` Edge
   Function (CRUD, 5 ops); alert fan-out reads connected lists; Anthropic
   tools `list_connect` / `list_disconnect` / `list_connection_query` /
   `list_delete`; prompt v68 RULE 8b. 7 integrity tests green. **Not yet
   user-facing — orchestrator handlers + mobile UI pending in Session 2.**

3. **Geofence reliability attempts (still open)** — server-side dwell timer
   (default 120 s) + 500 m default radius + foreground location service +
   persistent AsyncStorage registry. Despite all this, today's live tests
   AT Costco Blair (morning) and 1026 Terranova (afternoon, 5+ minute stop)
   BOTH failed: Android's `GeofencingClient` API did not deliver ENTER
   events to the app at all. Decision parked at session close to switch
   strategy entirely in next session (manual location polling instead of
   Android-native geofencing).

---

## Today's commits (chronological)

| Commit | Repo | What |
|---|---|---|
| `e0d7ec5` | voice-server | F1d step 3 voice privacy-mute words + SMS-the-rest |
| `6ba6d2b` | naavi-app | F1d step 3 backend: prompt v67 + send-email Rule 4 + runner retry |
| `da1abef` | voice-server | F1d step 3 follow-up: "OK." ack on privacy-mute "no" |
| `6448cb0` + `bc810d9` | mynaavi-website | F1d step 4: `r/<token>` page + Vercel rewrite |
| `bea76e2` | naavi-app | Server-side geofence dwell timer (pending_dwell_fires + cron) |
| `a9fbc03` | naavi-app | CLAUDE.md — close geofence reliability holding item (later re-opened) |
| `2f83704` | naavi-app | CLAUDE.md — queue AAB item 23 (Battery Opt prompt) |
| `ccf53f8` | naavi-app | V57.14.2 build 168: in-app Battery Optimization prompt |
| `76fa89c` | naavi-app | Close AAB item 23 + HF voice-biometric pivot |
| `1ca1dee` | naavi-app | F1a Session 1: server foundation (no AAB) |
| `eb4fb25` | naavi-app | V57.14.3 build 169: foreground service + persistent registry |

---

## F1d — final status (feature complete, edge-case tests pending)

| Step | What | Status |
|---|---|---|
| 1 | Mobile long-press mute (`onChatLongPress`) | ✅ Shipped V57.14.1 build 167 |
| 2 | `hosted_replies` table + `save-hosted-reply` + `get-hosted-reply` | ✅ Shipped, 5 integrity tests green |
| 3 | Voice-server intercept + `deliverHostedReply` + "OK." ack | ✅ Shipped |
| 4 | `mynaavi.com/r/<token>` web page + Vercel rewrite | ✅ Shipped, verified live |
| Test 1 | Mute → "yes" → SMS link + email + web page | ✅ Passed |
| Test 2 | Mute → "no" → "OK." ack | Verified silent-discard pre-ack; ack code shipped but not retested live |
| Test 3 | Recursive mute during offer (offer stays pending) | ❌ Not tested |
| Test 4 | 30-second timeout silence after mute (offer auto-discards) | ❌ Not tested |

**To close F1d completely:** run live voice-call tests 3 + 4. Pure verification,
no code change needed. Voice channel only, no AAB.

---

## F1a — final status (server done, user-facing not yet)

**Session 1 shipped today (server only):**

| Item | Status |
|---|---|
| `list_connections` schema + UNIQUE on `(entity_type, entity_id)` + RLS | ✅ |
| `manage-list-connections` Edge Function (CONNECT / DISCONNECT / LIST_CONNECTIONS_FOR_LIST / LIST_CONNECTIONS_FOR_ENTITY / DELETE_LIST_AND_CONNECTIONS) | ✅ |
| `_shared/alert_body.ts` reads connected list items via new `ruleId` param | ✅ |
| Anthropic tools: `list_connect`, `list_disconnect`, `list_connection_query`, `list_delete` | ✅ |
| Prompt v68 RULE 8b (vocabulary, disambiguation, auto-create, cascade-warning) | ✅ |
| `lib/voice-confirm.ts` `CONFIRM_PHRASE` constant | ✅ |
| 7 integrity tests in `tests/catalogue/list-connections.ts` | ✅ Green |

**Session 2 (next session) — NOT DONE, blocks user-facing F1a:**

1. **Voice-server `executeAction` handlers** for `LIST_CONNECT`, `LIST_DISCONNECT`,
   `LIST_CONNECTION_QUERY`, `LIST_DELETE`. Each needs:
   - Entity-reference resolver: convert Claude's `entityRef` string (e.g.,
     "Costco alert", "Tuesday meeting") to `(entity_type, entity_id)` by
     searching `action_rules` / calendar events / etc.
   - Single-match → call `manage-list-connections`. Multi-match → ask user
     to clarify (numbered list per Rule 13). No-match → ask differently.
   - Confirmation gate using the standardized 3-option phrase.
2. **Mobile `useOrchestrator.commitPending` handlers** for the same 4 action
   types. Same entity resolution logic.
3. **Mobile UI:**
   - New "Lists" entry in the 3-dots menu (sibling to Alerts and Notes)
     with subcategories: All / Connected / Standalone.
   - List-detail screen with "Connected to: X · Y · Z" header (tap to
     navigate to entity) + existing item-edit affordances.
   - Alert-detail card update: "List: errands (5 items)" line + delete-
     connection icon next to it.
4. **Migration of `action_config.tasks[]` and `action_config.list_name`**
   into `list_connections`. Today's count showed 0 legacy rows, so the
   data migration itself is a no-op — but the CODE migration (orchestrator
   stops emitting `tasks` / `list_name` on new alerts, emits `list_connect`
   instead) is real work.
5. **Voice-flow regression tests** in `tests/catalogue/prompt-regression.ts`
   for the new vocabulary ("connect groceries to Costco" → emits
   `list_connect`).
6. **AAB V57.15.0** when mobile UI lands.

Estimated scope: 1 focused session (~3-4 hours). After Session 2 lands,
F1a is complete and a user can say *"connect my groceries list to my Costco
alert"* and have it actually work end-to-end.

---

## Geofence reliability — current state (open, decision parked)

**What was attempted today across 4 attempts:**

| Layer | Change | Outcome |
|---|---|---|
| Server | `pending_dwell_fires` + 120 s dwell + `fire-pending-dwells` cron | Works when events arrive (proven by morning Terra Nova false-fire at 12:09) |
| Server | 500 m default radius — bulk-updated 8 existing rules | New rules created via voice still default to 100 m (resolve-place default not yet bumped) |
| Phone | Battery Optimization → "Unrestricted" (manual + automated via V57.14.2 modal) | Confirmed set; samsung sleep lists already exclude Unrestricted apps |
| Phone | Foreground location service (V57.14.3) | Notification appears + stays alive; permissions all granted; geofences register OK |
| Phone | Persistent registry (`naavi.geofence.lastReg.v1` in AsyncStorage) | Replaces in-memory Map; should fix Terra Nova-style phantom false-positives |

**Today's two real-world tests:**

1. **Costco Blair morning visit** — 40+ minutes inside the 500 m geofence,
   no `geofence-T1-*` events, no `pending_dwell_fires` entry, no SMS.
2. **1026 Terranova afternoon visit** (5 PM, V57.14.3 build 169) — 5+ minute
   stop at the geocoder-verified-correct coordinates, FG notification alive,
   permissions both granted, 12 regions registered with the OS — still no
   `geofence-T1-*` events delivered to the app task.

**Root cause analysis (data-driven, not hypothesis):**

- Permissions: foreground=granted, background=granted ✓
- Battery Optimization: Unrestricted ✓
- FG service: alive (notification shown, syncGeofences logged "fg-location-service-started")
- Geofences registered: 12 OK ✓
- Coordinates: verified via OpenStreetMap reverse-geocode (1026 IS 1026) ✓
- Direction = arrive, radius 100 m, rule enabled ✓
- BUT `client_diagnostics` shows ZERO `geofence-T1-task-fired` entries
  during the 5-minute stop window, and `pending_dwell_fires` has zero
  rows for the afternoon test.

**Conclusion:** Android's native `GeofencingClient` (the OS API behind
`Location.startGeofencingAsync`) did not deliver ENTER events to the app
even though every observable Naavi-side prerequisite was correct. The
failure is inside Android's black box — likely some combination of App
Standby Buckets, OS-side geofence sampling cadence at 100 m radius, or
Samsung One UI throttling we can't see from our logs.

**Decision parked at session close (Wael 2026-05-11):**

The path forward is to STOP relying on Android's `GeofencingClient` and
build manual geofence detection on top of the foreground location service
we already have. The FG service is receiving periodic location updates
(currently discarded by the no-op task handler in `useGeofencing.ts`).
Change the handler to:

1. On each location update (recommended cadence: 60-90 s for arrival
   detection), compute distance from current position to each enabled
   rule's center.
2. Track in-region state per rule (in / out) in AsyncStorage.
3. On transitions: fire ENTER or EXIT manually by POSTing to the existing
   `report-location-event` Edge Function.
4. Existing server-side dwell timer + `fire-pending-dwells` cron unchanged.

**Tradeoffs:**
- Battery: 60-90 s location updates ≈ 2-5%/day extra vs current FG idle.
- Reliability: WE control the polling and decision logic — every step
  logs, every failure is traceable. No opaque OS black box.
- Strava, Google Fit, and most reliable "arrival" apps do exactly this.

**Estimated scope of the manual-polling switch:** ~80-100 lines in
`useGeofencing.ts`, no schema changes, AAB required (native task handler
change → V57.14.4). Likely the FIRST AAB of next session.

---

## Next session — priority order

1. **Manual geofencing switch (V57.14.4)** — see Geofence Reliability above.
   This unblocks all location-alert reliability and is the gating issue for
   promoting V57.x to Robert. Should be first AAB of next session.
2. **F1a Session 2** — orchestrator wiring + mobile UI + V57.15.0 AAB.
   Voice-server `executeAction` handlers, mobile orchestrator handlers,
   Lists screen, list-detail, alert connection card, voice-flow tests.
3. **F1d edge case tests 3 + 4** — recursive mute + 30-sec timeout. Voice
   call only, no AAB.

Lower-priority items remain in the CLAUDE.md HOLDING LIST.

---

## Key context for the next agent

- **Latest AAB:** V57.14.3 build 169 (commit `eb4fb25`), installed Wael's
  phone 2026-05-11 ~17:25 EDT.
- **Last shipped prompt version:** `2026-05-11-v68-f1a-list-connections`
  (the v66/v67/v68 sequence shipped today).
- **Auto-tester baseline:** 85/85 green at session close. Includes
  `prompt-regression`, `truth-at-user-layer` (both with retry-on-flake
  for Haiku), `list-connections` (7), `hosted-replies` (5),
  `pending-dwell` (5), `data-integrity` (3).
- **No "tomorrow" framing.** Wael called out time-of-day pacing
  recommendations this session and they're explicitly banned by Rule 11.
  Recommend next steps by TECHNICAL scope, not by clock.
- **Wael's "Geofencing is very important for us"** quote — drives the
  manual-polling priority. Robert can't get a V57.x AAB until location
  alerts fire reliably.
- **Don't propose fixes based on hypothesis** (Rule 8). Wael explicitly
  called out trial-and-error this session — pull the data, prove the
  diagnosis, then code. Memory: `feedback_user_test_is_ground_truth.md`.

---

## Closing memory updates

- `feedback_always_recommend.md` — new, 2026-05-11. When listing numbered
  options, ALWAYS pair with `**Recommend #N** — one short reason`. Don't
  list options neutrally.
- `project_naavi_geofence_dwell_shipped.md` — SHIPPED 2026-05-11. Server-
  side dwell + 500 m radius. The Foreground Service portion is documented
  here but as of session close did NOT solve geofence reliability.
- `project_naavi_battery_opt_inapp_prompt.md` — SHIPPED V57.14.2 build 168.
  Modal works as designed.
- `project_naavi_voice_biometric_huggingface_pivot.md` — NEW 2026-05-11.
  Picovoice Eagle silent >1 week; Azure Speaker Recognition confirmed
  retired; Plan B is Hugging Face Inference API on
  `microsoft/wavlm-base-plus-sv`.

This handoff is canonical. See also `CLAUDE.md` for the persistent project
rules and full holding list.
