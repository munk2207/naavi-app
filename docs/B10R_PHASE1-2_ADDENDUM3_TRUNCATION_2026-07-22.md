# B10r — Addendum 3: Truncation collision in `handlePersonLookup`/`arch1HandlePersonLookup`

**Date:** 2026-07-22 | **Governance:** v3.7, Phase 1/1A/2 combined (mechanically small fix — see §4 for the Phase 3 waiver question)

No code was written in producing this document.

---

## 1. What's broken (Phase 1)

**Found live, 2026-07-22, Wael's own manual test** (Phase 7 of the main B10r work item): "Tell me about bob" on staging, Bob being a real MyNaavi-labelled contact with birthday Jan 1, 1950 and anniversary Jul 22, 2000. Response showed `Birthday: Jan 1, 1950` correctly (confirms B10r's core fix) but `Anniversary: Jul` — cut off mid-value, missing "22, 2000" entirely.

**Root cause, proven by exact character count, not approximation:** `naavi-chat/intentHandlers.ts:501`'s `handlePersonLookup()` does `r.snippet.slice(0, 80)`. Bob's post-B10r contacts snippet is `"aggan2207@gmail.com · (343) 333-2567 · Birthday: Jan 1, 1950 · Anniversary: Jul 22, 2000"` — 89 characters. Slicing to 80 lands exactly at `"...Anniversary: Jul"` (character 80 is the "l" in "Jul") — confirmed by manual count, not guessed.

**This is a direct, unintended consequence of B10r's own change**, not an unrelated pre-existing bug: the 80-char limit was never a problem before because contacts snippets only ever held email+phone (rarely over 40 chars). Adding Birthday/Anniversary text made snippets long enough to collide with a limit nobody had reason to touch until now.

**Second site, same defect, found by inspection rather than live reproduction:** `naavi-voice-server/src/index.js:2236`'s `arch1HandlePersonLookup()` (voice's independent duplicate, per B10t) does the identical `r.snippet.slice(0, 60)` — an even tighter limit, so voice callers are more exposed to this than mobile.

## 2. Ownership / architecture (Phase 1A)

Both files were already identified in B10r's Phase 1A (Addendum 2) as the two independent "Level A deterministic" duplicates (`handlePersonLookup` mobile-reachable via `naavi-chat`, `arch1HandlePersonLookup` voice-only, per B10t). No new duplication is created by this fix — both already exist; this only adjusts a constant in each. Neither file was previously authorized in B10r's scope (both were explicitly listed "not authorized" in the original and supplemental Phase 3 reviews) — this addendum is what brings them into scope, narrowly.

## 3. Proposed fix (Phase 2)

Raise both slice limits, proportionally, rather than remove truncation entirely (a very long address or org name could still make an unrelated field balloon the snippet — truncation as a safety net stays, just no longer at a limit already proven too tight):

- `intentHandlers.ts:501`: `80` → `160`
- `naavi-voice-server/src/index.js:2236`: `60` → `120` (keeping the same 3:4 ratio to mobile's limit that already existed)

No other line in either file changes. No new duplication, no new file, no API/schema/cron change — a one-constant change in each of two already-identified files.

**Risk: Low.** Purely a display-length constant; does not change what data is fetched, how it's classified, or any decision logic. The only way this could regress something is if a *combination* of fields for some contact still exceeds even the new limit — acceptable, since that was already a pre-existing failure mode (just triggered less often).

## 4. Phase 3 — full review, or waiver?

Given the size and risk profile (a single numeric constant in each of two files, no logic change), this may be a candidate for the waiver precedent already used once in this project (F10a — "Phase 3/6 ChatGPT review was explicitly waived after Wael asked for a direct risk assessment, Low risk, no Protected Core touched"). Your call — full external review, or proceed directly to implementation on a Low-risk self-assessment.

**Wael's decision (2026-07-22): waiver confirmed.** External ChatGPT review is explicitly skipped for this addendum, following the F10a precedent — the change is a single numeric truncation-limit constant in each of two already-identified files (`intentHandlers.ts:501`, `naavi-voice-server/src/index.js:2236`), no logic change, no new file, no API/schema/cron change, no Protected Core file touched. Proceeding on the Low-risk self-assessment in §3 above, per Wael's own explicit go-ahead as Product Owner (Governance §10) — this is a phase-gate decision recorded on his authority, not a self-assigned waiver.

## 5. Status

**Resolved.** §4's waiver is confirmed and on record. Phase 4 (Implementation) already proceeded on this basis — both fixes are coded: `intentHandlers.ts:501` (80→160, confirmed by direct diff, currently uncommitted in `naavi-app`'s working tree) and `naavi-voice-server/src/index.js:2239` (60→120, committed `2242aca` and pushed to `origin/main`). No Phase 5/6 documents exist for this addendum specifically — its evidence is this document plus the two diffs above, consistent with the waived, lighter-weight process this decision authorizes. Outstanding: confirm the `naavi-chat` Edge Function (which contains `intentHandlers.ts`) has actually been redeployed to staging with this fix — not yet independently verified.
