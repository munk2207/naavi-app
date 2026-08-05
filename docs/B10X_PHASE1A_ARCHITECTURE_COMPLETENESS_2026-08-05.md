# B10x — Phase 1A — Architecture Completeness Review

**Date:** 2026-08-05
**Governance version:** v4.0
**Phase 1:** Both tracks Approved — `docs/B10X_PHASE1_PROBLEM_DEFINITION_2026-08-05.md` (Track 1), `docs/B10X_TRACK2_PHASE1_PROBLEM_DEFINITION_2026-08-05.md` (Track 2)

---

## Architecture Reference Version Verification

**Architecture Reference used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, Architecture Version **2026.07.18.4**, Last Verified 2026-07-18.

**Confirmed current as of this review (2026-08-05):** checked for a superseding file (none found — only one `MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_*.md` file exists in `docs/`) and checked its git history since 2026-07-18 (no commits touching it since the version-4 revision cited above). No newer Architecture Reference exists; nothing in this review relies on a stale map.

---

## Track 1 (Mobile) — Architecture Completeness

- **What is the architectural owner of the affected capability?** `naavi-chat` backend Edge Function, which owns the mobile implementation of the duplicated Calendar-read capability, specifically `fetchLiveCalendarEvents`. **Freshly verified this session** — direct code read, `supabase/functions/naavi-chat/index.ts:962-965`.

  *(Corrected 2026-08-05, external review — "Shared Core backend Edge Function" was confusing wording: the Calendar-read capability itself is classified Duplicated, not Shared Core, even though `naavi-chat` as an Edge Function does host genuinely Shared Core capabilities elsewhere. The corrected wording names `naavi-chat` as the owner of the mobile-side implementation specifically, without implying the capability itself is shared.)*
- **Is the capability Shared Core, Duplicated, or Platform-specific?** **Duplicated**, per Architecture Reference `:68`: *"Calendar — reads (live event fetch) | Duplicated | Both `naavi-chat` and the voice server independently call the Google Calendar API themselves — see `docs/adr/0002-calendar-reads-remain-duplicated.md`."* **Relying on Architecture Reference classification, not re-derived from scratch this session** — but the underlying code-level distinctness was freshly re-confirmed (Track 1 Phase 1, evidence #1-6).
- **If duplicated, were all documented implementations investigated?** Yes. The Architecture Reference documents exactly two implementations for this capability (`naavi-chat`, voice server) — confirmed exhaustive by grep of the Reference's own Calendar-related rows (`:67-68, 122, 145, 164, 169, 193-211`), no third implementation (e.g. website, staff portal) is documented anywhere for calendar reads. Both are investigated: `naavi-chat`'s under Track 1, voice's under Track 2.
- **Does the documented problem scope match the Architecture Reference?** Yes. Track 1's scope (one function, one repo, additive parameter-threading) is consistent with the Reference's own framing of this as an Accepted Architecture Exception (ADR 0002, "no unification planned") — Track 1 fixes `naavi-chat`'s instance of the duplicated capability without attempting to un-duplicate it, matching the accepted architecture.
- **Is any documented implementation excluded from the investigation?** No. Both documented implementations are covered — `naavi-chat` under Track 1, voice under Track 2 — as two tracks of the same ticket rather than one being silently dropped.

## Track 2 (Voice) — Architecture Completeness

- **What is the architectural owner of the affected capability?** `naavi-voice-server` (separate repository `munk2207/naavi-voice-server`, separate deploy target — Railway, auto-deploy from `main`), specifically its own independent Google Calendar live-fetch and date-handling code in `src/index.js`. **Freshly verified this session** — direct code read, 40+ call sites cited in Track 2 Phase 1.
- **Is the capability Shared Core, Duplicated, or Platform-specific?** **Duplicated** — same Architecture Reference row and same ADR 0002 as Track 1; this track is investigating the *other* half of that documented duplication.
- **If duplicated, were all documented implementations investigated?** Yes, same answer as Track 1 — both of the two documented implementations are covered, this track being voice's.
- **Does the documented problem scope match the Architecture Reference?** Yes, with one important addition beyond what the Reference itself states: the Reference records that Calendar reads are duplicated, but does not describe *why* a shared fix isn't planned. This session's investigation supplies that reasoning concretely for the timezone sub-problem — voice has no per-request client-timezone equivalent to a mobile HTTP request's, so its fix is structurally different (capture + persist, not thread-through) — which is consistent with, and reinforces, ADR 0002's "no unification planned" acceptance rather than contradicting it.
- **Is any documented implementation excluded from the investigation?** No, per the same reasoning as Track 1.

## Additional cross-check — `user_settings` table ownership

Not itself a Calendar-reads capability, but Track 2's fix depends on it, so checked for completeness: `user_settings` is **not** listed as Duplicated anywhere in the Architecture Reference — it's a shared Postgres table, read/written directly by both `naavi-chat` and the voice server via their own Supabase clients (confirmed, Track 2 Phase 1 evidence #5: existing direct PostgREST calls against `user_settings` already present in `naavi-voice-server/src/index.js` for phone resolution, keyterms, addresses). Writing a confirmed timezone here doesn't introduce a new architectural pattern — it uses the same shared-table access both codebases already rely on.

---

**Conclusion:** Both tracks' Phase 1 problem definitions are complete with respect to the Architecture Reference. No documented implementation has been silently excluded from either track. No stale Architecture Reference version is in use. Ready for Phase 2 (Change Plan) — Track 1 as originally scoped; Track 2 per the 8 mandatory requirements recorded in its Phase 1 doc's external-review section.

**Awaiting Wael's own separate go-ahead to proceed to Phase 2 for either track**, per the Phase-Gate Approval Rule.
