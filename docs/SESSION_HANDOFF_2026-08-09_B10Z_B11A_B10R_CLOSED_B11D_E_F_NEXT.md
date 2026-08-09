# Session Handoff — 2026-08-09 — Capability-Answer Bug Fixed, B10z/B11a/B10r Closed, B11d/B11e/B11f Open (Next Session's Job)

## What this session actually accomplished (verified, still live)

**Capability-answer JSON double-nesting — SHIPPED to staging, verified.**

- Root cause was a **code/prompt mismatch**, not a prompt-wording problem: `naavi-chat`'s Path B (Claude tool-use flow, ~`index.ts:3680`) treats Claude's text content block as plain prose (`speech` = raw concatenated text, `display` = a copy of `speech`, then both wrapped in a new JSON envelope). But `get-naavi-prompt`'s `formatRule` separately instructs Claude to respond with `{"speech":...,"display":...}` JSON **as its text** — for a capability question with no tool call to make, Claude complied literally, and the whole envelope got wrapped a second time.
- **Two prompt-only fix attempts failed first, tested via direct curl calls to staging (not guesses):** rewriting `capabilityLengthRule`'s SHAPE example to avoid literal JSON, then adding an explicit "never describe your own schema" guardrail. Both made it *worse* (100% failure vs ~80% before), because the model still had `formatRule`'s own literal JSON worked examples to anchor on.
- **Actual fix (3rd attempt, code not prompt):** server-side unwrap right after `speechBlocks` is captured (`naavi-chat/index.ts:3708`), reusing the existing `extractAndParseJson()` helper to detect and extract an embedded `{speech,display}` blob before anything downstream touches it.
- **Verified:** 10/10 clean direct staging calls (was ~80-100% failing before), full 44-test `prompt-regression` suite green, new locked-in test `prompt-regression.capability-answer-no-nested-json`. Confirmed live on Wael's device too.
- Committed `6ac4175`, pushed. Memory: `project_naavi_capability_answer_json_break_fixed.md` (includes the reusable lesson: check whether the prompt's format instructions match what the *consuming code path* expects before assuming the wording is wrong).

**Production-readiness assessment given, not a decision made.**

- Wael asked for an assessment on whether to move from Internal Testing to Closed Testing or Production (Google's own review already approved production).
- Checked directly: `test:auto`'s last **full** suite run (515 tests) was 2026-08-03, **not green** (12 errored). No recent Firebase Test Lab confirmation found. Several Tier-1 "states something false as fact" bugs were open at assessment time.
- **Recommended Closed Testing over Production** on that basis — real external usage, contained blast radius, given the gates weren't confirmed and the open-bug profile skewed toward the most severe class this project tracks (Rule 18 violations).
- **This recommendation has not been re-run** against the now-updated bug list (3 of the 4 cited bugs closed this session, see below) or fresh gate checks. Re-verify before treating it as still current.

**B10z, B11a, B10r — all CLOSED 2026-08-09, live retest, not reproducing.**

- Walked one at a time, each verified against real current data before closing (per this project's own governance — validate by live test, don't chase a contrived repro after a clean test passes):
  - **B10z** (live-calendar regex gap): "What time should I leave for team standup?" against a real recurring event — found correctly, working travel-time card. The code gap (`LIVE_CALENDAR_RE` still missing "should") is real but likely never hit because the mobile client's cached brief items already cover it.
  - **B11a** (fabricated address): "What time should I leave for gym class?" against a real event whose address lives in `description` not `location` — Naavi returned the correct real address, no fabrication.
  - **B10r** (fabricated birthday/anniversary year): original test contact (Fatma) no longer in the account used; verified instead against James Okafor, whose real Contact shows a birthday with a year — "Tell me about James" showed month/day only, no fabricated year.
- Holding list: all three moved from the open Tier-1 priority queue *and* the formal `## Bugs (B) — OPEN` table into `docs/HOLDING_LIST_CLOSED_ARCHIVE_2026-07-28.md`. Commit `870ef96`, pushed.
- **Governance gap found and corrected along the way:** B10r's detailed record had been sitting in the *open* Bugs table for weeks despite being effectively done — the open-list narrative and the formal table had drifted out of sync. Check both next time, not just one.

**Three new items found live during that same retest, all logged as OPEN — this is next session's job.**

1. **[[B11d]]** — Naavi never surfaces a contact's *real* birthday/anniversary year even when Contacts genuinely has one on file (James's card shows Jan 1, 2026; `lookup-contact` returned `birthday: null`). Not a Rule 18 violation (omission is the safe fallback) but a real completeness gap. **Leading hypothesis, unconfirmed:** `_shared/contact_date_facts.ts`'s `formatDateFact()` only reads the structured `date.month`/`day`/`year` object, never the sibling `text` field Google's API also supports (defined in the type, never consumed) — plausible for James specifically since his contact is Outlook-sourced. **Needs a temporary diagnostic log + redeploy to see his raw Google API payload** before this is confirmed, not just theorized.
2. **[[B11e]]** — a literal "Invalid Date" string appeared once in a meeting narration ("Meeting with James — discuss summer plans on Invalid Date"). Did **not** reproduce on an immediate retest of the same event, but that retest used a visibly different response format (raw grouped `calendar`/`rules`/`email_actions` dump vs. narrated prose) — unclear if the two formats hit different date-formatting code, or if this is a genuinely intermittent parse failure. No code read yet.
3. **[[B11f]]** — Fatma Elmehelmy's real, currently-existing Contact (confirmed via screenshot) is completely invisible to `lookup-contact`/`global-search` — zero results, HTTP 200, no error — despite the account holding a valid, recently-refreshed OAuth token (verified via service-role DB query, ruling out a broken connection). **Leading hypothesis, well-evidenced but unconfirmed:** `lookup-contact/index.ts:175-182` uses Google's `people:searchContacts` endpoint, documented by Google as running against a best-effort, asynchronously-populated internal index — not guaranteed to reflect a contact immediately, unlike Calendar's always-live API (which is why B10z/B11a's calendar-based tests worked cleanly on the same account). **Possible connection to an older, still-unresolved finding:** B10r's original 2026-07-22 session left voice's "Fatma" recognition unresolved too, with a *different* leading hypothesis (voice classifier sending only the first word of a multi-word name) — these may be two independent causes of the same symptom across different sessions, not necessarily the same bug. Worth checking both before assuming either is the sole cause.

