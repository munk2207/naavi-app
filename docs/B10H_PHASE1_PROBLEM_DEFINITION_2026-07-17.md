# B10h — Phase 1: Problem Definition

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No code is written in this document. Touches Protected Core (Action Rules, Notification routing, Geofencing).

**Origin:** found live 2026-07-17 while manually testing B10g on staging. A real location alert ("when I arrive at home text bob goodnight") fired and sent Bob a real SMS — but not the message Wael asked for. Reproduced a second time independently (different contact, different address) before writing this document, per Wael's explicit "reproduction and confirm" instruction. **Wael's own assessment: this is more urgent than any other work in progress**, including B10g, which is still mid-Phase-7.

---

## 1. What exactly is broken

A location-triggered alert that tells Naavi to text a third party a specific message — phrased as the bare **"text [name] [message]"**, with no self-reminder and no "saying"/"that" connector — saves with the recipient correctly resolved but the message content **silently dropped**. When the alert fires, the third party receives a generic fallback text ("You've arrived at [place].") instead of what the user actually asked to be sent. Nothing surfaces this to the user at creation time (no confirmation shows the message content) or at fire time (no error, no log visible to the user) — the wrong content is delivered confidently, with no indication anything went wrong.

**Severity: Critical.** This is not a delivery failure (like B10g) — it is confident delivery of the *wrong* content to a real person, under the user's name, with no warning. A real person receives a message that does not match what the sender actually intended to say, and the sender has no way to know unless they separately check with the recipient. This carries the same class of reputational/trust risk `CLAUDE.md`'s outbound-message-verification rules exist to prevent, extended here to a case Naavi generates on the user's behalf rather than one Naavi drafts about the user.

**Architectural principle at stake:** `get-naavi-prompt/index.ts:309` already states the exact failure mode as a warning to Claude — *"If you omit action_config.body, the alert fires silently with no message."* The instruction to avoid this exists. Nothing enforces it.

**Classification: fail-open, not fail-closed (per Phase 1 review feedback — this is the correct framing, not just a parsing bug).** The real defect is not narrowly "a field is missing." The real defect is that **outbound communication proceeded despite missing required semantic data.** Today's behavior: missing body → invent a generic body → send the SMS anyway. That is the system choosing to send *something* rather than nothing when it doesn't have what it needs — the same shape of mistake F5c's original defect made (guess rather than refuse), applied here to message *content* instead of *recipient*. The correct behavior, symmetric with F5c's own fix: missing body → reject → log → notify the user → do not send.

---

## 2. Evidence

### 2.1 — Reproduction 1 (proven, direct DB + live SMS evidence)

Staging, 2026-07-17, real conversation in the Naavi Staging app (not a script): Wael typed *"When i arrive at home text bob goodnight"*. Naavi replied *"Alert set — one time you arrive at Home."* — no confirmation turn, no mention of Bob or the message content in the visible reply.

`action_rules` row `906a974f-51da-48ac-a677-aab12fcefaa1`:
```json
{
  "action_config": {
    "to": "Bob",
    "to_name": "Bob",
    "to_phone": "(343) 333-2567",
    "contact_id": "people/c4635196459157606649"
  }
}
```
No `body` key. No `tasks` key. Nothing carrying "goodnight" anywhere in the row.

Fired (simulated arrival, real Twilio send, `scripts` ad hoc call to `report-location-event` — see §2.3 for why simulation was used instead of driving). `sent_messages` row `a8d03562-704a-45d2-a533-da0fba4fc1c1`:
```json
{
  "channel": "sms", "to_name": "Bob", "to_phone": "(343) 333-2567",
  "body": "You've arrived at Home.",
  "delivery_status": "sent", "provider_sid": "SM7652fbbf32207e48c83cce1968600651",
  "source": "location_alert"
}
```
Real delivery confirmed (Twilio `provider_sid` present). Body is the generic fallback, not "goodnight."

### 2.2 — Reproduction 2, independent (proven, direct DB evidence)

