# Session Handoff — 2026-06-11 — Build 244 Shipped

## Status: CLEAN ✅
Build 244 shipped to Google Play Internal Testing. Installed and tested by Wael. All passed.

---

## What Shipped in This Session

### Build 244 (versionCode 244, V57.49.4)
- **Crash fix:** removed `expo-splash-screen ^56.0.10` — was SDK56 in an SDK55 app, crashed on every startup
- **Icon fix:** teal brain on transparent background (black via `backgroundColor: #0D0D0D`), 700px brain on 1024px canvas, 162px padding each side. Previous icon was reversed (teal bg + black brain).
- **B6h fix:** delete-alert intent intercepted before Claude, confirm-then-act pattern enforced
- **Root cause of 8 build failures:** `@expo/config` version regression (55.0.12 → 55.0.17) introduced `.js` stripping in `convertEntryPointToRelative` — Metro received `index` instead of `index.js` → `createReleaseUpdatesResources` failed. **Fix:** yarn resolutions pin `@expo/config` to `55.0.12` in `package.json`. This is permanent — do not remove.

### Cleanup
- **8 dead Edge Functions deleted** from Supabase + repo: `store-epic-token`, `sync-epic-data`, `exchange-epic-code`, `tsoft-geofence-webhook`, `poll-conversation`, `upload-conversation`, `get-realtime-token`, `extract-actions` (1,050 lines removed)

### CLAUDE.md Updates
- **Rule A:** Pre-diagnosis checklist before any build fix (exact file + line + literal error required)
- **Rule B:** 2-hypothesis cap — stop and reframe after 2 failed attempts, no third attempt without Wael acknowledgement
- **`.claude/settings.json`** created with auto-allow rules for `curl`, `git`, `npx eas`, `npm run test:auto`, Firebase script — fewer permission prompts going forward

---

## Current State

| Item | State |
|------|-------|
| Build 244 | ✅ Live on Google Play Internal Testing |
| Auto-tester | ✅ 238/238 green |
| Firebase Test Lab | ✅ Passed (matrix-3av9rlej77pvk) |
| Edge Functions | 44 active (8 dead ones deleted) |
| yarn resolutions | `@expo/config` pinned to `55.0.12` — permanent fix |

---

## Focus for Next Session: Review the Holding List

**Canonical source:** `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md`

Go through each open item and decide: ship, defer, or close. Priority order suggested:

**Server-side queue (no AAB needed — ship fast):**
- Item 5: Voice live-calendar fetch
- Item 6: Voice action parity (DELETE_EVENT, LIST_RULES, DELETE_MEMORY, SCHEDULE_MEDICATION)
- Item 7: Voice stop-word interrupt regression ("Naavi stop" no longer interrupts TTS)
- Item 8: Voice Deepgram first-word truncation on barge-in
- Item 9: Voice name-search phonetic fallback
- Item 13: LIST_RULES synthesize-action backstop
- Item 16: `resolve-place` radius 100→500 + address-vs-business routing fix

**AAB-required queue:**
- Item 18d: `isValidE164` strict 10-digit-after-+1 enforcement
- Item 20: Demo line maturity

**Blocked on external:**
- Item 2: AWS Polly voice unification (needs AWS account)
- Item 3: Maestro full-suite (Windows/dadb driver timeout blocker)
- Item 4: Geofence reliability — Transistorsoft trial failed, decision pending

**Deferred by design (open questions):**
- Item 28: `list_change` trigger (7 design questions open)
- Item 29: Health trigger (Epic integration required)

---

## Cost / Session Notes (new learnings this session)

- **Start fresh sessions per task** — one task per session is cheaper than multi-task marathon sessions
- **75% context window** = signal to finish current task and start fresh for the next one
- **The $381 usage credit** is the prepaid Anthropic balance — ~90% is development (Claude Code sessions), ~10% is Naavi production API for 2 users
- **Every failed build costs real money** — Rule A + Rule B in CLAUDE.md are the guard against repeat of today's 8-build spiral
