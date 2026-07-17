# F15 — Phase 5: Evidence Package — Defect A (self-alert with explicit destination override)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 5. Covers Defect A. Defect B's own Evidence Package (`docs/F15_PHASE5_EVIDENCE_DEFECT_B_2026-07-09.md`) is separate and already closed.

**§1.2.2 revision notice (2026-07-09, post-closure):** everything below this notice describes the original two-field design (`self_override_email`/`self_override_phone`) as it stood when F15 was closed and live-validated. That design has since been superseded by a direct Wael decision (`docs/F15_PHASE2_CHANGE_PLAN_2026-07-09.md` §1.2.2): `self_override_phone` is retired in favor of four independent per-channel fields (`self_override_email`/`self_override_sms`/`self_override_whatsapp`/`self_override_voice`), so an SMS-only override no longer also silently redirects WhatsApp and voice. The revision has been implemented across all seven files listed in §2 below, the regression suite updated and passing (`npm run test:auto` — 385 passed, same pre-existing 1 error / 2 skips baseline, no regressions), and all four changed Edge Functions redeployed to staging. **Live per-channel validation of the revision (confirming an SMS-only override truly leaves WhatsApp/voice on the user's own number) has not yet been performed as of this notice** — this is the one remaining gate before this document's status can be re-closed under the new design. The original evidence below remains an accurate record of the two-field design's own validation and is kept, not rewritten, per this project's investigation-integrity standard.

---

## 1. Summary

Root cause and corrected design: `docs/F15_PHASE2_CHANGE_PLAN_2026-07-09.md` §1 (sixth/seventh/eighth revisions). Two independent gaps, both proven live before this fix: (1) a self-alert with an explicit literal destination override (e.g. "email me at X") had no field to be extracted into, so the address was silently dropped; (2) once a naive fix forwarded the address into the existing third-party `to`/`to_email` field, the fire-time dispatcher's self/third-party classification (pure address-matching against the user's own registered contact info) would misclassify the alert as third-party whenever the override address didn't match the user's own — losing fan-out and per-channel preferences.

A **third gap was found and fixed during this Evidence Package's own validation work** (§5): even after the extraction/dispatch fix was live, a phrasing that fell through to the Claude+tools path ("email me at X in 3 minutes saying Y" — no third-party name for the time-trigger fast-path handler to grab) caused Claude to select the wrong tool entirely — `draft_message` (send an email now, treating the address as a third-party recipient) instead of `set_action_rule` (a delayed self-alert with a destination override). Root-caused to a highly prominent, early prompt rule (`get-naavi-prompt/index.ts` RULE 1) that pattern-matched "email" + "sending to a person" without excluding the user themselves. Fixed with an explicit exclusion, checked before the general rule.

**Status (original two-field design): CLOSED.** All required closure gates (§8, both external-review-required items) satisfied with live evidence.

**Status (§1.2.2 four-field revision): OPEN — implemented, tested, deployed to staging; live per-channel validation pending.** See the revision notice above.

| Validation | Status (two-field design, as closed) | Status (§1.2.2 four-field revision) |
|---|---|---|
| Layer 2 extraction (`naavi-chat` classifier + `buildActionConfirm`) | ✅ Live-validated | ✅ Code updated, `npm run test:auto` green, not yet live-tested with the new field names |
| `report-location-event` (location dispatcher) | ✅ Live-validated | ✅ Code updated, deployed to staging, not yet live-tested |
| `evaluate-rules` (time/email/weather/contact_silence dispatcher) | ✅ Live-validated | ✅ Code updated, deployed to staging, not yet live-tested |
| Claude+tools extraction path | ✅ Live-validated (after the RULE 1 fix, §5) | ✅ Code updated, not yet live-tested |
| Client UI (`app/alerts.tsx`) | ⏳ Pending — code complete, batched for future APK (B9e), does not block F15 closure per §8's severity classification | ⏳ Same — code updated for four fields, still batched, not deployed |
| Production deployment | ⏳ Pending — staging only, no production promotion without separate explicit approval | ⏳ Pending — staging only |

## 2. Files changed

