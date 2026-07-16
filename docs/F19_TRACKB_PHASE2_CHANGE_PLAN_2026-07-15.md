# F19 Track B — Phase 2: Change Planning

**Second revision (this revision).** Written after Phase 1's second revision (§2f — the barge-in/STT truncation finding, surfaced while verifying 1c live) and after 1c itself shipped, deployed, and was verified live twice (see `docs/SESSION_HANDOFF_2026-07-15_F19_TRACKA_CLOSED_TRACKB_1C_SHIPPED.md`). **§1-3 (1c) are unchanged from the original revision and are historical record only — 1c is closed, already reviewed by Phase 3 (2 rounds, APPROVE), implemented, and verified. Nothing in §1-3 is reopened by this revision.** Only §4 (1d) and §5 (1e) are revised, per Wael's confirmed scope: 1d gets a concrete live-test procedure (was previously only a trigger/question, never executed); 1e's logging plan is widened to capture the `[Barge-in]` flag per turn and is explicitly combined with the pre-existing, unfixed barge-in/STT truncation bug (`project_naavi_deepgram_first_word_truncation`) into one investigation rather than two, per Phase 1 §6's recommendation.

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. Builds on `docs/F19_TRACKB_PHASE1_PROBLEM_DEFINITION_2026-07-15.md` (second revision, approved by ChatGPT with the softened 1d framing adopted). Touches Protected Core (Voice orchestration). Per Phase 1's evidence, this is **High Risk** for 1c (Protected Core prompt/schema change affecting every voice call — already shipped), and **Low Risk** for the 1d live-test and 1e's logging addition (diagnostic/read-only, no behavior change) — see revised §6.

As Phase 1 concluded, 1c/1d/1e are three different work types and are planned separately, not as one undifferentiated change:

