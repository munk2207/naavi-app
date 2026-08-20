# B10r — Phase 2: Change Planning

**Date:** 2026-07-22
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.6, Phase 2
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4

No code was written in producing this document. Everything below is based on a fresh consumer trace done this session — not restated from Phase 1/1A without re-checking.

---

## Design decision: carry the birthday/anniversary fact in `snippet`, not a bespoke `metadata` field

This needed its own investigation before a file list could be written, because Phase 1A already found one undocumented duplication (the mobile home-brief widget) — the question of *which* file(s) need to change depends entirely on how the fixed data actually reaches the user, which required tracing every real consumer, not assuming a shape.

**Consumer trace performed this session** — three places read a `contacts`-source `SearchResult` today:

1. **Mobile → Claude injection** (`hooks/useOrchestrator.ts:2283-2298`) — builds `- [${label}] ${r.title}${r.snippet ? ' — ' + r.snippet : ''}`, plus contacts-specific handling of exactly two `metadata` keys: `resource_name` and `is_community`. No other metadata key is read.
2. **Voice → Claude injection** (`naavi-voice-server/src/index.js`, ~3238-3244) — an **independently written, separate implementation** of the same idea: `- [${src}] ${title}${snippet}`. It reads `title`/`snippet` only — it does not inspect `metadata` at all, not even `resource_name`/`is_community`.
3. **Mobile UI card** (`app/index.tsx:2270-2311`) — the `GLOBAL_SEARCH` results card rendered in the chat thread — reads only `hit.title` and `hit.snippet`. No metadata field is rendered.

**This confirms a previously-undocumented duplication**: mobile and voice each have their own hand-written "turn search results into text for Claude" function, and they don't agree on which `metadata` keys they understand. Per Architecture Reference §7's Decision Rules ("duplication requires explicit approval, named as duplication, not discovered later") — naming it here rather than working around it silently.

**Decision: do not touch either duplicated formatter.** Instead, put the birthday/anniversary fact directly into the `snippet` string produced by `global-search/adapters/contacts.ts` — the one field all three consumers already forward verbatim, with zero code change required in `hooks/useOrchestrator.ts` or `naavi-voice-server/src/index.js`. This is the lower-risk option:
- It reaches all three consumers with a **single Shared Core file change**.
- It requires **no change to Protected Core "Voice orchestration"** (`naavi-voice-server/src/index.js`, Full Phase 1-8 if touched) — avoiding that file entirely is a meaningful risk reduction, not just convenience.
- The rejected alternative — teach both formatters to also read a new `metadata.birthday`/`metadata.anniversary` key, matching the existing `resource_name`/`is_community` pattern — was considered and set aside because it requires editing Protected Core voice code for a read-only Q&A formatting fix, with no corresponding benefit over the snippet approach.
- `metadata.birthday`/`metadata.anniversary` will still be populated alongside the snippet text (structured, for any future consumer), but no current consumer depends on it — the snippet is what actually carries the fix.

---

## Additional consumer check: other independent contact-fetch implementations, confirmed unaffected

Phase 1 found `contacts.ts` and `lookup-contact/index.ts` both lacked the `birthdays`/`events` personFields. This session's trace found **two more** independent People API call sites, neither previously documented against this bug:

- **`lookup-contact/index.ts` (both call sites, lines 119 and 272)** — traced every caller in `naavi-chat/index.ts`: all six call sites use it exclusively to resolve a phone number for message-sending (SMS/WhatsApp/email recipient resolution), never to answer "tell me about X". **This file is excluded from this fix's scope** — it is not on the bug's actual path, and adding unused fields here would be scope creep with no consumer (Governance's "No Extra Changes Rule" applies in spirit even at planning stage: don't add code nothing reads).
- **`supabase/functions/assistant-fulfillment/index.ts`'s `handleContacts()` (lines 312-389)** — a fourth, independent People API implementation, powering the Google Assistant deep-link surface (`naavi://contacts?name=X`, `app/contacts.tsx`). Read directly: it only ever speaks name/email/phone (line 383-386) — never a birthday or anniversary. **Confirmed unaffected, correctly out of scope**, not silently ignored.
- **`lib/calendar.ts`'s `fetchUpcomingBirthdays`** — already flagged in Phase 1A as a mobile-only Calendar-sourced implementation, unaffected (no year ever shown) — carried forward here as still out of scope, per the open question left for Wael in Phase 1A §6a (not resolved by this Phase 2 document; still open).

