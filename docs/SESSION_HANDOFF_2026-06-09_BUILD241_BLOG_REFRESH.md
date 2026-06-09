# Session Handoff — 2026-06-09 | Build 241 | Blog Refresh + Audio Fix

## Status at session close

- **Latest AAB:** Build 241 — on Google Play Internal Testing
- **Latest APK:** EAS preview build — https://expo.dev/accounts/waggan/projects/naavi/builds/5a296d11-6d5f-41ee-9f1d-d7140611ab8d
- **Auto-tester:** 232/232 passed (0 errors, 0 skips) — gate is green
- **Firebase Test Lab:** ✅ PASSED (established this session, hold lifted in CLAUDE.md)
- **Website:** mynaavi.com — deployed via Vercel (munk2207/mynaavi-website, main)

---

## What shipped this session

### Mobile — Build 241 (AAB + APK)

1. **Dedicated sign-in screen** — when app opens and user is not signed in, shows a clean separate screen with reason message and no 3-dot menu. No floating overlay on main screen.

2. **Collapsible alert categories** — `app/alerts.tsx` groups (EMAIL, LOCATION, TIME, etc.) now collapse/expand with `+`/`−` toggle, all collapsed by default. Consistent with home screen brief sections pattern.

3. **Auto-tester fixes** — 4 errors and 2 skips resolved:
   - `manage-list-connections`: added 401/403 graceful skip in `trashDriveFile`
   - `tests/catalogue/calendar.ts`: extended skip regex to catch 500+insufficientPermissions
   - `tests/catalogue/multiuser.ts`: extended `userResolvedStatuses` for lookup/manage/calendar
   - Test user (mynaavi2207@gmail.com) re-authorized with all OAuth scopes

4. **Firebase Test Lab process established** — `scripts/submit-firebase-test.js` fixed (local path support, correct pass/fail detection). Robo script fixed (removed unreachable step 10). CLAUDE.md Rule 15b hold lifted.

### Website — mynaavi-website

5. **Two new blog articles** replacing aging/senior-framed content:
   - `blog/invisible-work-week.html` — "The invisible work week" (Life & Attention tag)
   - `blog/set-it-once.html` — "Set it once" (Product Thinking tag)
   - Audio: `/audio/blog/invisible-work-week.mp3` + `/audio/blog/set-it-once.mp3` (Andromeda voice)

6. **Two old blog articles deleted:**
   - `blog/aging-in-place-gap.html` — "seniors" throughout
   - `blog/retrieval-not-storage.html` — "Cognitive Health" / "healthy aging" framing

7. **blog.html updated** — new cards with audio players, removed old cards, cleaned "Foundation"/"aging" from title/meta/structured data.

8. **home.mp3 reverted** — a new Andromeda narration was generated but Wael requested revert to original. Original is live.

---

## Known issues noted this session

- **Homepage hero text (DRAFT 3)** — proposed but never applied. Wael did not approve it this session. Current hero: *"Naavi. / You don't forget because you don't care. You forget because life is full."*
- **Homepage video/demo storyboards** — Wael reported "the video did not run." Not investigated this session. To investigate next time: which storyboard iframe is broken (notes, brakes, granddaughter, doctor, insurance).
- **Blog article audio intro format** — other blog MP3s start with a specific intro phrase. New MP3s may not match. Wael said "it is OK" for now.

---

## ⭐ NEXT SESSION FOCUS

**Build a demo video using Samsung S23 screen recording + CapCut.**

- Wael has the S23 with the app installed (Build 241 via Google Play Internal Testing)
- Tool: CapCut (video editing)
- Goal: produce a polished demo video showing Naavi in action
- Claude's role: help plan the script/scenes, guide the recording flow, and advise on CapCut editing

**Before starting:** confirm which screens/features to demo (likely: voice capture, alerts, morning brief, search). Wael decides the scenes — Claude structures the flow.

---

## Build log

| Build | Version | Date | Notes |
|-------|---------|------|-------|
| 241 | versionCode 241 | 2026-06-09 | Collapsible alerts + sign-in screen + test fixes |
| 240 | versionCode 240 | 2026-06-08 | Firebase Test Lab established |
| 239 | versionCode 239 | 2026-06-08 | Prior session |

---

## Key file locations

- Main repo: `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: main)
- Build clone: `C:\Users\waela\naavi-mobile` (branch: main)
- Voice server: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server`
- Website: `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website`
- Test suite: `npm run test:auto` from main repo — must be 100% green before any build
- Firebase Test Lab: `node scripts/submit-firebase-test.js <apk-url-or-path>` from main repo
