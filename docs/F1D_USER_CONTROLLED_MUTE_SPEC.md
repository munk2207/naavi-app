# F1d — User-controlled mute on PC + Mobile (product spec)

**Author:** Wael (decisions) + collaborator (drafting)
**Status:** Spec locked 2026-05-09. Ready for engineering planning.
**Replaces:** F1c (auto-classification privacy bundle) — closed 2026-05-09 because auto-classification creates an unfixable social false-positive cost (forcing Robert to publicly engage in privacy dialogue itself reveals he has something to hide).

---

## The problem

Robert uses Naavi in taxis, waiting rooms, cafés, family dinners — not just at home. When Naavi reads results aloud, biopsy follow-ups, bank balances, and lawyer notices get broadcast to whoever's nearby. This is the single biggest UX gap in the voice-call experience for the older healthy independent adult persona.

The 2026-04 plan (F1c) tried to solve this by auto-classifying items as "private" (medical / financial / legal) and offering an SMS alternative at read time. That approach was rejected 2026-05-09 because:

- **The privacy dialogue itself reveals secrets.** Naavi asking *"this looks private — want me to text it?"* in a taxi tells the driver Robert has something to hide.
- **False positives compound the cost.** A pharmacy newsletter wrongly tagged "medical" forces Robert into the dialogue for nothing.
- **Robert can't gracefully recover from misclassification.** He has to say *"no, just read it"* publicly, opting into less privacy in front of strangers.

F1d takes the opposite approach: **Robert controls the mute himself, in the moment.** No classification, no false positives, no public dialogue.

---

## End-state behavior

### Phone (PC)

Robert in a taxi listening to Naavi read his calendar:

> Naavi: *"You have lunch with Bob at noon, then your follow-up appointment at—"*
> Robert: *"No sound"*
> Naavi: *(audio stops immediately)*  *"Want me to text the rest to your phone?"*
> Robert: *"Yes"*
> Naavi: *(silently sends SMS or email with the full list)*  *"Sent."*
> *— OR —*
> Robert: *"No"*  *(or stays silent for ~3 seconds)*
> Naavi: *(moves on; the response content is discarded)*

### Mobile (MV)

Robert at a family dinner, listening to Naavi via the mobile app:

> Naavi: *(reading aloud)*
> Robert: *(long-presses anywhere on the chat screen)*
> Naavi: *(audio stops; the chat bubble remains visible for Robert to read silently)*

No SMS-the-rest follow-up on mobile — the chat bubble already shows the text. Robert can read it on the screen if he wants.

---

## PC mute vocabulary

Two distinct buckets — same spoken syntax, different code paths and different intents:

| Bucket | Words | Behavior |
|---|---|---|
| **Existing kill-response** | *"stop", "enough", "got it", "ok", "okay", "thanks", "thank you", "next", "that's enough", "i got it"* | Naavi stops talking, response is discarded entirely. Robert is satisfied; no SMS offered. **Unchanged from today's behavior.** |
| **New privacy-mute (F1d)** | *"no sound", "quiet", "shh"* | Naavi drains the Twilio audio queue immediately, **preserves the full response text in memory**, and offers *"Want me to text the rest to your phone?"* Robert says yes → SMS or email is sent. Robert says no or stays silent → response is discarded. |

**Note:** *"stop"* deliberately stays in the kill-response bucket for backwards compatibility. Robert who wants the privacy-mute behavior says *"no sound" / "quiet" / "shh"* explicitly.

---

## Mobile mute mechanics

Mobile already supports the necessary primitives:

- The existing **orange stop button** ([`app/index.tsx:2050`](app/index.tsx:2050)) calls `stopSpeaking()` ([`hooks/useOrchestrator.ts:2766`](hooks/useOrchestrator.ts:2766)) which halts audio without clearing the chat bubble.
- F1d adds **long-press anywhere on the chat screen as an additional mute trigger** during TTS playback.

**State-based dispatch** in `onChatLongPress`:

- If `isAudioPlaying` is true → call `stopSpeaking()` (mute).
- Otherwise → existing hands-free entry behavior (talk button activation).

The two functions are mutually exclusive (Naavi is either speaking or idle), so the same gesture serves both purposes without ambiguity.

**No SMS-the-rest follow-up on mobile.** The chat bubble shows the text; Robert can read it silently. Adding SMS would be redundant.

---

## PC mute behavior detail

When Robert says one of the privacy-mute words during TTS:

