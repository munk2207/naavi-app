# B10r — Phase 1A (Addendum 2 scope): Architecture Completeness Review

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.7, Phase 1A — including the new **Verification Provenance Rule** (every Cross-Repository Verification claim below is tagged as freshly verified this session or relying on the Reference without a fresh check). Scope: only Addendum 2's new work (`supabase/functions/global-search/adapters/calendar.ts`, year-stripping for recurring birthday/anniversary events). The original B10r scope's Phase 1A (`contacts.ts`, `get-naavi-prompt`) already passed and is not reopened here.

No code was written in producing this document.

---

## 1. Architecture Reference Version Verification

**Version used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, v2026.07.18.4 — **freshly verified this session**: re-globbed `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE*`, only one file exists, same date/version as every prior phase in this work item. No newer version to reconcile against.

---

## 2. Capability ownership and classification

**What is the architectural owner?** Per Architecture Reference §0a: **Shared Core** (`munk2207/naavi-app/supabase/functions/*`). `calendar.ts` is one adapter inside the `global-search` Edge Function.

**Is the capability Shared Core, Duplicated, or Platform-specific?** **Shared Core, genuinely shared — freshly verified this session, not inherited from the Reference.** Grepped `naavi-voice-server/src/index.js` for `global-search`: confirmed 3 separate call sites (`fetchGlobalSearch()` at line 1291, a postal-code lookup at line 2441, and Claude's own `GLOBAL_SEARCH` tool-call handler at line 4641) — voice calls the identical `global-search` Edge Function mobile does, not a separate reimplementation. This is the same conclusion the original `contacts.ts` Phase 1A reached for the Global Search capability generally, now independently re-confirmed for the `calendar.ts` adapter specifically.

**Important distinction, freshly verified — do not confuse with the Reference's existing "Calendar reads (live event fetch)" duplication entry (§2, §5 Priority 2):** that entry is about a *different* mechanism — `fetchLiveCalendarEvents()`, called independently by both `naavi-chat/index.ts` (mobile) and `naavi-voice-server/src/index.js` (voice) to build the system prompt's "Schedule" context section. Confirmed by direct read: voice's own call at `index.js:2995` (`fetchLiveCalendarEvents(userIdOverride)`) is a separate function from `global-search/adapters/calendar.ts`. The Reference's accepted duplication (ADR 0002) applies to *that* mechanism, not to the Global Search adapter this addendum modifies. Conflating the two would have wrongly implied this fix needs to touch a duplicated pair — it does not; `calendar.ts` itself is genuinely shared.

**New finding, not previously documented — freshly verified this session:** `naavi-voice-server/src/index.js` has its **own independent deterministic Level-A classifier system**, labeled in its own comments "ARCH-1... Mirrors intentHandlers.ts in naavi-chat" (`index.js:2067-2080`). Its `arch1HandlePersonLookup()` (`index.js:2215-2240`) is a **separately-written duplicate** of `naavi-chat/intentHandlers.ts`'s `handlePersonLookup()` — same shape, same defect: it calls the shared `global-search` Edge Function, then formats the reply by concatenating `title`/`snippet` per source (`${title} — ${snippet.slice(0, 60)}`, vs. mobile's `.slice(0, 80)`) with **zero Contacts-vs-Calendar arbitration**, and never invokes Claude. This is a **fourth** independent code path capable of surfacing Calendar's false year (after: Claude's mobile Path B [fixed in Phase 4], `naavi-chat`'s `handlePersonLookup` [Addendum 2's motivation], and now voice's `arch1HandlePersonLookup`). **This directly strengthens the case for fixing at the Calendar source**: because all four paths read the same underlying `global-search/adapters/calendar.ts` snippet data, stripping the false year at that one source fixes all four without touching `intentHandlers.ts` or `naavi-voice-server/src/index.js` at all.

