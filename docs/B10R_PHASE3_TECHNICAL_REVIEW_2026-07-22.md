# B10r — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.7, Phase 3. Filed retroactively per `feedback_governance_every_phase_needs_its_document` — the original review below was delivered directly via chat (Wael relaying ChatGPT's verdict) without a corresponding doc file at the time; this file makes it a real record and adds the supplemental review §2 requires.

---

## 1. Original Phase 3 review (2026-07-22) — for the record

**Subject:** `docs/B10R_PHASE2_CHANGE_PLAN_2026-07-22.md`.

**Verdict, as delivered:**

| Review Area | Verdict |
|---|---|
| Assumptions | PASS |
| Architecture | PASS |
| Isolation | PASS |
| Hidden Coupling | PASS (one documented, accepted coupling — see below) |
| Implementation Strategy | PASS |

**Overall Recommendation: APPROVE.**

**Implementation Boundaries authorized:**

| File | Authorized change |
|---|---|
| `supabase/functions/global-search/adapters/contacts.ts` | Add birthday/anniversary retrieval, formatting helper, snippet generation, metadata fields. |
| `supabase/functions/get-naavi-prompt/index.ts` | Add prompt guidance establishing Contacts as authoritative when Contacts and Calendar information conflict. |
| `tests/catalogue/session-2026-07-22-b10r-contact-birthdays.ts` (new) | Regression tests per the Test Plan. |
| `tests/catalogue/prompt-regression.ts` | Prompt regression covering Contacts vs. Calendar authority. |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | Update after successful completion. |

**Not authorized:** `lookup-contact/index.ts`, `assistant-fulfillment`, `calendar.ts`, mobile formatter, voice formatter, Shared Core refactoring, duplication cleanup, architecture consolidation, any additional Protected Core modifications.

**Hidden coupling noted and accepted:** every consumer of `contacts.ts`'s output continuing to forward `snippet` is a real but currently-true assumption; classified as acceptable documented coupling, not a rejection reason, since the Regression Matrix already traces every consumer and any future change to that would itself require governance review.

**Deferred, not decided:** whether the mobile home-brief widget (`lib/calendar.ts`'s `fetchUpcomingBirthdays`) should also move from Calendar to Contacts — explicitly out of scope for B10r.

Phase 4 proceeded on this authorization.

---

## 2. Supplemental review requested (2026-07-22) — Phase 1 fast-path enrichment

**Why this is supplemental, not covered by §1's authorization:** during Phase 4, live testing surfaced that the reported bug's own example contact (Fatma Elmehelmy) is MyNaavi-labeled. MyNaavi-labeled contacts get cached into the `community_members` table, and `contacts.ts` has a "Phase 1" fast path (lines ~504-584 pre-addition) that returns cached DB rows *before* ever reaching the Phase 2 live People API call §1 authorized adding `birthdays`/`events` to. That means, as originally authorized, **the fix would not have actually fixed the demonstrated case** — a Phase-1 hit never reaches the enriched Phase 2 code at all. This was raised to Wael directly (not implemented silently) and approved verbally before writing code; this document is the formal record §1's process expects.

### 2.1 Implementation strategy: exact code

**New function added**, immediately after `contactDateFacts` in `contacts.ts`:

```ts
async function fetchPersonDateFacts(
  accessToken: string,
  resourceName: string,
): Promise<{ birthday: string | null; anniversary: string | null } | null> {
  try {
    const url = new URL(`https://people.googleapis.com/v1/${resourceName}`);
    url.searchParams.set('personFields', 'birthdays,events');
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const person = (await res.json()) as Person;
    return contactDateFacts(person);
  } catch (err) {
    console.warn('[contacts-adapter] fetchPersonDateFacts failed:', err);
    return null;
  }
}
```

**The Phase 1 fast-path return block is extended** (previously: sort, slice, return — no enrichment):

```ts
if (communityHits.length > 0) {
  console.log(`[contacts-adapter] Phase 1: ${communityHits.length} community hit(s) for "${q}"`);
  communityHits.sort((a, b) => b.score - a.score);
  const topHits = communityHits.slice(0, ctx.limit);

  try {
    const { data: enrichTokenRow } = await ctx.supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', ctx.userId)
      .eq('provider', 'google')
      .maybeSingle();
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
          hit.snippet = [
            hit.snippet || null,
            birthday ? `Birthday: ${birthday}` : null,
            anniversary ? `Anniversary: ${anniversary}` : null,
          ].filter(Boolean).join(' · ');
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

### 2.2 Design decisions, stated explicitly

- **Bounded cost, not a repeat of Phase 2.** This only runs on an actual Phase 1 hit — by construction, a name/email/phone match against the `community_members` cache, which per Wael's own account holds a small, deliberately curated set (10 contacts, per his MyNaavi label count), not the 238-contact full address book. It is one extra `people.get` call per hit (typically 1 hit for a specific-name query), not a re-fetch of all connections.
- **Graceful degradation on every failure path.** No refresh token → skip enrichment, return unenriched hits (today's behavior). Token exchange fails → same. Individual `people.get` call fails or returns non-OK → that one hit stays unenriched, others are unaffected (`Promise.all` over independent per-hit closures, no shared failure state). The outer `try/catch` ensures any unexpected error still returns `topHits` rather than throwing.
- **No change to what triggers Phase 1 vs Phase 2.** The community-DB-first short-circuit logic itself is untouched; only what happens *after* a Phase 1 hit is found gains a step.
- **Confirmed not to affect other capabilities:** `lookup-contact/index.ts` (SMS/WhatsApp/email recipient resolution) is a separate file that never calls into this function or this branch of `contacts.ts` — traced directly, not assumed, in the discussion preceding this document. Calendar, Gmail, Lists, Reminders adapters are unrelated files.
- **Real, accepted trade-off, not zero-impact:** every Phase 1 hit — not just birthday-related queries — now takes one small extra network round trip (~100-300ms) and has one more failure mode (mitigated by the fallback above). This applies only to the small MyNaavi-labeled set, not general contact search.

### 2.3 Implementation Boundaries Confirmed (supplemental)

- **Authorized file:** `supabase/functions/global-search/adapters/contacts.ts` only — same file §1 already authorized, this extends the *scope* of change within it (Phase 1 path, not just Phase 2 path).
- No additional files are approved beyond what §1 already lists.
- No opportunistic refactoring — the Phase 1 loop's existing scoring/matching logic is untouched; only the post-hit return path gained the enrichment step.
- No architectural changes beyond this — ownership (Shared Core), duplication status, and Protected Core classification (API contracts, per Phase 1A) are unchanged by this addition.

### 2.4 Regression Matrix (this addition specifically)

Every caller of the Phase 1 return path is the same set already traced in Phase 2 for the Phase 2 path (mobile injection, voice injection, mobile UI card) — this addition changes what data is *in* the returned `SearchResult`, not who consumes it or how. No new consumer introduced.

---

## 3. Status

Supplemental review requested and received 2026-07-22 — **APPROVE** across all five review areas (Assumptions, Architecture, Isolation, Hidden Coupling, Implementation Strategy), plus Governance Compliance. No revisions requested. Authorization confirmed scoped to `contacts.ts` only, extending the Phase 1 cache-hit return path — all of §1's original exclusions (`lookup-contact/index.ts`, `assistant-fulfillment`, `calendar.ts`, mobile/voice formatters, architecture consolidation) remain unauthorized.

Per the Phase-Gate Approval Rule, this reviewer verdict is a recommendation, not authorization — Wael's own explicit, separate go-ahead is required before Phase 5 (Evidence Package) begins.
