# Session Handoff — 2026-07-14 — 12 bugs + 4 features closed, staging APK 307 live, next session priority: F17

## Next session priority (explicit, from Wael): F17 — voice self-override fix

Voice has no equivalent of F15 Defect A's self-override fix. Confirmed by direct code inspection (not inferred): `naavi-voice-server/src/anthropic_tools.js`'s `ACTION_CONFIG` (lines 88-104) has `additionalProperties: false` and declares no `self_override_*` fields at all — Claude is structurally prevented from emitting them on a phone call, not merely unlikely to. Grepped the entire `naavi-voice-server/src/index.js` (~11,000 lines) for `self_override` — zero matches. Predicted (not yet live-tested) behavior: "text me at [number] when I arrive at [address]" on a call puts the number in `to`, resolving as a third-party recipient instead of a self-alert with a channel override.

**Start with Phase 1 (Problem Definition) under full governance** — this touches Protected Core (voice orchestration, Action Rules) and voice has no staging/production split, so any fix ships straight to the only live voice environment. No shortcuts on process here. Full detail: holding list item F17, `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`.

Wael also confirmed: **F9a** (Google App Actions — "Hey Google, add milk to my Naavi list") needs the same full governance treatment (Protected Core: background scheduling) — explicitly deferred, not started, no Phase 1 written. Not next session's priority but flagged as real, wanted work.

---

## What shipped this session — 12 bugs + 4 features closed

### Server-only, no APK needed (promoted to staging, live now)

- **B9i-followup** — a self-override time-trigger alert needing a follow-up answer ("what should the message say?") could silently fail to save once the conversation had real history — clean "Done. Alert set." confirmation, zero row written. Root cause: the missing-body question embedded no `PENDING_INTENT` marker, so the follow-up reply was re-classified from scratch by Haiku using conversation history alone — reliable short-term, unreliable once real history built up (reproduced on demand by replaying the exact 3 turns with ~10 filler turns prepended: 0 rows written every time before the fix, correct row every time after). Fixed: the missing-body question now embeds a marker with `awaitingField:'body'` so Step 1.4 deterministically captures the reply. New shared helper `buildSelfOverrideTimeConfirm` used by both the initial branch and Step 1.4's resolver. **Verified live end-to-end by Wael** ("WhatsApp me at 3433332567 in 3 minutes" → "Goodmorning" → "Yes" → alert correctly appeared in Alerts → Time).
- **B9g** — phone-number-based self-override could misroute to an unrelated contact. Root cause: `lookup-contact`'s phonetic fallback treated a spaced phone-number query as a name search. Fixed by skipping the phonetic fallback entirely for phone-shaped queries. Verified end-to-end live.
- **B9f** — `evaluate-rules`'s `callVoice` never wrote to `sent_messages`, unlike `report-location-event`'s `callVoice`. Voice-call alerts had no audit trail despite real delivery. Fixed by copying the already-working insert pattern. Not live-fire tested (disproportionate cost for a logging-only fix) — verified via code match + auto-tester.

### Mobile — deployed across staging builds 305, 306, 307, all confirmed live-tested by Wael

- **B9c** (build 305) — "Your Lists" screen only fetched on mount; a disable done elsewhere left it stale until manual pull-to-refresh. Fixed via `useFocusEffect`. **Confirmed "Passed."**
- **B9u** (build 306/307, found live while testing B9c) — two bugs in the list-detail screen: (1) the enabled-list button read "Delete list" but actually triggered a reversible disable — mislabeled, inconsistent with Alerts' correct "Disable alert" wording. Fixed to say "Disable list." (2) Items vanished from view after disabling — the screen read items via `readList(name)`, which resolves through an enabled-only filter that can never find a disabled list, even though the Drive doc content was fully preserved. Fixed with new `lib/lists.ts` export `readListItemsByFileId()` that reads directly via `drive_file_id`, bypassing the enabled-only lookup. **Confirmed "Passed."**
- **B9v** (build 307) — the geofence setup card's Notifications "Fix" button produced no visible reaction at all — 3rd report of this exact symptom despite B9p (verified working build 304) and no code changes since. Added diagnostic tracing (`remoteLog`) at every step rather than guessing at another fix. Trace confirmed on build 307 (fresh install): a real system dialog appeared (~4s to resolve), Wael tapped Allow, status came back `granted` — the earlier failures were Android's one-time dialog budget being exhausted on the older installs; a fresh install reset it. **Diagnostic tracing kept in place per Wael's explicit decision** — low-cost, only fires when the Fix button is shown, gives instant visibility if a different device hits a variant of this in production.

### Features closed (reconciliation, no new code)

