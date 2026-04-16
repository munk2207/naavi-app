# MyNaavi — Test Plan (Mobile + Web + Voice)

**Last updated:** 2026-04-16
**Scope:** end-to-end functional verification across all three surfaces.

## Test accounts

| User | Email | Phone | user_id |
|---|---|---|---|
| Wael (you) | wael.aggan@gmail.com | +1 613 769 7957 | 788fe85c-b6be-4506-87e8-a8736ec8e1d1 |
| Huss (coworker) | heaggan@gmail.com | +1 343 575 0023 | 381b0833-fe74-410a-8574-d0d750a03b3b |

## Surface URLs / entry points

- **Mobile:** Installed AAB from Google Play Internal Testing — currently V50 build 91
- **Web:** https://naavi-app.vercel.app  (sign in with Google)
- **Voice:** Call `+1 249 523 5394` from your phone  (Twilio → Railway voice server)

## Notes before you start

1. Sign in on web and mobile with the **same** Google account or test results will differ.
2. Voice resolves the user from your **caller ID** — call from `+16137697957` to get Wael's data, `+13435750023` to get Huss's.
3. Hard-refresh the web browser (Ctrl+Shift+R) after any deploy.
4. Mobile AAB build 91 pre-dates the post-sanity cleanup (commit `18d67bc`). Some mobile-specific bug fixes land only in build 92+.

---

## Legend

- ✅ = feature supported, should work
- ❌ = feature not supported on this surface (intentional)
- ⚠️ = supported but with caveats noted

---

# 1. Authentication

