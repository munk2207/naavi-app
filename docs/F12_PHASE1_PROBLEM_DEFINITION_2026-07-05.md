# F12 — Phase 1: Problem Definition (REVISED)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No code fix for the core F12 destination bug is proposed here — Wael's 2026-07-05 direction that this "requires a full design governance process" still stands. This revision was explicitly ordered by Wael the same day: *"Ignore Phase 1 for F12 created by the previous session. Assess the problem scope and return with your own analysis and finding."* It supersedes the original version of this file. What changed and why is in §7.

Phase 2 (Change Planning) has not started for the core destination bug.

---

## 1. What exactly is broken

Not one bug — **two independent, compounding defects**, both confirmed live on production during this session, plus one separate defect that was found, fixed, and shipped to staging in the same session (§6).

**Defect A — literal/third-party destinations never resolve to `to_email`/`to_phone`.** When a user gives Naavi a literal email address or an unresolved destination for an alert, the value lands in `action_config.to` (or nowhere) but never in `to_email`/`to_phone`, which is what the fire-time dispatcher actually reads.

**Defect B — the "you already have one" memory-hit path silently drops any destination change.** Once a location alert exists at a given coordinate, any later attempt to attach or change a destination at that same place is swallowed — the merge-worthiness check only looks at `tasks`/`list_name`/`body` (mobile) or `body` (voice), never at recipient fields.

Both defects can fire independently or in combination, and neither requires the other to reproduce the user-visible symptom: *"I told Naavi to alert a specific email/phone when I arrive somewhere, and it doesn't go there."*

## 2. What evidence proves the problem

### Defect A — destination never resolves

**Evidence A1 — direct DB read, PRODUCTION, live account, this session.** Placing a real call to the production Naavi number (+1 249 523 5394) as a registered user and saying *"email me at aggan2207@gmail.com when I arrive at Bob's home"* produced this row in `action_rules` (`hhgyppbxgmjrwdpdubcx`, queried directly via service-role key):
```
id: 3f67e7dd-2e6b-4164-88fd-b43065cf19e9
created_at: 2026-07-05 05:54:13 EST
label: Email when arriving at Bob's home
action_type: email
action_config: {"to":"agjan2207@gmail.com","body":"You've arrived at Bob's home."}
one_shot: true | enabled: true
```
`action_config` has `to`, not `to_email`. This rule is live and armed on Wael's real account as of this writing.

**Evidence A2 — the fire-time dispatcher, read directly.** `supabase/functions/evaluate-rules/index.ts:656-657`:
```js
const toPhone = String(config.to_phone ?? '');
const toEmail = String(config.to_email ?? '');
```
and `:745-746`:
```js
const noRecipient = !toPhone && !toEmail;
const isSelfAlert = Boolean(isSelfByPhone || isSelfByEmail || noRecipient);
```
For the row in A1, `to_email` is undefined → `toEmail = ''` → `noRecipient = true` → `isSelfAlert = true`. Per the self-alert branch (`:868-888`), this rule — if it fires — will email/text/push-notify **Wael himself**, not agjan2207@gmail.com. This is not "the alert silently does nothing"; it is "the alert fires to the wrong person." Confirmed by direct code read against the exact row in A1, not a general claim about the code.

**Evidence A3 — no resolution step exists that would prevent A1/A2.** Three separate `SET_ACTION_RULE`-related code paths in `naavi-voice-server/src/index.js` were checked for anywhere a contact name or literal address gets converted to `to_email`/`to_phone`:
- Main handler, `:4694-4714` — only defaults `to_phone` from the *user's own* `user_settings` for `sms`/`whatsapp`; no `lookupContact` call at all.
- Location branch, `:11183-11360` — possessive resolution ("Bob's home") only resolves the *place*, never the destination.
- Pending-contact-clarification, `:10000-10036` — only accepts a phone number if the user speaks the digits themselves; no lookup even here.
Three-for-three, no destination-resolution path exists on voice. (This is inspection of three specific, most-likely code paths, not an exhaustive line-by-line audit of the full ~12,000-line file — flagged as the honest limit of this evidence.)