- **F12** — third-party recipient resolver. Confirmed its previously-"not yet committed" remaining scope (mobile/voice wiring to `resolve-recipient`, fire-time re-resolution with a self-notify fallback) was actually completed as part of F15's later work without the entry ever being closed. Verified present in `hooks/useOrchestrator.ts`, `naavi-voice-server/src/index.js` (2 call sites), `evaluate-rules/index.ts`.
- **F13** — og:image restoration. Closed as a deliberate pause (Wael's 2026-07-06 decision: "leave it as is"), not abandoned.
- **F15** — was already marked CLOSED in its own Status column but never moved out of the OPEN table. Pure filing fix.
- **F16** — architecture doc, written this session (see below), closed with the doc as its deliverable.

### New: architecture doc (F16's deliverable)

`docs/ARCHITECTURE_NAAVI_CHAT_ACTION_SYSTEMS.md` — maps `naavi-chat`'s two action-generation systems: **Layer 2** (a small, stateless Haiku classifier that sees only the current message, no history, no tools) vs **Path B** (full Claude tool-use with conversation history). Documents the shared `PENDING_INTENT` executor ("Step 1.4") both rely on, the Self-Override Behavioral Contract between `report-location-event` and `evaluate-rules`, and the confirmed gap that recipient resolution is unified via `resolve-recipient` for location alerts but NOT for time-trigger third-party alerts (3 separate `lookup-contact` call sites, found while root-causing this session's other fixes). Referenced prominently in CLAUDE.md's "Where to start" section so it doesn't get buried — Wael explicitly asked for this to be highlighted.

---

## Housekeeping this session

- Deleted 16 old diagnostic scripts in `scripts/` that had **Supabase service-role keys hardcoded directly in them** — real credential exposure risk, found while preparing to commit a backlog of uncommitted files. Not committed to git history at any point (they were untracked).
- Compacted `MEMORY.md` (the auto-memory index) from 20.1KB to 16.6KB after a size warning — moved detailed narrative into topic files, trimmed stale/superseded doc pointers, kept everything load-bearing.
- Reconciled the entire holding list: 12 bugs and 4 features moved from open to closed with condensed, accurate entries; 2 new small items logged (B9s — minor B9g leftovers, low priority; F18 — international phone number support, spun from B9h).

---

## Staging builds this session

- **305** — B9c only.
- **306** — B9u (found live while testing 305).
- **307** — B9v diagnostic tracing (kept in place; confirmed the Notifications Fix button genuinely works).

All three synced through the standard flow (commit → push → `naavi-mobile` clone merge → version bump → `eas build --profile staging`). Version now at V57.80.0 (build 307). **Nothing promoted to production this session** — all work is staging-only per the staging-first rule; production AAB promotion was not discussed or started.

---

## Still open on the holding list — 5 items, none have fixes ready

| ID | What | Why it's still open |
|---|---|---|
| B9a | Naavi silently defaults a channel (email/SMS) instead of asking when ambiguous | Confirmed by Wael as a real project, not a quick fix — no Phase 1 written |
| B9b | Asking for a phone number specifically sometimes returns the email instead | Not yet scoped |
| B9d | Intermittent screen-freeze (bad safe-area insets), historically fixed by force-stopping the app | No known trigger identified — can't fix without more data; diagnostic logging already in place from a prior session, waiting for it to recur |
| B9s | Two minor leftover data-quality items from B9g's now-closed contamination bug (stray inert `to_phone` field, an old unused Layer-2 handler) | Not user-facing, low priority |
| B9m | A saved contact's own text can genuinely collide with an unrelated name search; Google's own People API search cache is inconsistent across identical calls | Root cause is Google's own API, not something fully fixable on our side — one call site partially mitigated (B9r, closed this session) |

Full detail on all five in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`.

---

## Governance note

Tonight's fixes (B9i-followup, B9g, B9f, B9c, B9u, B9v) were live incident response and bug fixes found during device testing, not planned feature work — no formal Phase 1-8 Release Gate Workflow was run against any of them, consistent with how bug fixes have been handled all session. This is appropriate for narrow, well-evidenced, live-verified bug fixes. **F17 and F9a are different** — both explicitly flagged by Wael as needing the full governance process (Protected Core touches: voice orchestration / Action Rules for F17, background scheduling for F9a) before any code is written.

## Everything currently on staging only — nothing in production touched

No production Supabase deploy, no AAB build this session. All Edge Function deploys (`naavi-chat`, `evaluate-rules`) and all APK builds (305, 306, 307) were staging-only (`xugvnfudofuskxoknhve`).

## State at handoff

- Holding list is fully reconciled and current as of this session — no stale entries known.
- `MEMORY.md` is compacted and current.
- Auto-tester: 412 tests, 0 failed, 2 pre-existing unrelated errors (`voice.calendar-today-query`, `f10a.website-nav-feedback-link-homepage-only` — neither touched this session), 2 skipped (Google OAuth not connected for the auto-tester's own test account — separate from any user-facing functionality).
- B9v's diagnostic tracing is intentionally left in the codebase (Wael's explicit decision) — not a cleanup item for a future session.
- Next session starts clean on F17 Phase 1 — no unresolved threads carried over from tonight.
