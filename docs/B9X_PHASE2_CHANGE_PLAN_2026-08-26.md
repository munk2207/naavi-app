# B9x — Phase 2: Change Plan

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-26 |
| **Governance** | `docs/AI_DEVELOPMENT_GOVERNANCE.md` v4.1, §3 Phase 2 |
| **Phase 0 (v2)** | `docs/B9X_PHASE0_INTENT_APPROVAL_2026-08-26.md` — approved 2026-08-26 |
| **Phase 1 / 1A** | `..._PHASE1_PROBLEM_DEFINITION_2026-08-25.md` / `..._PHASE1A_ARCHITECTURE_COMPLETENESS_2026-08-26.md` |
| **Architecture Reference** | 2026.07.18.**12** (`0e20f8a`) |
| **Risk classification** | **HIGH** |
| **Status** | Awaiting review. **No code written.** Phase 3 review required before any coding. |

---

## 1. Two corrections to earlier phases, stated before anything else

### 1.1 `report-location-event` has **three** callers, not two

Phase 1 and Phase 1A both said two. The Regression Matrix below was produced by searching rather
than by recall, and found a third:

| # | Caller | Found |
|---|---|---|
| 1 | `hooks/useGeofencing.ts:538` | already known |
| 2 | `supabase/functions/fire-pending-dwells/index.ts:90` | already known |
| 3 | **`supabase/functions/tsoft-geofence-webhook/index.ts:109`** | **missed by both earlier phases** |

Caller 3 is the Transistorsoft background-geofence webhook, which forwards to
`report-location-event` using the service role "so fan-out runs" (its own header comment, `:23`).
It reaches the same defective code as the other two. It changes no conclusion — it widens the set of
real-world entry points that can produce the misdirection, and it is exactly what Phase 2's
consumer-trace rule exists to catch.

### 1.2 The fix cannot repair Reproduction 2 — and this needs Wael's decision

B9x records two reproductions. **They are not the same shape:**

| | What was stored | Fixable at fire time? |
|---|---|---|
| **Reproduction 1** (mobile) | `{"to": "Abdyn"}` — the name was kept, never resolved | **Yes.** The name is present in the row, so a third party was demonstrably intended. |
| **Reproduction 2** (voice, via B9w) | the recipient's name **was never captured at all** | **No.** |

Reproduction 2's row is byte-for-byte indistinguishable from a genuine *"alert me when I arrive"*.
No fire-time code can tell them apart, because the information required to tell them apart was never
written down. Repairing it requires a **write-time** change, and every write path is out of scope
under Phase 0.

**Phase 0's Success Criterion 1 is therefore not fully achievable within Phase 0's own scope.** This
is raised now rather than discovered at Phase 7. It is Wael's call, on its own, and this plan does
not assume an answer.

---

## 2. Proposed remedy

### 2.1 The principle

Today, both dispatchers infer *who an alert is for* from *whether it carries a delivery address*.
Those are two different facts. The remedy is to stop inferring one from the other: check whether a
recipient was **named**, and treat "named but unresolved" as its own state — neither a self-alert nor
a deliverable third-party alert.

### 2.2 The pattern already exists in this codebase

`supabase/functions/_shared/task_actions.ts:32-95` solves this exact problem correctly for the
third-party sends attached to an alert:

1. name present, address missing → resolve at fire time via `lookup-contact` (`:35-47`)
2. name shorter than 2 characters → **skip and log** (`:39`)
3. zero matches → **skip and log** (`:64`)
4. ambiguous multiple matches → **skip and log** (`:66`)
5. send only when an address genuinely exists (`:77`, `:89`)

**Fail closed. Never substitute a different recipient.** The primary alert path does the opposite: it
substitutes the user. The remedy is to give the primary path the behaviour the attached path already
has.

### 2.3 Where the logic goes — one shared module, not two copies

**Proposed: extract to `supabase/functions/_shared/recipient_gate.ts`, called by both dispatchers.**