Same session, different contact, different address, deliberately chosen to rule out a one-off fluke tied to "Bob" or "home" specifically. Wael typed *"Text whwh goodnight when I arrive at 854 Bayview Dr"*. This time Naavi **did** show a confirmation turn — *"Found 854 Bayview Dr at 854 Bayview Dr, Woodlawn, ON K0A 3M0, Canada. Say yes to set the alert, cancel to skip, or give me a different area."* — Wael said "Yes" — *"Alert set — one time you arrive at 854 Bayview Dr."* (This confirm turn is address-verification, per `CLAUDE.md`'s "LOCATION TRIGGER — VERIFIED-ADDRESS ONLY" rule, not a recipient/content confirmation — "home" skips it because it's an already-known personal keyword, per `resolve-place`'s design; "854 Bayview Dr" needed verification. Distinct from the content-loss bug, not the cause of it — see §4.)

`action_rules` row `e0f7fced-a100-44f7-8608-c544ec0dfa9c`:
```json
{
  "action_config": {
    "to": "whwh",
    "to_name": "Whwh",
    "to_phone": "(343) 333-2567",
    "contact_id": "people/c190923584366456765"
  }
}
```
Identical failure shape — no `body`, no `tasks`, "goodnight" nowhere in the row. **Confirms this is reproducible, not a one-off** — same phrasing shape, different name, different address, one with address-confirmation shown and one without, same result both times.

### 2.3 — Simulated arrival used instead of driving (methodology note, not a finding)

Per Wael's own instruction earlier this session ("in previous sessions I did not need to drive, you simulate arrival from your end, validate and confirm"), the fire in §2.1 was triggered via a direct call to `report-location-event` with coordinates near the geofence boundary (a dead-center coordinate is rejected by the cold-start-phantom guard, `report-location-event/index.ts:292-317` — required 70%+ of the radius from center on a rule's first-ever event). This tests the same code path a real GPS crossing would trigger; only the GPS detection itself is simulated, not the server-side handling. Wael validated the actual SMS content received.

### 2.4 — The prompt explicitly warns of this exact failure (proven, direct file:line citation)

`supabase/functions/get-naavi-prompt/index.ts:309`:
```
• ALWAYS include action_config.body in every location alert tool call. Use the place name the
  user said. Example: set_location_rule_address(place_name="Costco", action_config={body:"You've
  arrived at Costco."}, …). If you omit action_config.body, the alert fires silently with no message.
```
This is not a missing instruction — it is a correct, explicit instruction that predicts today's exact bug. The generated tool call did not conform to this documented prompt requirement, for the phrasing shape reproduced in §2.1/§2.2. (Phrased this way deliberately — this document records observable behavior, not a claim about Claude's internal reasoning process.)

### 2.5 — The prompt's worked examples never demonstrate the failing phrasing shape (proven, direct read of every relevant example)

`get-naavi-prompt/index.ts:1002-1117` gives ~15 worked examples for location-alert `action_config.body` construction. Every one of them uses either:
- **Reframed narrative body**, e.g. line 1104: `"Tell my wife when I leave the restaurant"` → `body:"He's on his way home."` (third-person, not verbatim).
- **Explicit "saying X" trigger**, e.g. line 1108: `"Alert me when I arrive at Costco saying pick up milk"` → `body:'Pick up milk.'` (the word "saying" signals "everything after this is the literal body").

**No example anywhere shows the bare pattern actually reproduced here** — "text/tell [name] [message]" with the message word landing directly after the name, no "saying," no "that," no self-reminder. That is arguably the single most natural way a real person phrases this (confirmed directly by Wael: *"This simple question is core for Naavi"*), and it is the one shape absent from the prompt's own training examples.

### 2.6 — Every code-level candidate between Claude's response and the DB write is eliminated by direct trace, not inference (proven, full object-flow read)

`hooks/useOrchestrator.ts`'s `SET_ACTION_RULE` handler (lines 3263-3399, read in full during this investigation) starts with `const actionConfig = (action.action_config ?? {})` — since `action.action_config` is a truthy object, `??` returns the **same reference**, not a copy. The handler only ever **adds** fields to it during contact resolution (`to_phone`, `to_name`, `contact_id` at lines 3358-3370); no code path reads, deletes, or overwrites `body`.

