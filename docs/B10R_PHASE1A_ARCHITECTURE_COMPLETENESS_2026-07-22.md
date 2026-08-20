# B10r — Phase 1A: Architecture Completeness Review

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.6, Phase 1A. This document does not repeat or revise `docs/B10R_PHASE1_PROBLEM_DEFINITION_2026-07-22.md`'s Technical Investigation Review (Approved, 2026-07-22) — that review stands. This document supplies the separate, independent Architecture Completeness Review Phase 1A requires.

No code was written in producing this document.

**Addendum, 2026-07-22 (post-reviewer):** the reviewer's Observation 1 noted that §3's original mobile-verification claim rested on the Architecture Reference's classification rather than a fresh direct check, and suggested a grep would remove even that small inferential dependency. That grep was run and did surface a real, previously unverified finding — a mobile-only birthday implementation (`lib/calendar.ts`'s `fetchUpcomingBirthdays`) that bypasses Shared Core entirely. §3 below is updated accordingly rather than left as originally drafted. This is exactly the failure mode the observation was warning against, and it would have gone unverified had the check not been done.

---

## 1. Architecture Reference Version Verification

**Version used for this review:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, v2026.07.18.4 — confirmed current by direct glob of `docs/` this session: no file matching `MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE*` exists with a later date. Same version Phase 1 cited; no re-evaluation needed on that account.

---

## 2. Capability ownership and classification

**What is the architectural owner of the affected capability?** Per Architecture Reference §0a's Ownership Model: **Shared Core** (`munk2207/naavi-app/supabase/functions/*`). The fix direction settled in Phase 1 (Addendum) touches `global-search/adapters/contacts.ts` and `lookup-contact/index.ts` — both Shared Core Edge Functions. Neither a mobile-only nor voice-only file is touched.

**Is the capability Shared Core, Duplicated, or Platform-specific?** **Shared Core, genuinely shared** — per Architecture Reference §2: "Contacts / name resolution" (`lookup-contact`, `resolve-recipient`) is listed as *"Genuinely shared — voice calls the real Edge Functions, no inline reimplementation"*; "Global Search" (`global-search`) is listed the same way. This is corroborated independently, not just cited from the Reference: Phase 1 §2's voice-side check (grep of `naavi-voice-server/src/index.js` for `birthday`, `personFields`, `anniversary`) found no direct Google People API call in voice at all — voice reaches contact data exclusively through these same Shared Core functions.

**If duplicated, were all documented implementations investigated?** N/A — not duplicated. Confirmed rather than assumed: see above.

