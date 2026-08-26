# B9x — Phase 2: Change Plan (v2 — creation path)

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-26 |
| **Governance** | v4.2, §3 Phase 2 |
| **Phase 0 / 1 / 1A** | `..._V3_2026-08-26` / `..._V2_2026-08-26` / `..._V2_2026-08-26` — all approved |
| **Supersedes** | `B9X_PHASE2_CHANGE_PLAN_2026-08-26.md` (fire-time scope) |
| **Risk** | **HIGH** — Protected Core (Action Rules) |
| **Status** | Awaiting review. **No code written.** Phase 3 review required before coding. |

---

## 1. The remedy in one paragraph

Give `naavi-chat` the recipient-resolution step **voice already performs**, at the same point in the
flow: after Claude emits a location tool call, before the action leaves the server. If the alert
names a person and carries no address, resolve the name. Resolved → carry on, same single turn.
Not resolvable → drop the action and ask, in Naavi's own words. This also makes
`get-naavi-prompt:1215`'s existing claim — *"the server resolves the contact"* — true for the first
time.

**Nothing new is invented.** `resolve-recipient` exists, is Shared Core, and is already called with
exactly this input by voice (`src/index.js:12616`) and by the mobile orchestrator
(`useOrchestrator.ts:3493`).

---

## 2. Behaviour table

Engages **only** when: no `self_override_*` field is set, `action_config.to`/`to_name` is non-empty,
and both `to_phone` and `to_email` are empty. Otherwise the code path is untouched.

| Case | `resolve-recipient` result | Outcome |
|---|---|---|
| *"Alert me at Costco"* | **not called** — no name | **Unchanged.** Single turn. |
| *"Text my wife when I leave the office"*, wife in contacts | `resolved_contact` | populate `to_phone`/`to_email`/`contact_id`/`to_name`; **single turn, unchanged from the user's view** |
| *"Text +1 613 555 0000 when I arrive"* | `literal_phone` / `literal_email` | populate directly; single turn |
| *"Email me at jane@x.com when I arrive"* | **not called** — `self_override_email` set | **Unchanged.** F15 Defect A preserved. |
| *"Text Abdyn when I arrive at the office"*, no such contact | `not_found` / `invalid` | **drop the action**; *"I don't have a contact named Abdyn. Tell me their phone number or email, or save them to your contacts first."* |
| Two contacts named Sam | `ambiguous` | **drop the action**; *"You have more than one contact named Sam — say their full name and I'll try again."* |
| `resolve-recipient` unreachable | call throws | **drop the action**; *"I couldn't verify that contact right now — please try again."* **Fail closed.** |

**This satisfies the Phase 1 reviewer's constraint exactly:** friction is added in three rows only,
all of which are cases where Naavi genuinely does not know who the message is for. Every working
path stays single-turn.

---

## 3. Files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `supabase/functions/naavi-chat/index.ts` | **Backend / Shared Logic** | New post-assembly resolution step for `trigger_type='location'` actions, placed in the existing action-gate region (~`:4170-4210`) alongside the B4y RULE 23 gate. **Not inside the `toolUseBlocks.map()` at `:3786`** — that map is synchronous and restructuring it to async is a larger change than this fix warrants. | **High** |
| `supabase/functions/get-naavi-prompt/index.ts` | **Backend (prompt)** | Correct the `:1215` / `:1202` annotations so they describe what the server now actually does, and state that an unresolvable recipient produces a question rather than a saved alert. **No change to the RULE 23 location exemption** — it stays exempt. | **Medium** |
| `tests/catalogue/session-2026-08-26-b9x-location-recipient.ts` | **Tests** (new) | Rule 15a suite — §8 | Low |
| `tests/runner.ts` | **Tests** | Register the suite | Low |

**No database. No migration. No cron. No dependency. No UI. No mobile file. No voice file.**

