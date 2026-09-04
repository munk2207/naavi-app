# FAQ — Mobile Stage, Phase 1A: Architecture Completeness Review

**Date:** 2026-09-04
**Item:** F25 Stage 2
**Phase 0:** approved with 4 decisions, 2026-09-04 · **Phase 1:** approved by Wael, 2026-09-04
**Governance:** v4.3, Phase 1A. Mandatory — this change affects the Protected Core (§3 below).

**Architecture Reference version used for this review: `2026.09.03.17`** — revision 17, dated
2026-09-03, landed at F25 Stage 1 Phase 8. Per the Version Verification requirement this must be
re-confirmed as current before Phase 8 merge; if a newer revision exists by then, its effect on the
assumptions below must be evaluated explicitly rather than assumed absent.

---

## 1. The required answers

### What is the architectural owner of the affected capability?

**Shared Core** — `match-faq`, per §2 of the Reference. Unlike Stage 1, this question is now
answerable *from* the Reference rather than by fresh investigation, because Stage 1's Phase 8 added
the rows. That is the forcing function working.

### Is the capability Shared Core, Duplicated, or Platform-specific?

**The matcher is Shared Core. The FAQ content is currently Duplicated — two copies — and this
stage closes it to one.**

| | Today | After |
|---|---|---|
| Matching implementations | **2** — `match-faq` (Shared Core) and `suggestFaq` (`lib/faq.ts`, mobile-only) | **1** |
| Content copies | **2** — the database, and `lib/faq.ts`'s 12 entries | **1** |
| Consumers of `match-faq` | website `report.html`, `contact.html` | + `app/contact.tsx`, `app/report.tsx` |

**This is NOT an ownership change.** `match-faq` already owns matching and keeps owning it; mobile
becomes a second *consumer*. §4's Ownership Change Rule therefore does **not** apply, and no
separate architectural approval is required on that ground. *(Stated explicitly because Stage 1 did
need one, and the difference between the two stages is easy to miss.)*

### If duplicated, were all documented implementations investigated?

**Yes — and the Reference documents one of the two.** §5a's Priority 1d row records the *content*
duplication and names `lib/faq.ts` as the surviving copy. Both were investigated (Phase 1 §2).

### Which were investigated and which were not?

All were. See §2 below, every bullet provenance-tagged.

### Does the documented problem scope match the Architecture Reference?

**Almost — one gap, recorded in §3.** The Reference records that `lib/faq.ts` is a surviving copy
of the *content*. It does not record that mobile also runs an *independent matcher with different
semantics*.

### Is any documented implementation excluded from the investigation?

**None.**

---

## 2. Cross-Repository Verification

Every bullet carries a provenance tag, per the Verification Provenance Rule.

**Mobile — `munk2207/naavi-app`**
- **Freshly verified this session — evidence:** `app/contact.tsx:31` and `app/report.tsx:32` are the
  only live importers of `lib/faq.ts`. A repository-wide grep excluding `node_modules` and `.git`
  returns those two, one test (`tests/catalogue/faq.ts:568`), two comment references, and a **stale
  worktree** under `.claude/worktrees/` which CLAUDE.md already records as a leftover.
- **Freshly verified this session — evidence:** both screens already hold an authenticated session
  and already send `Authorization: Bearer <session.access_token>` to an Edge Function —
  `app/contact.tsx:58-61, 85-93`; `app/report.tsx:77, 106-114`.

**Voice — `munk2207/naavi-voice-server`**
- **Freshly verified this session — evidence:** `grep -ric "faq"` across all six files in
  `naavi-voice-server/src/` returns **0** in every one. No FAQ logic exists on either branch.
- **Out of scope with nothing to justify:** there is no equivalent implementation, so there is no
  parallel change to make.

**Shared Core — `supabase/functions/`**
- **Freshly verified this session — evidence:** `match-faq/index.ts` contains no `getUser`, no
  `user_id`, and no authorization read of any kind. Its only caller identity is
  `sha256(x-forwarded-for)` at `:113-114`.
- **Freshly verified this session — evidence:** the cache is consulted at `:95` and returns at
  `:109`, **before** the rate-limit block at `:112`.

**Website and staff portal**
- **Freshly verified this session:** both call `match-faq` / `get-faq` over HTTP and hold no
  matching logic of their own. Neither changes in this stage.

**No consumer was found that is not listed above.**

---

## 3. Architecture Drift Rule verdict

**Outcome 3 — one narrow staleness, predating this work.**

§2's `match-faq` row says it is *"consumed by the website's two support forms today"* and §5a's
Priority 1d row names `lib/faq.ts` as a surviving content copy. **Neither records that mobile runs
a second, independent matching implementation with different semantics** — a 3-word minimum
(`lib/faq.ts:118`) and a score threshold no single word can clear (`:116`). A reader consulting the
Reference would conclude the app simply lacks answers, when it also matches by a different rule.

