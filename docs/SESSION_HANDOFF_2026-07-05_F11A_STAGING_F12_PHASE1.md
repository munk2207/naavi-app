# Session Handoff — 2026-07-05

## Read first

1. This doc.
2. `docs/F12_PHASE1_PROBLEM_DEFINITION_2026-07-05.md` — the next session's main priority. Full formal Problem Statement, ready for Phase 2.
3. `docs/F11A_SCENARIO_SCRIPT_2026-07-04.md` §12 — the field-test plan that's still outstanding on the demo line.

---

## 1. F11a — demo scenario rebuild: shipped to STAGING, field test still outstanding

Governance fully closed for the design/script (Phase 1 → frozen script, 3 rounds of external review each). Implementation shipped to `naavi-voice-server` `staging` branch only — **not merged to `main`, not on production**. Commits, in order:

| Commit | What |
|---|---|
| `dcb9211` | Core rebuild — 5 new scenarios (`unified_search → geofencing → automatic_alerts → scheduling → lists`) replacing the F2b set (today/bills/history/location/capture). Also fixed `recapSms.js`'s recap-line keys, which still referenced the old scenario names (found during implementation — without this the Recap SMS would have silently shown an empty "here's what you heard" section). |
| `8581fee` | Live-call fix #1 — added a pause before the bridge line ran into the first gate question (they were concatenated with no separator at all). |
| `9fe507f` | Live-call fix #2 — Wael: "we need a more business/life example, not knee." Unified Search's example changed from "Dr. Smith / insurance card / knee" to "the accountant / tax documents / home office deduction." |
| `0f2053b` | Live-call fix #3, **the real pause fix** — see the misdiagnosis trace below. |
| `524e63b` | Live-call fix #4 — reminder-time parser dropped the hour when Twilio transcribed a spoken time without a colon ("four ten am" → read as bare "10am", losing the "four"). Fixed by accepting a space as well as a colon between hour and minute in the regex. |
| `f2e6afe` | Live-call fix #5 — see the misdiagnosis trace below. |

**76-81 tests passing throughout** (grew as fixes were added; run `npm test` in `naavi-voice-server/` to confirm current count).

### The pause misdiagnosis — worth reading before touching pacing again

Wael reported "pause too long" **three times** in a row. This is a real example of chasing the wrong layer twice before finding the actual cause — useful to not repeat:

1. **Report 1** ("too fast, missed the question"): real bug — bridge line and decline line were concatenated directly onto the next question with zero separator. Fixed in `8581fee` by adding a 600ms `<break>` inside `scenarioWalkthrough.js`.
2. **Report 2** ("pause too long" — after fix #1): guessed the wow-moment `<break>` (1000ms) was too long, trimmed to 400ms. **This was treating the wrong symptom** — the actual issue was that this 400ms was *stacking* with a completely separate, pre-existing `<break time="800ms"/>` hardcoded in `index.js` between a scenario's body and the closer line. Combined ~1.2-1.8s, nobody had ever measured it as one number.
3. **Report 3** ("still long pause after my answer, before the second offer" — after fix #2 in `0f2053b` removed the stacking): **still wrong layer.** The actual cause, found by grep, was `index.js:7148`'s closer `<Gather>` set to `speechTimeout="3"` — the only `Gather` in the entire file not set to `1` or `2`. `speechTimeout` is Twilio's own silence-detection window, not an SSML `<break>` tag at all — no amount of trimming pause tags could ever have fixed it, since it happens between Twilio's own processing steps, before the server is even called. Fixed in `f2e6afe`, `3` → `2`.

**Lesson if this resurfaces:** check `speechTimeout` values (`grep speechTimeout src/index.js`) before touching another `<break>` tag.

### What's NOT done: the actual field test

`docs/F11A_SCENARIO_SCRIPT_2026-07-04.md` §12 calls for **20-30 real calls to the staging demo number, +1 (873) 446-2284**, tracking: where callers interrupt, which scenario gets the strongest reaction, whether callers stay through all three default scenarios, and what percentage proceed to set a reminder. None of that data exists yet — this session's staging calls were ad hoc bug-hunting (which is how the 5 fixes above got found), not the structured test. **Before promoting anything to production**, run that field test, or at minimum confirm the 5 fixes above sound right on a couple of clean test calls.

---

## 2. F12 — literal third-party email/phone alerts silently fail (NEW, main priority)

Full detail: `docs/F12_PHASE1_PROBLEM_DEFINITION_2026-07-05.md`. Summary: alerts like "when I arrive at X, send email to specific@address.com" create a rule with no destination and never fire. Root cause is proven — `supabase/functions/_shared/anthropic_tools.ts`'s tool schema has no `to_email`/`to_phone` input field by deliberate, explicitly-locked design ("do not relax without re-approval"). A prompt-only workaround was tried and empirically fails (confirmed live against staging, not just reasoned about). **Wael's explicit instruction: this needs the full governance process (Phase 2-8) before any fix** — do not attempt a quick patch. Phase 1 is done and approved to move to Phase 2; nothing else has been decided.

**Two things worth confirming early in Phase 2** (not yet done):
- Why was "Decision A" locked in the first place? The code doesn't say — worth finding whoever/whatever session made that call before deciding whether to reopen it.
- Does `naavi-voice-server` have the same `useOrchestrator.ts`-style resolution gap for voice-originated alerts? Not audited this session.

---

## 3. Housekeeping — small items, already resolved

- **Staging `demo_optouts`:** Wael's own number (`+16137697957`) was sitting in this table from 2026-07-02 (likely from testing the verbal-STOP feature), silently blocking every demo-line reminder test from his number. Removed — confirmed via before/after query.
- **Local Claude Code permissions:** `.claude/settings.local.json` now has `"defaultMode": "bypassPermissions"` (Wael: prompts were slowing the workflow). Project-level `.claude/settings.json`'s allow-list was already broad; this was the missing piece. Personal setting, not committed to the shared project file.

---

## 4. Uncommitted state — check before doing anything else

`supabase/functions/get-naavi-prompt/index.ts` has an **uncommitted, staging-deployed** change (currently live on staging as `PROMPT_VERSION = '2026-07-05-v133b-revert-schema-impossible-to_email'`, not committed to git in the `naavi-app` main repo). Contents: corrected several location-alert examples that were still written in dead pre-"Phase 3.5" syntax (`call set_action_rule with place_name='Costco'` instead of the actual current `set_location_rule_chain(...)`/`set_location_rule_address(...)` tool calls) — confirmed correct by reading `_shared/anthropic_tools.ts` directly, unrelated to the F12 problem. This is a legitimate, low-risk documentation fix, verified deployed and working on staging. It has **not** been committed to git and has **not** been deployed to production. Decide whether to commit it (recommend: yes, it's a real correction) before starting new prompt work, so `git diff` on this file stays clean for the next round of changes.

Run `git diff supabase/functions/get-naavi-prompt/index.ts` to see the exact pending diff.

---

## 5. What did NOT happen this session

No production changes anywhere. No mobile app code touched. No database schema changes. No AAB/build. `naavi-voice-server` `main` (production) is untouched — only `staging` branch has the F11a commits.
