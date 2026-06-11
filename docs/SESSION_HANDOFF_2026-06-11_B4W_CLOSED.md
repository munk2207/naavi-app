# Session Handoff — 2026-06-11 (afternoon close)
## B4w Closed — Postal Code Search Fix Shipped

---

## What was accomplished this session

### B4w — CLOSED

**Bug:** Searching "K1C5M3" (no space) missed contacts stored as "K1C 5M3" (with space). Searching "K1C 5M3" (with space) found all 3. Both paths went through the same `postalInQuery` detection and `addressTokenMatch` logic — the contacts adapter itself was working correctly.

**Root cause found via diagnostic logging:**
- `[wael-score]` log confirmed: Wael's contact scored 1.125, limit=8 — he WAS entering the `hits` array in the contacts adapter.
- The drop happened in the **global anchor-term filter** in `supabase/functions/global-search/index.ts` (lines ~326–338).
- For no-space query, `anchorWords` contained `"k1c5m3"`. The filter checked `hay.includes("k1c5m3")` against Wael's snippet which contained `"k1c 5m3"` (with space) — no match → Wael filtered out.
- For with-space query, `anchorWords` had `"k1c"` and `"5m3"` as separate tokens — `hay.includes("k1c")` passed.

**Fix:** One line in `anchorMatch` — also check `hayNorm` (hay with spaces stripped) against space-stripped anchor words:
```javascript
const hayNorm = hay.replace(/\s+/g, '');
return anchorWords.some(a => hay.includes(a) || hayNorm.includes(a.replace(/\s+/g, '')));
```

**Files changed:**
- `supabase/functions/global-search/index.ts` — anchor filter fix
- `supabase/functions/global-search/adapters/contacts.ts` — diagnostic code removed
- `tests/catalogue/session-2026-06-11.ts` — regression test `b4w.anchor-filter-normalizes-spaces` added

**Tests:** 243/243 green. Committed `184c5ff`, pushed to main, deployed to Supabase.

**Holding list:** B4w moved to Closed Bugs in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`.

---

## Auto-tester status

243/243 passing. Last run: 2026-06-11 ~4:39 PM EST.

---

## Next session — work the holding list bugs in priority order

The holding list (`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`) has 7 open bugs. Work them in this order:

### 1. B6h — ⭐ TRUST BREACH — DELETE_RULE says "Done" but alert is not deleted
**Priority: CRITICAL — trust breach**
**Surface:** AAB + Server (prompt)
- Naavi confirmed "Done — deleted your Canadian Tire arrival alert" but the row was NOT deleted.
- Two fix pieces required:
  1. `hooks/useOrchestrator.ts` DELETE_RULE handler must verify deletion succeeded (check affected rows count) and surface an error if not.
  2. When DELETE_RULE matches multiple rules by name, Naavi must ask "Which one — Canadian Tire at 391...?" before confirming.
- Requires AAB build after fix.

### 2. B6a + B6g — Voice location alert parity (paired bugs)
**Surface:** Server (voice)
- B6a: Voice server does not re-arm expired location alerts (mobile half fixed in `318e522`).
- B6g: When caller picks from the location picker, the new rule lands without address/coordinates — geofence never arms.
- Both fixed by porting `reArmLocationRule` logic + `resolve-place` coordinate lookup into `naavi-voice-server/src/index.js` SET_ACTION_RULE handler.
- Server-only — no AAB required.

### 3. B7b — Voice bare-name transcription loss → hallucination
**Surface:** Server (voice)
- Deepgram drops leading verb ("find Fatma" → "Fatima."), intent detection falls through to Claude, which hallucinates a contact.
- Fix: bare-name intercept in voice server — single-token result matching a name pattern → route to phone-operator confirmation flow.
- Server-only.

### 4. B7a — Duplicate client_diagnostics log events
**Surface:** AAB (mobile)
- Every DB log event fires twice at the same millisecond.
- Likely two AppState listeners registered simultaneously.
- Requires AAB after fix.

### 5. B7c — Homepage storyboard iframes not running
**Surface:** website
- Homepage demo iframes not running (notes, brakes, granddaughter, doctor, insurance scenarios).
- Uninvestigated. Start by checking storyboard HTML paths in `mynaavi-website/`.
- Server-only.

### 6. B6i — Inconsistent confirm-before-act gate (large scope)
**Surface:** Both
- ~3-5 hour dedicated session. Do not start unless that's the full session scope.

---

## Pre-session checklist (mandatory)

1. `npm run test:auto` → must be 243/243 green before any code
2. Check `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` for any status updates
3. Start with B6h (highest severity, trust breach)
