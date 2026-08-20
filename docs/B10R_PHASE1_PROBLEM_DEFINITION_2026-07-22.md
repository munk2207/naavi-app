# B10r — Phase 1: Problem Definition

**Date:** 2026-07-22
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.6, Phase 1
**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Version 2026.07.18.4
**Note on method:** per Wael's explicit instruction, this document is built from this session's own direct code inspection, not copied from the prior session's holding-list entry or handoff doc. Where this write-up confirms, refines, or adds to what those documents claimed, that is stated explicitly below — nothing here is asserted solely because an earlier document said so.

No code was written in producing this document.

**Addendum, 2026-07-22 (post-draft, pre-reviewer):** three follow-up questions were raised against the initial draft. Subsequent investigation confirmed all three with independent evidence — none rest on authority alone:

1. **Calendar is out of scope. Contacts is the real source and is independent of Calendar.** Confirmed — Google People API's `birthdays` and `events` objects live directly on the Person resource; they are not derived from, synced with, or dependent on Calendar in any way (see the API schema below). There is no technical reason Calendar needs to stay involved, even as a fallback. This removes former alternative (b)/(c)'s "fall back to Calendar" framing from §4 below.
2. **Contacts does carry Anniversary and Birthdate as real fields.** Confirmed against Google's own People API reference (fetched 2026-07-22, not recalled from training data): `birthdays[].date` has an *optional* `year` ("0 to specify a date without a year" — Google's own wording), and a separate `events[].type` field supports the predefined value `"anniversary"` with its own `date`. Both are real, requestable fields — see updated §2 evidence below.
3. **The existing "MyNaavi"-labelled contact query is the mechanism to reuse — not a new one.** Confirmed: `contacts.ts`'s `COMMUNITY_LABEL = 'mynaavi'` (line 38) and `fetchMyNaaviGroupId()` (lines 123-139) already fetch this via the same `fetchConnections()` call (lines 141-168) whose `personFields` string (line 146) is the exact string missing `birthdays`/`events`. Adding those fields to that one line makes them available for every contact fetched through this path, MyNaavi-labelled or not — no separate query needed.

**Addendum 2, 2026-07-22 (post-Phase-4-testing) — a gap in this Phase 1's own root-cause scope, found during test execution, not before:**

**What was missed:** this Phase 1 investigated where the false year *originates* (Calendar's next-occurrence date) and fixed one of the two places it gets *asserted to the user* (Claude's Path B, via the `get-naavi-prompt` rule shipped in Phase 4). It did not investigate whether Claude's Path B is even the code path that handles "Tell me about X" — it wasn't. A prompt-regression test built to verify the Phase 4 fix failed with all 3 trials returning a canned "I didn't find anything about 'Fatma'..." — tracing this found `supabase/functions/naavi-chat/intentHandlers.ts:464-523`'s `handlePersonLookup()`: "Tell me about X" is classified by `naavi-chat`'s stateless Layer 2 Haiku classifier (`classifyIntent`, per `docs/ARCHITECTURE_NAAVI_CHAT_ACTION_SYSTEMS.md`) as Level-A intent `PERSON_LOOKUP`, which runs its own fresh `global-search` call and formats the reply by literally concatenating `title`/`snippet` per source — **never calling Claude, never seeing `get-naavi-prompt`, and with no awareness that a pre-search block might already be in the message.**

**Why it was missed:** CLAUDE.md instructs reading `docs/ARCHITECTURE_NAAVI_CHAT_ACTION_SYSTEMS.md` before debugging "any action/recipient bug." I judged this a search-result-*formatting* bug rather than an action/recipient bug, and didn't read that doc during the original Phase 1. That judgment was too narrow — the doc's Layer 2/Path B split applies to `PERSON_LOOKUP` and every other Level-A read intent just as much as to action/recipient bugs; nothing in its scope excludes search-result formatting. Owning this as a process gap on my part, not a documentation gap.

**Corrected root cause:** the false year is asserted by **two independent response-generation code paths** reading the same Calendar-adapter output — (1) Claude's Path B, already addressed by Phase 4's `get-naavi-prompt` rule, and (2) Layer 2's `handlePersonLookup`, a deterministic template that never reaches that rule at all. The original Phase 1/2's fix direction (add fields to `contacts.ts`) implicitly assumed the false year was solely a Claude-prompt problem — it is not; it is also a plain string-template problem in a second, non-LLM code path. This also explains the original live evidence precisely: `handlePersonLookup`'s literal template — `"Here's what I found about "${query}". ${sections...}"` — matches the reported "Tell me about Fatma" → "Jan 15, 2027" shape almost exactly, strongly suggesting this deterministic path, not Path B, produced the original bug.