| File | Change | Scope |
|---|---|---|
| `supabase/functions/naavi-chat/index.ts` | Layer 2 classifier prompt (~line 1665): added `self_override_email`/`self_override_phone` extraction, distinct from third-party `to_name`, with worked examples. `buildActionConfirm`'s location branch (~line 1824-1841): forwards the new params into `action_config` fields of the same name, guarded, kept structurally separate from the existing `to`/`to_name` forwarding. Layer 2 diagnostic (temporary, Defect B-origin) broadened from location-only to all trigger types, to trace this fix's own validation. | Backend, Protected Core-adjacent |
| `supabase/functions/report-location-event/index.ts` | Reads `self_override_email`/`self_override_phone`; `hasSelfOverride` checked before address-matching in `isSelfAlert`; channel-scoped substitution (`selfEmailTarget`/`selfPhoneTarget`) replaces only the overridden channel's destination in the self-alert fan-out. | Backend, **Protected Core** — the confirmed fire path for location alerts |
| `supabase/functions/evaluate-rules/index.ts` | Same fix, mirrored, in `fireAction()` — for time/email/weather/contact_silence triggers. Existing `channelEnabled()` per-user-preference gating preserved unchanged for the substituted targets. | Backend, **Protected Core** — cron path for non-location triggers |
| `supabase/functions/_shared/anthropic_tools.ts` | `ACTION_CONFIG` schema: added `self_override_email`/`self_override_phone` as declared fields, for the Claude+tools path. | Backend / Configuration, Protected Core-adjacent |
| `supabase/functions/get-naavi-prompt/index.ts` | Self-alert rule (line ~1035): carved an explicit exception for the override case. **RULE 1 (line ~479, added during validation, §5):** explicit exclusion for "email/text me at X" before the general draft_message trigger, plus narrowed the general trigger's own condition to "a person OTHER than themselves." | Backend / Configuration |
| `app/alerts.tsx` | `formatWhatHappens`: self-alert display text now calls out the overridden channel's specific address when `self_override_email`/`self_override_phone` is present, instead of generic "all channels" copy. **Not yet deployed — see §7/§8.** | Mobile (AAB-only — requires a new staging APK build) |
| `tests/catalogue/session-2026-07-09-f15-defect-a.ts` (new file) | Seven regression tests (six original + one for the RULE 1 fix) — see §4. | Testing |
| `tests/runner.ts` | Registered the new test file. | Testing |

