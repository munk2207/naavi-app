# MyNaavi Pre-Invite Smoke Test

**Purpose.** Run through this checklist *before* a new tester is invited to use MyNaavi in real life. Each row is one test. Tick `Pass` or `Fail` after observing the **Expected result**. If anything fails, fix it before letting the tester go live. The test takes ~25 minutes if everything works, longer if not.

**Who runs it.** Wael (or a designated helper) drives the test alongside the new tester. The tester holds their phone; Wael reads each step aloud and checks the result. Some Phase C steps require admin access (database queries) — those are flagged `(admin)`.

**Setup before starting.**
- New tester has an Android phone with Google Play installed.
- Tester is signed into their personal Google account on the phone.
- Tester has been added to the MyNaavi Internal Testing list in Play Console.
- Tester knows their preferred wake phrase, primary mobile number, home address, and work address before starting.

---

## Phase A — Account Setup (~12 steps, ~10 min)

| # | Step | What to do | Expected result | Pass/Fail | Comments |
|---|---|---|---|---|---|
| A1 | Install app | Open the Internal Testing URL on the tester's phone. Tap **Install** in Google Play. Wait until install finishes (Open button appears). | App listed in launcher as "MyNaavi". Opens to a sign-in screen without crashing. | ☐ Pass &nbsp;☐ Fail | |
| A2 | Sign in with Google | Tap **Sign in with Google** → pick the tester's personal Google account → grant the requested permissions on the Google consent screen. | Home screen appears ("MyNaavi" logo top-left, "TODAY'S BRIEF" section visible). No error banners. | ☐ Pass &nbsp;☐ Fail | |
| A3 | Allow notifications | When Android pops up the notification permission request, tap **Allow**. | No error. Test by: Settings (Android) → Apps → MyNaavi → Notifications → ON. | ☐ Pass &nbsp;☐ Fail | |
| A4 | Allow location "all the time" | When Android pops up location request, choose **Allow all the time** (NOT "While using the app"). If only "While using" was offered first, go to Settings → Apps → MyNaavi → Permissions → Location → change to "Allow all the time". | Settings (Android) → Apps → MyNaavi → Permissions → Location reads "Allow all the time". | ☐ Pass &nbsp;☐ Fail | |
| A5 | Allow microphone | Tap the mic button on the home screen once. When Android asks for mic permission, tap **Allow**. | Mic permission granted. Tester can tap mic and it lights up (no permission prompt next time). | ☐ Pass &nbsp;☐ Fail | |
| A6 | Allow contacts | In Settings (MyNaavi) → tap "Connect contacts" if shown. When Android asks, tap **Allow**. | Settings (Android) → Apps → MyNaavi → Permissions → Contacts: Allowed. | ☐ Pass &nbsp;☐ Fail | |
| A7 | Battery Optimization OFF | The app should show an in-app prompt on launch. Tap **Continue** → in the Android dialog, tap **Allow**. If the prompt didn't show: Settings (Android) → Apps → MyNaavi → Battery → Unrestricted. | Settings → Apps → MyNaavi → Battery reads "Unrestricted" (NOT "Optimized"). | ☐ Pass &nbsp;☐ Fail | |
| A8 | First name | In MyNaavi → tap the three-dot menu top-right → tap **Settings** → tap **Your name** → type the tester's first name → tap save/done. | The name is persisted (close + reopen Settings, name still there). | ☐ Pass &nbsp;☐ Fail | |
| A9 | Home address | Settings → **Home address** → type the tester's home address. If multiple results appear, pick the correct one from the list. | Address shows under "Home address" with a checkmark. NOT a generic city-level entry. | ☐ Pass &nbsp;☐ Fail | |
| A10 | Work address (optional, skip if no work) | Settings → **Work address** → type address → pick correct one. | Address shows under "Work address" with a checkmark. | ☐ Pass &nbsp;☐ Fail &nbsp;☐ N/A | |
| A11 | Backup phone numbers (optional) | Settings → **Phone numbers** → tap **+** → enter a second number the tester might call from (spouse's phone, landline). Each gets auto-saved on tap-✓. | Each number appears in the list and persists across app restart. | ☐ Pass &nbsp;☐ Fail &nbsp;☐ N/A | |
| A12 | 4-digit PIN | Settings → **Voice PIN** → tap **Set PIN** → enter a 4-digit number → confirm. | "PIN set" confirmation. Tester writes the PIN down somewhere safe. | ☐ Pass &nbsp;☐ Fail &nbsp;☐ N/A | |

---

## Phase B — Core Feature Sanity (~14 steps, ~10 min)

Each command in this phase: tap the mic on the home screen, wait for the listening indicator, speak the phrase, release. Wait for MyNaavi to respond. Tester confirms the result on their own phone (not Wael's).

| # | Step | What to say | Expected result | Pass/Fail | Comments |
|---|---|---|---|---|---|
| B1 | Calendar read | "What's on my calendar today?" | MyNaavi speaks today's events back. If no events: she says "Nothing on your calendar today" (or similar). NO error. | ☐ Pass &nbsp;☐ Fail | |
| B2 | Create timed event | "Add a meeting tomorrow at 3 PM" | MyNaavi confirms ("Done — added Meeting tomorrow at 3 PM"). Open Google Calendar on the tester's phone → event "Meeting" appears tomorrow at 3:00 PM. | ☐ Pass &nbsp;☐ Fail | |
| B3 | Create all-day event | "Add Mother's Day on May 11" (or any holiday phrasing with a date) | MyNaavi confirms. Open Google Calendar → event appears as a **green all-day banner on May 11**, NOT as a timed event at 8 PM May 10. | ☐ Pass &nbsp;☐ Fail | |
| B4 | One-shot reminder | "Remind me in 2 minutes to drink water" | MyNaavi confirms ("Done — I'll remind you in 2 minutes"). Approximately 2 minutes later: phone rings AND a notification appears AND an SMS arrives AND an email arrives. | ☐ Pass &nbsp;☐ Fail | |
| B5 | Set location alert | "Alert me when I get home to take the trash out" | MyNaavi reads the alert back and asks Yes or No. Tester says **Yes**. MyNaavi confirms "Done". | ☐ Pass &nbsp;☐ Fail | |
| B6 | Location alert fires on arrival | After step B5, tester leaves home (drive away at least 1 km), then drives back. Phone is in pocket, screen off. | Within 30–60 seconds of arriving home: phone rings AND SMS arrives AND notification appears AND email arrives. All four. | ☐ Pass &nbsp;☐ Fail | |
| B7 | Quadruple-channel self-message | "Text me 'hello from MyNaavi'" | Within 60 seconds: SMS arrives at tester's phone AND WhatsApp message arrives AND email arrives AND a notification appears in MyNaavi. All four channels. | ☐ Pass &nbsp;☐ Fail | |
| B8 | Contact lookup | "Look up [name of a real contact the tester has]" | MyNaavi reads back the contact's phone number AND email (whichever Google Contacts has on file). | ☐ Pass &nbsp;☐ Fail | |
| B9 | Memory save | "Remember that my Costco card number is 12345" | A "Saved to memory" card briefly appears on screen. Later: "What's my Costco card number?" → MyNaavi reads back the right number. | ☐ Pass &nbsp;☐ Fail | |
| B10 | List create + add | "Add milk to my grocery list" | MyNaavi confirms. Three-dot menu → **Lists** → "Grocery" list exists with "milk" as an item. | ☐ Pass &nbsp;☐ Fail | |
| B11 | Three-dot menu opens | Tap the three-dot icon top-right of the home screen. | Dropdown appears with: Alerts, Lists, Notes, Info, Help, Settings. | ☐ Pass &nbsp;☐ Fail | |
| B12 | Each menu item navigates | Tap each menu item in turn (Alerts, Lists, Notes, Info, Help, Settings), going back to the home screen between each. | Each tap opens the matching screen (Alerts shows the alert from B5; Lists shows the grocery list; Notes shows an empty Notes screen; Info opens the integrations modal; Help opens the help screen; Settings opens Settings). NO menu item silently closes and returns to home. | ☐ Pass &nbsp;☐ Fail | |
| B13 | Today's brief refresh | Go back to home screen. Pull-to-refresh OR close the app and reopen. | TODAY'S BRIEF section reads "WEATHER 1+" and "CALENDAR N+" with a count, NOT errors or blank. The N count for CALENDAR should reflect the events created in B2 and B3. | ☐ Pass &nbsp;☐ Fail | |
| B14 | Cleanup created items | Delete the test items: in Google Calendar delete the "Meeting" event from B2 and "Mother's Day" from B3. In MyNaavi: three-dot menu → Lists → swipe-delete the milk item. Settings → Alerts → swipe-delete the "go home" alert from B5. | All test items removed. Brief and Lists screens reflect the empty state. | ☐ Pass &nbsp;☐ Fail | |

---

## Phase C — Backend + Voice Call (~8 steps, ~5 min)

| # | Step | What to do | Expected result | Pass/Fail | Comments |
|---|---|---|---|---|---|
| C1 | **(admin)** OAuth token valid | Run from Wael's machine: `curl -X POST https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/get-naavi-prompt -H "Authorization: Bearer sb_publishable_Aq3x_es0Eh3WJcLJOV9l9g_gt0G0gUQ" -H "Content-Type: application/json" -d '{"user_id":"<NEW_TESTER_USER_ID>"}'` | HTTP 200 + JSON body with `prompt` field present. NO `"invalid_grant"` error. | ☐ Pass &nbsp;☐ Fail | |
| C2 | **(admin)** user_settings row | Supabase Dashboard → Table Editor → `user_settings` → filter `user_id = <NEW_TESTER_USER_ID>`. | Exactly one row exists. Columns present: `name`, `phone`, `home_address`, `work_address`. NONE of those four are NULL. | ☐ Pass &nbsp;☐ Fail | |
| C3 | **(admin)** user_tokens row | Supabase Dashboard → `user_tokens` → filter `user_id = <NEW_TESTER_USER_ID>` AND `provider = google`. | Exactly one row exists with `refresh_token` populated (length > 50 characters). | ☐ Pass &nbsp;☐ Fail | |
| C4 | Voice call answers | Tester calls **+1 249 523 5394** from their primary mobile number. | Within 5 seconds, MyNaavi answers: "Hi [first name]". Tester is greeted by name, not "Hi there" or silence. | ☐ Pass &nbsp;☐ Fail | |
| C5 | Voice command on call | On the same call, after MyNaavi greets: "What's on my calendar today?" | MyNaavi reads back today's events with natural pauses between sentences. NO long silence, NO digit-by-digit reading of dates, NO "I didn't catch that". | ☐ Pass &nbsp;☐ Fail | |
| C6 | Voice call ends cleanly | Say "Goodbye" or "Hang up". | MyNaavi says a brief farewell ("Talk to you later" or similar) and ends the call within ~5 seconds. Phone returns to home screen. | ☐ Pass &nbsp;☐ Fail | |
| C7 | PIN flow (if PIN set in A12) | Tester calls **+1 249 523 5394** from a number NOT in their phone_numbers list (e.g., a friend's phone, a landline). | MyNaavi asks for the 4-digit PIN. Enter the correct PIN. MyNaavi greets them by name and lets them in. | ☐ Pass &nbsp;☐ Fail &nbsp;☐ N/A | |
| C8 | **(admin)** sent_messages logged | Supabase Dashboard → `sent_messages` → filter `user_id = <NEW_TESTER_USER_ID>` ordered by sent_at desc. | At least 4 recent rows for the test session: one each for channels `sms`, `whatsapp`, `email`, `push`. Reflecting the self-message in B7. | ☐ Pass &nbsp;☐ Fail | |

---

## Result

**All rows Pass** → tester is cleared to use MyNaavi in real life. Send them the welcome message + the [help section](https://mynaavi.com/help/) link.

**Any row Fail** → do NOT invite the tester yet. Fix the failing item, re-run that row, then continue. If the failure is a code bug (not a setup issue), file it on the holding list in `CLAUDE.md` and decide whether to ship a fix before continuing the invite cycle.

**Sign-off**

| | Name | Date | Phone last 4 |
|---|---|---|---|
| Tester | | | |
| Wael | | | |

---

*Last updated: 2026-05-17. Update this doc whenever a new feature ships that needs sanity-checking on new accounts.*