For a location alert specifically, that same object is then carried forward by reference into `pendingLocationRef.current = { ..., originalAction: action, ... }` (confirmed at four separate call sites, e.g. line 3884) — still the identical object, not a reconstruction. On confirmation, `commitPending`'s location branch (`useOrchestrator.ts:1444-1467`) reads `pending.originalAction?.action_config` directly and inserts it into `action_rules` via a **direct client-side `supabase.from('action_rules').insert(...)` call** — location alerts do not pass through `manage-rules` or any other server-side rewrite step at all (that path is specific to time-triggered alerts, per `naavi-chat/index.ts`'s Step 1.4 handler, not used here).

**This traces the object end-to-end by reference, with every mutation point directly read, and none of them touch `body`.** That eliminates — by direct code proof, not assumption — the entire "generated correctly, then stripped during a later mutation/serialization/merge step" hypothesis for this specific write path.

**What remains genuinely unproven, precisely stated (per Phase 1 review feedback):** the omission is first *observable* in the persisted `action_rules` row. The elimination above rules out every code-level candidate this investigation could trace between Claude's response and that row. What it does **not** do is directly instrument Claude's raw tool-call output for the reproduced conversation turns — that would require pulling the exact naavi-chat response payload from Supabase's Edge Function logs for that timestamp, which was not available via the tooling on hand during this investigation (the Supabase CLI here has no historical log-query command; the Dashboard's Logs Explorer would have it, but wasn't checked). So: **the evidence strongly indicates the omission occurs at generation time, supported by elimination of every downstream mutation point — not by direct observation of the raw LLM output.** Phase 2 should treat "instrument and directly capture a raw naavi-chat response for this phrasing shape" as a cheap, worthwhile confirming step before or during implementation, not as something already closed.

### 2.7 — `body` is the correct, load-bearing field name (proven, direct file:line citation)

`supabase/functions/_shared/alert_body.ts:121-128` (`buildAlertBody`, shared by both `evaluate-rules` and `report-location-event`, confirmed by its own docstring lines 16-18): `const baseBody = String(actionConfig.body ?? '').trim();` — `body` is exactly the field the fan-out reads for message content. There is no field-name mismatch or alternate key being missed — `body` is correct, and it is simply absent from both reproduced rows.

---

## 3. Root cause statement

| Finding | Root cause | Confidence |
|---|---|---|
| The reproduced rows have no `body` field | The omission is first *observable* in the persisted `action_rules` row. Every code-level candidate between naavi-chat's response and that row has been eliminated by direct object-flow trace (§2.6) — the field is missing by the time Claude's tool call reaches the mobile client, or it was never present in Claude's response to begin with. Not yet directly instrumented at the raw naavi-chat response level (§2.6, closing paragraph). | **Proven that the field is absent from persistence onward; narrowed to generation-time, supported by elimination of every downstream mutation point — not yet confirmed by direct capture of the raw LLM output** |
| Fired alerts send the wrong (generic fallback) content, not a delivery failure | `_shared/alert_body.ts`'s `buildAlertBody` returns an empty string when `body`/`tasks`/`list_name` are all absent; `report-location-event`'s `fireLocationAction` then falls back to `` `You've arrived at ${rule.label}.` `` — confirmed by direct code read and the live `sent_messages` row in §2.1. | **Proven**, file:line |
| The mobile client and every downstream write step (insert, no `manage-rules` mutation for location alerts) do not strip `body` | `useOrchestrator.ts`'s `SET_ACTION_RULE` handler never reads or modifies `action_config.body`; the same object is carried by reference through `pendingLocationRef` into a direct client-side `action_rules` insert, with no server-side rewrite step in between — confirmed by full object-flow trace, §2.6. | **Proven**, file:line — this specific hypothesis (stripped during a later mutation/serialization/merge step) is eliminated, not just unconfirmed |
| The prompt's worked examples never demonstrate the failing phrasing shape, a plausible contributing factor to the generation-time omission | Every location-alert body example (§2.5) uses "saying X" or a reframed narrative — none show the bare "text NAME MESSAGE" pattern reproduced here. Consistent with the evidence, but **the underlying mechanism of why the generated tool call didn't conform to the "ALWAYS include body" instruction is not directly observable** — no captured log shows Claude's intermediate reasoning or the raw pre-mobile response payload, the same evidentiary ceiling F5c's Phase 1 hit for its own "why did 'abc' split into three letters" sub-question. | **Root cause not proven at this layer** — does not block fixing the missing safety net below |
| No code-level backstop exists anywhere in the pipeline | Neither the mobile `SET_ACTION_RULE` handler nor any server-side Edge Function validates that a location alert with a resolved third-party recipient (`to_phone`/`to_email` present) has non-empty content (`body`/`tasks`/`list_name`) before insert or before fire. Confirmed by reading the full mobile handler (§2.6) and `fireLocationAction` (§2.7) — no such check exists in either. This is the system's fail-open default (§1): missing data → invent content → send anyway. | **Proven** — absence confirmed by direct code read, not inferred |

