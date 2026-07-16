# F19 — 1h: Phase 1, Problem Definition

**SUPERSEDED — kept for the investigation trail, not a live finding.** Further investigation (Railway deploy logs for the actual failing call) traced this to an already-documented, unfixed 2026-04-19 bug (`project_naavi_deepgram_first_word_truncation` memory — Deepgram drops words from the start of an utterance during barge-in), not a new tool-schema defect. The tool-schema gap this document describes below is real but did not cause the observed failure. **Current, correct account is folded into `docs/F19_TRACKB_PHASE1_PROBLEM_DEFINITION_2026-07-15.md` §2f (second revision)** — read that instead of treating this document's conclusion as current. This file is retained only to show the investigation steps that led to the correction.

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No code is written in this document. Discovered live during Track B-1c's Phase 5 verification (`docs/F19_TRACKB_PHASE2_CHANGE_PLAN_2026-07-15.md`'s acceptance criterion 3), not part of Track B's original scope (1c/1d/1e). Continues F19 Phase 1's original lettering (1a-1g) as a new sub-problem, since it shares the same root story (production drift / tool-schema gaps from the location-tool split) but is a distinct defect.

Touches Protected Core (Voice orchestration, Action Rules) on **both** mobile and voice.

---

## 1. What exactly is broken (revised after testing mobile directly)

**Voice:** confirmed broken. A self-override phrasing combined with a location trigger silently drops the override destination — the alert is created as a plain self-alert with no memory that an explicit destination was ever given.

**Mobile: NOT broken for the tested phrasing — correction to this document's own first-draft finding.** A live test against production `naavi-chat` (same phrasing, same method as Track A's earlier verification — sent directly, never confirmed, so nothing was created) shows mobile correctly captures `self_override_email` for a location-triggered self-override. Tracing which of naavi-chat's two action-generation systems (per `docs/ARCHITECTURE_NAAVI_CHAT_ACTION_SYSTEMS.md`) produced this response shows it was **Layer 2** (the deterministic classifier) — not Path B (Claude tool-use, the system whose schema I read earlier and found missing self-override guidance). Layer 2 has its own, separate, already-correct instruction block for exactly this case (`naavi-chat/index.ts:1683`), entirely independent of the `anthropic_tools.ts`/`get-naavi-prompt` gap this document originally described.

**What this means:** the gap this document identified in `anthropic_tools.ts` and `get-naavi-prompt` (the two dedicated location tools never receiving self-override guidance) is real and confirmed by direct code read — but it only manifests when **Path B** handles the message. Voice has no Layer 2 at all, so every voice message goes through the equivalent of Path B — meaning voice is always exposed. Mobile has Layer 2 as a first line, and Layer 2 already handles this phrasing correctly — meaning mobile's actual exposure depends entirely on **how often a location+self-override message falls through Layer 2 to Path B**, which has not yet been determined. This document no longer claims mobile is "identically broken" — that was disproven by direct evidence.

---

## 2. Evidence

**Live reproduction, this session, voice, production:** "Email me at whwh2207@gmail.com when I arrive at Costco" → row `9e93747a-6ff1-4479-bd1c-4727c0258175`, label "Alert when arriving at Costco", `action_config = {"body": "You've arrived at Costco."}` — confirmed via direct SQL query (`action_config::text`) against production. No `self_override_email`, no `to`, no trace of the email address anywhere in the row.

**Root cause, traced through both platforms' tool schemas directly:**

1. **`get-naavi-prompt/index.ts:479`** (mobile's shared prompt, also read by voice as a fallback source) — the F15 Defect A "EXCLUSION, CHECK THIS FIRST" rule instructs: *"...trigger_type='location' if a place is given... use set_action_rule (trigger_type='time'... trigger_type='location'...) with exactly ONE of action_config.self_override_email / ... set to that address."* This tells Claude to call `set_action_rule` for a location-triggered self-override.

2. **But `set_action_rule`'s own tool description** (`supabase/functions/_shared/anthropic_tools.ts:211-212`, and identically in voice's `naavi-voice-server/src/anthropic_tools.js:173`) explicitly says: *"Create a trigger-action automation rule... for NON-LOCATION triggers... For LOCATION alerts... use one of the dedicated location tools instead — set_location_rule_chain... or set_location_rule_address."* **This directly contradicts instruction #1** — Claude is told by one piece of guidance to use `set_action_rule` for a location+self-override case, and by another (the tool `set_action_rule` itself describes its own scope) that location alerts must never use this tool.

3. **Neither dedicated location tool has any self-override guidance of its own**, on either platform. Grepped directly: `self_override` appears in `anthropic_tools.ts`/`anthropic_tools.js` only inside the shared `ACTION_CONFIG` field definitions (where the fields are declared to exist) — never inside `set_location_rule_chain`'s or `set_location_rule_address`'s own `description` strings, on mobile or voice. The field is available to be populated, but nothing tells Claude to populate it for a location trigger.

