# B11x — Phase 5: Evidence Package

**Work item:** [[B11x]] — redundant email classification
**Date:** 2026-08-24
**Implementation commit:** `3ef7e6a`
**Environment:** **STAGING only** (`xugvnfudofuskxoknhve`). Production untouched.

**Status:** ✅ **ACCEPTED by Wael, 2026-08-24. Phase 5 → Phase 6 authorized.** Not promoted to production.

**How the hold was resolved.** ChatGPT's Phase 5 review held on one blocker — the Gate 1 suite reading "PENDING". That reading came from an earlier draft; the suite had already run. **But its result did not satisfy the hold's condition either:** Gate 1 completed and is **not green**, on an error B11x did not cause and cannot fix within its boundary (§5).

Wael accepted Phase 5 on the evidence as it stands — 0 failed, the error proven unrelated by deploy timestamps and reproduced 3/3 — **and opened the blocker as its own work item rather than leaving Gate 1 red with no owner:**

- **[[B11z]]** — the `comparison-chatgpt-single-mention` defect. Carries the Non-Determinism Rule.
- **[[B12a]]** — the auto-tester prints its environment and never writes it down, which is why B11z cannot be dated.

---

## 1. Summary

`sync-gmail:362` fires classification on `if (!error && !isMarketing)`. `!error` is true for an UPDATE exactly as for an INSERT, so every email in the rolling 7-day window was re-sent to Claude on every sync. Measured before the fix: **~1.21M Haiku input tokens/hour, flat around the clock, on a two-user account** — ~$930/month projected.

The fix guards the **classifier**, not the caller. `extract-email-actions` now records every terminal outcome — including a sentinel row (`action_type` NULL) for emails that produce no action, which previously wrote nothing at all — and skips any message that already has a row for `(user_id, gmail_message_id)`.

`sync-gmail` is **not changed**. Its firing condition is left exactly as it was; the guard downstream makes it harmless.

---

## 2. Files changed — four, matching the authorized boundary exactly

| File | Change |
|---|---|
| `supabase/functions/extract-email-actions/index.ts` | Already-classified guard; `force` bypass; sentinel rows at **two** sites; MC2 procedure comment at `ACTIONABLE_KEYWORDS`; header updated |
| `supabase/functions/backfill-email-actions/index.ts` | Removed the broken `seen` guard (MC1); pass `force` through per message; header corrected |
| `tests/catalogue/b11x-email-reclassification.ts` | New — 6 regression cases |
| `tests/runner.ts` | Register the suite |

`git status` at commit time showed exactly these four and nothing else.

---

## 3. Git diff

Full diff: `git show 3ef7e6a`. The three load-bearing hunks:

**The guard** (`extract-email-actions`, before the Anthropic client is constructed):

```ts
if (!force) {
  const { data: priorRow } = await supabase
    .from('email_actions')
    .select('id')
    .eq('user_id', user_id)
    .eq('gmail_message_id', gmail_message_id)
    .maybeSingle();

  if (priorRow) {
    return new Response(JSON.stringify({ action: null, reason: 'already_classified' }), { ... });
  }
}
```

**The sentinel** (identical at both sites — pre-filter rejection and `not_actionable`):

```ts
const { error: sentinelErr } = await supabase
  .from('email_actions')
  .upsert({
    user_id,
    gmail_message_id,
    action_type: null,
    extracted_at: new Date().toISOString(),
  }, { onConflict: 'user_id,gmail_message_id' });
```

**The removal** (`backfill-email-actions`) — the `seen` set and its filter are gone; `todo` is now every fetched id, and `force` is forwarded:

```ts
const todo = (msgs ?? []).map((r: { gmail_message_id: string }) => r.gmail_message_id);
...
body: JSON.stringify({ gmail_message_id: id, user_id, force }),
```

---

## 4. ⭐ Deviation from the approved plan — a fourth outcome its table missed

**Reported, not hidden.** Wael ruled this implements the approved intent rather than exceeding the boundary; it is flagged here for Phase 6 to audit.

The Phase 2 outcome table listed three cases. There is a fourth, at `extract-email-actions:387`:

```ts
if (!parsed?.is_actionable) {   // Claude ran to completion and found nothing
  fireHarvest();
  return ...                     // ← wrote no row
}
```

**This is the expensive branch.** That email already cost a Claude call. With no row, the guard could not see it, so it would be re-sent every tick forever.

**And it would have looked fixed.** The pre-filter path is 70-80% of volume, so the token counts would have collapsed convincingly while this class kept billing quietly underneath — the same shape of partial fix as the three cron reductions that preceded this work item.

A sentinel is now written there too. **Deliberately not applied to `parse_failed`** — a malformed Claude response is transient and must stay retryable, exactly like the error path.

---

## 5. Tests executed

**Environment banner read before trusting any result**, per the Cross-Cutting Change Parity Check:

```
════════════════════════════════════════════════════════
  Testing against: STAGING  (xugvnfudofuskxoknhve)
  GATE 1 — MOBILE / APK / AAB (Voice excluded)
════════════════════════════════════════════════════════
```

