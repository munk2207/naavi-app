# Session Handoff — 2026-07-04
## V301 Shipped to Production · F10a + F2i Closed · F11a Queued Next (Full Governance)

---

## NEXT SESSION — FIRST TASK (DO THIS BEFORE ANYTHING ELSE)

**F11a — demo scenario content rebuild.** Full holding-list entry and rationale: `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` (search "F11a").

**One-line summary:** Wael asked Naavi itself "what are your top 5 capabilities" (zero-context test) and compared the answer against the current 1-888 demo line's 5 scenarios (today/bills/history/location/capture). Only "Location" is a clean match — proactive automation (email/weather/time-triggered alerts) and lists aren't represented in the demo at all, and cross-system retrieval + scheduling are shown weaker than Naavi's actual capability. The demo needs to be rewritten around Naavi's real top 5, not the current ad-hoc set.

**Before touching any code:**
1. This goes through the **full** Release Gate Workflow (`docs/AI_DEVELOPMENT_GOVERNANCE.md`, Phase 1-8) — including ChatGPT technical review before coding (Phase 3) and after coding (Phase 6). This is explicitly **NOT waived**, unlike F10a. It's a content/behavior rewrite of the live public demo line — Protected Core (voice orchestration).
2. Write Phase 1 (Problem Definition) formally — the comparison table and gap analysis already in the F11a holding-list entry is the **input material**, not Phase 1 itself. Reuse it, don't re-derive it, but do write the formal what's-broken/evidence/root-cause/alternatives structure before any code.
3. Also captured as a standing design policy in memory: `project_naavi_demo_capability_alignment_policy.md` — any future demo/marketing content should be checked against what Naavi itself says its capabilities are, not team assumption.

**Also unblocked, not urgent:** F9a (Google App Actions spike, 3 list built-in intents — add/read/create) was gated on "v300 production AAB confirmed." V301 (which supersedes v300) shipped and is confirmed in production this session — F9a can be picked up whenever, but F11a is the priority.

---

## What Happened This Session

### 1. Holding list hygiene — several stale entries corrected

Per the standing rule ("check code, not memory, before answering"), multiple holding-list entries were found stale and corrected against actual code/git state:
- **F8b, F8c, F8d** — all three were sitting in OPEN despite being fully shipped weeks ago (build 267, V286). Moved to Closed Features with evidence citations.
- **F9a** — scope expanded (documentation only, no build) to cover 3 Google Assistant list built-in intents instead of just add-item: `UPDATE_ITEM_LIST` (add), `GET_ITEM_LIST` (read), `CREATE_ITEM_LIST` (start new list). Location-alert-by-voice was investigated and explicitly ruled out (structurally unsafe without a confirmation step Google's App Actions can't provide, and Wael ruled out a touch-confirmation fallback).
- Two memory files were found stale/misleading (`project_f2b_staging_live_scenarios_next`, `project_next_session_priority`) and corrected — the latter's actual content (a compound-question bug from V275) didn't match its own index description at all, and had 15+ follow-up commits after it was written with the outcome never verified.

### 2. F10a — Feedback/ticket completeness (SHIPPED, CLOSED)

**Real bug found during audit:** `app/report.tsx` ("Report a problem") was completely unreachable from any UI — no menu entry routed to it despite its own header comment claiming it was — **and** it still posted to the retired Formspree endpoint (`https://formspree.io/f/mpqkkdep`) instead of `ingest-ticket`, missed in the 2026-05-20 migration.

**Shipped:**
- `app/report.tsx` — now POSTs to `ingest-ticket` (`source_channel: 'mobile-report'`), matching `contact.tsx`'s working pattern
- `app/help.tsx` — "Report a problem" row added back
- `app/index.tsx` — home-screen feedback banner. **Iterated per live device testing:** originally dismissible with AsyncStorage persistence (dismiss-once, gone forever), corrected to **always visible, no dismiss** — same recurring-reminder pattern as Today's Brief, since the point is reminding the user feedback is welcome every time, not showing it once. Copy: "Got feedback? Click here to tell the team"
- `mynaavi-website/shared.js` — homepage-only "Feedback" nav link (`isHome` check in `buildNav()`) — reviewed via a real Vercel preview branch (`feature/f10a-feedback`) before merging to main
- 5 new regression tests in `tests/catalogue/session-2026-07-03-f10a.ts`

**Governance:** Phase 1-2 done formally, Phase 3/6 (ChatGPT review) explicitly waived after Wael asked for a direct risk assessment (Low risk, no Protected Core touched) — not skipped silently. Phases 4, 5, 7, 8 followed. This distinction matters — see the F11a governance note above for why F11a doesn't get the same waiver.

**I4a** (Google Play star-rating prompt) — logged separately as an idea, not yet decided, not part of F10a's scope.

### 3. F2i — 888 Toll-Free Verification (SHIPPED, CLOSED)

TFV for `+18889162284` approved by Twilio 2026-07-03 — confirmed directly via Twilio's own API (`status: TWILIO_APPROVED`, channel endpoint assignment linked), not just taken on faith.

