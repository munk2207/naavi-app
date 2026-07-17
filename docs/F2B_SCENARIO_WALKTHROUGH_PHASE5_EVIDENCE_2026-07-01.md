# F2b Scenario Walkthrough — Phase 5 Evidence Package

Governance: AI_DEVELOPMENT_GOVERNANCE.md v2.1, Phase 5 (Evidence Package), following Phase 4 (Implementation).
Script source: `docs/F2B_SCENARIO_WALKTHROUGH_SCRIPT_2026-07-01.md` — every open item reviewed and confirmed before this code was written.
Plan source: `docs/F2B_SCENARIO_WALKTHROUGH_PHASE2_2026-07-01.md` — Phase 3-approved ("Proceed").
Full diff: `docs/F2B_SCENARIO_WALKTHROUGH_FULL_DIFF_2026-07-01.md` — the actual diff text, for pasting into ChatGPT alongside this package (Phase 6).

**This touches Protected Core (Voice orchestration) per `docs/AI_DEVELOPMENT_GOVERNANCE.md` §4 — technical review is mandatory before Phase 8, not optional.**

---

## 1. Summary

Implements the confirmed scenario-walkthrough expansion: before the existing F2b reminder flow, the demo line now plays up to 3 of 5 scenarios (Today, Bills, History, Location, Capture) as a yes/no-gated conversation, then hands off into the reminder flow. Two live-call test rounds since the initial build surfaced 4 fixes, all included below.

**5 commits on `naavi-voice-server`, branch `staging`, none pushed to `origin/staging` yet:**

| Commit | What |
|---|---|
| `64a221f` | Original scenario walkthrough (Phase 4 build) |
| `e90ab54` | Closer line wording fix — "another" → "another example" |
| `0b58134` | Recap SMS trigger moved to true end-of-call (was firing mid-call) |
| `81c04a7` | Chattiness trim round 1 — reminder-flow bridge line, walkthrough bridge line, Bills scenario detail |
| `039629a` | Chattiness trim round 2 — all 5 gate questions, reminder-time ask, message ask |

`main` branch of `naavi-voice-server` confirmed untouched throughout (still `d7fafdc`, checked before and after every commit).

## 2. Files changed (across all 5 commits)

| File | Classification | Change |
|---|---|---|
| `naavi-voice-server/src/index.js` | Backend (Protected Core: Voice orchestration) | Two new routes, two new entry-point reroutes, one new fire-and-forget SMS sender, `playedNames` threaded as a new parameter through 5 existing functions + their route handlers, several prompt-text trims |
| `naavi-voice-server/src/voice/scenarioWalkthrough.js` | Backend (new file) | Scenario content, gate/closer/decline/cap-reached lines, `DEMO_MOVE_TO_REMINDER_RE` |
| `naavi-voice-server/src/voice/recapSms.js` | Backend (new file) | Recap SMS body builder + canonical `SCENARIO_RECAP_LINES` |
| `naavi-voice-server/test/scenarioWalkthrough.test.js` | Test | 8 unit tests |
| `naavi-voice-server/test/recapSms.test.js` | Test | 6 unit tests |

**No changes to:** `DEMO_SCENARIOS` (old menu content, untouched), the reminder-time PARSING logic (`parseReminderTime.js`), any Edge Function, any migration, `naavi-app` main repo, `main` branch of `naavi-voice-server`.

## 3. Git diff

Full diff (932 lines, all 5 commits collapsed into one unified diff against the pre-Phase-4 base) is in the companion file: `docs/F2B_SCENARIO_WALKTHROUGH_FULL_DIFF_2026-07-01.md`. Summary of what it contains:

**New routing entry:** `/voice/demo/name` (give-up-after-3-attempts) and `/voice/demo/confirm` (name confirmed) now call `buildDemoWalkthroughGateTwiml(...)` instead of `buildDemoContextAndTimezoneTwiml(...)` directly.

