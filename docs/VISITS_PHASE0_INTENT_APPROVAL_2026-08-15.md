# Visits Flow Redesign — Phase 0 — Intent Approval

Status: APPROVED (2026-08-15), then amended twice (2026-08-15) — see Scope Amendment and Scope Amendment 2 below. Current effective scope is **Mobile only** — Amendment 2 supersedes Amendment 1's expansion.

---

## Scope Amendment 2 (2026-08-15) — supersedes Amendment 1's expansion, narrows back to Mobile

After Amendment 1 (below), Wael discussed the scope question with the external reviewer (ChatGPT, per Governance §1) and decided: **this work item stays Mobile-only.** Voice's independently-implemented matching defect (found in Phase 1 — `naavi-voice-server/src/index.js`'s `processCallRecording`) is **not fixed by this work item.**

**This is not the defect being dropped or forgotten** — it must be tracked as its own separate, explicit item (the same way this project already tracks other known Mobile/Voice divergences — e.g. ADR 0003 / holding-list item `B10l` for the Reminders write-path divergence). Recording it that way is a follow-up action, not yet done as of this document.

Amendment 1's text is left below, struck through in spirit but not deleted, per this project's own preference for recording supersession rather than silently erasing history (mirroring the Governance document's own Rule-Removal Requirement, §9, applied here by analogy even though this is a project doc, not the governance doc itself).

---

## Scope Amendment 1 (2026-08-15) — SUPERSEDED by Amendment 2 above, kept for the record

Phase 1's investigation established that the Visits conversation-recorder capability has **two independent execution implementations, Mobile and Voice.** The work item's scope is therefore **expanded to cover both implementations**, so that confirmation and recipient-resolution requirements are satisfied consistently across both entry points.

**No implementation approach is authorized by this amendment.** Alternatives A, B, and C (Phase 1) remain undecided; Phase 1A's job is to map what confirmation, recipient-resolution, pending-intent, and execution primitives already exist on both runtimes before any shared-boundary design is proposed in Phase 2.

Everything else in Phase 0 below (Out of Scope, Constraints, Completion Criteria) stands unchanged except where this amendment explicitly widens it.

---

## Clear statement of what has happened so far (before this document)

So Wael has the full, honest picture before approving anything:

1. Earlier this session, real bugs were found and fixed in the Visits conversation-recorder feature (Draft Email button gating, Edge Function logging, a `speechStartTick` timing fix for a scroll bug) — those were shipped to staging as build 323, are committed, and are **not** part of this Phase 0.
2. Separately, Wael raised an architectural concern: the Visits flow doesn't behave like the live voice/chat assistant — it auto-creates calendar events with no confirmation and no contact resolution, unlike everything else in the app.
3. Claude investigated this (read-only) and, using its own internal planning tool (not this governance process), designed a redesign: route Visits' extracted actions through the same `send()`/`naavi-chat` pipeline the live assistant already uses.
4. Claude then **wrote real code implementing part of that design** — a change to `confirmSpeakers()`'s return type in `hooks/useConversationRecorder.ts`, a new message-builder and `send()` call in `app/index.tsx`, and a new spoken-message constant in `lib/voice-confirm.ts` — **before** any of the governance process below had run.
5. Wael caught this ("I thought that you are investigating not coding") and asked to revert and restart properly through this document.
6. That code has been reverted. Confirmed via `git status` — `app/index.tsx`, `hooks/useConversationRecorder.ts`, `lib/voice-confirm.ts`, `components/ConversationActionCard.tsx`, and `supabase/functions/extract-actions/index.ts` all match the last commit exactly, with no uncommitted changes. Nothing was lost — the design and the code both still exist in conversation history if anything from them turns out to be the right answer once this process actually approves an approach.

**Why this matters for Phase 0:** the investigation already done (described above, and in more detail in Phase 1) is real and useful — it should inform this document. But nothing from it is authorized. Phase 0 starts the actual clock; no code gets written again until Phase 3 clears it.

---

## User Intent

The Visits conversation-recorder feature (record a multi-speaker conversation, e.g. Robert + his doctor, and extract action items from it) should handle confirmation and contact resolution the same way the live voice/chat assistant already does — instead of silently creating calendar events with no review and no attempt to verify who a recipient actually is.

## Success Criteria

- No calendar event, medication schedule, or any other state-changing action from a Visits recording is created without the user confirming it first — matching how every other part of the app already works (CLAUDE.md Rule 12).
- When a Visits recording references someone not clearly resolvable to a real contact, Naavi asks a clarifying question — matching how live voice/chat already behaves today ("this is working good," per Wael).
- Nothing about what gets *transcribed* changes — a separate, already-diagnosed limitation (see Out of Scope).

## In Scope

- How the Visits flow *executes* what it extracts from a conversation (currently: direct, silent auto-creation in `hooks/useConversationRecorder.ts`).
- The UI that currently shows extracted items as standalone cards (`components/ConversationActionCard.tsx`), to the extent execution changes make it redundant.
- `app/index.tsx`'s wiring between the Visits flow and the existing chat pipeline (`send()`).
- ~~(Added by Scope Amendment 1) The equivalent path on the voice server~~ — **removed by Scope Amendment 2.** See Out of Scope below.

## Out of Scope

- Fixing AssemblyAI's transcription/diarization corruption (a real, separate, already-investigated bug this session — a spoken email address was dropped entirely by the speech-to-text step; confirmed as a vendor limitation, not something in Naavi's code — closed earlier this session, not reopened here).
- Any change to `naavi-chat`'s own prompts, tools, or classification logic — this work is explicitly about *reusing* that system as-is, not modifying it.
- The separate, still-unresolved bug where a drafted email intended for `abc@gmail.com` was actually delivered to Robert's own inbox — a distinct investigation, paused mid-way this session, not part of this work item.
- **(Added by Scope Amendment 2)** The voice server's independently-implemented matching defect — `naavi-voice-server/src/index.js`'s `processCallRecording` (line ~5881) and its own calendar auto-creation loop (line ~5971-6100). Confirmed to exist (Phase 1), deliberately not fixed here, and must be tracked as its own separate item rather than silently dropped — not yet done as of this document.
- Production deployment of anything from this work — stays staging-only, per standing project rule, until Wael explicitly says otherwise.
- Any change to build 323's already-shipped fixes (Draft Email gating, Edge Function logging).

## Constraints

- Staging-first — no production Edge Function deploy, no production AAB, for any part of this work.
- No changes to Shared Core (`naavi-chat`, `extract-actions`) logic — reuse only. If Phase 1 investigation finds a reuse-only approach is genuinely not viable, that itself must come back through Phase 0 as a scope change before proceeding, not be decided mid-implementation.
- Full governance process — Phase 0 through Phase 8, including external (ChatGPT) review at Phase 3 (before coding) and Phase 6 (after coding), since this touches Calendar integration, which is Protected Core per §4.
- **(Added 2026-08-15, external reviewer condition, relayed by Wael)** Phase 2 must not introduce any new Shared Core mechanism whose design is justified mainly by the future Voice problem. The architecture should be optimized for the approved Mobile-only scope, while not gratuitously making a later Voice convergence harder than it has to be — but "might help Voice later" is not, by itself, a valid justification for a Shared Core component in this work item.

## Completion Criteria

- Phases 0 through 8 of `docs/AI_DEVELOPMENT_GOVERNANCE.md` completed for this work item, with Wael's explicit separate approval at every phase transition.
- A real Visits recording, tested on a staging build, demonstrably shows: no auto-created calendar event without confirmation, and a clarifying question when a recipient can't be resolved — verified live, not just by code review.
