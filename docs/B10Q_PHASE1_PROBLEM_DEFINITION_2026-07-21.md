# B10q — Phase 1: Problem Definition

**Date:** 2026-07-21 (revised same day — see "Revision note" below)
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.6, Phase 1
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4

No code was written in producing this document.

**Revision note:** the original version of this document investigated only the mobile/Shared-Core path (`naavi-chat` → `manage-rules` → `evaluate-rules`). Phase 1A's mandatory Architecture Scope Rule check (Governance v3.6) surfaced that the Architecture Reference documents "Action Rules — creation (the classifier)" as **Duplicated, two independent implementations** (§2, line 75) — voice has its own separate email-alert creation path that was not investigated in the original pass. It has now been investigated (§3) and found to carry an independent, and more severe, instance of the same defect class. Per Wael's explicit decision (2026-07-21), B10q's scope is expanded to cover both implementations rather than split into two tickets. §1, §3, and §5 below are updated accordingly; §2's evidence and §4's alternatives-considered analysis are unchanged from the original version.

---

## 1. What exactly is broken?

An email-trigger alert (`action_rules.trigger_type = 'email'`) can be created with no sender filter and no subject filter — `trigger_config` containing none of `from_name`, `from_email`, `subject_keyword`. When this happens, the rule doesn't fail to match or ask for clarification: it matches **every** incoming email the user receives, indefinitely (or once, for a `one_shot` rule), firing a full self-alert (all enabled channels) for each one.

This is a validation gap, not a matching-logic bug in isolation — the matching code is doing exactly what it was written to do (treat an absent field as "no constraint on this field"); the gap is that nothing upstream ever requires at least one field to be present before the row is written.

**Confirmed to exist independently on two separate implementations** (mobile/Shared-Core and voice — see §3) **— not one bug with one write path, but the same defect class written twice, independently, with different severity on each.**