**Deploy timestamps confirm the fix was live where the tests ran** — checked directly, not inferred:

| Function | Version | Deployed (EST) |
|---|---|---|
| `extract-email-actions` | v21 | 2026-08-24, 6:18:32 PM |
| `backfill-email-actions` | v21 | 2026-08-24, 6:18:43 PM |
| `sync-gmail` | v20 | **2026-06-20, 7:28:09 PM** — untouched, as planned |

### B11x suite — 6/6 passed

| Test | Result | What it guards |
|---|---|---|
| `b11x.second-call-is-skipped` | ✓ 2634ms | The defect itself, for both outcome shapes |
| `b11x.prefilter-writes-null-sentinel` | ✓ 460ms | Sentinel shape — all content fields NULL |
| `b11x.force-bypasses-guard-only` | ✓ 1191ms | **`force` scope** — fails if it ever widens |
| `b11x.not-actionable-writes-sentinel` | ✓ 1755ms | The fourth outcome from §4 |
| `b11x.error-path-writes-no-row` | ✓ 404ms | Success Criterion 3 — retryability |
| `b11x.sentinel-invisible-to-global-search` | ✓ 2599ms | The §6 regression claim |

### ⭐ Gate 1 status — completed, but NOT green. Stated plainly.

**The reviewer's Phase 5 hold was written against an earlier draft of this document that still said "RESULT PENDING". The suite has since run.** But the result does not satisfy the hold's condition, and that must not be glossed.

`npm run test:auto` is **two** commands — `node scripts/t4-drift-check.js && tsx tests/runner.ts`:

| Half | Result |
|---|---|
| Drift check | ✅ **PASS** — *"No new drift. Staging and production have not separated further."* (2026-08-24, 6:33:36 PM EST) |
| Test suite | ⚠️ **537 passed, 0 failed, 1 errored, 5 skipped** |

**Rule 15's bar is 100% green. One error means Gate 1 is NOT green** — regardless of who caused it, and this work item did not cause it (§5).

**B11x cannot make Gate 1 green.** The error is in `naavi-chat`'s self-description prompt behaviour, a different function, out of this item's authorized boundary. Fixing it here would violate the No Extra Changes Rule and the Implementation Boundaries.

**What Gate 1 actually gates:** Rule 15 makes a green `test:auto` a hard prerequisite for **every production AAB**. B11x ships **no client** — it is two Edge Functions, already deployed to staging. So this failure does not block anything B11x does; it blocks the next *mobile build*, by whoever attempts one.

**The decision this needs is Wael's**, and it is not a B11x decision: either the `comparison-chatgpt-single-mention` defect gets its own work item and its own governance, or Gate 1 stays red for everyone. Recorded here rather than deferred silently, because a red gate that nobody owns is how it stays red.

### Full Gate 1 regression suite — 543 cases against STAGING

```
✓ 537 passed   ✗ 0 failed   ⨯ 1 errored   ⧗ 0 timed out   ○ 5 skipped
```

**Zero failures. All six B11x cases passed inside the full run**, not only in isolation.

The 5 skips are pre-existing test-account data gaps (no qualifying calendar event for travel-time chains; no "Fatma Elmehelmy" contact), each documented in its own file header. None relate to this change.

### ⚠️ The one error — `prompt-regression.comparison-chatgpt-single-mention`

**Not caused by this change. Root cause NOT established.**

The test asserts that `naavi-chat`'s answer to *"what's the difference between you and ChatGPT"* names the competitor exactly once. It returned 2 — the closing sentence appears both at the top and at the bottom of the reply, with an odd `"— I can't verify this from a live source right now"` appended.

**Why it is not this change** — verifiable, not inferred:

| Evidence | Value |
|---|---|
| `naavi-chat` deployed on staging | **2026-08-13, 5:02 AM EST** |
| `get-naavi-prompt` deployed on staging | 2026-08-20, 10:05 PM EST |
| This change deployed | 2026-08-24, 6:18 PM EST |
| Functions this change touched | `extract-email-actions`, `backfill-email-actions` — **neither is `naavi-chat` nor `get-naavi-prompt`** |

**The code producing that response is byte-identical to what it was eleven days before this work began.** The only route by which this change could reach it would be a database side effect, and `b11x.sentinel-invisible-to-global-search` covers exactly that: sentinel rows are structurally unreachable by the one adapter that reads `email_actions` into chat context.

**Per the Non-Determinism Rule, three independent trials were run** rather than accepting one result: **3/3 errored.** It is consistently reproducible, not flaky — so it is a real defect, just not this one.

**What is NOT established:** why it now fails. Both environments have `get-naavi-prompt` deployed within six seconds of each other, so environment drift does not explain it. The most recent stored result showing this test passing is `tests/results/2026-08-22T00-20-23-030Z.md` — **but that report does not record which environment it targeted**, so it cannot be compared against this run. See §10.3.

**Recommend opening this as its own holding-list item.** It blocks nothing in B11x — this work item ships no client and requires no AAB — but Rule 15 makes a green `test:auto` a hard prerequisite for any production AAB, so it will block the next mobile build by someone who did not cause it.