**Flagged, not part of this fix (Phase 4's "No Extra Changes Rule"):**
- `supabase/functions/get-naavi-prompt/index.ts` had a pre-existing, uncommitted modification from before this entire F15 investigation started — the diff includes that unrelated change alongside this fix's additions. Not disentangled; called out so the unrelated portion isn't mistaken for part of this fix.
- `supabase/functions/_shared/anthropic_tools.ts` still carries the leftover, inert Hypothesis Validation experiment from Defect B's investigation (ruled out) — unreverted, harmless, already flagged in Defect B's own Evidence Package.
- Two temporary diagnostics from Defect B's investigation remain live in `naavi-chat/index.ts` — one of them (the Layer 2 action-branch logger) was reused and broadened for this Evidence Package's own validation (§5); both still pending removal per Defect B's Phase 6 requirement once F15 fully closes.
- **New, unrelated observation, not fixed here:** `evaluate-rules`'s `callVoice` function never writes to `sent_messages` — asymmetric with `report-location-event`'s `callVoice`, which does. Found while diagnosing §5's validation (a real voice call was confirmed by Wael directly, but had no corresponding DB row). Logged separately (holding list `B9f`), not remediated in this fix.

## 3. Git diff (stat only — full diffs available via `git diff` in the working tree)

```
app/alerts.tsx                                    | 22 ++++++-
supabase/functions/_shared/anthropic_tools.ts     | 23 ++++++-
supabase/functions/evaluate-rules/index.ts        | 30 ++++++---
supabase/functions/get-naavi-prompt/index.ts      | ~50 lines  (includes pre-existing unrelated diff, §2, plus the RULE 1 fix added during §5)
supabase/functions/naavi-chat/index.ts            | ~85 lines (includes the broadened diagnostic, §2)
supabase/functions/report-location-event/index.ts | 27 ++++++--
```

## 4. Tests executed

**New regression tests** (`tests/catalogue/session-2026-07-09-f15-defect-a.ts`), all passing:
- `f15a.layer2-classifier-extracts-self-override-fields`
- `f15a.location-branch-forwards-self-override-into-action-config`
- `f15a.report-location-event-checks-self-override-before-address-matching`
- `f15a.evaluate-rules-checks-self-override-before-address-matching`
- `f15a.action-config-schema-has-self-override-fields`
- `f15a.shared-prompt-carves-self-override-exception`
- `f15a.draft-message-rule-excludes-self-addressed-requests` (added after §5's live test revealed the RULE 1 gap)

**Disclosed coverage gap (per CLAUDE.md Rule 15a):** all seven are source-pattern assertions, not live execution — the same accepted limitation as the F15 Defect B test file. This limitation is exactly why §5's live testing mattered: source-pattern tests confirmed the *code shape* existed correctly, but could not have caught the RULE 1 misclassification (a live model-behavior issue, not a missing code pattern) — only live testing did.

**Full suite run:** `npm run test:auto` (388 cases) — **385 passed, 0 failed, 1 errored, 2 skipped.** The 1 error (`f10a.website-nav-feedback-link-homepage-only`) and 2 skips (pre-existing OAuth-connection gaps) are the same pre-existing, unrelated items present in every run tonight — not caused by this fix. **No regressions.**

## 5. Manual/live validation (staging, this session) — both required gates closed

**Location dispatcher (`report-location-event`) — closed in the prior revision of this document:**
1. "Email me at aggan2207@gmail.com when I arrive at [address]" (own sign-in email, pre-fix) — proved the original misclassification (`isSelfAlert: false` computed against live data).
2. "Email me at fatma@egyptiancan.com when I arrive at 250 Carling Ave" (post-fix, different address) — `action_config: {"self_override_email":"fatma@egyptiancan.com"}`, correctly classified self, channel-scoped.

**Non-location dispatcher (`evaluate-rules`) + Claude+tools extraction — closed this revision:**

3. "Email me at fatna@egyptiancan.com in 3 minutes saying test" (first attempt) — **revealed the RULE 1 misclassification bug**: Claude called `draft_message`, sending an immediate third-party-style email (which bounced — "address not found," per Naavi's own later live-search result). Real side effect disclosed to and confirmed acceptable by Wael (test address, no harm). Root-caused and fixed (§1, §2).
4. Same phrasing, retested immediately after the RULE 1 fix deployed — result was **confounded**: Naavi's live-search context surfaced the prior attempt's bounce failure and produced a confused hybrid response. Not treated as a fix failure — a context-injection artifact from reusing the same address, not the classification bug reappearing.
5. **"Email me at aggan2207@gmail.com in 3 minutes saying test"** (fresh address, no history) — clean result: `I'll set up a timed email to aggan2207@gmail.com in 3 minutes saying "test". Say yes to confirm, no to cancel, or tell me what to change.` — the correct `set_action_rule` confirm flow, not `draft_message`. Confirmed via Layer 2 diagnostic that Claude+tools was genuinely the path taken (no `to_name` for the `_ft` fast-path handler, so it fell through, per design).
6. Confirmed "yes." Resulting row: `trigger_type: "time"`, `action_type: "email"`, `action_config: {"body":"test","self_override_email":"aggan2207@gmail.com","to_phone":"+13433332567"}`. Fired at scheduled time (`action_rule_log` confirms `fired_at` matches `trigger_config.datetime` exactly). **All three enabled channels for this user (`alert_channels_enabled: ["sms","email","voice_call"]`) delivered correctly:**
   - SMS to the user's own phone — confirmed via `sent_messages` (body "test", `delivery_status: "sent"`).
   - Email to `aggan2207@gmail.com` (the override target, not the user's own registered email) — **confirmed received, directly by Wael.** Not visible in `sent_messages` (`send-user-email` doesn't log there — pre-existing gap, already disclosed in Defect B's Evidence Package).
   - Voice call to the user's own phone (`+1 343-333-2567`) — **confirmed received, directly by Wael.** Not visible in `sent_messages` for this function specifically — a newly-found, separate, pre-existing gap (§2, `B9f`).
   - WhatsApp and Push correctly did not fire — not in the user's `alert_channels_enabled`, expected behavior, not a bug.

This closes both remaining gates from the prior revision's §8: the non-location dispatcher is proven correct with real delivery across all three channel types (SMS confirmed via DB, email and voice confirmed by direct user report), and the Claude+tools extraction path is proven correct (after the RULE 1 fix) using the exact phrasing that originally broke it.

## 6. Rollback instructions

Server-side (already deployed, immediately revertible):
```
git checkout -- supabase/functions/naavi-chat/index.ts supabase/functions/report-location-event/index.ts supabase/functions/evaluate-rules/index.ts supabase/functions/_shared/anthropic_tools.ts supabase/functions/get-naavi-prompt/index.ts
npx supabase functions deploy naavi-chat --no-verify-jwt --project-ref xugvnfudofuskxoknhve
npx supabase functions deploy report-location-event --no-verify-jwt --project-ref xugvnfudofuskxoknhve
npx supabase functions deploy evaluate-rules --no-verify-jwt --project-ref xugvnfudofuskxoknhve
npx supabase functions deploy get-naavi-prompt --no-verify-jwt --project-ref xugvnfudofuskxoknhve
```
Note: `get-naavi-prompt/index.ts` checkout would also revert the pre-existing unrelated change (§2) — if that needs preserving, revert only this fix's two additions manually instead of a full file checkout.

Client-side (not yet deployed, no live rollback needed): `git checkout -- app/alerts.tsx` before the next APK build if this display change needs to be pulled.

No DB migration, no schema change — `self_override_email`/`self_override_phone` are JSONB fields within existing `action_config`, no structural change to `action_rules`.

## 7. Known risks

- **Client-side display fix (`app/alerts.tsx`) is code-complete but undeployed** — batched per Wael's explicit instruction into a future dedicated APK session (holding list `B9e`), not built standalone. Until that APK ships, self-override alerts on-device will show the old generic "all channels" copy even though the underlying data/dispatch is now fully correct and live-validated.
- **The RULE 1 fix (§1, §5) was found and fixed reactively, mid-validation, not proactively predicted** — a reminder that "the Claude+tools path hasn't been tested" (the prior revision's stated risk) was a real, not theoretical, gap: the very first live test of that path found a genuine misclassification bug. No further untested Claude+tools phrasings are known to be broken, but this investigation's own pattern (assumptions about execution paths are unreliable) argues against assuming RULE 1's fix is the last such gap without further testing if new self-override phrasings are added later.
- **New, minor, pre-existing gap found (not this fix's fault):** `evaluate-rules`'s `callVoice` doesn't log to `sent_messages`, unlike `report-location-event`'s version. Logged as `B9f`, not remediated here — voice-call delivery for non-location alerts is real (confirmed directly by Wael) but not database-observable via the normal audit trail.
- Same leftover items from Defect B's Evidence Package (§2) — unrelated to this fix, still pending their own cleanup, now including the broadened (not yet re-narrowed or removed) Layer 2 diagnostic.

## 8. Next step

**Original F15 closure gates: both satisfied (§1, §5) under the two-field design.** The §1.2.2 four-field revision reopens one gate: live per-channel validation is required before this document can be marked CLOSED again — specifically, a test proving an SMS-only override (e.g. "text me at [new number] when I arrive at X") delivers SMS to the override while WhatsApp/voice/email still reach the user's own registered contact info, unchanged. Remaining work beyond that is explicitly non-blocking for F15 itself:

**Required before production (separate from F15 closure, standard staging-first rule):**
1. Build and deploy the batched APK (holding list `B9e`) once other AAB-only fixes accumulate, then verify `app/alerts.tsx`'s display change on-device.
2. Wael's explicit, separate approval to promote any of this from staging to production — not implied by F15 closure.

**Future work, not blocking F15 closure or production:**
3. B9a (ambiguous verbs default silently), B9b (phone/email query mismatch), B9c (disabled list still shows active), B9d (safe-area insets race / possible force-stop-geofence link), B9f (evaluate-rules callVoice not logged to sent_messages), F16 (deferred two-engine architecture doc) — all logged, all independent of F15, none block closing it.

**Cleanup, before or alongside committing:** remove or re-narrow the two (now three, counting the broadened one) temporary Layer 2/tool_use diagnostics in `naavi-chat/index.ts`, per Defect B's own Phase 6 requirement — with the smoke-test-after-removal confirmation that requirement specifies.
