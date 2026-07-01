# Session Handoff — 2026-07-01
## V300 Production AAB Submitted · F2b Demo Line Spec Written · Next: Build F2b

---

## NEXT SESSION — FIRST TASK (DO THIS BEFORE ANYTHING ELSE)

**Build F2b — Zero-Friction Demo Line.**

Full spec is in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` under F2b (status: ready to build).

Follow the AI Development Governance v2.1 phases in order:
1. **Phase 1** — Problem definition already done (spec is the evidence)
2. **Phase 2** — Write the full change plan (files, classifications, regression impact table)
3. **Phase 3** — Send plan to ChatGPT for review before writing code (Medium/High risk — touches voice server + SMS + new table + cron job)
4. **Phase 4** — Implement only the approved plan
5. **Phase 5** — Evidence package
6. **Phase 6** — ChatGPT review of git diff
7. **Phase 7** — Manual test: make a real call to demo line, confirm SMS arrives at the right time
8. **Phase 8** — Merge to staging

---

## What Happened This Session

### 1. V300 Manual Tests — Confirmed Passed

Wael confirmed V300 Samsung S23 manual tests complete. All 5 cases passed (M1–M5).

---

### 2. All Three Production Gates — Passed

| Gate | Result |
|---|---|
| Gate 1 — Auto-tester | ✅ 351 passed · 0 failed · 2 expected SKIPs |
| Gate 2 — Voice regression | ✅ Confirmed by Wael |
| Gate 3 — Firebase Test Lab | ✅ Confirmed by Wael |

---

### 3. V300 Production AAB — Submitted to Google Play

| Item | Value |
|---|---|
| Version | 1.0.300 |
| Version code | 299 |
| Track | Internal Testing |
| EAS Build ID | `906dfcbf-cdbc-4731-a3fe-afda83dc76a6` |
| Submitted | 2026-07-01 4:52 AM EST |

Install from Google Play Internal Testing when available (5–15 min lag).

---

### 4. Voice Server — Supabase Target Confirmed

The Railway voice server points to **production** (`hhgyppbxgmjrwdpdubcx`). When Wael tests voice on the staging APK, the voice server always hits production data. Staging APK only isolates mobile app direct Supabase calls — not the voice path.

---

### 5. F2b Demo Line — Full Spec Written

Full spec written to holding list F2b (status: ready to build). Summary of the concept:

**Goal:** A complete stranger calls 1-888-91-NAAVI and in under 60 seconds experiences Naavi doing one real thing for them personally. The call ends with a real SMS arriving at a time they chose. That SMS carries the install link. No app, no account, no friction.

**Why this works as marketing:**
- Not a simulation — the reminder actually fires at the exact time the caller chose
- The caller set it themselves in natural language — that IS the product
- When the SMS arrives hours later, it re-triggers the memory of the call
- The install link is in that SMS — conversion happens at the moment of maximum impact

**Key design decisions made this session:**
- No fake data — honesty builds trust
- No persistent floating profile — this is first-touch marketing, not a feature demo
- One real action (reminder) is enough to demonstrate the product
- Caller's phone number (from Twilio) is the only identity — no sign-up required
- Write actions scoped to demo only — no touching production accounts
- TCPA compliance — STOP opt-out in every SMS

**Full call flow:**

Phase 1 — Name capture with 3-attempt loop (confirm → retry → spell)

Phase 2 — Context line: *"People use me to remember things, manage their calendars, organize tasks, and stay on top of life — all by voice. Let's try it together."* → reminder ask → time extraction → optional message → confirm → call ends

Phase 3 — SMS fires at exactly the time caller chose:
*"Hi [Name], it's Naavi. You asked me to remind you now. Want me to help with more than reminders? I can organize your calendar, remember things you tell me, and help you stay on top of life — all by voice. Connect your account here: [install link] Reply STOP to opt out."*

**Telemetry tracked:** calls started, name captured, reminder created, reminder delivered, SMS link clicked, account connected. App install attribution is limited (Google Play aggregate only; exact match only if caller signs up with same phone number).

**Post-launch Phase 2 (not in v1):** SMS ends with "Reply HELP to see what else Naavi can do."

**What gets built (server only — no AAB):**
1. Demo call path in voice server — separate branch keyed to demo line number
2. Name capture loop — STT → confirm → retry → spell → confirm
3. Time extraction — natural language → absolute `fire_at` timestamp
4. Optional message capture
5. `demo_reminders` table: `(id, phone, name, fire_at, message, opted_in, sent, click_count, created_at)` — 30-day TTL
6. `demo_optouts` table: `(phone, created_at)`
7. Cron job — checks every minute, fires SMS at `fire_at`, marks sent
8. STOP opt-out handling
9. Redirect endpoint — `mynaavi.com/demo?ref=sms&phone=<hashed>` logs click, forwards to Play Store

**Regression risk areas:**
- Voice commands — AFFECTED (new demo call path)
- Reminders — AFFECTED (new table + cron alongside existing engine)
- SMS / call alerts — AFFECTED (new SMS send path)
- Geofencing, Gmail, Calendar, Onboarding, Staging build — NOT affected

---

### 6. App Actions Spike (F9a) — Status

Branch `feature/app-actions-spike` exists from tag `v300`. Not started. Unblocked now that V300 production AAB is submitted. Next session priority is F2b — F9a follows after.

---

## Git State

| Branch | HEAD | Status |
|---|---|---|
| `main` | `1afa193` | Clean |
| `feature/app-actions-spike` | `be652d1` (= v300 tag) | Ready — no implementation yet |
| `v300` tag | `be652d1` | Pushed |

---

## Auto-Tester

353 tests · 351 passed · 0 failed · 2 expected SKIPs (Google OAuth)
Last run: 2026-07-01 this session.

---

## Do Not Touch

- `archive/` branches — read-only
- Production Supabase (`hhgyppbxgmjrwdpdubcx`) — F2b demo reminders go to staging first
- `feature/app-actions-spike` — starts after F2b is shipped