| # | Test | Mobile | Web | Voice |
|---|---|---|---|---|
| A1 | Sign in with Google | ✅ Sign-in button → Google OAuth consent → land on home | ✅ Same flow in-browser | ❌ No sign-in; caller identified by phone |
| A2 | Sign out + back in | ✅ Settings → Sign out → home goes to "Sign in" screen | ✅ Same | N/A |
| A3 | Cross-account test | Sign in as Huss → should see HIS calendar/contacts (not Wael's) | Same | Call from Huss's phone → should hear HIS morning brief |

**Pass criteria:** logging in as Wael never shows Huss's data and vice versa.

---

# 2. Morning brief tile

| # | Test | Mobile | Web | Voice |
|---|---|---|---|---|
| B1 | Load home page, see "Today" brief | ✅ Calendar, weather, email, task tiles populate within 5 s | ✅ Same | ❌ N/A |
| B2 | Toggle Today / 3 days / 7 days | ✅ Calendar tile re-filters | ✅ Same | ❌ Voice uses fixed 30-day window |
| B3 | Weather card shows Ottawa weather | ✅ | ✅ | Say "what's the weather" → spoken reply |

**Pass criteria:** today's events appear, dates are correct, no "Something went wrong".

---

# 3. Calendar

| # | Test | Mobile | Web | Voice |
|---|---|---|---|---|
| C1 | Create event: "Schedule lunch with Sarah tomorrow at 12" | ✅ Event appears in Google Calendar | ✅ Same | ✅ Same — call and say it |
| C2 | Priority event: "Schedule a **critical** doctor's call tomorrow 4pm" | ✅ `is_priority=true` set | ✅ Same | ✅ Same |
| C3 | Query calendar: "What's on my calendar Friday?" | ✅ Chat reply lists Friday | ✅ Same | ✅ Same — voice reply, 1–2 sentences |
| C4 | Delete event: "Delete the lunch with Sarah" | ✅ Removed from Google Calendar | ✅ Same | ✅ Same |
| C5 | Query critical items: "What are my critical events?" | ✅ Only priority-flagged items listed | ✅ Same | ✅ Same — should NOT invent urgency |

**Pass criteria (C5):** Naavi never lists ordinary events as "critical" unless they were explicitly flagged.

---

# 4. Reminders

| # | Test | Mobile | Web | Voice |
|---|---|---|---|---|
| D1 | "Remind me to take my vitamin at 9 pm tonight" | ✅ Reminder saved + calendar event created | ✅ Same | ✅ Same |
| D2 | "Remind me every day at 8 am to take meds" (recurring) | ✅ Uses CREATE_EVENT with RRULE | ✅ Same | ✅ Same |
| D3 | Wait for reminder fire → check-reminders cron sends SMS + WhatsApp + push | ✅ All 3 channels | ✅ Same (push via web) | Same (push goes to any signed-in device) |

**Pass criteria:** reminder fires to the correct user's phone, not the other user's.

---

# 5. Contacts

| # | Test | Mobile | Web | Voice |
|---|---|---|---|---|
| E1 | "Save John, email john@example.com" | ✅ Added to Supabase `contacts` + Google Contacts | ✅ Added to Supabase only (no Google Contacts write on web) | ✅ Same as mobile |
| E2 | "What's Sarah's email?" | ✅ Contact lookup returns email | ✅ Same | ✅ Same — must return **calling user's** Sarah (multi-user check) |
| E3 | "Draft a WhatsApp to Sarah saying hi" | ✅ Draft shown, name resolves to phone | ✅ Same | ✅ Same — confirm with "yes" to send |

**Pass criteria (E2):** Wael asking about Sarah never returns Huss's Sarah.

---

# 6. Knowledge / preferences

| # | Test | Mobile | Web | Voice |
|---|---|---|---|---|
| F1 | "Remember my favorite coffee is espresso" | ✅ Saved to `knowledge_fragments` under caller's user_id | ✅ Same | ✅ Same |
| F2 | "What are my preferences?" | ✅ Lists stored items, then stops (no fabrication) | ✅ Same | ✅ Same — voice reads them as bullets |
| F3 | "Forget my coffee preference" | ✅ DELETE_MEMORY removes matching fragments | ✅ Same | ✅ Same |
| F4 | Cross-user leak test | As Wael, ask "what do you know about me" → Should NOT include Huss's memories (e.g. "Robert has a meeting...") | Same | Same |

**Pass criteria (F4):** zero cross-contamination between users' knowledge.

---

# 7. Email / Drive / Travel (Google integrations)

| # | Test | Mobile | Web | Voice |
|---|---|---|---|---|
| G1 | "Draft an email to Bob saying thanks" | ✅ Draft card → tap Send | ✅ Same | ✅ Draft → say "yes" to send |
| G2 | "Save a note that I met Alice" | ✅ Creates Google Doc in Drive | ✅ Same | ✅ Same (voice supports this after today's fix) |
| G3 | "Find my tax receipts document" | ✅ DRIVE_SEARCH returns matches | ✅ Same | ✅ Same (voice supports this after today's fix) |
| G4 | "How long to Parliament Hill?" | ✅ FETCH_TRAVEL_TIME → reply with minutes | ✅ Same | ✅ Same |

---

# 8. Lists

| # | Test | Mobile | Web | Voice |
|---|---|---|---|---|
| H1 | "Create a shopping list" | ✅ LIST_CREATE | ✅ Same | ✅ Same |
| H2 | "Add milk and eggs to my shopping list" | ✅ LIST_ADD | ✅ Same | ✅ Same |
| H3 | "What's on my shopping list?" | ✅ LIST_READ → items read aloud | ✅ Same | ✅ Same |
| H4 | "Remove eggs from my shopping list" | ✅ LIST_REMOVE | ✅ Same | ✅ Same |

---

# 9. Action rules / email alerts

| # | Test | Mobile | Web | Voice |
|---|---|---|---|---|
| I1 | "Alert me when Sandra emails" | ✅ Inserts into `action_rules` (trigger_type=email, action_type=sms) | ✅ Same | ✅ Same (added today) |
| I2 | "When Sandra emails me, WhatsApp John" | ✅ SET_ACTION_RULE | ✅ Same | ✅ Same (added today) |
| I3 | Trigger test: have Sandra send an email → within ~6 min, Twilio SMS arrives at caller's phone | ✅ | ✅ | ✅ |

**Pass criteria (I3):** alert goes to the user's OWN phone number from `user_settings.phone`, not Wael's hardcoded number.

---

# 10. Daily briefing call (UPDATE_MORNING_CALL)

| # | Test | Mobile | Web | Voice |
|---|---|---|---|---|
| J1 | "Set my daily briefing to 8 am" | Action emitted but **mobile UI isn't wired for this yet** — check `user_settings.morning_call_time` in DB | Same | ✅ Voice IS wired — writes to `user_settings` |
| J2 | Wait for scheduled time → Twilio calls your phone → Naavi greets + reads brief | ⚠️ Requires morning_call_enabled=true | ⚠️ Same | ✅ This is voice's native feature |
| J3 | During the call, say "tell me about my Wednesday" | N/A | N/A | ✅ Should hear upcoming schedule |

**Pass criteria (J2):** call rings, Naavi speaks the greeting after pickup, tick sound fills silent gaps.

---

# 11. Voice server — phone call only

| # | Test | Voice |
|---|---|---|
| K1 | Call +1 249 523 5394 → Naavi greets you by name ("how can I help you Wael?") | Greeting uses YOUR name from `user_settings.name` based on caller ID |
| K2 | Soft ticking sound between greeting and your first question | Should be audible, low volume, every 0.8 s |
| K3 | "Are you still there?" prompt after ~30 s silence | Waits 30 s before prompting; resets on any speech |
| K4 | Say "goodbye" → Naavi says "Talk to you soon" + hangs up | |
| K5 | Say "remember my favorite team is the Senators" → then call again later and ask "what do I like" → should recall | |

---

# 12. Mobile-only features (not on web)

| # | Test | Mobile | Web |
|---|---|---|---|
| L1 | Hands-free mode (walkie-talkie) — "Hi Naavi" wake word | ✅ Hold button, say "Hi Naavi", Deepgram streams transcription | ❌ Shows "Hands-free mode is only available on mobile" error |
| L2 | Native contacts save to Android contact book | ✅ | ❌ Supabase-only save |
| L3 | Conversation recorder (external audio) — multi-speaker transcription via AssemblyAI | ✅ | ⚠️ Works if browser mic permission granted |
| L4 | Push notifications via FCM | ✅ (Android) | ⚠️ Works via Web Push, needs browser permission |
| L5 | Google Assistant deep links (brief / calendar / contacts App Actions) | ✅ | ❌ |

---

# 13. Web-only quirks

| # | Test | Web |
|---|---|---|
| M1 | Browser Back button works (SPA history) | ✅ |
| M2 | Session persists across browser restart | ✅ (Supabase stores session in localStorage) |
| M3 | Page doesn't blank on JavaScript errors | ✅ After today's fix with native-imports guard |

---

# 14. Multi-user safety (critical)

These tests catch regressions where one user's data leaks to another.

| # | Test | Expected |
|---|---|---|
| N1 | Sign in mobile as Wael, web as Huss simultaneously | Each surface shows only that user's data; no cross-leak |
| N2 | Voice: call from Wael's phone then from Huss's phone | Each call personalizes greeting, calendar, contacts to the correct user |
| N3 | Wael creates an event via voice → check mobile (Wael's login) | Event appears |
| N4 | Huss creates an event via voice → check Wael's mobile | Event does **NOT** appear in Wael's list |
| N5 | Both users trigger an email alert at the same time | Each gets SMS at their OWN phone number |

---

# 15. Known limitations / deferred work

These are expected to fail — do not report as bugs.

- `SET_EMAIL_ALERT` and `SET_ACTION_RULE` on voice — just landed today, may need live call to verify.
- Huss's Google token is revoked — his calendar is empty until he re-signs-in via mobile.
- Mobile AAB installed on phone is build 91, pre-dating today's post-sanity fixes. Next build will be V50 build 92.

---

# How to run a quick smoke test (15 minutes)

1. **Web** — open https://naavi-app.vercel.app in an incognito window, sign in. Check home page loads, type "what's on my calendar this week", verify reply.
2. **Mobile** — open the installed Naavi app. Do the same calendar query. Compare reply to web.
3. **Voice** — call +1 249 523 5394 from your phone. Ask "what's on my calendar tomorrow". Compare.
4. **Cross-check** — any divergence between the three answers is a bug.

If all three give consistent answers, the core loop is healthy.
