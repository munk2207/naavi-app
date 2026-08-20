# Phase 8 — Merge — S1 — Voice PIN Authentication

**Date:** 2026-08-19
**Governance version:** v4.0
**Scope of this merge:** **staging only.** Production promotion is a separate decision and follows the existing release process.

---

## 1. Merge preconditions

Governance §Phase 8 lists five. Each is answered with evidence, not assertion.

| # | Precondition | Status | Evidence |
|---|---|---|---|
| 1 | Automated tests pass | ✅ | Gate 1 **4/4**, Gate 2 **8/8**, both against **STAGING** — environment read from the runner's banner, not assumed |
| 2 | Manual validation passes | ✅ | **12/12 plus one extra test Wael added** — `docs/S1_PHASE_7_TESTING_2026-08-19.md` §5 |
| 3 | External review completed | ✅ | Phase 3 (before coding) and Phase 6 (after coding), both mandatory here — Authentication *and* Permissions are Protected Core |
| 4 | Architectural change recorded in the Architecture Reference **in this work item** | ✅ | §2c added, plus two rows in §2. Version bumped to **2026.07.18.5** |
| 5 | No newer Architecture Reference superseded the version recorded at Phase 1A | ✅ with a finding | See §2 |

## 2. Precondition 5 — the version check, and what it exposed

Phase 1A recorded **`2026.07.18.4`** and required it be re-confirmed unsuperseded before merge.

**The version string was still `2026.07.18.4` — but not because nothing changed.** Three sets of edits landed on the Reference between revisions 4 and 5 without anyone bumping it:

1. T2's §0b (deployment environments),
2. the 2026-08-19 consolidation that folded in §2b and superseded four older architecture documents,
3. the 2026-08-19 §0b entry recording that the demo line has two numbers and no environment of its own.

**Re-evaluation performed:** all three concern deployment topology. None alters any Shared Core boundary, entry-point responsibility, or ownership claim that S1 relied on. **No S1 assumption required revision.**

**But a literal reading of precondition 5 would have passed this check for the wrong reason** — the version was unchanged because bumping it was forgotten, not because the document was stable. A check that can be satisfied by neglect is not a check. Recorded in the Reference's own header as revision 5's note, and worth noting in governance: this is the same failure mode as the five parallel architecture documents — *a document stays current only if something mechanically forces it to*.

## 3. What is being merged

**Already on `main`** (naavi-app) and **`staging`** (naavi-voice-server) — merged incrementally through Phase 4 rather than as one commit, which is why this phase confirms rather than performs the merge.

| Component | Change |
|---|---|
| `naavi-voice-server/src/index.js` | Identity-before-credential (Track A); PIN-authenticated callers cannot change the PIN and the PIN is not spoken aloud (B); 6-digit prompts (C); failure reporting reduced to translation (D + Phase 6); partial-entry counting and identity retention (Phase 7 fix) |
| `supabase/functions/manage-voice-pin/index.ts` | 6-digit `set`, 4-or-6 `verify`; **owns** `record_failure` / `clear_failures` / `set_blocked`, the alert threshold, and the alert send |
| `supabase/functions/receive-sms-reply/index.ts` | Routes the `BLOCK` command to Shared Core |
| `app/settings.tsx` | 6-digit PIN entry; blocked-state panel and the only re-enable path |
| `supabase/migrations/20260819000000_…` | Three additive columns |
| `supabase/migrations/20260819010000_…` | `record_voice_pin_failure()` — atomic increment, service-role only |
| `tests/catalogue/s1-voice-pin-scoping.ts` | 9 regression tests |
| Build **327** | Carries the mobile halves |

**Config changes that live outside git** (recorded because they are otherwise invisible):
- Twilio `+13435041572` SMS webhook → staging `receive-sms-reply`.
- Staging `TWILIO_FROM_NUMBER` → `+13435041572`.

## 4. The original defect, and what closed it

A caller on an unregistered phone was asked for a PIN, and that PIN was checked against **every account holding one**. A guess succeeded if it matched *anyone*, so effective security **degraded as the user base grew** — roughly 1 in 2,000 at 5 users, 1 in 10 at 1,000. The attempt cap counted per call and reset on redial, and nothing alerted, so a sustained attack would have been invisible.

**Closed by inverting the order: identity first, credential second.** The caller states the last 4 digits of their registered number, that resolves to exactly one account, and the PIN is verified against that account alone. The odds are now independent of user count — the property that was actually wrong.

Everything else in S1 exists because that inversion made it possible: a failure could not be *attributed* to an account before it, so counting, alerting and per-account lockdown had nothing to attach to.

## 5. Known limitations carried forward, stated not buried

1. **Suffix matching is against the primary `phone` column only.** A caller registered via a secondary number in `phone_numbers` must use the primary — PostgREST cannot express "array element ends with". Not a regression; the borrowed-phone path did not exist before.
2. **No true last-4 collision was ever exercised**, on staging or in tests — the project has one PIN-bearing account, so the multi-candidate path could not be reached with real data. The logic exists and asks for more digits; it has never run against two real accounts.
3. **B11g (no barge-in during PIN prompts) is unfixed and S1 made it costlier**, adding a second prompt per call. It is what produced the partial entries that failed Phase 7's first run.

## 6. Findings this work item produced but did not fix

All logged in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`: **B11c** (root-caused — a column missing on staging fails the whole caller-name query), **T4** (production carries schema no migration creates), **B11f** (the voice Stop control, ranked P0b — next), **B11g** (no barge-in during prompts).

## 7. ⚠️ What this phase does **not** authorize

- **Production promotion.** S1 is staging-only. Production has neither migration, so `manage-voice-pin`'s counter reset and the app's blocked-flag read will no-op there by design until they are applied — both were deliberately written to fail soft for exactly this reason.
- **The three production gates** (auto-tester green, voice regression, Firebase Test Lab) have **not** been run for a production AAB and are not satisfied by anything in this document.
- Per the Phase-Gate Approval Rule, promotion needs Wael's own explicit word, separately.

---

**Phase 8 complete. S1 is merged to staging. The defect that opened this work item — a PIN checked against every account — no longer exists on any surface.**
