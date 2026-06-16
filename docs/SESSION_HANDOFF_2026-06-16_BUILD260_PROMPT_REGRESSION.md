# Session Handoff — 2026-06-16 — Build 260 — Prompt Regression Open

## Build Status
- **Build 260** ✅ submitted to Google Play Internal Testing
- **316/316 auto-tester** ✅ green
- **Firebase Test Lab** ✅ PASSED (Pixel 6 + Samsung S22)

## What Was Shipped This Session

### Code (committed, in build 260)
- `feat(ui): chunk-scroll TTS sync + fix tap-anywhere-to-stop` (commit 781096e)
  - TTS plays and screen scrolls with it (chunk-by-chunk)
  - Long-press no longer stops TTS — only the orange Stop button stops it
- `feat(build): build 260 + server-side LIST_CONNECT turn-1 gate` (commit 75ac53f)
  - Server-side gate in `naavi-chat` blocks LIST_CONNECT/LIST_DISCONNECT on turn 1 unless user said "yes"
  - Fixed failing test `truth-at-user-layer.list-connect-accepts-existing-alert`

### Website (deployed to mynaavi.com, no AAB needed)
- Babel CDN pinned to `@7.23.5` — all 5 storyboard iframes working again
- Homepage audio bar replaced with YouTube Shorts embed (video ID: `Kp92N0wYrDI`)
- Title "Naavi capability by Naavi" + subtitle restored above video

## ⚠️ OPEN ISSUE — PRIORITY FOR NEXT SESSION

### Capability question answer broken on mobile chat

**The question:** "What kinds of complex questions are you equipped to handle"

**Original answer (before this session):** Detailed, categorized response with bold section headers and numbered examples — multi-step orchestration, ambiguity resolution, etc. Wael had a voice-call demo transcript confirming the quality of the original answer.

**Current answer:** Generic prose — "I don't handle complex questions. I handle your life..." — no specifics, no structure.

**Root cause:** This session added rules to `get-naavi-prompt` (numbered list enforcement, WRONG/CORRECT examples, LENGTH cap). Even after full revert to commit `7a7e9d7`, the mobile chat answer is still degraded. The `get-naavi-prompt` file is confirmed identical to `7a7e9d7` byte-for-byte.

**What was NOT changed:** Voice server (`naavi-voice-server`) was never touched. Voice call still gives the full detailed answer.

**Next session must:**
1. Diagnose why mobile chat gives a degraded answer despite `get-naavi-prompt` being restored
2. Check if the local fallback `lib/naavi-client.ts::buildSystemPrompt` is being used instead of the Edge Function
3. Check Supabase Edge Function logs to confirm `get-naavi-prompt` is being called and returning the correct prompt
4. DO NOT add new prompt rules — diagnose first, fix only what's broken

## Current Branch State
- Main repo: `main` at commit `5e30309`
- Build clone `C:\Users\waela\naavi-mobile`: synced to same

## Key Files
- Prompt: `supabase/functions/get-naavi-prompt/index.ts` (restored to 7a7e9d7 state)
- naavi-chat gate: `supabase/functions/naavi-chat/index.ts` (turn-1 LIST_CONNECT gate at line ~3318)
- TTS sync: `hooks/useOrchestrator.ts` + `app/index.tsx`
