# Session Handoff — 2026-05-27 — B6d/F2h/B4w/B4s/B6c — Build 204

## STATUS: BUILD 204 LIVE — APK INSTALLED ✅

---

## BUGS FIXED THIS SESSION

### B6d — Numbered choices in prompt (v98)
- Added `CHOICES MUST BE NUMBERED` rule to `get-naavi-prompt/index.ts`
- PROMPT_VERSION: `2026-05-27-v98-numbered-choices`
- Deployed to Supabase

### F2h — Contacts adapter missing addresses
- `supabase/functions/global-search/adapters/contacts.ts`
- Added `addresses` to personFields + readMask
- Added `PersonAddress` type, `addressTokenMatch` scoring (0.75), postal code normalization
- Addresses now appear in metadata

### B4w — Voice fabricated contact names on postal-code queries
- `naavi-voice-server/src/index.js`
- Pre-Claude bypass in `askClaude`: Canadian postal code detected → calls global-search contacts → honest-out if 0 results
- Zero LLM = zero fabrication
- Deployed to Railway (commit `032f8c9`)

### B4s — CLOSED (already ported)
- Code audit confirmed all 3 validation layers + alerts context already in voice server
- No code change needed

### B6c — Keyboard flicker (Android)
- `app/index.tsx`
- `behavior='height'` → `behavior='padding'`
- Added `minHeight: 44` to `inputFull` style

---

## BUILDS

| Build | Type | Status |
|-------|------|--------|
| 203 | APK (preview) | Superseded by 204 |
| 203 | AAB (production) | In Google Play — superseded by 204 |
| 204 | APK (preview) | ✅ https://expo.dev/accounts/waggan/projects/naavi/builds/6aad6b21-da8a-4061-9625-8e25a15502b3 |
| 204 | AAB (production) | ✅ Submitted to Google Play Internal Testing |

Wael confirmed: Settings shows **V57.27.0 (build 204)** ✅

---

## AUTO-TESTER

- 154/154 GREEN before initial builds (all 5 fixes + 10 new regression tests)
- **Rule 15 VIOLATION**: version string fix (203) and version bump (204) builds ran WITHOUT auto-tester first
- Next session: run `npm run test:auto` before any build, no exceptions

---

## REGRESSION TESTS ADDED

File: `tests/catalogue/session-2026-05-27.ts` (10 tests)
Registered in: `tests/runner.ts`

- B6d (3): prompt contains rule, version=v98, voice prompt parity
- F2h (4): personFields has addresses, readMask has addresses, addressTokenMatch + postalNorm, metadata includes postal_code
- B4s (1): voice server has _b4xBuildAlertsContext + 3-layer validation comment
- B4w (1): voice server has B4w BYPASS, POSTAL_RE, honest-out speech

---

## GOOGLE PLAY CLOSED TESTING — BLOCKED

Track: MyNaavi Closed Test Track
Blocker: Location permissions declaration requires YouTube video showing geofence feature in action
- App purpose text: filled ✅
- Location access text: filled ✅
- YouTube video: PENDING (Wael to record separately)
- Foreground Service declaration: Geofencing + Media playback checked, same YouTube URL ✅

Testers can use Internal Testing in the meantime (same build 204, instant access).

---

## CAPCUT DEMO VIDEO — IN PROGRESS

Workflow:
1. Screen recording from S23 ✅
2. Import to CapCut desktop ✅
3. Used Transcript to delete Wael's voice segments ✅
4. AI Avatar for question audio (video hidden via Scale=0%) — IN PROGRESS
5. Second question avatar still needs to be placed
6. Export pending

---

## VOICE SERVER

- B4w bypass deployed to Railway
- Wael to test live on +1 249 523 5394
- Test: ask "find contact with postal code K1A 0B1" — should get honest-out, not fabricated name

---

## OPEN ITEMS (unchanged from prior handoff)

See `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md` for full list.
Key: B4y Phase 2 (confirm-then-act universal gate) still queued (~3-5hr session).
