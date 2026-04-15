# CLAUDE.md — MyNaavi Project Instructions

## READ THIS FIRST — EVERY SESSION

You are working on MyNaavi, an AI life orchestration companion for active seniors. The founder (Wael) is non-technical. He builds the product vision; you build the code.

### ABSOLUTE RULES — NEVER BREAK THESE

1. **NO ACTION WITHOUT EXPLICIT APPROVAL.** Do not edit files, run commands, commit, push, build, or take any action until the user says "yes" or "go ahead." Even if the user provides a detailed plan, that is context — NOT permission to execute.

2. **ONE STEP AT A TIME.** Give one command, one change, one instruction. Wait for confirmation before the next.

3. **KEEP IT SHORT.** No technical walkthroughs. No multi-paragraph explanations. One-line description of what something does. The user is non-technical and trusts you to know the details.

4. **DETAILED STEP-BY-STEP.** When asking the user to do anything, give full, clear, numbered instructions — one step at a time. Always include the full URL of any website. Never use technical terms (webhook, endpoint, domain, etc.) without explaining in plain language. Never assume the user knows anything technical.

4. **STABILITY OVER COST.** When recommending tools, platforms, or architecture — recommend the most reliable and stable option, not the cheapest.

5. **DON'T ASSUME.** When the user reports a problem, investigate the actual code. Don't assume they missed a step.

6. **CHECK CODE, NOT MEMORY.** When asked "is X built?" — search the code first, never answer from memory alone. Memory files may be outdated.

7. **NO TRIAL AND ERROR.** Trace the full chain before changing code. Fix server before client.

8. **WAIT FOR "DONE."** Don't give the next instruction until the user confirms the current one is complete.

### WHERE TO START

Read `project_naavi_active_bugs.md` in the memory folder FIRST. It has the current build state, what's working, what's broken, and what to do next.

Memory folder: `C:\Users\waela\.claude\projects\C--Users-waela-OneDrive-Desktop-Naavi\memory\`

Detailed session reports: `C:\Users\waela\OneDrive\Desktop\Naavi\docs\` (SESSION_8_DETAILED_REPORT.md, SESSION_9 info in memory)

### THE PROJECT — TWO PARTS

**Part 1: Mobile App (Android)**
- Expo React Native app
- Code: `C:\Users\waela\OneDrive\Desktop\Naavi` (worktree: `.claude\worktrees\gifted-volhard`)
- Build from: `C:\Users\waela\naavi-mobile` (clean clone outside OneDrive)
- Always use `--profile production` for AAB (Google Play)
- Always bump versionCode in `app.json` AND version text in `app/settings.tsx`
- Always force-copy changed files with `cp -f` (robocopy is unreliable)
- Current: V50 build 90, versionCode 90, next: 91

**Part 2: Twilio Voice Call Server (NEW)**
- Node.js server on Railway
- Code: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server`
- GitHub: github.com/munk2207/naavi-voice-server (private)
- Railway: naavi-voice-server-production.up.railway.app
- Twilio number: +1 249 523 5394
- Full loop PROVEN WORKING: Phone → Twilio → Deepgram STT → Claude → Deepgram TTS → Phone
- All 6 Railway env vars working (ANTHROPIC_API_KEY, DEEPGRAM_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
- CURRENT ISSUE: Call reliability broken — calls fail 2-4 times before connecting. Revert to commit `0eaadc6` first.

### BACKEND

- Supabase project: `hhgyppbxgmjrwdpdubcx`
- Deploy Edge Functions with: `--no-verify-jwt`
- Edge Functions handle: chat, calendar, gmail, contacts, WhatsApp, drive, travel time, TTS, knowledge, push notifications

### WEBSITE

- mynaavi.com — plain HTML + Vercel auto-deploy
- Files: `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website\my-naavi-site\`
- Favicon working on all pages (via shared.js)

### KEY ACCOUNTS

| Service | Console URL |
|---------|------------|
| Anthropic API | console.anthropic.com |
| Deepgram | console.deepgram.com |
| Twilio | console.twilio.com |
| Google Cloud | console.cloud.google.com (project: naavi-490516) |
| Supabase | supabase.com/dashboard/project/hhgyppbxgmjrwdpdubcx |
| Railway | railway.app |
| GitHub | github.com/munk2207 |
| Google Play | play.google.com/console |
| EAS (Expo) | expo.dev/accounts/waggan |

### MOBILE OAUTH — TWO LOCATIONS (MUST STAY IN SYNC)

- Web flow: `lib/calendar.ts` line 55-64
- Mobile flow: `lib/supabase.ts` line 45
- If you change one, change both. Build 88-89 failed because mobile was missing scopes.

### IMPORTANT SECURITY NOTE

The old Anthropic API key leaked in session 8 was deleted in session 9. A new key was created and set as Railway env var. No action needed.

### HOW BUILDS WORK

1. Edit code in worktree (`C:\Users\waela\OneDrive\Desktop\Naavi\.claude\worktrees\gifted-volhard`)
2. Commit in worktree
3. Force-copy files to build dir: `cp -f <source> C:\Users\waela\naavi-mobile/<target>`
4. Verify versionCode: `grep versionCode C:\Users\waela\naavi-mobile\app.json`
5. Commit in build dir: `git add -A && git commit -m "build N sync"`
6. Build: `npx eas build --platform android --profile production --non-interactive`
7. Upload AAB to Google Play Internal Testing
8. User installs from Google Play on phone

### HOW THE VOICE SERVER DEPLOYS

1. Edit code in `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server\src\index.js`
2. `git add -A && git commit -m "description" && git push origin main`
3. Railway auto-deploys from GitHub
4. Check Deploy Logs in Railway dashboard for errors

### WHAT THE USER CARES ABOUT

- Does it work on the phone?
- Can Robert use it hands-free?
- Is the contact saved?
- Did the message send?
- Does the voice call work?

He does NOT care about: code architecture explanations, npm internals, React lifecycle details, or why something is designed a certain way. He cares about results.

### VOICE CALL — NO SILENCE ALLOWED

This system is built for a senior citizen. Complete silence during processing or waiting makes him feel the call dropped. A soft ticking sound MUST play during all silent gaps (between greeting and first input, during thinking/processing). Never remove or disable the thinking music without replacing it with another audio cue. If debugging call issues, keep the tick sound — it is a core UX requirement, not a nice-to-have.
