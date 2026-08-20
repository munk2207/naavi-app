# B10w — Phase 1: Problem Definition

**Date:** 2026-07-22
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.7, Phase 1
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4

No code was written in producing this document.

---

## 1. What exactly is broken?

On voice, asking about a person who resolves to a real contact ("what do we have about bob," "tell me about Fatma") returns **only name and phone/email** — never birthday, anniversary, calendar events, MyNaavi status, or anything else Global Search would surface. Live evidence, this session: asking "what do we have about bob" on a real phone call returned exactly *"Bob and 3433332567"* — nothing else, despite Bob being a MyNaavi-labelled contact whose mobile answer (same underlying data, same session) includes birthday, anniversary, calendar entries, and a Gmail-linked to-do.

This is broader than B10r's own scope: it is not just that B10r's birthday/anniversary fix fails to reach voice — voice's `PERSON_LOOKUP` answer structurally cannot surface **any** Global-Search-sourced fact (calendar mentions, Gmail context, community/MyNaavi status, addresses, organizations) for a contact that resolves via `lookup-contact`, which is the common case for any named contact.

## 2. What evidence proves the problem?

**Live evidence (this session, your own test):** "what do we have about bob" on a real voice call → *"Bob and 3433332567"*. Same session's mobile test (staging, screenshot) for the identical contact returned a full `contacts` / `calendar` / `gmail` breakdown including `Birthday: Jan 1, 1950 · Anniversary: Jul 22, 2000`.

**Code evidence, verified directly this session:**

1. **`naavi-voice-server/src/index.js:2215-2226`** (`arch1HandlePersonLookup`) — calls `arch1HandleLookupContact` **first**, and short-circuits on any match:
   ```js
   async function arch1HandlePersonLookup(query, userId) {
     const contactQuery = query.trim().split(/\s+/)[0];
     const contactData = await arch1HandleLookupContact(contactQuery, userId);
     if (contactData?.needsSpelling) return contactData;
     // Found a contact — return it directly without global search noise.
     if (contactData?.speech && !contactData.needsSpelling) return contactData;
     const results = await fetchGlobalSearch(query, userId);   // ← never reached on a contact match
     ...
   ```
2. **`naavi-voice-server/src/index.js:2193-2213`** (`arch1HandleLookupContact`) — calls the `lookup-contact` Edge Function and, on a single match, returns only:
   ```js
   const detail = c.phone || c.email || '';
   return { speech: detail ? `${c.name} — ${detail}` : c.name };
   ```
   No birthday, anniversary, calendar, Gmail, or community-status field is ever read here — `lookup-contact/index.ts` doesn't even request `birthdays`/`events` from Google People API (confirmed in B10r's own Phase 1, `lookup-contact/index.ts:119,272` — deliberately excluded from B10r's scope because its only traced callers, at the time, were message-recipient resolution in `naavi-chat/index.ts`).