**Shipped:**
- Production demo-line SMS now sends from the 888 number itself (`getDemoEnvironment.js`), replacing the `+14313006228` workaround number used while verification was pending
- Both demo SMS templates (Recap + Reminder) now include "Call again: 1-888-91-NAAVI." as readable body text — note this is body text only; Twilio's Alphanumeric Sender ID (custom text as the "From") is **not supported in the US/Canada**, confirmed via Twilio docs
- `DEMO_SMS_FROM_NUMBER` Supabase secret (production) updated to the new number — this is a **separate config point** from the voice-server's own `getDemoEnvironment.js`, easy to miss (see bug below)
- `+14313006228` released by Wael in the Twilio console after confirming (via full codebase grep + call-flow tracing) nothing else depended on it
- **Dead code removed:** ~445 lines of the old digit/menu-based demo CTA flow (pre-F2b), confirmed unreachable before deletion by tracing the actual call entry point
- 68/68 voice-server tests still green after cleanup

### 4. Bug found + fixed — demo reminder silently failing (stuck on released number)

After releasing `+14313006228`, a reminder Wael had set earlier that day stopped arriving. Root cause: `create-demo-reminder`'s `DEMO_SMS_FROM_NUMBER` secret was a **separate** config point from the voice-server's `demoSmsFrom` — updating one didn't update the other. The reminder's `action_config.from_number` had the now-released number baked in at creation time.

Fixed: updated the secret, and directly patched the stuck row's `action_config.from_number`. Confirmed via code (`evaluate-rules/index.ts:169-178`) that failed sends never get dedup-logged, so the row was still safely retryable, not lost — next cron pass (within a minute) sent it successfully.

### 5. Second bug found + fixed — reminder label collision on same caller's 2nd reminder

A follow-up live-call test (asking for a second reminder, same name + phone as the first) got the generic "Sorry, I couldn't set that up." Root cause: `create-demo-reminder`'s label (`Demo reminder for {name} ({phone})`) was fixed on 2026-07-02 to stop *different* callers sharing a name from colliding — but the same caller's second reminder produces the *identical* label, hitting the same `action_rules` unique-index rejection. Any real caller phoning the demo line twice would hit this.

Fixed: label now also includes `fire_at` (the scheduled date+time), so two reminders only collide if they share name, phone, AND the exact same scheduled time — a genuine duplicate. Deployed to staging then production. 1 new regression test.

### 6. Production build — V1.0.301 shipped

- Found and fixed a version drift: `app.json`'s `versionCode` was stuck at 299 while the actual last-shipped build (confirmed by Wael's device) was 300 — `version` had been bumped without a matching `versionCode` bump in a prior session.
- Bumped to `version: 1.0.301`, `versionCode: 301`, display "V57.75.0 (build 301)".
- All 3 gates run and verified (not just trusted):
  - **Gate 1 (auto-tester):** 359/361 passed, 0 failed, 2 pre-existing unrelated OAuth skips
  - **Gate 2 (voice regression):** included in the same auto-tester run
  - **Gate 3 (Firebase Test Lab):** used the **existing** staging APK (no need to build a separate "preview" profile APK — Firebase Test Lab tests hardware/OS compatibility, which doesn't depend on which backend the app points at). Verified directly against Google's Test Lab API (not just the SMS): `outcomeSummary: "SUCCESS"`, both devices (Pixel 6 / Android 13, Samsung Galaxy S22 / Android 14) `FINISHED` clean.
- Production AAB built and auto-submitted: `App Version 1.0.301, Version code 301`, submitted to Google Play Internal Testing.
  - Build: `expo.dev/accounts/waggan/projects/naavi/builds/13138210-7397-433b-90f6-4924c541bfa0`
  - Submission: `expo.dev/accounts/waggan/projects/naavi/submissions/f789fb0c-afa3-41f0-84fc-a4b2c41765d2`

---

## Git State

| Repo | Branch | Notes |
|---|---|---|
| `naavi-app` | `main` @ `7a9cd06` | Clean — all session work committed and pushed |
| `naavi-voice-server` | `main` @ `eb10698` | F2i number switch + dead code cleanup |
| `mynaavi-website` | `main` @ `7a8b8b4` | F10a Feedback link + 2 blog-post 404 redirects (SEO fix); `feature/f10a-feedback` branch merged and deleted |
| `naavi-mobile` (build clone) | `main`, synced to `naavi-app` `main` | Used for the V1.0.301 build |

---

## Build State

| Item | Status |
|---|---|
| Staging APK | V1.0.301 (build 301) — tested and approved by Wael on device |
| Production AAB | **Shipped** — V1.0.301 (versionCode 301), submitted to Google Play Internal Testing |
| Firebase Test Lab | PASSED (verified via API, not just SMS) — `matrix-1m6kfusrirohn` |

---

## Auto-Tester

361 tests · 359 passed · 0 failed · 2 expected SKIPs (Google OAuth — test account not signed in for Contacts/Calendar)
Last run: 2026-07-04, this session.

Voice-server (`naavi-voice-server`, separate `npm test`): 68/68 passed.

---

## Small Known Issue, Not Blocking

`scripts/submit-firebase-test.js` prints `outcome=undefined` per-device in its own log output — cosmetic bug in the script's own parsing (reading a field that isn't in the per-execution API response). The real result is `outcomeSummary` at the matrix level, which is accurate. Worth fixing the script's parsing at some point so it doesn't cause confusion again, but doesn't affect the actual verified result.

---

## Do Not Touch

- `archive/` branches — read-only
- `feature/app-actions-spike` — no implementation yet, F9a not started (though now unblocked)
- I4a (Google Play star-rating prompt) — logged as an idea only, not decided, not scheduled
