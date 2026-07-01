# F2b — Phase 2 Change Plan: Zero-Friction Demo Line Reminder

Governance: AI_DEVELOPMENT_GOVERNANCE.md v2.1, Phase 2 (Change Planning).
Spec source: `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, row F2b.
Prior phase: Phase 1 (problem definition) — done, spec is the evidence (no code written yet).

---

## 0. Grounding — what already exists (read directly from source, this session)

The demo line is **not greenfield**. Confirmed by reading `naavi-voice-server/src/index.js`:

- Multi-number call routing already works: `isDemoCall` detection on `req.body.To` (`index.js:6334-6343`), config `DEMO_TWILIO_NUMBER` / `DEMO_USER_ID` (`index.js:105-114`), live number `+18889162284` (`index.js:6801`).
- A working 3-attempt name-capture-and-confirm TwiML loop already exists (`index.js:6720-7284`) — Gather → sanitize → confirm → redirect. This is the pattern the new reminder-time capture will follow.
- A CTA SMS with an install link already sends today via a **direct Twilio REST call** (not through `send-sms`), from a dedicated demo sender number `DEMO_SMS_FROM = '+14313006228'` (`index.js:6808`, `sendDemoCtaSms` at `index.js:7078-7111`).
- **No natural-language time parser exists anywhere in the codebase.** All time resolution today happens inside Claude's prompt (`get-naavi-prompt/index.ts:602`). The demo call flow deliberately has **zero LLM calls** (explicit design choice, comment at `index.js:6787-6788`: avoids "STT loops and LLM hallucinations").
- **No SMS opt-out enforcement exists anywhere**, for any SMS in the app. `send-sms/index.ts` sends straight to Twilio with no suppression check. There is no inbound SMS webhook route in `naavi-voice-server/src/index.js` (confirmed via search — zero matches). The existing demo CTA SMS's "Reply STOP" text is not backed by any code.
- `evaluate-rules`'s `fireAction()` fans a **third-party phone destination out to both SMS and WhatsApp unconditionally**, no gate (`supabase/functions/evaluate-rules/index.ts:850-853`).
- The voice server (Railway) and the `evaluate-rules` cron (`supabase/migrations/20260407000001_evaluate_rules_cron.sql`) are both hardcoded to **production** Supabase (`hhgyppbxgmjrwdpdubcx`). There has never been a staging deployment of the voice server.
- A TTL-table precedent exists: `hosted_replies` (`supabase/migrations/20260511000002_hosted_replies.sql`) — `expires_at DEFAULT (now() + interval '30 days')`, read-path filtering, service-role-only RLS.

## 1. Decisions made this session (Wael, explicit)

| # | Decision | Chosen |
|---|---|---|
| 1 | ~~Staging isolation for the public demo line~~ **SUPERSEDED 2026-07-01 (post Phase 6)** | ~~Same Railway service, conditional routing — new `STAGING_DEMO_TWILIO_NUMBER` + staging Supabase client selected per-call. No second Railway service.~~ Wael paused Phase 7 and overrode this: the current Railway service is directly connected to production traffic, so deploying F2b there — even gated by env vars — is not genuine staging. New decision: **separate Railway service, deployed from a new `staging` branch (not `main`), fully separate staging Supabase env vars, wired only to a brand-new staging-only Twilio number.** Production Railway/`main` stays untouched until Phase 7 passes. See `docs/F2B_STAGING_INFRA_PROPOSAL_2026-07-01.md` for the full setup. **No code changes required** — `getDemoEnvironment.js`'s existing `STAGING_*`-prefixed env var branch already supports this; it's a deployment-topology change, not an implementation change. |
| 2 | Reminder storage | **Reuse `action_rules`** with a `DEMO_USER_ID` (staging + production each get their own), not a dedicated `demo_reminders` table. |
| 3 | WhatsApp unsolicited-send risk | **Add an SMS-only override flag** to `fireAction()` in `evaluate-rules/index.ts`, defaulting to today's behavior (SMS+WhatsApp) when absent — zero change for existing real-user third-party alerts. |
| 4 | Caller timezone (a phone call has no GPS; the original spec hardcoded "Eastern" in the confirmation line) | **Ask the caller directly** (not inferred from Twilio's FromState/FromCountry metadata, which is tied to the number's registered exchange, not live location). Naavi asks for the caller's city or timezone and **reads it back for explicit confirmation** before proceeding — same Gather→confirm pattern as name capture. Call-duration target relaxes from "under 60 seconds" to **up to 90 seconds** to accommodate this step. |

## 2. Files that will change

*Revised per Phase 3 ChatGPT review (see §8) — parser logic isolated into dedicated modules, environment selection wrapped in one function, vocabulary made explicit rather than left to implementation-time judgment.*

| File | Classification | Change |
|---|---|---|
| `naavi-voice-server/src/index.js` | Backend (Protected Core: Voice orchestration) | (a) New env config: `STAGING_DEMO_TWILIO_NUMBER`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `STAGING_DEMO_USER_ID`. (b) Calls new `getDemoEnvironment(To)` helper (below) instead of scattering `if (To === ...)` checks through the call-handling code — returns `{ supabaseClient, demoUserId, environment }` for the matched number. (c) New TwiML routes `/voice/demo/timezone` + `/voice/demo/timezone-confirm`, following the existing name-capture Gather→sanitize→confirm→redirect shape (`index.js:6720-7284`) — Naavi asks the caller's city or timezone and reads it back for explicit yes/no confirmation before asking for the reminder time. Calls `parseTimezone()` (below) to interpret the answer. (d) New TwiML routes `/voice/demo/reminder-time` + `/voice/demo/reminder-confirm`, same pattern, added after the timezone step. Calls `parseReminderTime()` (below). Edge cases per spec: vague time → offer morning/afternoon/evening in the *confirmed* timezone; "now" → fire 60s after call ends; past time → re-ask; refuse → no reminder, call ends. (e) SMS confirmation line and the outbound reminder SMS body both state the caller's actual confirmed zone label (e.g. "3 PM Pacific") — never a hardcoded "Eastern". (f) New inbound SMS webhook route (e.g. `/sms/inbound`) to catch STOP replies and write to `demo_optouts` — no such route exists today for any SMS in the app. (g) Call `create-demo-reminder` (new Edge Function, below) on confirm instead of writing to `action_rules` directly, per Data Integrity Layer 2 (single write entry point). |
| `naavi-voice-server/src/voice/parseReminderTime.js` (NEW) | Backend (isolated, unit-testable) | Deterministic parser, NOT LLM. Takes the caller's utterance + the confirmed IANA timezone from `parseTimezone()`, returns an ISO8601 timestamp with the correct UTC offset for that zone, or `null` if unrecognized (never partially interprets — see exact supported vocabulary in §2a). Kept out of `index.js` specifically so it can be unit tested in isolation (Phase 3 requirement). |
| `naavi-voice-server/src/voice/parseTimezone.js` (NEW) | Backend (isolated, unit-testable) | Deterministic parser, NOT LLM. Takes the caller's spoken city/zone word, returns an IANA timezone string or `null` if unrecognized (exact supported vocabulary in §2b). Defaults to `America/Toronto` only after the caller fails to give a recognized answer across all retries. |
| `naavi-voice-server/src/voice/getDemoEnvironment.js` (NEW) | Backend (isolated, unit-testable) | Single function wrapping environment selection: given the Twilio `To` number, returns `{ supabaseClient, demoUserId, environment: 'staging' | 'production' }`. Replaces scattered `if (To === DEMO_TWILIO_NUMBER)` / `if (To === STAGING_DEMO_TWILIO_NUMBER)` conditionals that would otherwise spread through `index.js`. |
| `naavi-voice-server/test/parseReminderTime.test.js` (NEW) | Backend (test) | Unit tests locking in parser behavior — permanent regression protection since there's no LLM to "just handle" phrasing drift. Cases (from Phase 3 review): `tomorrow 3pm`, `today morning`, `next week`, `now`, `3:30`, `15:00`, `Friday afternoon`, plus one case per unsupported phrase confirming the exact fallback string is returned rather than a guess. Uses the project's existing `node --test` runner (`naavi-voice-server/package.json:9`). |
| `naavi-voice-server/test/parseTimezone.test.js` (NEW) | Backend (test) | Unit tests for the timezone parser — one case per supported zone word/city (§2b), one case for an unrecognized answer, one case confirming the `America/Toronto` default only applies after retries are exhausted. |
| `supabase/functions/create-demo-reminder/index.ts` (NEW) | Backend | New, minimal Edge Function — the single write entry point for demo reminder rows. Accepts `{phone, name, fire_at, message, environment}` from the voice server. Checks `demo_optouts` for the phone before inserting (TCPA gate). Inserts into `action_rules`: `trigger_type='time'`, `user_id=<DEMO_USER_ID for that environment>`, `action_type='sms'`, `action_config={to_phone, message, channels:['sms'], source:'demo_line'}`. Justified as a new function per Configuration Discipline #3 — nothing today handles anonymous demo-reminder creation. |
| `supabase/functions/evaluate-rules/index.ts` | Backend (Protected Core: Reminder Engine) | In `fireAction()` (~`index.ts:850-853`): when `action_config.channels` is present and excludes `'whatsapp'`, skip the WhatsApp send. When `action_config.source === 'demo_line'`, re-check `demo_optouts` for `toPhone` immediately before sending (covers the case where the caller texts STOP *after* creating the reminder but *before* it fires — the creation-time check alone isn't sufficient). Absent both flags, behavior is byte-for-byte unchanged for all existing real-user third-party alerts. **Accepted operational limitation (Phase 3, documented not solved):** a theoretical race remains if STOP arrives at the exact moment the cron has already begun sending — the reminder may still go out that one time. This is accepted as-is; closing it fully would require locking/transactional complexity disproportionate to a marketing demo line. |
| `supabase/migrations/<date>_demo_optouts.sql` (NEW) | Database | New table `demo_optouts (phone text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`, RLS service-role-only. This is the one new table in the plan — required regardless of the reminder-storage decision, because TCPA opt-out enforcement has no simpler mechanism than a suppression check, and none exists anywhere in the app today (Complexity Tax: alternative considered was "no opt-out table, rely on Twilio's account-level Advanced Opt-Out only" — rejected because the spec explicitly requires app-level enforcement and the existing "Reply STOP" text in the live demo CTA SMS is currently not backed by any code, which is a compliance gap independent of F2b). |
| Railway env vars (Configuration, manual) | Configuration | Add the 4 new env vars listed above. Requires a `DEMO_USER_ID`-equivalent row to exist in staging Supabase's `auth.users` (one-time manual setup, Wael or Claude with approval). |
| Twilio console (Configuration, manual) | Configuration | Purchase/configure a second Twilio number for staging demo calls (voice webhook → same Railway URL). Configure the demo number(s)' SMS webhook to point at the new `/sms/inbound` route for STOP handling. |

### 2a. Supported time-phrase vocabulary (exact — Phase 3 requirement)

`parseReminderTime.js` recognizes exactly this set. Anything else returns `null`, and Naavi says: *"I'm sorry, I didn't understand that. Could you tell me the time another way?"* — never a partial or best-guess interpretation.

Relative days: `today`, `tomorrow`, `next week`, `this Friday` (and other weekday names), `Monday`...`Sunday` (bare weekday name = the next occurrence).
Times of day: `morning`, `afternoon`, `evening`, `tonight`, `noon`, `midnight`.
Explicit clock times: `3 pm`, `3:30 pm`, `15:00` (12-hour with am/pm, or 24-hour).
Combinations of the above (e.g. "tomorrow morning", "Friday at 3:30 pm").
Special case: `now` → fires 60 seconds after the call ends (per spec edge case).

### 2b. Supported timezone vocabulary (exact — Phase 3 requirement)

`parseTimezone.js` recognizes exactly this set. Unknown on first/second attempt → ask again. Unknown after all retries → default to `America/Toronto`, disclosed to the caller in the confirmation line.

Zone words: `Pacific`, `Mountain`, `Central`, `Eastern`, `Atlantic`, `UTC`, `GMT`.
Canadian cities: `Vancouver`, `Calgary`, `Edmonton`, `Winnipeg`, `Toronto`, `Ottawa`, `Montreal`, `Halifax`.
US cities: `Seattle`, `Los Angeles`, `Denver`, `Chicago`, `New York`.

## 3. Explicitly deferred (out of scope for this plan)

- **Click-tracking redirect** (`mynaavi.com/demo?ref=sms&phone=<hashed>`) — spec allows telemetry to be lighter in v1; recommend deferring to "Post-launch Phase 2" (spec's own term for the HELP-reply feature) and pointing the SMS link directly at the existing install destination. Flagging for Wael/ChatGPT to confirm — this is a recommendation, not yet a locked decision.
- **Retrofitting opt-out enforcement onto the existing (already-shipped) demo CTA SMS** — same gap exists there today, but per "No Extra Changes Rule" it is not touched by this plan. Separate follow-up item if Wael wants it.
- Telemetry events (calls started, name captured, reminder created/delivered, SMS clicked) — recommend structured Railway log lines for v1 rather than new DB columns, consistent with the reuse-not-build pattern chosen this session. Not yet confirmed with Wael.

## 4. Risk classification

**Overall: High.** Touches three Protected Core areas simultaneously — Voice orchestration, Reminder Engine, SMS/call alerts (governance §4) — plus adds a brand-new inbound webhook surface with zero prior coverage. Phase 3 (pre-code ChatGPT review) and Phase 6 (post-code ChatGPT review) are both mandatory, not discretionary.

## 5. Regression impact (governance-mandated checklist)

| Area | Impact | Why |
|---|---|---|
| Voice commands | **AFFECTED** | New routes + new per-call Supabase client selection logic added inside `naavi-voice-server/src/index.js`, a Protected Core file shared with all real-user call handling. Additive, but the call-routing dispatcher itself is touched. |
| Geofencing | Not affected | No geofencing code touched. |
| Gmail integration | Not affected | No Gmail code touched. |
| Calendar integration | Not affected | No calendar code touched. |
| Reminders | **AFFECTED** | `evaluate-rules::fireAction()` (Protected Core: Reminder Engine) gets new conditional branches. Must verify existing real-user self-alerts and third-party alerts are unchanged when the new flags are absent. |
| SMS / call alerts | **AFFECTED** | New SMS send path (demo reminder fire), brand-new inbound SMS webhook (no existing coverage to regress, but new attack/failure surface), `fireAction()` modified. |
| Onboarding | Not affected | No onboarding code touched. |
| Staging build | **AFFECTED** | First-ever staging wiring for the voice server. New env vars added to the same Railway process that currently serves production traffic — must verify existing production env vars/behavior are undisturbed. |

## 6. Open items sent for Phase 3 review — now resolved (see §8)

1. ~~Is the hand-rolled regex/keyword time parser (no LLM) sufficient?~~ → Resolved: yes, deterministic, exact vocabulary in §2a.
2. ~~Minimum timezone vocabulary?~~ → Resolved: exact vocabulary in §2b, default `America/Toronto` after retries exhausted.
3. ~~Does checking `demo_optouts` at both creation time and send time close the STOP-timing race?~~ → Resolved: yes for practical purposes; the remaining edge case is documented as an accepted operational limitation in §2's `evaluate-rules` row.
4. ~~Is a single shared `DEMO_USER_ID` per environment acceptable?~~ → Resolved: yes, agreed by reviewer — anonymous callers aren't real users, reminders are short-lived, distinguished by phone number.
5. ~~Does 90 seconds hurt the "under 60 seconds" marketing claim?~~ → Open, marketing copy decision (not an engineering change) — see §9.

## 7. Risk classification — unchanged after Phase 3

Still **High** (§4) — Phase 3 review did not reduce scope or touch the Protected Core areas identified; it added precision (explicit vocabulary, isolated/testable modules) without changing what's being built. Phase 6 (post-code ChatGPT review) is still mandatory.

## 8. Phase 3 Review — ChatGPT Response (2026-07-01)

**Outcome: APPROVED FOR PHASE 3 WITH MINOR REVISIONS.**

Must-fix items (incorporated into this plan, see §2/§2a/§2b above):
1. Time parser must be deterministic with an exact, enumerated vocabulary — never partial interpretation. ✅ Incorporated.
2. Timezone parser vocabulary must be exact, not left open-ended. ✅ Incorporated.
3. The STOP/cron race must be documented as an accepted operational limitation, not silently left ambiguous. ✅ Incorporated.

Should-improve items (incorporated):
4. Parser logic isolated into dedicated modules (`parseReminderTime.js`, `parseTimezone.js`), not inline in `index.js` — easier to unit test. ✅ Incorporated.
5. Environment selection wrapped in one `getDemoEnvironment(To)` function instead of scattered `if (To === ...)` checks. ✅ Incorporated.
6. Unit tests added for both parsers, covering: `tomorrow 3pm`, `today morning`, `next week`, `now`, `3:30`, `15:00`, `Friday afternoon`. ✅ Incorporated.

Confirmed (no plan changes needed): the `create-demo-reminder` Edge Function as single write entry point, the SMS-only override flag, reusing `action_rules`, and the same-Railway-service staging approach were all independently agreed as correct by the reviewer.

## 8a. Parser Contract (Phase 3, second-pass recommendation)

The vocabularies in §2a and §2b are effectively public behavior, not implementation detail. Any future change to either supported vocabulary — adding phrases like "the day after tomorrow", "in a couple of weeks", "late afternoon", or new cities/zones — requires the same process as this feature, not a casual edit:

1. A Phase 2 change plan describing the vocabulary addition
2. Updated unit tests in `parseReminderTime.test.js` / `parseTimezone.test.js` covering the new cases
3. Phase 3 review
4. Wael's approval

This prevents silent drift in what the demo line understands, and keeps the parser's behavior exactly as testable in month six as it is on day one.

## 9. Follow-up item for Wael (not an engineering change)

The added timezone-confirmation step pushes typical call duration toward ~90 seconds, versus the spec's original "under 60 seconds" framing. Reviewer's suggestion: either tighten the conversation to get closer to 60s in practice, or soften the marketing language to "about a minute." This affects `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`'s F2b marketing copy, not any code file — flagging for a decision, not blocking Phase 4.

## 10. Next step

Plan is revised and Phase 3-approved (both review passes: "APPROVED FOR PHASE 3 WITH MINOR REVISIONS" then "APPROVED FOR IMPLEMENTATION (Phase 4)"). **Awaiting Wael's explicit go-ahead to begin Phase 4 (implementation).** Per governance §8 (Approval Philosophy), ChatGPT's approval is a recommendation, not authorization — Wael is the final decision-maker on whether to proceed to code.
