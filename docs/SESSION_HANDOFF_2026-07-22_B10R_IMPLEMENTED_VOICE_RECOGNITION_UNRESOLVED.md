# Session Handoff — 2026-07-22 — B10r Implemented (Original + 3 Addenda), Voice Recognition Issue Unresolved

## Bottom line for next session

**Next session's explicit job (Wael's words): "test and validate the implementation accuracy of B10r."** Not a new investigation — this session did the full implementation, deployed it to both staging and production, and verified most of it directly. One real, unexplained problem surfaced right at the end and was not chased down. Start there.

---

## What B10r was

Naavi stated a computed "next occurrence" year from Google Calendar's auto-generated recurring birthday/anniversary entry as if it were the person's real birth/anniversary year (e.g. "Jan 15, 2027" instead of the real "Jan 15, 1948").

## What shipped, across four rounds of work in this session

1. **Original scope** — `supabase/functions/global-search/adapters/contacts.ts` now requests `birthdays,events` from Google People API and surfaces `Birthday:`/`Anniversary:` facts in search results (never inventing a year Contacts doesn't have — Rule 18). Includes enrichment for the Phase-1 community-DB fast path (MyNaavi-labelled contacts), which otherwise never got this data. `get-naavi-prompt/index.ts` gained a "Contacts is authoritative over Calendar" rule for Claude's Path B.
2. **Addendum 2** — found during Phase 4 testing that "Tell me about X" is actually handled by a **deterministic classifier** (`naavi-chat/intentHandlers.ts`'s `handlePersonLookup`, and voice's independent `arch1HandlePersonLookup`), not Claude — so the prompt-only fix in (1) would never have reached the real bug for this phrasing. Fixed at the source instead: `supabase/functions/global-search/adapters/calendar.ts` now strips the year from any *recurring* birthday/anniversary-titled event (gated on `recurringEventId` presence + title match, so a genuine one-time "X's Birthday Party" event keeps its real year).
3. **Addendum 3** — found during Wael's own live manual test (Bob, a real MyNaavi-labelled contact with birthday 1950 + anniversary 2000): the richer snippet now overflows a pre-existing truncation limit in both deterministic handlers, cutting the anniversary value mid-string. Fixed: `naavi-chat/intentHandlers.ts` 80→160 chars, `naavi-voice-server/src/index.js`'s `arch1HandlePersonLookup` 60→120 chars (proportional).
4. **Test suite** — `tests/catalogue/session-2026-07-22-b10r-contact-birthdays.ts` (new, 4 cases: 2 contacts-side skip cleanly — no test-account contact has birthday data, documented gap; 2 calendar-side pass, self-contained). Two originally-written `prompt-regression.ts` cases were **removed same day** after live testing proved their premise wrong (see `tests/catalogue/prompt-regression.ts`'s in-file comment) — they assumed Claude's Path B handles "Tell me about X"; it doesn't, ever, for this phrasing.

**Full governance trail** (Phase 1 → 8, all Approved by external review where run): `docs/B10R_PHASE1_PROBLEM_DEFINITION_2026-07-22.md` (2 addenda), `docs/B10R_PHASE1A_ARCHITECTURE_COMPLETENESS_2026-07-22.md`, `docs/B10R_PHASE1A_ADDENDUM2_CALENDAR_2026-07-22.md`, `docs/B10R_PHASE2_CHANGE_PLAN_2026-07-22.md`, `docs/B10R_PHASE2_ADDENDUM2_CALENDAR_CHANGE_PLAN_2026-07-22.md`, `docs/B10R_PHASE1-2_ADDENDUM3_TRUNCATION_2026-07-22.md` (Phase 3 explicitly waived by Wael for this one, low-risk precedent per F10a), `docs/B10R_PHASE3_TECHNICAL_REVIEW_2026-07-22.md`, `docs/B10R_PHASE5_EVIDENCE_2026-07-22.md`, `docs/B10R_PHASE6_TECHNICAL_REVIEW_2026-07-22.md`.

## Side findings, spun out separately (not part of B10r, don't re-investigate as if new)

- **[[B10t]]** — `naavi-voice-server`'s "ARCH-1" system is a fully independent duplicate of `naavi-chat`'s Layer 2 classifier, including its own `arch1HandlePersonLookup`. Architecture debt, not an active defect — deferred to a future Architecture Integrity Audit pass.
- **[[B10u]]** — `delete-calendar-event` hangs 40s+ on the staging test account. Unrelated pre-existing slowness, found incidentally while writing B10r's calendar tests. Test cleanup was changed to fire-and-forget to work around it; the underlying slowness itself is still unfixed.
- **[[B10v]]** — `handlePersonLookup`/`arch1HandlePersonLookup` never mention when a contact is MyNaavi-labelled, even though `metadata.is_community` is set correctly. Pre-existing gap, unrelated to the year bug, low priority.
- **CLAUDE.md corrected** — the documented test account was wrong (`mynaavidemo@gmail.com`); actual test account is `mynaavi2207@gmail.com`. Fixed in this session.
- **`AI_DEVELOPMENT_GOVERNANCE.md` bumped to v3.7** — new Verification Provenance Rule (Phase 1A), prompted by a side discussion with Wael/ChatGPT this session about a Phase 1A draft that cited the Architecture Reference instead of freshly re-checking a claim.

## Deployment state as of session end

- **Staging** (`xugvnfudofuskxoknhve`): `global-search`, `naavi-chat`, `get-naavi-prompt` all deployed with the full fix. Fully tested — automated suite clean (2 pass, 2 documented-skip), plus direct API verification.
- **Production** (`hhgyppbxgmjrwdpdubcx`): same three functions deployed, **with Wael's explicit production-promotion approval this session.** Verified directly via API (not just staging): `global-search` for "Fatma Elmehelmy" returns `Birthday: Jan 15, 1948 · Anniversary: Dec 8, 1982` correctly; `naavi-chat` "Tell me about Fatma" returns the same correct facts with no year on the calendar-side duplicate entries. **This is the exact contact and phrasing from the original bug report — confirmed fixed via `naavi-chat` (mobile's code path), directly, in production.**
- **`naavi-voice-server`**: commit `2242aca` pushed to `main`, Railway auto-deploys from this (no staging tier for voice — this went straight to production voice).

## The one open, real problem — start here next session

**Voice does not recognize either test contact ("Bob," then "Fatma"), even though both exist in production Contacts and `naavi-chat`/`global-search` return correct data for both when called directly.** This has NOT been root-caused. Two data points:

1. First attempt used "Bob" — explainable as a red herring: that Bob only existed in the *staging* Google account, and voice always hits production only (confirmed by Wael); separately, production has a *different* Bob with no birthday/anniversary data at all.
2. Second attempt used "Fatma" — **not explainable the same way.** Fatma is confirmed in production Contacts with real birthday/anniversary data, and both `global-search` and `naavi-chat` return her correctly when called directly via API. Voice still failed to recognize her.

**Where the investigation was cut off:** voice's `arch1HandlePersonLookup` (`naavi-voice-server/src/index.js:2215`) calls `arch1HandleLookupContact(contactQuery, userId)` **first** (`index.js:2193`), where `contactQuery` is only the **first word** of the query (`query.trim().split(/\s+/)[0]` — so "Fatma", not "Fatma Elmehelmy"). That function POSTs to the separate `lookup-contact` Edge Function. If `lookup-contact` returns zero contacts for a bare "Fatma" query, `arch1HandleLookupContact` returns `needsSpelling: true` **immediately** — the flow never reaches `fetchGlobalSearch` (the part already proven to work). **This was not yet tested directly** — next session should call `lookup-contact` on production with `{"name":"Fatma","user_id":"788fe85c-b6be-4506-87e8-a8736ec8e1d1"}` and see what comes back, before assuming anything else (STT, voice's own classifier, etc.). This is a plausible root cause, not a confirmed one — verify before acting on it, per this project's own standing discipline.

