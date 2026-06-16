# Session Handoff — 2026-06-16 — Website Broken by Claude Agent

## STATUS: CRITICAL — mynaavi.com storyboard iframes broken

**The next session's first and only job: fix the storyboard iframes on mynaavi.com.**

---

## What was working before this session

- All 5 storyboard iframes loaded correctly on mynaavi.com
- Hero section had the audio listen-bar ("Hear the full thought / 30 seconds")
- Everything on the homepage was working

Last known-good commit: **`0207043`** ("Revert feat(hero): replace audio bar with YouTube video")

---

## What Claude did this session (the damage trail)

1. Added a YouTube Shorts embed to the hero section → storyboards broke (hero pushed them below lazy-load threshold)
2. Changed `loading="lazy"` → `loading="eager"` on storyboard iframes → didn't fix it
3. Went through 6+ more commits trying different video/CSS approaches
4. Removed YouTube video, restored audio bar
5. Reverted `loading="eager"` back to `loading="lazy"` — **this re-broke storyboards**
6. Did `git checkout 0207043 -- index.html` to "restore last known good" — but 0207043 has `loading="lazy"`, so **storyboards still broken**
7. Applied `loading="eager"` again (commit `c418f01`) — **storyboards STILL broken**

---

## Current state of mynaavi-website repo

**Repo:** `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website`
**Branch:** main
**Latest commit:** `c418f01`

- Hero: audio listen-bar is RESTORED ✅ (correct)
- Storyboard iframes: `loading="eager"` applied, still broken ❌
- The storyboard `.html` files themselves are unchanged and correct

---

## What the next session must investigate

`loading="eager"` was applied and the storyboards are STILL broken. This means the root cause is NOT the lazy-load threshold. The agent's diagnosis was wrong.

**Real suspects to investigate (DO NOT GUESS — read the code and evidence):**

1. **CSS collapsing the iframe container** — read `index.html` `.story-demo-wrap` and `.story-demo-frame` CSS carefully. Is `height`, `overflow`, or `display` hiding the content? Check on mobile vs desktop viewport.

2. **shared.js interference** — read `shared.js` fully. Does it do anything after DOM load that touches the storyboard containers or their parent sections?

3. **Vercel serving wrong content** — is Vercel caching a broken version? Try: `curl -I https://mynaavi.com/notes-demo-storyboard` to check response headers including `X-Frame-Options`.

4. **The storyboard HTML itself crashing** — open `https://mynaavi.com/notes-demo-storyboard` DIRECTLY in browser. Does it render? If yes, it's an iframe embedding issue. If no, it's the storyboard file or its CDN dependencies.

5. **unpkg.com CDN outage** — the storyboards load React + Babel + Tailwind from unpkg.com. If unpkg is having issues, ALL storyboards fail silently.

**The key diagnostic question:** Does `https://mynaavi.com/notes-demo-storyboard` load correctly when opened directly in a tab?

---

## Files to read

- `mynaavi-website/index.html` — the homepage, lines 200-240 (story-demo CSS), lines 375-535 (storyboard iframe HTML)
- `mynaavi-website/shared.js` — runs on every page
- `mynaavi-website/notes-demo-storyboard.html` — the storyboard content
- `mynaavi-website/vercel.json` — Vercel config (no CSP headers currently)

---

## What NOT to do

- Do NOT touch the hero section (audio bar is correct, leave it alone)
- Do NOT change the storyboard `.html` files (they are correct and unchanged)
- Do NOT touch any mobile app code (`hooks/`, `app/`, `supabase/`)
- Do NOT make another speculative fix without reading the actual evidence first

---

## Mobile app status (separate from website)

- Build 259 shipped and on Google Play Internal Testing ✅
- 316/316 auto-tests green ✅
- Firebase Test Lab passed ✅
- Calendar latency fix deployed (naavi-chat `fetchLiveCalendarEvents` gated by regex) ✅
- No mobile work needed this session — website only

---

## Session handoff doc location

`docs/SESSION_HANDOFF_2026-06-16_WEBSITE_BROKEN.md`