- **1c — full implementation plan** (this document's main content).
- **1d — explicit decision point, not a fix.** No file changes proposed. Reassessed after 1c ships and is verified.
- **1e — investigation plan, not an implementation plan.** No fix designed; a diagnostic logging plan is scoped instead.

---

## 1. Track B-1c — files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `naavi-voice-server/src/anthropic_tools.js` | Shared Logic (Protected Core — voice's tool-use schema, read on every voice call) | Add recipient-capture instruction + worked examples to both location tool descriptions (`set_location_rule_chain`, `set_location_rule_address`) — see §2 for exact proposed text. No schema/field changes: `to` already exists in `ACTION_CONFIG` (line 100); this is purely descriptive text Claude reads to decide when to populate it. | **High** — Protected Core, every voice call reads this file's tool descriptions; a badly-worded addition risks over-eager `to` population on self-alerts (regression), not just under-population (today's bug) |

No other files. This is a single-file, additive-text change — mirrors mobile's already-shipped, already-tested fix (`get-naavi-prompt/index.ts`, deployed and verified in Track A) as closely as the file's different structure allows.

---

## 2. Proposed text (for Phase 3 review — not yet applied)

**`set_location_rule_chain`** — add one example and the imperative line, appended after the existing "DO NOT use this tool for personal keywords" sentence:

```
'- "text Bob when I arrive at Costco Merivale" with Bob a known contact → chain_brand="Costco", place_name="Costco Merivale", action_type="sms", action_config={to:"Bob", body:"Arrived at Costco."}.\n\n' +
'IMPORTANT: When the user names a recipient ("text Bob", "tell my wife", "message Sarah") anywhere in the sentence, ALWAYS put that name in action_config.to — never drop it, even though this tool\'s primary subject is the place, not the recipient. This applies exactly the same way it does for the general set_action_rule tool\'s non-location triggers.'
```

**`set_location_rule_address`** — add two examples and the same imperative line, appended after the existing "alert me at Joe's place" example:

```
'- "text Bob when I arrive at 123 Maple St" with Bob a known contact and the address confirmed → CALL with place_name="123 Maple St", action_type="sms", action_config={to:"Bob", body:"Arrived at 123 Maple St."}.\n' +
'- "tell my wife when I leave the office" → CALL with place_name="office", direction="leave", action_type="sms", action_config={to:"wife", body:"He\'s leaving the office."}.\n\n' +
'IMPORTANT: When the user names a recipient ("text Bob", "tell my wife", "message Sarah") anywhere in the sentence, ALWAYS put that name in action_config.to — never drop it, even though this tool\'s primary subject is the place, not the recipient. This applies exactly the same way it does for the general set_action_rule tool\'s non-location triggers.'
```

Wording deliberately mirrors mobile's shipped fix (same imperative sentence, same example shape: named contact + literal address) rather than inventing new phrasing — minimizes the risk of introducing a new, different bug on voice while fixing this one.

### Acceptance criteria (added per Phase 3 review) — what Phase 5 must verify

1. "Text Bob when I arrive at Costco" (Bob a known contact) produces `action_config.to = "Bob"`.
2. "Email me when I arrive home" does **not** populate `action_config.to` — self-alert phrasing stays a self-alert.
3. Existing self-override scenarios (e.g. "email me at jane@x.com when I arrive at Costco") continue passing unchanged — no `to`/`to_name` leaks in alongside a `self_override_*` field.
4. Existing location reminders with no recipient at all (e.g. "remind me to buy milk when I arrive at Costco") continue passing unchanged — no spurious `to` gets invented where the user named no one.
5. "Text UnknownPerson when I arrive at Costco" (not a real contact) follows the existing unresolved-contact behavior (`resolve-recipient` returns `ambiguous`/`not_found`, the row fails closed per Phase 1 §2c's evidence) and must **not** silently fall back to a self-alert.

All five must pass before 1c is considered verified — 1 and 4 test the fix itself; 2, 3, and 5 are the regression guard, together covering all four real outcomes: success, self, no-recipient, and unresolved-recipient.

---

## 3. Regression impact (1c)

| Area | Impact | Why |
|---|---|---|
| Voice commands | **Affected — primary surface.** Every voice call reads this file. Self-alert phrasing ("email me at X when I arrive at Y" — the F15/self-override case, already shipped) must NOT regress into populating `to` — the added examples and imperative are scoped to "when the user names a recipient," which self-override phrasing never does (it names an address, not a person). Needs explicit negative-case testing (see §5). | Direct file touched |
| Geofencing | Not affected. No change to `useGeofencing.ts`, trigger detection, or OS-level geofence registration — only Claude's tool-call content. | No overlap |
| Gmail integration | Not affected. | No overlap |
| Calendar integration | Not affected. | No overlap |
| Reminders | Not affected. `tasks`/`list_name` guidance in `ACTION_CONFIG` is untouched. | No overlap |
| SMS / call alerts | **Affected — this is the fix's purpose.** Location-triggered SMS/email to a named third party should now resolve correctly instead of dropping the name. | Direct purpose |
| Onboarding | Not affected. | No overlap |
| Staging build | **N/A for voice** — per F17 Phase 2's own finding, voice has no staging environment; there is one Railway service (production) and one branch it deploys from (`main`). This change ships directly to the only environment voice has, same as F17/F12's voice-side work did. | Confirmed in `docs/F17_PHASE2_CHANGE_PLAN_2026-07-14.md` §0 |

---

## 4. Track B-1d — explicit decision point (revised this revision — now a concrete test procedure, no file changes)

Per Phase 1's approved, softened conclusion: **no independent implementation is justified now.** No files are proposed for change under 1d in this document. **Trigger condition is now met** — 1c shipped, deployed, and was verified live twice (`0d78050`, per the Track A/B close-out handoff) — so this revision turns the previously-scheduled question into an executable procedure rather than leaving it open-ended.

**Reassessment question (unchanged):** does any row reach fire time with a named-but-unresolved third-party recipient, on the current (post-1c) codebase?

**Procedure (new this revision):**
1. Place a real voice call to production. Say a phrasing matching 1d's original two reproductions as closely as possible — e.g. *"Text [a real, known contact name] when I arrive at Costco"* (reuses 1c's own verified test shape) and, separately, a phrasing naming a **real contact whose resolution is expected to succeed but where the call is interrupted/barge-in occurs mid-name** if that can be induced, to probe whether 1d and the barge-in bug (§5 below) can compound.
2. Confirm via Railway logs (`naavi-voice-server` Deploy Logs) that the tool call captured `to` with the spoken name.
3. Have Wael create a temporary test row via the Supabase SQL editor (no service-role key available in this environment, by design — same two-person workflow used for 1c's verification) and fire the dwell-deferred event directly, exactly as done for 1c.
4. Inspect the fired alert: did it reach the named third party, or silently fall back to self (the original 1d symptom)?
5. Delete the temporary test row after.

**If it still fails post-1c:** 1d becomes its own Phase 1 (a genuine independent defect would have been found, not assumed).
**If it resolves correctly:** the residual gap — `report-location-event` has no fire-time re-resolution safety net for a destination that resolved successfully at creation but goes stale before firing — remains as a separately-tracked, lower-severity open item (not closed, not urgent, explicitly not conflated with 1d's original "silently misfires to self" framing).

This procedure is diagnostic only (a live test + log/DB inspection) — **no code changes are proposed for 1d in this document.** If step 4 shows a failure, that finding becomes its own Phase 1, not an on-the-spot fix.

---

## 5. Track B-1e — investigation plan (revised this revision — widened scope, not an implementation plan)

Per Phase 1 (original): root cause not proven, no code-level bug found in the confirmation path (there is no JS state machine there to have a bug in). Per Phase 1 §2f (this session's live finding): STT truncation during barge-in is **proven** to occur in this system in a closely related scenario, and is compatible with 1e's symptom — promoted to the first hypothesis this investigation should test, not a preselected conclusion. Per Phase 1 §6: the barge-in/STT truncation bug (`project_naavi_deepgram_first_word_truncation`, open since 2026-04-19, 4 candidate fixes never implemented) should be investigated **together with 1e, not sequentially**, since they may share one root cause and one fix. This revision widens the logging plan accordingly — still a single live-traced reproduction with logging, not two separate investigations.

**Proposed investigation (files that would change — temporary, diagnostic only):**

| File | Classification | Change | Risk |
|---|---|---|---|
| `naavi-voice-server/src/index.js` | Backend (Protected Core) | Add temporary console logging around the Claude tool-use turn loop, covering **both** (a) confirmation turns where the action under discussion carries a `self_override_*` field (1e's original scope) **and** (b) any turn immediately following a `[Barge-in]` event (widened scope, catches the truncation bug generally, not only inside 1e's specific flow). Per turn, log: the raw STT/Deepgram transcript text, **whether `[Barge-in]` fired for that turn** (new field this revision), Claude's exact response (speech + whether it called a tool), and if a tool call was made, its populated fields. Railway captures console output already (per CLAUDE.md's "check Deploy Logs" pattern) — no new logging infrastructure needed. | **Low** — logging only, no behavior change, easily reverted |

**Reproduction method (widened):**
1. Re-run Phase 1's original 1e phrasing ("Text me at [phone] in 3 minutes") on production voice with logging active, capture the full per-turn transcript-vs-response trace, and inspect for: (a) whether the phone number STT produces is consistent turn-to-turn (digit-transposition hypothesis), (b) whether `[Barge-in]` fired on any of the repeated-confirmation turns (tests whether 1e is actually an instance of the barge-in truncation bug), and (c) what Claude's exact speech/reasoning was on each repeated ask (prompt-ambiguity hypothesis, tested only if (a) and (b) come back clean).
2. Separately (same logging, same live session where practical), attempt to reproduce the barge-in truncation bug directly per its own existing test recipe (`project_naavi_deepgram_first_word_truncation` memory: speak during TTS playback, check whether the leading word(s) are dropped in the Deepgram FINAL transcript) — confirms the bug is still live on current code and captures a fresh trace to compare against 1e's trace.
3. Compare the two traces. If both show the same signature (`[Barge-in]` immediately preceding a truncated transcript), that supports one shared root cause and one shared fix, per Phase 1 §6. If 1e's trace shows failures with no `[Barge-in]` marker at all, that rules out the STT hypothesis for 1e specifically and points back to mechanism 2 (prompt-level ambiguity, Phase 1 §2e).

This determines which of Phase 1 §2e's two candidate mechanisms (or a third, not yet considered) is real, and whether 1e and the barge-in bug are one problem or two — **not designed as a fix here**, since Phase 1 explicitly found no bug to fix yet in 1e's own path, only a symptom without a located cause, and the barge-in bug's own fix directions (4 candidates in its memory file) are not evaluated or chosen by this document either.

**Predefined confirmation criteria (added per Phase 3 review — decided before the investigation runs, not fitted to the logs afterward):**

| Verdict | Evidence required (from the four logged fields: transcript, `[Barge-in]`, Claude response, tool call) |
|---|---|
| **Confirmed STT/barge-in mechanism** | Repeated reproductions show transcript corruption immediately following `[Barge-in]`, **and** the resulting tool call (or lack of one) matches what the corrupted transcript would produce — i.e., Claude acted correctly on what it actually received; the input itself was wrong. |
| **Confirmed prompt mechanism** | Transcript remains correct and consistent across turns, **no** `[Barge-in]` present, and Claude still repeatedly fails to act (re-asks, doesn't call the tool) despite receiving the same correct input each time. |
| **Neither confirmed** | Neither pattern holds cleanly across the reproduction attempts (e.g., transcripts are correct but inconsistent for a reason other than barge-in, or the failure doesn't correlate with either signal). In this case, do not force a verdict — treat 1e as still "root cause not proven" and continue investigating rather than picking the closer-looking option. |

This table is the fixed interpretation rule for the trace collected in §5 — logs are read against it, not the other way around, so an ambiguous trace doesn't get retroactively fitted to whichever hypothesis looks more plausible after the fact.

**Logging removal criteria (added per Phase 3 Round 4 review — explicit exit condition, so diagnostic instrumentation cannot silently outlive its purpose):** the temporary logging added under this Phase 2 is removed once **all three** of the following are true:
1. The required traces have been captured — at minimum, one reproduction attempt of 1e's original phrasing and one reproduction attempt of the barge-in test recipe (§5 reproduction method, steps 1-2), with enough turns logged to reach one of the three predefined verdicts above (or to conclusively record "neither confirmed").
2. Conclusions have been documented — the verdict reached (per the table above) is written up, in the same style as this project's other investigation write-ups (a Phase 1 document, if the trace confirms a mechanism worth fixing; or a short closure note in this document's revision history, if the verdict is "neither confirmed" and no further action is triggered).
3. If a verdict is reached that warrants a fix, that fix has either been scoped as its own Phase 1 (per §7's recommendation to Phase 3) or the decision to defer it has been explicitly recorded.

**Once all three are met, logging removal happens under one of two paths, not left open-ended:** (a) as its own small implementation task (a single-file revert of the diagnostic logging added here, its own minimal Phase 2/4 given the low risk), or (b) folded directly into the subsequent fix's own implementation, if a fix is approved and scoped soon after the verdict — in which case the fix's own Phase 4 removes the temporary logging as part of the same commit rather than as a separate step. Either path must be recorded in this document's revision history (or a superseding revision) so the logging's lifecycle is auditable end to end — added here, used for X, removed there.

**Not part of this Phase 2:** removing the temporary logging (scoped above as its own follow-on task, not executed here), choosing/implementing a fix for the barge-in truncation bug (its 4 candidate directions remain unevaluated), or any code change to the confirmation flow itself — those depend entirely on what the combined trace shows and would need their own Phase 1 (this investigation's findings) before a fix could be planned.

---

## 6. Risk classification — overall

**1c: High** — already shipped under this classification (unchanged, historical). **1d (revised): Low** — the live-test procedure in §4 is read-only against production (a real call + a temporary DB row Wael creates and deletes via SQL editor, no code path changed) — same shape as 1c's own verification, which carried no separate risk beyond 1c's own deploy. **1e (revised): Low** — the widened logging in §5 is still diagnostic-only console output, no behavior change, easily reverted; the only change from the original revision is *what* gets logged (adding the `[Barge-in]` boolean), not a new code path or a new risk category. Carried forward reasoning from the original revision: nothing gates or gradually rolls out a tool-description edit for 1c specifically — the very next voice call after deploy reads the new text — which is why 1c alone was High; 1d and 1e do not touch that file or any prompt/schema text, so that reasoning does not extend to them.

---

## 7. Next step

Submit this revision to Phase 3 (ChatGPT review) before any logging code is written or any live test is run. Recommend Phase 3 confirm: (a) 1d's live-test procedure (§4) is sufficiently low-risk to run directly on production without its own separate review cycle, (b) the widened 1e logging plan (§5) correctly avoids conflating "STT truncation is the cause of 1e" with "STT truncation is worth testing first" per Phase 1 §2f's own careful wording, and (c) whether the barge-in truncation bug's eventual fix (once the combined trace points to one) should be scoped as its own new Phase 1, given it is foundational and not specific to Track B.