**Net effect:** this codebase has four independent contact-birthday-adjacent implementations. This fix touches exactly one of them (`global-search/adapters/contacts.ts`) — the only one on the reported bug's path. The other three are confirmed, not assumed, unaffected. This is architecture debt worth a future cleanup item, but consolidating it is not this fix's job and would be exactly the kind of opportunistic scope expansion Governance's Phase 4 "No Extra Changes Rule" forbids.

---

## Files that will change

| File | Classification | Change |
|---|---|---|
| `supabase/functions/global-search/adapters/contacts.ts` | Backend (Shared Core) | Add `birthdays,events` to the `personFields` param (`fetchConnections()`, line 146) and to the `readMask` param (`fetchOtherContacts()`, line 175). Extend the `Person` type (lines 81-95) with `birthdays?: { date?: { year?, month?, day? }, text? }[]` and `events?: { type?, date?: {...} }[]`. Add a small pure helper (e.g. `formatDateFact`) that renders `"Month Day"` when `date.year` is `0`/absent, or `"Month Day, Year"` when present — never inventing a year, per Rule 18. In both hit-building branches (community list, ~360-386, and the main scored loop, ~577-727), compute the contact's birthday text and the `events` entry whose `type === 'anniversary'`, append both to `snippetParts` when present, and also set `metadata.birthday`/`metadata.anniversary` (structured, for future use — not load-bearing for this fix). No text at all when the contact has no birthday/anniversary on file — silence per Rule 18, not a fallback guess. |
| `supabase/functions/get-naavi-prompt/index.ts` | Backend (Shared Core, prompt) | Add a rule instructing Claude: when both a Contacts-sourced birthday/anniversary fact and a Calendar-sourced event mentioning the same occasion appear in the same search results (both adapters can still return hits for one query, since Calendar is not being removed from Global Search generally — only from this feature's data-authority), the Contacts fact is authoritative for the date and year; Calendar's date must never be stated as the person's birth/anniversary year. Exact wording and placement (near the existing Rule 18 / "I DON'T HAVE THAT" honesty rules, `get-naavi-prompt/index.ts:~1250-1276`) to be drafted in Phase 4, not finalized here. |
| `tests/catalogue/session-2026-07-22-b10r-contact-birthdays.ts` (new) | Test infra | Regression tests per Rule 15a — see Test Plan below. |
| `tests/catalogue/prompt-regression.ts` | Test infra | One new case: Contacts fact + Calendar fact both present for the same person → response must use Contacts' date/year, never Calendar's. |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | Docs | Close-out entry once shipped. |

**No other files change.** No migration, no cron change, no mobile client file, no voice-server file, no `lookup-contact/index.ts` change.

---

## Test Plan (for Phase 5's Evidence Package, scoped now per Rule 15a)

1. Contact has `birthdays[0].date = {year:1948,month:1,day:15}` → snippet includes `"Jan 15, 1948"`.
2. Contact has `birthdays[0].date = {year:0,month:4,day:3}` (no year on file) → snippet includes `"Apr 3"`, never a fabricated year.
3. Contact has `events` containing `{type:'anniversary', date:{year:1982,month:12,day:8}}` → snippet includes `"Dec 8, 1982"` labeled as anniversary, not birthday.
4. Contact has neither field → no birthday/anniversary text anywhere in the snippet (silence, per Rule 18) — confirms no regression of today's baseline behavior for contacts without this data.
5. Contact has a custom `events[].type` (not `"anniversary"`) → not surfaced as an anniversary (only the predefined `anniversary` type is treated as one).
6. Prompt-regression: Contacts fact (1948) + Calendar fact (2027, from a recurring "Contacts' birthdays" calendar entry) both present in the same live-search-results block → Claude's answer states 1948, never 2027. Per the Non-Determinism Rule (Governance §Phase 3), run this **3 independent trials**, report the full distribution.

---

## Risk classification: Medium

Not **Low**: modifies a Shared Core Edge Function's response shape (`contacts.ts`), consumed identically by both mobile and voice through two independently-written formatters (documented above) — a mistake here is reachable from both surfaces at once.

Not **High**: no database schema change, no new Edge Function, no cron change, no Protected Core file touched in the traditional sense (Action Rules, Reminder Engine, Geofencing, Calendar integration, Voice orchestration, Gmail integration, Authentication, Permissions, Background scheduling, Notification routing, Database schema are all untouched) — this lands under the "API contracts" Protected Core category identified in Phase 1A, as an additive, backward-compatible field.

---

## Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | **No** | Confirmed by consumer trace — `hooks/useOrchestrator.ts` and `app/index.tsx` already forward `snippet` generically; no code change needed. |
| Voice | **No** | Confirmed by consumer trace — `naavi-voice-server/src/index.js`'s injection formatter also forwards `snippet` generically; no code change needed. |
| Shared Core | Yes | `global-search/adapters/contacts.ts` (response shape), `get-naavi-prompt/index.ts` (new rule). |
| Database | No | |
| Cron | No | |
| API contracts | Yes | Additive fields on the `contacts` adapter's `SearchResult.snippet`/`metadata` — backward compatible, confirmed by tracing all 3 real consumers above; none breaks on an unrecognized-but-present addition. |
| Tests | Yes | New regression tests required (Rule 15a), see Test Plan. |

**Duplicated capability — will both implementations change?** N/A for the two Shared Core files (not duplicated). The two *newly-found* duplicated formatters (mobile/voice live-search-injection) — **neither changes**, by design (see decision above), which is itself an explicit "only one path touched, and here is why" answer this matrix requires: the fix doesn't need either formatter to change because `snippet` already flows through both untouched.

---

## Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** Yes — `contacts.ts`, `get-naavi-prompt/index.ts`.
- **Does this change modify an Entry Point?** No — neither mobile's nor voice's injection-formatting code changes.
- **Does this change introduce new duplication?** No.
- **Does this change eliminate existing duplication?** No — the four independent contact-fetch implementations found this session are not consolidated by this fix (see "Additional consumer check" above); that would be a separate, larger, unrequested change.
- **Does this change modify Protected Core?** Yes, under the "API contracts" category (Phase 1A's corrected classification) — additive Shared Core response-shape change. Full Phase 1-8 applies.

---

## Regression Impact

| Area | Affected? |
|---|---|
| Voice commands | Content only — voice's spoken answer to "tell me about X" changes (real birthday/anniversary instead of a fabricated year); no mechanism/code change in voice itself. |
| Geofencing | No |
| Gmail integration | No |
| Calendar integration | No — `calendar.ts` is not modified; its existing behavior (and existing bug, for any caller not going through the fixed path) is unchanged by this fix. |
| Reminders (`reminders` table) | No |
| SMS / call alerts | No — `lookup-contact/index.ts`, the file that resolves SMS/WhatsApp/email recipients, is explicitly excluded from this fix's scope (see above); untouched. |
| Onboarding | No |
| Staging build | This fix is **Edge-Function-only** — `contacts.ts` and `get-naavi-prompt/index.ts` deploy to staging independently of any mobile app build. No AAB/APK required to test this fix. |

---

## Regression Matrix (per-change consumer trace)

Every real consumer of `contacts.ts`'s `SearchResult` output was traced this session, not recalled from Phase 1:

1. `hooks/useOrchestrator.ts:2283-2298` (mobile → Claude injection) — confirmed unaffected (generic snippet forwarding).
2. `naavi-voice-server/src/index.js` (~3238-3244) (voice → Claude injection) — confirmed unaffected (generic snippet forwarding).
3. `app/index.tsx:2270-2311` (mobile GLOBAL_SEARCH results UI card) — confirmed unaffected (renders `title`/`snippet` only).
4. `naavi-chat/index.ts`'s `global_search` tool-use loop — Claude receives whatever the injected context contains; behavior changes only in that Claude now sees a birthday/anniversary line it didn't before, which is the intended fix, not a regression.

No consumer was found that would break on an added snippet fragment or an added `metadata` key.

---

## Status and next steps

Phase 2 complete. Risk classification is **Medium**, which per Governance §Phase 3 requires ChatGPT technical review before coding begins. Per the Phase-Gate Approval Rule, your own explicit go-ahead is required before Phase 3 starts, separately from that review's eventual verdict.