---

## 4. What alternatives were considered

- **"Maybe the mobile client strips `body` during contact resolution."** Ruled out — direct read of the entire `SET_ACTION_RULE` handler (§2.6) shows it only ever adds fields, never touches `body`.
- **"Maybe this only happens when the address-confirmation turn is skipped (e.g., 'home')."** Ruled out — Reproduction 2 (§2.2) went through a full address-confirmation turn ("Say yes to set the alert...") and failed identically. The missing confirmation observed in Reproduction 1 is a real, separate finding (see below), not the cause of the content loss.
- **"Maybe 'goodnight' specifically is being filtered as noise, not a general body-capture failure."** Not fully ruled out — both reproductions used the same word. A third reproduction with a different message word would strengthen this, but wasn't done before writing this document given Wael's stated urgency; flagged as a cheap follow-up check for Phase 2, not a blocker.
- **"Maybe self-directed location alerts have the same gap."** Evidence points the other way — Wael's own recollection of a prior, separately-working example (*"Alert me with James kids names Laila and same when i arrive to his home"* — a self-alert with a note attached) suggests self-alert bodies populate correctly. Not independently re-verified in this session (no reproduction attempted), so stated as a scoping observation from Wael's testimony, not proven fresh evidence — but consistent with the theory that the failure is specific to the third-party "text X message" pattern, since that's structurally different from a self-directed note.
- **"Maybe this is the same underlying defect as B10g."** Ruled out — B10g is about `task_actions` never executing for location alerts at all (a separate array, a separate execution path). This defect is about the **primary** recipient's `body` field being empty at the moment of resolution/save — upstream of and unrelated to B10g's fire-time execution gap. Different bug, same broad family (location alert content integrity), not the same code.

---

## 5. Scope boundary

**In scope (proven, ready for Phase 2 once Wael authorizes starting it):** the missing code-level validation that a location alert with a resolved third-party recipient must have non-empty content before it is saved and before it fires — the actionable, fixable half of this defect.

**Not in scope for this document, tracked separately or requiring further work:**
- The exact mechanism of why Claude's prompt-following fails for this phrasing (§3, not proven) — a prompt-level investigation, not a code-read question, does not block the code-level fix.
- Whether a third message word (not "goodnight") reproduces the same failure — cheap to check, recommended before or during Phase 2, not done here.
- Whether self-directed location alerts have the same gap — not independently verified this session, worth a quick check given Wael's prior-session recollection.
- The missing recipient/content confirmation readback for location alerts (observed in Reproduction 1, absent in the "home" case specifically) — real and related (a stronger readback might have caught this before it saved), but a distinct finding from the content-loss root cause itself; worth its own scoping rather than folding in silently.
- Whether the same "text NAME MESSAGE" phrasing shape produces the same content-loss on **time**-triggered alerts (untested here — this investigation only reproduced the location-trigger case).

---

## 6. Next step

Phase 2 — Change Planning, per governance — **not started, and will not be started without Wael's own separate, explicit go-ahead**, per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3).