**Evidence A4 — the schema-lock theory from the prior Phase 1 doc is reconfirmed but its "hard wall" framing is weaker than stated.** `supabase/functions/_shared/anthropic_tools.ts:110-128` (`ACTION_CONFIG`) still has `additionalProperties: false` and only `{to, body, tasks, list_name}` — no `to_email`/`to_phone`. However, `evaluate-rules/index.ts:926-932` shows the backend already accepts a `task_actions` field on `action_config` that is **not** declared anywhere in `anthropic_tools.ts`'s schema, and the comment there ("Claude sometimes uses this key") confirms Claude does emit fields beyond the declared schema in practice. This means the schema is not a hard, server-enforced wall the way OpenAI-style strict structured outputs would be — Claude is *not* schema-locked in practice, just under-prompted for this specific field. **Root cause for "why doesn't Claude emit `to_email`" is therefore: insufficient/no worked examples for this exact pattern in the prompt, not an unconditional technical block.** The originally-reverted prompt-only fix attempt (previous session, one line, no repeated examples) is weak evidence against this being fixable by prompting — it wasn't a rigorous test of the "more examples" hypothesis.

### Defect B — memory-hit dedup drops destination changes

**Evidence B1 — mobile.** `hooks/useOrchestrator.ts:3403-3435`:
```js
const newTasks    = Array.isArray(action.action_config?.tasks) ? action.action_config.tasks : [];
const newListName = String(action.action_config?.list_name ?? '').trim();
const newBody     = String(action.action_config?.body ?? '').trim();
const hasNewContent = newTasks.length > 0 || newListName || newBody;
```
`to`/`to_email`/`to_phone` are never inspected. If `hasNewContent` is false, the code replies *"You already have a [mode] alert for [place]... Tap Alerts to change or remove it"* and writes nothing. The disabled-rule branch is worse — `:3442`, `reArmLocationRule(supabase!, match)` is called with **no third argument**, so `action_config` cannot be touched even if the caller wanted to.

**Evidence B2 — voice, same shape of defect.** `naavi-voice-server/src/index.js:11321-11343` — only `body` is diffed (`newBody !== existingBody`); a changed recipient with the same/absent body falls to *"Say 'create a new one' to add another, or 'delete it' to remove the existing one."*

**Evidence B3 — live reproduction, PRODUCTION, this session's call transcript.** After the base "Bob's home" alert was created (00:55 mark), Wael tried twice to attach the email destination (01:02–01:09, then again 01:43). At 01:23 Naavi said: *"I already have an alert set up to email you when you arrive at Bob's home... Would you like me to update the email address to aggan2207@gmail.com, or create separate?"* Naavi then asked to confirm, and the final DB row (A1) shows the update *did* eventually take (`to` was set), which is evidence that voice does have some update path for this scenario — but it produced `to`, not `to_email`, so Defect A still applies to the end result. This partially conflicts with the pure code-diff reading in B2 (which finds only a `body`-diff, no destination-diff, in the code paths located) — meaning either a different code path was actually exercised here than the one inspected, or the update happened through a still-unlocated mechanism. **This specific inconsistency is not fully traced and is flagged as an open item for Phase 2, not resolved here.**

### Ruled out during this investigation (documented so it is not re-raised)

**Not a bug: "wrong location" for the Bob's-home alert.** The resolved coordinates for "Parliament Street" (44.018, -77.870) are ~232 km from Ottawa, which was initially flagged as a geocoding error. This was wrong and retracted in-session: Bob's actual Google Contacts card (screenshot provided by Wael) lists his home address as "Parliament St, Cramahe, ON K0K 1S0, CA" — a real address in that area. The resolution was correct. The claim "Bob's contact card apparently only has 'Parliament Street', no city" was also wrong and retracted — the full address with city/province/postal code was present on the card the whole time; the claim was an unverified inference, not a checked fact.

## 3. Architectural precedent (added after external technical review, 2026-07-05)

