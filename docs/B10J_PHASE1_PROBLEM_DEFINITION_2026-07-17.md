# B10j — Phase 1: Problem Definition

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No code is written in this document. Touches Protected Core (Action Rules, prompt drives Action Rules creation — same governance class as B9a).

**Origin:** found live 2026-07-18 (EST 2026-07-17 evening) while manually retesting B10g on staging, immediately after B10h and B10g's own Phase 7 groundwork. Wael specifically rejected an earlier, artificial test phrasing ("...and separately send Bob a text saying I'm home" — "No one will speak like this") and instead used natural phrasing directly modeled on the prompt's own existing time-trigger worked example. That natural phrasing reproduced a real defect, confirmed live by simulating an actual geofence arrival and inspecting `sent_messages`.

---

## 1. What exactly is broken

A user says a natural, compound location-alert request combining a **self-reminder** with a **third-party notification** — e.g. *"Remind me when I arrive home to lock the door AND send SMS to Bob."* This phrasing is structurally identical to the prompt's own proven time-trigger worked example (`get-naavi-prompt/index.ts:617`, *"Remind me at 09:30 to review the deck AND send SMS reminder to the meeting participants"*) — just with a location trigger instead of a time trigger.

For a **time** trigger, this phrasing correctly produces one alert: a self-reminder body, plus the third party's send routed through `action_config.task_actions[]`. The user gets their own reminder; the third party gets their own message.

For a **location** trigger, the identical phrasing produces something different and wrong: the third party (Bob) becomes the alert's **primary** recipient (`to`/`to_name`/`to_phone`/`contact_id` all set to Bob), and the user's own reminder text ("lock the door") is merged into Bob's message body as a `tasks` checklist line, not delivered to the user at all. `task_actions` is never created. Confirmed live by firing the alert: exactly one SMS was sent, to Bob, reading *"i'm home To do: lock the door."* The user (who asked to be reminded) received nothing on any channel.

**This is not the same defect as B10g.** B10g (closed 2026-07-17, deployed to staging) fixed `task_actions` never being *executed* for location-triggered rows. This defect is upstream of that — for this phrasing shape, `task_actions` is never even *created* in the first place. B10g's fix is real and correct, but this defect means the natural phrasing that should exercise it never reaches that code path at all.

**Severity: assessed as High.** Two independent failures in one request: (1) the user's own reminder silently never reaches them — the primary intent of the "remind me" half of the sentence is dropped entirely, with no error or warning; (2) the user's personal reminder text is redirected into a message sent to a third party instead — a minor but real content-leak (Bob receives a note that was never meant for him). Not classified Critical: no evidence has been found that this defect has caused production user impact; it was discovered during structured live testing, not a support report. The third party's own requested content ("i'm home") is still delivered correctly to the right person — it's the user's own reminder that misfires, not a wrong-recipient misdirection of the third party's message.

---

## 2. Evidence

### 2.1 — Live reproduction (two independent phrasings, same result both times)

**Attempt 1** (Wael, live, staging app): *"When I arrive home remind me to lock the door and send sms to bob saying i'm home."* Naavi replied *"Alert set — one time you arrive at Home. Bob will get 'i'm home'."* — no mention of the "lock the door" reminder in the confirmation speech at all.