**Timeline, checked directly via `git log -S`:** the location-tool split (`set_location_rule_chain` first appears in the codebase) predates the F15 self-override exclusion rule by a large margin — the split shipped in "V57.12.0 build 151," well before F15's work (2026-07-09). This means the F15 exclusion rule was written *after* the location-tool split already existed, but was written generically (referencing `set_action_rule` + `trigger_type='location'`) without accounting for the fact that location triggers had already been carved out into their own tools by that point. This is not two features that raced each other — it's F15 that should have referenced the already-existing dedicated tools and didn't.

**Live-tested on mobile, this revision:** sent "Email me at whwh2207@gmail.com when I arrive at Costco" directly to production `naavi-chat` with Wael's `user_id`, `channel:'app'` — same safe method as Track A's earlier verification (never confirmed, nothing created). Response: `{"speech":"Setting up an alert for when you arrive at Costco.","actions":[{"type":"SET_ACTION_RULE","trigger_type":"location","trigger_config":{"place_name":"Costco","direction":"arrive"},"action_type":"email","action_config":{"self_override_email":"whwh2207@gmail.com"},...}]}` — **correctly captured**, no drop. Traced to Layer 2's own dedicated instruction block (`naavi-chat/index.ts:1683`), confirmed present and correct by direct read — includes the exact worked example `"email me at jane@example.com when I arrive at 50 Elm St" → {...self_override_email:"jane@example.com"}`.

---

## 3. Root cause statement (revised)

**Two separate, non-overlapping findings, not one:**

1. **Path B (Claude tool-use) has a real, proven gap** — `get-naavi-prompt/index.ts:479`'s F15 exclusion rule instructs Claude to use `set_action_rule` for location-triggered self-overrides, contradicting `set_action_rule`'s own description ("For LOCATION alerts... use one of the dedicated location tools instead"), and neither dedicated location tool (`set_location_rule_chain`, `set_location_rule_address`) has ever received self-override instructions of its own, on mobile or voice. This is unchanged from the original finding.
2. **Layer 2 (mobile-only, naavi-chat's deterministic classifier) does not have this gap** — it has its own, independent, already-correct instruction block for the identical phrasing shape. New finding, this revision.

**Practical consequence:** voice is unconditionally exposed (no Layer 2 exists there — every voice message is effectively Path B). Mobile's exposure is conditional on whether a given location+self-override message is caught by Layer 2 or falls through to Path B — **not yet determined how often that fallthrough happens** for this phrasing shape. This is the key open question before mobile's real-world severity can be stated.

---

## 4. What alternatives were considered

- **"Maybe this is a Claude/model reasoning failure, not a documented gap."** Ruled out for Path B — the contradiction between `get-naavi-prompt`'s exclusion rule and `set_action_rule`'s own scope description is a genuine authoring inconsistency in the text itself.
- **"Maybe this only affects voice, since voice's schema file is separate from mobile's."** **Partially disproven this revision.** The Path B code gap is identical on both platforms — but mobile has Layer 2 as a first line of defense that voice entirely lacks, and Layer 2 already handles this correctly. Mobile is not "equally broken" — it is conditionally exposed, only when Layer 2 doesn't classify the message.
- **"Maybe today's Track B-1c fix caused this."** Ruled out — 1c's change only added third-party recipient-capture guidance (the `to` field), never touched self-override guidance, and the contradictory `set_action_rule` description already existed before today's change.
- **"Maybe Layer 2 catches every phrasing of this shape, making the Path B gap practically irrelevant on mobile."** **Not tested.** Only one phrasing was tried. Whether variations (different word order, multi-turn context, phrasing Layer 2's classifier doesn't recognize) fall through to Path B on mobile is unproven either way.

---

## 5. Scope boundary

This is a new, third sub-problem alongside Track B's 1c/1d/1e — not a re-opening of either. Does not include a fix design here, per governance. **Revised this session:** this is no longer a single symmetric fix for both platforms. Voice needs the Path B gap closed (unconditionally exposed). Mobile needs either the same Path B gap closed (defense in depth, protecting the fallthrough case) or an explicit decision that Layer 2's coverage is sufficient — that decision requires knowing how reliably Layer 2 catches this phrasing shape, which is not yet established.

---

## 6. Next step

Before Phase 2 can be written with confidence for mobile, the open question in §3 needs more testing: how often does a location+self-override message fall through Layer 2 to Path B on mobile? Voice's fix can be planned now regardless (Path B is voice's only path, no ambiguity). Given this touches the same F15/self-override Protected Core surface Track A already shipped, this likely warrants the same High Risk / Phase 3 review treatment as Track A and Track B-1c.
