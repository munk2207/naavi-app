# F2b — Scenario Walkthrough Expansion — Phase 1 + 2 Change Plan

Governance: AI_DEVELOPMENT_GOVERNANCE.md v2.1. Phase 1 (Problem Definition) + Phase 2 (Change Planning).
Extends F2b (`docs/F2B_PHASE2_CHANGE_PLAN_2026-07-01.md`), does not replace it. Touches Protected Core (Voice orchestration) — Phase 3 (pre-code) and Phase 6 (post-code) ChatGPT review are mandatory.

---

## 1. Problem (Phase 1)

Wael's feedback after testing the shipped F2b reminder flow: the reminder alone proves the *mechanism* works (a real SMS arrives), but it's "secondary" — it doesn't demonstrate the breadth of what Naavi does (calendar, email/bills, history lookups, location alerts, memory capture). The original 5-scenario canned menu demonstrated exactly that breadth, but F2b's Phase 2 plan explicitly replaced it as the live call path (session decision, 2026-07-01) because the menu's "press 1 for X" structure didn't fit a natural-conversation demo.

**Decision (this session, confirmed via numbered choices):**
1. Scope: all 5 original scenarios (Today/calendar, Bills/email, History, Location, Capture) — not just calendar + email.
2. Navigation: no menu, no DTMF. Naavi plays one scenario, then asks naturally ("want to hear another, or should we set up a reminder?") — yes/no, not a numbered choice.
3. Placement: before the reminder flow, as the opener — scenarios play first, then the call transitions into the existing (already-shipped) timezone → reminder-time → SMS flow, so every call still ends with the one real, concrete proof point.

**Evidence this is smaller than it looks:** the scenario *content* already exists and is untouched in the codebase — `DEMO_SCENARIOS` (`index.js:6817-6853`, five scenarios with prompt+response text) and `buildDemoScenarioReplyTwiml` (`index.js:7003-7010`) already deliver a combined "if you'd asked me X, I'd say Y. Want to try another?" narration — no menu-reading, no "say the magic words" friction. This was written 2026-05-18 specifically to remove exactly the kind of friction F2b's reminder flow was later built to avoid. **The content and the narration shape are already right.** What's missing is only the *routing*: today, "yes" goes to a numbered menu and "no" goes to the old CTA/recap-SMS flow (retired this session). This plan rewires those two exits, adds a fixed rotation order and a cap, and does not touch the scenario text itself.

## 2. Files that will change

*Revised per Phase 3 (ChatGPT) review — see §7 for the full review record.*

| File | Classification | Change |
|---|---|---|
| `naavi-voice-server/src/index.js` | Backend (Protected Core: Voice orchestration) | (a) New entry point after name-confirm: instead of going straight to `buildDemoContextAndTimezoneTwiml`, first plays one scenario, starting from a **configurable** order — `DEMO_SCENARIO_ORDER = ['today', 'bills', 'history', 'location', 'capture']`, a single named constant, not logic baked into the routing. Changing which scenario leads (or the whole order) later is a one-line edit, not a re-plan. (b) `buildDemoScenarioReplyTwiml`'s "want to try another?" routing changes: **advances to reminder** on either a literal "no" OR a match against a new deterministic intent regex, `DEMO_MOVE_TO_REMINDER_RE` (catches phrasings like "let's do the reminder", "remind me instead", "that's enough", "ok let's continue" — see §7 for why this is regex-based, not LLM-based). Otherwise (yes, or unrecognized) → next scenario in `DEMO_SCENARIO_ORDER`, capped at `DEMO_MAX_SCENARIOS` (already defined, currently 3) or all 5 played, whichever comes first. Cap reached → transitions into the existing `buildDemoContextAndTimezoneTwiml` (F2b's already-shipped context line + timezone + reminder flow — unchanged). (c) **One-way gate, explicit in code**: once the call transitions into the reminder flow, no route in the reminder flow (`/voice/demo/timezone`, `/voice/demo/reminder-time`, etc.) references or can redirect back into the scenario routes. A caller saying "tell me another" *after* the reminder flow has started is treated the same as any other unrecognized input at whatever step they're on — never re-enters scenario mode. (d) **Fully stateless**, matching the existing reminder flow's own design: current scenario index, scenarios-played-so-far, and environment all travel through Twilio action-URL query params for that call only — no database table, no Supabase write, no session store. Nothing here can outlive the call or leak between calls. (e) `env`/`environment` (staging vs production) threaded through the new scenario routes the same way it already is through the reminder routes — same `buildDemoActionUrl` pattern, same `getDemoEnvironment`/`getDemoEnvironmentByName` mechanism, no new environment-selection logic needed. |

**No changes to:** `DEMO_SCENARIOS` content (routing only, copywriting deferred per Phase 3 review §7), `parseTimezone.js`, `parseReminderTime.js`, `getDemoEnvironment.js`, any Edge Function, any migration. The reminder-creation backend built and reviewed for F2b is untouched — this plan only changes what happens *before* that flow starts.

## 3. Risk classification

**Medium** — touches Protected Core (Voice orchestration), but the change is narrowly scoped to routing between two already-existing, already-tested TwiML builders. No new parsing logic, no new Edge Functions, no new database writes.

## 4. Regression impact

