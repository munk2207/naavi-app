# Naavi — First-Call Voice Onboarding Script

**Purpose:** A 60-second spoken walkthrough that runs on a new user's *first* call to +1 249 523 5394. Sets expectations, names what Naavi already knows, and gives 3 concrete things to try right now. After this plays, Naavi transitions to normal operation.

**Implementation:** check `user_settings.first_call_completed_at` (new column). If null/false on inbound voice connection, play this script before the regular greeting. After delivery, mark the column `true` so it never plays again.

---

## Voice script — read by Naavi (Aura Hera, Twilio Polly, or Deepgram)

> *(warm, unhurried — pace ~140 wpm)*

**Greeting (10 sec)**

"Hi {userName}, welcome. I'm Nahvee — your assistant. This is our first call, so let me take 30 seconds to tell you what I can do, then you can ask me anything you'd like."

*(2-second pause — gives the user time to settle)*

**What I already know (15 sec)**

"From the moment you set up Naavi, I already know your contacts, your home and work address, and the people you mention often. So when you say 'text Sarah' or 'remind me when I get home,' I know exactly what you mean — no setup needed."

*(1-second pause)*

**Three things to try (25 sec)**

"Three things people love asking me first:"

"One — *what's on my calendar today*. I'll read it back."

*(short pause)*

"Two — *what time should I leave for my next meeting*. I'll calculate it from where you are."

*(short pause)*

"Three — *remember Sarah's birthday is April fifteenth*. I'll save it and remind you."

*(short pause)*

**Closing + handoff (10 sec)**

"You can also ask me to record a conversation, send a text, or set up an alert. The more we talk, the better I'll know your style. Go ahead — what can I help with?"

*(transition to normal listening — Deepgram waiting for transcript)*

---

## Total duration: ~60 seconds

If the user interrupts at any point with a real question (barge-in detected), abort the script and process their question normally. Set `first_call_completed_at` regardless — they don't need to hear it again.

---

## Implementation notes for the voice server

```javascript
// In wss.on('connection') handler, after user resolution:
if (userId && !userSettings.first_call_completed_at) {
  await playOnboardingScript(twilioWs, userName);
  await markFirstCallCompleted(userId);
}
// Then proceed with the normal greeting / barge-in listening
```

The script lives as a single TTS string for Aura Hera (mobile-quality voice) — about 140 words.

A barge-in handler MUST cancel the script the moment the user starts speaking. The `first_call_completed_at` flag is set on barge-in too, so the user never hears the script twice.

---

## Variants to consider for A/B later

- **Short version (30 sec)** — cuts to "two things to try" (drops the recording mention)
- **Skipped entirely** — if the user already used the mobile app first, mark `first_call_completed_at` from the app side
- **Re-onboarding after 90 days inactive** — re-introduce features in case the user forgot
