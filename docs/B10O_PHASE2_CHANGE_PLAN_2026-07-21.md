# B10o — Phase 2: Change Planning

**Date:** 2026-07-21
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.5, Phase 2
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4

No code written in producing this document.

---

## Design decision: consolidate into a shared readback-suffix helper

Per ChatGPT's Phase 1A requirement, this decision must be explicitly justified rather than defaulted to.

**Decision: consolidate.** A new pure function, `buildAlertReadbackSuffix(actionConfig)`, will build the self-task + third-party naming clause(s) shared by all 5 sites; each site keeps its own existing headline (mode-specific phrasing genuinely differs — "Alert set", "Got it — I've added...", "Your previous alert...", "Re-armed your alert...") and appends the shared suffix instead of independently reconstructing it.

**Why consolidation is the lower-risk option, not the reverse:**
1. **Direct proof the per-site-patch approach already failed once.** The 2026-07-17 B10h/B10j fix patched 2 of the now-known 5 sites. The other 3 carried the identical gap for 4 days until Phase 1A found them — not a hypothetical risk, an observed one.
2. **The duplicated content is genuinely identical business logic**, not superficially-similar-but-actually-different logic. All 5 sites need to answer the same question — "what does this action_config's self-task and third-party fields say, in words?" — with no legitimate per-site variation in that answer. This differs from this codebase's accepted duplications (e.g. ADR 0001's mobile/voice classifier split), which persist because the two surfaces have genuinely different constraints — there's no equivalent constraint separating these 5 mobile sites from each other.
3. **A future 6th confirmation site inherits correct behavior for free** by calling the helper, rather than requiring someone to remember to re-replicate the naming logic a third time.

**Why the fix stays surgical despite consolidating:** only the *suffix* (self-task/third-party naming) moves into the shared helper. Each site's headline stays independent — headlines genuinely differ by mode (new vs. merged vs. reactivated vs. re-armed) and unifying them would be a bigger, riskier, and unjustified change with no bug behind it.

**Functional contract for `buildAlertReadbackSuffix`** (added per Phase 2 review): the helper shall be deterministic and side-effect free. It shall never mutate `actionConfig`, never access external state (no network, no storage, no clock), and shall return identical output for identical input. This is the explicit contract Phase 5's evidence package must verify, not just an implied property of calling it "pure."

