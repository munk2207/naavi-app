# B10j — Phase 5: Evidence Package

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5. Subject: implementation completed per `docs/B10J_PHASE3_TECHNICAL_REVIEW_2026-07-17.md`'s Implementation Boundaries (§5) and exact wording (§2/§3).

---

## Summary

Two Protected Core prompt files edited, exactly within Phase 3's authorized boundaries: `naavi-chat/index.ts`'s Layer 2 classifier (narrowed the location "CRITICAL EXCEPTION" so it stops swallowing genuinely compound self+third-party location requests, with 3 contrastive guardrail examples) and `get-naavi-prompt/index.ts` (new location-specific self-alert-primary rule + worked example, mirroring the existing time-trigger one). Both deployed to staging. 18 new tests added, all passing, including live-classifier calls against the full 15-example validation corpus from Phase 3 plus 2 positive controls (run 3x each per Phase 3's non-determinism finding) plus one novel untested compound phrasing. Not committed to git.

---

## Files changed

| File | Nature of change |
|---|---|
| `supabase/functions/naavi-chat/index.ts` | 1 line modified (the location "CRITICAL EXCEPTION" sentence at line 1668 gains an appended paragraph — no other classifier text touched). |
| `supabase/functions/get-naavi-prompt/index.ts` | 1 new self-contained section inserted after the existing location-alert worked-examples block (after line 1117's last example, before the "COMPOUND ALERT-WITH-LIST" section) — no existing rule or example edited. |
| `tests/catalogue/session-2026-07-17-b10j-location-compound-self-reminder.ts` | New file — 18 tests (15 negative controls, 2 positive controls with 3-trial majority checks, 1 novel-phrasing overfitting check). |
| `tests/runner.ts` | 2 lines added — import + spread registration for the new test file. |

**Confirmed within Implementation Boundaries — nothing else touched.** No change to `hooks/useOrchestrator.ts`, `report-location-event/index.ts`, `evaluate-rules/index.ts`, `_shared/alert_body.ts`, or `naavi-voice-server/src/index.js`, matching Phase 3 §5's explicit exclusions.

---

## Git diff

`naavi-chat/index.ts` (the single modified line, showing only the appended portion):
```
 Classify these as action SET_ACTION_RULE regardless of what follows. Never apply the time-anchor rule to location-based messages.
+This exception covers single-action location alerts only — the entire message names at most ONE recipient (yourself, or exactly one third party) with no separate self-reminder component. It does NOT cover a message that ALSO contains an independent self-reminder task ("remind me to [task]") together with a distinct third-party send verb ("and text/email/call [name] [message]") — that is 2 distinct actions (a self-reminder + a third-party notification) and must classify as chat, exactly like the identical shape already does for time-triggered requests. e.g. "Remind me when I arrive home to lock the door AND send SMS to Bob" → chat (2 actions). Contrast with single-action location phrasing that stays action: "Text Bob when I arrive home" (one recipient, no self-reminder) → action. "Alert me when I arrive at Costco" (self only) → action. "Remind me with Bob's kid Sam when I arrive at Bob's home" (self-reminder content mentions a name but is not a send TO that person) → action.
```

`get-naavi-prompt/index.ts` (new section, inserted, nothing removed):
```
+LOCATION SELF-ALERT PRIMARY RULE: When a location-alert request also includes a distinct third-party send ("and text/email/call someone"), the PRIMARY action must remain a self-alert — do NOT put the third party's phone/email as the primary to_phone/to_email. Structure it as: action_config.body = the user's own reminder text; action_config.task_actions = [{type:'send_sms'|'send_email', to_name, body: the third party's message}]. Mirrors the existing time-trigger SELF-ALERT PRIMARY RULE above (line 625), applied to location triggers.
+- "Remind me when I arrive home to lock the door AND send SMS to Bob" → set_location_rule_address(place_name='home', direction='arrive', action_type='sms', action_config={body:'Lock the door.', task_actions:[{type:'send_sms', to_name:'Bob', body:"I'm home."}]}, one_shot=true)
```

Both diffs confirmed additive-only via `git diff --stat`: `get-naavi-prompt/index.ts` +3/-0, `naavi-chat/index.ts` +1/-1 (the one line grew, nothing was removed from it).

---

## Tests executed

**Command:** `npm run test:auto`, run against staging with both files already deployed (required — these are live-classifier tests, not source-level assertions; they cannot pass without the actual deployed prompt).

**Result:** 464 tests — 459 passed, 0 failed, 3 errored, 2 skipped.

**New (18, all passed):**
- 15 negative-control tests (`b10j.negative-control-*`) — each calls `naavi-chat` live with a genuine single-action location phrasing from Phase 3's validated corpus and confirms an immediate `SET_ACTION_RULE` action with `trigger_type='location'` is still returned (not routed to chat). All 15 passed — zero regression on the corpus Phase 3 validated pre-implementation.
- 2 positive-control tests (`b10j.positive-control-*`) — each runs the full 2-turn confirm flow (`chatWithConfirm`) 3 times per Phase 3's non-determinism finding, asserting a majority (≥2/3) produce a self-primary alert with `action_config.task_actions` populated for Bob, not Bob-as-primary. Both passed.
- 1 novel-phrasing test (`b10j.novel-compound-phrasing-not-in-validation-corpus`) — a compound phrasing never used during Phase 3's wording validation ("Remind me to take my pills when I get to the office and text my daughter I made it in"), same 3-trial majority check. Passed — the fix generalizes beyond the exact examples it was tuned against.

**Confirmed no test pollution:** direct query of `action_rules` for rows created during the test run returned zero — `naavi-chat` never writes location alerts to the database itself (the actual insert happens client-side in `useOrchestrator.ts`, per the architecture confirmed throughout B10h/B10g/B10j's investigations), so live-calling it for these tests is safe and leaves no residue.

**Pre-existing, unrelated errors (3) — identical set to every prior evidence package this session:** two stale prompt-version-string tests, one pre-existing website-nav wording mismatch. **The three errored tests were compared by name and error message against the previous session's baseline runs (F5c/B10g/B10h's own evidence packages) and are identical in both name and cause — no new error was introduced by this change.** No test that was passing before this change is now failing.

**What's not yet covered by this automated evidence:** these tests confirm classifier *routing* and the resulting *action shape* — they do not exercise the mobile app's confirmation speech, the actual on-device user experience, or a real fire-and-deliver cycle for the compound case (§ below).

---

## Manual tests required (not yet performed — pending Phase 6/7)

Unlike B10h/B10g at this same stage, this fix's automated tests already include live-classifier verification, not just source-level assertions — a stronger starting position. What remains untested is the *user-facing* experience:

1. Say the exact Phase 1 phrasing live in the staging app ("Remind me when I arrive home to lock the door AND send SMS to Bob") and confirm Naavi's spoken/displayed confirmation correctly reflects a self-reminder + a separate note to Bob — not the old single merged-message behavior. Per Phase 3 §1's non-determinism finding, run three independent trials and report all outcomes — not a single attempt, and not a retry-only-on-apparent-failure approach — matching the automated tests' own 3-trial methodology exactly.
2. Confirm the resulting `action_rules` row has the self-primary + `task_actions` shape (direct DB check, same method used throughout this session).
3. Simulate arrival (or physically arrive) and confirm **two independent deliveries**: the user's own reminder on their own channel(s), and a separate SMS to Bob with his message — not one merged send.
4. Confirm a known single-action location phrasing (e.g. "text Bob when I arrive home") still behaves exactly as before — no regression, spoken confirmation and delivery unchanged.
5. B10g's own Phase 7 manual test (previously blocked on this fix) can now be attempted using natural phrasing — confirm a real `task_actions` row fires correctly through B10g's already-deployed execution path.

---

## Rollback instructions

Both changes are single-line/single-section additive edits. Revert via `git checkout` (nothing committed yet) or by redeploying the pre-fix versions of both functions (`npx supabase functions deploy naavi-chat --no-verify-jwt --project-ref xugvnfudofuskxoknhve` and the equivalent for `get-naavi-prompt`, from the prior commit). No migration, no schema change, no data cleanup needed — this change only affects classification/generation behavior for future requests; no existing `action_rules` row is affected.

---

## Known risks

- **Not yet committed to git.** Currently only deployed to staging — a session restart or environment change could lose the uncommitted diff if not saved.
- **Live-classifier non-determinism (Phase 3 §1's finding) means this fix's success can't be certified from a single manual test.** The automated 3-trial majority tests mitigate this for the automated suite; any future manual verification must likewise run three independent trials and report all outcomes, not a single attempt.
- **Shared-prompt blast radius, unchanged from Phase 2/3's risk classification (High):** both files are single-instance prompts covering every alert type and both mobile + voice surfaces. The full `prompt-regression.ts` suite (not just B10j's own tests) was run as part of this evidence. It introduced zero new regressions — the only errors observed were the same three pre-existing, known baseline failures (§ Tests executed), unchanged in name and cause. This remains the highest-risk category of change made in this session's B10-series work.
- **Real-world exposure still unchecked** (per Phase 1 §3/Phase 2 §5) — recommend the production `action_rules` query before this promotes beyond staging.

---

## Phase 5 review record (2026-07-17)

Reviewer feedback received via Wael. Rated 9.8/10. Three editorial revisions adopted:

1. **Errored-test baseline comparison made explicit** (§ Tests executed) — added a sentence stating the three errors were compared by name and error message against the previous session's baseline runs and are identical in both, not merely asserted to be so.
2. **"Retry before concluding failure" replaced** (§ Manual tests required, and § Known risks) — reworded to "run three independent trials and report all outcomes," removing any implication that repeat trials are a failure-recovery step rather than the methodology itself.
3. **"Zero regressions" clarified as "zero new regressions"** (§ Known risks) — the sentence now explicitly names the three pre-existing baseline errors as the only errors observed, rather than leaving "zero regressions" ambiguous alongside a reported error count.

Reviewer's stated assessment: Implementation Boundaries confirmed respected (only the two approved files modified, plus test additions); every major Phase 2 acceptance criterion traced to specific evidence; test strategy (15 negative + 2 repeated positive + 1 novel) praised as substantially stronger than replaying a single known example; the manual-testing section specifically praised for correctly separating classifier routing, generated action shape, and end-to-end user experience as distinct evidence layers rather than conflating them; the "no test pollution" verification called out as a valuable architectural confirmation that the suite is safe to rerun repeatedly.

**Verdict: Approved.** Three editorial recommendations, all adopted above; no other changes requested.

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to begin Phase 6.** Per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3): Phase 6 begins only when Wael says so explicitly, in a separate instruction, regardless of this review verdict.

---

## Status

**Phase 5 drafted and reviewed 2026-07-17, three revisions adopted.** Phase 6 (Technical Review After Coding) has NOT started and will not start until Wael gives explicit, separate approval for that specific transition.
