# F17 — Phase 5: Evidence Package (REVISED — call site 5 added)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5. Implementation limited strictly to `docs/F17_PHASE2_CHANGE_PLAN_2026-07-14.md` §2's approved file list — no refactor, cleanup, renaming, or unrelated fix bundled in, per governance's "No Extra Changes Rule."

**This revision supersedes the original Phase 5 package.** The original package reported one finding (`pendingRearm`'s reactivate-merge, unprotected) as a separate item per the "No Extra Changes Rule," rather than fixing it silently. The Phase 6 reviewer's response was "Changes required before Phase 6 approval" — treat it as a Phase 2 amendment, implement, then regenerate Phase 5 (see `F17_PHASE2_CHANGE_PLAN_2026-07-14.md` §1.2a, seventh revision). That amendment is implemented here. §7 below is the resulting completeness statement.

---

## 1. Summary

Voice (`naavi-voice-server`) now has parity with mobile's F15 Defect A fix: a self-alert with an explicit per-channel destination override ("text me at [number] when I arrive at X") is stored with a `self_override_*` field and stays classified as self (full fan-out preserved on every other channel), instead of being misrouted through `resolve-recipient` as a third-party recipient. Implemented across all five write-time call sites identified by Phase 2 §1.2/§1.2a's write-surface audit — two creation-time (Claude tool-use), two update/clarification-time, and one reactivate-time (all three voice-specific deterministic follow-up handlers).

## 2. Files changed

| File | Classification | Change |
|---|---|---|
| `naavi-voice-server/src/anthropic_tools.js` | Configuration (Protected Core-adjacent) | Added four `self_override_*` properties to `ACTION_CONFIG`, verbatim match to mobile's `_shared/anthropic_tools.ts:129-144`. Additive only. |
| `naavi-voice-server/src/index.js` | Backend (**Protected Core**) | Five guard sites, per Phase 2 §1.2/§1.2a: (1) general `SET_ACTION_RULE` handler — `hasSelfOverride` computed, stray `to`/`to_name` stripped, B4y `to_phone` default and `resolve-recipient` call both gated by `!hasSelfOverride`; (2) location `SET_ACTION_RULE` handler — identical guard (`hasSelfOverrideLoc`); (3) `pendingContactClarification` — strips stray `self_override_*` before writing a freshly-resolved third-party `to`/`to_phone`; (4) `pendingNoteUpdate` — strips stray `self_override_*` from the merge when a fresh `to` is being written into an existing row (asymmetric direction from 1/2); (5) `pendingRearm` — **bidirectional** guard on the shallow-spread reactivate-merge: strips whichever side's fields (stale third-party or stale self-override) are being superseded by the fresh turn's content, or neither if the fresh turn carries no recipient change at all. |
| `naavi-voice-server/test/f17-self-override.test.js` (new) | Testing (Rule 15a) | 14 tests — 1 real (schema, via `require`), 13 source-pattern (disclosed coverage-gap rationale in the file header: `index.js` starts a live server at require time, cannot be safely imported). Cover all 5 invariants from Phase 2 §1.4/§2.1's matrix across all 5 call sites. |

No database migration. No change to `evaluate-rules`, `report-location-event`, `get-naavi-prompt`, `naavi-chat`, `manage-rules`, or any mobile file — confirmed unaffected per Phase 1 Evidence 6 and Phase 2 §1.2a.

## 3. Git diff

Repo: `naavi-voice-server`, currently checked out on branch `staging` (tracking `origin/staging`) — **flagged in §7 below, not yet reconciled with CLAUDE.md's description of this repo as single-branch.**

```diff
diff --git a/src/anthropic_tools.js b/src/anthropic_tools.js
index 2c1dd74..11dfe44 100644
--- a/src/anthropic_tools.js
+++ b/src/anthropic_tools.js
@@ -85,10 +85,35 @@ const TRIGGER_CONFIG_CONTACT_SILENCE = {
 };
 
 // action_config common shape — Decision A: `to` is name only; no to_phone/to_email here.
+// F17 Phase 4 (2026-07-14) — self_override_* fields are a deliberate
+// exception to Decision A, ported verbatim from mobile's F15 Defect A design
+// (supabase/functions/_shared/anthropic_tools.ts:129-144): they exist ONLY
+// for a self-alert where the user gives an explicit literal address to
+// override where ONE SPECIFIC CHANNEL delivers ("email me at X"), never for
+// a third-party recipient (that stays `to`, resolved via resolve-recipient).
+// One field per channel, not a shared "phone" field — overriding SMS must
+// NOT also silently redirect WhatsApp/voice (mobile tried a shared field
+// and explicitly rejected it as confusing to explain to end users).
 const ACTION_CONFIG = {
   type: 'object',
   properties: {
     to: { type: 'string', description: 'Contact NAME only (e.g. "wife"). Orchestrator resolves phone/email.' },
+    self_override_email: {
+      type: 'string',
+      description: 'Self-alert only: an explicit literal email the user gave to override where the EMAIL channel of THEIR OWN notification is delivered (e.g. "email me at jane@example.com"). Only the email channel is affected. Never set for a third-party recipient — use `to` for that.',
+    },
+    self_override_sms: {
+      type: 'string',
+      description: 'Self-alert only: an explicit literal phone number the user gave to override where the SMS/TEXT channel of THEIR OWN notification is delivered (e.g. "text me at +16135551234"). Only the SMS channel is affected — WhatsApp and voice call still reach the user\'s own registered number unless separately overridden. Never set for a third-party recipient.',
+    },
+    self_override_whatsapp: {
+      type: 'string',
+      description: 'Self-alert only: an explicit literal phone number the user gave to override where the WHATSAPP channel of THEIR OWN notification is delivered (e.g. "WhatsApp me at +16135551234"). Only the WhatsApp channel is affected. Never set for a third-party recipient.',
+    },
+    self_override_voice: {
+      type: 'string',
+      description: 'Self-alert only: an explicit literal phone number the user gave to override where the VOICE CALL channel of THEIR OWN notification is delivered (e.g. "call me at +16135551234"). Only the voice-call channel is affected. Never set for a third-party recipient.',
+    },
     body: { type: 'string', description: 'Message body.' },
     tasks: {
       type: 'array',
diff --git a/src/index.js b/src/index.js
index eac0497..49c2ae1 100644
--- a/src/index.js
+++ b/src/index.js
@@ -4698,7 +4698,30 @@ async function executeAction(action, userIdOverride) {
         // silently fail at evaluate-rules fire time.
         const actionConfigNorm = { ...(action.action_config || {}) };
         const actType = action.action_type;
-        if ((actType === 'sms' || actType === 'whatsapp') && !actionConfigNorm.to_phone) {
+
+        // F17 Phase 4 (2026-07-14) — self_override_* fields mean this is an
+        // explicit-destination self-alert, not a third-party recipient.
+        // Mirrors hasSelfOverride in hooks/useOrchestrator.ts:3325-3328.
+        // Computed before the B4y to_phone default and the F12 third-party
+        // resolution below — both must be skipped when true, per Invariant
+        // #1 (F17_PHASE2_CHANGE_PLAN_2026-07-14.md §1.4): a stored row must
+        // never carry both a self_override_* field and any third-party
+        // destination field (to/to_name/to_phone/to_email/contact_id).
+        const hasSelfOverride = Boolean(
+          actionConfigNorm.self_override_email || actionConfigNorm.self_override_sms ||
+          actionConfigNorm.self_override_whatsapp || actionConfigNorm.self_override_voice,
+        );
+        if (hasSelfOverride) {
+          // B9n-equivalent guard (mobile precedent, useOrchestrator.ts:3288-3294)
+          // — Claude can populate both a self_override_* field AND to/to_name
+          // in the same response despite the prompt forbidding it. Strip any
+          // stray third-party fields so a self-override row is never
+          // ambiguous downstream.
+          delete actionConfigNorm.to;
+          delete actionConfigNorm.to_name;
+        }
+
+        if (!hasSelfOverride && (actType === 'sms' || actType === 'whatsapp') && !actionConfigNorm.to_phone) {
           try {
             const settingsRes = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?select=phone&user_id=eq.${uid}`, {
               headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
@@ -4729,7 +4752,7 @@ async function executeAction(action, userIdOverride) {
         // Tailoring the spoken message at each call site is left as a
         // follow-up, not silently skipped — see F12 evidence package.
         const toNameVoice = String(actionConfigNorm.to ?? '');
-        if (toNameVoice && !actionConfigNorm.to_phone && !actionConfigNorm.to_email) {
+        if (!hasSelfOverride && toNameVoice && !actionConfigNorm.to_phone && !actionConfigNorm.to_email) {
           try {
             const resolveRes = await fetch(`${SUPABASE_URL}/functions/v1/resolve-recipient`, {
               method: 'POST',
@@ -10085,6 +10108,17 @@ wss.on('connection', (twilioWs) => {
             resolvedActionConfig.to_phone = normPhone;
           }
 
+          // F17 Phase 4 (2026-07-14) — call site 3 of the write-surface audit
+          // (F17_PHASE2_CHANGE_PLAN_2026-07-14.md §1.2a). `original.action_config`
+          // was spread in above; if it carried a stale self_override_* field
+          // (e.g. from a prior contaminated response), this fresh third-party
+          // `to`/`to_phone` resolution must win — strip the stale fields so the
+          // row never carries both, per Invariant #1.
+          delete resolvedActionConfig.self_override_email;
+          delete resolvedActionConfig.self_override_sms;
+          delete resolvedActionConfig.self_override_whatsapp;
+          delete resolvedActionConfig.self_override_voice;
+
           // Save the rule directly
           let ruleSaved = false;
           try {
@@ -10271,6 +10305,19 @@ wss.on('connection', (twilioWs) => {
             if (newToName)  merged.to_name  = newToName;
             if (newToEmail) merged.to_email = newToEmail;
             if (newToPhone) merged.to_phone = newToPhone;
+            // F17 Phase 4 (2026-07-14) — call site 4 of the write-surface
+            // audit (F17_PHASE2_CHANGE_PLAN_2026-07-14.md §1.2a). The
+            // existing row may have been a self-override alert
+            // (self_override_* set, no `to`); a fresh third-party recipient
+            // arriving here must win — strip any stale self_override_*
+            // fields from the merge so the row never carries both, per
+            // Invariant #1. Opposite direction from the creation-path guard
+            // (there: self-override wins, strip `to`) — intentionally
+            // asymmetric, not a copy-paste of that guard.
+            delete merged.self_override_email;
+            delete merged.self_override_sms;
+            delete merged.self_override_whatsapp;
+            delete merged.self_override_voice;
           }
           const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/action_rules?id=eq.${ruleId}`, {
             method: 'PATCH',
@@ -11261,8 +11308,23 @@ wss.on('connection', (twilioWs) => {
         // already-resolved destination.
         {
           const locActionConfig = action.action_config ?? (action.action_config = {});
+
+          // F17 Phase 4 (2026-07-14) — same guard as the general SET_ACTION_RULE
+          // handler above: a self_override_* field means this is an explicit-
+          // destination self-alert, not a third-party recipient. Must be
+          // computed and applied before the resolve-recipient block below,
+          // per Invariant #1 (F17_PHASE2_CHANGE_PLAN_2026-07-14.md §1.4).
+          const hasSelfOverrideLoc = Boolean(
+            locActionConfig.self_override_email || locActionConfig.self_override_sms ||
+            locActionConfig.self_override_whatsapp || locActionConfig.self_override_voice,
+          );
+          if (hasSelfOverrideLoc) {
+            delete locActionConfig.to;
+            delete locActionConfig.to_name;
+          }
+
           const toNameLoc = String(locActionConfig.to ?? '').trim();
-          if (toNameLoc && !locActionConfig.to_phone && !locActionConfig.to_email) {
+          if (!hasSelfOverrideLoc && toNameLoc && !locActionConfig.to_phone && !locActionConfig.to_email) {
             try {
               const resolveRes = await fetch(`${SUPABASE_URL}/functions/v1/resolve-recipient`, {
                 method: 'POST',
@@ -10380,6 +10426,29 @@ wss.on('connection', (twilioWs) => {
           if (rearmOk && newActionConfig) {
             const merged = { ...(existingActionConfig ?? {}), ...newActionConfig };
+            // F17 Phase 4 amendment (2026-07-14) — call site 5 of the write-
+            // surface audit (F17_PHASE2_CHANGE_PLAN_2026-07-14.md §1.2a).
+            // Unlike call sites 3/4, this merge is bidirectional: the stale
+            // existingActionConfig (from the expired row) could be either
+            // self-override or third-party shaped, and so could the fresh
+            // newActionConfig — a raw shallow spread lets the opposite,
+            // stale type of field from existingActionConfig survive
+            // alongside the fresh type, violating Invariant #1 in either
+            // direction. newActionConfig is already guard-cleaned by call
+            // site 2 (it's action.action_config from the same turn), so it
+            // is internally consistent — self-override-shaped, third-party-
+            // shaped, or neither (a plain content addition with no
+            // recipient change, e.g. tasks-only).
+            const hasSelfOverrideNew = Boolean(
+              newActionConfig?.self_override_email || newActionConfig?.self_override_sms ||
+              newActionConfig?.self_override_whatsapp || newActionConfig?.self_override_voice,
+            );
+            const hasThirdPartyNew = Boolean(newActionConfig?.to);
+            if (hasSelfOverrideNew) {
+              delete merged.to;
+              delete merged.to_name;
+              delete merged.to_email;
+              delete merged.to_phone;
+              delete merged.contact_id;
+            } else if (hasThirdPartyNew) {
+              delete merged.self_override_email;
+              delete merged.self_override_sms;
+              delete merged.self_override_whatsapp;
+              delete merged.self_override_voice;
+            }
             await fetch(`${SUPABASE_URL}/rest/v1/action_rules?id=eq.${ruleId}`, {
               method: 'PATCH',
```

`test/f17-self-override.test.js` is a new, untracked file (not shown as a diff — full content in the repo).

## 4. Tests executed

- **New suite** (`node --test test/f17-self-override.test.js`): **14/14 pass.** Covers all 5 invariants (Phase 2 §1.4) across all 5 call sites, per §2.1's matrix — schema, guard presence/ordering at each site, stray-field stripping in both directions (creation: strip `to`; update: strip `self_override_*`; reactivate: bidirectional), and byte-for-byte inertness when no `self_override_*`/`to` is present, including call site 5's inertness when `newActionConfig` carries neither type.
- **Full existing suite** (`npm test`, all `test/*.test.js` files): **95/95 pass**, including the 14 new tests. No pre-existing test regressed.
- **Not run:** live phone call (Phase 7, requires a deploy — no staging environment exists per Phase 1 §6, so this cannot happen before Phase 6 review and a deploy decision).

## 5. Manual tests required (Phase 7, per Change Plan §6)

Live phone call, run immediately after deploy:
1. "Email me at [address you don't normally use] in 3 minutes" → expect `self_override_email` stored, email-only delivery to that address, other channels unaffected.
2. "Text me at [a different number] in 3 minutes" → expect `self_override_sms`.
3. One location-triggered self-override phrasing (exercises call site 2).
4. Third-party control: "text Bob when I arrive at X" → must work exactly as before (F12 behavior).
5. Plain self-alert control: "alert me when I arrive at X" → must fan out to all enabled channels, unaffected.
6. Negative case: "Email Bob at bob@example.com when I arrive at X" → must produce a third-party alert, not `self_override_email`.
7. Existing-alert update case (exercises call site 4): create a self-override alert, confirm `self_override_email` stored, then say "actually, text Bob instead" → must produce `to`/`to_phone` for Bob with `self_override_email` removed, not both.
8. Explicit watch, per §1.3: does a self-override phrasing ever land the address in `to`/`to_name` instead of the matching `self_override_*` field (the B9l-shaped drift, not yet observed on voice)? Record result either way regardless of pass/fail.
9. **Reactivate case (new, exercises call site 5):** create a self-override alert, let it expire (or use an existing expired one), then re-trigger it with a fresh third-party phrasing ("text Bob when I arrive at X") and confirm the re-enable offer → say yes → must produce `to`/`to_phone` for Bob with the stale `self_override_email` removed, not both. Mirror test with the directions reversed (stale third-party, fresh self-override) if a second expired alert is available.

Call site 3 (`pendingContactClarification`) has no practical live-reachable scenario (requires an artificial pre-existing contamination precondition) — stays regression-test-only coverage, disclosed in the test file header.

## 6. Known risks and separately-flagged findings

**Resolved since the original Phase 5 package:**

- ~~`pendingRearm`'s reactivate-merge is unprotected~~ — **fixed in this revision.** Bidirectional guard added (§3 diff), covered by tests 9-11 (§4). No longer an open finding.

**Still flagged, unchanged from the original package:**

- **Phase 2 §1.2a, unchanged:** the identical missing-`self_override_*`-awareness gap in the shared `manage-rules::merge_tasks` Edge Function and mobile's own two call sites of it. Mobile-affecting, pre-existing, out of Phase 1's voice-only scope. Not touched — this is a separate, mobile-side defect, not part of F17.
- **Phase 2 §1.3, unchanged:** the B9l-style drift risk (address landing in `to`/`to_name` instead of the matching `self_override_*` field) — not yet observed on voice, watched for explicitly in §5's manual test 8, not pre-fixed.

**Operational, not a code risk:**
- The local `naavi-voice-server` checkout is currently on branch `staging`, tracking `origin/staging` — not `main`. CLAUDE.md describes this repo as single-branch. This needs reconciling (confirm which branch Railway actually deploys from) before any Phase 8 push — not yet done, not assumed.

## 7. Completeness statement (per Phase 3 reviewer comment 3, F17_PHASE2_CHANGE_PLAN_2026-07-14.md §9.1)

Every `action_rules.action_config` write in `naavi-voice-server/src/index.js` — re-enumerated directly, not assumed:

| # | Location | Status |
|---|---|---|
| — | `commitLocationRule`, line 584 | Correctly out of scope — pure pass-through, persists whatever call site 2 already guarded. |
| — | `SET_EMAIL_ALERT`, line 4646 | Correctly out of scope — always targets the user's own registered phone, no `to`/recipient concept exists. |
| 1 | General `SET_ACTION_RULE` handler, line ~4789 | **Protected** — `hasSelfOverride` guard. |
| 2 | Location `SET_ACTION_RULE` handler, line ~11308 | **Protected** — `hasSelfOverrideLoc` guard. |
| 3 | `pendingContactClarification`, line ~10125 | **Protected** — strips stray `self_override_*` before POST. |
| 4 | `pendingNoteUpdate`, line ~10322 | **Protected** — strips stray `self_override_*` when `newTo` present. |
| 5 | `pendingRearm`, line ~10426 | **Protected** — bidirectional strip, added this revision. |

Six write locations total. Five are either protected by the invariant or intentionally excluded with stated justification (the two pass-through/always-self cases); the sixth was found unprotected during Phase 4's own audit, reported (not silently fixed), and is now protected per the Phase 6 reviewer's required amendment. **No further write location is currently known.** This statement is bound by the audit method disclosed in Phase 2 §1.2a (grep every `action_rules` write and every inline `action_config` literal) — not an absolute claim beyond what that method can see.

## 8. Rollback instructions

Additive/guarded change (per Phase 2 §3's Medium-High risk reasoning) — no existing field removed or reinterpreted absent its specific trigger condition. Rollback path: revert the two-file commit on `naavi-voice-server`'s deploy branch and let Railway auto-deploy the revert (CLAUDE.md "HOW THE VOICE SERVER DEPLOYS"). No database rollback needed — no migration, and `self_override_*` are inert extra JSONB keys on any row where they're absent.

## 9. Phase 6 review (2026-07-14)

**Decision: Approved.**

| Comment | Content |
|---|---|
| 1 | The previously identified completeness gap (`pendingRearm`) was incorporated through the proper governance process (Phase 5 finding → Phase 2 amendment → implementation → regenerated Phase 5) rather than silently patched. |
| 2 | The revised Phase 5 evidence (§7) provides a credible completeness statement for all currently known `action_rules.action_config` write locations in `naavi-voice-server/src/index.js`. |
| 3 | Remaining branch verification (confirming the Railway deployment branch) is an operational readiness item — blocks Phase 8, not Phase 6. |

No architectural or governance blockers remaining. Proceed to deployment-readiness phase once the branch discrepancy is resolved.

## 10. Next step

**Phase 6 complete.** Per governance §3, Phase 7 (manual live-call validation) and Phase 8 (merge) remain — both blocked on resolving which branch Railway actually deploys from (§6; investigated in this session, see finding below — reported, not resolved unilaterally).

**Branch finding, reported for Wael's direction, not acted on:** `git log --oneline main..staging` shows `staging` is **10 commits ahead of `main`**, and `main..staging`'s inverse (`staging..main`) is empty — meaning `main` has no commits `staging` lacks; `staging` is `main` plus 10 additional real, substantive commits (including F12's `resolve-recipient`/`SET_ACTION_RULE` wiring and F12 Defect B's memory-hit merge fix — both referenced throughout this F17 investigation as already-shipped, working voice functionality). `railway.json` (repo root) specifies build/deploy commands only, no source branch — that setting lives in Railway's dashboard, not this repo, so it can't be confirmed from the codebase alone.

**Per review (2026-07-14) — precision correction on what this evidence does and doesn't establish:** the repository proves commit topology (`staging` ahead of `main`); it does not prove Railway's deployment configuration, and several explanations remain equally consistent with the evidence (CLAUDE.md's line is stale; Railway deploys `staging`; someone deploys manually; `main` is synchronized separately; another workflow exists entirely). The correct framing is that this finding **is inconsistent with CLAUDE.md's documented claim and requires verification against the Railway dashboard before deployment** — not that it "directly contradicts" CLAUDE.md, which overstates what repository evidence alone can establish. **Not resolved here — needs Wael to check the Railway dashboard's connected branch setting directly**, since guessing wrong risks committing F17 to a branch Railway never deploys.
