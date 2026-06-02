# Session Handoff — 2026-06-02 | Post-Build 226 | Staff Portal Login Blocked

## What Was Attempted This Session

### Staff Portal Login Fix
Goal: fix the staff portal magic link login that was redirecting back to the login form.

**Work done:**
- Fixed token hash parsing in `index.html` — replaced regex with `URLSearchParams(hash.substring(1))` (more reliable)
- Added `localStorage` session persistence — token saved on successful login, survives page refresh
- Added temporary debug bar to diagnose token parsing
- Fixed Supabase Site URL — was set to `wael.aggan@gmail.com` (an email address); corrected to `https://mynaavi.com`
- Configured Postmark SMTP in Supabase Auth — `smtp.postmarkapp.com`, port 587, `noreply@mynaavi.com` sender, Postmark server token as username + password
- Added `wael@mynaavi.com` to `support_staff` table (new staff member)
- Created `wael@mynaavi.com` as a Supabase auth user

**Result: FAILED — staff portal login still not working**

---

## Root Cause Investigation

### What works:
- Postmark SMTP is confirmed working ✅ — magic link email received from `MyNaavi <noreply@mynaavi.com>` signed by `mynaavi.com`
- Redirect IS happening to `staff.mynaavi.com` ✅
- Token IS arriving in the URL hash ✅
- `check-staff` returns `authorized: true` ✅ (confirmed from previous session)

### What fails:
- Every magic link click returns `otp_expired` error in the URL hash immediately
- URL on redirect: `staff.mynaavi.com/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`
- Link expires even when clicked immediately after receipt

### Suspected cause:
Supabase OTP expiry may be set to an extremely short value. The rate limits page was not reached (404 on auth/general). **Next session must check OTP expiry setting** in Supabase Auth settings.

Secondary possibility: Postmark is still in test/review mode — the account was submitted for review 20+ hours ago but not yet approved. In test mode, Postmark may be delivering emails but Supabase may be generating short-lived tokens for unverified flows.

---

## Postmark Status
- Account submitted for review 20+ hours ago — no approval yet as of session close
- SMTP IS delivering emails (confirmed)
- Once Postmark approves the account, can send to any external address (not just mynaavi.com domain)
- `mynaavi2207@gmail.com` (original staff account) will work once approved

---

## Supabase SMTP Config (saved, do not re-enter)
- Host: `smtp.postmarkapp.com`
- Port: `587`
- Sender: `noreply@mynaavi.com` / MyNaavi
- Username + Password: Postmark server token `9bb09416-c04c-4061-ab5a-491eb0efc527`
- Minimum interval: 60 seconds

---

## Staff Accounts in support_staff Table
- `mynaavi2207@gmail.com` — Naavi Support (original)
- `wael@mynaavi.com` — Wael Aggan (added this session)

---

## Next Session — Staff Portal Fix Priority

1. **Check OTP expiry** — go to Supabase Auth settings and find the OTP expiry value. If it's very short (< 60s), increase it to 3600 (1 hour).
   - Try: `https://supabase.com/dashboard/project/hhgyppbxgmjrwdpdubcx/auth/rate-limits` and scroll for OTP expiry
   - Or SQL: `SELECT * FROM auth.config` if accessible

2. **Check Postmark approval** — go to `https://account.postmarkapp.com` and check if "We're reviewing your account" banner is gone

3. **Remove debug bar** from `naavi-staff/index.html` once login is confirmed working

---

## Other Open Items (unchanged from prior handoff)

- Full Naavi functionality testing — not started this session
- Re-arm drive test — not done
- V226 production drive test — not done

---

## Repos
- Mobile app: `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: main)
- Website: `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website` (branch: main)
- Staff portal: `C:\Users\waela\OneDrive\Desktop\naavi-staff` (branch: main)
- Voice server: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server` (branch: main)
- Build clone: `C:\Users\waela\naavi-mobile` (branch: main)