**Framing for Phase 2, per review feedback — treat this as a Safety Integrity problem, not a parsing bug.** The defect is not "a field can be missing." The defect is that outbound communication proceeded despite missing required semantic data (§1's fail-open classification). That reframing changes the shape of the fix: a single guard at one layer is a patch; the durable answer is defense-in-depth across every layer content passes through before it reaches a real person:

```
Layer 1 — Prompt produces body
Layer 2 — Client validates before insert
Layer 3 — Server validates before/at write (if a server write path exists for this trigger type)
Layer 4 — Fire-time validates immediately before send
Layer 5 — If content is missing and unrecoverable at any layer: DO NOT SEND
```

**Layer 4, stated as an explicit architectural rule, not just "validates" (per Phase 1 review feedback):** *fire-time must never synthesize user intent. If required semantic content is absent, the action must fail closed rather than substitute fallback content.* This is deliberately stronger than "add a check" — it prohibits the fallback text itself (`` `You've arrived at ${rule.label}.` `` in `report-location-event`/`evaluate-rules` today) as an acceptable substitute for missing third-party message content. Stated explicitly now so Phase 2 can't later drift into "let's just improve the fallback wording" as a resolution — a better-written fallback is still Naavi inventing what the user meant to say, which is the defect, not a mitigation of it.

This matches the regression-and-defense philosophy this project has been converging on across F5c (fail-closed at fire time) and B10g (shared, hardened logic instead of independently-drifting copies) — the same direction, applied here to *content integrity* instead of *recipient resolution*.

Candidate approaches, not yet designed or chosen, for Phase 2 to evaluate within that framing:

1. **Layer 2/3 — a fail-closed content-validation guard** before a location `SET_ACTION_RULE` with a resolved third-party recipient (`to_phone`/`to_email` present) is inserted — if `body`, `tasks`, and `list_name` are all empty, block the save and surface a clarifying question to the user (*"What should I tell [name]?"*) rather than silently saving with no content.
2. **Layer 4 — a fire-time backstop**, symmetric with Layer 2/3, in case content is somehow lost or corrupted between save and fire (defense-in-depth, not redundant — Layer 2/3 catches it at creation, Layer 4 catches anything that slips past creation-time validation for a reason not yet identified).
3. **Layer 1 — strengthen the prompt** with an explicit worked example for the bare "text/tell NAME MESSAGE" phrasing (no "saying") — cheap, but per F5c's own lesson (an explicit prompt rule already existed and was still bypassed), a prompt-only fix must not be treated as sufficient on its own without the code-level layers backing it.
4. **Where Layer 2/3's validation should live** — the mobile client's `SET_ACTION_RULE` handler (client-side, same place contact resolution already happens) versus a server-side check (e.g. inside `manage-rules` for trigger types that use it) — a design decision for Phase 2, noting location alerts specifically bypass `manage-rules` entirely (§2.6), so a location-scoped fix likely lives client-side regardless of what's chosen for other trigger types.
5. **Whether this validation should also cover self-alerts and time-triggered alerts**, or stay scoped to the reproduced case (location + third-party) — Phase 2 should decide based on whether the follow-up checks in §5 (self-alert behavior, time-trigger behavior) confirm a broader or narrower gap.
6. **Instrument and directly capture a raw naavi-chat response** for this exact phrasing shape (via Supabase's Logs Explorer or fresh request-logging) — closes the one evidentiary gap §2.6 leaves open (generation-time omission supported by elimination, not yet by direct observation). Cheap, worth doing before or during implementation, not a blocker to starting.

**Explicit expectation for Phase 2 (per review feedback, not decided here — Phase 1 does not design fixes):** the fix should be stated as a general invariant, not a narrow field check — something in the shape of *"no outbound communication may be generated unless the semantic payload explicitly intended by the user is present and validated."* That is deliberately broader than "`body != null`" — it is meant to hold for `task_actions` bodies, list-connected content, and any future feature that generates an outbound message on the user's behalf, not just this one reproduced case. Posed here as an anchor for Phase 2 to design against, same pattern as B10g's Phase 1 posing an explicit architectural question for its own Phase 3.

Phase 2 must also explicitly answer the Regression Impact questions for Geofencing and SMS/call alerts per governance §Phase 2's checklist, and should include the cheap follow-up reproductions from §5 (different message word, self-alert case, time-trigger case) as part of scoping the fix's actual boundary before committing to an approach.

---

## 7. Phase 1 review record (2026-07-17)

Reviewer feedback received via Wael. Four items, all adopted:

**Round 1:**

1. **The "body never existed" assumption was not fully proven — strengthened, not just caveated.** In response, re-traced the exact object flow from Claude's response through the mobile client to the DB insert (§2.6, expanded). Confirmed by direct code read that `action.action_config` flows by reference (not copy) through every step in the location-alert write path, that no code anywhere in that path touches `body`, and that location alerts bypass `manage-rules` entirely (a direct client-side insert). This eliminates the "stripped during a later mutation/serialization/merge" hypothesis by proof, not assumption — narrowing the unproven gap specifically to "generation-time omission, supported by elimination of every downstream mutation point, not yet by direct capture of the raw LLM output." The exact reviewer-suggested sentence is incorporated into §2.6 and the root-cause table (§3).
2. **Reframed as a Safety Integrity problem, not a parsing bug** (§1, §6) — the defect is that outbound communication proceeded despite missing required semantic data, not narrowly "a field is missing." §6 now presents the 5-layer defense-in-depth model (prompt → client validate → server validate → fire-time validate → do-not-send-if-unrecoverable) as the frame Phase 2 should design within, rather than a single-point guard.
3. **Explicitly classified as fail-open** (§1) — today's behavior (missing content → invent generic content → send anyway) named as fail-open, with the target behavior (reject → log → notify → do not send) stated as its fail-closed counterpart, symmetric with F5c's own fix philosophy.
4. **Softened "Claude did not follow it"** to "the generated tool call did not conform to the documented prompt requirement," both in §1's evidence discussion and the root-cause table — documents observable behavior rather than asserting knowledge of Claude's internal reasoning.

**Round 2 (review of the Round 1 revision):**

1. **Layer 4 given an explicit architectural statement, not just "validates"** (§6) — *"fire-time must never synthesize user intent. If required semantic content is absent, the action must fail closed rather than substitute fallback content."* Deliberately prohibits the fallback text itself as an acceptable mitigation, closing off a future "let's just improve the fallback wording" non-fix before it can be proposed.
2. **Wording tightened once more** — "confirmed by elimination of every downstream candidate" → "supported by elimination of every downstream mutation point" (§2.6, root-cause table, review record) — more precise about what was actually eliminated (mutation points in the traced object's path, not "candidates" in the abstract).
3. **Explicit invariant posed for Phase 2** (§6) — *"no outbound communication may be generated unless the semantic payload explicitly intended by the user is present and validated"* — deliberately broader than `body != null`, framed as a permanent architectural rule Phase 2 should design against, not just a fix for this one reproduced case. Not decided here — Phase 1 poses it as an anchor, Phase 2 designs the actual mechanism.

Reviewer's stated assessment (Round 2): stronger elimination of downstream mutation hypotheses, accurate description of the remaining evidentiary gap, fail-open classification, Safety Integrity framing, defense-in-depth architecture, and precise wording around observable fact versus inferred generation behavior — the document has reached the point where further Phase 1 editing would have diminishing returns; sufficiently rigorous to support Phase 2 design with confidence. **No further Phase 1 changes requested.**

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to begin Phase 2.** Per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3): moving to Phase 2 requires Wael's own separate, explicit go-ahead for this specific transition, regardless of what this review verdict says. That has not yet been given.

---

## 8. Status

**Phase 1 drafted and reviewed across two rounds, 2026-07-17, all revisions adopted — including strengthening (not just caveating) the evidence for where `action_config.body` is lost, an explicit fail-closed statement for Layer 4, and a posed invariant for Phase 2 to design against.** Reviewer: no further Phase 1 changes requested. Phase 2 has NOT started and will not start until Wael gives explicit, separate approval for this specific transition.
