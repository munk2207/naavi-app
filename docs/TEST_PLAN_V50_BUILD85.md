# MyNaavi V50 Build 85 — End-to-End Test Plan

For each test, write PASS / FAIL / PARTIAL and any notes.

---

## 1. SIGN IN & STARTUP

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1.1 | Open app — sign-in screen appears | | |
| 1.2 | Sign in with Google — lands on main screen | | |
| 1.3 | Header shows logo + "MyNaavi" (white + teal) | | |
| 1.4 | Settings page shows "V50 (build 85)" | | |

---

## 2. TAP-TO-TALK (press mic, speak, release)

| # | Test | Result | Notes |
|---|------|--------|-------|
| 2.1 | Tap mic, say "What's on my calendar today?" — Naavi responds | | |
| 2.2 | Tap mic, say "What's the weather?" — Naavi responds | | |
| 2.3 | Tap mic, say "Remember that my dentist is Dr. Smith" — Naavi confirms | | |
| 2.4 | Tap mic, say "What do you know about me?" — Naavi lists memories | | |
| 2.5 | Response appears as text on screen | | |
| 2.6 | Response is spoken aloud (TTS) | | |
| 2.7 | No "Say yes to send" in tap-to-talk text or voice | | |

---

## 3. WHATSAPP — TAP-TO-TALK

| # | Test | Result | Notes |
|---|------|--------|-------|
| 3.1 | "Send a WhatsApp to [name] saying hi" — draft card appears | | |
| 3.2 | Draft shows correct recipient name and phone number | | |
| 3.3 | Draft shows correct message body | | |
| 3.4 | Tap Send — message sends | | |
| 3.5 | Message received on recipient's phone | | |
| 3.6 | No infinite loop after tapping Send | | |
| 3.7 | Sender name on WhatsApp — is it "Robert" or correct name? | | |

---

## 4. WHATSAPP — HANDS-FREE VOICE CONFIRM

| # | Test | Result | Notes |
|---|------|--------|-------|
| 4.1 | Activate hands-free — hear "I'm listening" | | |
| 4.2 | Say "Send a WhatsApp to [name] saying hello" — draft appears | | |
| 4.3 | Naavi speaks the draft summary ("I've drafted a WhatsApp to...") | | |
| 4.4 | Wait 5 seconds, say "yes" — message sends | | |
| 4.5 | Hear "Sent." spoken clearly (no clipping) | | |
| 4.6 | Message received on recipient's phone | | |
| 4.7 | Draft card updates to sent state? | | |
| 4.8 | No infinite loop | | |

---

## 5. VOICE EDIT ("CHANGE")

| # | Test | Result | Notes |
|---|------|--------|-------|
| 5.1 | After draft appears, say "change" — Naavi asks what to change | | |
| 5.2 | Say new message — draft updates with new body | | |
| 5.3 | Wait 5 seconds, say "yes" — updated message sends | | |
| 5.4 | Say "cancel" — draft is cancelled, hear "OK, cancelled." | | |

---

## 6. VOICE CONFIRM — EDGE CASES

| # | Test | Result | Notes |
|---|------|--------|-------|
| 6.1 | Say "yes" immediately (before 5s) — what happens? | | |
| 6.2 | Say "send" instead of "yes" — does it work? | | |
| 6.3 | Say "go ahead" — does it work? | | |
| 6.4 | Say nothing for 30 seconds — auto-cancel + spoken message? | | |
| 6.5 | Say something random like "banana" — treated as edit? | | |

---

## 7. CALENDAR

| # | Test | Result | Notes |
|---|------|--------|-------|
| 7.1 | "What's on my calendar today?" — lists events | | |
| 7.2 | "Create an event called Lunch with Ali tomorrow at noon" — event created | | |
| 7.3 | Verify event appears in Google Calendar | | |
| 7.4 | "Delete the Lunch with Ali event" — event deleted | | |
| 7.5 | "What's my schedule for this week?" — responds | | |

---

## 8. CONTACTS & LOOKUP

| # | Test | Result | Notes |
|---|------|--------|-------|
| 8.1 | "What's Wael's phone number?" — finds from memory/contacts | | |
| 8.2 | Say a phone number — Naavi identifies the contact | | |
| 8.3 | "Send a WhatsApp to [name not in contacts]" — how does it handle? | | |

---

## 9. LISTS

| # | Test | Result | Notes |
|---|------|--------|-------|
| 9.1 | "Create a list called Groceries" — list created | | |
| 9.2 | "Add milk and eggs to Groceries" — items added | | |
| 9.3 | "What's on my Groceries list?" — reads items | | |
| 9.4 | "Remove milk from Groceries" — item removed | | |

---

## 10. GOOGLE TASKS

| # | Test | Result | Notes |
|---|------|--------|-------|
| 10.1 | "What are my tasks?" — lists tasks from brief | | |
| 10.2 | Tasks appear in daily brief | | |

---

## 11. KNOWLEDGE / MEMORY

| # | Test | Result | Notes |
|---|------|--------|-------|
| 11.1 | "Remember that I take vitamin D every morning" — saved | | |
| 11.2 | "What do you remember about my health?" — recalls | | |
| 11.3 | "Forget that I take vitamin D" — deleted | | |

---

## 12. NAVIGATION & TRAVEL TIME

| # | Test | Result | Notes |
|---|------|--------|-------|
| 12.1 | "How long to drive to [destination]?" — shows travel time | | |
| 12.2 | Travel time card appears on screen | | |

---

## 13. HANDS-FREE MODE — GENERAL

| # | Test | Result | Notes |
|---|------|--------|-------|
| 13.1 | Tap hands-free button — hear "I'm listening" | | |
| 13.2 | Say a question — Naavi responds, then resumes listening | | |
| 13.3 | Say "goodbye" — hands-free deactivates | | |
| 13.4 | Idle 60 seconds — pauses with "Tap Resume when you need me" | | |
| 13.5 | Tap Resume — hands-free restarts | | |
| 13.6 | Multiple back-to-back commands — all handled | | |
| 13.7 | TTS and mic don't overlap | | |

---

## 14. PUSH NOTIFICATIONS

| # | Test | Result | Notes |
|---|------|--------|-------|
| 14.1 | Receive a push notification | | |
| 14.2 | Tap notification — opens app | | |

---

## 15. SETTINGS

| # | Test | Result | Notes |
|---|------|--------|-------|
| 15.1 | Settings page loads | | |
| 15.2 | Version shows "V50 (build 85)" | | |
| 15.3 | Sign out works | | |

---

## 16. NOTES

| # | Test | Result | Notes |
|---|------|--------|-------|
| 16.1 | "My Notes" screen loads | | |
| 16.2 | Notes saved via "remember" appear here | | |

---

## SUMMARY

| Area | Pass | Fail | Partial | Total |
|------|------|------|---------|-------|
| Sign in | | | | 4 |
| Tap-to-talk | | | | 7 |
| WhatsApp tap | | | | 7 |
| WhatsApp voice | | | | 8 |
| Voice edit | | | | 4 |
| Voice edge cases | | | | 5 |
| Calendar | | | | 5 |
| Contacts | | | | 3 |
| Lists | | | | 4 |
| Tasks | | | | 2 |
| Memory | | | | 3 |
| Navigation | | | | 2 |
| Hands-free | | | | 7 |
| Push | | | | 2 |
| Settings | | | | 3 |
| Notes | | | | 2 |
| **TOTAL** | | | | **66** |