**Confirmed design requirements for the fix (agreed in discussion, 2026-07-21, before this document — Wael's explicit decisions):**

1. **Always require a filter.** An email alert must have at least one of: sender name/email, subject keyword. No path — mobile/Shared-Core (`manage-rules`) or voice (`SET_EMAIL_ALERT`) — may write a `trigger_type='email'` row with all three empty.
2. **If the user explicitly insists on "alert me on every email, no filter," Naavi declines — she does not create the rule and does not keep looping.** Exact decline wording: *"I can't set an alert for every email — that's what your email app is already for. Who should it be from, or what should it be about?"* Applies on both surfaces.
3. **Enforce the requirement at the actual write chokepoint on each surface** — `manage-rules` for mobile/Shared-Core, and voice's `SET_EMAIL_ALERT` handler (`naavi-voice-server/src/index.js:4627-4668`) for voice — not only in either surface's conversational classifier, so no caller of either write path can bypass the rule.
4. **Whenever a filter exists, state it explicitly** — in both the creation confirmation and the fire-time notification (whichever channel, SMS or Email) — consistently across every code path that can create or fire this alert on either surface, not just the one path already confirmed to do this correctly (see §3).
5. **One-time cleanup** of any already-live, currently-enabled email rules with all three fields empty — on both the mobile/Shared-Core write path and any rules voice's path may have already created.

## 2. What evidence proves the problem?

**The symptom, directly verified live against production (read-only), 2026-07-21, not merely cited from a prior session's notes:**

`sent_messages` (production, `SUPABASE_URL=hhgyppbxgmjrwdpdubcx`), two rows, same user (`788fe85c-b6be-4506-87e8-a8736ec8e1d1`), same timestamp:
```json
{"id":"75801fd4-...","channel":"voice","body":"Naavi: You received an email from someone.","sent_at":"2026-07-21T11:30:04.873485+00:00"}
{"id":"62e81540-...","channel":"sms","body":"Naavi: You received an email from someone.","sent_at":"2026-07-21T11:30:04.460396+00:00"}
```

The exact `action_rules` row that produced it, found by direct query:
```json
{"id":"0ffa227b-e808-4045-8eb5-56273bf75b3a","trigger_config":{},"enabled":false,"one_shot":true,"created_at":"2026-07-21T11:25:42.121617+00:00","last_fired_at":"2026-07-21T11:30:03.686+00:00"}
```
`trigger_config` is a literal empty object — no `from_name`, `from_email`, or `subject_keyword` at all. It fired once (`last_fired_at` matches the `sent_messages` timestamps to the second) and is now `enabled: false`.

**Correction to the holding list's prior claim, made directly by this query:** `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`'s B10q entry states *"the already-broken rule causing the 'someone' notification is still live in production right now."* A direct query of all currently-enabled `trigger_type='email'` rules in production returned **zero rows** — this specific rule is not still live. It self-disabled because `one_shot: true`. **This does not mean the bug is fixed or the risk is gone** — it means this particular occurrence happened to be a one-shot rule, so it stopped firing after its single match. A **recurring** (`one_shot: false`) unscoped email rule, if created, would not self-disable and would keep firing on every incoming email indefinitely. The holding list entry needs its "still live" claim corrected once this document is reviewed.

## 3. Root cause

**Matching logic — proven by direct code citation, `evaluate-rules/index.ts:299-303`:**
```js
const hasFrom    = !!(fromName || fromEmail);
const hasSubject = !!subjectKeyword;
const fromResult    = hasFrom    ? (nameMatch || emailMatch) : true;
const subjectResult = hasSubject ? subjectMatch              : true;
return fromResult && subjectResult;
```
When `hasFrom` and `hasSubject` are both false, `fromResult` and `subjectResult` both default to `true` — every message matches.

**Validation gap — proven by direct code citation, two sites:**
- `naavi-chat/index.ts:1851`: `if (!params.from && !params.subject_keyword) { return { ..., missingParam: "Who should the email be from, or what keyword should be in the subject?" }; }` — this check exists, but only in this one conversational-classifier path (Layer 2).
- `manage-rules/index.ts`, the `op:'create'` handler (the actual DB write chokepoint, confirmed by direct read of lines 304-321): inserts `trigger_config` verbatim with **no validation of its contents at all** — no equivalent check exists here.

So a request that reaches `manage-rules` by any route other than the one classifier path (Path B/Claude tool-use per `docs/ARCHITECTURE_NAAVI_CHAT_ACTION_SYSTEMS.md`, or any future caller) can write an unscoped rule with nothing to stop it. This is a structurally proven gap, not an inference — confirmed by reading both code sites directly.

**Fire-time notification (the "someone" text) — `evaluate-rules/index.ts:744`:**
```js
const from = tc.from_name || tc.from_email || 'someone';
```
This is a downstream symptom of the same root gap, not a separate bug — it only produces "someone" because a rule with no sender info was allowed to exist and fire in the first place.

**Filter-stating readback — partially proven, partially open.** Confirmed correct in the one classifier path: `naavi-chat/index.ts:1851-1859` builds `"I'll alert you when an email {fromPart} {kwPart} arrives."`, and `evaluate-rules/index.ts:746-748` builds the equivalent fire-time text — both correctly name whichever fields are set. **Not yet checked:** whether this same stated-filter behavior holds for a rule created via any other path (Path B, or a future `manage-rules` caller) — given this is the exact same "one path has it, the chokepoint doesn't" shape as the validation gap itself, it should not be assumed to already be consistent everywhere. This needs direct verification during Phase 2/implementation, not assumed from the one path already read.

**Voice implementation — an independent, more severe instance, confirmed by direct code read during Phase 1A (added to this document 2026-07-21).** Per Architecture Reference §2 (line 75), "Action Rules — creation (the classifier)" is documented as Duplicated, two independent implementations — mobile and voice each decide independently whether/how to create an alert (§2a: "a bug fixed in mobile's alert-creation classifier does not fix voice's alert-creation behavior, and vice versa"). Voice's implementation, `SET_EMAIL_ALERT` (`naavi-voice-server/src/index.js:4627-4668`):

```js
const triggerConfig = {};
if (action.fromName)       triggerConfig.from_name = action.fromName;
if (action.fromEmail)      triggerConfig.from_email = action.fromEmail;
if (action.subjectKeyword) triggerConfig.subject_keyword = action.subjectKeyword;
// ... no check that any field is non-empty before proceeding ...
const res = await fetch(`${SUPABASE_URL}/rest/v1/action_rules`, {
  method: 'POST',
  ...
  body: JSON.stringify({ ..., trigger_config: triggerConfig, one_shot: false, enabled: true }),
});
```

Three confirmed differences from the mobile/Shared-Core instance, each making this the more severe of the two:
1. **No validation anywhere on this path** — same gap as `manage-rules`, confirmed by direct read; there is no equivalent to `naavi-chat/index.ts:1851`'s check on the voice side at all.
2. **Bypasses `manage-rules` entirely** — this is a raw `POST` directly to the `action_rules` REST table, not even routed through an Edge Function's business logic. It is a third write path, not a caller of the two already documented.
3. **Defaults to `one_shot: false` (recurring).** The production instance found in §2 happened to be `one_shot: true` and self-disabled after firing once. Voice's path has no such fallback — an unscoped voice-created email alert would fire on every incoming email indefinitely, not once.

**A nearby guard does not close this gap — checked directly, not assumed.** `naavi-voice-server/src/index.js:3831-3859` ("B4y," 2026-05-24) drops `SET_EMAIL_ALERT` actions when the user's message lacks create-intent phrasing (defends against a different, already-fixed bug — Haiku fabricating an alert from a search-shaped sentence). This regex (`/\b(alert|notify|tell|let|remind|text|email|message|ping)\s+me\b|.../i`) matches "alert me when I get an email" cleanly — the exact unscoped request this document is about — so this guard does not catch it. Confirmed by reading the regex directly against that phrase, not inferred from its stated purpose.

**Label bug, a distinct but related symptom, same code:** line 4646, `const label = action.fromName ? ... : \`Emails with "${action.subjectKeyword}" in subject\`;` — if both `fromName` and `subjectKeyword` are absent, this produces the literal string `Emails with "undefined" in subject`, not "someone" but the same class of leaking-an-internal-placeholder-to-the-user defect. Worth fixing in the same pass since it's the same root cause (unvalidated empty input reaching user-facing text) in the same function.

## 4. What alternatives were considered?

**Alternative — allow "alert me on every email" as an explicit, deliberately-confirmed choice**, rather than always rejecting it. Considered and rejected in discussion, 2026-07-21, for a proven structural reason: `evaluate-rules/index.ts:134`, `for (const triggerRef of triggers) { ... }`, fires **once per matching email individually** (confirmed by reading `findEmailTriggers`, which returns one `trigger_ref` per matching `gmail_message_id`), each firing a full self-alert fan-out (all enabled channels, per `project_naavi_alert_fanout` — SMS + WhatsApp + Email + Push + Voice by default). An unscoped "all emails" rule would therefore produce one-to-one notification volume — every single incoming email producing a separate multi-channel alert — which for any moderately active inbox is not a usable feature, only a worse version of the current bug with the user's explicit consent attached. Rejected in favor of always requiring a filter and declining the all-emails case with a specific, helpful message (§1, item 2).

## 5. Architecture Reference ownership (Phase 1 citation requirement)

Per `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md` §4 (Protected Core table), line 119: **Action Rules** — `naavi-chat/index.ts` (classifier + confirm logic), `manage-rules`, `evaluate-rules`, `report-location-event`, `_shared/task_actions.ts`, `_shared/alert_body.ts`, `hooks/useOrchestrator.ts` (mobile write paths). This bug touches three of those named files directly (`naavi-chat/index.ts`, `manage-rules/index.ts`, `evaluate-rules/index.ts`). Classification: **Protected Core**, per the Reference's own stated reason — "Governs every alert a user creates; a mistake here silently misdirects or drops real messages to real people." **Full Phase 1-8** required, matching the Reference's own table.

**Correction (Phase 1A finding, 2026-07-21):** the original version of this document stated *"no separate voice-server code path for email-trigger creation or firing; `evaluate-rules` and `manage-rules` are Shared Core, used identically by both mobile and voice."* **This was checked and found false.** Per Architecture Reference §2 (line 75), "Action Rules — creation (the classifier)" is explicitly documented as Duplicated — voice has its own independent creation path (`naavi-voice-server/src/index.js`'s `SET_EMAIL_ALERT`, confirmed by direct code read, §3) that was not investigated in the original pass. Firing/execution (`evaluate-rules`) remains genuinely Shared Core and correctly out of scope for this correction — only *creation* is duplicated, per the Reference. Surface is therefore **both** (`backend` for the mobile/Shared-Core write path, `voice` for `naavi-voice-server`), not `backend` alone.

## 6. No Assumptions Rule compliance check

Every claim above is backed by a direct citation: file:line for code, or a live query result for data state. The one place evidence is incomplete is explicitly labeled as such in §3 ("Not yet checked") rather than assumed — the filter-stating readback's consistency across non-classifier paths is not proven either way and must not be treated as already correct going into Phase 2.

## 7. Status and next steps

Phase 1 complete. Per the Phase-Gate Approval Rule, this requires your explicit separate go-ahead before Phase 1A (Architecture Completeness Review) begins.
