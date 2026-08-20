# B10k — Phase 5: Evidence Package

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5. Implementation completed within the Implementation Boundaries confirmed in `docs/B10K_PHASE3_TECHNICAL_REVIEW_2026-07-18.md` §3, using the exact verification method and pass/fail criteria decided in §2 (as corrected mid-execution — see "What went wrong and was fixed," below).

---

## Summary

Voice callers were not receiving B10j's fix (the rule preventing a compound "remind me... AND text Bob" location request from dropping the user's own reminder) because `get-naavi-prompt` had the fix on staging only — production, the only environment voice actually calls, was unpatched. This item promoted `get-naavi-prompt` to production, closing that gap.

**Sequence actually executed:**
1. `PROMPT_VERSION` bumped locally (`2026-07-05-v133b-revert-schema-impossible-to_email` → `2026-07-18-b10k-production-promotion`) — no other code change, since B10j's rule content was already committed (`958a686`).
2. Pre-deploy verification — see "What went wrong and was fixed" below; corrected result confirmed production lacked B10j's rule.
3. Wael ran the production deploy himself (`npx supabase functions deploy get-naavi-prompt --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx`), per the separate, explicit production authorization required by Phase 3 §3a — given in the same turn as the deploy itself, distinct from the earlier "Go Phase 4" approval.
4. Post-deploy verification — confirmed the new rule text, worked example, and version string are all live in production.
5. **Live voice call test — Wael called Naavi's production number (+1 249 523 5394) and spoke the exact bug-triggering phrasing. Confirmed working: self-alert fires with the user's own reminder, third party receives their own separate message.** This is the acceptance criterion this entire item exists to satisfy — the first time voice's actual runtime, not staging or a source-level test, was used to validate this fix.

**Deployed to production. Confirmed working live. This closes B10k's core finding.**

---

## What went wrong and was fixed (self-caught, recorded transparently)

The pre-deploy check (Phase 3 §2a's original wording) searched for the substring `SELF-ALERT PRIMARY RULE` and found it — appearing to falsify the entire plan (Phase 2 §0's inference that production was exactly one commit behind staging). Investigated immediately rather than proceeding or panicking: `git show 958a686` revealed `get-naavi-prompt` has **two** separately-named rules — a pre-existing `SELF-ALERT PRIMARY RULE` for time-triggers (line 625, unrelated, already in production before B10j) and B10j's own addition, specifically named `LOCATION SELF-ALERT PRIMARY RULE` to distinguish it. The original check's substring matched both; it had a false positive on the older, unrelated rule.

Corrected the check to search for `LOCATION SELF-ALERT PRIMARY RULE` specifically — re-run, confirmed **not present** pre-deploy, consistent with Phase 2 §0's original inference. Cross-verified independently via `npx supabase functions list --project-ref hhgyppbxgmjrwdpdubcx`, which gave a direct, queryable deploy timestamp for `get-naavi-prompt`: **2026-07-15 6:29:50 PM EST** — about 30 minutes after the F19 Track A commit and roughly two days before B10j's commit, directly confirming production reflected F19 Track A's state and nothing added since. Wael's own recollection ("I think yes [something was deployed]") was correct — it referred to F19 Track A's promotion, not a more recent B10j-specific deploy, and this was confirmed with direct timestamp evidence rather than left as an assumption. `docs/B10K_PHASE3_TECHNICAL_REVIEW_2026-07-18.md` §2a was corrected in place with a dated addendum recording this, rather than silently fixed.

**Separately, a real (harmless) operational error:** the first deploy attempt failed because the command was run from Wael's home directory (`C:\Users\waela`) instead of the repo root — a wrong-working-directory error, not an authorization or code problem. Corrected by `cd`-ing to `C:\Users\waela\OneDrive\Desktop\Naavi` first; the retry succeeded immediately.

---

## Files changed

| File | Change |
|---|---|
| `supabase/functions/get-naavi-prompt/index.ts` | `PROMPT_VERSION` constant updated (line 32). No other line changed — B10j's rule content was already committed under `958a686`, prior to this item. |
| `docs/B10K_PHASE3_TECHNICAL_REVIEW_2026-07-18.md` | Corrected in place: pass/fail criteria (§2a) updated from `SELF-ALERT PRIMARY RULE` to `LOCATION SELF-ALERT PRIMARY RULE`, with a dated addendum explaining why and what the corrected check found. |

No other file touched. No schema, cron, or API contract change. No mobile client change.

---

## Git diff

