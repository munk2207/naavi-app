# B10w — Phase 2: Change Planning

**Date:** 2026-07-22
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.7, Phase 2
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4

No code was written in producing this document.

**Revision note:** this replaces the first Phase 2 draft (second `fetchGlobalSearch` call, keyed by name text). External review approved that draft but raised an architectural concern: a second, independent name-based resolution risks associating enrichment data with the wrong contact when duplicate/ambiguous names exist. Investigating that concern found a better design — recorded below — that eliminates the risk by construction instead of merely validating it's safe.

---

## Design decision: extend `lookup-contact`'s own response with birthday/anniversary — no second resolution pass

**What changed since the first draft:** `supabase/functions/lookup-contact/index.ts` already returns `contact_id` (Google People API's `resourceName`) on every contact object it hands back — confirmed by direct read, both at the direct-fetch path (`:133`) and the name-search path (`:314`). This is a stable, unique identity key already flowing through the exact response voice's `arch1HandleLookupContact` reads today. The birthday/anniversary data doesn't need a second, independent lookup — it can be added to the same already-resolved response.

**Chosen design:** add `birthdays,events` to `lookup-contact`'s existing People API `personFields`/`readMask` requests, and add formatted `birthday`/`anniversary` fields to the `contact`/`contacts` objects it already builds. Voice's `arch1HandleLookupContact` then reads `c.birthday`/`c.anniversary` directly from the response it already has — **no second network call, no second name-based resolution, no identity-mismatch risk at all**, because it's the same resolved person object, not a re-query.

**Reuse vs. mirror — resolved, not left to default (per external review's requested question):** checked directly whether `contacts.ts`'s `formatDateFact`/`contactDateFacts`/`PersonDate`/`PersonBirthday`/`PersonEvent` logic can be genuinely shared rather than duplicated into `lookup-contact/index.ts`. **`supabase/functions/_shared/` already exists and is an established, working pattern** — `_shared/alert_body.ts` and `_shared/task_actions.ts` are each imported by multiple Edge Functions today (`import { executeTaskActions } from '../_shared/task_actions.ts';`, confirmed in `evaluate-rules/index.ts:25`, per the file's own comment: *"extracted to `_shared/task_actions.ts` so `report-location-event` can [reuse it]."* There is no technical obstacle to real reuse here — mirroring would have been the wrong default. **Decision: extract to a new `_shared/contact_date_facts.ts`.** `contacts.ts` is refactored to import from it (pure extraction, no behavior change to already-shipped B10r code); `lookup-contact/index.ts` imports the same module. Zero duplicated business logic between the two files.

**Why this fully addresses the reviewer's concern rather than just validating it:** the concern was that a second, independent lookup by text could resolve to a different contact than the one already selected (e.g., two "Bob Smith" contacts). With this design there is no second lookup — the birthday/anniversary comes from the exact same `resourceName`-keyed object `lookup-contact` already fetched for the contact it already selected. The identity-match question doesn't need Phase 3 to "verify it holds" — it's structurally guaranteed by using one resolution, not two.

**Fresh finding, not in B10r's original scope note:** `lookup-contact/index.ts` has **four** `personFields`/`readMask` sites needing the additive fields, not the two B10r's original Phase 1 cited (`:119`, `:272`) — re-read in full this session:
- **`:119`** — direct `contact_id` fetch (single `people.get`, used by `resolve-recipient`'s fire-mode re-resolution).
- **`:169`** — initial `searchContacts` query.
- **`:246`** — the phonetic-prefix fallback `searchContacts` retry.
- **`:272`** — the `batchGet` call that fetches full contact data by `resourceName` — this is the one actually used to build `contacts[]` (`:296-321`) when it succeeds; `:169`/`:246`'s `readMask` only matters as a fallback if `batchGet` fails and the code falls back to the raw search result (`:298`, `person = ... ?? r.person ?? {}`).

**All four should be updated for consistency**, matching B10r's own precedent of updating every `personFields`/`readMask` site it found in `contacts.ts` rather than leaving some current and some stale.

**Why this reopens `lookup-contact/index.ts` safely, distinct from B10r's exclusion reason:** B10r's Phase 2 excluded this file because its (then-traced) callers were all message-recipient resolution, with no consumer needing birthday/anniversary. This item is a *different*, additive reason to touch the same file: a caller (voice's `arch1HandleLookupContact`) that already resolves a contact through this function now also wants to speak two more facts about that same contact. The existing callers are unaffected because the change is purely additive — see the fresh Regression Matrix below, traced this session across every real caller, not inherited from B10r's trace.

---

## Files that will change

| File | Classification | Change |
|---|---|---|
| `supabase/functions/_shared/contact_date_facts.ts` (**new**) | Backend (Shared Core, new shared module) | Extracted from `contacts.ts`: `PersonDate`/`PersonBirthday`/`PersonEvent` types, `formatDateFact` (never fabricates a year, per Rule 18), `contactDateFacts`. Same pattern as `_shared/alert_body.ts`/`_shared/task_actions.ts` — a plain exported module, no Deno-specific obstacle to import from two different function directories. **Ownership rule (per external review's recommendation):** this module is the authoritative implementation of contact birthday/anniversary formatting. Future date-formatting changes belong here, not in `contacts.ts` or `lookup-contact/index.ts` directly — both are importers, not owners, of this logic. A future change that adds formatting logic to either importer instead of this module recreates the exact divergence this extraction exists to prevent. |
| `supabase/functions/global-search/adapters/contacts.ts` | Backend (Shared Core) | **Pure extraction, no behavior change:** replace the inline `PersonDate`/`PersonBirthday`/`PersonEvent` type definitions and `formatDateFact`/`contactDateFacts` functions with `import { contactDateFacts } from '../../_shared/contact_date_facts.ts';`. Every call site (`fetchPersonDateFacts`, the community-hit branch, the main scored loop) is unchanged — only where the logic lives moves, not what it does. |
| `supabase/functions/lookup-contact/index.ts` | Backend (Shared Core) | Add `birthdays,events` to all four `personFields`/`readMask` sites (`:119`, `:169`, `:246`, `:272`). Import `contactDateFacts` from `_shared/contact_date_facts.ts` and compute `birthday`/`anniversary` for each contact object built at the direct-fetch site (`:129-139`) and the name-search site (`:296-321`). Add `birthday: string \| null` and `anniversary: string \| null` fields to both. |
| `naavi-voice-server/src/index.js` | Backend (Voice orchestration, Protected Core) | In `arch1HandleLookupContact` (`:2193-2213`), single-match branch: read `c.birthday`/`c.anniversary` from the response already in hand and append `· Birthday: X` / `· Anniversary: Y` to the returned `speech` when present. **No change to `arch1HandlePersonLookup`'s control flow at all** — the enrichment now happens entirely inside the function that already does the lookup, one level lower than originally planned. No second call anywhere. |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | Docs | Update B10w's entry after successful completion. |

**No other files change.** No migration, no cron, no mobile client file, no `calendar.ts` change, no `intentHandlers.ts` change (mobile already gets this data via B10r).

**Regression note specific to the `contacts.ts` extraction:** this touches an already-shipped B10r file again, but only as a mechanical extraction — no call site's behavior changes, confirmed by keeping every call site's signature (`contactDateFacts(p: Person)`) identical. B10r's own test coverage for `contacts.ts` (`tests/catalogue/session-2026-07-22-b10r-contact-birthdays.ts`) continues to exercise the same logic, now imported rather than inline — Phase 5 should re-run those tests to confirm the extraction didn't silently change behavior.

---

## Fresh consumer trace of `lookup-contact` — every real caller, traced this session

B10r's Phase 2 traced only `naavi-chat/index.ts`'s call sites. This session traced the whole repo fresh (`grep -rln "lookup-contact"`), finding a larger real caller set:

1. **`supabase/functions/naavi-chat/index.ts`** (8 call sites, not 6 — recounted this session) — all message-recipient resolution for SMS/WhatsApp/email sends. Each destructures specific fields (`name`, `phone`, `email`) via plain object access.
2. **`supabase/functions/resolve-recipient/index.ts`** — `toResolvedShape()` (`:92`) destructures exactly `{ name, email, phone, contact_id }`. Unaffected by new fields.
3. **`supabase/functions/_shared/task_actions.ts`** (`:44-60`) — destructures `{ name, phone, email }` from each match for third-party message resolution. Unaffected.
4. **`hooks/useOrchestrator.ts:3550`** — possessive-address resolution ("Bob's home") — reads `.name`, `.addresses` only. Unaffected.
5. **`lib/contacts.ts:71,113`** — phone/name recipient lookup — reads `.name`, `.phone`, `.email`, `.addresses`. Unaffected.
6. **`lib/recipientLookup.ts:40`** — email-draft candidate list — filters on `.email`, reads `.name`/`.contact_id`. Unaffected.

**No consumer does strict schema validation or rejects unrecognized fields** (all are plain JS/TS object property reads over parsed JSON) — confirmed by reading all six call sites directly, not assumed. An added `birthday`/`anniversary` field is invisible to every one of them.

---

## Test Plan

**Automated coverage:** `lookup-contact/index.ts` is a standard Edge Function — the same test pattern B10r used for `contacts.ts` applies (mock/live Google People API response, assert `formatDateFact` behavior: real year present, year absent, no birthday/anniversary on file). Add to `tests/catalogue/session-2026-07-22-b10r-contact-birthdays.ts` (same suite, since it's the same underlying feature reaching a third file) or a new sibling file — Phase 3 to confirm which.

**Voice-side coverage — still a documented gap, per Rule 15a's exception path** (unchanged from the first Phase 2 draft): `arch1HandleLookupContact` lives in `naavi-voice-server/src/index.js`'s monolith with no exports; no automated unit test is practical without an out-of-scope refactor. Manual Phase 7 voice-call verification substitutes.

**Manual test scenarios for Phase 7:**
1. Call and ask "what do we have about bob" — Bob has birthday + anniversary on file. Expect both facts spoken, no calendar/gmail dump.
2. Call and ask about a contact with no birthday/anniversary on file. Expect today's unchanged `"Name — phone"` sentence.
3. Call and ask about a name matching multiple contacts. Expect today's unchanged multi-contact list (unenriched) — the multi-match branch is untouched.
4. Call and ask about a name `lookup-contact` cannot resolve. Expect today's unchanged "spell it" prompt.
5. **Revised Scenario 6 (duplicate names, reframed):** two contacts both named "Bob Smith," each with a *different* birthday on file. Verify each one's spoken card carries **its own** birthday, not the other's. Note this now tests a pre-existing correctness property of `lookup-contact`'s own `resourceName`-keyed `batchGet` map (`:296-298`) extended with one more field — not a new risk this change introduces, since there is no second resolution pass to get wrong.
6. Confirm a message-send flow that uses `lookup-contact` (e.g., "text Bob I'm running late") still resolves and sends correctly — spot-checks that the additive fields don't disturb the message-recipient-resolution callers.

---

## Risk classification: Medium

Not **Low**: modifies a Shared Core Edge Function (`lookup-contact`) called by both mobile (via `naavi-chat`, `resolve-recipient`, `task_actions`, `useOrchestrator`, `lib/contacts.ts`, `lib/recipientLookup.ts`) and voice — a mistake here is reachable from many places at once. Also touches `naavi-voice-server/src/index.js`, Protected Core (Voice orchestration).

Not **High**: purely additive response fields (same class of change as B10r's `contacts.ts`) — no schema change, no existing field removed or altered, no cron/API-breaking change, six real consumers traced and confirmed unaffected.

---

## Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | **No** | None of the six real `lookup-contact` consumers on the mobile/Shared-Core side read or display `birthday`/`anniversary` — the fields are present but unused there, same as B10r's own `metadata.birthday` addition to `contacts.ts`. |
| Voice | Yes | `arch1HandleLookupContact`'s single-match branch reads and speaks the new fields. |
| Shared Core | Yes | `lookup-contact/index.ts` — four `personFields`/`readMask` sites, two contact-building sites. |
| Database | No | |
| Cron | No | |
| API contracts | Yes, additive | `lookup-contact`'s `contact`/`contacts` response objects gain `birthday`/`anniversary` fields — backward compatible, six real consumers traced and confirmed unaffected. |
| Tests | Yes | New Edge Function test cases (Rule 15a); voice-side remains a documented manual-verification gap (unchanged from first draft). |

**Duplicated capability — will both implementations change?** N/A — `lookup-contact` is Shared Core, not duplicated. The ARCH-1/Layer-2 duplication ([[B10t]]) is unaffected; only voice's contact-card branch gains new information from a Shared Core source both surfaces already call identically.

---

## Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** Yes — `lookup-contact/index.ts`.
- **Does this change modify an Entry Point?** Yes — `naavi-voice-server/src/index.js`, but only to read and speak data the Shared Core change now provides; no new business logic in the entry point itself.
- **Does this change introduce new duplication?** No — resolved explicitly, not by default: the birthday/anniversary computation logic is extracted to `_shared/contact_date_facts.ts` and imported by both `contacts.ts` and `lookup-contact/index.ts`, not mirrored into two copies. Same reuse pattern as `_shared/alert_body.ts`/`_shared/task_actions.ts`.
- **Does this change eliminate existing duplication?** No pre-existing duplication existed to eliminate (this logic lived in exactly one file before this change) — but this change **avoids creating new duplication that a naive implementation would have introduced**, per the point above. [[B10t]]'s unrelated ARCH-1/Layer-2 duplication remains, deliberately unaddressed here.
- **Does this change modify Protected Core?** Yes, two areas — Voice orchestration (`index.js`) and, per B10r's Phase 1A precedent, the "API contracts" category (additive Shared Core response-shape change). Full Phase 1-8 applies to both.

---

## Regression Impact

| Area | Affected? |
|---|---|
| Voice commands | Content only — the spoken answer for a single-contact match gains birthday/anniversary when present; no other voice command shape changes. |
| Geofencing | No |
| Gmail integration | No |
| Calendar integration | No — `calendar.ts` untouched. |
| Reminders | No |
| SMS / call alerts | **No behavioral change** — `resolve-recipient` and `task_actions.ts` (both used in alert/message delivery) call `lookup-contact`, but both are confirmed (fresh trace above) to read only `name`/`email`/`phone`/`contact_id` — additive fields are invisible to them. |
| Onboarding | No |
| Staging build | `lookup-contact` deploys independently of any mobile app build — no AAB/APK required. `naavi-voice-server` has no staging tier (per `docs/B10A_PHASE3_TECHNICAL_REVIEW_2026-07-16.md`'s Deployment note) — any push goes straight to the one production instance, making Phase 7's live manual test a hard precondition, not optional. |

---

## Regression Matrix (per-change consumer trace)

Superset of "Fresh consumer trace" above, restated per Governance's required format: all six real `lookup-contact` callers (`naavi-chat/index.ts` ×8 sites, `resolve-recipient`, `task_actions.ts`, `useOrchestrator.ts`, `lib/contacts.ts`, `lib/recipientLookup.ts`) traced this session by direct read, confirmed to destructure only pre-existing named fields — none breaks on an added field. `arch1HandlePersonLookup`'s own single call site (`index.js:2333`) is unaffected in shape; only the content of `arch1HandleLookupContact`'s returned `speech` changes when birthday/anniversary are present.

---

## Status and next steps

**Phase 2 (Final Revision) reviewed and Approved (2026-07-22)** — reviewer's verdict across all eight areas (single identity resolution, shared business logic, regression containment, consumer tracing, architecture consistency, extraction strategy, test strategy, risk classification): PASS. Reviewer's own framing of the three iterations: v1 (correct but relied on a second lookup) → v2 (eliminated the second lookup) → v3, this version (also eliminates the potential for duplicated business logic via the `_shared` extraction). One non-blocking recommendation (explicit ownership rule for `_shared/contact_date_facts.ts`) applied directly above.

Risk classification remains **Medium**, which per Governance §Phase 3 requires ChatGPT technical review before coding begins — that review is the three approvals recorded across this document's revisions. Per the Phase-Gate Approval Rule, this is still only a recommendation — **your own explicit, separate go-ahead is required before Phase 3 (Technical Review Before Coding) starts.**
