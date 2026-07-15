# F19 — Phase 1: Problem Definition

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No code is written in this document. Touches Protected Core (Action Rules, Voice orchestration, Notification routing — `AI_DEVELOPMENT_GOVERNANCE.md` §4). Full-governance treatment, no shortcuts, per Wael's explicit instruction this session.

**Origin:** discovered while live-validating F17's Phase 7 test matrix (`docs/F17_PHASE5_EVIDENCE_2026-07-14.md`, `docs/SESSION_HANDOFF_2026-07-15_F17_SHIPPED_PHASE7_IN_PROGRESS.md`). F17 Phase 7 is now **frozen** — 0 of 7 tests have a verified pass on production, 3 confirmed failing, 4 never attempted (full detail in this session's transcript and the holding-list entries below). Every failure traces back to one of the sub-problems documented here, none of which are F17's own code defect — F17's voice-side implementation (self-override guards, 14 tests, Phase 5/6 review) was not found to be incorrect. The problem is that production has silently drifted behind what was built, tested, and reviewed, on several independent axes at once. This document treats the drift itself as the thing to fix, since fixing it is what F17 Phase 7 was actually blocked on.

Several sub-problems are bundled here because they share one root story (production is behind what's built) and fixing them out of order creates new bugs (see §4, dependency ordering) — not because they are one code change.

**Third revision (this revision) — see §10.** A follow-up investigation, done at Wael's direction after this document was already marked finalized, found that one of the six original sub-problems (1b) was **disproven by direct evidence** — production's `evaluate-rules` already has working self-override code; the original "email never sent" finding was a false negative caused by a logging gap in a different function (`send-user-email`), not a code defect in `evaluate-rules`. In its place, the same investigation found a real, previously-undocumented production gap in a *different* function (`report-location-event`, the live GPS-arrival path) that the original Phase 1 missed entirely. Both are detailed below with the evidence that overturned the original finding. This is exactly the "verify every carried-over claim yourself" discipline this project has already had to learn the hard way — including, this time, from its own finalized documents.

---

## 1. What exactly is broken

**1a. `resolve-recipient` Edge Function was never deployed to production Supabase.** It exists in source (`supabase/functions/resolve-recipient/`), is deployed and working on staging, and is depended on by mobile's, voice's, and `evaluate-rules`'s third-party-recipient resolution code — but has never been pushed to the production project (`hhgyppbxgmjrwdpdubcx`). **Re-confirmed this revision** by an independent method (direct `supabase functions download` against production, not just `functions list` — see §2a).

**1b. CLOSED — DISPROVEN, not a real defect.** Originally documented as "production's `evaluate-rules` Edge Function predates the self-override feature entirely." Direct evidence gathered this revision shows production's deployed `evaluate-rules` source already contains full, correct `self_override_email`/`sms`/`whatsapp`/`voice` handling. The original "email never sent" finding was a false negative — see §2b for the full reconstruction of what actually happened and why the original evidence was misleading.

**1c. Voice never captures a third-party recipient's name at all for a location alert phrased as "text NAME when I arrive at [a literal street address]."** Not a resolution failure — the name is dropped before any resolution logic is ever reached. Not touched by this revision's re-investigation — stands as originally documented. (Holding list: **B9w**.)

**1d. An unresolved or never-captured third-party recipient doesn't fail or block at fire time — it silently redirects the alert to the user themselves,** with nothing indicating it was ever meant for someone else. Not touched by this revision's re-investigation — stands as originally documented, and confirmed to apply even more directly to 1g below (`report-location-event` has no fire-time re-resolution safety net at all — see §2d). (Holding list: **B9x**.)

**1e. Self-override SMS to a raw phone number (not a contact name) is unreliable in two ways:** historical digit-capture inconsistency, and a freshly-reproduced confirmation loop that never accepts "yes," blocking the alert from ever being created. Not touched by this revision's re-investigation — stands as originally documented. (Holding list: **B9y**.)

**1f. Mobile production (build 301) is six build numbers behind staging (build 307)** and predates F12 entirely — meaning mobile production doesn't yet contain the code that depends on 1a/1g, and is currently protected from those bugs only by accident, not by design. Not touched by this revision's re-investigation — stands as originally documented.

**1g. NEW, this revision — `report-location-event` (the live GPS-arrival firing path) has never received self-override support in production, and is a month further behind than 1b was mistakenly believed to be.** Unlike `evaluate-rules` (the cron path, confirmed healthy this revision — see 1b), `report-location-event` genuinely lacks `self_override_*` handling on production: its last production deploy (2026-06-15) predates F15 (2026-07-09), the feature that introduced self-override, by three and a half weeks. The corrected version already exists — deployed to staging, sitting uncommitted in the local working tree (see §2g) — but was never promoted to production. This is the same class of gap 1a describes, just in a function nobody had checked yet.

### Classification (updated per this revision)

| # | Issue | Category | Status |
|---|---|---|---|
| 1a | `resolve-recipient` never deployed to production | Infrastructure | Open |
| 1g | `report-location-event` never received self-override, production is 3.5 weeks behind F15 | Infrastructure | **Open — new this revision** |
| 1f | Mobile production 6 builds behind staging, predates F12 | Infrastructure | Open |
| 1c | Voice never captures a third-party recipient's name (B9w) | Application Logic | Open |
| 1d | Unresolved recipient silently misfires to self (B9x) | Application Logic | Open |
| 1e | Self-override SMS confirmation loop + digit-capture inconsistency (B9y) | Application Logic | Open |
| 1b | `evaluate-rules` deployed before self-override handling existed | — | **CLOSED — disproven this revision** |

The Infrastructure items are deployment/promotion gaps with no code defect at their core — the fix is "ship what already exists and works on staging," sequenced correctly (§4). The Application Logic items require actual code changes to `naavi-voice-server` and/or `evaluate-rules`'s classification logic. This split is informational for Phase 2 planning, not a scope change — both categories remain part of F19.

---

## 2. What evidence proves the problem

### 2a. `resolve-recipient` missing from production

- `npx supabase functions list --project-ref hhgyppbxgmjrwdpdubcx` does not list `resolve-recipient` (confirmed twice, at different points the original session). Only `resolve-place` and `resolve-entity-ref` appear among `resolve-*` slugs.
- Direct call: `curl -X POST https://hhgyppbxgmjrwdpdubcx.supabase.co/functions/v1/resolve-recipient` (with valid production `apikey`/`Authorization` headers) returns `{"code":"NOT_FOUND","message":"Requested function was not found"}`, HTTP 404 — a gateway-level "function doesn't exist" response, not an application error.
- **Control test, original session, same method:** calling `resolve-place` (confirmed deployed) the identical way returns a real application-level error — `{"status":"error","error":"Missing user_id or place_name"}`, HTTP 400 — proving the test method is sound and the 404 on `resolve-recipient` is real, not a methodology artifact.
- `npx supabase functions list --project-ref xugvnfudofuskxoknhve` (staging) **does** list `resolve-recipient` — confirming the function is built and working, just never promoted.
- **Re-confirmed this revision by a second, independent method:** `npx supabase functions download resolve-recipient --project-ref hhgyppbxgmjrwdpdubcx` returns `Error status 404: {"message":"Function not found"}` — a download attempt, not a live HTTP call, giving the same answer through a completely different code path in the CLI. Two independent methods now agree.

### 2b. `evaluate-rules` — ORIGINAL FINDING DISPROVEN. What actually happened.

**Original claim (now withdrawn):** production's `evaluate-rules` metadata showed `updated_at = 2026-07-14T00:45:46Z`, about 74 minutes before commit `c33b494` (which added `self_override_email` handling to the source, committed `2026-07-14T01:59:32Z`). The original document concluded production's deployed code has no path for `self_override_*` at all, and treated a subsequent live reproduction (an alert with `self_override_email` set, at fire time an SMS went to the user's own number and no email row ever appeared in `sent_messages`) as confirmation.

**Why that conclusion was wrong — direct evidence, this revision:**

- `npx supabase functions download evaluate-rules --project-ref hhgyppbxgmjrwdpdubcx` was run to fetch the **actual deployed source**, not just its metadata timestamp. `grep -n "self_override" ` on that downloaded file returns 9 matches at lines 665–668, 829, 968–971 — the full `selfOverrideEmail`/`Sms`/`Whatsapp`/`Voice` extraction, the `hasSelfOverride` classification, and the per-channel target substitution are all present, structurally identical to the local/staging copy.
- Diffing the downloaded production source against the local repo copy shows exactly one difference: a 32-line block adding `sent_messages` voice-call audit logging (the B9f fix, 2026-07-14) — nothing related to self-override is missing. **The deploy timestamp used as proof in the original document does not mean what it was assumed to mean** — the code was evidently live before commit `c33b494` formalized it in git (the same deployed-but-uncommitted pattern documented in §2g below), and the commit merely caught git up to what was already running.
- Re-reading the original reproduction's own row data (`action_rules` id `da1cdddd-38fd-4671-9a54-15a60f3e8a86`, re-fetched this revision directly from production): `action_config = {"body": "...", "self_override_email": "whwh2207@gmail.com"}`, `action_type = "email"`. Tracing this exact row through the *actual* deployed code: `noRecipient` is true (no `to_phone`/`to_email`), `hasSelfOverride` is true, so `isSelfAlert` is correctly `true`. In the self-alert branch, `selfSmsTarget` falls back to the user's own phone (no SMS override was given) and — Wael's own `alert_channels_enabled` (`["email","push","voice_call","sms"]`, re-checked this revision) has SMS enabled — so an SMS to the user's own number **is the correct, designed behavior**, not evidence of a bug. Every enabled channel without its own override still reaches the user normally; only the channel that *was* overridden gets redirected. The presence of that SMS was never evidence that email failed.
- The actual gap: `send-user-email` (the function `evaluate-rules` calls for the email channel) **does not write to `sent_messages` at all** — confirmed by reading its source directly; there is no `sent_messages` reference anywhere in the file, unlike `send-sms` which logs on every send. So "zero rows in `sent_messages` with `channel='email' AND source='alert'`, ever" was never proof that no email was sent — it is guaranteed to read as zero regardless of whether email delivery succeeds, because nothing in that code path ever writes such a row. This is an absence-of-evidence read as evidence-of-absence.
- **Live diagnostic test, this revision, with Wael's explicit permission:** called `send-user-email` directly against production with Wael's real `user_id`, targeting the same `whwh2207@gmail.com` test inbox used in the original reproduction. Response: `{"success":true,"to":"whwh2207@gmail.com"}`, HTTP 200. The Gmail-send path is healthy on production right now.

**Conclusion:** 1b is closed. There is no evidence of any defect in production's self-override handling for the cron-fired (`evaluate-rules`) path. The original finding was a methodology error, not a code error — checking `sent_messages` was checking a table that this send path never populates.

### 2c. B9w — recipient name never captured on voice for a literal-address location phrasing

*(Unchanged from the original document — not touched by this revision's re-investigation.)*

- Production voice call: "Text XYZ when I arrive at 580 Bayview dr" → saved row `dadde218-5634-4a7b-ab15-1c1b6f98a9bf` (`hhgyppbxgmjrwdpdubcx`, created `2026-07-15T14:09:57Z`): `action_config: {"body": "You've arrived at 580 Bayview Drive."}` — no `to`, no `to_name`, no trace of "XYZ" anywhere in the row.
- Both places in `naavi-voice-server/src/index.js` capable of resolving a named recipient for this flow (general handler ~line 4754, location-interceptor ~line 11356) are gated on `actionConfigNorm.to` / `locActionConfig.to` being non-empty before any resolution logic runs. Since the saved row has no `to` field at all, neither block could have executed — meaning Claude's own JSON generation for this utterance never populated a recipient name in the first place. The defect is upstream of recipient resolution, not inside it. Re-confirmed this revision by re-reading both call sites directly — the gating logic is exactly as described.
- **Isolated as voice-specific, not a general model/prompt limitation:** the identical phrasing shape ("Text Xxx when I arrive at 580 Bayview dr") run through the mobile Staging app the same session correctly captured `to`/`to_name`/`to_phone`/`contact_id` end-to-end (row `10f91089-05f1-4c59-b06d-4fce47c55307`, staging project `xugvnfudofuskxoknhve`, created `2026-07-15T14:26:01Z`). Deploying `resolve-recipient` to production would **not** fix this specific case — the bug is entirely upstream of that call. Naavi-voice-server is a separate Node.js codebase from mobile's `naavi-chat`/`anthropic_tools.ts` (different repo, different tool schema) — the mobile-side fix found sitting uncommitted this revision (§2g) has no bearing on voice's copy of this logic.

### 2d. B9x — unresolved recipient silently misfires to self

*(Unchanged from the original document, with one addition confirmed this revision.)*

- `supabase/functions/evaluate-rules/index.ts:825`: `const noRecipient = !toPhone && !toEmail;`
- `index.ts:830`: `const isSelfAlert = Boolean(hasSelfOverride || isSelfByPhone || isSelfByEmail || noRecipient);`
- This cannot distinguish "no recipient was ever specified" from "a recipient was named but never resolved to a phone/email" — both produce `toPhone`/`toEmail` empty, both collapse into `isSelfAlert = true`.
- The one existing safety net — fire-time re-resolution via `resolve-recipient`, gated on `config.contact_id` (`index.ts:682`) — only engages when a `contact_id` was captured at creation time, which requires the resolve-recipient-based write path to have succeeded in the first place.
- **New this revision:** `report-location-event/index.ts` has **no equivalent safety net at all** — grepped directly for `resolve-recipient` in that file, zero matches. The live GPS-arrival path has neither the fire-time re-resolution `evaluate-rules` has, nor self-override support (1g). It is currently the most exposed of the two firing paths to this exact bug class.
- **Reproduction 1** (mobile, production build 301): "Send sms message to Abdyn when I arrive at office" saved as `{"to": "Abdyn"}` only — row `bb48e478-c863-4832-8f62-750a6a70cf3b`, no `contact_id`.
- **Reproduction 2** (voice, production): see §2c, row `dadde218` — no recipient info at all, also no `contact_id`.
- Both rows, at their actual GPS-arrival fire time, will misdirect their message to the user's own registered channels, framed as if it were a self-alert ("You've arrived at..."), with nothing telling the user it was meant for someone else. **Not yet observed at actual fire time** (both are dwell-based location triggers, not yet arrived-at) — traced from stored data + code, not yet watched fire live.

### 2e. B9y — self-override SMS: digit-capture inconsistency + confirmation loop

*(Unchanged from the original document — not touched by this revision's re-investigation.)*

- Three `action_rules` rows from the same testing window (2026-07-15, 1:09-1:38 AM EDT), all intended to use the same spoken/typed number: two stored `self_override_sms: "+13433332567"` (rows `baaecfdc`, `bcb5e02d`); one stored `"+12343332567"` (row `c1409004`) — area code 234 instead of 343, same trailing digits.
- Checked `user_settings` directly: Wael's registered number is `+16137697957`. `+13433332567` belongs to two unrelated demo accounts named "Robert," not to Wael's own row — refuting the prior session's recorded explanation ("Wael's own phone has multiple carrier profiles, not a bug").
- **Fresh live reproduction, original session:** re-running the identical phrase ("Text me at 3433332567 in 3 minutes") on production voice produced a confirmation loop — Naavi repeated the confirmation question 4 times and never accepted "yes." Confirmed via direct query that no new `action_rules` row was created (fails closed, at least, but the flow is completely non-functional for this phrasing right now).

### 2f. Mobile production version gap

*(Unchanged from the original document — not touched by this revision's re-investigation.)*

- Screenshot-confirmed: production app currently shows "MyNaavi — V57.75.0 (build 301)."
- Commit `1643b8b`: `chore: bump version to 1.0.301 / versionCode 301 / build 301 (V57.75.0)`. Commit `6946f74`, immediately prior: `chore: bump Firebase Test Lab GCS filename to naavi-v301.apk` — Firebase Test Lab is the mandatory gate that runs only before a production AAB, confirming build 301 went through the production release pipeline.
- The very next commit, `d01530a`: `bump build 301 -> 302 for F12 staging validation APK` — everything from 302 onward (→305→306→307) is explicit staging-only iteration, never promoted.
- `git merge-base --is-ancestor 1643b8b b034e10` confirms the build-301 commit is an ancestor of `b034e10` ("F12 tier 3: wire mobile/voice to resolve-recipient...") — i.e., **production predates F12 entirely**, and by extension F15 and F17's mobile-side work too.
- Current repo `app.json`: `versionCode: 307`, matching staging.
- **Practical consequence, confirmed by direct testing the original session:** production mobile's third-party alerts (e.g. the "Bob" test) currently work, but only because they run through an *older* code path (`lookupContact()` directly) that predates and doesn't need `resolve-recipient` at all. This is accidental protection, not correctness — promoting to build 307/308 without first fixing 1a/1g would immediately import the same silent-misfire bugs into mobile production that voice just exposed.

### 2g. NEW, this revision — `report-location-event` production gap, and the git/deploy parity issue that explains it

- `git status` shows three files as **modified but uncommitted** in the working tree: `supabase/functions/_shared/anthropic_tools.ts`, `supabase/functions/get-naavi-prompt/index.ts`, `supabase/functions/report-location-event/index.ts`. Their last git commits (2026-06-23, 2026-07-03, 2026-06-27 respectively) all predate F15 (2026-07-09), yet the uncommitted diffs contain F15-dated content (self-override fields, channel-scoped substitution logic).
- **Downloaded the actual staging-deployed source** for all three (`supabase functions download <slug> --project-ref xugvnfudofuskxoknhve`, into an isolated scratch directory, not the working repo) and diffed byte-for-byte against the local uncommitted files: **zero differences on all three.** Staging is running exactly what's sitting uncommitted locally — it was deployed straight from disk (Edge Function deploys read local files, not git) and simply never committed afterward.
- **Downloaded the actual production-deployed source** for the same functions and compared:
  - `report-location-event`: 106-line diff against local; `grep -c self_override` on the production copy returns **0**. Production's live GPS-arrival firing path has no self-override handling whatsoever.
  - `get-naavi-prompt`: production's `PROMPT_VERSION` string reads `'2026-07-02-v132-f5b-dedup-confirmation-wording'` — zero occurrences of `self_override` in the file, but 42 occurrences of `set_location_rule_chain`/`set_location_rule_address` (so the location-tool split itself is already live in production; only the self-override and recipient-name-capture prompt text is missing).
  - `anthropic_tools.ts`: production's version has 6 occurrences of `self_override` and 10 of `set_location_rule_chain`/`address` — meaning **mobile's tool schema on production is partially, not fully, behind**. This needs a closer line-by-line diff in Phase 2 to establish exactly what subset is missing; not fully characterized in this Phase 1 pass.
- **Function deploy timestamps, checked directly (`supabase functions list`), all in UTC:**

  | Function | Staging | Production |
  |---|---|---|
  | get-naavi-prompt | 2026-07-10T02:00:15 | 2026-07-03T08:25:27 |
  | report-location-event | 2026-07-10T01:59:53 | **2026-06-15T08:24:52** |
  | naavi-chat | 2026-07-14T13:36:21 | 2026-07-14T00:45:35 |

  `report-location-event`'s production deploy is nearly a month stale relative to F15, and over three weeks stale relative to when staging received the fix.

---

## 3. Root cause statement

**Common root cause (unchanged by this revision):** production environment parity has not been maintained across application code, Edge Functions, and mobile builds. Each sub-problem is a different symptom of that same underlying condition.

**Immediate causes vs. systemic cause:** the sub-problems below are the **immediate causes** — each is independently sufficient to explain its own symptom, and each is what Phase 2 will actually fix. Underneath sits one **systemic cause**: the lack of a deployment parity verification step (detailed at the end of this section) that would have caught any one of them before it reached production validation.

**PROVEN, by direct citation for each sub-problem — not inferred:**

1. `resolve-recipient` was built and validated on staging but never promoted to production (deployment gap, not a code defect) — proven by two independent methods this revision (live 404 + CLI download 404).
2. ~~`evaluate-rules` was deployed to production before the commit that added self-override handling~~ — **disproven this revision.** Production's `evaluate-rules` already handles self-override correctly; the deploy-timestamp-vs-commit-timestamp comparison used as the original proof does not establish what was assumed, because the code can be (and evidently was) deployed to production before the corresponding commit landed in git — the same pattern documented in finding 6 below, just discovered a revision late for this specific function.
3. Voice's Claude-facing prompt/tool-use flow does not extract a recipient name for "text NAME when I arrive at [literal address]" phrasing — confirmed by the total absence of a `to` field in the resulting row, with both possible resolution call sites gated on that field being present.
4. `evaluate-rules`'s (and, more severely, `report-location-event`'s — which has no fire-time re-resolution at all) self/third-party classification treats "recipient never specified" and "recipient specified but unresolved" identically (`noRecipient = !toPhone && !toEmail`), with no fallback distinction unless a `contact_id` was already captured.
5. Voice's confirmation-loop handling for a raw-digit self-override SMS destination does not accept "yes" reliably, and (separately, not yet root-caused) digit capture for this phrasing has shown at least one confirmed transposition across otherwise-identical attempts.
6. Mobile production is on a build that predates F12, F15, and F17's mobile-side work by 6+ build numbers, and is currently shielded from 1/1g above only because it doesn't yet contain the code that depends on them.
7. **New this revision:** `report-location-event` was fixed for self-override on staging (2026-07-10) but the fix was never deployed to production, and — separately — was never committed to git at all, which is why the original Phase 1 pass missed it: a `git log` or `git diff HEAD` check would show nothing, because there is nothing to show. Only a direct comparison of *deployed source* against the local working tree surfaces it.

**Not yet proven (flagged per governance's No Assumptions Rule):** whether fixing 1a and 1g alone resolves B9x's practical impact (§2d) — the code reads `contact_id`, which requires `resolve-recipient` to have succeeded at creation time, but whether every write path correctly captures `contact_id` on success has not been independently re-verified against current code. This needs explicit verification in Phase 2, not assumed as a side effect of the other fixes. Also not yet proven: the exact scope of what's missing from production's `anthropic_tools.ts` relative to staging/local (§2g) — confirmed partially behind, not yet diffed line-by-line.

**Systemic cause — the process gap behind the drift, and a second one found this revision:**

This document explains *what* drift exists, not *why* it was allowed to happen. The underlying process weakness, as originally identified: **there is currently no deployment parity verification step that confirms production and staging contain the same required components before production validation begins.** Nothing in the current release process checks "does production actually have every Edge Function this feature's code depends on" before a feature is tested live.

**Second, related process gap found this revision:** Edge Function deploys read from local disk, independent of git commit state. This means a deploy can happen (to staging or production) without ever being committed — as it did for `report-location-event`, `get-naavi-prompt`, and `anthropic_tools.ts`. This makes `git log`/`git diff` an unreliable signal of "what's actually running" in either direction: code can be deployed-but-uncommitted (silently ahead of git, as found here) or committed-but-undeployed (the more commonly assumed direction, as in 1a). **This is a second, distinct process-level finding** from the first — not just "production doesn't match staging," but "git doesn't reliably reflect what's deployed anywhere, in either direction." Once that happens — once a deploy can exist that git has no record of — git stops being the source of truth for the running system. The repository, staging, and production become three things that can each independently diverge, not one thing viewed from three angles. That is what makes reproducing production difficult after the fact: there is no longer a single artifact you can point to and say "this is what's running."

**Elevated to a first-class future initiative, per Wael's explicit direction (2026-07-15):** these two systemic findings are formalized as the founding objectives of the planned **Architecture Integrity Audit** — not a vague cleanup exercise, but a strategic initiative with two explicit, verifiable objectives:

- **Objective A — Every deployed artifact must be reproducible from a tagged release in Git.** No Edge Function, no mobile build, no voice-server deploy should be able to exist in a state that git cannot regenerate — and "git" here means a specific, immutable release point (a tag or equivalent release manifest), not just "somewhere in history." Reproducibility from an untagged commit stream is insufficient when multiple commits could plausibly be what's deployed; a tag makes the deployment target unambiguous. This directly targets the "deployed-but-uncommitted" failure mode found in this revision (`report-location-event`, `get-naavi-prompt`, `anthropic_tools.ts`).
- **Objective B — Production and staging must be verifiably identical except for intended environment differences.** Not "probably in sync" — verifiably so, on demand, by a repeatable check. This directly targets the "production is behind staging" failure mode that is F19's own throughline (1a, 1g, 1f).

Both objectives are direct products of this investigation, not abstract process aspirations — F19 is the case study that proves they're needed. The Audit itself remains **out of scope for F19** (§7) — it is not scoped, sized, or started here — but it is now tracked as its own item (see `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, Tooling, T1a).

---

## 4. Dependency ordering — why sequence matters here

This is not a set of independent tickets that can ship in any order:

1. **1a and 1g (Edge Function deploys) must land before 1f (mobile version promotion).** Promoting mobile to build 307/308 first would immediately expose mobile production to the exact bugs found on voice tonight (silent third-party misfire), since build 307+'s code depends on `resolve-recipient` (1a). (1b is closed and no longer part of this ordering — it required no fix.)
2. **1c and 1e (voice-server code bugs) are independent of 1a/1g** and do not require the Edge Function deploys to fix — but fixing 1a/1g alone will **not** fix 1c or 1e. A reader could otherwise assume "redeploy the Edge Functions and F17 Phase 7 will pass" — it will not; the tests covering 1c and 1e will still fail without those also being fixed.
3. **1d's resolution depends on Phase 2 investigation**, not just on 1a/1g landing — per §3's open question, whether `contact_id` capture is reliable enough post-fix to make the existing fire-time safety net (`evaluate-rules index.ts:682`) actually engage needs explicit verification, not assumption. `report-location-event` has no such safety net at all yet — Phase 2 needs to decide whether to add one, or accept the gap as a smaller-scoped risk given it only affects unresolved third-party recipients on the live-fire path.
4. **Before any of 1a/1g/1f ship, Phase 2 should close out the exact scope of `anthropic_tools.ts`'s production gap** (§2g flagged this as partially, not fully, characterized) — deploying `naavi-chat` (which bundles that shared file) without knowing precisely what changes is a Protected Core deploy without a complete diff, which the governance process (§6 of this document) exists specifically to prevent.
5. **F17 Phase 7 should be explicitly re-opened and re-run once the remaining items are live** — it is not separately re-earned by this project; it becomes retestable, and should be treated as such rather than left permanently frozen with a stale "failed" label once its blockers are gone. **Note for whoever re-runs it:** the specific F17 Phase 7 test that exercises self-override email should be re-examined — this revision's findings suggest it may have already been passing on production (the cron path, at least) all along, and the original "failed" verdict may itself need correction, not just re-running.

---

## 5. Ruled out / considered

- **"Maybe production's evaluate-rules silently falls back to some other correct behavior for self-override fields."** Originally ruled out based on evidence that has since been disproven (§2b) — see the revised §2b for the corrected account. The self-override handling was never missing; the original evidence-gathering method couldn't observe email delivery at all.
- **"Maybe the third-party recipient bug on voice (B9w) is caused by the same missing `resolve-recipient` function as 1a."** Ruled out — the saved row has no `to` field at all, meaning resolution was never attempted, not that it was attempted and failed. Deploying `resolve-recipient` would not change this outcome (§2c).
- **"Maybe mobile production's current 'Bob' test success proves resolve-recipient-based third-party resolution already works correctly there."** Ruled out — that test ran on pre-F12 code (`lookupContact()` directly), not the resolve-recipient path; it doesn't validate the newer path at all (§2f).
- **"Maybe the self-override SMS confirmation loop and the historical digit-transposition are the same bug."** Not established either way — treated as two related but separately-unconfirmed findings under B9y until Phase 2 investigates further.
- **New this revision — "Maybe the uncommitted local changes in the three files are abandoned/experimental work, not real fixes."** Ruled out — `set_location_rule_chain`/`set_location_rule_address` are real, currently-defined tools in `anthropic_tools.ts` (not a stale experiment), and the self-override diffs in all three files were confirmed byte-identical to what's actually running on staging right now. This is live, working, tested code that simply never got promoted or committed.
- **New this revision — "Maybe the original 1b reproduction really did fail to send an email, for some reason other than a code defect (e.g., a Gmail API transient error at that specific moment)."** Not ruled out with certainty — the live diagnostic test this revision confirms the pathway is healthy *now*, not necessarily at the exact moment of the original test. But there is no code-level explanation for a systematic failure, and no code changed between the original test and this revision's diagnostic call. Treated as sufficiently resolved to close 1b; flagged here for completeness rather than asserted as airtight.

---

## 6. Why this is a full-governance item, not a quick fix

`Action Rules`, `Notification routing`, and `Voice orchestration` are all named explicitly in `AI_DEVELOPMENT_GOVERNANCE.md` §4's Protected Core list. `evaluate-rules` and `report-location-event` between them fire every alert for every user on both platforms — the widest possible blast radius this system has. Per §4, this automatically requires technical review before coding (Phase 3) and after (Phase 6), and per §2's Risk Classification this qualifies as **High Risk** given the number of interacting root causes and the fact that several of them (1a, 1g, 1f) are production-only deploys with no staging-equivalent dry run available for voice.

**Failure mode includes silent misdelivery of user notifications.** Every confirmed defect in §2 fails silently — no error surfaced to the user, no visible symptom, the app reports success while the wrong thing (or nothing) happens. Silent failures carry materially higher risk than visible ones: they erode user trust without giving the user any signal to report, and they are far harder to detect through normal use. This is a material factor in the High Risk classification, not just the Protected Core designation alone.

**Added this revision:** the fact that a "finalized, reference-quality" Phase 1 document itself contained a disproven root-cause claim is a direct demonstration of why this process requires evidence checked against the *actual running system*, not against metadata or timestamps alone, and why a second pass — even after sign-off — surfaced a real, previously-invisible production gap (1g) that the first pass's methodology could not have found (git history showed nothing, because there was nothing committed to show).

---

## 7. Scope boundary

This document covers the sub-problems in §1, all discovered during F17 Phase 7 validation or this revision's follow-up. It does not re-open F17's own already-reviewed voice code (self-override guards, schema changes — those were not found defective). It does not include F18 (international phone numbers) or F9a (Google App Actions) — separately scoped, not started, not touched here.

**No architectural refactoring is included in this project.** Fixes are scoped to the confirmed defects in §1, deployed and implemented as narrowly as each requires. This is not an opportunity to redesign the recipient-resolution or alert-delivery architecture — that temptation is explicitly ruled out here so Phase 2 doesn't drift into a broader cleanup effort.

**Also out of scope, flagged in §3:** fixing the two systemic/process gaps — now named Objective A (every deployed artifact reproducible from Git) and Objective B (production/staging verifiably identical except for intended differences) of the planned Architecture Integrity Audit — is not part of F19. F19 fixes the symptoms found; it does not build the process that would catch the next one.

---

## 8. What alternatives exist (Phase 2 work — not evaluated yet)

Not designed here; flagged only as the shape Phase 2 will need to evaluate:

1. Deploy order and rollback plan for `resolve-recipient` and `report-location-event` to production — likely first, since 1f depends on them. (`evaluate-rules` no longer needs a self-override-related redeploy — 1b is closed — though it may still need the routine B9f-logging parity check if production and staging drift on unrelated points.)
2. Root-cause investigation for B9w (voice recipient-name extraction) — likely a prompt/tool-use instruction gap specific to this phrasing shape, not yet designed.
3. Root-cause investigation for B9y's confirmation loop specifically (separate from the digit-transposition question) — needs its own live-trace, possibly via added logging, before a fix is designed.
4. Whether B9x needs an explicit code fix (e.g., distinguishing "no recipient" from "recipient present, unresolved" as separate states) or is fully closed once 1a/1c land and `contact_id` capture is verified reliable — Phase 2 must verify this explicitly, not assume it. `report-location-event`'s complete lack of a re-resolution safety net (§2d) needs its own explicit decision — add one, or accept the narrower risk.
5. Mobile promotion mechanics (build 307 vs a fresh 308) and the full Two-Phase Build gate sequence (auto-tester, voice regression, Firebase Test Lab) once the above are resolved.
6. **New this revision:** a full line-by-line diff of production vs. local `anthropic_tools.ts` to establish exactly what subset of the mobile tool schema is missing on production (§2g noted this is only partially characterized) — needed before `naavi-chat` can be safely redeployed to production.
7. Whether and how to correct F17 Phase 7's own recorded verdict for the self-override-email test, given this revision's finding that it was likely passing on the cron path already (§4, item 5).

Risk classification, exact file list, regression impact table, and parity/dependency validation strategy remain Phase 2 work, not done here.

---

## 9. Next step

Phase 2 — Change Planning, per governance. Given Protected Core + High Risk (§6), Phase 2's plan will require Phase 3 external technical review before any code is written.

**Completion criteria for Phase 2 (carried forward, unchanged in substance):** F19 is not a bug-fix list — it is a **production parity restoration project.** Phase 2 must define completion as:

1. Production and staging are functionally aligned for every component the confirmed sub-problems touch (`resolve-recipient`, `report-location-event`, the affected `naavi-voice-server` code paths, mobile build parity, and — newly scoped in this revision — `anthropic_tools.ts`'s exact production gap).
2. F17's frozen Phase 7 test matrix can be re-run under production conditions equivalent to what staging already validates — not a lower bar, not a partial re-check, and with its self-override-email verdict specifically re-examined per §4 item 5.
3. All confirmed drifts in §1 are eliminated, not merely worked around.

Phase 2 should state its own completion criteria in these terms explicitly, not inherit them implicitly from this document.

---

## 10. Revision history

- **2026-07-15, original version:** established all six sub-problem root causes via direct evidence (deploy-timestamp comparisons, live-reproduced test rows, code citations), documented the dependency ordering between them, and explicitly froze F17 Phase 7 as the origin and first beneficiary of this work.
- **2026-07-15, first revision, after external review:** review assessed the original as strong on evidence, fact/assumption separation, and scope control, with five recommendations, all adopted — (1) added an Infrastructure/Application Logic classification of the six sub-problems (§1); (2) added a one-sentence common-root-cause framing to §3 ("production environment parity has not been maintained"); (3) added a process-gap finding to §3 — no deployment parity verification step currently exists — flagged as belonging to a separate future initiative (tentatively an Architecture Integrity Audit), not scoped into F19; (4) added "failure mode includes silent misdelivery of user notifications" to §6's risk classification; (5) added an explicit "no architectural refactoring included" statement to §7's scope boundary. Review scored the document 10/10 on technical accuracy, evidence quality, governance compliance, and scope discipline; 9.5/10 on root-cause discipline pending recommendation 3, now addressed above. No section was found to contain an unproven claim stated as fact.
- **2026-07-15, second revision, after follow-up review:** two further refinements adopted — (1) §3 now explicitly labels the six sub-problems as **immediate causes** and the process gap as the single **systemic cause** underneath them, for clearer causal traceability; (2) §9 now reframes F19 explicitly as a **production parity restoration project**, not a bug-fix list, and states three concrete completion criteria for Phase 2 to formalize. Reviewer assessed this as reference-quality for future Protected Core projects.
- **2026-07-15, third revision (this revision) — after Phase 2 kickoff surfaced new evidence that contradicted a "finalized" finding:** while preparing to start Phase 2, three Protected-Core files were found with substantial uncommitted changes. Investigating their deploy status (via direct `supabase functions download` against both staging and production, not just metadata) led to two significant corrections:
  1. **1b (production `evaluate-rules` predates self-override) is disproven and closed.** Direct source download proved production's deployed code already has correct, complete self-override handling. The original evidence (an empty `sent_messages` query) was a false negative — the function that sends the email channel (`send-user-email`) never logs to that table at all, regardless of whether delivery succeeds. A live diagnostic test (sent with Wael's explicit permission) confirmed the Gmail-send path works correctly on production today. Full reconstruction in the revised §2b.
  2. **1g (new) — `report-location-event`, the live GPS-arrival firing path, has never received self-override support in production**, and is roughly a month stale relative to F15 — a materially worse gap than 1b was mistakenly believed to be, undetected by the original Phase 1 pass because the fix was deployed to staging directly from disk and never committed to git, so a git-only check could not have found it.
  A second, previously undocumented systemic issue was also identified: Edge Function deploys read from local disk independent of git commit state, meaning git history is not a reliable signal of what's actually running in *either* direction (ahead or behind) — noted in §3 as a second systemic cause, out of scope for F19 itself. This revision demonstrates, within the project's own documentation, the exact discipline the project's memory already names as a standing rule: verify every carried-over claim — including a document's own prior "finalized" verdicts — against the live system before building on top of it.
- **2026-07-15, fourth revision — elevated per Wael's explicit direction, after reviewing the third revision.** Wael's assessment: the git-parity finding "is extremely dangerous... not because it is wrong technically... because git no longer becomes the source of truth," and the two systemic findings in §3 deserved to become **explicit, named objectives** of the planned Architecture Integrity Audit rather than a passing mention. Adopted: §3 now states **Objective A** (every deployed artifact must be reproducible from Git) and **Objective B** (production and staging must be verifiably identical except for intended environment differences) as the Audit's founding objectives, framed explicitly as strategic risk-reduction rather than cleanup. The Audit itself is now tracked as its own holding-list item (`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`, Tooling, T1a) rather than existing only as a parenthetical in this document. No new evidence was gathered this revision — this is an editorial elevation of already-proven findings, not a new investigation.
- **2026-07-15, fifth revision (this revision) — terminology refinement, no new evidence.** Wael's assessment of the fourth revision: "excellent... I would not continue iterating on Phase 1 unless genuinely new evidence emerges." One refinement was adopted before treating Phase 1 as closed: **Objective A** now reads "reproducible from a **tagged release** in Git," not just "reproducible from Git" — reproducibility from an untagged commit stream is insufficient when multiple commits could plausibly be what's deployed; a tag (or equivalent immutable release manifest) makes the deployment target unambiguous. Wael's own framing: "that is a refinement rather than a correction." **Phase 1 is now treated as complete.** Per Wael's explicit assessment (comparing all five revisions: evidence-first investigation → clearer root-cause framing → correction of a disproven conclusion → strategic objectives → this terminology refinement), further Phase 1 edits would have diminishing returns absent genuinely new evidence. Effort moves to Phase 2 — Change Planning — preserving the same evidence, dependency-analysis, and scope-discipline standard established here.
