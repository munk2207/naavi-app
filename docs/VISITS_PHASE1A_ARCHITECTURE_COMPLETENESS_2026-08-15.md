# Visits Flow Redesign — Phase 1A — Architecture Completeness Review

Status: DRAFT — for Wael's review. No code written. Scope per Phase 0 Amendment 2: Mobile only.

**Verification Provenance:** every claim below is tagged **"Freshly verified this session"** — a direct Explore-agent investigation was run specifically for this phase, with file:line citations from files actually opened and read. Nothing here rests on recalled/assumed behavior from before Phase 0.

**Architecture Reference version used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Architecture Version 2026.07.18.4 (per its own version block). No newer version exists as of this document.

---

## Required Phase 1A questions, answered directly

**What is the architectural owner of the affected capability?** The Mobile app (`munk2207/naavi-app`, client code under `app/`, `hooks/`) per the Architecture Reference's Ownership Model (§0a) — specifically `hooks/useConversationRecorder.ts` for the defect itself, and `hooks/useOrchestrator.ts` / `app/index.tsx` for the confirmation/resolution mechanisms this phase inventoried as candidates for reuse.

**Is the capability Shared Core, Duplicated, or Platform-specific?** Layered, not one answer:
- The extraction pipeline (`upload-conversation`, `poll-conversation`, `extract-actions`) is genuinely Shared Core (Phase 1 finding, unchanged).
- The *execution* of extracted actions (auto-creating calendar events) is confirmed Duplicated across Mobile and Voice (Phase 1 finding) — Voice's side is out of scope per Phase 0 Amendment 2, addressed below under "excluded implementations."
- **New this phase:** recipient/contact resolution *within Mobile itself* is not one mechanism but at least four structurally different ones, of differing quality (detailed below) — this is an internal-to-Mobile inconsistency, not a Mobile-vs-Voice duplication, but it directly bears on what "route through the same mechanism live chat uses" would actually mean.

