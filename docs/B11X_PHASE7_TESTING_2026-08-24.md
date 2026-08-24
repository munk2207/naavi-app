# B11x — Phase 7: Testing

**Work item:** [[B11x]] — redundant email classification
**Date:** 2026-08-24
**Phase 6:** Approved (relayed by Wael, 2026-08-24)
**Environment:** **STAGING only.** Production untouched.

**Status:** **DRAFT — awaiting Wael's Phase 7 → Phase 8 approval.**

> **Note on the Phase 6 record.** Wael relayed the approval as "Phase 6 approved." The reviewer's four independent verdicts (Technical / Architecture Completeness / Governance / Overall) and the Architecture Drift verdict were not relayed verbatim, so §8 of the Phase 6 document records the outcome but not the reasoning. Recorded as a gap in the historical record rather than papered over.

---

## 1. ⭐ The test that actually matters

Every test before this one called `extract-email-actions` **directly**. That proves the guard works when invoked; it does not prove the guard is reached through the path the defect actually travels.

**This is that test:** `sync-gmail` → `extract-email-actions`, on a real Gmail inbox, through the real trigger.

**Account:** `robert.esm.2207@gmail.com` staging (`f1bc46b8-a478-43ad-bf09-e138099c8847`) — the account CLAUDE.md designates for live manual testing. The automated-gates account has an empty inbox (a real `sync-gmail` run returned `messages: 0`), so it could not exercise this.

### Starting state — read before touching anything

| | |
|---|---|
| Messages in the 7-day window | **13** |
| Of those, already classified | **13** |
| Total `email_actions` rows | 24 |
| Of those, **sentinels** (`action_type` NULL) | **11** |

**Those 11 sentinels were not created by any test.** They were written by the staging pipeline itself between the 6:18 PM deploy and this run — latest `extracted_at` **2026-08-24 6:21 PM EST**. The fix had already been exercised end-to-end, on real mail, by real traffic, before anyone tried to test it.

### The run

```
19:04:43  POST /functions/v1/sync-gmail  { "target_user_id": "f1bc46b8-…" }
          → {"results":[{"user_id":"f1bc46b8-…","messages":13}]}
```

`sync-gmail` processed **all 13 messages** — its firing condition at `:362` is unchanged, so it fired classification for every one of them, exactly as before the fix.

### The result

Measured by fingerprinting `extracted_at` on every row before and after:

| | |
|---|---|
| Rows before | 24 |
| Rows after | 24 |
| **New rows** | **0** |
| **Rewritten rows** | **0** |

**Not one row was rewritten. Not one message was re-sent to Claude.**

This satisfies Phase 0's Completion Criterion 1 — *"two consecutive `sync-gmail` runs over an unchanged inbox produce Claude calls on the first and zero on the second."*

**Evidence source differs from what Phase 0 specified**, and deliberately: Phase 0 asked for function logs. Row fingerprints are stronger — a log line reports what the code *says* it did, while an unchanged `extracted_at` on all 24 rows measures what actually happened to the data. `sync-gmail` still fired 13 times; the guard absorbed all 13.

---

## 2. What Phase 7 did NOT validate

Stated plainly rather than left as implied coverage.

1. **A genuinely new email arriving mid-window.** No new mail arrived during the test, and forcing one requires sending real email to the account. Success Criterion 2 is covered by the automated suite (`b11x.second-call-is-skipped`, whose first call classifies successfully) but **not** by a live end-to-end observation.

2. **Production volumes.** Staging's window is 13 messages. Production carries the real inbox, and the defect's signature — a flat ~1.2M tokens/hour — can only be observed collapsing there. **That measurement is only possible after promotion**, and it is the only evidence that measures the outcome rather than the mechanism.

3. **The failed-attempt retry path in the wild.** `b11x.error-path-writes-no-row` covers it synthetically. No real Claude failure occurred during Phase 7 to observe naturally.

4. **Manual validation categories from governance that do not apply here:** voice, phone, geofencing, notifications, screen behaviour, permissions, background execution. **This change has no client surface at all** — no mobile file changed, no APK, no AAB. There is nothing to tap.

---

## 3. ⭐ Correction — the cost figure in earlier phase documents was inflated

**This correction is owed and is recorded here rather than quietly amended.**

Phases 0, 1 and 5 state the defect projects to **~$31/day ≈ $930/month**, extrapolated from a single Console reading: 22,916,042 Haiku input tokens over ~19 hours on the edge-functions key.

**The token measurement is accurate. The extrapolation was not**, for two reasons:

1. **That window included this session's own testing.** The full 543-case Gate 1 suite was run twice, plus three trials of a `naavi-chat` test — hundreds of live Claude calls, billed to the same key, inside the same 19 hours. The measurement captured the defect *and the work of investigating it*, then attributed all of it to the defect.

2. **Actual billing contradicts it.** The Console billing page shows **$357.68 spent** in the cycle beginning 1 August, read 2026-08-24. Over 24 days that is **≈ $15/day**, not $31.

**The corrected figure is ~$15/day (~$450/month) all-in**, of which this pipeline is a large but unquantified share.

**What does not change:** the flat hourly line is still the defect's signature and is still the reason this item exists — two users cannot produce level traffic at 3 AM. The mechanism, the root cause, and the fix are unaffected. **Only the size of the prize was overstated, by roughly 2×.**

**Also corrected:** an earlier claim that the credit balance gave "roughly seven hours of runway" and that promotion needed a top-up. **Auto-reload was already configured** — at $5, top up to $15, verified in the Console. There was never an outage risk, and the balance had already reloaded on its own while it was being described as critical.

---

## 4. Test summary

| Layer | Result |
|---|---|
| B11x regression suite (6 cases) | ✅ 6/6, against STAGING |
| Full Gate 1 suite (543 cases) | ⚠️ 537 passed, **0 failed**, 1 errored ([[B11z]], proven unrelated), 5 pre-existing skips |
| Drift check | ✅ PASS — no new staging/production separation |
| **End-to-end through `sync-gmail`, real inbox** | ✅ **PASS — 13 messages fired, 0 re-classified** |
| Non-Determinism Rule | N/A — no prompt modified |

---

## 5. What this document does and does not authorize

**Authorizes, on Wael's approval:** the Phase 7 → Phase 8 transition (Merge).

**Does not authorize:** promotion to production. That is a separate decision requiring Wael's explicit *"deploy to production"* per the staging-first rule.

**Correction to an earlier claim about that promotion:** it was previously stated in this session that production promotion requires the three test gates and is therefore blocked by [[B11z]]'s red Gate 1. **That is wrong.** Rule 15 states the gates apply *"to production AABs only."* B11x produces no AAB — it is an Edge Function deploy, two commands against `hhgyppbxgmjrwdpdubcx`. **B11z does not block it.** B11z blocks the next *mobile build*, which is a different thing.
