# F17 — Phase 1: Problem Definition

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No code is written in this document. Touches Protected Core (voice orchestration, Action Rules — `AI_DEVELOPMENT_GOVERNANCE.md` §4), and voice has no staging/production split (single shared Twilio account + single Railway deployment) — any eventual fix ships straight to the only voice environment that exists. Full-governance treatment, no shortcuts, per Wael's explicit instruction (`docs/SESSION_HANDOFF_2026-07-14_B9T_B9U_B9V_CLOSED_APK307.md`).

Builds on `docs/F15_PHASE1_PROBLEM_DEFINITION_2026-07-09.md` / `docs/F15_PHASE2_CHANGE_PLAN_2026-07-09.md` (Defect A — mobile's self-override fix, shipped and live-validated on staging) and the holding-list F17 entry (`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, line 54), which first identified the gap by code inspection. This document re-verifies that entry against the current codebase (not from memory — CLAUDE.md "CHECK CODE, NOT MEMORY") and extends it with write-time evidence the holding-list entry did not yet have.

---

## 1. What exactly is broken

Voice has no equivalent of F15 Defect A's fix. On mobile, a self-alert with an explicit per-channel destination override ("email me at jane@x.com when I arrive at Costco") is captured via four dedicated `action_config` fields (`self_override_email`/`self_override_sms`/`self_override_whatsapp`/`self_override_voice`) that keep the alert classified as **self** (full fan-out preserved on every channel except the overridden one) rather than **third-party** (single channel, no fan-out, no per-user channel preferences). Voice's tool schema has no such fields and its write-time code has no such concept — any literal destination Claude captures on a phone call is treated as a third-party recipient, unconditionally, regardless of whether the user meant themselves.

## 2. What evidence proves the problem

**Evidence 1 — the shared prompt instructs Claude (on every surface, including voice) to emit `self_override_*` fields for this exact phrasing.** `supabase/functions/get-naavi-prompt/index.ts:479` (RULE 1 EXCLUSION, added for F15 Defect A):
```
"email/text/WhatsApp/call ME at [address]" ... is a self-alert with an explicit
per-channel destination override: use set_action_rule ... with exactly ONE of
action_config.self_override_email / self_override_sms / self_override_whatsapp /
self_override_voice set to that address ... NEVER 'to', NEVER draft_message.
```
And `index.ts:1038`:
```
For self-alerts where ${userName} gives an EXPLICIT LITERAL destination to
override ONE channel of their own notification ... set exactly the ONE matching
field to that literal address ... Do NOT use 'to' or to_email/to_phone for this
— those mean a third party.
```
Voice fetches this exact function at runtime (`naavi-voice-server/src/index.js:1882`, `${SUPABASE_URL}/functions/v1/get-naavi-prompt`, explicitly commented "shared with mobile" at line 3169) and uses it as the primary system prompt (`buildVoiceSystemPrompt` at line 1899 is the fallback only, used solely if the fetch fails). So on the normal, working path, Claude on a phone call receives the identical instruction to use `self_override_*` fields that Claude on mobile receives.

**Evidence 2 — voice's own tool schema forbids the exact fields the shared prompt just instructed Claude to use.** `naavi-voice-server/src/anthropic_tools.js:88-105`:
```js
const ACTION_CONFIG = {
  type: 'object',
  properties: {
    to: { type: 'string', description: 'Contact NAME only (e.g. "wife"). Orchestrator resolves phone/email.' },
    body: { type: 'string', description: 'Message body.' },
    tasks: { type: 'array', items: { type: 'string' }, ... },
    list_name: { type: 'string', ... },
  },
  required: ['body'],
  additionalProperties: false,
};
```
No `self_override_email`/`self_override_sms`/`self_override_whatsapp`/`self_override_voice` property exists anywhere in this schema (confirmed by direct read of the full 88-105 block, not a grep snippet), and `additionalProperties: false` blocks anything not declared. Grepped the entire file for `self_override`: zero matches. This is the identical shape of defect F15 Phase 1 Evidence A2 proved for mobile before F15's fix — a schema with no slot for the value the prompt asks Claude to emit — except here the mobile fix (F15) was never mirrored to this file.

**Evidence 3 — grepped the entire `naavi-voice-server/src` directory for `self_override`: zero matches anywhere in the codebase, not just the schema file.** Confirms the gap is total, not partial — no fragment of F15 Defect A's design exists on voice's side in any file.

**Evidence 4 — write-time code, both call sites, treat any non-empty `to` as a third-party resolution target unconditionally; there is no self/third-party branch at all.**

Call site 1 — the general (non-location) `SET_ACTION_RULE` handler, `naavi-voice-server/src/index.js:4731-4764`:
```js
const toNameVoice = String(actionConfigNorm.to ?? '');
if (toNameVoice && !actionConfigNorm.to_phone && !actionConfigNorm.to_email) {
  const resolveRes = await fetch(`${SUPABASE_URL}/functions/v1/resolve-recipient`, {
    method: 'POST', ...
    body: JSON.stringify({ mode: 'create', to: toNameVoice, user_id: uid }),
  });
  const resolved = await resolveRes.json();
  switch (resolved?.kind) {
    case 'literal_email': actionConfigNorm.to_email = resolved.value; break;
    case 'literal_phone': actionConfigNorm.to_phone = resolved.value; break;
    case 'resolved_contact': /* sets to_phone/to_email/to_name/contact_id */ break;
    default: return { success: false, error: resolved?.kind || 'resolve_failed' };
  }
}
```
Call site 2 — the location-specific `SET_ACTION_RULE` handler, `index.js:11248-11305` (comment at 11254-11261 explicitly documents this was F12's fix for a *different*, already-closed bug — third-party recipients not resolving at all on location alerts):
```js
const toNameLoc = String(locActionConfig.to ?? '').trim();
if (toNameLoc && !locActionConfig.to_phone && !locActionConfig.to_email) {
  // identical resolve-recipient call, same four-way switch on resolved.kind
}
```
Neither call site checks for a `self_override_*` field (none exist, per Evidence 2/3) nor for any other signal that the destination is meant to stay self-classified. Any literal address or name present in `to` is unconditionally handed to `resolve-recipient` in `mode: 'create'`, which returns a `literal_email`/`literal_phone`/`resolved_contact` result and writes it to `to_email`/`to_phone`/`contact_id` — the exact shape a genuine third-party alert has.

**Evidence 5 — confirmed no special-case exists for "me"/"myself" as a `to` value anywhere in `index.js`.** Grepped for `to === 'me'`, `toLowerCase() === 'myself'`, and similar patterns: zero matches. Nothing downstream of the tool call would catch and correct a misrouted self-reference even if one were somehow present.

**Evidence 6 — the fire-time dispatchers (`evaluate-rules`, `report-location-event`) already support `self_override_*` fields and require no further change; the gap is fully isolated to voice's write path.** Both functions read `config.self_override_email`/`self_override_sms`/`self_override_whatsapp`/`self_override_voice` (`supabase/functions/evaluate-rules/index.ts:665-668`, `supabase/functions/report-location-event/index.ts:731-734`) as part of F15's already-shipped, already-live-validated mobile fix. These are shared Edge Functions — they fire alerts for both mobile- and voice-created rows identically, with no knowledge of which surface wrote the row. **This means: if a voice-created row ever had `self_override_*` fields populated correctly, it would fire correctly today, with zero changes to either dispatcher.** The entire defect is confined to voice's write path (schema + write-time handling) — not fire-time delivery. This narrows F17's scope relative to F15's, which needed both extraction-layer and dispatch-layer changes; F17 needs only the write-path equivalent (the F15 "Claude+tools" extraction surface — `anthropic_tools.ts`/`useOrchestrator.ts` on mobile), because voice has no Layer-2-style deterministic classifier — every voice request goes through Claude tool-use.

**Evidence 7 — the local fallback prompt (`buildVoiceSystemPrompt`, used only if the `get-naavi-prompt` fetch fails) has no self-alert or self-override guidance at all.** Grepped `index.js` for `self_override|self-alert`: the only hit anywhere in the file is an unrelated comment at line 8002 ("location-arrival self-alerts need a 5th delivery channel", about the existing voice-call alert channel, not this defect). The fallback path is a secondary, error-only concern (CLAUDE.md already documents fallback/shared-prompt drift as a known standing risk, independent of F17) — noted here for completeness, not treated as part of F17's primary root cause, since the primary path (successful prompt fetch, the overwhelming majority of calls) is fully covered by Evidence 1-6.

## 3. Root cause statement

**PROVEN, by direct code citation — not inferred.** Two independent, compounding causes, both required to be fixed together:

1. Voice's tool schema (`naavi-voice-server/src/anthropic_tools.js:88-105`, `ACTION_CONFIG`) has no `self_override_*` properties and sets `additionalProperties: false`, structurally preventing Claude from emitting the fields the shared prompt instructs it to use (Evidence 1 vs. 2/3).
2. Voice's write-time code (`index.js:4731-4764` and `11248-11305`) has no concept of a self-override at all — it unconditionally routes any literal `to` value through `resolve-recipient` as a third-party destination (Evidence 4/5), with no branch that could apply a self-override even if the schema allowed the field.

The available evidence indicates both causes must be addressed to restore parity with the mobile implementation: fixing only the schema (cause 1) would let Claude emit `self_override_sms`, but the write-time code would still not read it into anything meaningful for `evaluate-rules`/`report-location-event` to act on (cause 2 must also read the field, mirroring the mobile pattern already proven working, and pass it through to the DB row untouched — no `resolve-recipient` call needed for self-override fields, exactly as mobile's `useOrchestrator.ts` already does). This is the strongest claim the current evidence supports — it stops short of asserting a specific implementation, which is Phase 2's job.

**What is not yet proven (flagged explicitly per governance's No Assumptions Rule):** the exact behavior Claude produces today when asked "text me at [number] when I arrive at X" on a live call — whether it (a) omits the destination entirely, defaulting to a plain self-alert with no override (silently dropping user intent), or (b) puts the literal number into `to`, becoming a genuine third-party row per Evidence 4. Both are plausible given the evidence and neither has been live-tested yet on voice. This document does not claim which occurs — only that neither can currently produce correct self-override behavior, which is proven by the schema/write-path evidence above regardless of which failure mode actually fires. A live test to distinguish (a) from (b) is recommended before Phase 2 finalizes the fix design (it may affect whether prompt wording also needs adjustment, beyond the schema/write-path fix), but is not required to establish that a fix is needed.

## 4. Expected behavior — semantic reference table (added per review, 2026-07-14)

Not a design proposal — this documents the intended semantics, already established and live-validated on mobile by F15, that any voice fix must preserve. It gives Phase 2 a concrete target and gives reviewers a way to check the eventual fix against the problem statement independently of implementation detail.

| User says (voice) | Expected classification | Expected stored fields |
|---|---|---|
| "Email me at jane@x.com when I arrive at Costco" | Self | `self_override_email: "jane@x.com"`; every other enabled channel still reaches the user's own registered phone/email, unchanged |
| "Text me at +16135551234 in 3 minutes" | Self | `self_override_sms: "+16135551234"`; WhatsApp/voice/email/push unchanged |
| "WhatsApp me at +16135551234 when I arrive at X" | Self | `self_override_whatsapp: "+16135551234"`; SMS/voice/email/push unchanged |
| "Call me at +16135551234 when I arrive at X" | Self | `self_override_voice: "+16135551234"`; SMS/WhatsApp/email/push unchanged |
| "Alert me when I arrive at Costco" (no destination given) | Self | No `to`/`self_override_*` fields — existing pre-F15/F17 behavior, full fan-out to all enabled channels |
| "Email John when I arrive at Costco" | Third-party | `to: "John"` → resolved via `resolve-recipient` to `to_email`/`contact_id`; single channel, no fan-out (existing F12 behavior) |
| "Text my wife when I arrive at X" | Third-party | `to: "wife"` → resolved contact → `to_phone`/`contact_id`; single channel, no fan-out |

This table mirrors F15 Phase 2's own canonical behavioral contract (`docs/F15_PHASE2_CHANGE_PLAN_2026-07-09.md` §1.7), restated here for voice so Phase 2 is checked against the same semantics mobile already ships, not a fresh interpretation.

## 5. Ruled out / considered

- **"Maybe voice doesn't fetch the shared prompt and has its own, older self-alert rule that already handles this correctly."** Ruled out by Evidence 1 (voice fetches `get-naavi-prompt` as its primary prompt source, confirmed by direct code citation) and Evidence 7 (the only local fallback has zero self-alert guidance, so it would be *worse*, not equivalent, if ever used).
- **"Maybe the write-time code already special-cases a self-reference before reaching `resolve-recipient`."** Ruled out by Evidence 5 (no `to === 'me'` or equivalent pattern found anywhere in `index.js`).
- **"Maybe the fire-time dispatchers need changing too, mirroring F15's full four-file scope."** Ruled out by Evidence 6 — both dispatchers already read `self_override_*` unconditionally as part of already-shipped, already-validated F15 work, with no awareness of or dependency on which surface wrote the row. Confirmed by direct line citation in both files.

## 6. Why this is a full-governance item, not a quick mirror-and-ship

`action_rules` is explicitly Protected Core (`AI_DEVELOPMENT_GOVERNANCE.md` §4: "Action Rules"), and so is "Voice orchestration" separately. Per §4, any modification here requires technical review before coding (Phase 3) and after (Phase 6), regardless of risk tier. Additionally — and unlike every mobile fix this project has shipped to date — voice has no staging/production split (confirmed same finding as the original holding-list entry: single shared Twilio number, single Railway deployment). A fix here cannot be soft-launched to a staging surface and validated before real calls hit it; it ships directly to the only voice environment Wael and any other caller uses. This combination (Protected Core + no staging buffer) is exactly the case CLAUDE.md's staging-first rule and the governance doc's Protected Core rule both exist for.

## 7. Scope boundary

This document only investigates **voice** (`naavi-voice-server`). It does not re-open or re-verify F15's mobile fix (already shipped, already live-validated — `docs/F15_PHASE5_EVIDENCE_DEFECT_A_2026-07-09.md`). No conclusion is drawn here about mobile's current correctness.

This document also does not investigate F9a (Google App Actions) or any other holding-list item — those are separately flagged, separately scoped, not started.

## 8. What alternatives exist (Phase 2 work — not evaluated yet)

Not designed here; flagged only as the shape Phase 2 will need to evaluate, based on Evidence 6's finding that only the write path needs changing:

1. **Mirror mobile's Claude+tools extraction surface exactly** (the pattern already proven correct and shipped for mobile's own Claude+tools path, `supabase/functions/_shared/anthropic_tools.ts:129-141` + `get-naavi-prompt/index.ts:1038`, which voice already shares): add the four `self_override_*` properties to `naavi-voice-server/src/anthropic_tools.js`'s `ACTION_CONFIG`, then add matching read-and-forward logic to both write-time call sites (`index.js:4731-4764` and `11248-11305`) that passes `self_override_*` straight into `action_config` untouched — no `resolve-recipient` call for those fields, exactly mirroring how `hooks/useOrchestrator.ts` already handles this on mobile (confirmed present in F15's shipped code, `useOrchestrator.ts:3281-3327`).
2. Whether the `to`-vs-`self_override_*` mutual-exclusivity guard mobile has (`useOrchestrator.ts:3281-3327`, preventing a row from carrying both a third-party `to` and a `self_override_*` field simultaneously) needs an equivalent on voice's write path — not yet evaluated.
3. Whether a live test is needed first (per §3's flagged open question) to confirm which failure mode currently occurs, before finalizing whether prompt wording also needs a voice-specific adjustment.

Risk classification, exact file list, regression impact table, and parity validation strategy (mirroring F15 Phase 2 §1.4-§1.6) are Phase 2 work, not done here. **Per review (2026-07-14), Phase 2 should include an explicit Parity Checklist** — prompt parity, tool schema parity, write-path parity, database parity, fire-time parity (already confirmed by Evidence 6, §2), and regression tests for both voice and mobile — so each layer can be verified independently by external review rather than as one bundled claim.

## 9. Next step

Phase 2 — Change Planning, per governance. Given Protected Core + no-staging-split (§6), Phase 2's plan will require Phase 3 external technical review before any code is written, same as F15 Defect A required for mobile. Phase 2 should be checked against §4's expected-behavior table and should include the Parity Checklist noted in §8.

## 10. Revision history

- **2026-07-14, original version:** established the schema/write-path root cause via direct code citation (Evidence 1-7), narrowed scope relative to the holding-list entry by proving fire-time dispatchers need no change (Evidence 6), and flagged the exact runtime failure mode as unproven.
- **2026-07-14, first revision (this revision), after review:** softened §3's "both are required" to "the available evidence indicates both causes must be addressed," stopping short of asserting a specific implementation before Phase 2; added §4, a semantic reference table documenting expected self-vs-third-party classification and stored fields, mirroring F15 Phase 2 §1.7's canonical contract; added a Parity Checklist recommendation to §8/§9 for Phase 2 to adopt. Renumbered §4-8 to §5-9 to accommodate the new §4.
