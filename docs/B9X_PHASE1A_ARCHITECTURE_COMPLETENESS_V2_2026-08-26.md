# B9x — Phase 1A: Architecture Completeness Review (v2 — creation path)

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-26 |
| **Phase 0** | `B9X_PHASE0_INTENT_APPROVAL_V3_2026-08-26.md` — approved 2026-08-26 |
| **Phase 1** | `B9X_PHASE1_PROBLEM_DEFINITION_V2_2026-08-26.md` — approved 2026-08-26 (reviewer: APPROVED, no blocking findings) |
| **Supersedes** | `B9X_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-08-26.md` (fire-time scope) |
| **Status** | Awaiting review. **No code written.** |

---

## 0. Architecture Reference Version Verification

| | |
|---|---|
| **Version used** | **2026.07.18.12** (revision 12) |
| **Last commit** | `0e20f8a`, 2026-08-26 — the revision 12 correction made during this item's first Phase 1A |
| **Newer version?** | **No.** Verified by `git log` on the file this session. |

Re-confirm before Phase 8 merge.

---

## 1. ⭐ Headline finding — mobile has **three** location-creation paths, and **two** skip recipient resolution

B9x's holding-list row names one (`hooks/useOrchestrator.ts:862-917`). Searching rather than
recalling found three, all inserting `trigger_type: 'location'` directly into `action_rules`:

| # | Path | Insert label | Resolves the recipient? |
|---|---|---|---|
| 1 | `useOrchestrator.ts:914` | `cq-insert-location-rule` — compound / numbered requests | **No.** Calls `resolve-place` for the *place* (`:902`) and inserts `action_config: ac` verbatim. No `resolve-recipient`, no `lookup-contact`. |
| 2 | `useOrchestrator.ts:1516` | `insert-location-rule` — place-picker / pending commit | **No.** Resolves `tasks` → `task_actions` (F5c, `:1506`) — the *attached* third-party sends — but the **primary** recipient passes through untouched via `baseActionConfig` (`:1509`). |
| 3 | `useOrchestrator.ts:3996` | main `SET_ACTION_RULE` handler | **Yes.** Calls `resolve-recipient` at `:3493-3499` with a `recipientBlocked` guard, and honours `hasSelfOverride` first. **Correct.** |

**Path 2 was not previously identified by any document.** It is the ordinary place-picker flow — the
one a user hits when Naavi offers a choice of locations — which makes it at least as reachable as
path 1.

**This is the strongest architectural argument for the Phase 0 v3 scope.** One change in
`naavi-chat` covers all three paths at once. Changing mobile would mean changing two places and
trusting that no fourth path is ever added — the pattern that produced this defect in the first
place.

---

## 2. The six mandatory questions

### 2.1 Architectural owner
**Shared Core** — `munk2207/naavi-app/supabase/functions/*` (Reference §0a). The change lands in
`get-naavi-prompt` and `naavi-chat`.

### 2.2 Shared Core, Duplicated, or Platform-specific?
**Duplicated — two independent implementations.** Capability: *Action Rules — creation (the
classifier)*, Reference §2 / §2a, **Priority 1, ADR 0001** — the single most important duplication in
the system.

**This defect is that duplication, in the direction §2a did not anticipate.** §2a warns that *"a bug
fixed in mobile's alert-creation classifier does not fix voice's, and vice versa."* Here the correct
behaviour was built on voice and never reached the shared server the mobile surface depends on.

### 2.3 Were all documented implementations investigated?
**Yes — four, plus a sweep for undocumented ones.** Voice (1 path), mobile (3 paths), `naavi-chat`,
and Layer 2. Details and provenance at §3.

### 2.4 Which were investigated, which were not?
All were. Nothing is excluded from *investigation*; two things are excluded from *change* — §2.6.

### 2.5 Does the problem scope match the Architecture Reference?
**Yes, with one row that needs a note — not a correction.** §2b's Location row now reads *"Yes at
creation time — one function, used by mobile and voice (2 call sites)"* (revision 12, made during
this item's earlier Phase 1A).

That remains **true and is not being changed**: `resolve-recipient` *is* the one shared resolver, and
it *is* called by both surfaces. What §2b does not say — and what a reader would not infer — is that
**mobile has three creation paths and only one of them calls it.** Proposed as an addition to the
Reference at §5, **not applied**.

