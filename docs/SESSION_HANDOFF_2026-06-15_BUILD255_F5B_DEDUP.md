# Session Handoff — 2026-06-15 — Build 255 + F5b Knowledge Dedup

## What shipped this session

### Build 255 (AAB + APK)

All changes committed to `main`, pushed. Build 255 AAB kicked off with `--auto-submit` at end of session.

**APK (build 255 preview):** `dba1280d-1977-4424-8cfc-f41514b56ee8`
Firebase Test Lab: ✅ PASSED — Pixel 6 (Android 13) + Samsung Galaxy S22 (Android 14)

---

### Bugs fixed (voice server — Railway auto-deployed)

**B? — "list my alerts" returning 38 results instead of 6 active**

Two separate paths, both fixed:

1. **ARCH-1 classifier** (`naavi-voice-server/src/index.js` ~line 2240): Haiku was routing "list my alerts" → LIST_READ with `listName = "alerts"`. Fixed by adding explicit disambiguation:
   ```
   LIST_RULES = any request about alerts, rules, or notifications
   LIST_READ→listName (optional, never "alerts"/"rules"/"notifications")
   ```

2. **Full-Claude LIST_RULES path** (~line 10607): called `manage-rules op=list` which returns ALL rules including expired. Fixed by adding filter after fetch:
   ```javascript
   const rules = allRules.filter(r => r.enabled === true && !(r.one_shot && r.last_fired_at != null));
   ```

**B2m — UPDATE_MORNING_CALL not updating briefing time (voice + mobile)**

`timeToWindow("9:00")` returned `"night"` due to string comparison (`"9" > "1"`). Fixed by zero-padding before comparison:
```javascript
if (/^\d:\d\d$/.test(t)) t = '0' + t;
```
Applied to both `naavi-voice-server/src/index.js` and `hooks/useOrchestrator.ts`.

**B2m CLOSED** — both surfaces confirmed ✅ by Wael.

---

### Features shipped (mobile — in build 255)

**Alerts screen — expired alert shows "Delete alert" (hard delete)**

`app/alerts.tsx`: When alert is expired (`enabled === false`), the bottom button now reads "Delete alert" and calls `op=delete` (permanent removal). Active alerts still show "Disable alert" → `op=deactivate` (soft).

---

### Features shipped (server-side — no AAB needed)

**F5b — Self-cleansing memory / pgvector dedup in ingest-note**

Design chosen: Option 3 — similarity check at write time, update existing row if near-duplicate.

- **Migration** `supabase/migrations/20260615_knowledge_dedup.sql`: `CREATE OR REPLACE FUNCTION match_knowledge_for_dedup(p_user_id, p_embedding, p_limit)` — returns closest existing fragment by cosine distance. Already applied to production DB.
- **Edge Function** `supabase/functions/ingest-note/index.ts`: Before each INSERT, calls `match_knowledge_for_dedup` RPC. If `distance < 0.10` (cosine similarity > 0.90), UPDATEs existing row instead of inserting duplicate. Deployed.

This eliminates accumulation of STT variants like "Hussein" / "Houssain" / "Hoosein" that pgvector maps to the same embedding space.

**NATO phonetics note:** The voice server's phonetic disambiguation ("F as in Frank") changes the *final resolved text* before it hits `ingest-note` — so the dedup threshold of 0.10 still catches near-identical content even when the spelled-out name varies slightly.

---

### Parity audit

`docs/MOBILE_VS_VOICE_PARITY_AUDIT_2026-06-12.md` updated:
- Configure briefing time: ❌/⚠️ → ✅/✅ (B2m closed)
- B2m moved to Closed section
- F5c moved to Closed section (was already working via runtime fallback in `evaluate-rules`)

`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`:
- B2m moved to Closed Bugs
- F5c moved to Closed Features

---

### Tests

315/315 green (`npm run test:auto`).

New tests in `tests/catalogue/session-2026-06-15.ts`:
- `voice.list-rules.arch1-classifier-alerts-not-list-read`
- `voice.list-rules.full-claude-path-filters-enabled`
- `mobile.alerts.expired-shows-delete-not-disable`
- `morning-call.time-to-window-boundaries` (updated — unpadded "9:00" case)
- `voice.morning-call.brief-windows-patched` (updated)
- `f5b.ingest-note.dedup-calls-rpc-before-insert`
- `f5b.migration.match-knowledge-for-dedup-exists`

---

## What's pending for next session

### Immediate follow-up
- Verify build 255 AAB auto-submitted to Google Play Internal Testing (check Play Console)
- Install build 255 from Internal Testing and smoke-test: list alerts, update briefing time, delete expired alert

### Holding list items still open
See `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` for full list. Priority open items:

| # | Item | Surface | Notes |
|---|---|---|---|
| 3 | Maestro full-suite | Test | dadb driver times out on port 7001 on Windows |
| 4 | Geofence reliability | Mobile | Transistorsoft trial failed; options: retry, Radar, accept |
| 4a | Caller PIN | Voice | Design in memory; not started |
| 5 | Voice live-calendar fetch | Voice | Server-side |
| 7 | Voice stop-word interrupt regression | Voice | "Naavi stop" no longer interrupts TTS |
| 8 | Deepgram first-word truncation on barge-in | Voice | |
| 16 | `resolve-place` radius 100→500 + address routing | Server | |

### F5b follow-up (optional)
- Consider a user-visible "I already know that" reply when dedup fires (currently silent)
- Could surface `distance` in the response for observability

---

## Key file locations

| What | Where |
|---|---|
| Voice server | `naavi-voice-server/src/index.js` |
| Mobile orchestrator | `hooks/useOrchestrator.ts` |
| Alerts screen | `app/alerts.tsx` |
| ingest-note Edge Function | `supabase/functions/ingest-note/index.ts` |
| Dedup migration | `supabase/migrations/20260615_knowledge_dedup.sql` |
| Parity audit | `docs/MOBILE_VS_VOICE_PARITY_AUDIT_2026-06-12.md` |
| Holding list | `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` |
| Tests | `tests/catalogue/session-2026-06-15.ts` |