**Complexity Tax (AI Coding Discipline #23).** The simpler alternative — fix the two mobile
orchestrator paths directly — is rejected because it means changing two places, leaving a third
correct-by-accident, and trusting no fourth path appears. Three exist today and one
(`useOrchestrator.ts:1516`, the place-picker commit) was in no document until Phase 1A. Resolving in
Shared Core covers all three and any future one.

---

## 4. Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **No file changes. Behaviour changes.** | Actions arrive with the recipient already resolved, so the orchestrator's own guard at `:3493` (`if (!hasSelfOverride && toName && !to_phone && !to_email)`) finds `to_phone` populated and **skips** — no double lookup, no conflict. The two unresolved paths (`:914`, `:1516`) receive a resolved `action_config` they simply insert. |
| **Voice** | **No.** | **Voice never calls `naavi-chat`** — verified this session, zero matches for `functions/v1/naavi-chat` in `naavi-voice-server/src/index.js`. Voice keeps its own already-correct path at `:12613`. |
| **Shared Core** | **Yes.** | `naavi-chat` and `get-naavi-prompt`. This is the whole change. |
| **Database** | **No.** | No schema, migration, RLS, or constraint change. |
| **Cron** | **No.** | No cron definition touched. |
| **API contracts** | **No shape change.** | `action_config` keeps its existing shape. The change is *when* `to_phone`/`to_email`/`contact_id` get populated — earlier in the pipeline — not *what* the object looks like. Every downstream consumer already handles both populated and empty. |
| **Tests** | **Yes.** | One new suite; one existing suite is a constraint — §6.3. |

**Duplicated capability — both implementations addressed?** **Yes, explicitly.** Voice's
implementation is **already correct** and is deliberately left alone; Phase 1A verified it line by
line. The mobile-facing implementation is the one that gains the behaviour. Neither side is silent.

---

## 5. Mandatory Architecture Impact Checklist

| Question | Answer |
|---|---|
| Modifies **Shared Core**? | **Yes** — `naavi-chat`, `get-naavi-prompt`. |
| Modifies an **Entry Point**? | **No.** No mobile client file, no voice server file. |
| Introduces **new duplication**? | **No.** It calls the existing shared `resolve-recipient` rather than reimplementing lookup. |
| **Eliminates** existing duplication? | **Partially.** Recipient resolution for location alerts moves from the mobile client into Shared Core, so the surfaces converge on one behaviour. **It does not resolve Priority 1 / ADR 0001** — mobile and voice still classify alerts independently. Phase 6 must not claim otherwise. |
| Modifies **Protected Core**? | **Yes** — Action Rules. Full Phase 1–8, review before and after coding. |

---

## 6. Regression Matrix — consumer trace

Produced by searching, not recall.

### 6.1 Who consumes `naavi-chat`'s emitted actions
| Consumer | Effect |
|---|---|
| `hooks/useOrchestrator.ts:3996` (main path) | Its own resolve at `:3493` now short-circuits — `to_phone` already set. `recipientBlocked` never engages. Same end state, reached one step earlier. |
| `hooks/useOrchestrator.ts:914` (compound) | Inserts a resolved `action_config` instead of a raw name. **This is the fix reaching it, with no mobile edit.** |
| `hooks/useOrchestrator.ts:1516` (place-picker commit) | Same. |
| Voice server | **Not a consumer.** Does not call `naavi-chat`. |

### 6.2 New consumer of `resolve-recipient`
`naavi-chat` becomes a third caller, alongside voice (`:12616`) and the orchestrator (`:3493`).
Contract verified from its own header: `mode: 'create'` takes `{ to, user_id }` and returns
`literal_email` / `literal_phone` / `resolved_contact` / `ambiguous` / `not_found` / `invalid`
(`resolve-recipient/index.ts:17-28`). **All six are handled** — §2. No change to
`resolve-recipient` itself.

### 6.3 ⚠️ Existing test that constrains this change
`tests/catalogue/confirm-then-act.ts:142-168` asserts that *"alert me at Shoppers Drug Mart"* must
emit `SET_ACTION_RULE` **on the first turn**, because `set_location_rule_chain` is exempt from
RULE 23. **This change must keep it green** — and does, by construction: that phrase names no
recipient, so the resolution step never engages. It is the reviewer's constraint, already written as
a test.

---

## 7. Regression Impact — the mandatory checklist

| Area | Affected? | Reasoning |
|---|---|---|
| **Voice commands** | **No.** | Voice does not call `naavi-chat`; no voice file changes. |
| **Geofencing** | **No.** | Detection, dwell, phantom rejection, and `report-location-event` are untouched. Only what gets *stored* on the rule changes. |
| **Gmail integration** | **No.** | Email-trigger alerts are unaffected — the step is gated on `trigger_type='location'`. |
| **Calendar integration** | **No.** | Same gating. |
| **Reminders** | **No.** | Different table, different function. |
| **SMS / call alerts** | **Yes — deliberately.** | A location alert naming an unidentifiable person is no longer saved, so it can no longer misdeliver. Resolved and self alerts are byte-identical to today. |
| **Onboarding** | **No.** | No client, auth, settings or permission code. |
| **Staging build** | **No.** | Edge Functions only. No app build, no versionCode bump. |

---

## 8. Test plan (Rule 15a) — and the Non-Determinism Rule

**This change touches the Claude system prompt, so Governance Phase 3's Non-Determinism Rule
applies: every behaviour-changing case runs a minimum of 3 independent trials, and Phase 5 reports
the full distribution — not a pass/fail summary.**

**Negative controls (the bug must not return)**
1. *"Send sms to Abdyn when I arrive at the office"*, Abdyn not in contacts → **no rule saved**, speech asks for a number.
2. Ambiguous name → no rule saved, speech asks for the full name.
3. `resolve-recipient` unreachable → no rule saved, fail closed.
4. Assert no emitted location action ever carries `to`/`to_name` without `to_phone`/`to_email`.

**Positive controls (nothing that works may break)**
5. *"Alert me at Shoppers Drug Mart"* → single turn, action emitted. **Mirrors `confirm-then-act.ts:142`.**
6. *"Text my wife when I leave the office"*, wife in contacts → single turn, `to_phone` populated.
7. *"Email me at jane@x.com when I arrive at Costco"* → `self_override_email` honoured, resolution never runs (F15 Defect A).
8. Literal phone number as recipient → single turn.

**Live staging test, required at Phase 7 by Wael's Rule 17 ruling:** set a location alert naming a
person not in contacts, on staging, and confirm Naavi asks instead of saving.

---

## 9. Known limits of this plan — stated, not buried

**Reproduction 2 is still not covered, and this plan does not pretend otherwise.** Its rule stored
no recipient of any kind. With nothing naming a person, the resolution step correctly does not
engage, and the alert is correctly treated as a self-alert. Fixing it means making Claude reliably
*capture* a named recipient in the first place — and **Phase 1 §5 established that the cause of the
capture failure is unproven.** Designing a fix for an unproven mechanism is what Rule 17 exists to
prevent. Left out deliberately; **not** converted into a tracked item, which under Rule 1b is Wael's
call.

---

## 10. Not decided here

Phase 3 reviews this before any code exists.
