# FAQ — Mobile Stage, Phase 5: Evidence Package

**Date:** 2026-09-04
**Item:** F25 Stage 2
**Phases 0, 1, 1A, 2, 3:** all approved by Wael. Phase 2 amended per Phase 3's 7 mandatory changes.
**Architecture Reference:** `2026.09.03.17`
**Environment:** **STAGING** (`xugvnfudofuskxoknhve`) — verified from the runner's own banner before
any result below was trusted. **Nothing has been deployed to production, and no AAB has been built.**

---

## 1. Summary

The app carried its own copy of the FAQ: 12 hand-written questions against 26 published, with a
matcher that could not clear its own threshold on a single word and returned nothing at all for text
under three words. Both support screens now ask `match-faq` — the same matcher the website uses —
**on Send**, and `lib/faq.ts` is deleted.

Two pre-existing defects in the rate limiter were fixed alongside, both approved at Phase 3: it
**failed open silently**, and its counter **lost updates under concurrency**.

---

## 2. Files changed

**Six planned in Phase 2 §1. Six delivered. Nothing beyond them.**

| File | Class | State |
|---|---|---|
| `supabase/migrations/20260904000000_faq_rate_limit_subject.sql` | Database | new, 73 lines |
| `supabase/functions/match-faq/index.ts` | Backend | +124 |
| `app/contact.tsx` | UI | +82 |
| `app/report.tsx` | UI | +88 |
| `lib/faq.ts` | Shared Logic | **deleted, −131** |
| `tests/catalogue/faq.ts` | Tests | +128 |

Commit `e83fdb3` on `main`, not pushed. The five Stage 2 phase documents are in the same commit.

---

## 3. Tests executed

### 3a. The F25 suite, in the real runner, against staging

**Not the scratch harness.** `npx tsx tests/runner.ts --grep f25.`, with `SUPABASE_URL` overridden to
staging — the runner's loader only fills variables that are unset, so the override wins.

```
════════════════════════════════════════════════════════
  Testing against: STAGING  (xugvnfudofuskxoknhve)
  GATE 1 — MOBILE / APK / AAB (Voice excluded)
════════════════════════════════════════════════════════
grep=f25. → 32 match(es)

✓ 32 passed   ✗ 0 failed   ⨯ 0 errored   ⧗ 0 timed out   ○ 0 skipped
Duration: 27.0s
```

**The banner was read before the result was trusted**, per Wael's F1 ruling and CLAUDE.md's
2026-07-20 incident. `tests/.env` names **production** by default and `--grep` does not stop the
fixtures deleting rows.

### 3b. ⭐ A2 proven under real concurrency

The claim is that the counter no longer loses updates. Measured the same way §2c measured the
voice-PIN counter it copies — 10 genuinely parallel calls against one subject:

```
10 concurrent calls returned:  1 2 3 4 5 6 7 8 9 10
distinct values: 10/10  — every caller got its own number
final stored count: 10  — correct
```

**Every caller received a distinct sequential value.** That is what guarantees exactly one caller
sees the threshold crossed. Before the fix this shape produced duplicates — §2c's record: *"3
concurrent failures recorded 2, and 5 recorded 2."*

### 3c. The binding constraint — no credentials must still work

`match-faq` must stay usable by the live website, which sends nothing:

| Call | HTTP | Result |
|---|---|---|
| **No credentials at all** | 200 | `matched`, 1 answer |
| Anon key as bearer | 200 | served |
| 200 characters of garbage as bearer | 200 | served |

**No caller was refused for who they were.** Identity decides which bucket, never whether.

### 3d. ⭐ The anon-key trap, proven closed

The risk: the anon key is byte-identical on every install, so treating it as an identity would put
every signed-out app user in one bucket — worse than the address they came from.

Two requests with **unique text** so both missed the cache and actually reached the limiter, one
with no credentials and one with the anon key:

```
buckets that changed: 1
   50b764171b30400a…  count 3
✔ ONE bucket — the anon key did NOT create an identity of its own
```

**Why unique text mattered, and it nearly fooled me:** the first version of this probe reused one
phrase, so calls two and three were **cache hits that never reached the limiter at all**. It proved
nothing and looked like it proved something. The cache sits before the limiter by design; any test
of the limiter has to defeat it.

### 3e. Full suite, against staging

```
  Testing against: STAGING  (xugvnfudofuskxoknhve)
  GATE 1 — MOBILE / APK / AAB (Voice excluded) → 607/674 case(s) selected

✓ 604 passed   ✗ 0 failed   ⨯ 1 errored   ⧗ 0 timed out   ○ 2 skipped
Duration: 582.0s
```

**⚠️ This is not 100% green and must not be reported as such.**

**The two skips are pre-existing, self-documenting coverage gaps** — `calendar.travel-planning-outcome-level-chain` needs a "dentist appointment" in the test account, and `b10r.contacts-birthday-real-year-not-calendar-computed` needs a specific named contact. Neither is F25's.

### 3e-i. ⭐ The one error is NOT F25's, and it is environment-specific

`prompt-regression.comparison-chatgpt-single-mention` — *"what's the difference between you and
ChatGPT"* must name the competitor **exactly once**. On staging it names it twice.

**Diagnosed rather than re-run until it agreed with me:**

- **Not a flake.** Re-run 3 times on staging: 3 errors out of 3.
- **F25 Stage 2 touched no prompt or chat file** — verified from commit `e83fdb3`'s own file list,
  which contains neither `naavi-chat` nor `get-naavi-prompt`.