**If duplicated, were all documented implementations investigated? If not, which were and which weren't?** Voice's implementation (`naavi-voice-server/src/index.js`'s `processCallRecording`, confirmed to exist in Phase 1) was **not** investigated in this phase — explicitly excluded, per Wael's Scope Amendment 2 decision, not by omission. Per the Architecture Scope Rule, this exclusion is named here, with its justification (mobile-only scope, external reviewer concurrence, Phase 0) rather than left silent.

**Does the documented problem scope match the Architecture Reference?** No — the Reference does not cover this capability at all (established in Phase 1, unchanged). This phase adds further detail the Reference doesn't have: the internal fragmentation of Mobile's own resolution mechanisms.

**Is any documented implementation excluded from the investigation?** Yes — Voice, per above. No Mobile-side implementation was excluded; the investigation covered every `lookup-contact`/`lookupContact`/`resolveRecipient`/`resolve-recipient` call site found by repo-wide grep, plus every execution primitive (calendar, email, SMS/WhatsApp) and confirmation mechanism.

---

## Inventory — what already exists on Mobile (freshly verified this session)

### Recipient/contact resolution — four structurally different mechanisms, not one

| Mechanism | File:line | Ambiguity handling |
|---|---|---|
| `lookupContact()` | `lib/contacts.ts:113` | **None** — returns a single `Contact \| null`. Tries `lookup-contact`, then three local fallback sources in sequence, each `.limit(1)`. Whichever hits first wins silently. |
| `lookupContactByPhone()` | `lib/contacts.ts:71` | None — first successful variant wins. |
| `resolveRecipient()` / `lookupRecipientCandidates()` | `lib/recipientLookup.ts:39-43, 75-87` | **Full 0/1/N handling** — the only client mechanism that preserves every match and lets the caller distinguish "ask," "readback," or "show a picker." |
| `resolve-recipient` Edge Function (server-side, distinct from `lookup-contact`) | called from `hooks/useOrchestrator.ts:3495-3499` | Has a real `ambiguous` branch, but blocks with "say their full name and I'll try again" (`3535-3538`) rather than showing a picker — a picker was planned (comment at `3465-3476`) but never wired in. |

`lookupContact()` (the no-ambiguity-handling one) is what almost every call site in `hooks/useOrchestrator.ts` actually uses — including the voice-confirm `PendingAction` builder (`4595, 4601`), the compound auto-send branch (`3235`), the bare "Yes" fallback (`1056, 1059`), and context-enrichment (`2068, 2120`). Only DraftCard's **email** path (`app/index.tsx:427`) uses the good one, `resolveRecipient()`.

**Implication:** "route Visits through the same mechanism live chat uses" is not a single well-defined target — most of live chat's own paths share the same single-match blind spot Visits currently has zero of. Only DraftCard-email and (partially) `SET_ACTION_RULE` have real disambiguation today.

### Confirmation — two independent mechanisms plus a UI gate, and one action type has neither

- **(a) Server-side, stateless:** `naavi-chat`'s `PENDING_INTENT` marker (multiple embed sites, e.g. `supabase/functions/naavi-chat/index.ts:1894`) + "Step 1.4" read-back (`index.ts:2257-2296`). Lives entirely in chat-history text; no server session object.
- **(b) Client-side, in-memory:** `hooks/useOrchestrator.ts`'s `pendingActionRef`/`PendingAction` (built `4616-4651`). **`CONFIRMABLE_ACTIONS` is `['DRAFT_MESSAGE']` only** (`lib/voice-confirm.ts:26`) — CREATE_EVENT and every other action type never uses this mechanism at all.
- **(c) UI-level:** DraftCard's own Send/Discard buttons (`app/index.tsx:440` `handleSend`) — the actual gate the user taps; a tap bypasses (b)'s `execute()` closure and re-resolves/sends independently.

**Key finding: CREATE_EVENT (the action type at the heart of the Visits defect) has no client-side confirmation wrapper in live chat either.** Its confirmation is entirely mechanism (a) — `naavi-chat` itself decides whether to ask "should I create this?" before ever emitting the CREATE_EVENT tool call; once the client receives it in `actions[]`, `hooks/useOrchestrator.ts:2541` executes it immediately, no further client gate. This means calendar events in live chat are *already* confirmed the same server-side way Visits would need — there is no separate client-side "CREATE_EVENT confirmable action" to reuse or build, because live chat doesn't have one either; the confirmation already lives upstream, in whether `naavi-chat` chooses to hand back the tool call at all.

**Re-entrancy correction (important — contradicts an assumption from before Phase 0):** the earlier (reverted) implementation guarded against `status === 'pending_confirm'`, believing `send()` silently no-ops in that state. Freshly verified: `hooks/useOrchestrator.ts:964`'s guard is real code, but **`setStatus('pending_confirm')` is never called anywhere in the current codebase** (zero grep matches) — hands-free mode, the only feature that used it, was removed in V57.11.3 (comment, `hooks/useOrchestrator.ts:715-718`). That guard is currently dead. The actual re-entrancy risk is different: if a `pendingActionRef` (mechanism b) is set and a new `send()` arrives with a message that isn't yes/no/a correction, the pending action is **silently discarded** (`hooks/useOrchestrator.ts:1036-1041`) with no warning. Any Visits fix that calls `send()` needs to account for *this* real behavior, not the dead guard the earlier draft was built around.

### Execution primitives

All calendar/email/SMS sends go through `AdapterRegistry` (`lib/adapters/registry.ts:117`) or direct `invokeWithTimeout` calls to Shared Core Edge Functions. Every live call site across the app is positioned inside a confirmed branch (behind DraftCard's tap, or mechanism a/b above) — **except** `hooks/useConversationRecorder.ts:422` and `:448`, the two calendar-creation calls that are this work item's actual defect, confirmed to be the only unconfirmed execution call sites in the entire mobile client.

### Existing precedent already inside Visits

Visits' own "Draft Email" button (`app/index.tsx:2570-2592`) already constructs a natural-language message from an extracted action and calls `send()` — reusing live chat's full pipeline successfully, today, in production. This is a working existence proof that Alternative A's core idea (construct a message, call `send()`) is viable for at least one action type already, in this exact codebase.

### Compound-turn detection — two different thresholds measuring two different things

- Server-side (`supabase/functions/naavi-chat/index.ts:3592-3593`): counts non-empty (>8 char) lines in the **user's outbound message**, triggers compound planning at **≥4**.
- Client-side rendering (`hooks/useOrchestrator.ts:4434`): re-derives "was this compound" from the **assistant's response** (`compoundBreakdownLines.length >= 3 && dedupedActions.length >= 3`), independently, at a **different threshold (3)**.

These can disagree. A Visits-constructed message needs to be evaluated against the server-side ≥4 threshold specifically (confirmed still accurate, current lines cited above) — this matches Phase 1's finding, now confirmed against current code rather than the pre-Phase-0 recollection.

### Dead code noticed in passing (not part of this work item, flagged for visibility only, per Governance §0.3's "report separately, don't fix silently")

- `registry.contacts` (`lib/adapters/google/contact.adapter.ts`) — zero call sites anywhere in the client.
- `buildQueueStep()` (`hooks/useOrchestrator.ts:740-947`) — zero call sites; leftover from a removed client-side compound buffer (comment, `2053-2060`).
- The `status === 'pending_confirm'` guard (`hooks/useOrchestrator.ts:964`) — unreachable, per the re-entrancy finding above.

---

## What this means for Phase 2 (not decided here)

This phase doesn't choose between Alternatives A/B/C — that's Phase 2/3. What it does establish, as fact rather than assumption, for whoever writes Phase 2:

1. Calendar-event confirmation in live chat is purely server-side (`naavi-chat`'s own decision to withhold or emit the tool call) — there is no client-side "confirmable CREATE_EVENT" wrapper to point Visits at. Alternative A, for the calendar-event part of the defect specifically, means "get `naavi-chat` to treat a Visits-derived request the same way it treats a live one" — not "wire Visits into an existing client confirmation object," because no such object exists for this action type.
2. Recipient resolution is not uniformly good even within live chat today — most paths share Visits' current blind spot (single match, no disambiguation). Whichever alternative Phase 2 proposes, it should say explicitly which resolution mechanism (the good one, `resolveRecipient`, or the blind one, `lookupContact`) a Visits-derived request would actually end up using, not assume "the live chat one" is a single well-defined thing.
3. Visits' own email flow already proves the `send()`-reuse approach works for at least one action type, in this exact codebase, today — real precedent, not a hypothetical.

## Excluded implementation, restated per Architecture Scope Rule

Voice's `processCallRecording` (`naavi-voice-server/src/index.js:5881`) has the identical unconfirmed-execution defect (Phase 1 finding). It is explicitly out of scope for this work item (Phase 0 Amendment 2) and was not investigated in this phase. It remains untracked as a separate item as of this document — that follow-up action is still owed.