1. **Drain the Twilio outbound audio queue immediately** (same `event: 'clear'` mechanism shipped 2026-05-09 for music-queue latency). Audio stops within 100 ms.
2. **Preserve the full response text in memory** for this turn (the server already has the complete text before TTS starts; F1d just doesn't discard it on mute).
3. **Naavi immediately asks:** *"Want me to text the rest to your phone?"*
4. **Robert's reply** is classified using the same three-mode framework as DRAFT_MESSAGE confirmation:
   - *"yes / send / go ahead / ok"* → confirm and deliver content (see Content Delivery below).
   - *"no / cancel / never mind"* → response is discarded; Naavi moves on.
   - **Silence for ~3 seconds** → treated as cancel; response is discarded.

---

## Content delivery — smart split

Below ~500 characters: SMS with full content, verbatim.

Above ~500 characters: **email + SMS notification with a hot link**.

- **Email** carries the full response content (no length issue; readable formatting).
- **SMS** contains a brief notification: *"Naavi sent you a longer reply — tap to read: [link]"* — the link opens the email or a hosted view of the content.
- Robert taps the link from his phone → reads the full content silently.

If Robert has no email configured (rare), fall back to SMS-only with multi-segment delivery (Twilio handles fragmentation automatically).

If Robert has no phone configured, fall back to email-only with a different message: *"I emailed it to you."*

---

## Recovery

After mute, the muted response **is not stored** in any session memory. If Robert later asks *"what was that you were saying?"*, Naavi treats it as a fresh question:

- Server re-runs the underlying search / LLM call from scratch.
- The new response may differ slightly from the muted one (different LLM sampling, slightly different timing for live data, etc.).
- This is acceptable: F1d's promise is privacy in the moment, not perfect-recall replay.

The SMS or email Robert received via the SMS-the-rest path is the **only** way to retrieve the original muted content verbatim.

---

## Edge cases (defaults)

| Case | Behavior |
|---|---|
| Mute when no SMS phone configured | Fall back to email-only with notification *"I emailed it to you."* |
| Mute when no email configured either | Naavi acknowledges the mute but cannot offer follow-up: *"OK, stopping. I don't have a way to send the rest right now."* Response is discarded. |
| Mute during DRAFT_MESSAGE confirmation prompt | Mute cancels the confirmation prompt; the draft stays available. Robert can confirm later (*"send it"*) without re-drafting. |
| Mute during the initial greeting | Greeting is silenced; no SMS-the-rest offer (greeting isn't sensitive content). |
| Multiple consecutive mutes in one call | Each works independently. No special accumulation behavior; the response from each muted turn is independently offered for SMS-the-rest. |
| Mute mid-list (Naavi reading 5 calendar events, Robert mutes after item 3) | SMS contains the FULL list (items 1–5), not just items 4+. The point is private delivery of the content, not partial replay of where Robert muted. |

---

## Engineering scope

Roughly **0.5–1 session** to ship. Server-only on PC (no AAB needed); mobile already has the primitives.

### Server-side (no AAB needed)

1. **Add new privacy-mute words to the voice-server stop-handler.** Add a separate match for *"no sound" / "quiet" / "shh"* parallel to the existing kill-response matcher.
2. **Preserve `pendingText` on privacy-mute** instead of clearing it. The drain (`event: 'clear'` on Twilio) handles audio silencing; the response text stays in memory for this turn.
3. **Inject the SMS-the-rest follow-up** as Naavi's next utterance: *"Want me to text the rest to your phone?"* Use the standard three-option confirmation framework.
4. **On confirm:** smart-split delivery. Below threshold → call existing `send-sms` Edge Function. Above threshold → call existing `send-email` + send SMS with the hot link.
5. **Voice prompt update** in `get-naavi-prompt`: teach Claude the new mute vocabulary and the SMS-the-rest interaction pattern.

### Mobile (no AAB needed for v1; only if adding SMS-the-rest later)

6. **Update `onChatLongPress` handler** ([`app/index.tsx`](app/index.tsx)) to call `stopSpeaking()` when `isAudioPlaying` is true; existing hands-free behavior otherwise.

### Testing

7. Auto-tester additions:
   - Voice prompt regression tests for the new mute vocabulary.
   - Smoke test that audio drain happens within 200 ms of mute word detection.
   - Multi-user matrix test: mute on one user's call doesn't affect another.

---

## Future considerations (not in F1d v1)

- **Content summarization on long replies.** If users find the SMS hot link friction-y, a v2 could include a one-line summary in the SMS body alongside the link.
- **Per-user mute vocabulary.** Some users might prefer different stop words ("hush" / "silence Naavi"). Add custom vocabulary to `user_settings` if requests come up.
- **Auto-pause on detected ambient noise.** If a third voice or carrier hand-off (call going on speaker) is detected, Naavi could pause and ask. Out of scope; signal extraction is hard.
- **Privacy mode persistent setting.** Some users might want "always private — never read sensitive things aloud, just text everything." Could add as an opt-in setting later. v1 keeps it purely reactive.

---

## Open work

None at the spec level. Spec is locked.

Build can begin in any future focused session. The engineering scope section above is the launch checklist.