### 2.6 Is any implementation excluded from the change?
**Yes — two, deliberately:**

- **Voice (`src/index.js:12613-12655`)** — excluded because it is **already correct**, not because it
  is out of reach. Verified below. Excluding it is a finding, not an omission.
- **Mobile paths 1 and 2** — excluded because the Shared Core fix covers them without touching mobile
  code (`naavi-chat:4176-4177` states the gate runs before the orchestrator sees the action).

---

## 3. Cross-Repository Verification Rule

Every bullet tagged per the Verification Provenance Rule.

### 3.1 Voice — **already correct, no change required**

`naavi-voice-server/src/index.js:12613-12655`. **Freshly verified this session** — direct read.

- Name present, no address → calls `resolve-recipient` (`mode: 'create'`)
- `ambiguous` → *"You have more than one contact named X — say their full name and I'll try again."* → **does not save**
- `not_found` / `invalid` / default → *"I don't have a contact named X…"* → **does not save**
- call throws → *"I couldn't verify that contact right now."* → **does not save**
- `hasSelfOverride` short-circuits first (`:12608-12612`) — a self-alert is never treated as third-party

**This satisfies Phase 0 v3's User Intent as written.** No voice gap found on this path. Per the
Architecture Scope Rule this is stated explicitly rather than left silent.

### 3.2 Shared Core — **the gap**

- `naavi-chat/index.ts:179` (`convertLocationToolToActionRule`) passes `action_config` through
  unexamined. **Freshly verified this session.**
- `naavi-chat` **never calls `resolve-recipient`** — one occurrence across
  `supabase/functions/naavi-chat/*.ts`, a comment at `:2013` about `useOrchestrator`'s call.
  **Freshly verified this session.**
- The RULE 23 server gate (`:4179`, `:4195-4204`) **exempts both location tools**.
  **Freshly verified this session.**
- `get-naavi-prompt:1215` states *"the server resolves the contact."* **Freshly verified this
  session.** The claim is true of voice and false of the mobile-facing server.

### 3.3 Layer 2 (the deterministic classifier) — **not involved**

`naavi-chat/intentHandlers.ts` contains **no** location handling — a grep for `location` returns
nothing. **Freshly verified this session.** Location alerts always route through Path B (Claude
tool-use), so there is no second Shared Core creation path to keep in step.

### 3.4 Mobile — three paths, two unresolved

**Freshly verified this session** by direct read of all three insert sites. Table at §1.

---

## 4. Recorded, not acted on

**All three mobile paths INSERT into `action_rules` directly from the client.** CLAUDE.md's Data
Integrity Layer 2 requires all writes to a config table to flow through one Edge Function, and Layer
3 requires RLS to block direct client writes. This is a pre-existing condition, unrelated to B9x's
symptom, and **entirely out of scope**. It is recorded here as description only — **no tracked item
has been created, which under Rule 1b is Wael's decision.**

---

## 5. Proposed Architecture Reference addition — **not applied**

§2b's Location row is accurate about `resolve-recipient` being shared. It does not convey that
mobile's use of it is partial. Proposed addition to that cell:

> **Mobile calls it from one of its three location-creation paths.** `useOrchestrator.ts:3996`
> resolves and blocks; `:914` (compound) and `:1516` (place-picker commit) insert the recipient
> unresolved.

**Not applied** — Wael is the Architecture Owner. If B9x's fix moves resolution into `naavi-chat`,
this cell changes again at Phase 8, and it may be cleaner to make one edit then. Raised now so the
choice is deliberate.

---

## 6. Independent Review Rule

| Review | Status |
|---|---|
| Technical Investigation (Phase 1 v2) | **APPROVED** 2026-08-26 — no blocking findings |
| Architecture Completeness (this document) | **PASS**, with one constraint carried into Phase 2 |

**The constraint, from the Phase 1 reviewer and consistent with Phase 0 v3's Success Criteria 2 and
3:** the remedy must add no confirmation friction to genuine self-alerts, or to recipients Naavi can
already identify. *"Alert me at Costco"* and *"text my wife when I leave the office"* (wife in
contacts) must both remain single-turn. **Only the genuinely unidentifiable recipient may produce a
question** — which is exactly what voice already does.

---

## 7. Not decided here

The remedy is Phase 2's, reviewed at Phase 3 before code exists. **Rule 17 remains open** — no live
fire observed. Wael's decision, outstanding.