### Non-Determinism Rule

**Does not apply.** No Claude or Haiku prompt was modified. The guard is control flow; the sentinel is a database write. The classifier prompt is byte-identical to before this change.

---

## 6. ChatGPT's Verification Checklist

| Required | Status |
|---|---|
| Second normal invocation makes no Claude call | ✅ `b11x.second-call-is-skipped` |
| Pre-filter produces sentinel | ✅ `b11x.prefilter-writes-null-sentinel` |
| Failed Claude call produces no sentinel and retries | ✅ `b11x.error-path-writes-no-row` |
| Forced backfill bypasses only the existence guard | ✅ `b11x.force-bypasses-guard-only` |
| Regression suite passes | ⚠️ **Ran; 0 failed, but not 100% green.** 537 passed · 1 pre-existing error proven unrelated (§5) · 5 pre-existing data-gap skips. Drift check green. **Gate 1 is red on a defect B11x did not cause and cannot fix in scope** — see the Gate 1 status block in §5 |
| SQL hidden-coupling search recorded | ✅ Phase 3 §9, MC3 — ten database objects |

---

## 7. Manual tests required

None are required to close Phase 5. **One is recommended before any production promotion:**

Watch the Anthropic Console hourly view for the staging key over 24 hours. The flat ~1.21M/hour line is the defect's signature; if the fix works at real volume, that baseline should collapse and only the human-driven bars should remain. **That is the only evidence that measures the actual outcome rather than the mechanism** — every test above proves the guard behaves correctly, not that the bill fell.

Note the confound: staging carries little real mail. The honest version of this test happens on production, after promotion.

---

## 8. Rollback instructions

Both functions revert independently and immediately. No migration, no schema change, nothing to undo in the database.

```bash
git revert 3ef7e6a
```

```bash
npx supabase functions deploy extract-email-actions --no-verify-jwt --project-ref xugvnfudofuskxoknhve
```

```bash
npx supabase functions deploy backfill-email-actions --no-verify-jwt --project-ref xugvnfudofuskxoknhve
```

**Sentinel rows already written are harmless after a rollback** — they have `action_type` NULL and every content field NULL, and the reverted code simply never reads them. They do not need deleting. If you want them gone anyway:

```sql
DELETE FROM email_actions WHERE action_type IS NULL;
```

⚠️ **Do not run that DELETE while the fix is live** — it would clear the very records the guard depends on and reinstate B11x for every affected email.

---

## 9. Known risks

1. **`email_actions` changes meaning.** It is now "emails Naavi has looked at", not "emails with actions", with `action_type IS NULL` marking the empty ones. Every future reader must know this. The table name is mildly misleading; renaming was judged not worth the churn.

2. **Widening `ACTIONABLE_KEYWORDS` no longer applies retroactively.** Documented at the array itself, with the forced-backfill procedure. This is the change most likely to surprise a future session.

3. **A permanently-failing email retries forever.** Today's behaviour, so not a regression — accepted, not solved. Deferred at Phase 3: reconsider only if permanent failures create material repeated cost.

4. **`email_actions_user_due_idx` grows ~4-5×.** Sentinels default to `dismissed = false` and so enter that partial index. No correctness impact; the honest cost of the approach.

5. **Sentinel-write failures are logged, not fatal.** If the upsert fails, the email is simply re-classified next sync — degraded to today's behaviour, never worse. Logged per AI Coding Discipline #21 because silent failure here would look exactly like B11x never having been fixed.

6. **⭐ The invocation count is unchanged.** `extract-email-actions` is still called ~8,700 times/day; each call is now two indexed DB queries instead of a Claude call. That removes essentially all the *cost* but none of the *traffic*. Cutting the traffic is [[B11y]] — the mobile app still triggers a global sync every 60 seconds.

7. **Staging only.** Production still has the defect and is still billing at the measured rate. Promotion is a separate decision requiring the three gates.

---

## 10. Reported, not fixed — per the No Extra Changes Rule

1. **Pre-existing TypeScript errors in `web/app/page.tsx`** (JSX parse errors, ~10). Outside this diff, untouched.

2. **`backfill-email-actions`'s `actionable`/`notActionable` counters** now lump `already_classified` responses in with `notActionable`, since both return `action: null`. Cosmetic — it affects only the returned summary of an administrative utility. Not fixed: outside the authorized change.

3. **⭐ The test report does not record which environment it ran against.** The console prints a `Testing against: STAGING / PRODUCTION` banner — added 2026-07-20 precisely because a green run against the wrong environment proves nothing — but `writeReport()` does not put it in the `.md`. So every stored report in `tests/results/` is un-attributable after the console scrollback is gone.

   This is not hypothetical: it blocked §5's root-cause analysis today. The last stored run showing `comparison-chatgpt-single-mention` passing is from 2026-08-22, and **it cannot be used as a baseline because there is no way to tell what it was testing.**

   It is the same pattern this project keeps rediscovering — the knowledge exists, nothing mechanically preserves it. One line in `writeReport()` closes it. **Not fixed here: `tests/runner.ts` is an authorized file for registration only, and changing report output is outside the approved change.**
