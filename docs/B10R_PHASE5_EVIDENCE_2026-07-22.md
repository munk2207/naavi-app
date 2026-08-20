# B10r — Phase 5: Evidence Package

**Date:** 2026-07-22
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.7, Phase 5
**Covers both scopes:** original B10r (`contacts.ts`, `get-naavi-prompt`, Phase-1 fast-path enrichment) and Addendum 2 (`calendar.ts`), each independently taken through Phase 1 → 1A → 2 → 3 with external review Approval.

---

## 1. Summary

Naavi was presenting a computed "next occurrence" year from Google Calendar's auto-generated recurring birthday/anniversary entry as if it were a person's real birth/anniversary year (e.g. "Jan 15, 2027" instead of the real "Jan 15, 1948"). Root cause had two independent parts, found across two rounds of investigation:

1. **Data gap:** `contacts.ts` never requested Google People API's `birthdays`/`events` fields, so the only source of a birthday/anniversary date was Calendar's recurring-event expansion, whose year is structurally never the origin year.
2. **Response-path gap (found during Phase 4 testing, not anticipated in the original plan):** even after fixing (1), the false year was still reachable because "Tell me about X" phrasing is intercepted by a deterministic classifier (`naavi-chat`'s Layer 2 `handlePersonLookup`, and voice's independent `arch1HandlePersonLookup`) that never invokes Claude — so a prompt-only fix could not have reached the actual bug for this phrasing. Fixed by stripping the false year at Calendar's own source instead, which reaches all four possible response paths (mobile/voice × Claude Path B/deterministic Layer 2) with one change.

---

## 2. Files changed

| File | What changed |
|---|---|
| `supabase/functions/global-search/adapters/contacts.ts` | Requests `birthdays,events` from Google People API (both `fetchConnections` and `fetchOtherContacts`); new `formatDateFact`/`contactDateFacts` helpers (never invents a year); surfaces `Birthday:`/`Anniversary:` facts in `snippet` + `metadata` at all three hit-building sites, including a new single-contact enrichment (`fetchPersonDateFacts`) for the Phase-1 community-DB fast path, which previously never carried this data at all. |
| `supabase/functions/global-search/adapters/calendar.ts` | Added `recurringEventId` to the `GoogleEvent` type; new `isRecurringBirthdayOrAnniversary` check (recurring instance + birthday/anniversary title); omits `year` from `dateStr`'s formatting only in that gated case. |
| `supabase/functions/get-naavi-prompt/index.ts` | New rule (after RULE 19's search-honesty section): Contacts is authoritative over Calendar for birthday/anniversary dates — defense-in-depth for Claude's Path B specifically. |
| `tests/catalogue/session-2026-07-22-b10r-contact-birthdays.ts` (new) | 4 regression tests — 2 contacts-side (skip cleanly, documented coverage gap), 2 calendar-side (self-contained, create/query/delete their own throwaway events). |
| `tests/catalogue/prompt-regression.ts` | 2 cases added then **removed same day** after live testing proved them invalid (see §4) — net change is a removal with an in-file explanation, not a silent deletion. |
| `tests/runner.ts` | Registered the new test file. |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | Updated B10r's entry to reflect implementation/staging-verification status; added B10t (voice's ARCH-1 duplication, architecture debt, no active defect) and B10u (`delete-calendar-event` staging slowness, unrelated pre-existing issue). |
| `docs/AI_DEVELOPMENT_GOVERNANCE.md` | Bumped to v3.7 — new Verification Provenance Rule (Phase 1A), per the side discussion this session's Phase 1A work prompted. Not part of B10r's defect fix, but shipped in the same session and worth noting in this package for completeness. |
| `CLAUDE.md` | Corrected the documented test account (`mynaavidemo@gmail.com` → `mynaavi2207@gmail.com`) — found to be wrong while setting up this work's staging tests. |

**Diff stat:** `8 files changed, 182 insertions(+), 10 deletions(-)` across the files above (excludes new doc/governance files, which are prose, not code).

