# V57.6 build 123 — Test plan

**Goal:** verify the 5 V57.5 regressions are fixed and capture diagnostic logs for the 2 remaining hard bugs (turn-2 slowness + text truncation).

---

## Pre-flight

- [ ] V57.6 (build 123) installed on phone — confirm in Settings.
- [ ] Force-stop the app to start fresh.
- [ ] (Optional, only if you want to investigate Bug 1 / 2 from logs): connect phone via USB and run `adb logcat -s ReactNativeJS:V *:S` to stream JS console logs.

---

## Test 1 — Visit recorder no longer times out at 15s

**Was:** "poll-conversation timed out after 15000ms" red error after every recording.
**Fix:** timeout bumped to 90 seconds.

1. Force-stop, reopen.
2. Tap people-icon button.
3. Speak any 10–30 second visit (e.g. "Doctor Smith says blood pressure is fine, take ibuprofen for 5 days").
4. Stop recording.
5. Wait — should NOT see "timed out after 15000ms" error.

**Expected:** "Conversation Recorded" prompt appears within 60–90 seconds.

---

## Test 2 — Location alert speech is now truthful

**Was:** Naavi said "Alert set" even when DB insert failed silently. Card never appeared.
**Fix:** speech now says "I couldn't save the alert — please try again" when insert fails.

1. Force-stop, reopen (so this is turn 1 — fast path).
2. Voice or text: "Alert me when I arrive at the office".
3. Listen / read what Naavi says.
4. Open the Alerts screen and check whether a new "Arrive at Office" entry exists.

**Expected:**
- If insert succeeded → Naavi says "Alert set — one time you arrive at {place}", card appears below with "Make it recurring" button, AND a new row in Alerts.
- If insert failed → Naavi says "I couldn't save the alert — please try again", no card, no row.

---

## Test 3 — Local prompt fallback recognizes location triggers

**Was:** When the get-naavi-prompt fetch failed, the local fallback didn't include the V57.4 location-trigger one_shot rule, so Naavi defaulted to recurring instead of one-time.
**Fix:** local fallback in `lib/naavi-client.ts` now includes the V41 rule.

(This is hard to test without simulating a fetch failure. The fix is defensive — covered by Test 2 implicitly.)

---

## Test 4 — Bug 2 diagnostic — text truncation

**Setup:** Plug in phone via USB, run `adb logcat -s ReactNativeJS:V *:S` in PowerShell.

1. Force-stop, reopen.
2. Type **"Alert me when I arrive home"** in the chat input.
3. Tap Send.
4. Watch the chat bubble — does it show the full text or just "Alert me when I arrive"?
5. **Look at logcat for a line like:**

   ```
   [handleSend] inputText raw= "Alert me when I arrive home" trimmed= "Alert me when I arrive home"
   ```

   - If the log shows the FULL text but the bubble shows truncated text → the bug is in `ConversationBubble.tsx` rendering. We fix the bubble next session.
   - If the log shows TRUNCATED text → the bug is in TextInput state (onChangeText not committing the last word). We fix the input next session.

Send the log line and a screenshot of the bubble to me.

---

## Test 5 — Bug 1 diagnostic — turn-2 slowness

**Setup:** Same as Test 4 — logcat streaming.

1. Force-stop, reopen.
2. Type **"Hi"**, send. Wait for response (should be ~3s).
3. Type **"What time is it?"**, send. Wait for response.
4. Look at logcat for these lines:

   ```
   [orch:T#1] start userMessage=...
   [orch:T#1] pre-naavi-chat done 250ms
   [orch:T#1] naavi-chat returned 1830ms
   [orch:T#1] actions done, turn rendered 1850ms

   [orch:T#2] start userMessage=...
   [orch:T#2] pre-naavi-chat done 38000ms          ← would tell us pre-call hangs
   [orch:T#2] naavi-chat returned 65000ms          ← would tell us Claude hangs
   [orch:T#2] actions done, turn rendered 87000ms  ← TTS or actions hang
   ```

   **The largest gap between step labels is the bottleneck.**

Send the full T#1 + T#2 log block to me.

---

## Test 6 — Continued V57.5 feature checklist (use voice, not text)

These were blocked or untested in V57.5. Use **voice** to bypass the text truncation bug.

- [ ] Multi-match picker: voice "Email Hussein about the doctor appointment". Picker should appear with multiple "Hussein" options if you have any duplicates. Test "✕ None of these — type a different email" button.
- [ ] DraftCard ✕ Discard: when a draft card appears (from any DRAFT_MESSAGE), tap the ✕ Discard button. Card should collapse to "✕ Draft discarded" placeholder.
- [ ] Calendar event creation: voice "Schedule lunch with Mike tomorrow at noon". Event should appear in Today's Brief or calendar.
- [ ] Email send protection: voice "Email Hussein about lunch". Naavi must DRAFT only — never auto-send. Verify nothing actually sends.
- [ ] Prescription auto-expand: in a visit recording, mention "take 2 ibuprofen twice daily for 5 days" → 10 calendar events should be created.

For each, mark pass / fail.

---

## After testing

- Send me logcat snippets for Test 4 and Test 5 (the diagnostic ones).
- Send me pass/fail summary for Tests 1, 2, and the Test 6 sub-items.
- I'll diagnose Bug 1 + Bug 2 from your logs and fix in V57.7.
