# F19 Track B — Phase 2: Change Planning

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. Builds on `docs/F19_TRACKB_PHASE1_PROBLEM_DEFINITION_2026-07-15.md` (approved by ChatGPT, 2026-07-15, with the softened 1d framing adopted). Touches Protected Core (Voice orchestration). Per Phase 1's evidence, this is **High Risk** for 1c (Protected Core prompt/schema change affecting every voice call), and requires Phase 3 review before any coding.

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

## 4. Track B-1d — explicit decision point (no file changes)

Per Phase 1's approved, softened conclusion: **no independent implementation is justified now.** No files are proposed for change under 1d in this document. The decision point is scheduled explicitly, not silently dropped:

**Trigger:** after 1c ships and is verified (Phase 5/6 for 1c complete).
**Reassessment question:** does any row reach fire time with a named-but-unresolved third-party recipient, on the current (post-1c) codebase? Concretely: attempt a live reproduction of the original 1d symptom (a location alert naming a real contact) on production voice, post-1c-fix, and check whether it now resolves correctly or still fails.
**If it still fails post-1c:** 1d becomes its own Phase 1 (a genuine independent defect would have been found, not assumed).
**If it resolves correctly:** the residual gap — `report-location-event` has no fire-time re-resolution safety net for a destination that resolved successfully at creation but goes stale before firing — remains as a separately-tracked, lower-severity open item (not closed, not urgent, explicitly not conflated with 1d's original "silently misfires to self" framing).

---

## 5. Track B-1e — investigation plan (not an implementation plan)

Per Phase 1: root cause not proven, no code-level bug found in the confirmation path (there is no JS state machine there to have a bug in). A live-traced reproduction with logging is the only way forward — this is itself Phase 1-grade investigation work, scoped here as a plan, not executed.

**Proposed investigation (files that would change — temporary, diagnostic only):**

| File | Classification | Change | Risk |
|---|---|---|---|
| `naavi-voice-server/src/index.js` | Backend (Protected Core) | Add temporary console logging around the Claude tool-use turn loop specifically when the prior assistant turn contained a confirmation question and the action under discussion carries a `self_override_*` field — log the raw STT transcript text Twilio/Deepgram produced for that turn, and Claude's exact response (speech + whether it called the tool). Railway captures console output already (per CLAUDE.md's "check Deploy Logs" pattern) — no new logging infrastructure needed. | **Low** — logging only, no behavior change, easily reverted |

**Reproduction method:** re-run Phase 1's exact original phrasing ("Text me at [phone] in 3 minutes") on production voice with logging active, capture the full per-turn transcript-vs-response trace, and inspect for: (a) whether the phone number STT produces is actually consistent turn-to-turn (tests the digit-transposition hypothesis), and (b) what Claude's exact speech/reasoning was on each repeated confirmation ask (tests the prompt-ambiguity hypothesis). This determines which of Phase 1 §2e's two candidate mechanisms (or a third, not yet considered) is real — **not designed as a fix here**, since Phase 1 explicitly found no bug to fix yet, only a symptom without a located cause.

**Not part of this Phase 2:** removing the temporary logging, or any code change to the confirmation flow itself — those depend entirely on what the trace shows and would need their own Phase 1 (this investigation's findings) before a fix could be planned.

---

## 6. Risk classification — overall

**High** — because prompt behavior changes globally across every voice interaction the instant this deploys, even though only descriptive text is modified, not schema or logic. That is precisely why a text-only change to this file is still Protected Core: nothing gates or gradually rolls out a tool-description edit — the very next voice call after deploy reads the new text. Carried forward from Track A's own classification for the same reason (Protected Core, `AI_DEVELOPMENT_GOVERNANCE.md` §4). 1d proposes no change (no risk to classify). 1e's logging addition is Low risk in isolation but is being planned alongside a High-Risk change (1c) in the same document — Phase 3 should evaluate whether these should deploy together or separately.

---

## 7. Next step

Submit this document to Phase 3 (ChatGPT review) before any commit or deploy. Recommend Phase 3 confirm: (a) the proposed 1c wording doesn't risk the self-override regression flagged in §3, (b) whether 1c and 1e's logging should ship as one deploy or two, and (c) 1d's decision-point framing is acceptable as "no code now" rather than a fix.