**Attempt 2** (Wael, live, staging app, deliberately modeled on the prompt's own time-trigger example): *"Remind me when I arrive home to lock the door AND send SMS to Bob."* Same result.

Direct DB read of the resulting `action_rules` row (both attempts, same shape):
```json
{
  "action_config": {
    "to": "Bob",
    "body": "i'm home",
    "tasks": ["lock the door"],
    "to_name": "Bob",
    "to_phone": "(343) 333-2567",
    "contact_id": "people/c4635196459157606649"
  }
}
```
No `task_actions` field exists. Bob is the sole named recipient (`to`/`to_name`/`to_phone`/`contact_id`).

### 2.2 — Live fire confirms the user receives nothing

Simulated arrival via direct `report-location-event` call (coordinates ~250m from the rule's geofence center, past the cold-start guard). Response: `{"ok":true,"fired":true}`. Immediately after, `sent_messages` showed exactly one new row:
```json
{"channel":"sms","to_name":"Bob","to_phone":"(343) 333-2567","body":"i'm home To do: lock the door.","source":"location_alert","delivery_status":"sent"}
```
One message, to Bob, containing both the third-party content and the user's own reminder merged together. Zero messages to the user on any channel.

### 2.3 — Root cause, part 1: `buildAlertBody` merges `tasks` into whichever single recipient the alert already has

`supabase/functions/_shared/alert_body.ts:128-137` (`buildAlertBody`):
```ts
const baseBody = String(actionConfig.body ?? '').trim();
const tasks = Array.isArray(actionConfig.tasks) ? actionConfig.tasks.filter(Boolean) : [];
...
const parts: string[] = [];
if (baseBody) parts.push(baseBody);
if (tasks.length > 0) {
  parts.push(`To do: ${tasks.join(', ')}.`);
}
...
return parts.join(' ').trim();
```
`tasks` is simply concatenated into the same body string as `body` — it has no concept of "this text belongs to a different recipient than the primary one." This function has no defect of its own; it faithfully builds whatever body is asked of it. The defect is upstream, in what gets written to `action_config` in the first place.

### 2.4 — Root cause, part 2: `report-location-event`'s self/third-party classification has no awareness of a combined request

`supabase/functions/report-location-event/index.ts:718-771` (`fireLocationAction`): `isSelfAlert = Boolean(hasSelfOverride || isSelfByPhone || isSelfByEmail || noRecipient)`. Since `to_phone` is set to Bob's real number (not the user's own, no self-override present, a recipient IS present), `isSelfAlert` evaluates `false` — the alert is classified purely third-party, unconditionally. There is no field on `action_config` that could tell this function "there was ALSO a self-reminder component to this same alert" — because, per §2.1, that component was never captured as a distinct thing; it was collapsed into `tasks` on the third party's own alert.

### 2.5 — Root cause, part 3 (the actual point of divergence): the Layer 2 classifier force-routes ALL location alerts around the code that would have caught this

`supabase/functions/naavi-chat/index.ts:1634` (`classifyIntent`, the Haiku-based deterministic classifier — "Layer 2", distinct from the Claude system prompt used by Path B, per `docs/ARCHITECTURE_NAAVI_CHAT_ACTION_SYSTEMS.md`). Its system prompt states, line 1667:
> "action = creating/updating/deleting data... ONLY when the message contains exactly ONE action. If the message contains 2 or more distinct actions (connected by 'and' or otherwise), classify as chat so Claude can handle all of them together."

Line 1668, immediately after, for **time**-triggered requests specifically:
> "remind me at \[specific time\] to \[task\] and \[send/email/text/call\] \[someone\] — the second verb targets an external recipient with NO separate time anchor → this is 2 actions → classify as CHAT. e.g. 'remind me at 09:30 to review the deck and send email to participants' = chat."

Then, immediately after that, the same line adds an explicit, unconditional override for location phrasing:
> "CRITICAL EXCEPTION: 'alert me at \[place\]' (e.g. 'alert me at Shoppers Drug Mart', 'alert me at Costco', 'alert me at the office') — 'at' followed by a location name is a location alert, NOT a time anchor. **Classify these as action SET_ACTION_RULE regardless of what follows. Never apply the time-anchor rule to location-based messages.**"

This exception was written to solve a real, narrow problem: stop "alert me at Costco" from being misread as a time-anchor phrase (since "at" also appears in time expressions like "at 9 AM"). But its wording — "regardless of what follows... never apply the time-anchor rule to location-based messages" — is unconditional in text. For the reproduced class of compound location requests (self-reminder + separate third-party send, per §2.1's two independent reproductions), it effectively bypasses the normal multi-action routing that correctly diverts the identical two-action shape ("remind me to X and send SMS to Y") to `chat`/Path B for a time trigger. Whether this holds for every possible compound location phrasing (not just the reminder+SMS shape tested) has not been independently verified — the two live reproductions both used this shape. The request is instead forced through the single-action deterministic path — landing in `buildActionConfirm`'s location branch (`naavi-chat/index.ts:1860-1905`, the same code investigated during B10h), which has no logic to detect a self-reminder component and simply forwards whichever name appears as the primary `to`.

### 2.6 — Root cause, part 4: even if this reached Path B, the prompt has no location-specific handling for it either

`get-naavi-prompt/index.ts:625-630` — the "SELF-ALERT PRIMARY RULE" that correctly handles this exact combination — is explicitly scoped to time triggers only: *"When the user says 'alert ME at \[time\]' or 'remind ME at \[time\]' — even if they also say 'and send SMS to Bob' — the PRIMARY action MUST be a self-alert."* No equivalent rule or worked example exists for location triggers anywhere in the prompt (confirmed during B10h's investigation — the ~15 location-alert worked examples are all single-recipient, either self-only or third-party-only; none demonstrate a combined request). This means **even if** §2.5's classifier gap were fixed and this phrasing correctly routed to Path B, there is currently no instruction there to produce the right shape for a location trigger either — this would need its own fix, not a free byproduct of §2.5.

---

## 3. Root cause statement

| Finding | Root cause | Confidence |
|---|---|---|
| Combined self-reminder + third-party location requests never produce `task_actions` | `naavi-chat/index.ts:1668`'s location "CRITICAL EXCEPTION" unconditionally forces ALL location-alert phrasing through the single-action deterministic path, bypassing the same "2+ actions → chat" check that correctly protects the identical time-trigger phrasing. | **Proven**, file:line + 2 independent live reproductions |
| The deterministic path has no self-vs-third-party awareness for a combined request | `buildActionConfirm`'s location branch (`naavi-chat/index.ts:1860-1905`) forwards any named recipient as primary `to`, with no check for an accompanying self-reminder component — confirmed during B10h's investigation of the same code, reconfirmed here. | **Proven**, file:line |
| Even if Path B were reached, it has no location-specific self-alert-primary rule | `get-naavi-prompt/index.ts:625-630`'s SELF-ALERT PRIMARY RULE is explicitly scoped to time triggers; zero location-alert worked examples show a combined self+third-party shape. | **Proven**, file:line (confirmed twice — B10h and this investigation) |
| The user's own reminder content is redirected into the third party's message | `buildAlertBody` (`_shared/alert_body.ts:128-137`) merges `body` + `tasks` into one string for whichever single recipient the alert has — a faithful implementation of what it's asked to do, not itself defective; it has no way to know two different people were meant to receive two different things. | **Proven**, file:line + live fire confirmation |
| Whether this has caused real-world harm already | Not established — found via deliberate live testing this session, not a support report. Recommend checking `action_rules` for `trigger_type='location' AND action_config->'to_phone' IS NOT NULL AND action_config->'tasks' IS NOT NULL` in production as part of Phase 2 scoping. | **Not proven** |

---

## 4. What alternatives were considered

- **"Maybe this is the same gap B10g already covers."** Ruled out — B10g fixed *execution* of `task_actions` that already exist on a row. This defect means `task_actions` is never *created* for this phrasing shape in the first place; B10g's fix has nothing to act on here. Different bug, upstream of B10g's.
- **"Maybe the classifier's location exception is simply wrong and should be removed outright."** Not adopted as a conclusion here — the exception correctly solves a real, separate problem (single-action "alert me at Costco" being misread as a time anchor). Phase 2's job is to narrow it, not remove it — removing it outright risks reintroducing the bug it was written to fix.
- **"Maybe this is a mobile-app (`useOrchestrator.ts`) bug, not a prompt bug."** Ruled out — the DB row's shape (§2.1) is fully explained by what the classifier hands off; `useOrchestrator.ts`'s location handler (investigated in depth during B10h) faithfully resolves whatever `to`/`to_name` it's given and has no independent path that would invent this shape on its own.
- **"Maybe this is intentional — location alerts were only ever meant to support one recipient."** Not fully ruled out as a *product* answer (Phase 2/Wael's call), but ruled out as the *current, communicated* state of the product: the user's own words ("remind me... AND send SMS to Bob") clearly express two distinct intended recipients, and nothing in Naavi's response ("Alert set... Bob will get 'i'm home'.") discloses that the "lock the door" half went anywhere other than where the user expected.

---

## 5. Scope boundary

**In scope (proven, ready for Phase 2 once Wael authorizes starting it):** narrowing `naavi-chat/index.ts:1668`'s location classifier exception so it still correctly force-classifies genuine single-action location phrasing ("alert me at Costco") while allowing genuinely compound self+third-party location requests to reach the same "chat"/Path B route the identical time-trigger phrasing already uses; and adding the missing location-specific self-alert-primary handling (rule + worked example) to `get-naavi-prompt/index.ts`, mirroring the existing time-trigger rule at line 625-630, so Path B produces the correct self-primary + `task_actions` shape once it receives the request.

**Not in scope for this document, tracked separately or requiring a prior decision:**
- Whether the fix should instead teach the *deterministic* path itself to detect this specific compound pattern (self-reminder verb + separate third-party send verb) and produce the correct shape without ever routing through Path B at all — an alternative architecture to consider in Phase 2, not decided here.
- Real-world exposure/severity is not established (§3, last row) — recommend checking production `action_rules` before Phase 2 commits to an implementation approach.
- Whether `buildAlertBody`/`report-location-event`'s self/third-party classification (§2.3, §2.4) should itself be hardened to refuse merging `tasks` into a third-party-only alert body as a defense-in-depth backstop, independent of fixing the classifier — a candidate for Phase 2 to weigh alongside the upstream classifier fix, in the same fail-closed spirit as B10h's Layer 4.
- Whether the same compound-request gap exists for **contact_silence** or **weather**-triggered alerts (untested here — only location and time have been examined).

---

## 6. Recurring pattern note

This is the **second** time this session that a location-alert prompt/classifier gap has been found relative to time-alerts having the equivalent handling already built (the first: B10h's finding that zero location-alert worked examples for `task_actions` exist in the prompt, discovered while investigating why the body-forwarding omission existed). Both instances share a shape: **a piece of self/third-party or content-handling logic was built for time triggers, and never mirrored for location triggers** — distinct from the T1a "duplicated fan-out implementation" pattern (F5c/B10d/B10g), but worth naming as its own recurring gap: location-alert prompt coverage lags time-alert prompt coverage structurally, not just in this one instance. Not scoped as its own audit item here — flagged for Phase 2 to note, and worth keeping in mind if a third instance appears.

---

## 7. Next step

Phase 2 — Change Planning, per governance — **not started, and will not be started without Wael's own separate, explicit go-ahead**, per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3). This document identifies and proves the defect only; it does not select a fix.

---

## 8. Phase 1 review record (2026-07-17)

Reviewer feedback received via Wael. Rated 9.8/10 — "one of the strongest Phase 1 documents produced," citing strong independent-reproduction quality, clean separation of evidence from conclusions, clear architectural layering (Layer 2 classifier / Path B prompt / runtime execution / alert body construction), and proper governance discipline (alternatives documented without prematurely selecting a solution).

Two revisions adopted:
1. **§2.5 wording narrowed** — "skips the entire '2+ distinct actions' check for every location-alert phrasing" replaced with "effectively bypasses the normal multi-action routing" scoped explicitly to "the reproduced class of compound location requests," with an added sentence stating plainly that whether this holds for every possible compound location phrasing (beyond the reminder+SMS shape actually tested) has not been independently verified. Reviewer's point: the original wording claimed more than two reproductions of one phrasing shape can prove.
2. **Severity section tightened** — "no evidence yet that this has caused real-world harm" replaced with "no evidence has been found that this defect has caused production user impact; it was discovered during structured live testing" — more precise and harder to challenge.

Reviewer's stated assessment: the Root Cause table (§3) singled out as the strongest part of the document — each row cleanly separates observed behavior, underlying cause, and confidence level, making it possible to map any Phase 2 fix directly back to a specific proven finding.

**Verdict: Approved.** No further Phase 1 changes requested beyond the two adopted above.

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to begin Phase 2.** Per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3): moving to Phase 2 requires Wael's own separate, explicit go-ahead, regardless of this review verdict. That has not yet been given.

---

## 9. Status

**Phase 1 drafted and reviewed 2026-07-17, revisions above adopted. Phase 2 has NOT started and will not start until Wael gives explicit, separate approval for that specific transition.**
