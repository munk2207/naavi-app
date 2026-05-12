# Session Handoff — 2026-05-12 → V57.14.4 build 170 + F1a Wave 1 shipped

**Status at session close:** V57.14.4 build 170 on Wael's phone (V57.14.3 build 169 on second phone). F1a Wave 1 (voice surface end-to-end) shipped + verified on real call. Geofence reliability hypothesis from prior session **disproven** — manual polling on FG service won't work because the FG service itself dies. Awaiting vendor replies from Transistorsoft + Radar before next geofence move. Auto-tester 91/91 green.

**Top of NEXT session — priority order:**

1. **F1a Wave 2 (V57.15.0 AAB)** — ⭐ now the unblocked top priority. Mobile orchestrator handlers + Lists screen in 3-dots menu + list-detail screen + alert-detail connection card + drop legacy `action_config.tasks/list_name` columns. Plan locked at end of this session — see "F1a Wave 2 plan" below.
2. **Geofence reliability** — BLOCKED on vendor replies. Email sent to both Transistorsoft (`info@transistorsoft.com`) requesting trial key + refund policy + Samsung handling specifics; and Radar sales (`sales@radar.com` or get-a-quote form) asking same Samsung One UI question + pricing for low-MTU tier + trial. **Do not start integration on either until reply is in hand.**
3. **F1a entityType bug (CLAUDE.md item 16a)** — Claude inconsistently emits `entityType` on `list_connect` calls; voice server rejects silently when omitted. Server-side fix; revisit after Wave 2 lands so we can validate fix on both surfaces simultaneously.
4. **F1d live tests 3 + 4** — unchanged from prior handoff.

---

## Three big things shipped today

### 1. Geofence diagnostic — root cause confirmed (FG service is dead infrastructure)

**V57.14.4 build 170** added a heartbeat log to the no-op foreground-location-service task handler in `hooks/useGeofencing.ts`. Mirrored to Supabase `client_diagnostics.step='voice-claude-diag'` for queryability.

**Test result on Wael's Samsung phone:** zero `fg-location-tick` events delivered to the FG task across the entire test window, despite the FG service "starting" 5 times (notification visible). On one observed background restart attempt, the API call failed with the exact Android 12+ error:

> *"Call to function 'ExpoLocation.startLocationUpdatesAsync' has been rejected. → Caused by: Couldn't start the foreground service. Foreground service cannot be started when the application is in the background."*

**Implication:** the prior session's plan to "switch to manual location polling on the FG service" cannot work because the FG service itself dies after backgrounding and cannot be restarted from background. Need a fundamentally different mechanism. Two vendor candidates evaluated:

- **Transistorsoft `react-native-background-geolocation`** (perpetual license, $399 STARTER tier). Industry-standard for Samsung kill-recovery, used by Strava/Life360. Email drafted + sent requesting trial key + refund policy + Samsung specifics.
- **Radar.com** (SaaS, "custom pricing"). Used by Lyft/DoorDash. Email drafted + sent asking Samsung handling specifics + pricing transparency.

**Decision parked:** wait for both vendor replies before integration. Whichever answers the Samsung One UI question with technical specifics (vs hand-waves) wins.

Memory update: `project_naavi_geofence_reliability_open.md` should reflect that the manual-polling plan is dead and the path forward is third-party SDK.

### 2. F1a Session 2 Wave 1 — voice surface end-to-end

Built the server foundation that lets voice users **connect / disconnect / query / delete** lists wired to entities (alerts, calendar events, etc.). Mobile UI is Wave 2 (next session).

**Files added (naavi-app):**
- `supabase/functions/resolve-entity-ref/index.ts` (300+ lines) — shared Edge Function. RESOLVE: text → ranked matches; DESCRIBE: id → label. V1 adapters: `action_rule`, `list`, `gmail_message`. Stops gracefully on unsupported types (`calendar_event`, `contact`, `reminder`, `document`, `sent_message`, `knowledge_fragment`) — return empty matches with `unsupported_in_v1: true` so callers degrade.
- 6 new prompt-regression tests in `tests/catalogue/prompt-regression.ts` covering all 4 F1a action emissions + disambiguation + the spec-correct WAIT-for-yes behavior.

**Files added (naavi-voice-server):**
- 4 new `executeAction` cases (`LIST_CONNECT`, `LIST_DISCONNECT`, `LIST_CONNECTION_QUERY`, `LIST_DELETE`) — each calls `resolve-entity-ref` then `manage-list-connections`. Helper `_f1aPickMatch` interprets ranked matches and returns single-winner / ambiguous / not-found.
- 4 missing tool definitions added to `src/anthropic_tools.js` mirroring the shared `_shared/anthropic_tools.ts` (was the cause of an early failure mode where Claude saw the prompt rule but had no tool to call).
- `_f1aFormatConnectionQuery` helper — turns query results into spoken sentences (`"Your X list is attached to Y."`) so query mode actually speaks something instead of hitting the generic "Done." default.
- `ACTION_DEFAULT_SPEECH` map — short canonical confirmations for every action type when Claude emits a tool without text. Prevents the line-2242 fallback from firing on successful actions.