**Two new stateless routes:**
- `POST /voice/demo/walkthrough/gate` — the yes/no scenario-invite question. Yes → play scenario body, then either the closer question or (cap reached / none left) hand off to the reminder flow. No → decline line, advance to next scenario (or hand off if none left).
- `POST /voice/demo/walkthrough/closer` — "want another example, or set up a reminder?" Explicit "no" or `DEMO_MOVE_TO_REMINDER_RE` match → hand off to reminder flow. Anything else (including "yes") → next scenario, per the Phase 3-approved design.

**`playedNames` threading (added after live-call feedback, commit `0b58134`):** what started as a single hand-off function (`transitionFromWalkthroughToReminder`) that fired the Recap SMS at the walkthrough→reminder boundary was corrected to thread `playedNames` as a new parameter through every function in the previously-untouched reminder flow (`buildDemoContextAndTimezoneTwiml`, `buildDemoTimezoneConfirmTwiml`, `buildDemoReminderTimeTwiml`, `buildDemoReminderConfirmTwiml`, `buildDemoDeclineTwiml`) and their route handlers, so the Recap SMS can fire at whichever point the call actually ends (success, decline, or error) instead of firing mid-call. All additions are backward-compatible optional parameters (default `[]` or `''`).

**Wording trims (commits `81c04a7`, `039629a`):** reminder-flow bridge line (30→12 words, conditionally omitted on the cap-reached path to avoid repeating "let's set up a real one" twice — caught in local smoke test), walkthrough bridge line (30→18 words, reason kept), all 5 scenario gate questions (dropped "Want to..." lead-in), Bills scenario body (dropped non-essential detail), reminder-time ask (~20→5 words), message ask (12→4 words).

## 4. Tests executed

```
npm test   (from naavi-voice-server/)
→ 62/62 passing (48 pre-existing + 14 new, unchanged across all 5 commits)
```

New tests specifically cover:
- `DEMO_SCENARIO_ORDER` matches the confirmed order (today, bills, history, location, capture)
- Every scenario has both a gate question and a body
- **Regression guard for the reviewed "Row B5" gap**: Location and Capture bodies must say "say you told me..." and their gate questions must NOT name the specific example (Sarah/airport/row B5) up front
- `DEMO_MOVE_TO_REMINDER_RE` matches all 6 confirmed intent phrases, does not fire on a plain "yes" or unrelated speech
- Bridge line includes the reason ("not connected to your calendar or emails yet") with and without a name
- Decline/closer/cap-reached lines match the confirmed script text exactly
- Recap SMS: only includes played scenarios (in order), greets with/without name, includes signup link + STOP, **never mentions "remind"** (regression guard for the "stays fully separate from Reminder SMS" rule), works with empty list, accepts both array and Set

**Route-level manual smoke tests run this session** (local server, `curl` against each route directly — not a real Twilio call; route-level orchestration isn't covered by this suite's unit-test pattern, same as every other reminder-flow endpoint in this file):
1. First-call gate render (bridge line + first scenario question) — ✅
2. "Yes" to scenario 1 → scenario body + closer question, `played` incremented, `playedNames` carries `today` — ✅
3. Closer says "let's do the reminder" → hands off to `/voice/demo/timezone` with no prefix — ✅
4. Closer with an unrelated answer ("how much do you cost") → advances to next scenario's gate — ✅
5. "Yes" to the 3rd scenario (cap reached) → scenario body + cap-reached line + reminder prompt combined in one `<Say>` — ✅
6. "No" to a scenario declines and advances (`played` count unchanged) — ✅
7. "No" to the last scenario (idx=4, none left) → hands off directly, no prefix — ✅
8. **After `0b58134`:** `playedNames` correctly carries through the closer→timezone handoff; Recap SMS attempt (logged as "missing creds" locally, expected without live Twilio creds) fires ONLY at true end-of-call points (reminder-time decline, reminder-message missing-config branch) — confirmed it does NOT fire at the earlier walkthrough→reminder handoff — ✅
9. **After `81c04a7`/`039629a`:** cap-reached path and direct-decline path both render the trimmed reminder-bridge line correctly, with no duplicate "let's set up a real one" phrasing — ✅ (this duplication was caught and fixed via this exact smoke test before it would have shipped)
10. Trimmed gate questions, reminder-time ask, and message ask all render correctly — ✅

