# Session Handoff — 2026-06-02 | Staff Portal Login — FIXED

## Status: WORKING ✅

After 3 sessions of investigation, the staff portal login at https://staff.mynaavi.com is fully working.

---

## Root Cause (confirmed)

**Gmail pre-fetches magic links before the user clicks them.** This burns the one-time token instantly, making every magic link arrive already expired (`otp_expired`). This was the root cause from the very beginning — 3 sessions were spent on wrong fixes because the OTP expiry setting (3600 seconds — correct) was not checked until this session.

---

## What Was Fixed This Session

### Fix 1 — Switched from magic link to 8-digit OTP code
- **Problem:** Gmail's link scanner clicks the magic link before the user does, burning the token.
- **Solution:** Changed the email template to use `{{ .Token }}` (8-digit code) instead of `{{ .ConfirmationURL }}` (clickable link). Gmail cannot pre-fetch a code.
- **How:** Supabase dashboard UI was broken (subject field reverted on every save). Used the Supabase Management API instead:
  ```powershell
  $body = @{
    mailer_subjects_magic_link = "MyNaavi Staff Login Code"
    mailer_templates_magic_link_content = "<h2>Your login code</h2><p>Enter this code to sign in to the MyNaavi Staff Portal:</p><h1 style='letter-spacing:0.3em; font-size:36px;'>{{ .Token }}</h1><p>This code expires in 1 hour.</p>"
  } | ConvertTo-Json
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/hhgyppbxgmjrwdpdubcx/config/auth" -Method Patch -Headers @{ Authorization = "Bearer $TOKEN"; "Content-Type" = "application/json" } -Body $body
  ```
- **OTP length:** Supabase sends **8-digit codes** by default (`mailer_otp_length: 8`). The form must accept 8 digits.
- **Verify endpoint:** `POST /auth/v1/verify` with `{ email, token, type: 'email' }`. The type `'magiclink'` is deprecated — use `'email'`.

### Fix 2 — check-staff Edge Function CORS header
- **Problem:** After OTP verify succeeded (200), the call to `check-staff` failed with a CORS error because the function's allowed headers list was missing `apikey`.
- **Solution:** Added `apikey` to the CORS headers in `supabase/functions/check-staff/index.ts`:
  ```typescript
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
  ```
- **Deployed:** `npx supabase functions deploy check-staff --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx`

### Fix 3 — Postmark token security incident
- **Problem:** The old Postmark server token (`9bb09416-c04c-4061-ab5a-491eb0efc527`) was committed to GitHub inside `docs/SESSION_HANDOFF_2026-06-02_BUILD226_STAFF_LOGIN_BLOCKED.md`. GitGuardian flagged it.
- **Resolution:** Token revoked in Postmark. New token generated. Supabase SMTP password updated via dashboard. GitGuardian confirmed revoked.
- **New token location:** Supabase SMTP settings only — never commit tokens to any file.

### Fix 4 — Supabase Site URL
- **Was:** `wael.aggan@gmail.com` (incorrect — set from a previous broken session)
- **Now:** `https://mynaavi.com` (correct)
- **Set via:** Management API (dashboard save was broken/greyed out)

---

## Current Staff Portal Architecture

### Login Flow
1. User visits https://staff.mynaavi.com
2. Enters staff email → clicks "Send code"
3. Supabase sends 8-digit OTP code via Postmark SMTP (noreply@mynaavi.com)
4. User enters code → clicks "Sign in"
5. Portal calls `POST /auth/v1/verify` with `{ email, token, type: 'email' }`
6. On success, gets `access_token`
7. Portal calls `check-staff` Edge Function with the token
8. `check-staff` verifies email is in `support_staff` table with `active: true`
9. If authorized → shows Staff Portal dashboard

### Authorized Staff Emails (support_staff table)
- `mynaavi2207@gmail.com` — Naavi Support (original)
- `wael@mynaavi.com` — Wael Aggan

### Key Supabase Settings (confirmed working)
- `mailer_otp_length`: 8 digits
- `mailer_otp_exp`: 3600 seconds (1 hour)
- `mailer_subjects_magic_link`: "MyNaavi Staff Login Code"
- `mailer_templates_magic_link_content`: uses `{{ .Token }}` only — no link
- `site_url`: https://mynaavi.com
- SMTP: smtp.postmarkapp.com / port 587 / sender: noreply@mynaavi.com

### Repos
- Staff portal: `C:\Users\waela\OneDrive\Desktop\naavi-staff` (GitHub: munk2207/naavi-staff, branch: main)
- Edge Function: `C:\Users\waela\OneDrive\Desktop\Naavi\supabase\functions\check-staff\index.ts`

---

## What NOT to Do If Login Breaks Again

1. **Do NOT change the OTP expiry** — it is 3600 seconds which is correct.
2. **Do NOT switch back to magic links** — Gmail will burn them instantly.
3. **Do NOT use the Supabase dashboard to edit the email template subject** — the UI is broken and reverts on save. Use the Management API.
4. **Do NOT commit any Postmark/API tokens to any file** — GitGuardian monitors the repo.

## If Login Breaks — Diagnostic Steps
1. Open DevTools → Network tab → attempt login → check which call fails
2. If `verify` fails → OTP issue (wrong code, expired, wrong type param)
3. If `check-staff` fails with CORS → redeploy the Edge Function
4. If `check-staff` returns `authorized: false` → check `support_staff` table for the email

---

## Postmark Status
- Account submitted for approval 20+ hours ago — still in test mode as of this session
- SMTP delivers emails confirmed working
- Once approved: `mynaavi2207@gmail.com` will work as a staff login email again