---

## 3. Git Diff

Full diffs available via `git diff` against each file above. Key excerpt (`contacts.ts`'s Phase-1 fast-path enrichment, the most structurally significant single change):

```ts
if (communityHits.length > 0) {
  communityHits.sort((a, b) => b.score - a.score);
  const topHits = communityHits.slice(0, ctx.limit);
  try {
    const { data: enrichTokenRow } = await ctx.supabase
      .from('user_tokens').select('refresh_token')
      .eq('user_id', ctx.userId).eq('provider', 'google').maybeSingle();
    const enrichRefreshToken = enrichTokenRow?.refresh_token;
    if (enrichRefreshToken) {
      const enrichAccessToken = await getAccessToken(enrichRefreshToken);
      if (enrichAccessToken) {
        await Promise.all(topHits.map(async (hit) => {
          const resourceName = (hit.metadata as Record<string, unknown> | undefined)?.resource_name;
          if (typeof resourceName !== 'string' || !resourceName) return;
          const facts = await fetchPersonDateFacts(enrichAccessToken, resourceName);
          if (!facts) return;
          const { birthday, anniversary } = facts;
          if (!birthday && !anniversary) return;
          hit.snippet = [hit.snippet || null, birthday ? `Birthday: ${birthday}` : null, anniversary ? `Anniversary: ${anniversary}` : null].filter(Boolean).join(' · ');
          hit.metadata = { ...(hit.metadata ?? {}), birthday, anniversary };
        }));
      }
    }
  } catch (err) {
    console.warn('[contacts-adapter] Phase 1 birthday/anniversary enrichment failed, returning unenriched hits:', err);
  }
  return topHits;
}
```

And `calendar.ts`'s year-strip:

```ts
const isRecurringBirthdayOrAnniversary =
  !!e.recurringEventId && /\b(birthday|anniversary|bday)\b/i.test(e.summary ?? '');
const dateStr = startISO
  ? new Date(startISO).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
      ...(isRecurringBirthdayOrAnniversary ? {} : { year: 'numeric' as const }),
    })
  : '';
```

---

## 4. Tests executed

**Deployed to staging** (`global-search`, `get-naavi-prompt`) before every test run below — `xugvnfudofuskxoknhve`.

**Final clean run, 2026-07-22, against the corrected staging test account** (`mynaavi2207@gmail.com`, per CLAUDE.md's correction):

```
b10r.contacts-birthday-real-year-not-calendar-computed … SKIP (no matching contact in test account — documented coverage gap)
b10r.contacts-date-fact-format-never-fabricated … SKIP (no contact with birthday/anniversary data in test account — documented coverage gap)
b10r.calendar-recurring-birthday-anniversary-no-year … PASS (3269ms)
b10r.calendar-year-strip-false-positive-avoidance … PASS (3001ms)

4 tests — 2 passed, 0 failed, 0 errored, 0 timed out, 2 skipped
```

**Direct verification, bypassing the test framework entirely** (proves the fix independent of any test-harness assumption): created a real recurring event "DebugTest Birthday manual" on staging via `create-calendar-event`, then queried `global-search` for it directly. Result: `{"source":"calendar","title":"DebugTest Birthday manual","snippet":"Aug 1", ...}` — no year, confirming the fix works against the actual deployed function.

**Non-Determinism Rule note:** the `get-naavi-prompt` prompt change was originally paired with two 3-trial `prompt-regression.ts` cases per Governance's Phase 3 requirement. Both were found invalid during this same testing session — not a case of "trials disagreed" (the Non-Determinism Rule's usual concern), but a wrong premise: "Tell me about X" never reaches the code path (Claude's Path B) those tests were built to exercise, confirmed with real trial data (all 3 trials of both tests returned the identical deterministic-classifier fallback reply, one visibly, one as a false pass). Removed rather than left as broken or misleading coverage — see `tests/catalogue/prompt-regression.ts`'s in-file explanation. The `get-naavi-prompt` rule itself remains shipped as defense-in-depth but has no automated regression test as of this package — a real, acknowledged gap (see §6).

**Known, documented coverage gaps (Rule 15a exception path):** the two contacts-side tests skip because no contact with birthday/anniversary data exists in the automated test account — this was surfaced to Wael before implementation (not discovered after the fact) and accepted as a gap to be closed by manual verification instead (see §5).

---

## 5. Manual tests required — a completion criterion, not an optional postscript

Per the reviewer's explicit observation: these are not "nice to have" follow-ups. The defect is not considered fully closed until they're done — the automated suite's documented coverage gap (§4) means this is the only remaining verification of the original reported scenario.

1. **On staging, ask Naavi "Tell me about [a real contact with a known birthday]"** (mobile and/or voice) — confirm the stated year matches the contact's real Google Contacts birthday, not a Calendar-computed year. This is the one case automated testing cannot currently cover (no equivalent contact in the test account).
2. **Confirm a MyNaavi-labelled contact's birthday shows correctly** — this exercises the Phase-1 fast-path enrichment specifically, the part of the fix that required the most investigation (Fatma Elmehelmy, confirmed MyNaavi-labelled per your screenshot, is the natural candidate if she's reachable from wherever you test).
3. **Confirm a genuine one-time "X's Birthday Party" event you create yourself still shows its real year** — spot-checks the false-positive-avoidance design decision in real usage, not just the automated test's synthetic event.

---

## 6. Rollback instructions

- **Edge Functions:** redeploy the pre-B10r versions of `global-search` and `get-naavi-prompt` via `npx supabase functions deploy <name> --no-verify-jwt --project-ref xugvnfudofuskxoknhve`, using the prior git commit's file contents (`git show <commit-before-this-work>:supabase/functions/...`).
- **No database/schema change** — no migration to roll back.
- **Tests:** revert `tests/runner.ts` and delete `tests/catalogue/session-2026-07-22-b10r-contact-birthdays.ts` if fully rolling back; `tests/catalogue/prompt-regression.ts`'s net change is a removal, so rollback would mean re-adding the (now-known-invalid) tests — not recommended even on rollback.
- **Docs/governance files** (`CLAUDE.md`, `AI_DEVELOPMENT_GOVERNANCE.md`, holding list) are not deployed artifacts — no rollback mechanism needed, revert via git if desired.

---

## 7. Known risks

1. **Coverage gap, not a code risk:** the exact live-evidence scenario (a named contact with a real 1948 birthday) has no automated positive-control test. Mitigated by manual verification (§5), not closed by this package alone.
2. **B10t (voice's ARCH-1 duplication)** — remains architecturally unresolved (deliberately deferred). This fix neutralizes its one known symptom but the underlying duplication (two independently-maintained copies of the same deterministic-classifier logic) persists as future risk if either side drifts again.
3. **B10u (`delete-calendar-event` slowness)** — unrelated, pre-existing, found incidentally. No risk to this fix's correctness, but worth Wael's awareness since it could affect other calendar-cleanup-dependent workflows.
4. **`get-naavi-prompt`'s new rule has no automated regression test** — it's defense-in-depth, not the load-bearing fix, but a future prompt edit could silently dilute it with nothing to catch that.
5. **Phase-1 fast-path enrichment adds latency** (one extra live People API call, ~100-300ms) to every lookup of a MyNaavi-labelled contact, not just birthday-related ones — an accepted, bounded trade-off (Phase 3 supplemental review, Approved), not a defect, but worth remembering if MyNaavi-contact lookups are ever profiled for latency complaints.

---

## 8. Status

Phase 5 complete and Approved (2026-07-22, all areas PASS). Per the reviewer's observation, §5's manual tests are a completion criterion for closing B10r, not optional — still outstanding as of this writing. Per the Phase-Gate Approval Rule, your explicit go-ahead is required before Phase 6 (Technical Review After Coding) begins; that is separate from, and does not substitute for, completing §5's manual verification before B10r itself is considered closed.