- **Hypothesis 1, prompt staleness — DISPROVEN.** `get-naavi-prompt` is v56 on staging and v228 on
  production, which looked damning, but both were **deployed on 2026-08-27** and the ChatGPT
  reframe landed in the repo on **2026-08-14**. Both have it. The version numbers reflect deploy
  counts, not staleness.
- **Hypothesis 2, `naavi-chat` differs between environments — supported, not proven.** Staging is
  **v123, deployed 2026-09-01 04:27 EST**; production is **v292, deployed 2026-09-02 02:34 EST** —
  about 22 hours apart. I have not diffed the deployed source, so this is the likely cause and not a
  demonstrated one.

**The decisive measurement, taken directly rather than through the runner** (so no fixture ever
touched production), asking each environment the same question and counting mentions in the
`speech` field alone, exactly as the test does:

```
STAGING     speech mentions ChatGPT 2 time(s) — FAILS
            "Here's my best reading: I'm built around your personal operational life…"
PRODUCTION  speech mentions ChatGPT 1 time(s) — PASSES
            "I'm built around Robert's personal operational life…"
```

**The test passes on production and fails on staging.** Staging also prefixes the answer with
*"Here's my best reading:"* and closes with *"I can't verify this from a live source right now"* —
an uncertainty framing production does not produce. Something in staging's older `naavi-chat`
behaves differently, and it is not the FAQ.

⚠️ **My first attempt at this measurement was wrong and looked right.** It counted `ChatGPT` in the
raw response body, which contains both `speech` and `display`, and reported *both* environments
failing. The test counts `speech`. **The corrected count reverses the conclusion for production.**
Recorded because an incorrect measurement that confirms your expectation is the most dangerous kind.

**Two consequences that matter more than this one test:**

1. **F25 Stage 2 did not cause it, and cannot fix it.** Out of scope.
2. **A staging run is not equivalent to a production run.** Gate 1 has always been run against
   production for this reason. This is the mirror of [[B11h]] — an environment difference invisible
   to every check this project owns, found only because a test happened to sit on top of it.

**Per CLAUDE.md's two-hypothesis cap, I stopped here.** What I have: the failure is consistent,
environment-specific, and not caused by this work. What is missing: a diff of the deployed
`naavi-chat` source between the two projects. What would settle it: `npm run parity:verify`, or
promoting staging's `naavi-chat` to match production and re-running.

### 3f. Type check

`npx tsc --noEmit` — clean for both changed screens.

---

## 4. Manual tests required

**None of the mobile half can be exercised without a build.** The two screens are React Native; the
runner cannot reach them. What is proven above is the function they call and the source shape of the
calls, not the screens running on a device.

Requires a staging APK:

1. **Contact → describe a problem an answer covers → Send.** Suggestions appear *once*, on Send.
2. **Send again.** The ticket is filed — the suggestion never blocks.
3. **Tap a suggestion.** It opens the right anchor on the website.
4. **Airplane mode → Send.** No suggestion; the form behaves exactly as it does today on a network
   failure (Wael's Q2 — no offline fallback).
5. **Report, both fields filled.** Same, with `surface: 'app-report'`.
6. **Type slowly and watch.** *Nothing* should happen until Send — the per-keystroke behaviour is
   gone.

---

## 5. Rollback

**Nothing is live for users.** Staging only; the app change reaches nobody without a release.

- **Code** — `git revert e83fdb3`. `lib/faq.ts` returns with it.
- **`match-faq`** — redeploy the previous version. It is backward compatible in one direction only:
  the old code reads `ip_hash`, which no longer exists, so the migration must be reverted with it.
- **Migration** — `ALTER TABLE faq_rate_limit RENAME COLUMN subject_hash TO ip_hash;` and
  `DROP FUNCTION count_faq_match_request(text, timestamptz);`. Safe at any moment: every row in that
  table expires within five minutes and nothing else reads it.
- **Order matters** — code before schema on the way back, the mirror of §0d's schema-before-code.

---

## 6. Known risks

| Risk | State |
|---|---|
| The website's support forms break | **Tested directly** — §3c. No credentials still returns matches |
| The limiter silently stops working | **Fixed** (A1). Errors checked, logged at error level, request proceeds |
| The per-user ceiling under-counts | **Fixed and measured** (A2) — §3b |
| The anon key collapses signed-out users into one bucket | **Tested** — §3d |
| Someone removes `--no-verify-jwt` | **Not fixable in code.** Written into the function header and Phase 2 §6a A4. A deploy flag can always be changed by hand |
| The mobile screens are unproven on a device | **Open** — §4. Needs a staging APK |
| Suggestions no longer appear while typing | Deliberate (Wael's Q1). Worth a release note, not a fix |

---

## 7. Defects found in my own work during Phase 4

1. **The first anon-key probe proved nothing.** It reused one phrase, so two of the three calls were
   cache hits that never reached the limiter. Caught by checking which buckets actually changed
   rather than trusting the HTTP status. **A green result that tests nothing is the failure mode this
   whole session keeps producing.**
2. **`match-faq`'s header still said "per-IP rate limit"** after the key stopped being an IP.
   Corrected in the same change rather than left as a true-when-written comment — the §2d failure.

---

## 8. Not done, deliberately

- **No production deploy.** Requires Wael's explicit instruction.
- **No AAB, no staging APK.** Phase 0 put the release out of scope; the gates come later.
- **No Architecture Reference edit** — Phase 8, per the Reference-Document Read-Only Rule. Two rows
  are owed: `match-faq` gains mobile as a consumer, and §5a's Priority 1d closes from two copies to
  one. Phase 1A's Outcome 3 finding — that mobile ran a second *matcher*, not merely a second copy —
  is also owed there, per Wael's decision.
- **F2 (cross-environment classifier reproducibility)** — a separate item, by Wael's ruling.