| Area | Impact | Why |
|---|---|---|
| Voice commands | **AFFECTED** | Call flow between name-confirm and the reminder flow changes — real users are unaffected (demo-only routes), but this is still Protected Core file. |
| Geofencing | Not affected | Scenario content unchanged; no geofencing code touched. |
| Gmail integration | Not affected | Scenario content unchanged; no live Gmail calls — "Bills" scenario response is scripted, not a real inbox read. |
| Calendar integration | Not affected | Same — "Today" scenario is scripted, not a live calendar read. |
| Reminders | Not affected | The reminder flow itself (parsing, confirmation, creation, cron firing) is unchanged — only what happens *before* it starts. |
| SMS / call alerts | Not affected | No change to how/when the reminder SMS fires. |
| Onboarding | Not affected | |
| Staging build | **AFFECTED (staging only, as intended)** | New live call path on the staging demo line. |

## 5. Open items sent for Phase 3 review — now resolved (see §7)

1. ~~Fixed rotation order — acceptable, or should it vary?~~ → Resolved: configurable via `DEMO_SCENARIO_ORDER` constant, not hardcoded logic. Starts as `today → bills → history → location → capture` (matches original menu numbering); changeable later without a re-plan.
2. ~~Is a cap of 3 the right number?~~ → Resolved: keep 3, explicitly agreed. Rationale from review: the goal is convincing the caller "this is different," not full feature coverage — once convinced, transition to the live reminder while still engaged.
3. ~~Should "no" also catch intent-phrases like "let's do the reminder"?~~ → Resolved: yes, via a new deterministic regex (`DEMO_MOVE_TO_REMINDER_RE`), not an LLM call — see §7 for why LLM was explicitly ruled out.

## 6. Risk classification — unchanged after Phase 3

Still **Medium** (§3). Phase 3 review added precision (statelessness constraint, one-way gate, configurable constant) without expanding scope — still routing-only, no new parsing surface beyond one additional regex, no new Edge Functions, no new database writes.

## 7. Phase 3 Review — ChatGPT Response (2026-07-01)

**Outcome: "Proceed."** Architectural approach confirmed sound — reuses existing scenario assets, changes routing only.

Requested design changes (all incorporated, see §2):
1. **Configurable starting scenario**, not permanently fixed — the first scenario shapes the caller's whole impression of the product; a single constant should be changeable as data comes in about which scenario converts best, without touching routing logic. ✅ Incorporated (`DEMO_SCENARIO_ORDER`).
2. **Route on intent, not just literal yes/no** — callers naturally say "let's do the reminder," "that's enough," "ok continue" instead of a bare "no." ✅ Incorporated, **with one deviation from the literal suggestion**: ChatGPT recommended reusing "Claude's intent parser." That would put an LLM call into the demo line's flow, which was deliberately built with zero LLM calls after this same codebase's own prior incident with an LLM-powered demo (hallucinations, STT loops — see `index.js:6787-6788`). Discussed directly with Wael; resolved as a deterministic regex expansion instead (`DEMO_MOVE_TO_REMINDER_RE`), matching the existing `AFFIRMATIVE_RE`/`NEGATIVE_RE`/`FRESH_COMMAND_RE` pattern already in this file. Same practical effect for the bounded phrase set, none of the reliability risk.
3. **No route back into scenario mode once the reminder flow starts** — explicit edge case: caller says "tell me another" *after* the reminder flow has begun. ✅ Incorporated as an explicit one-way gate (§2c).
4. **Fully stateless engine** — current index, played-so-far, environment should exist only for the duration of the call; no database, no persistence, no Supabase writes. ✅ Confirmed already true by design (matches the reminder flow's own existing pattern) and stated explicitly in §2d so it stays true.

Confirmed, no changes needed: reusing `DEMO_SCENARIOS` unchanged (routing first, copywriting later — explicitly agreed with the plan's own reasoning), cap of 3.

## 8. Phase 7 testing plan (expanded per Phase 3 review)

In addition to the standard F2b manual test (name → scenarios → reminder → SMS), explicitly test these paths before Phase 8 merge:

1. Caller hears one scenario → says "No" → reminder flow starts correctly.
2. Caller hears all 3 (capped) scenarios → reminder flow starts automatically without being asked a 4th time.
3. Caller says "Let's set a reminder" (intent phrase, not literal "no") after the *first* scenario → advances correctly.
4. Caller hangs up during the scenario loop → no error, no orphaned state (nothing to orphan — stateless by design, but confirm no crash/hang server-side).
5. Caller gives an unrelated answer ("How much do you cost?") while in the scenario loop → falls through to generic re-ask, does not crash or misroute.
6. Caller says "Repeat that" → currently unhandled by either yes/no or the new intent regex; confirm it falls through to a sensible generic re-ask rather than silently advancing or erroring.
7. Caller is silent → existing Twilio Gather timeout/redirect behavior handles this the same way it already does elsewhere in the file; confirm no new failure mode introduced.
8. Caller says "Yes" after the *third* (capped) scenario → must still transition to the reminder flow (cap enforcement overrides a "yes"), not play a 4th scenario.

## 9. Next step

Plan is revised and Phase 3-approved ("Proceed"). Ready for Phase 4 (implementation) once Wael gives explicit go-ahead — per governance §8, ChatGPT's approval is a recommendation, not authorization.