**Under Governance v4.3 implementation does not stop.** The finding is recorded here and reconciled
at Phase 8 with Wael's approval. **Continuing is neither unsafe nor impossible to define** — Phase 1
measured the real behaviour directly.

**Convenient, and worth naming so nobody mistakes it for diligence:** this stage *deletes* the
undocumented implementation, so the Phase 8 edit that records it is the same edit that closes it.
The row would have needed writing either way.

---

## 4. The four questions Phase 1 deferred

### 4a. Is adding an optional authenticated identity to `match-faq` a Protected Core change?

**Yes. Two of the twelve areas, and the full review applies.**

- **API contracts** — §4 covers *"every Edge Function's request/response shape."* Reading an
  `Authorization` header the function has never read changes its request shape.
- **Permissions** — the boundary between an unauthenticated public caller and an identified one is
  exactly what this touches.

**Authentication is NOT affected.** The Reference's §4 maps that area to `lib/supabase.ts`,
`naavi-chat`'s JWT resolution and voice's caller-phone resolution. This adds no new way to become a
user and grants no capability by being one.

**⚠️ The binding constraint, and it must survive into Phase 2:** `match-faq` must remain fully
usable with **no credentials at all.** The public website depends on it. Identity is *optional* —
it changes which bucket a caller is counted in, never whether they are served.

### 4b. Does mobile becoming a second consumer need anything beyond the §2 row?

**No new architectural machinery.** The contract was fixed in advance for exactly this — Stage 1's
Phase 2 §5 named three properties as expensive to change later, and Phase 1 confirms none needs
changing. The §2 row's consumer list and §5a's Priority 1d row are updated at Phase 8.

**One obligation this does create:** with two surfaces on one matcher, a change to `match-faq`'s
behaviour now reaches the app and the website simultaneously. That is the point — but it means
`match-faq` joins the set of functions where "who else calls this?" must be asked on every change.

### 4c. The rate-limit identity — measured, not estimated

**Measured 2026-09-04**, isolating the cost cleanly: the same function, the same payload, the same
network path, differing only in whether a token is present. `check-staff` returns at `:11` without
a token and calls `admin.auth.getUser()` with one.

```
check-staff, NO token   (no getUser) : median 130 ms   (9 samples)
check-staff, bad token  (getUser)    : median 262 ms   (9 samples)
                    verification cost : 132 ms
```

Against `match-faq`'s measured uncached path of **~1265 ms**, that is roughly **10%**.

**Recommendation: option (a) — verified user id when a token is present, IP otherwise.** Option (c)
(local signature verification) saves the 132 ms but requires handling the project JWT secret inside
a public, unauthenticated function — a materially larger security surface for a tenth of a call
that already takes over a second. **Phase 2 decides; this is a recommendation.**

**⭐ Placement is load-bearing, and it falls out of §2's cache finding.** The identity check must sit
**after** the cache lookup and **before** the rate-limit check. Placed there, a cached answer costs
neither the model call nor the 132 ms — which is the same reasoning `match-faq:112` already states
for the limiter itself: *"only for calls that will actually cost money."*

**⚠️ The anon-key trap, restated because getting it wrong is worse than doing nothing.**
`app/contact.tsx:86` falls back to `SUPABASE_ANON` when there is no session, and that value is
identical on every install. A design that keys on "whatever bearer token arrived" puts **every
signed-out app user in one bucket** — strictly worse than IP. The anon key must resolve to *no
identity*, falling through to the IP path.

### 4d. What replaces `tests/catalogue/faq.ts:568`?

That test asserts `lib/faq.ts` holds exactly 12 entries. **It does not detect the staleness; it
records it as expected.** It fails the moment the file is deleted, which is correct behaviour, and
it must be *replaced* rather than removed:

1. **No file imports `lib/faq.ts`, and the file does not exist** — the deletion is the point.
2. **Both screens call `match-faq`** and neither contains matching logic.
3. **Every slug `match-faq` can return is published** — this preserves what :568 was actually
   protecting (a deep link that resolves), which after this stage holds by construction rather than
   by a hand-maintained list.

---

## 5. Verdict

**Technical Investigation Review: PASS** (Phase 1).
**Architecture Completeness Review: PASS**, with the Outcome 3 finding in §3 carried to Phase 8.

**APPROVED WITH 2 DECISIONS — Wael, 2026-09-04:**

1. **Option (a) approved** — verified user id when authenticated, IP fallback otherwise; the
   identity check sits **after the cache and before rate limiting**. The placement is part of the
   approval, not an implementation detail.
2. **Phase 8 reconciliation approved to record §3's finding** — that mobile ran a second matcher
   with different semantics, not merely duplicated FAQ content.

Proceed to Phase 2.

**No ownership-change approval is required for this stage** (§1), unlike Stage 1.

**No implementation may begin. Phase 2 is not authorised by this document.**