```diff
diff --git a/supabase/functions/get-naavi-prompt/index.ts b/supabase/functions/get-naavi-prompt/index.ts
index 0207dd2..a8aaa4d 100644
--- a/supabase/functions/get-naavi-prompt/index.ts
+++ b/supabase/functions/get-naavi-prompt/index.ts
@@ -29,7 +29,7 @@ const corsHeaders = {
   'Access-Control-Allow-Methods': 'POST, OPTIONS',
 };
 
-const PROMPT_VERSION = '2026-07-05-v133b-revert-schema-impossible-to_email';
+const PROMPT_VERSION = '2026-07-18-b10k-production-promotion';
 
 /**
  * Cache-boundary marker.
```

**Not yet committed to git.** The deploy itself is independent of a git commit (Edge Functions deploy from local disk) — this diff should still be committed so git reflects what's actually running in production, consistent with T1a's own Objective-A-style concern about deploy/git parity.

---

## Deployment record

| Step | Evidence |
|---|---|
| Pre-deploy check (corrected) | `LOCATION SELF-ALERT PRIMARY RULE`: false; version: `2026-07-05-v133b-...` — matches expected pre-deploy state |
| Deploy command | `npx supabase functions deploy get-naavi-prompt --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx`, run by Wael from `C:\Users\waela\OneDrive\Desktop\Naavi` (second attempt; first failed on wrong directory, no side effect). Output: `Deployed Functions on project hhgyppbxgmjrwdpdubcx: get-naavi-prompt` |
| Post-deploy check | `LOCATION SELF-ALERT PRIMARY RULE`: true; worked example ("lock the door" / "Bob"): true; version: `2026-07-18-b10k-production-promotion` — matches expected post-deploy state exactly |
| Live voice call test | Wael called +1 249 523 5394, real-time, spoke the exact compound bug-triggering phrasing. **Confirmed: self-alert fired correctly with the user's own reminder; third party received their own separate message.** No fallback to the old buggy behavior (third party as primary recipient, user's reminder dropped) observed. |

---

## Tests executed

**No new automated tests added** — this item deployed already-committed, already-tested code (B10j's own 18 tests, 15 negative controls + 2 positive controls × 3 trials + 1 novel phrasing, all passing on staging per B10j's own Phase 5). Phase 2 §5 explicitly considered and declined a full regression re-run against production as disproportionate to a same-content deploy already validated elsewhere — the two verification calls (pre/post-deploy, corrected) plus the live voice call test are the acceptance evidence for this item specifically, per Phase 3 §4 Idea 2's reconsideration condition (escalate only if the spot-check or live test surfaces unexpected behavior — neither did).

---

## Manual tests required

**All required manual validation is complete:**
1. Pre-deploy state verification — done, corrected, passed.
2. Post-deploy state verification — done, passed.
3. Live voice call reproducing the exact B10j scenario against production — done, confirmed working by Wael.

No further manual testing is proposed before considering this item closed.

---

## Rollback instructions

`get-naavi-prompt` is a stateless read function with no schema or data dependency. Full rollback: revert `PROMPT_VERSION` to `'2026-07-05-v133b-revert-schema-impossible-to_email'` (or any other value) and redeploy the same command against production — or, to fully undo the B10j content itself, deploy from the commit prior to `958a686` (`a13b07c`). No data cleanup required either way; no user-facing state was created by this deploy beyond the prompt content itself.

---

## Known risks

- **This diff (`PROMPT_VERSION` bump) is not yet committed to git.** Production is now running code that git HEAD does not fully describe (the deployed content matches `958a686` + this session's local edit, but the local edit itself isn't committed) — a small instance of the exact deploy/git-parity concern T1a's own audit named as a systemic risk. Recommend committing before this item is considered fully closed.
- **The false-positive verification method (now corrected) reveals a real fragility in text-substring-based prompt checks generally** — `get-naavi-prompt` contains many similarly-named rules (this session found at least two "SELF-ALERT PRIMARY RULE" variants); any future check of this kind should search for the most specific available text, not the shortest plausible match. Not a governance rule change proposed here — just a lesson worth remembering the next time a similar check is written.
- **This deploy affects every live Claude call on both mobile and voice, immediately, with no staged rollout** — per Phase 2 §4's own risk framing. The live voice call test is real evidence the deploy is safe for the specific scenario it targets; it is not exhaustive evidence against every possible interaction with the rest of the (6K+ token) prompt. No adverse effect has been observed or reported as of this writing.

---

## Status

**Phase 4 implemented, deployed to production, and verified live 2026-07-18. Phase 5 documented same day.** Not yet committed to git (see Known Risks). Phase 6 (Technical Review After Coding) has NOT started and will not start without Wael's own separate, explicit go-ahead.
