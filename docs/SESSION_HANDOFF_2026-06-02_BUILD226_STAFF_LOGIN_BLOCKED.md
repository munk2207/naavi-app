# Session Handoff — 2026-06-02 | Post-Build 226 | Staff Portal Login — STILL BROKEN

## Honest Summary

The staff portal login was broken at the start of this session. It is still broken at the end. Nothing was fixed.

---

## What Was Attempted (and failed)

1. **Token hash parsing rewrite** — replaced regex with `URLSearchParams(hash.substring(1))`. Did not fix login.

2. **Added localStorage session persistence** — token saved on successful login. Irrelevant since login never succeeds.

3. **Added debug bar** — confirmed the page is loading fresh code. The bar showed the hash contains `otp_expired` error, not an `access_token`.

4. **Fixed Supabase Site URL** — was set to `wael.aggan@gmail.com`. Corrected to `https://mynaavi.com`. Did not fix login.

5. **Configured Postmark SMTP** — email delivery now confirmed working (magic link arrives from `noreply@mynaavi.com`). But every link arrives already expired (`otp_expired` error in hash).

6. **Added `wael@mynaavi.com` to support_staff** — to work around Postmark test-mode restriction. Did not fix login.

7. **Created `wael@mynaavi.com` as Supabase auth user** — to unblock "Signups not allowed for otp" error. Did not fix login.

---

## Actual Root Cause — NOT YET IDENTIFIED

Every magic link arrives with `otp_expired` immediately on click. The OTP expiry setting in Supabase has not been found or checked. This is the most likely root cause and was not resolved this session.

**Next session must do this first:**
- Find the OTP expiry setting in Supabase Auth
- If it is set abnormally short, increase it to 3600 seconds (1 hour)
- Try: `https://supabase.com/dashboard/project/hhgyppbxgmjrwdpdubcx/auth/rate-limits` and scroll to find OTP expiry

---

## Postmark Status
- Account submitted for review 20+ hours ago — not yet approved
- SMTP delivers emails (confirmed) but Postmark is still in test mode
- Once approved: `mynaavi2207@gmail.com` will work as a staff login email again

---

## Staff Accounts in support_staff Table
- `mynaavi2207@gmail.com` — Naavi Support (original)
- `wael@mynaavi.com` — Wael Aggan (added this session)

---

## Supabase SMTP Config (in place)
- Host: `smtp.postmarkapp.com` / Port: `587`
- Sender: `noreply@mynaavi.com` / MyNaavi
- Username + Password: Postmark server token `9bb09416-c04c-4061-ab5a-491eb0efc527`

---

## Other Open Items (unchanged)
- Full Naavi functionality testing — not started
- Re-arm drive test — not done
- V226 production drive test — not done
- Debug bar still in `naavi-staff/index.html` — remove once login works

---

## Repos
- Mobile app: `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: main)
- Website: `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website` (branch: main)
- Staff portal: `C:\Users\waela\OneDrive\Desktop\naavi-staff` (branch: main)
- Voice server: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server` (branch: main)
- Build clone: `C:\Users\waela\naavi-mobile` (branch: main)