**Chosen direction (Wael's explicit call, 2026-07-22):** fix at the Calendar source rather than patching two separate response-formatting code paths — strip the year from `calendar.ts`'s own snippet whenever the event is a recurring birthday/anniversary entry (detected from the event's own title, mirroring the file's existing `isBirthdayQuery` pattern which currently only checks the *query*, not the *event*). Because neither `handlePersonLookup` nor Claude's Path B would then ever receive a false year from Calendar, this resolves the defect for both response systems with one change, and `intentHandlers.ts` does not need to be touched.

**This does not reverse Addendum 1's decision** that Contacts is the true source and Calendar is out of scope *as a source of birthday/anniversary facts*. This fix only stops Calendar from asserting a year it was never entitled to assert — it does not reintroduce Calendar as a fallback data source for the actual birthday/anniversary value.

**New file entering scope:** `supabase/functions/global-search/adapters/calendar.ts` — explicitly listed as **not authorized** by both the original and supplemental Phase 3 reviews to date. Per Architecture Reference §4, Calendar integration is Protected Core — **Full Phase 1-8** applies to this file.

---

## 1. What exactly is broken?

When a user asks about a person's birthday or anniversary (e.g. "Tell me about Fatma"), Naavi states a year as if it were the real birth/anniversary year, but the year is actually just the year of whichever calendar occurrence happened to fall inside the search window — a "next occurrence" artifact, not a fact about the person. Per Rule 18 (CLAUDE.md — "Naavi has no authority to reformat facts to fit her own DB or technical constraints"), presenting a computed value as an observed fact is the exact bug class that rule exists to prevent. This defect causes Naavi to present fabricated personal facts, reducing user trust and violating Rule 18.

## 2. What evidence proves the problem?

**Live evidence (Wael's own reported test, per the 2026-07-21/22 holding-list entries — not independently re-run by me this session):** Fatma Elmehelmy's real Google Contact card shows birthday Jan 15 **1948** and anniversary Dec 8 **1982**. Naavi's "Tell me about Fatma" answer showed "Jan 15, **2027**" / "Dec 8, **2026**" — month/day correct, year wrong. Per `feedback_user_test_is_ground_truth`, I am treating this reported result as ground truth for the symptom; what I verified independently this session is the code-level mechanism that would produce exactly this symptom.

**Code evidence I verified directly, this session:**

1. **`supabase/functions/global-search/adapters/contacts.ts:146`** — the People API request:
   `url.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers,addresses,memberships,organizations');`
   `birthdays` is not in this list. Naavi's contacts search never fetches the birthday field Google Contacts actually stores.

2. **`supabase/functions/lookup-contact/index.ts:119` and `:272`** — both call sites set:
   `getUrl.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers,addresses,memberships');`
   Same gap, in the other contact-lookup path.

3. **`supabase/functions/global-search/adapters/calendar.ts:280-288`** — this is where the wrong year actually gets produced:
   ```
   const startISO = e.start?.dateTime ?? e.start?.date ?? undefined;
   ...
   const dateStr = startISO
     ? new Date(startISO).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
     : '';
   ```
   The request to Google (`calendar.ts:224`) sets `singleEvents=true`, which makes Google expand a recurring yearly event (the auto-generated "Contacts' birthdays" calendar entry) into individual instances. Each instance's `start.date` is the date of *that specific occurrence* within the search window (`timeMin`/`timeMax`, `calendar.ts:206-217`) — not the recurring event's original creation year. For a birthday whose next occurrence falls in 2027, `e.start.date` is genuinely `2027-01-15` — Google itself is not returning the birth year, because a recurring all-day event's expanded instances don't carry one. The adapter then formats this occurrence date with `year: 'numeric'` and returns it as the event's date, with nothing in the returned data distinguishing "this is a recurring date's next occurrence" from "this is a fact with an inherent year."

4. **`supabase/functions/get-naavi-prompt/index.ts:565`** — I want to correct one detail in how the prior holding-list entry characterized this line. It reads:
   `Naavi: "Here's what I found about 'Jasmine': **calendar** - Jasmine El-Gillani's birthday — Mar 16, 2027 - Jasmine's Birthday — Oct 15, 2026 - Jasmine Graduation — Jun 23, 2026..."`
   This sits inside a block explicitly labeled `WRONG (this exact pattern is forbidden)`, and the stated reason (`WHY WRONG`, line 566) is *"Displaying search results without calling set_action_rule completely ignores the request"* — i.e., the example is teaching Claude not to dump raw search results back to the user, not endorsing the year format shown inside it. Read as evidence rather than as a prescriptive template, this line is useful for a different reason: it's a snapshot of what `global_search`'s calendar results already looked like at the time this prompt section was written — "Month Day, Year" with a computed next-occurrence year — which corroborates finding #3 above (the raw data already carries this shape before Claude ever touches it). I am not treating line 565 itself as a causal contributor to the bug; the causal mechanism is #3.

**Additional finding, not previously documented, now confirmed against Google's own People API reference doc (fetched 2026-07-22):** Google's People API has no `anniversary` sub-field under `birthdays` — a contact's anniversary lives under the separate `events` personField. Exact schema:
- `Birthday`: `{ metadata, date: { year, month, day }, text }` — `date.year` is explicitly optional ("Year of the date. Must be from 1 to 9999, or 0 to specify a date without a year" — Google's own spec wording). This matters directly for Rule 18: if a contact's real birthday has no year on file, Naavi must say so honestly (month/day only), never synthesize one.
- `Event`: `{ metadata, date, type, formattedType }` — `type` supports the predefined value `"anniversary"` (also `"other"`, or a custom string).

Neither field is requested by `contacts.ts` nor `lookup-contact/index.ts` (confirmed by grep — no occurrence of `events` as a requested personField anywhere in the codebase). This means the fix direction discussed in the prior session (add `birthdays` to the personFields request) would cover the birthday half of this bug but not the anniversary half unless `events` is also requested and parsed for `type: "anniversary"`.

**Voice-side check (Architecture Scope Rule, done now rather than deferred to Phase 1A):** grepped `naavi-voice-server/src/index.js` for `birthday`, `personFields`, `anniversary` — no direct Google People API call exists there; voice has its own birthday-related logic only for a narrow *write* path (an "auto-create a calendar event when the user says 'X's birthday is Y'" safety net, `index.js:12315-12360`), which is unrelated to this bug (this bug is about *reading back* an existing birthday/anniversary, not creating one). For the read path this bug concerns, voice has no separate implementation to go wrong in parallel — it calls the same Shared Core `global-search`/`lookup-contact` functions mobile does. This is one of the cleaner items on the holding list in that respect: no cross-surface duplication to reconcile, just one Shared Core gap.

## 3. Root cause

**Proven, by direct code citation (all four numbered points in §2):** Naavi has no code path that ever requests a contact's actual birthday or anniversary date from Google Contacts (`birthdays`/`events` personFields both absent from every People API call site in the codebase). The only source Naavi has for "when is X's birthday" is the Google Calendar auto-generated recurring birthday calendar, read via `singleEvents=true` expansion — which by construction returns the *next occurrence's* date, not an origin year. The calendar adapter formats that occurrence date with a 4-digit year and returns it indistinguishable from a non-recurring fact, and nothing downstream (adapter, prompt, or client) marks it as "this year is not the real year, just the next occurrence."

**Previously an open question, now resolved (see Addendum above):** whether Google's auto-generated "Contacts' birthdays" calendar has access to the true birth year is no longer decision-relevant — Calendar is out of scope for this feature entirely, regardless of what it does or doesn't carry. I still have not fetched a raw Calendar API response to confirm that underlying behavior, but Phase 2 no longer needs it, since the fix direction does not depend on Calendar at all.

## 4. What alternatives were considered?

Not yet fully — this is Phase 1 (investigation only), no fix proposed here. Per the confirmed finding in Addendum point 1, Calendar is out of scope for this feature — the two Calendar-dependent alternatives originally drafted here (strip-the-year formatting fix, or a Contacts-primary/Calendar-fallback hybrid) are struck. The remaining direction for Phase 2 to scope in detail:

- **Add `birthdays` and `events` to the personFields/readMask request in `contacts.ts:146` and `lookup-contact/index.ts:119,272`, and surface that data as the sole source for birthday/anniversary display — no Calendar involvement.** This touches three call sites and requires new response-shaping logic (currently these functions only ever return name/email/phone/address; a birthday/anniversary value with an *optional* year needs its own handling so Rule 18 isn't violated in the other direction — never inventing a year Contacts didn't provide, and saying "no year on file" honestly when `date.year` is `0`). Per the confirmed finding in Addendum point 3, MyNaavi-labelled contacts require no separate handling — they already flow through this same `fetchConnections()` call.
- **Open for Phase 2 to decide, not yet settled here:** what Naavi says when a person has no birthday/anniversary in Contacts at all (silence, per Rule 18's "better to omit than misrepresent" — this was already the governing principle before today's discussion, just reconfirmed as still applicable now that Calendar isn't a fallback source).
- **Added per Addendum 2:** strip the year from `calendar.ts`'s snippet for recurring birthday/anniversary-titled events, regardless of whether a Contacts fact exists for the same person — this is a blanket, source-level correction (Calendar's year is never a real fact for these event types, full stop), not a per-query arbitration decision. This is the direction Phase 2/3 will scope in detail for this one file.

## 5. Architecture Reference ownership (Phase 1 citation requirement)

Per `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`:

- **§2, "Contacts / name resolution"** — `lookup-contact`, `resolve-recipient` — **Shared Core, genuinely shared** (confirmed independently this session, not just cited from the Reference — voice has no parallel People API call for this).
- **§2, "Global Search"** — `global-search` — **Shared Core, genuinely shared** (same confirmation).
- **§4, Protected Core table** — **Calendar integration** is explicitly listed (`create-calendar-event`, `delete-calendar-event`, both sides' live-fetch code) — the calendar adapter this bug lives in falls under this Protected Core area. **Full Phase 1-8** review level applies. **Corrected by Addendum 2:** Calendar integration is no longer just "explains the symptom but out of scope" — per Addendum 2, `calendar.ts` is now an in-scope file for this fix (the year-stripping change), even though Calendar remains out of scope as a *data source* for the birthday/anniversary fact itself (Contacts still is, per Addendum 1).
- This is **not** a case of duplicated implementations needing parallel fixes (§2a's usual concern) in the mobile-vs-voice sense. It is, however, a case of **two independent response-generation code paths within Shared Core** (Claude's Path B and `naavi-chat`'s Layer 2 deterministic `handlePersonLookup`) both capable of asserting Calendar's false year — see Addendum 2. Fixing the year at its Calendar source, rather than patching each response path separately, avoids treating this as a new duplication requiring two parallel fixes. Both the gap and the symptom are reachable identically by mobile and voice.

## 6. No Assumptions Rule compliance check

Every claim in §2 and §3 is backed by a specific file:line citation from this session's own reads, or explicitly labeled "not proven." The live user-facing symptom (Fatma's contact) is attributed to Wael's own reported test, not re-verified by me this session — flagged as such rather than presented as independent evidence, per `feedback_verifiability_over_trust`.

## 7. Status and next steps

Phase 1 complete (original scope) — Phase 1A, Phase 2, Phase 3, and Phase 3-supplemental all passed for the original scope (`contacts.ts`, `get-naavi-prompt/index.ts`, plus the Phase-1-fast-path addition to `contacts.ts`).

**Addendum 2 (calendar.ts year-strip) requires its own Phase 1A → Phase 2 → Phase 3 pass before implementation** — approved by Wael to draft ("ok", 2026-07-22) and reviewed by ChatGPT (APPROVE, 2026-07-22) as this addendum's own Phase 1 review. Not yet authorized for coding — Phase 1A is next.

**Flagged for Phase 6 (reviewer's observation, 2026-07-22):** this is a textbook instance of the Invalidated Planning Assumption Rule (Governance §Phase 6) — the Phase 2 plan assumed fixing `contacts.ts` + `get-naavi-prompt` would resolve the defect; Phase 4 testing found that assumption incomplete because an independent deterministic response path (`handlePersonLookup`) existed. When this work reaches Phase 6, record it explicitly under that rule rather than as an omitted feature or implementation error — this document is the factual basis for that entry.