**Does the documented problem scope match the Architecture Reference?** Partially, with one gap worth naming rather than glossing over: the Reference's §2 table lists "Contacts / name resolution" and "Global Search" as Shared Core capabilities, which matches. But **neither capability appears in Architecture Reference §4's Protected Core file-mapping table**, nor in Governance §4's Protected Core category list (Voice orchestration, Action Rules, Reminder Engine, Geofencing, Calendar integration, Gmail integration, Authentication, Permissions, Background scheduling, Notification routing, Database schema, API contracts — confirmed by re-reading both tables directly, no "Contacts" row in either). This is a real gap in the Reference's own Protected Core mapping, not something to force-fit into an unrelated row. The closest applicable category is **"API contracts"** (Governance §4 / Architecture Reference §4's own text: *"the shape of `action_config`, `trigger_config`, `task_actions`, and every Edge Function's request/response shape"*) — adding `birthdays`/`events` to two Shared Core Edge Functions' responses changes what `lookup-contact` and `global-search`'s contacts adapter return to every caller (mobile, voice, `naavi-chat`'s tool-use loop). That is an additive response-shape change, not a breaking one, but it is still an API-contract change under this Protected Core category as written.

**Is any documented implementation excluded from investigation?** No.

**Correction to Phase 1's own citation:** Phase 1 §5 cited "Calendar integration" as the applicable Protected Core area, on the reasoning that the bug's symptom lives in `calendar.ts`. Per Wael's Phase 1 addendum decision (Calendar out of scope for this feature), the *planned fix* no longer touches `calendar.ts` at all — so Calendar integration Protected Core is **not actually implicated by the implementation Phase 2 will scope**, only by the bug's historical symptom. This document supersedes that citation: the correct Protected Core category for the actual planned work is **API contracts** (Shared Core response-shape change), not Calendar integration.

---

## 3. Architecture Scope Rule / Cross-Repository Verification Rule

Per Governance's Phase 1A requirement: *"No reviewer may assume that one implementation represents another... Before any implementation is approved, Claude must verify whether equivalent logic exists in Mobile, Voice, and Shared Core."*

- **Mobile — corrected after a fresh grep (reviewer's Observation 1), superseding the first draft's inferred claim:** the first draft of this document stated mobile reaches contacts "exclusively" through the Shared Core functions, resting that on the Architecture Reference's classification rather than a direct check. A fresh grep of `app/`, `hooks/`, and `lib/` this session found that claim was not fully accurate: **`lib/calendar.ts:554-593` (`fetchUpcomingBirthdays`) is a separate, undocumented mobile-only implementation.** It powers the home-screen morning-brief birthday item (`app/index.tsx:1178,1197`) by querying the local `calendar_events` Supabase table directly (`.ilike('title', '%birthday%')`) — it does not call the Shared Core `global-search`/`lookup-contact` functions, and it does not call the Google People API at all (no `personFields`, no `birthdays`/`events`). It happens not to exhibit B10r's specific reported symptom (it formats only weekday/month/day — `calendar.ts:581` — never a year), so it is not the bug this item is tracking. But it is a genuine, previously undocumented Shared-Core-bypassing mobile-only birthday implementation that the Architecture Reference's Duplication Inventory (§5a) does not currently list. **Flagging for Phase 2, not deciding here:** should the home-brief widget also move to a Contacts-sourced birthday once that becomes available, for consistency with the conversational path's fix — or is it acceptable to leave it Calendar-sourced since it doesn't carry the year-fabrication defect? This is a scope question for Wael, not something this review resolves unilaterally. Separately confirmed: `lib/supabase.ts:130` has a one-off People API call (`personFields=names`) used only as an OAuth-token health check — unrelated to contact search, correctly out of scope.
- **Voice:** re-confirmed from Phase 1 §2's own grep of `naavi-voice-server/src/index.js` — no `personFields` construction, no direct People API call. Voice's only birthday-related code is the unrelated write-side safety net (`index.js:12315-12360`, auto-creating a calendar event from spoken text) — explicitly a different capability (event creation, not birthday/anniversary lookup) and correctly out of scope.
- **Shared Core:** both call sites needing the personFields change are Shared Core (`contacts.ts:146`, `lookup-contact/index.ts:119,272`) — no third Shared Core implementation of contact search exists (confirmed by the single-adapter architecture: `global-search`'s adapter registry has exactly one `contacts` adapter, and `lookup-contact` is the only other Edge Function performing a People API `connections`/`people.get` call for name resolution — no additional call site found in this session's greps of either Phase 1 or this review).

No implementation was assumed equivalent to another without direct verification, per `feedback_never_assert_shared_without_checking_voice_file`.

---

## 4. Architecture Drift Rule

Per Governance §Phase 6, applied proactively here since no code exists yet to actually drift: this section evaluates whether the *planned direction* (not yet implemented) would, if built as scoped, change anything the Architecture Reference currently claims.

1. **Ownership:** unchanged — Contacts/name resolution and Global Search remain Shared Core, called identically by both surfaces. No Ownership Change Rule (Governance §4) implication.
2. **Duplication:** unchanged — no duplication introduced or removed. The fix extends an existing Shared Core response shape; it does not create a second implementation anywhere.
3. **Protected Core / API contracts:** the planned response-shape addition (`birthdays`/`events` fields on contact search results) is a genuine, if additive, change under the "API contracts" Protected Core category identified in §2 above. Per Phase 8's merge precondition, this does not itself require an Architecture Reference update (no Shared Core boundary, ownership, or duplication status is changing) — but Phase 2's Change Impact Matrix should explicitly name "API contracts: Affected — additive response field" rather than leaving that row blank, since Governance requires every row stated, not omitted.

**Conclusion:** no architecture drift from the planned direction. The one correction this review makes is to Phase 1's own Protected Core citation (§2 above), not to anything the Architecture Reference itself claims.

---

## 5. Independent Review Rule

Per Governance: *"Phase 1 now has two independent reviews... Passing one review does not imply passing the other."*

- **Technical Investigation Review:** already Approved, 2026-07-22 (`docs/B10R_PHASE1_PROBLEM_DEFINITION_2026-07-22.md`) — not reopened here.
- **Architecture Completeness Review:** this document — reviewed once by ChatGPT (Approved, with two minor observations both addressed in this revision — see Addendum above and §3).

---

## 6. Explicit rule verdicts

- **Architecture Scope Rule:** PASS
- **Cross-Repository Verification Rule:** PASS (strengthened post-review — see Addendum and §3's corrected mobile finding)
- **Architecture Drift Rule:** PASS (no drift; one citation correction made, see §2/§4)

---

## 6a. Open item surfaced for Phase 2 (not resolved here)

The fresh mobile grep in §3 found `lib/calendar.ts`'s `fetchUpcomingBirthdays` — a mobile-only, Shared-Core-bypassing birthday implementation powering the home-brief widget, previously undocumented in the Architecture Reference's Duplication Inventory. It does not exhibit B10r's reported symptom (no year is ever displayed) and is therefore not part of this bug fix's required scope, but Phase 2 should explicitly decide and state: does the home-brief widget also move to a Contacts-sourced birthday for consistency, or does it stay Calendar-sourced as an intentionally separate, simpler feature? Either answer is acceptable — leaving it undecided or unstated is not, per Governance's "silence is not acceptable" standard for scope questions.

The reviewer's second observation (Phase 2 should explicitly enumerate existing consumers, new optional fields, backward compatibility, and serialization impact for the `birthdays`/`events` response-shape addition) is carried forward as a Phase 2 requirement, not addressed here — Phase 1A's job is architecture completeness, not implementation planning.

---

## 7. Status and next steps

Phase 1A drafted 2026-07-22, not yet reviewed. Per the Phase-Gate Approval Rule, this document goes to the external reviewer next, and — regardless of that reviewer's verdict — requires Wael's own separate, explicit go-ahead before Phase 2 (Change Planning) begins.