**Output invariants** (added per Phase 3 review): the helper must never —
- reorder the self-task and third-party clauses relative to the approved precedence table below;
- emit duplicated clauses when equivalent data appears in more than one field;
- include empty placeholders, the literal strings `"undefined"`/`"null"`, or stray punctuation when an optional field is absent;
- mutate the supplied `actionConfig` (restates the functional contract above, kept here too since it's directly testable as an output-side invariant).

**Precedence table — expected output for every self-task / third-party combination:**

| Self-task | Third-party | Output |
|---|---|---|
| Yes | No | Self-task clause only |
| No | Yes | Third-party clause only |
| Yes | Yes | Self-task clause, then third-party clause |
| Neither | Neither | Empty suffix (site's headline stands alone, unchanged from today's behavior for a plain self-only alert with no task) |

---

## Files that will change

| File | Classification | Change |
|---|---|---|
| `lib/alertReadback.ts` (new) | Shared Logic | New pure function `buildAlertReadbackSuffix(actionConfig)` — takes the action_config's `tasks`/`to_name`/`to`/`body`/`task_actions` fields, returns the combined self-task + third-party clause(s) as a string. Pure, synchronous, no I/O — easy to unit test in isolation, matching the existing pattern of `lib/list_connections.ts`, `lib/maps.ts`, `lib/memory.ts`. |
| `hooks/useOrchestrator.ts` | Shared Logic (mobile write paths, Action Rules) | 5 call sites updated to call the new helper instead of their own ad-hoc suffix construction: `1609-1682` (pendingLocationRef commit, new/reactivated variants), `3890-3996` (memory-hit direct insert), `1748-1808` (clarification-memory-hit — currently has no naming logic at all), `389-456` `reArmLocationRule` + its 2 call sites (`3725-3728`, `3859-3886`), and `3696-3699`/`3859-3860` (merge-into-existing-alert paths, extended to also cover `task_actions` merging, which they don't handle today). |
| `tests/catalogue/session-2026-07-21-b10o-location-readback.ts` (new) | Test infra | Regression tests per Rule 15a — one positive-control test per site (5), covering both the fixed "new"/"reactivated" branches and the newly-covered clarification/re-arm/merge branches. |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | Docs | Close-out entry once shipped. |

**No other files change.** No Edge Function, no migration, no config change.

---

## Risk classification: Medium

Not **Low**: touches Protected Core (`hooks/useOrchestrator.ts`, Action Rules) across 5 call sites; a mistake in the shared helper has broader blast radius than a single-site patch would, since all 5 sites depend on it.

Not **High**: no database schema change, no new Edge Function, no change to what gets *written* to `action_rules` (the row content is already correct per Phase 1 — this only changes what's *said*). No fire-time behavior changes; `evaluate-rules`/`report-location-event`/`_shared/alert_body.ts` are entirely untouched.

---

## Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | Yes | `hooks/useOrchestrator.ts` (5 sites), new `lib/alertReadback.ts` |
| Voice | **No** | Confirmed structurally unable to reach this scenario (Phase 1A) — no `task_actions`/per-utterance `tasks` mechanism exists in voice's action_config model. Not an oversight; a verified non-applicability. |
| Shared Core | **No** | `naavi-chat`'s location branch never builds a post-confirmation message for location (Phase 1A) — nothing there to change. |
| Database | **No** | No schema or row-content change — this is a readback-text-only fix. |
| Cron | **No** | `evaluate-rules`/`report-location-event` fire-time logic untouched. |
| API contracts | **No** | No Edge Function request/response shape changes. |
| Tests | Yes | New regression tests required (Rule 15a). |

**Duplicated capability — will both implementations change?** Only mobile. Voice is excluded, with direct evidence from Phase 1A (no mechanism exists there to construct this scenario at all), not left blank on assumption.

---

## Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** No.
- **Does this change modify an Entry Point?** Yes — the mobile entry point (`hooks/useOrchestrator.ts`) — but stays within its legitimate job (translating an already-stored `action_config` into user-facing speech), adds no new business logic about what gets written to the database.
- **Does this change introduce new duplication?** No.
- **Does this change eliminate existing duplication?** Yes — 5 independent implementations of the same naming logic collapse into 1 shared helper. This is the explicit, justified design decision above.
- **Does this change modify Protected Core?** Yes — Action Rules (`hooks/useOrchestrator.ts` mobile write paths). Full Phase 1-8, already in effect for this entire work item.

---

## Regression Impact

| Area | Affected? |
|---|---|
| Voice commands | No — voice excluded, verified structurally unaffected |
| Geofencing | No — only creation-time confirmation text changes, not geofence arm/fire logic |
| Gmail integration | No |
| Calendar integration | No |
| Reminders (`reminders` table) | No — this touches location-alert `tasks`/`task_actions` fields on `action_rules`, a separate table/mechanism |
| SMS / call alerts | No, **at fire time** — the actual SMS Bob receives on arrival is built by `_shared/alert_body.ts` server-side, already correct per B10h/B10j, and is untouched by this change. Only the spoken/displayed confirmation *at creation time* changes. |
| Onboarding | No |
| Staging build | No structural impact — standard staging-first rollout applies |

---

## Regression Matrix (per-change consumer trace)

`buildAlertReadbackSuffix` is a **new** function — no pre-existing consumers to trace for a breaking-change risk. Its own consumer list (who will call it, going forward) is exactly the 5 sites enumerated above, confirmed complete by Phase 1A's full-file investigation of `hooks/useOrchestrator.ts`; no other file in the mobile codebase independently constructs this class of location-alert confirmation text.

---

## Status and next steps

Phase 2 complete. Risk classification is **Medium**, which per Governance §Phase 3 requires ChatGPT technical review before coding begins. Per the Phase-Gate Approval Rule, your own explicit go-ahead is required before Phase 3 starts, separately from that review's eventual verdict.
