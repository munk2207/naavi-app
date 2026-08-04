# Travel-Time / Leave-By Misclassification — Phase 2 — Change Planning

**Date:** 2026-08-02 (amended same day, before Phase 3, per Wael's review)
**Governance version:** v4.0
**Phase 1A:** Approved 2026-08-02 — `docs/TRAVELTIME_LEAVEBY_MISCLASSIFICATION_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-08-02.md`

No code is written in this phase.

## Amendment Record

Wael reviewed the original Phase 2 draft and returned **"Approved with Required Amendments before Phase 3"** — the plan and Medium-risk classification were confirmed sound; 7 amendments were required before Phase 3 could begin. This document is the amended version. Amendments incorporated:

1. Corrected scope terminology (was: "Shared Core" in Phase 0's Constraints — that was wrong per Phase 1A's own finding; see below).
2. Test file location committed to explicitly, not left open.
3. Two-layer evidence requirement added (routing-level + outcome-level).
4. Explicit positive/negative test phrase list added.
5. `CALENDAR_SEARCH` preservation made an explicit, separate requirement.
6. Voice verification scope clarified — required as evidence, but a failure returns to analysis, does not auto-expand this implementation into voice code.
7. Implementation authorization boundary added — staging only; production is out of scope for Phase 4.

## Amendment 1 — Corrected Scope Terminology

Phase 0's Constraints section stated "Backend / Shared Core only." That was imprecise — Phase 1A established that calendar-read classification is a **Duplicated** capability, and this fix changes only the mobile-facing `naavi-chat` entry point, not a capability shared across mobile and voice.

**Authoritative classification, effective this document forward:** *Backend Edge Function / mobile conversational entry-point logic; not mobile application code, and not cross-channel Shared Core.*

This corrects the Change Impact Matrix and Architecture Impact Checklist below, which already reached the right conclusion ("Shared Core: No") but the correction is now stated explicitly as its own tracked item rather than left implicit in a table cell.

## Files That Will Change

| File | Classification | Modification |
|---|---|---|
| `supabase/functions/naavi-chat/index.ts` | Backend Edge Function / mobile conversational entry-point logic | Add an explicit exclusion to `classifyIntent`'s system prompt (currently line 1658-1664) so leave-by, departure-time, commute-time, navigation-time, and travel-time questions are never returned as `intent: "READ_CALENDAR"` — a meaning-based exclusion, not a fixed keyword list, so paraphrases are covered. |
| `tests/catalogue/calendar.ts` | Tests | **Amendment 2 — location committed, not left open.** Extend this existing file, which already owns the related `ARCH-1 READ_CALENDAR regression` tests. Any deviation from this location (e.g. if Phase 4 finds this file's existing structure genuinely cannot exercise the required two-layer assertions) must be explicitly documented in the Phase 5 Evidence Package, not chosen silently during implementation. |
| `tests/runner.ts` | Configuration | Register the new test(s), per Rule 15a. |

No other files. No mobile app files, no voice-server files, no database migrations.

## Risk Classification: **Medium**

Justification unchanged from the original draft, reconfirmed by Wael: touches Protected Core (Calendar integration, §4) and is a live LLM classifier prompt change (non-deterministic, Non-Determinism Rule applies). Not High: narrowly scoped, no data-layer risk, no write paths, existing regression-test backstop already covers the behaviors that must not regress.

## Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | No | No mobile app (APK/AAB) code changes. The fix is entirely inside the `naavi-chat` Edge Function mobile already calls unchanged — no client rebuild needed. |
| Voice | No | Per Phase 1A, voice's independent Level A classifier (`voiceClassifyAndHandleIntent`) does not include `READ_CALENDAR` and does not call `naavi-chat`'s `classifyIntent` — architecturally unreachable by this change. No voice-server code changes planned (see Amendment 6). |
| Shared Core | No | Per Amendment 1's corrected terminology and the Architecture Reference (line 68), calendar-read classification is **Duplicated**, not Shared Core. This change modifies only the mobile-facing entry point. |
| Database | No | No schema, table, or migration involved. |
| Cron | No | No cron job reads or writes this code path. |
| API contracts | No | `naavi-chat`'s external request/response shape to the mobile client is unchanged — only the internal classification decision changes. |
| Tests | Yes | New regression test(s) added to `tests/catalogue/calendar.ts` (Amendment 2), registered in `tests/runner.ts`. |

## Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** No — per Amendment 1, this is mobile conversational entry-point logic, not Shared Core. The affected capability is classified **Duplicated** (Architecture Reference line 68); this change touches only the mobile-side implementation.
- **Does this change modify an Entry Point (mobile or voice translating logic, rather than Shared Core)?** Yes — `naavi-chat`'s `classifyIntent` is the mobile conversational entry point's classification logic.
- **Does this change introduce new duplication?** No — modifies existing mobile-side logic in place.
- **Does this change eliminate existing duplication?** No — voice's independent classifier remains separate and unchanged; ADR-0002's Architecture Exception remains in force, unaffected.
- **Does this change modify Protected Core?** Yes — Calendar integration is Protected Core (§4). Mandatory review before and after coding applies.

## Regression Impact

- **Voice commands:** Not affected — architecturally unreachable (Phase 1A).
- **Geofencing:** Not affected.
- **Gmail integration:** Not directly modified, but shares the same classifier prompt (`GMAIL_SEARCH` is a sibling Level A intent) — must be confirmed unchanged, see Regression Matrix.
- **Calendar integration:** Directly affected — the fix's target, including the `CALENDAR_SEARCH` preservation requirement (Amendment 5).
- **Reminders:** Not directly modified; sibling Level A intent (`REMINDER_READ`), must be confirmed unchanged.
- **SMS / call alerts:** Not affected.
- **Onboarding:** Not affected.
- **Staging build:** Not applicable in the mobile-build sense — see Amendment 7 for the deployment boundary.

## Regression Matrix (per-change consumer trace)

Unchanged from the original draft — searched, not recalled: `classifyIntent` has exactly one call site (`naavi-chat/index.ts:2762`), gating all 10 Level A intents through one shared prompt. Full table retained:

| Intent | Consumer / handler | Must remain correct after this change |
|---|---|---|
| `LIST_RULES` | `intentHandlers.ts::handleListRules` | Yes — unrelated, confirm unchanged. |
| `LOOKUP_CONTACT` | `intentHandlers.ts::handleLookupContact` | Yes — unrelated, confirm unchanged. |
| `CALENDAR_SEARCH` | `naavi-chat/index.ts:2810-2814` → `handleCalendarSearch` | **Amendment 5 — explicit preservation requirement.** A specific-event-by-name question ("When is my dentist appointment?") must continue to classify as `CALENDAR_SEARCH`, not be pulled into the new travel-time exclusion merely because it names an appointment. |
| `READ_CALENDAR` | `naavi-chat/index.ts:2816-2822` → `buildCalendarReadResponse` | **Target of the fix** — exclude travel-time phrasing while preserving the two existing correct cases. |
| `GMAIL_SEARCH` | `naavi-chat/index.ts:2824+` | Yes — unrelated, confirm unchanged. |
| `PERSON_LOOKUP` | `intentHandlers.ts::handlePersonLookup` | Yes — unrelated, confirm unchanged. |
| `LIST_READ` | `intentHandlers.ts::handleListRead` | Yes — unrelated, confirm unchanged. |
| `REMINDER_READ` | `intentHandlers.ts::handleReminderRead` | Yes — unrelated, confirm unchanged. |
| `MEMORY_SEARCH` | `intentHandlers.ts::handleMemorySearch` | Yes — unrelated, confirm unchanged. |
| `CREATE_TICKET` | `naavi-chat/index.ts:2210` | Yes — unrelated, confirm unchanged. |

## Amendment 3 — Two-Layer Evidence Requirement

A routing-level pass alone ("not classified as `READ_CALENDAR`") does not prove the fix works — it only proves the message wasn't blocked. Phase 5's evidence package must prove both layers, for every positive-control phrase:

1. **Routing-level:** the phrase does not enter the deterministic `READ_CALENDAR` handler (`naavi-chat/index.ts:2816-2822`) — i.e., `classifyIntent` does not return `intent: "READ_CALENDAR"` for it.
2. **Outcome-level:** the full request, end to end, produces the actual TRAVEL TIME card — destination, duration, leave-by time, and the "Open in Google Maps" action — not merely "it reached Claude."

Neither layer alone is sufficient evidence for this item.

## Amendment 4 — Explicit Test Phrases

**Positive controls (must NOT classify as `READ_CALENDAR`; must produce the full outcome-level travel-time result):**
1. "What time should I leave for my dentist appointment?"
2. "What time should I leave for my next meeting?"
3. "When should I head out for my dentist appointment?"
4. "How early do I need to go to my next meeting?"

**Negative controls (must remain `READ_CALENDAR`, unchanged — protects the existing `tests/catalogue/calendar.ts` fixtures):**
1. "What's on my calendar today?"
2. "What do I have this week?"
3. "What's next on my calendar?"

**Amendment 5 case (must remain `CALENDAR_SEARCH`, not be swept into the travel-time exclusion):**
- "When is my dentist appointment?"

Per the Non-Determinism Rule (Phase 3, governance §3), every one of these phrases requires a minimum of 3 independent trials in Phase 5, with the full distribution reported.

## Amendment 6 — Voice Verification Scope

The live voice call test (already required, Phase 1A / Phase 7) is retained in the final validation matrix as **architecture-completeness evidence** — confirming Phase 1A's code-level finding that voice is unaffected. It does **not** authorize any voice code change under this implementation. If the live voice test fails (i.e., voice turns out to have an equivalent gap despite the code-level finding), the correct response is to **stop and return to analysis** (effectively re-opening Phase 1/1A for voice specifically) — not to silently expand this implementation's scope to patch voice code under the current authorization.

## Amendment 7 — Implementation Authorization Boundary

**Phase 4 is authorized to implement and deploy to staging only.** Production Edge Function deployment is explicitly **out of scope** for this Phase 4 authorization. Promotion to production requires: (a) completed staging evidence per Amendment 3's two-layer requirement, satisfying the Non-Determinism Rule's 3-trial minimum, and (b) Wael's own separate, explicit approval to promote — consistent with CLAUDE.md's staging-first rule and the governance Phase-Gate Approval Rule (§3).

---

**Status:** Amendments incorporated. Ready for Phase 3 — External Technical Review.
