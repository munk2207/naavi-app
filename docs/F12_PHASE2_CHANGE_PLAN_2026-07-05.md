# F12 — Phase 2: Change Plan (REVISED)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. No code written in this document. Builds on `docs/F12_PHASE1_PROBLEM_DEFINITION_2026-07-05.md` (Defects A and B, architectural precedent in §3). Revised after external technical review of the first draft — see §7 for what changed and why.

**Governing decision from Wael (2026-07-05):** recipients use a **live reference**, not a snapshot. A named-contact recipient is re-resolved at fire time, not frozen at creation time. This diverges from the place precedent deliberately — places are immutable, contacts are not.

---

## 1. Recipient Resolver — a first-class component, not a procedure

Every caller (mobile, voice, `evaluate-rules`) uses one shared contract instead of each implementing its own literal-detection and contact-lookup logic. This directly addresses the duplication concern from Phase 1 §3/§4 — `executeDraft()`'s inline regex check should not become a third independent copy.

**Component:** `supabase/functions/resolve-recipient/index.ts` (new Edge Function, same shape as the existing `resolve-place` precedent — stateless, no DB writes, caller persists the result).

**Input differs by mode, not a single generic shape:**
- **`create` mode:** `{ to: string, user_id: string }` — `to` is the raw spoken/typed value, resolved for the first time. A human is present, so `ambiguous` can be resolved conversationally (a picker, matching the existing `DRAFT_MESSAGE` precedent below).
- **`fire` mode:** `{ contact_id: string, user_id: string, to_name?: string }` — re-resolution uses the canonical `contact_id` first; `to_name` is consulted only as a fallback if the ID-based lookup fails (e.g. to distinguish "renamed" from "deleted," per §1's `resourceName` note). Nobody is present to ask, so `ambiguous` resolves to a distinct failure state (§3) instead of a picker.

**Identity hierarchy — stated explicitly so it is never treated as interchangeable fields:**
- **`contact_id`** (the People API `resourceName`) is the canonical identity. It is what `fire` mode re-resolves against.
- **`to_name`** is a human-readable display label and the fallback lookup key — used for speech/UI ("texting Bob") and as the fire-time fallback if `contact_id` lookup fails.
- **`to_email`/`to_phone`** are transient, resolved delivery targets — always re-derived at fire time from `contact_id`/`to_name`, never treated as durable identity themselves.

**Output — one of:**
- `{ kind: 'literal_email', value }` — `to` already matches an email pattern. Nothing to look up.
- `{ kind: 'literal_phone', value }` — `to` already matches a phone pattern. Nothing to look up.
- `{ kind: 'resolved_contact', name, email, phone, contact_id }` — exactly one confident match.
- `{ kind: 'ambiguous', candidates: [...] }` — 2+ matches, no single confident pick.
- `{ kind: 'not_found' }` — no match.
- `{ kind: 'invalid' }` — empty or unusable input.

**`lookup-contact` remains the People API adapter. `resolve-recipient` is the sole consumer-facing resolution service** — mobile, voice, and `evaluate-rules` call `resolve-recipient` only; none of them call `lookup-contact` directly once this ships. This mirrors the existing split between `resolve-place` (decision layer) and the Google Places API (raw data) already standardized in this codebase.

**One small required change to `lookup-contact/index.ts`:** it already fetches each candidate's Google `resourceName` (a stable per-contact ID) internally, but drops it before returning — the response shape only carries `name/email/phone/addresses`. Add `contact_id: resourceName` to the returned shape. Without this, a live reference can only be keyed by name, which breaks silently if the contact is renamed (a rename looks identical to "not found" from a name-only lookup). With it, `resolve-recipient` can store `contact_id` as the primary re-lookup key at fire time, falling back to `to_name` only if the ID-based lookup 404s (to be confirmed in Phase 4: does a deleted `resourceName` return 404 or an empty result from the People API — determines whether "deleted" and "renamed" are distinguishable or both collapse to `not_found`).

## 2. Ambiguous contacts — grounded in existing precedent, not invented policy

`lookup-contact/index.ts`'s own code comment: *"Caller picks best (single match) or shows a picker (multi). Used by the recipient-resolution chain in Session 26 — DraftCard needs every match for the picker UI."* Multi-match handling for `DRAFT_MESSAGE` already exists; it was simply never extended to `SET_ACTION_RULE`.

- **At `create` time:** `resolve-recipient` returning `ambiguous` triggers the same picker pattern already shipped for `DRAFT_MESSAGE` — surface the candidates, let the user pick, store the winning `contact_id`/`name`. Not a new UX pattern, reuse of an existing one.
- **At `fire` time:** `ambiguous` is treated identically to `not_found` — a distinct, honest failure (§3), never a silent pick of "whichever came back first." Picking silently at fire time would reintroduce exactly the class of bug this investigation started from (Naavi acting confidently on an unverified guess).

**Multi-email/phone-per-contact policy (the "Bob has two emails" question):** current code (`lookup-contact/index.ts`, `email: person.emailAddresses?.[0]?.value ?? null`) silently takes array index 0 — it never checks Google's `metadata.primary` flag, which the People API does expose per email/phone entry. This is an existing, undocumented behavior, not a considered policy. **Proposed fix, included in this plan:** prefer the entry with `metadata.primary === true`; fall back to index 0 only if no entry is flagged primary. Small, targeted, directly motivated by what the API already provides — not a new design invented from nothing.

## 3. Distinct failure states at fire time (unchanged from first draft, restated for completeness)

`evaluate-rules::fireAction()` must not collapse `not_found` or `ambiguous` into the existing `noRecipient → self-alert` branch — that branch means "no recipient was ever specified," which is a different event from "a recipient was specified and became unresolvable." Per CLAUDE.md's no-silent-failures and no-false-claims rules, the response is: log loudly, self-notify the user that the intended send could not be completed and why (contact not found / became ambiguous), and never claim a send happened when it didn't.

## 4. Optimistic cache — deferred, not designed in

The first draft proposed keeping mobile's existing eager `to_phone`/`to_email` snapshot as a fire-time fallback if the live lookup failed. On review, there's no evidenced reason for it — no established API rate-limit problem, no offline requirement for `evaluate-rules` (always-online cron), no measured latency issue. **Deferred entirely.** Mobile can keep snapshotting `to_phone`/`to_email` at creation for its own immediate uses (e.g. a confirmation card showing "texting Bob at 613-xxx-xxxx" right after creation) — that's unrelated to fire-time behavior. But `evaluate-rules` does not consult it as a fallback in this phase; a failed live resolution goes straight to the §3 failure path. If a real, measured performance or quota problem shows up after shipping, that's evidence-driven grounds to revisit — not something to design against speculatively now.

## 5. Files that will change

| File | Classification | Change |
|---|---|---|
| `supabase/functions/resolve-recipient/index.ts` | Backend (**new file**) | New shared resolver per §1. |
| `supabase/functions/lookup-contact/index.ts` | Backend | Add `contact_id: resourceName` to the returned contact shape (§1). Prefer `metadata.primary` over index-0 for email/phone selection (§2). |
| `hooks/useOrchestrator.ts` | Shared Logic | Replace the inline `lookupContact(toName)` call in the `SET_ACTION_RULE` resolution step (~3230-3245) with a call to `resolve-recipient` (`mode: 'create'`), handling all six output kinds, including the `ambiguous` picker (reusing the existing `DRAFT_MESSAGE` picker UI pattern). Fix Defect B: extend `hasNewContent` (~3403-3435) to treat `to`/`to_name`/`to_email`/`to_phone`/`contact_id` changes as mergeable. Fix the missing 3rd argument on `reArmLocationRule(supabase!, match)` at line 3442. |
| `supabase/functions/manage-rules/index.ts` | Backend | Extend `merge_tasks` / merge-update handling so recipient fields (`to`, `to_name`, `to_email`, `to_phone`, `contact_id`) are written when Defect B detects destination-only changes. Required downstream write-path counterpart to the approved `useOrchestrator.ts` merge-check change. |
| `naavi-voice-server/src/index.js` | Shared Logic | Same `resolve-recipient` call replacing the absent resolution step in the main handler (~4694-4714) and location branch (~11183-11360) — this is the bigger gap, since voice has no resolution today (Phase 1, Evidence A3). Fix Defect B's voice equivalent (~11321-11343) to also check destination fields, and its `pendingNoteUpdate` consumption to apply them. |
| `supabase/functions/evaluate-rules/index.ts` | Backend (Protected Core) | New step in `fireAction()`: if `action_config.contact_id` is present, call `resolve-recipient` in `fire` mode with `{contact_id, user_id, to_name}` (`to_name` as fallback only, per §1's identity hierarchy) before the existing `toPhone`/`toEmail` read (~656-657). Route `not_found`/`ambiguous` to the new distinct failure path (§3), never the existing `noRecipient` branch (~745-746). |
| `tests/catalogue/*.ts` (new file) | Testing (Rule 15a) | New regression tests, see §6. |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, memory | Documentation | Update on completion. |

**Still no changes needed:** `supabase/functions/_shared/anthropic_tools.ts` (schema untouched, §1 of Phase 1), any DB migration (JSONB `action_config` absorbs `contact_id` with no schema change), mobile build config, voice-server Twilio webhook routes.

## 6. Risk classification

| Change | Risk | Why |
|---|---|---|
| Defect B fix (merge-check extension, both surfaces) | **Low** | Localized, additive, easily testable, no dispatch change. |
| New `resolve-recipient` Edge Function | **Medium** | New but isolated component; wraps existing, working `lookup-contact` rather than reimplementing Google auth. |
| Mobile/voice `SET_ACTION_RULE` resolution replaced with `resolve-recipient` calls | **Medium** | Touches the alert-creation write path on both surfaces; voice in particular goes from "no resolution at all" to "resolution exists," a larger behavioral change there than on mobile. |
| Fire-time re-resolution in `evaluate-rules::fireAction()` | **High** (raised from Medium-High on review) | This is Protected Core — the single dispatcher for every trigger type, not just location. Adding a new external dependency (a live contact lookup) inside dispatch changes execution semantics for the whole function, not just the third-party-recipient case. The new failure states (`not_found`/`ambiguous`) must be correct on first attempt, given the prior outbound-false-claim incident this project has already had. |

This plan satisfies governance (Protected Core changes get full review before code), deterministic behavior (every decision — literal vs. name, single vs. ambiguous, found vs. not-found — is made by code against a defined contract, never left to model judgment or silent fallback), and the lifecycle decision Wael made (contacts are re-resolved live, so the design is built around a resolver called twice — once to validate at creation, once authoritatively at fire time — rather than a single resolve-and-freeze step).

## 7. Revision history

- **2026-07-05, first draft:** established the literal-vs-named split, no-schema-change conclusion, and the distinct-failure-state principle, following Wael's live-reference decision.
- **2026-07-05, this revision** (after external technical review): introduced the `resolve-recipient` component as an explicit, named, single shared contract rather than describing resolution procedurally across three files; added ambiguous-contact handling, grounded in the existing `DRAFT_MESSAGE`/`lookup-contact` picker precedent (Session 26) rather than invented from scratch; defined the multi-email/phone selection policy (prefer `metadata.primary`, currently silently ignored) grounded in what the People API already exposes; deferred the optimistic-cache proposal entirely for lack of evidenced need; added `resolve-recipient` and the `lookup-contact` edit to Files Changed so the shared resolver is a real, trackable component; raised fire-time re-resolution from Medium-High to High risk; removed the "lowest-risk direction" comparison language — Wael already chose live-reference, so this plan justifies the chosen design rather than ranking it against abandoned alternatives.

- **2026-07-05, this pass** (after a further external review round, approved with minor clarifications): split the resolver's input contract explicitly by mode (`create` takes raw `to`; `fire` takes `contact_id` with `to_name` as fallback only) rather than one generic shape; stated the identity hierarchy explicitly (`contact_id` = canonical identity, `to_name` = display label/fallback key, `to_email`/`to_phone` = transient resolved delivery targets, never durable identity); tightened the `lookup-contact`/`resolve-recipient` ownership wording to make `resolve-recipient` the sole consumer-facing entry point.
- **2026-07-06, governance correction — Phase 4 implementation note:** `manage-rules/index.ts` was added to §5 after implementation revealed it is the existing write path behind `useOrchestrator.ts`'s merge operation. This is not a new design direction; it is the required persistence counterpart to the already-approved Defect B fix. Reported as an unlisted file per governance rather than silently folded in. Wael flagged the gap directly ("i do not start parallel fixes that break our governance"). No other file outside §5's original list was touched during this tier.

## 8. Phase 3 — Technical Review (Before Coding)

**Complete.** The multi-round external technical review conducted throughout Phase 1 and Phase 2 (architectural precedent identification, `resolve-recipient` contract, ambiguity handling, identity hierarchy, risk reclassification) constitutes this plan's Phase 3 review. Wael confirmed 2026-07-05: approved, proceed.

## 9. Phase 4 progress (updated 2026-07-06)

**Done, tested, committed, deployed to staging:**
- Defect B fix (Low risk) — `useOrchestrator.ts`, `naavi-voice-server/src/index.js`, `manage-rules/index.ts`. 5 regression tests passing. Main repo commit `201914f` (`origin/main`); voice-server commit `8167d78` (`origin/staging`); `manage-rules` deployed to staging Supabase project (`xugvnfudofuskxoknhve`).
- `resolve-recipient` + `lookup-contact` `contact_id` support (Medium risk component, built standalone per Wael's explicit "zero-risk" instruction — **not wired to any caller yet**, guarded by its own test asserting that). 6 regression tests passing. Both deployed to staging; smoke-tested post-deploy (see `docs/F12_PHASE4_EVIDENCE_2026-07-06.md`).

**Done, tested, NOT yet committed or deployed (2026-07-06):**
- Mobile wiring — `useOrchestrator.ts`'s `SET_ACTION_RULE` resolution now calls `resolve-recipient` (create mode) instead of the ad hoc `lookupContact`. Ambiguous/not_found fail closed (block the rule, ask user to clarify) rather than the interactive picker the plan originally described — no such picker was found wired into this function; see the Evidence Package's scope note.
- Voice wiring — both the main (non-location) handler and the location branch now call `resolve-recipient` (create mode). Voice previously had zero destination resolution (Phase 1, Evidence A3) — this is the larger of the two surface changes.
- `evaluate-rules` (High risk, Protected Core) — `fireAction()` now re-resolves a `contact_id`-based recipient fresh at fire time (`resolve-recipient`, fire mode), per Wael's live-reference lifecycle decision. A distinct `recipientUnresolvable` failure path self-notifies honestly and returns `true` (fully evaluated) — verified by test to be checked and to return *before* the `noRecipient` self-alert branch, so it can never fall through to it.
- 7 new regression tests (`tests/catalogue/session-2026-07-06-f12-high-risk-wiring.ts`); 1 pre-existing test (`note-update.enabled-branch-offers-update`) updated after a source-text-only break (runtime behavior unchanged, confirmed before editing).
- **Full regression suite run: 377 passed, 0 failed, 0 errored, 2 skipped (pre-existing, unrelated OAuth token gaps).**

**Committed and deployed to staging (2026-07-06):** main repo `b034e10` (`origin/main`); `naavi-voice-server` `5ada02b` (`origin/staging`); `evaluate-rules` deployed to staging Supabase project (`xugvnfudofuskxoknhve`). Production untouched throughout — no production deploy for any F12 tier.

**All three tiers of this Change Plan are now implemented, tested, committed, and deployed to staging.** Manual staging validation (3 scenarios in `docs/F12_PHASE4_EVIDENCE_2026-07-06.md`) and production promotion remain — production promotion requires Wael's separate explicit approval per CLAUDE.md's staging-first rule, not implied by this deploy.