**Resolver behavior tightened across iterations:**
- Plural/singular stemming so "groceries" matches "grocery" (and vice versa)
- Stopword filter so "Movati alert" doesn't match every single rule that has "Alert" in its label
- Exact match strictly beats stem match (1.0 vs 0.9) so dual lists like grocery + groceries each resolve to their own row without ambiguity

**Vocab change:** "Connected/Disconnected" → "Attached/Detached" across prompt v68 → v69 + voice server defaults. More natural for the target user (visualize attaching a sticky note vs technical "connect").

**Verified end-to-end on real Twilio call:** cottage list created via voice → attached to office (688 Bayview) rule → DB row appears in `list_connections` with the right (`list_id`, `entity_type='action_rule'`, `entity_id=88f08d9e...`) tuple. Cascade-on-replace verified earlier in session (cottage→Costco replaced grocery→Costco automatically).

**One gap remaining (item 16a):** Claude inconsistently emits `entityType` on `list_connect`. Two of four observed attempts during the cottage test omitted it, leading to silent server rejection. Filed in CLAUDE.md holding list as 16a. Fix combo (prompt v70 + server fallback to action_rule when missing) deferred to a future server-only session — easier to verify after Wave 2 mobile lands so the fix validates on both surfaces simultaneously.

### 3. CLAUDE.md holding list updated

- Item 16a added (F1a entityType inconsistency, server-side, needs-more-tests)
- "Top of next session" priority order rewritten — F1a Wave 2 is now #1, geofence dropped to #2 (blocked on vendor)

---

## Today's commits (chronological)

| Commit | Repo | What |
|---|---|---|
| `88e669b` | naavi-app | V57.14.4 build 170 — FG service heartbeat log |
| `d49be81` | naavi-app | F1a resolve-entity-ref + 6 prompt-regression tests |
| `8f5b083` | voice-server | F1a 4 executeAction handlers + helpers |
| `84b1894` | voice-server | F1a follow-up: 4 missing tool definitions in anthropic_tools.js |
| `b62d4fe` | voice-server | Diag: log raw Claude stream contents on every turn |
| `603e872` | voice-server | Diag: mirror Claude diag to client_diagnostics for queryability |
| `6bdc2f6` | naavi-app | Resolver plural stemming + stopword filter |
| `c52e948` | naavi-app | Resolver exact > stem scoring (no more grocery↔groceries tie) |
| `6d78a0e` | voice-server | Speech-default for actions + top-score-tied resolution helper |
| `9cb2fb1` | voice-server | Speak LIST_CONNECTION_QUERY result aloud |
| `5212676` | naavi-app | Prompt v69 "attached/detached" vocab + 2 test updates for spec-correct WAIT |
| `4c4a507` | voice-server | "Attached/Detached" vocab in voice server defaults |

**1 AAB shipped:** V57.14.4 build 170 (commit `88e669b`), Google Play Internal Testing.

---

## F1a Wave 2 plan (next session — locked)

### Phase A — Mobile orchestrator wiring (~30 min)
Add 4 handlers to `hooks/useOrchestrator.ts::commitPending`:
- `LIST_CONNECT`, `LIST_DISCONNECT`, `LIST_CONNECTION_QUERY`, `LIST_DELETE`
- Each mirrors the voice-server logic: call `resolve-entity-ref` Edge Function → handle single/multi/none → call `manage-list-connections`
- Mobile UX is simpler than voice — chat shows disambiguation/confirmation as text bubbles, no TTS gymnastics
- Reuse the `_f1aFormatConnectionQuery` logic for query results (port the JS helper to TS)

### Phase B — New Lists screen (~60-90 min)
- New `app/lists.tsx` with subcategory tabs: **All / Connected / Standalone** (per `docs/F1A_LISTS_AND_CONNECTIONS_SPEC.md`)
- New `app/lists/[id].tsx` list-detail with "Attached to:" header (each tap-navigates to entity) + existing item-edit affordances
- 3-dots menu: insert **Lists** entry between Alerts and Notes (per spec)

### Phase C — Alert-detail connection card (~30 min)
- Update alert-detail rendering — when an `action_rule` has a list attached, show a row: *"List: errands (5 items)"* with chevron-to-list-detail + small **X** to detach
- Tap X → confirmation modal → calls `LIST_DISCONNECT`