This Phase 1 document was reviewed by an external technical reviewer (ChatGPT, per `AI_DEVELOPMENT_GOVERNANCE.md`'s reviewer role) before Phase 2 began. The reviewer's central point, after two rounds of exchange: Defect A is not just "which of three point-fixes to pick" — it's a missing architectural boundary between *intent* (what the LLM extracts), *resolution* (turning that into a canonical, normalized value), and *persistence* (what the dispatcher consumes). The reviewer recommended an explicit investigation into the canonical recipient model before Phase 2.

That investigation turned up existing precedent in this codebase for the *identical* architectural problem, applied to a different entity:

**Precedent 1 — `resolve-place`, a working `LLM → Resolver → Persisted Snapshot → Dispatcher` architecture.** `supabase/functions/resolve-place/index.ts:1-16`:
```
No DB writes. Orchestrator inserts the chosen result into action_rules
with full coords + place_name + address.
```
The LLM only ever identifies a spoken place ("Bob's home," "the airport"). A stateless resolver (`resolve-place`) converts that into a canonical result — fresh, every time, no cache (per `project_naavi_deterministic_design` / the V57.13.3 place-cache removal, a deliberate prior architectural decision after the place-cache produced a class of integrity bugs). The **caller** (orchestrator/voice server) snapshots the resolved result into the persisted `action_rules` row. The dispatcher (`evaluate-rules`) never sees a place name — only resolved coordinates.

**Precedent 2 — mobile already does this for named-contact recipients, partially.** `hooks/useOrchestrator.ts:3230-3245` resolves a spoken contact name via `lookupContact()` and snapshots `to_phone`/`to_email` (resolved identity) plus `to_name` (a human-readable label) into `action_config` — not a live contact reference, not the raw spoken name alone. Same shape as Precedent 1: resolve once, persist the resolved form, no re-resolution at fire time.

**This precedent establishes that the project already uses deterministic resolution and snapshot persistence as an architectural pattern. It does not, by itself, prove that recipient identity should follow identical lifecycle semantics — that remains an explicit Phase 2 product decision (see the lifecycle caveat below and §8).** Architectural precedent and proof of suitability are not the same claim; only the former is established here.

**Reframing this produces:** Defect A is not "invent a new Recipient Resolution architecture." It is **"extend an existing, already-proven, already-standardized deterministic pattern (resolve-once-and-snapshot) to recipients, where today it is applied inconsistently — present for named contacts on mobile, absent for literal addresses everywhere, and absent entirely on voice."** This is a materially stronger position for Phase 2 than treating it as novel architecture: it argues for consistency with an existing, working, governance-approved pattern rather than introducing a second design philosophy.

**One place the analogy does not automatically hold, flagged by the reviewer and not resolved here:** a place is effectively immutable; a contact is not. Bob can change his email, gain a second email, be deleted, or have his phone number edited after an alert referencing him already exists. The existing place precedent implies "snapshot and accept staleness" as the house style, but that is an inference from a different domain — it has not been an explicit product decision for recipients. **This is recorded as an open design question for Phase 2 (§8), not blocking Phase 1, and not assumed to resolve itself by analogy.**

## 4. What alternatives exist (Phase 2 work — not evaluated yet)

For Defect A, reframed per §3:
1. **Relax "Decision A"** — add `to_email`/`to_phone` as legitimate schema fields. Still reverses an explicit "do not relax without re-approval" decision; original rationale for the lock still not found inline.
2. **Extend the existing snapshot-resolution architecture to recipients** (formerly framed as "teach the resolution layer" — reframed after external review as bringing recipients into conformance with the pattern already standardized for places, not introducing new architecture). Consolidate behind one shared resolver used by every producer (`SET_ACTION_RULE` and `DRAFT_MESSAGE`, mobile and voice) rather than continuing to duplicate ad hoc resolution logic per call site — `naavi-voice-server/src/index.js:12176-12206`'s `executeDraft()` literal-detection logic is a working example of the *check*, but is itself one of the duplicated copies this direction should consolidate, not a second precedent to leave standing separately.
3. **Prompt-only fix (worked examples).** Reclassified per external review as **optimization, not architecture** — it can improve how reliably Claude signals recipient *intent*, but normalization into `to_email`/`to_phone` should not depend on model behavior for correctness. Not a candidate for the core fix; may still be useful layered on top of direction 2.

For Defect B: the merge-worthiness check (mobile `hasNewContent`, voice `newBody` diff) needs to also treat `to`/`to_email`/`to_phone` as content worth surfacing/merging, on both surfaces. This is independent of whichever Defect A direction is chosen — **fixing Defect A alone does not fix Defect B**, and vice versa. Wael's exact repro this session exercised both.

None of the above has been evaluated for risk, side effects, or the underlying product question already on record (should Naavi ever message an arbitrary unverified third party with no confirmation step). That evaluation is Phase 2.

## 5. Why this is a full-governance item, not a same-session fix

Reversing or working around an explicit "re-approval required" decision is a design decision, not a bug fix; this is the `action_rules` write path (Protected Core), shared by mobile and voice; there is a live product question about third-party messaging with no confirmation step. Defect B adds: any fix must be designed and tested across both mobile and voice symmetrically, since both were independently found to have the identical shape of gap. Per §3, Phase 2 will evaluate the change assuming **architectural consistency with the existing snapshot-resolution pattern as the leading hypothesis, while explicitly validating recipient lifecycle semantics before finalizing the design** — this changes the shape of the Change Plan but not the governance weight; it is still Protected Core, still cross-surface, still not waived from review.

## 6. Separate, already-fixed defect (shipped this session, NOT part of F12's governance scope)

While tracing why a McDonald's alert and the Bob's-home alert both displayed with no disambiguating address, a third, unrelated, low-risk defect was found and fixed same-session, with Wael's explicit approval:

**`naavi-voice-server/src/index.js:577-582`, `commitLocationRule()`** — built `trigger_config` from `pending.resolved.place_name`/`resolved_lat`/`resolved_lng` but never copied `pending.resolved.address`, even though it was already present on the `pending` object (confirmed at `:11401-11402` and elsewhere). Downstream, `app/alerts.tsx:117-119` needs `trigger_config.address` to render the disambiguating street segment; without it the Alerts screen shows only the bare place name. Confirmed voice-only — mobile's equivalent insert (`hooks/useOrchestrator.ts:888-895`) already sets this field correctly.

**Fix:** one line added, `address: pending.resolved.address ?? null,`. Committed `875ec35` on `naavi-voice-server`'s `staging` branch, pushed to `origin/staging`. Not merged to `main`/production.

**Compliance gap, flagged not silently skipped:** per CLAUDE.md Rule 15a, every shipped fix needs a corresponding regression test in `tests/catalogue/*.ts` before being considered done. This fix has none yet — `naavi-voice-server` is a separate repo from where `npm run test:auto` runs, and it's not yet established whether the main repo's test catalogue has any way to exercise voice-server functions directly. This needs Wael's decision: write a test (and figure out the cross-repo mechanism first), or explicitly approve shipping without one per the documented exception path.

## 7. Revision history

- **2026-07-05, original version:** established Defect A only, via code reads plus one prompt-only fix attempt (reverted). Phase 1 approved to proceed to Phase 2.
- **2026-07-05, first same-day revision** (per Wael's explicit "ignore the previous Phase 1, redo the analysis" instruction): independently re-verified Defect A against a live production DB row from a real call placed this session; found and documented Defect B (memory-hit dedup drops destination changes) on both mobile and voice; weakened the "hard schema wall" framing of Defect A after finding `task_actions` proves Claude can emit undeclared fields in practice; added a third, cheaper candidate fix direction (better prompt examples); found and shipped an unrelated address-truncation defect to staging; retracted two claims made in-session after Wael supplied direct evidence (Bob's contact card) contradicting them.
- **2026-07-05, second same-day revision** (after first round of external technical review): added §3, documenting `resolve-place` and mobile's contact-snapshot behavior as existing architectural precedent for the resolve-once-and-snapshot pattern; reframed Defect A's Direction 2 from "a proposal" to "bringing recipients into conformance with an already-standardized pattern"; reclassified the prompt-only direction as optimization, not architecture, per reviewer input; recorded recipient lifecycle (snapshot vs. live-link) as an explicit open Phase 2 design question rather than assuming the place-precedent's answer transfers automatically.
- **2026-07-05, third same-day revision** (after second round of external review, score raised to 9.6/10): tightened §3 to explicitly distinguish "architectural precedent exists" from "proof that recipients should follow identical lifecycle semantics" — the former is established, the latter is not, and the document previously blurred that line. Softened §5/§8 wording from "Phase 2 begins with the working assumption" to "Phase 2 will evaluate assuming X as the leading hypothesis, while explicitly validating recipient lifecycle semantics before finalizing the design" — keeps Phase 2 open to evidence rather than presenting the architectural direction as pre-decided.

## 8. Next step

Phase 2 (Change Planning) has not started for Defect A or Defect B. Per §3/§5, Phase 2 will evaluate the change assuming architectural consistency with the existing snapshot-resolution pattern (extend it to recipients, consolidated behind one shared resolver) as the **leading hypothesis**, not a settled conclusion — recipient lifecycle semantics are validated explicitly before the design is finalized, not assumed by analogy to places. First open design question for Phase 2, to be put to Wael explicitly rather than assumed: **should a persisted recipient be a snapshot (resolved phone/email + label, accept staleness if the contact later changes — matching the place precedent) or a live reference (re-resolved at fire time, tracking contact edits/deletion)?**

Still open and requiring Wael's decision, independent of Phase 2 timing:
- The live "Arrive at Parliament Street" rule (Evidence A1) is armed on production right now and will misfire to Wael himself if triggered before this is fixed. Disable/delete decision still pending.
- Test-coverage exception for the shipped address fix (§6) still pending.
