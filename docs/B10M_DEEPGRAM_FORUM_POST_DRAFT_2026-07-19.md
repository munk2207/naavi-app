**Title:** Streaming STT (Nova-3) intermittently produces zero transcript for real speech, across multiple reconnects, on live phone calls

**Body:**

We're running Deepgram's streaming transcription API (Nova-3, mulaw/8000, via WebSocket) behind a Twilio Media Streams phone integration. Intermittently — roughly once every few calls — a live call produces **zero transcript output for the entire call**, despite:

- Continuous inbound audio being sent the whole time (confirmed via our own frame counters).
- Confirmed real speech energy present in the audio we're sending (we added our own amplitude check on the raw mu-law bytes before sending — average amplitude 698 on one affected call, clearly non-silent, consistent with the caller actually speaking).
- Multiple fresh WebSocket connections to Deepgram within the same call (we added client-side reconnect logic that fires after 6 seconds of no transcript) — **all three connection attempts in one call (the original plus two reconnects) received nothing but empty-transcript `Results` messages**, despite continuous, non-silent audio being forwarded to each one.

We do receive `Results` messages continuously throughout these calls — including messages marked `is_final: true` and occasionally `speech_final: true` — but the `channel.alternatives[0].transcript` field is empty every single time, for the entire call.

**What we've ruled out on our own side:**
- Audio not reaching Deepgram — ruled out via our own frame counters (audio flows continuously) and the amplitude check above (real signal present).
- Our own code as the cause — the relevant code path has been unchanged for the past several days across multiple reproductions.
- A stale/misconfigured connection — ruled out by the fact that fresh reconnects (new WebSocket, new handshake) show the identical symptom.

**What would help us:**
1. Confirmation of whether this is a known failure mode for Nova-3 streaming under any particular condition (network jitter, particular audio characteristics, endpointing settings, etc.).
2. If you have request/session-level logs on your side, we're happy to provide our Deepgram Project ID and specific timestamps for affected connections so you can look at what happened on your end for those specific sessions. [NOTE: capture request IDs from the Metadata message before posting, if possible — see below.]

Happy to share raw logs, our exact streaming URL parameters, or anything else useful. This is affecting real phone calls in production, so any guidance is appreciated.

---

**Wael — before posting:** the bracketed note above flags something worth doing first if you want the strongest possible response: right now we don't capture Deepgram's own `request_id` for the STT session (only for the separate TTS calls). If you want, I can add one more small diagnostic to grab that from Deepgram's initial `Metadata` message, so you can hand them exact request IDs instead of just timestamps — that would let them look up the *exact* sessions on their backend instead of searching by time range. Your call whether to wait for that or post now with what we have.
