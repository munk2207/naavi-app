# Session Handoff — 2026-06-21
## Compound Question Debugging — In Progress

---

## Context

Staging APK V278 is the active build. All work targets staging Supabase (`xugvnfudofuskxoknhve`). Production untouched.

All 6 compound sub-questions were tested and **passed individually** in this session.  
When tested as a **compound question**, most failed.

---

## Fixes Deployed This Session (Server-Side, Staging)

### Fix 1 — Reminders silent fail in compound flow
- **Root cause:** `SET_ACTION_RULE(time)` returned to client → client wrote `action_rules` with user-JWT → RLS blocked it.
- **Fix:** Server-side execution in `naavi-chat/index.ts` after actions array built — intercepts `SET_ACTION_RULE(time)` and saves with `adminClient` (service_role), bypassing RLS.

### Fix 2 — Reminders creating unwanted calendar events
- **Root cause:** `handleSetReminderExec` in `intentHandlers.ts` called `create-calendar-event` Edge Function after saving to `action_rules`.
- **Fix:** Removed the calendar event creation block entirely from `handleSetReminderExec`. Reminders are now time alerts only.

### Fix 3 — Duplicate email (EMAIL SENT TO SARAH appearing twice)
- **Root cause:** In compound mode, when Claude processed "yes" for item 2 (CREATE_EVENT), it re-emitted `draft_message` tool (item 1 — already done).
- **Fix:** Added ANTI-DUPLICATE RULE to RULE 24 in `get-naavi-prompt` v130:  
  `PROMPT_VERSION = '2026-06-21-v130-compound-no-duplicate-tools'`

---

## Bugs Still Open — Confirmed in Post-Fix Test

### Bug A — Phone numbers shown in email disambiguation
- **Observation:** When Naavi disambiguated "Sarah" for an email action, it showed phone numbers instead of email addresses.
- **Screenshot evidence:** "1. Sarah Davidson (+1 542-369-5684) 2. sarah James ((613) 797-6746) 3. mynaavi Demo ((613) 824-1928)"
- **Note:** The email WAS ultimately resolved correctly (screen 4 showed `aggan2207@gmail.com`). The contact data has email — Claude displayed the wrong field (phone instead of email) in the disambiguation list.
- **Root cause:** Claude showing phone numbers instead of email addresses for email disambiguation. Fix likely a prompt change.
- **Status:** OPEN — direction to be determined next session.

### Bug B — "Twice yes" (DraftCard [Send] + typing "yes")
- **Observation:** To complete item 1 (email Sarah) in compound mode, user had to both tap [Send] on the DraftCard AND type "yes" to advance the compound flow.
- **Root cause:** DraftCard [Send] sends email client-side. Typing "yes" advances compound flow server-side. Two separate interactions for one compound item.
- **Fix options:**
  1. APK: When DraftCard [Send] is tapped in compound mode, auto-submit "yes" to advance the flow.
  2. Server-only: Send email server-side on "yes" (no DraftCard shown in compound mode) — requires Step 1.4 DRAFT_MESSAGE handler + compound flow continuation logic (complex).
- **Status:** OPEN — direction to be determined next session.

---

## Full Compound Test — Status Per Item

| Item | Description | Status |
|------|-------------|--------|
| 1 | Email Sarah | Passed (email sent to sarah James aggan2207@gmail.com) — but "twice yes" UX issue |
| 2 | Book meeting with Bob | Needs re-verify |
| 3 | Gym reminder | Needs re-verify (was silently failing before Fix 1) |
| 4 | Work list at office | Needs re-verify |
| 5 | Jasmine reminder one day before | Needs re-verify |
| 6 | James home info | Needs re-verify |

---

## What Happened Before Fixes (V278 Initial Test)

- Sarah email: Passed
- Gym time alert: Created without date
- All reminders: Failed silently
- Bob calendar: Failed
- Fix 1 + Fix 2 + Fix 3 deployed server-side (no APK rebuild)

---

## Next Session Priorities

1. Re-run the full compound question test on the same V278 APK (server fixes are live on staging).
2. Confirm which items pass now with fixes deployed.
3. Fix Bug A (phone vs email in disambiguation).
4. Fix Bug B (twice yes).
5. Once all 6 items pass in compound mode → build V279 staging APK.

---

## Active Build Info

| Field | Value |
|-------|-------|
| APK version | V278 (versionCode 278) |
| Build profile | staging |
| Supabase | staging `xugvnfudofuskxoknhve` |
| Prompt version | `2026-06-21-v130-compound-no-duplicate-tools` |
| Branch | main |
