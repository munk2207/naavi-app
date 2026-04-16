# MyNaavi — Twilio Voice Architecture Plan

## The Problem

Hands-free mode on Android is fragile. Managing the mic, speaker, audio focus, Deepgram WebSocket, TTS timing, and React state all on the phone creates constant bugs — clipped words, 5-second wait for confirm, idle timeouts, cancel killing sessions.

## The Solution

Move ALL voice handling off the phone and onto the server. Robert talks to Naavi through a regular phone call. Twilio manages the call, Deepgram transcribes server-side, Claude responds, TTS plays back through the call.

## How It Feels for Robert

**Morning brief (scheduled):**
- Phone rings at 8:00 AM — caller ID shows "MyNaavi"
- Robert answers: "Good morning"
- Naavi: "Good morning. You have a dentist appointment at 10, lunch with Ali at noon, and 3 unread emails. It's 12 degrees and sunny — good day for a walk. Anything you'd like to do?"
- Robert: "Send a WhatsApp to Ali saying I'll be 10 minutes late"
- Naavi: "I've drafted a WhatsApp to Ali saying you'll be 10 minutes late. Should I send it?"
- Robert: "Yes"
- Naavi: "Sent. Anything else?"
- Robert: "No, thanks"
- Naavi: "Have a great day." *call ends*

**On-demand:**
- Robert: "Hey Google, call Naavi"
- Phone dials Naavi's Twilio number
- Robert talks naturally — no app, no screen, no buttons

## Architecture

```
Robert's Phone
    |
    | (regular phone call)
    |
Twilio (phone number + media stream)
    |
    | (WebSocket — real-time audio)
    |
Supabase Edge Function: voice-call
    |
    +---> Deepgram (server-side transcription)
    |         |
    |         | (transcript text)
    |         v
    +---> Claude (same naavi-chat logic)
    |         |
    |         | (response text + actions)
    |         v
    +---> TTS Engine (Google / ElevenLabs)
    |         |
    |         | (audio)
    |         v
    +---> Twilio (plays audio back through the call)
```

## Step-by-Step Flow

1. **Call starts** — Robert calls the Twilio number, or Twilio calls Robert
2. **Twilio connects** — opens a WebSocket to our voice-call Edge Function
3. **Audio streams in** — Twilio sends Robert's voice as raw audio
4. **Deepgram transcribes** — server-side streaming, same Nova-3 model
5. **Transcript sent to Claude** — identical to today's naavi-chat
6. **Claude responds** — returns speech text + actions (WhatsApp, calendar, etc.)
7. **Actions execute** — same server-side logic (send-sms, create-calendar-event, etc.)
8. **TTS generates audio** — converts Claude's response to speech
9. **Audio plays back** — Twilio plays the TTS audio through the phone call
10. **Loop continues** — Robert speaks again, cycle repeats

## What Changes

| Component | Today (App) | Future (Twilio) |
|-----------|-------------|-----------------|
| Mic input | Android mic via ExpoAudioStream | Twilio media stream |
| Transcription | Deepgram client-side WebSocket | Deepgram server-side |
| TTS output | expo-speech on phone | TTS → Twilio audio playback |
| Voice confirm | Module-level flag + timing hacks | Simple text matching on server |
| Session management | React state machine | Server-side call state |
| Entry point | Open app + tap hands-free | "Hey Google, call Naavi" or incoming call |

## What Stays the Same

- Claude prompt (identical)
- All actions: WhatsApp, email, calendar, lists, memory, navigation
- Supabase database and Edge Functions
- Contact lookup
- Knowledge/memory system
- The app (for visual use — brief, drafts, settings, notes)

## New Pieces to Build

### 1. Twilio Phone Number
- Cost: ~$1/month for a Canadian number
- Setup: Buy number in Twilio console, point to our webhook

### 2. Edge Function: voice-call
- Receives WebSocket connection from Twilio
- Streams audio to Deepgram for transcription
- Sends transcripts to Claude (reuse naavi-chat logic)
- Handles voice confirm (yes/no/cancel) as simple text matching
- Generates TTS audio and streams back through Twilio
- Manages call state (listening, thinking, speaking, confirming)

### 3. Edge Function: outbound-call
- Triggers a call from Naavi to Robert
- Used for: morning brief, scheduled reminders, alerts
- Robert's phone number stored in Settings

### 4. TTS for Phone
- Options: Google Cloud TTS, ElevenLabs, or Deepgram Aura
- Must return audio compatible with Twilio (mulaw 8kHz or PCM)

## Costs

| Item | Cost |
|------|------|
| Twilio phone number | ~$1/month |
| Twilio voice minutes | ~$0.02/min ($0.20 for a 10-min session) |
| Deepgram transcription | ~$0.005/min (already paying) |
| Claude API | Same as today |
| TTS | ~$0.01/min (varies by provider) |
| **Total per 10-min call** | **~$0.24** |
| **Estimated monthly (2 calls/day)** | **~$15/month** |

## Benefits

1. **Zero friction** — Robert just answers the phone or says "Hey Google, call Naavi"
2. **Rock solid** — phone calls are the most stable technology available
3. **No Android audio issues** — Twilio handles all audio management
4. **No app required** — works on any phone, even a flip phone
5. **Voice confirm just works** — no timing hacks, no React state races
6. **Works while driving** — Bluetooth car speaker, completely hands-free
7. **Scheduled calls** — Naavi can call Robert for morning brief automatically

## Migration Plan

| Phase | What | Impact |
|-------|------|--------|
| Phase 1 | Build voice-call Edge Function + buy Twilio number | No change to app |
| Phase 2 | Add "Call Naavi" button in app | Optional — Robert can try it |
| Phase 3 | Add outbound calls (morning brief by phone) | Naavi calls Robert |
| Phase 4 | Add "Hey Google, call Naavi" shortcut | Full hands-free entry |
| Phase 5 | Deprecate in-app hands-free (optional) | Keep as fallback |

## Open Questions

1. **Latency** — estimated 3-5 seconds between Robert speaking and hearing a response. Acceptable?
2. **Concurrent calls** — one user at a time is fine for now. Scale later.
3. **Call duration limit** — Twilio has no hard limit. Suggest auto-end after 30 minutes of silence.
4. **Authentication** — how does the server know it's Robert calling? Caller ID matching against stored phone number.
5. **Bilingual** — Robert speaks French sometimes. Deepgram and Claude both support French. TTS needs French voice too.

## Status

**April 14, 2026 — Planning stage.** Google Cloud People API enabled. Twilio account needed. Architecture approved in principle.