### Phase D — Migration + AAB V57.15.0 (~45 min total)
- One-shot migration: drop `action_config.tasks` + `action_config.list_name` columns. Per data check yesterday: **0 legacy rows using these**, so data migration is a no-op; just the schema clean-up.
- Bump `versionCode` 170 → 171, version text V57.14.4 → V57.15.0
- Run `test:auto` (must stay 91/91 green per Rule 15)
- `git -C "C:\Users\waela\OneDrive\Desktop\Naavi" push origin main`
- Sync `naavi-mobile` clone, `npx eas build --platform android --profile production --auto-submit`

**Recommend doing Phases A+B+C as one continuous push, then Phase D ships them all in one AAB.** Splitting into separate AABs is wasted cycles since Phase A alone has no user-visible surface.

---

## Open items at session close

### Awaiting external reply
- **Transistorsoft trial key + refund policy + Samsung specifics** — email sent
- **Radar Samsung One UI handling + pricing for low MTU tier + trial** — email sent

### Server-side queue (no AAB)
- Item 16a — F1a entityType inconsistency on `list_connect` (prompt v70 + voice server fallback)
- Plus all prior items in the queue (5–16) unchanged

### Drive cleanup (deferred)
At session close, **8 orphaned Google Docs** remain in `MyNaavi/Lists/` from today's testing churn (their corresponding `lists` rows were deleted as part of the "clean everything" reset before the final cottage test). They're harmless visual clutter; can be manually trashed from Drive UI, or deleted via Drive API in a follow-up if desired.

Orphaned `drive_file_id` list (was-name in parens):
- `1Vvw21fn34btQrFpgwlPEI3vNpm7mIzGtMV8np0265G0` (Costco)
- `1YXXkU5MQMhW2kxVAgfvmDcHPSSTcIdMeWc1uKHZnWLo` (package)
- `1w51L3VgK2336fquNnryCTYCQcX2oJJKIIKUWGvpm7Jc` (my list)
- `1WSsOJBRblOsdv5wxJ8CHl9yIk2IigYnuruTbUUzpHhQ` (cottage)
- `1H2Z8reTipIqsElrDqFDHLebRJCfmBLOCtHBKSevyBWA` (Shopping)
- `1ZK2sZ01HslCQFzSADRHQkeJA3qZyZTuGFrNh5YP0S0Y` (grocery)
- `1-qbtizfoigWhEeXbnnjL6lHvshV5k2ZMyU3itpoaebU` (error)
- `1xFRZCAa_KgtY6tlG1umc2yQUgGAoOIGUekTi0VDaPLc` (groceries)

### Diagnostic logging — leave or remove?
Voice server has temporary `[Claude DIAG]` logging (commits `b62d4fe` + `603e872`) that mirrors every turn's raw Claude response to `client_diagnostics.step='voice-claude-diag'`. Useful while voice F1a is shaking out. Recommend leaving in place through Wave 2 ship + 1-2 days of real use, then clean up in a server-only commit once stable.

---

## Key context for the next agent

- **Latest AAB:** V57.14.4 build 170 (commit `88e669b`), installed Wael's phone 2026-05-12. Second phone has V57.14.3 build 169.
- **Last shipped prompt version:** `2026-05-12-v69-attached-detached-vocab`.
- **Auto-tester baseline:** 91/91 green at session close. Includes 6 new F1a prompt-regression tests.
- **DB state for Wael's account at session close:** 1 list ("cottage", category=personal, drive doc created), 1 connection (cottage → Alert when arriving at office). Clean baseline for Wave 2 testing.
- **F1a voice user-experience caveats** (none breaks the data path; all worth polishing but not blocking Wave 2):
  - Claude inconsistently emits `entityType` on `list_connect` (item 16a)
  - Auto-fire vs spec's wait-for-yes — was actually working correctly post-v69 deploy; prior tests had been written to lock in old behavior, those tests now updated
  - Deepgram STT mistranscription on multi-clause sentences ("Add milk and eggs to my groceries list" → "Grocery. List.") — not F1a-specific
- **Don't propose dev builds for testing.** Per `feedback_no_dev_build_setup.md`. Production AAB cycle only.
- **Don't propose pacing recommendations based on time.** Per Rule 11 + `feedback_no_time_assumptions.md`.

---

## Closing memory updates suggested for next session

- `project_naavi_geofence_reliability_open.md` — update to reflect "manual polling plan abandoned; vendor research underway; Transistorsoft + Radar emails sent"
- New memory: `project_naavi_f1a_wave_1_shipped.md` — capture the Wave 1 architecture (resolve-entity-ref + manage-list-connections + voice surface complete; mobile pending Wave 2)
- New memory: `project_naavi_vendor_evaluation_geofence.md` — capture the Transistorsoft vs Radar evaluation criteria, their respective pricing models, the email questions sent

---

This handoff is canonical. See also `CLAUDE.md` for the persistent project rules and full holding list.
