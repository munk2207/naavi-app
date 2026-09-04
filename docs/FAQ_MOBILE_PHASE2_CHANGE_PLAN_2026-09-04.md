# FAQ — Mobile Stage, Phase 2: Change Planning

**Date:** 2026-09-04
**Item:** F25 Stage 2
**Phases 0, 1, 1A:** all approved by Wael, 2026-09-04
**Architecture Reference:** `2026.09.03.17` (per Phase 1A)
**Governance:** v4.3, Phase 2. **No code written.**
**Status:** amended 2026-09-04 per Phase 3's seven mandatory changes — **see §6a**, which is the
operative version of this plan. §1 and §5 are updated to match; everything else stands as approved.

**Wael's decisions carried into this plan:**
- **Q1** — matching runs **on Send**; no paid AI call while typing
- **Q2** — no connection → no suggestion; **no offline fallback copy**
- **Q3** — identity: **verified user id when authenticated, IP otherwise**, checked **after the
  cache and before the rate limit**
- **Q4** — extends F25; no new holding-list ID
- **1A-2** — Phase 8 records that mobile ran a *second matcher*, not merely a second copy

---

## 1. Files that will change

| # | File | Class | Change |
|---|---|---|---|
| 1 | `supabase/functions/match-faq/index.ts` | **Backend** | optional identity resolution; rate-limit key becomes the resolved subject; **both rate-limit DB errors checked and logged (A1)**; **counting moves to the atomic function (A2)** |
| 2 | `supabase/migrations/20260904000000_faq_rate_limit_subject.sql` | **Database** | rename `faq_rate_limit.ip_hash` → `subject_hash`; **add the atomic increment function (A2)** |
| 3 | `app/contact.tsx` | **UI** | match on Send; remove the typing debounce; drop the `lib/faq` import |
| 4 | `app/report.tsx` | **UI** | the same |
| 5 | `lib/faq.ts` | **Shared Logic** | **deleted** |
| 6 | `tests/catalogue/faq.ts` | **Tests** | replace the test that asserts `lib/faq.ts` holds 12; add coverage for the new paths |

**No dependency changes.** No `package.json` is touched.

**Deliberately NOT in this plan:** `app.json`'s `versionCode` and `app/settings.tsx`'s version
text. Those belong to whoever builds the AAB, Phase 0 put the Play release out of scope, and build
332 is currently in Google's review.

### Why each

**1 — `match-faq`.** Today the rate-limit key is `sha256(x-forwarded-for)` (`:113-114`). It becomes:
resolve a subject, then key on that. **Placement is fixed by Wael's approval** — after the cache
read (`:95-109`), before the limiter (`:112`), so a cached answer pays neither the model call nor
the 132 ms verification.

Resolution order, and the middle rule is the one that matters:
1. A bearer token that **verifies** → `sha256('user:' + user.id)`
2. A bearer token equal to the **anon key**, or absent, or invalid → **no identity**
3. No identity → `sha256('ip:' + firstForwardedFor)`, exactly as today

**⚠️ Rule 2 exists because the anon key is identical on every install** (`app/contact.tsx:86` falls
back to it). Treating it as an identity would put every signed-out app user in one bucket — worse
than IP, not better.

**The function must remain fully usable with no credentials.** The public website sends none, and
Phase 1A fixed this as a binding constraint: identity changes which bucket a caller is counted in,
never whether they are served.

**2 — the migration.** The column will hold a user hash or an IP hash. `ip_hash` would then be a
false name on a Protected Core table.

**This is the smallest change that is not a lie, and the alternative is worth stating so Phase 3 can
overrule me.** Storing `sha256('user:'+id)` in a column still called `ip_hash` needs **no migration
at all** and is strictly smaller under Rule 0.3. I am not proposing it, because a name that
misdescribes its contents is the exact failure class this project has already paid for twice — §2d's
one-word *"cron-driven"* cost four months and three migrations, and §0b's recorded service name
resolved to nothing. The table is two days old, holds ephemeral counters that expire with their
window, and is read by exactly one function, so the rename is close to free today and never gets
cheaper.