**Does the documented problem scope match the Architecture Reference?** Partially — this ARCH-1/Layer-2 duplication (voice independently reimplementing `naavi-chat`'s deterministic classifier system) is not listed anywhere in Architecture Reference §5a's Duplication Inventory. This is a real, previously-undocumented gap, named here rather than worked around silently, per §7's Decision Rules ("duplication requires explicit approval, named as duplication, not discovered later"). **Not this addendum's job to resolve** — flagging for the Architecture Reference's own maintainers (a future T1a-style pass) rather than expanding this fix's scope to consolidate it.

**If duplicated, were all documented implementations investigated?** N/A for `calendar.ts` itself (not duplicated). For the *newly found* ARCH-1/Layer-2 duplication: yes, both sides were read directly (`intentHandlers.ts:464-523` and `naavi-voice-server/src/index.js:2215-2240`) — confirming both are equally fixed by this addendum's source-level change, so no separate fix is required for either.

**Is any documented implementation excluded from investigation?** No.

---

## 3. Architecture Scope Rule / Cross-Repository Verification Rule (with Verification Provenance tags)

- **Mobile — freshly verified this session:** `naavi-chat/intentHandlers.ts:490-493` (`handlePersonLookup`, zero-result case) and its non-empty-result formatting (`intentHandlers.ts:495-517`) — confirmed via live test failure (`prompt-regression.b10r-contacts-authoritative-birthday-year`, run against staging 2026-07-22) that this deterministic path, not Claude's Path B, handles "Tell me about X" phrasing. Read directly, not inferred.
- **Voice — freshly verified this session:** `naavi-voice-server/src/index.js:2215-2240` (`arch1HandlePersonLookup`) — read directly, confirmed structurally identical to mobile's `handlePersonLookup` (see §2's new finding above). Per `feedback_never_assert_shared_without_checking_voice_file`, this was checked directly rather than assumed parity with mobile.
- **Shared Core — freshly verified this session:** `global-search/adapters/calendar.ts` is the single point both of the above (and Claude's two Path-B equivalents) read from — confirmed by tracing `fetchGlobalSearch()`/the `global-search` fetch call in both files back to the same Edge Function endpoint.

No implementation was assumed equivalent to another without direct verification. Both deterministic duplicates (mobile's and voice's) were read in full, not sampled.

---

## 4. Architecture Drift Rule

Per Governance §Phase 6, applied proactively (no code exists yet):

1. **Ownership:** unchanged — `calendar.ts` remains Shared Core, genuinely shared. No Ownership Change Rule implication.
2. **Duplication:** the planned fix **does not** touch or resolve the newly-found ARCH-1/Layer-2 duplication (voice's independent reimplementation of `naavi-chat`'s classifier) — that duplication continues to exist after this fix ships, just with a data source that no longer feeds it a false year. This should be recorded as a known, accepted gap for now (not resolved, not silently ignored) — candidate for a future architecture pass, not this fix.
3. **Protected Core:** `calendar.ts` is explicitly Protected Core (Calendar integration, Architecture Reference §4). Full Phase 1-8 applies, as already stated in the Phase 1 addendum.

**Conclusion:** no drift from what this document itself establishes; one real architecture gap (ARCH-1 duplication) is newly surfaced and explicitly deferred, not swept under either code path's fix.

---

## 5. Independent Review Rule

- **Technical Investigation Review (Phase 1, Addendum 2):** Approved 2026-07-22 (`docs/B10R_PHASE1_PROBLEM_DEFINITION_2026-07-22.md`).
- **Architecture Completeness Review:** this document — not yet reviewed by ChatGPT.

---

## 6. Explicit rule verdicts

- **Architecture Scope Rule:** PASS
- **Cross-Repository Verification Rule:** PASS (all claims freshly verified this session, per the new Verification Provenance Rule — none rest on the Reference alone)
- **Architecture Drift Rule:** PASS (no drift; one new architecture gap surfaced and explicitly deferred — see §4.2)

---

## 7. Status

Phase 1A (Addendum 2) drafted 2026-07-22, not yet reviewed. Per the Phase-Gate Approval Rule, this goes to the external reviewer next, and — regardless of verdict — requires Wael's own separate, explicit go-ahead before Phase 2 (Change Planning, scoped to `calendar.ts`) begins.