**Complexity Tax (AI Coding Discipline #23) — the simpler alternative and why it is rejected.** The
simpler option is to write the same fix twice, once in each dispatcher. It is rejected because:

- That is precisely the drift pattern the Architecture Reference tracks as **Priority 1b / ADR 0005**,
  which already has **three** documented incidents for this exact function pair. A fourth is not a
  risk to accept knowingly.
- ADR 0005's accepted approach is explicitly *"extract the specific drifted piece into a shared
  module"* — the `_shared/task_actions.ts` precedent (B10g). This proposal follows the accepted
  pattern rather than inventing one.
- **Phase 0's Success Criterion 3** requires the two functions to agree when this closes. A shared
  module makes that true by construction rather than by a comment asking future editors to remember.

### 2.4 Behaviour, precisely

For each dispatcher, before the existing `noRecipient` computation:

| Condition | Result |
|---|---|
| `hasSelfOverride` is true | **unchanged** — self-alert, checked first, exactly as today (F15 Defect A) |
| No name, no address | **unchanged** — genuine self-alert. *"Alert me at Costco"* still works. |
| Address already present | **unchanged** — third party, as today |
| **Name present, no address → resolves to exactly one contact** | send to that contact as a third-party alert |
| **Name present, no address → zero matches, ambiguous, or name under 2 characters** | **fail closed.** Do **not** deliver to the user as their own alert. Tell the user honestly that the alert could not be delivered and why. |

`evaluate-rules` already has an honest-failure path of this shape — F12 Phase 4's *"distinct failure
path for an unresolvable contact_id"* at `:790-822`, which notifies the user on their enabled
channels that delivery failed. **The proposal reuses it.** `report-location-event` has no equivalent
and would gain one — this is the largest single piece of new behaviour in the change.

---

## 3. Files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `supabase/functions/_shared/recipient_gate.ts` | **Shared Logic** (new) | The gate described in §2.4 | High |
| `supabase/functions/report-location-event/index.ts` | **Backend** | Call the gate before `noRecipient`; add the honest-failure path; make the `:763-764` mirroring comment true | High |
| `supabase/functions/evaluate-rules/index.ts` | **Backend** | Call the gate before `noRecipient`; reuse the existing failure path at `:790-822` | High |
| `tests/catalogue/session-2026-08-26-b9x-recipient-gate.ts` | **Tests** (new) | Rule 15a regression tests | Low |
| `tests/runner.ts` | **Tests** | Register the new suite | Low |

**No database change. No migration. No cron change. No dependency change. No UI change.**

**Overall risk: HIGH.** Protected Core (Action Rules *and* Notification routing), and the change
decides who receives real messages on real phones.

---

## 4. Change Impact Matrix

Every row answered explicitly. An omitted row is not "not affected."

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **No** | No mobile file changes. `hooks/useGeofencing.ts` is a *caller* and is unmodified — it POSTs a geofence crossing and makes no recipient decision (verified, zero grep matches for `to_phone`/`to_email`/`isSelf`). Mobile users see corrected behaviour because the backend is shared, not because mobile changed. |
| **Voice** | **No** | No voice file changes. `naavi-voice-server/src/index.js` contains no fan-out and no self-alert determination (verified, zero matches for `isSelfAlert`/`noRecipient`). Voice callers see corrected behaviour for the same reason as mobile. |
| **Shared Core** | **Yes** | Both dispatchers plus one new shared module. This is the entire change. |
| **Database** | **No** | No schema change, no migration, no RLS change, no new column. The gate reads `action_config` fields that already exist (`to_name`, `to`, `to_phone`, `to_email`). |
| **Cron** | **No** | No cron definition changes. The `evaluate-rules` cron and the `fire-pending-dwells` cron both continue to call the same endpoints unchanged. |
| **API contracts** | **No** | No request or response shape changes for either function. `action_config`'s shape is unchanged — the gate reads existing fields and writes none. |
| **Tests** | **Yes** | One new suite, registered in `tests/runner.ts`. Five existing suites assert on exact source strings in the changed files — see §6. |

**Duplicated capability — will both implementations change?** **Yes, both.** Per Wael's ruling of
2026-08-26 and Phase 0 v2's In Scope. Neither is left unaddressed, and the shared module means they
cannot subsequently drift on this behaviour.

---

## 5. Mandatory Architecture Impact Checklist

| Question | Answer |
|---|---|
| Does this change modify **Shared Core**? | **Yes** — both dispatchers and one new `_shared` module. |
| Does this change modify an **Entry Point**? | **No.** No mobile client file, no voice server file. Entry points continue to translate only. |
| Does this change **introduce new duplication**? | **No.** It introduces one shared module called from both sites. |
| Does this change **eliminate existing duplication**? | **Partially — yes, for this behaviour.** It removes one drifted behaviour from the `evaluate-rules` / `report-location-event` pair (Priority 1b, ADR 0005). The pair's remaining overlap — channel selection, self-alert detection generally, `task_actions` execution — is untouched and remains an accepted Exception. **This does not resolve Priority 1b**, and Phase 6 should not claim it does. |
| Does this change modify **Protected Core**? | **Yes** — Action Rules *and* Notification routing. Full Phase 1–8 with review before and after coding. |

---

## 6. Regression Matrix — per-change consumer trace

Produced by searching the codebase, not from recall.

### 6.1 Runtime callers of `report-location-event`

| Caller | Effect of this change |
|---|---|
| `hooks/useGeofencing.ts:538` | A location alert with an unresolved named recipient stops arriving at the user. No change to the request it sends or the response it reads. |
| `supabase/functions/fire-pending-dwells/index.ts:90` | Same. **Both B9x reproductions are dwell-based, so this is their path.** |
| `supabase/functions/tsoft-geofence-webhook/index.ts:109` | Same. **Newly identified — see §1.1.** |

### 6.2 Runtime callers of `evaluate-rules`

| Caller | Effect |
|---|---|
| Cron `20260407000001_evaluate_rules_cron.sql:12` | Unchanged cadence and endpoint. |
| `supabase/functions/sync-gmail/index.ts:401` | Post-sync email-alert evaluation. Unchanged interface. |

### 6.3 Downstream consumers inside the changed functions

| Consumer | Effect |
|---|---|
| `send-sms`, `send-user-email` | Called with the same payload shape. In the fail-closed case they are **not** called for the misdirected send, and **are** called for the honest failure notice. |
| `_shared/alert_body.ts` | Unchanged. Body construction is untouched. |
| `_shared/task_actions.ts` | Unchanged, and continues to run after the primary send exactly as today (`report-location-event:957`). |
| `_shared/outbound_guard.ts` | Unchanged. Staging containment behaves identically. |
| Voice-alert webhook (`naavi-voice-server/src/index.js:8759-8811`) | Unchanged. Voice remains the callee of `callVoice()`. |

### 6.4 ⚠️ Five existing test suites assert on **exact source strings** in the changed files

This is the sharpest regression risk in the change, and it is not obvious from the diff.

| Suite | Asserts | Constraint it places on the fix |
|---|---|---|
| `session-2026-07-06-f12-high-risk-wiring.ts:122-127` | `const noRecipient   = !toPhone && !toEmail;` exists **and** the unresolvable-`contact_id` branch appears *before* it | The literal string must survive, and the new gate must sit **before** `noRecipient`, consistent with F12's ordering guarantee |
| `session-2026-07-09-f15-defect-a.ts:99, 123` | `isSelfAlert = Boolean(hasSelfOverride` in **both** files | `hasSelfOverride` must remain the first, short-circuiting condition — F15 Defect A |
| `session-2026-07-13-b9k...:78` | `if (isSelfAlert) {` in `evaluate-rules` | branch structure preserved |
| `session-2026-07-17-b10h...:118, 135` | `if (isSelfAlert) {` in `report-location-event` | branch structure preserved |
| `session-2026-07-17-f5c...:109` | the exact `const mode = isSelfAlert ? 'self' : ...` line | logging line preserved |

**Each of these locks in a previous fix** (F12, F15 Defect A, B9k, B10h, F5c). None may be weakened to
make this change fit. If any must change, that is a Phase 3 decision requiring explicit approval, not
a test edit made in passing.

---

## 7. Regression Impact — the mandatory checklist

Every item answered explicitly; silence is not acceptable.

| Area | Affected? | Reasoning |
|---|---|---|
| **Voice commands** | **No** | No voice server file changes. Voice's write-time resolution is untouched; its conversational sends do not pass through either dispatcher. |
| **Geofencing** | **Yes — deliberately** | All three `report-location-event` callers are geofence paths. Arrival/departure detection, dwell timing and phantom rejection are untouched; only the recipient decision after a confirmed fire changes. |
| **Gmail integration** | **Indirectly** | `sync-gmail:401` calls `evaluate-rules` after a sync. Email-triggered alerts to an unresolved named recipient now fail closed instead of arriving at the user. Sync, classification and harvesting are untouched. |
| **Calendar integration** | **Indirectly** | Calendar-triggered alerts run through `evaluate-rules` and are subject to the same gate. Calendar reads and writes are untouched. |
| **Reminders** | **No** | `check-reminders` has its own fan-out and contains no self/third-party logic at all (verified, zero matches). Not modified, not called. |
| **SMS / call alerts** | **Yes — deliberately** | This is the change. Self-alerts and resolved third-party alerts behave identically; only "named but unresolved" changes, from misdelivery to honest failure. |
| **Onboarding** | **No** | No client code, no auth, no settings, no permissions. |
| **Staging build** | **No** | Edge Functions only. No app build, no `app.json` change, no versionCode bump. |

---

## 8. Test plan (Rule 15a)

New suite `tests/catalogue/session-2026-08-26-b9x-recipient-gate.ts`, registered in `tests/runner.ts`:

**Negative controls — the bug must not return**
1. Location rule, `{"to": "Abdyn"}`, no phone/email → must **not** be classified self-alert.
2. Same shape via `evaluate-rules` on a time trigger → same.
3. Zero-match name → fail closed; the user's own channels receive no arrival-style message.

**Positive controls — nothing that works today may break**
4. `{"to_phone": "<user's own>"}` → still a self-alert (`isSelfByPhone`).
5. No name, no address → still a self-alert. *"Alert me at Costco"* unchanged.
6. `self_override_sms` present → still a self-alert, checked first (F15 Defect A).
7. Resolved third-party (`to_phone` populated) → still a third-party send.
8. Name resolving to exactly one contact → third-party send to that contact.

**Structural**
9. Both dispatchers call the same shared gate — the assertion that stops them drifting again.

---

## 9. Recorded, not acted on

Two observations found while producing the consumer trace. **Neither is a tracked item; under Rule 1b
that is Wael's to decide, and neither is proposed here.**

1. **`20260407000001_evaluate_rules_cron.sql:12` hardcodes the production URL**
   (`https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/evaluate-rules`). Relevant to this work
   only because Phase 7 will need to know what staging's `evaluate-rules` cron actually points at
   before interpreting any staging test result. **To be verified at Phase 7, not assumed.**
2. `tests/results/` holds several hundred historical run artefacts committed to the repository. Noise
   in every code search. Not investigated.

---

## 10. What Phase 2 does not decide

Phase 3 reviews this plan before any code exists. Two things remain open and are **not** settled by
this document:

1. **Rule 17** — no live fire has ever been observed, and `evaluate-rules` has no reproduction at
   all. Wael's decision, still outstanding.
2. **Reproduction 2's unfixability at fire time** (§1.2). Wael's decision, raised on its own.
