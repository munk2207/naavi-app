# Session Handoff — 2026-06-20 — V276 + Staging Fixes

## ⭐ NEXT SESSION PRIORITY — Test staging APK (compound question) + V276 production

---

## What Was Done This Session

### 1. Staging Environment — FULLY OPERATIONAL
- 67 migrations pushed to staging Supabase (`xugvnfudofuskxoknhve`)
- 69 Edge Functions deployed to staging
- All secrets configured (Anthropic, Deepgram, Google OAuth, Maps)
- Google OAuth fixed: added `naavi://auth/callback` to staging Supabase redirect URLs
- PKCE flow fixed in `app/_layout.tsx` — `exchangeCodeForSession(code)` now handles newer Supabase projects
- Staging APK sign-in: **WORKING** (mynaavidemo@gmail.com confirmed in staging users table)

### 2. V275 Production AAB — SUBMITTED
- Fixes: EMAIL SENT card collapses to one line, email subject fallback in display
- Submitted to Google Play Internal Testing
- Test results on V275: Bob ✓, Work list ✓, James kids ✓ | Sarah email subject ✗, Jasmine ✗

### 3. V276 Production AAB — SUBMITTED TO GOOGLE PLAY
- Fix: email subject display in draft card (was showing full body text, now derives short subject)
- versionCode 276, version "V57.61.0"
- **Install V276 from Google Play Internal Testing before testing**

### 4. Fixes Deployed to Both Staging + Production Edge Functions

| Fix | File | Status |
|-----|------|--------|
| Email subject mandatory in tool schema | `_shared/anthropic_tools.ts` | ✅ Deployed |
| Email subject server-side derivation from user message | `naavi-chat/index.ts` | ✅ Deployed |
| Jasmine before-event: reads `createdAt` field from calendar adapter | `naavi-chat/index.ts` | ✅ Deployed |
| Jasmine prompt: WRONG/RIGHT example | `get-naavi-prompt/index.ts` | ✅ Deployed |

### 5. Compound Question (Staging Only)
- Path B fix deployed to staging APK
- `[COMPOUND-ITEM N of M]` tags sent one at a time after user says yes
- **NOT in production** — needs more work before production
- Known issues with compound: asks questions for items missing info (email body), bundles all questions instead of one at a time

---

## Next Session Test Plan

### Priority 1 — Test V276 on production (install from Google Play)
Same test cases as V275:
1. "Send Sarah an email asking for her review for the budget" → subject should be "Review Budget" or similar (NOT body text, NOT empty)
2. "Book a meeting with Bob this next Monday at 11 AM" → should pass
3. "Remind me to call Jasmine one day before her graduation" → should go straight to Jun 22 confirmation (no raw search dump)
4. "Send me my work list when I arrive to my office" → should pass
5. "Remind James kids" flow → should pass

### Priority 2 — Continue staging compound question testing
- Test with fully-specified items (no missing info)
- Fix: compound asks all questions at once instead of one at a time
- Fix: Naavi asks for info the user already gave in the same message

---

## Pending Bugs (Not Yet Fixed)

| Bug | Notes |
|-----|-------|
| Compound: asks all questions at once | Needs orchestrator rework — staging only |
| Compound: ignores info already in user message | Prompt issue — staging only |
| Jasmine — still need to verify fix works | Fixed in code but not yet verified |
| Email subject — still need to verify server-side derivation | Fixed in code but not yet verified |

---

## Build State

| Build | Version | Status |
|-------|---------|--------|
| Production AAB | V276 (276) | In Google Play Internal Testing — install to test |
| Staging APK | Latest (PKCE fix + compound) | Install link: expo.dev/accounts/waggan/projects/naavi/builds/8a567726 |

---

## Key Files Changed This Session

- `app/_layout.tsx` — PKCE OAuth callback (`exchangeCodeForSession`)
- `app/index.tsx` — EMAIL SENT card collapse + email subject display fallback
- `app.json` — versionCode 276
- `app/settings.tsx` — version string V57.61.0 build 276
- `app.config.js` — staging app name "Naavi Staging"
- `eas.json` — staging build profile
- `hooks/useOrchestrator.ts` — Path B compound fix
- `supabase/functions/naavi-chat/index.ts` — Jasmine before-event date field fix + email subject server-side derivation
- `supabase/functions/get-naavi-prompt/index.ts` — Jasmine WRONG/RIGHT example + email subject mandatory rule
- `supabase/functions/_shared/anthropic_tools.ts` — subject required in draft_message schema
- Multiple new migration files for staging schema

---

## CLAUDE.md Updated
STAGING-FIRST rule added at top of CLAUDE.md — all dev goes to staging (`xugvnfudofuskxoknhve`) first.