All three fully written up with evidence in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`'s `## Bugs (B) — OPEN` table, and B11d/B11f additionally have their own memory files (`project_naavi_b11d_contact_year_never_surfaced.md`, `project_naavi_b11f_contact_search_index_gap.md`).

**Also this session:** researched the open Anthropic GitHub issue on Claude Desktop's `bypassPermissions` mode not being honored (#75235) — confirmed this project's own `.claude/settings.local.json` config is already correct, so any prompts seen are the upstream Desktop bug, not a missing permission rule. Verified two independent root-cause theories from community comments (async config race collapsing "unknown" to "denied"; a GrowthBook experiment flag silently overriding local settings) and confirmed the same broad symptom class is also reported in the VS Code extension, not just Desktop — though not confirmed as the identical code-level cause. Memory updated: `project_claude_desktop_permission_regression.md`.

## Next session — explicit instructions from Wael

**Research and fix the 3 new bugs: B11d, B11e, B11f.** Start from the "Leading hypothesis, unconfirmed" notes above for each — none of the three has a confirmed root cause yet, only well-evidenced theories. Confirm before fixing (temporary diagnostics where noted), per this project's standard discipline. B11f in particular may connect to the older unresolved voice-Fatma-recognition gap from B10r's original session — worth checking both hypotheses rather than assuming either.

Not part of this instruction, but still genuinely open and worth keeping in view: B10y (auto-tester's own unscoped teardown can wipe real calendar data — mitigated, root fix not done), and the production-readiness re-check noted above once B11d/e/f's status is clearer.

## Git state

Two commits pushed this session: `6ac4175` (capability-answer fix) and `870ef96` (holding-list closures + new items). Nothing else outstanding — repo clean relative to these changes.