3. **`naavi-chat/intentHandlers.ts:464-527`** (`handlePersonLookup`, mobile's equivalent) — has **no such short-circuit**. It calls `global-search` directly and unconditionally; confirmed by re-reading the full function this session.

**This is the mechanism, not a guess:** the returned string in your live test (`"Bob and 3433332567"`) matches `arch1HandleLookupContact`'s exact template (`${c.name} — ${detail}`, spoken form) precisely — not `arch1HandlePersonLookup`'s post-`fetchGlobalSearch` formatting, which would have produced a `"Contacts: ... . Calendar: ..."`-shaped sentence like mobile's.

## 3. Root cause

**Proven, by direct code citation:** voice's `arch1HandlePersonLookup` treats a successful `lookup-contact` match as a terminal answer and never calls `fetchGlobalSearch` in that case. Mobile's `handlePersonLookup` has no equivalent short-circuit. This is a genuine, previously-undocumented functional divergence between the two "Level A deterministic `PERSON_LOOKUP`" handlers — distinct from the truncation divergence already tracked as [[B10t]] (which was about a mirrored *defect*, i.e. both handlers having the same too-tight slice limit; this is instead an *extra step* voice has that mobile doesn't).

**Why B10r's phase reviews didn't catch this:** Phase 2's consumer trace excluded `lookup-contact/index.ts` from scope after tracing its callers inside `naavi-chat/index.ts` only (all six, confirmed message-recipient resolution). Phase 1A's Addendum 2 separately found and documented `arch1HandlePersonLookup` as a structural mirror of `handlePersonLookup` — but characterized the mirroring as "same shape... zero shared code," which was accurate for the truncation defect but did not surface that voice's version *also* calls `lookup-contact` first. No session traced `arch1HandlePersonLookup`'s own internal call sequence against `handlePersonLookup`'s line-by-line — this gap is the reason.

**Design-intent investigation (per external reviewer's required clarification) — resolved by `git log`/`git show`, not inferred:** the short-circuit is **deliberate, stated design**, and it reversed an even earlier same-day design that combined both sources. Three commits, all 2026-06-06:

1. **`af98f214`** (08:20:00) — `arch1HandlePersonLookup` created calling only `fetchGlobalSearch` — no contact-lookup step at all, identical in shape to mobile's handler today.
2. **`26b325ce`** (09:25:58) — *"Fix Item 4: PERSON_LOOKUP now also tries contact card first"* — commit message: *"'find fatma' was classified as PERSON_LOOKUP (global search) instead of LOOKUP_CONTACT... now always runs contact lookup first and prepends the contact card if found."* The diff at this point **combines** both: `parts.push(contactData)` then `parts.push(sections.join(...))` when global results also exist — no short-circuit yet.
3. **`cd67f6e1`** (09:51:57, 26 minutes later) — *"Fix Item 4: ... PERSON_LOOKUP returns contact only"* — commit message: *"arch1HandlePersonLookup now returns ONLY the contact card when a contact is found — no global search dump on top. Global search only runs when the contact lookup returns nothing."* New in-code comment: *"don't overwhelm the user with global search results (calendar, emails, rules) on top of it."*

**Conclusion: not a historical leftover — a same-day, explicitly-reasoned reversal.** The stated concern is spoken-audio ergonomics specific to voice: a phone call is a linear audio channel, and a combined contact-card-plus-calendar-plus-email-plus-rules answer was judged to overwhelm a caller in a way it wouldn't overwhelm a mobile chat bubble (which can be skimmed). This is a real, voice-specific UX constraint that mobile's handler doesn't need to satisfy — it is not evidence the short-circuit itself is wrong, only that a fix must preserve this constraint rather than simply removing the short-circuit and reintroducing the exact problem `cd67f6e1` was written to prevent.

**Scope boundary (per reviewer's requested addition):** this defect affects only successful contact matches. Queries that do not resolve through `lookup-contact` continue into `fetchGlobalSearch` unchanged and are outside the scope of this defect — those calls already receive Global Search's full data, including B10r's birthday/anniversary fix.

## 4. What alternatives were considered?

Not yet fully — this is Phase 1 (investigation only), no fix proposed here. Given §3's confirmed design intent (voice deliberately avoids combining contact-card + global-search content into one spoken answer), candidate directions for Phase 2 to scope, in light of that constraint rather than against it:

- **Remove the short-circuit entirely**, making `arch1HandlePersonLookup` always call `fetchGlobalSearch` (matching mobile exactly). **Weakened by §3's finding** — this would reintroduce the exact "overwhelming combined spoken answer" problem `cd67f6e1` was explicitly written to prevent. Not ruled out, but now the least-favored option, not the default.
- **Enrich `arch1HandleLookupContact`'s single-match branch** to also speak birthday/anniversary/community-status facts specifically (not the full Global Search dump — calendar/email/rules stay excluded, preserving the conciseness intent), sourced from the same `metadata.birthday`/`metadata.anniversary`/`metadata.is_community` fields B10r's `contacts.ts` change already populates. This targets the actual reported gap (birthday/anniversary/community status missing) without reversing the voice-specific brevity decision.
- **Have `arch1HandlePersonLookup` call both, but only fall back to full Global Search formatting when the contact card is "thin"** (no birthday/anniversary/community data) — closer to `26b325ce`'s original combined approach, but conditional rather than unconditional, so a rich contact card stays short while a sparse one still gets the fuller answer.
- **Question resolved, not open:** why does `arch1HandlePersonLookup` call `lookup-contact` first — confirmed deliberate, per §3's commit trace, not accidental/legacy. Phase 2 should design around this constraint, not against it.

## 5. Architecture Reference ownership (Phase 1 citation requirement)

Per `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`:

- **§4, Protected Core table** — **Voice orchestration** (`naavi-voice-server/src/index.js`, entire file) — Full Phase 1-8 applies.
- **§2, "Contacts / name resolution"** (`lookup-contact`) — Shared Core, genuinely shared (confirmed, this bug is not in `lookup-contact` itself, it's in how voice's classifier sequences calls to it).
- **§2, "Global Search"** (`global-search`) — Shared Core, genuinely shared (same conclusion — the bug is that voice sometimes never calls it, not that the function itself misbehaves).
- **§2a** — this is a second, distinct instance of the general pattern §2a warns about: "a bug fixed in mobile's [handler] does not fix voice's... behavior, and vice versa." Confirms the pattern rather than introducing a new one.
- **Related, not identical:** [[B10t]] (voice's ARCH-1 duplication of `handlePersonLookup`, truncation-defect mirror) — same two files, different specific defect. This item does not fold into B10t's existing write-up; it is a separate, additional divergence within the same duplicated pair.

## 6. No Assumptions Rule compliance check

Every claim in §2/§3 is backed by a direct file:line citation from this session's own reads, or your own live test result (treated as ground truth for the symptom, per `feedback_user_test_is_ground_truth`). No "probably"/"likely" language used for the mechanism — the code path is read and quoted directly, not inferred from behavior alone.

## 6a. Reviewer's reframing of the Phase 2 objective (recorded, not yet decided)

External review of this document raised a distinction worth carrying into Phase 2 rather than losing in the approval verdict alone: given §3's confirmed design intent, the objective should not be **feature parity with mobile** (voice always calling `fetchGlobalSearch` exactly like `handlePersonLookup`) — it should be **information parity appropriate for voice**: surfacing the same high-value facts (birthday, anniversary, community/MyNaavi status) without reintroducing the overwhelming combined-spoken-answer problem `cd67f6e1` was written to prevent. This reframes which of §4's alternatives is preferred, but the choice among them is still Phase 2's job, not decided here.

## 7. Status and next steps

**Phase 1 reviewed and Approved (2026-07-22)** — reviewer's verdict: problem isolated, evidence chain, root cause, design-intent investigation, architecture ownership, scope boundaries, and alternatives-without-implementation all confirmed satisfied. No outstanding investigation concerns raised.

Per the Phase-Gate Approval Rule, this reviewer verdict is a recommendation, not authorization — **your own explicit, separate go-ahead is required before Phase 1A (Architecture Completeness Review) begins.**