**Do not re-verify mobile/API-direct behavior again — that's already solid.** The gap is specifically: does voice's own separate code path (its own classifier, then `lookup-contact`, then `fetchGlobalSearch` as fallback) correctly reach and speak the same data mobile already proves is correct.

## Still outstanding from the original Phase 7 manual-test plan

- Test #3 (a genuine one-time "X's Birthday Party" event, no recurrence, keeps its real year) — not yet manually tested by Wael, only covered by the automated `b10r.calendar-year-strip-false-positive-avoidance` test (which passed).
- Voice-side confirmation of the whole fix (blocked on the open problem above).

## Test account reference (corrected this session)

- **Staging test account:** `mynaavi2207@gmail.com` (staging Supabase user id `ae1f3438-e132-422a-9b0b-7b8819119b46`). Has "Bob" (birthday Jan 1 1950, anniversary Jul 22 2000, MyNaavi-labelled) — no equivalent for Fatma.
- **Wael's production account:** `wael.aggan@gmail.com` (production Supabase user id `788fe85c-b6be-4506-87e8-a8736ec8e1d1`). Has both "Bob" (no birthday data, different phone number than staging's Bob) and "Fatma Elmehelmy" (birthday Jan 15 1948, anniversary Dec 8 1982, MyNaavi-labelled) — confirmed via direct API this session.

## Governance status

Phase 1 through 6 complete and Approved (external review) for the original scope and both addenda (Addendum 3's Phase 3 was explicitly waived by Wael, not skipped silently — F10a precedent). **Phase 7 (Testing) is in progress, not complete** — this is exactly what next session picks up. Phase 8 (Merge/close-out) has not started. The holding list's B10r entry itself should be updated to "closed" only once Phase 7 fully passes (voice issue resolved + test #3 done).