**3, 4 — the two screens.** The debounced `suggestFaq` call is **removed**, not retuned (Wael's Q1).
Send acquires a check that mirrors the website's exactly (`report.html:293-320`): ask once per
submission attempt; only a `matched` status with matches stops the send; `no_match`, `unavailable`,
a network error or a timeout all fall through and submit. A second press always sends.

**5 — `lib/faq.ts` deleted.** The point of the stage. Both its exports go: `suggestFaq` is replaced
by `match-faq`, and `faqUrl` by the `url` each match already carries in the response.

**6 — tests.** Per Phase 1A §4d and Rule 15a.

---

## 2. Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| **Mobile** | **Yes** | Two screens change; one file is deleted. Requires an AAB and the full gate sequence to reach users |
| **Voice** | **No** | Freshly verified at Phase 1A: `grep -ric "faq"` returns 0 in all six `naavi-voice-server/src/` files, on both branches. No equivalent implementation exists |
| **Shared Core** | **Yes** | `match-faq` gains optional identity resolution. No other function changes; `get-faq`, `manage-faq` and `check-staff` are untouched |
| **Database** | **Yes** | One column rename on `faq_rate_limit`. No table is created or dropped; no other table is altered |
| **Cron** | **No** | No scheduled job is created, changed or removed. Verified against CLAUDE.md's "one cron job per purpose" check: nothing is being added, so nothing can duplicate |
| **API contracts** | **Yes** | `match-faq`'s **request** shape gains an optional `Authorization` header. Its **response** shape is unchanged — Stage 1 fixed it for exactly this reuse |
| **Tests** | **Yes** | `tests/catalogue/faq.ts` |

**Duplicated-capability statement.** The Reference records FAQ content as Duplicated (§5a Priority
1d), and Phase 1A found a second, undocumented duplication: the matcher itself. **This stage changes
both sides at once by deleting one of them** — there is no half-fix available, because the mobile
implementation is what is being removed.

---

## 3. Mandatory Architecture Impact Checklist

- **Does this change modify Shared Core?** **Yes** — `match-faq`, one function, additively.
- **Does this change modify an Entry Point?** **Yes** — `app/contact.tsx` and `app/report.tsx`. Both
  become *more* like entry points: they collect input, call one function, render what returns. The
  matching logic they contain today is deleted rather than moved.
- **Does this change introduce new duplication?** **No.** The Send-gate glue is ~40 lines repeated
  across the two screens, mirroring the same repetition already accepted between `report.html` and
  `contact.html` (Stage 1 Phase 6 §2). **Named here rather than discovered:** if a reviewer wants it
  shared, the natural home is a small hook, and that is a decision, not an oversight.
- **Does this change eliminate existing duplication?** **Yes — this is the point.** Content copies
  2 → 1. Matching implementations 2 → 1. §5a's Priority 1d row closes.
- **Does this change modify Protected Core?** **Yes — two of the twelve** (Phase 1A §4a):
  **API contracts** (a request shape that now reads an optional header) and **Permissions** (the
  boundary between an anonymous and an identified caller). **Authentication is NOT affected** — no
  new way to become a user, no capability granted by being one. **Database schema** is touched by
  the rename and is reviewed as a migration separately, per §4's own note.

---

## 4. Regression Impact

**Fixed checklist — every row answered explicitly.**

| Function | Affected? | Basis |
|---|---|---|
| Voice commands | **No** | No file in `naavi-voice-server` changes; no FAQ logic exists there |
| Geofencing | **No** | No change to `useGeofencing.ts`, `report-location-event` or `action_rules` |
| Gmail integration | **No** | No change to `sync-gmail`, `extract-email-actions` or `harvest-attachment` |
| Calendar integration | **No** | No change to calendar functions or `lib/calendar.ts` |
| Reminders | **No** | No change to `check-reminders` or the `reminders` table |
| SMS / call alerts | **No** | No change to `send-sms`, `evaluate-rules` or channel fan-out |
| Onboarding | **No** | No onboarding file changes. `app/help.tsx` is untouched and keeps opening the website |
| **Staging build** | **Yes** | Mobile code changes, so a staging APK is produced and tested before any production AAB |

**Regression Matrix — consumer traces, produced by searching.**

**`match-faq`** — modified. Consumers found by search:
- `mynaavi-website/report.html:271` and `contact.html` — **live, in production, sending no
  credentials.** These must keep working unchanged. This is the highest-value regression in the
  plan: a mistake here breaks a working public surface to add a new one.
- `tests/catalogue/faq.ts` — five 3-trial live cases plus source assertions
- `app/contact.tsx`, `app/report.tsx` — **new** consumers

**`faq_rate_limit`** — column renamed. Consumers found by search:
- `supabase/functions/match-faq/index.ts:118, 132` — **the only reader and the only writer.**
- No other function, no cron, no client. RLS denies every client role, so no external path exists.

**`lib/faq.ts`** — deleted. Consumers found by search:
- `app/contact.tsx:31`, `app/report.tsx:32` — both rewritten in this plan
- `tests/catalogue/faq.ts:568` — rewritten per Phase 1A §4d
- Comment-only references in `build-faq.js` and `manage-faq/index.ts` — **prose, not code.** They
  describe the drift incident and stay accurate after the file is gone; they are cited here so a
  reviewer does not read the grep hits as missed consumers
- `.claude/worktrees/agent-af7f1550a5a91abbc/` — a **stale worktree**, not a live path

**`app/help.tsx`** — **not** a consumer. It opens `mynaavi.com/faq` and imports nothing from
`lib/faq.ts`. Verified, because the file name makes it look like one.

**No consumer was found that is not listed above.**

---

## 5. Risk classification

**Overall: Medium.**

| Risk | Level | Mitigation |
|---|---|---|
| A mistake in `match-faq` breaks the live website's support forms | **Medium** | Staging first; the existing web 3-trial tests must pass unchanged before anything ships; the no-credentials path is tested explicitly, not assumed |
| Identity resolution rejects a caller instead of falling through | **Medium** | Resolution is fail-open by construction: any failure to identify yields *no identity* and falls to the IP path. Never an error, never a refusal |
| The anon key treated as an identity | **Medium** | Explicitly excluded in §1 rule 2, and a test asserts the anon key does not create its own bucket |
| Column rename breaks the only reader | **Low** | One function, one deploy, ordered schema-then-code per Architecture Reference §0d |
| Suggestions disappearing while typing reads as a regression to a user | **Low** | Deliberate, Wael's Q1. Worth a line in the release notes rather than a code change |
| Two surfaces on one matcher | **Low** | Intended. Recorded in Phase 1A §4b as a standing obligation: `match-faq` now needs a "who else calls this?" check on every future change |
| Mobile release process | **Medium** | Not shortcut. Full gate sequence; a separate approval; AAB 332 is in review |
| **The limiter stops working and nobody notices** | **Medium** | Was already true and silent (A1). Both errors now checked and logged at error level; the request proceeds so availability is preserved |
| **The per-user ceiling under-counts under concurrency** | **Medium** | Was already true (A2), and the app is the population most able to trigger it. Replaced by one atomic statement returning the resulting count |
| **Someone later removes `--no-verify-jwt`** | **Low but total** | Would 401 the live website *before the function runs*. Recorded as a constraint in §6a A4 rather than left to the deploy wrapper's default |
| **A customer stuck on Send by a slow match** | **Low** | 4 s timeout, expiry falls through to sending (A5) |

---

## 6. Build and deploy order

Schema before code, per Architecture Reference §0d — reversed, the function reads a column that
does not exist and PostgREST fails the whole query.

1. Migration → **staging**; `npm run drift:check -- --write-baseline` to record the intentional
   difference
2. `match-faq` → **staging**; the web forms re-tested against staging **before** any mobile work is
   trusted
3. Tests written and green
4. **Stop. Wael approves production.** Then migration + `match-faq` → production
5. Staging APK, tested on device
6. **Stop. Wael approves the production AAB.** Then the three gates, then the build

**No production deploy and no AAB without Wael's explicit instruction.**

---

## 6a. Amendments mandated by Phase 3 (2026-09-04)

Phase 3 returned **Approved with 7 Mandatory Changes**. All seven are resolved here. **No new
files** — every change lands in files already listed in §1.

### A1 — the rate limiter fails open silently · **fix now, fail open LOUDLY**

Wael's decision: *"log rate-limit DB failures but preserve FAQ availability."*

`match-faq:117-135` discards the error on both database calls, so a failed read yields `used = 0`
and the limit never trips. Both errors are now checked. **On failure the request proceeds** — a
transient database problem must not block a real customer from the FAQ — **and it logs at error
level naming the function, the operation and the message**, per CLAUDE.md Rule 21.

**Fail closed was considered and rejected**, in the document rather than silently: refusing real
customers to guard against a cost that only materialises during a database outage is the wrong
trade for a support form.

### A2 — the counter loses updates · **fix now, atomically**

Wael's decision: *"make the counter atomic using the proven database increment pattern."*

`select` → compute → `upsert` is replaced by a single statement that increments in place:

```
INSERT INTO faq_rate_limit (subject_hash, window_start, request_count)
VALUES ($1, $2, 1)
ON CONFLICT (subject_hash, window_start)
DO UPDATE SET request_count = faq_rate_limit.request_count + 1
RETURNING request_count
```

The returned count is what the ceiling is tested against, so *"did this request cross the
threshold"* is answered by the same statement that produced the count — the shape
`record_voice_pin_failure()` already uses (Architecture Reference §2c), for the same reason.

**This lands in the migration §1 item 2 already creates**, as a Postgres function so the atomicity
cannot be undone by a later client-library edit.

### A3 — the deploy window · **single rename, no two-migration sequence**

Wael's decision. With A1 fixed the window is loud rather than silent, and a two-migration
backward-compatible dance costs more than it buys on a table whose rows expire within five minutes.

### A4 — `--no-verify-jwt` must be preserved · **written constraint**

`match-faq` **must stay deployed with `--no-verify-jwt`.** With gateway JWT verification on,
`mynaavi.com/report` and `/contact` — which send no credentials — would receive a 401 **before the
function runs**, and no amount of correct in-function fail-open would help. `scripts/deploy-edge-function.js:214`
passes the flag; this is recorded so nobody later "tightens" it.

### A5 — mobile timeout with submit fall-through · **written constraint**

The app's `match-faq` call is wrapped in a timeout of **4 seconds**, using the established
`lib/invokeWithTimeout.ts` pattern. **Expiry falls through to sending the ticket**, identical to a
network error, a `no_match`, an `unavailable` or a 429. A customer must never be held on a Send
button by a suggestion lookup.

### A6 — skip verification when no real token exists · **written constraint**

Identity resolution checks for a usable token **before** calling `getUser`. No `Authorization`
header, or a header carrying the anon key, means **no identity** — resolve to the IP path and make
no auth call. Without this every website request pays the measured 132 ms for a token nobody sent.

### A7 — 3 trials, cache cleared · **written constraint**

No prompt changes in this stage, so the Non-Determinism Rule is not formally triggered. **The mobile
positive-control tests behave as though it were**: each runs 3 independent trials with the
distribution reported, **deleting the cache row before each** — otherwise one model answer is
replayed three times and proves nothing. A phrase returning 2 of 3 is a finding, not a re-run.

### F1 — Phase 4 is not blocked on the live suite · **Wael's ruling**

*"Do not block Phase 4 on running the live suite. Phase 5 must run the real suite against the
explicitly verified intended environment. Do not run it accidentally against production."*

**Phase 5 must therefore state the environment banner it observed before trusting any result.**
`SUPABASE_URL` in `tests/.env` currently names **production**, and `--grep` does not prevent
fixtures performing live DELETEs.

### F2 — separate item · **Wael's ruling**

*"Cross-environment classifier reproducibility is a Stage 1/content issue, not part of this mobile
change."* Recorded in the Stage 1 Phase 8 merge record's open-items list. **Out of scope here.**

### Part G — the Stage 1 record · **corrected before Phase 4, as instructed**

Done 2026-09-04, commit `28b40f9`: retrospective Phase 8 merge record created, Phase 7's superseded
status banner added with its original text preserved, holding-list row and FOR WAEL'S EYES line
rewritten.

---

## 7. Not in this plan

- Any website or staff-portal change
- Any voice change
- Any change to `match-faq`'s **response** contract
- A new FAQ browsing screen in the app
- `versionCode` / version-text bumps
- Architecture Reference edits — Phase 8, per the Reference-Document Read-Only Rule