## 5. Manual tests still required (Phase 7 — real call, partially run)

One real Phase 7 call test already happened this session and surfaced commits `e90ab54` + `0b58134` + the chattiness trims. Still to verify on a fresh real call with the latest 5 commits:

1. Full happy path by voice: name → 1-3 scenarios (trimmed wording) → reminder flow → SMS.
2. Hear all 3 (capped) scenarios → reminder flow starts automatically, no 4th offered, no duplicate "let's set up a real one" phrasing (verified locally, not yet on a real call).
3. Say an intent phrase ("let's set a reminder") instead of literal "no" → advances correctly.
4. **Confirm Recap SMS now arrives at the actual end of the call**, not mid-call — the specific bug this round fixed.
5. Decline the reminder → confirm Recap SMS still arrives (it's a true end-of-call point too, not just the success path).
6. Hang up mid-walkthrough → no crash (stateless, nothing to orphan).
7. Silence → existing Twilio Gather timeout/redirect behavior, no new failure mode.

## 6. Rollback instructions

5 commits, single branch, none pushed: `git reset --hard d7fafdc` on `naavi-voice-server`'s `staging` branch reverts everything (or `git revert` the 5 commits individually if already pushed by the time this is read). `main` branch was never touched — production is unaffected regardless. No migrations, no Edge Function deploys, nothing else to unwind.

## 7. Known risks

- ~~Recap SMS send point precedes full call completion~~ — **FIXED in `0b58134`.** Was firing at the walkthrough→reminder handoff; now fires at the true end of the call.
- **Recap SMS still won't fire if the caller hangs up *during* the walkthrough itself**, before reaching any end-of-call point (declined reminder, error, or success). There's no Twilio call-status webhook wired for this line to catch that case. Acceptable trade-off given scope, but worth knowing if a caller reports "I didn't get the recap text" after hanging up early.
- **`DEMO_MOVE_TO_REMINDER_RE` is a bounded phrase list**, not exhaustive — a caller using a phrasing not in the list at the closer will simply advance to the next scenario rather than move to the reminder (falls through to the approved "yes or unrecognized → next scenario" behavior — never crashes or misroutes, just doesn't accelerate for phrasings outside the list).
- **Declined scenarios don't count toward the 3-scenario cap** — confirmed intentional in review. A caller who declines several scenarios could hear all 5 scenario *offers* (not all played) before reaching the end.
- ~~Two rounds of wording trims landed without a Phase 6 review~~ — **CLOSED.** Phase 6 review completed 2026-07-01 against this package + the full-diff companion file.
- **Maintainability note from Phase 6 review (not a blocker, no action taken):** `playedNames` is threaded through the reminder flow as a positional parameter across 5 functions + their route handlers. Reasonable for the current scope, but increases the chance a future edit forgets to pass it along. If more walkthrough features get added later, worth wrapping per-call state into a small object instead of more positional params. Deliberately not changed now — logged here for the next person touching this file.

## 8. Phase 6 outcome — ✅ COMPLETE (2026-07-01)

ChatGPT reviewed this package + the full diff. Verdict:
- **Phase 6 (technical review): Complete.** No issues found that justify another coding cycle before real-world testing.
- **Phase 7 (staging voice validation): Ready.** Focus shifts from code inspection to caller behavior on real staging calls — see §9.
- **Production: Not yet** — only after staging call tests confirm conversational flow and SMS behavior.

## 9. Phase 7 focus — behavior to watch on real calls (not code review)

Per the Phase 6 reviewer's recommendation, stop inspecting code and watch for:
- Does the caller naturally understand the first scenario without hesitation?
- Do they interrupt Naavi? If so, where?
- After hearing one scenario, do most callers choose another example, or move straight to the reminder?
- Does the Recap SMS arrive consistently, immediately?
- Does the Reminder SMS still arrive correctly later, and stay clearly distinct from the Recap SMS?

**Not pushed to `origin/staging` yet** — say the word when you want it live for the next round of real calls.
