# F19 Track B — Phase 1: Problem Definition

**Fourth revision (this revision), added after live-testing the shipped 1e fix (`naavi-voice-server` commit `74a05d6`) on production, 2026-07-16.** The confirm-gate fix itself worked exactly as designed — one execution attempt, truthful spoken result, no more silent repeats (see §2h for the full turn-by-turn trace). But the failure it truthfully reported (a 409) turned out **not** to be caused by the mechanism §2g named. Direct Postgres error evidence (Supabase Postgres Logs, not inferred) shows a **different constraint fired — `action_rules_user_label_unique` on `(user_id, label)`, not `action_rules_unique_enabled_time`** — and that constraint **is not in any git-tracked migration file.** §2g's citation of the datetime-based index as the working mechanism was incorrect for this reproduction; §2h below corrects it with direct evidence and opens a new, unreviewed line of investigation. **This revision restarts Phase 1 rigor for the 409-origin question specifically** — it does not reopen or invalidate the confirm-gate defect/fix from §2g, which is proven, shipped, and unaffected by this correction.

**Third revision, added after the Phase 2 §5 investigation was actually run.** The live-traced 1e reproduction (transcript + `[Barge-in]` + Claude response + tool call, per Phase 2 §5's logging plan) was executed on production and evaluated against the predefined confirmation-criteria table. Result: **"Neither confirmed"** — neither predefined mechanism fit — which per that table's own instruction means continue investigating rather than force a verdict. §2g below documents what that continued investigation found: **a proven implementation defect, distinct from both original 1e hypotheses, with one contributing detail still open** — per Phase 3 review of this revision (conditionally approved), the wording below distinguishes what is fully proven (the defect itself) from what remains unresolved (the specific origin of the first 409 response). No prior section's proven findings are retracted.

**Second revision, added after 1c shipped and was verified live.** During Phase 5 verification of 1c's fix (`docs/F19_TRACKB_PHASE2_CHANGE_PLAN_2026-07-15.md`), a live test of a *different* acceptance criterion (self-override + location, criterion 3) surfaced what first looked like a new, fourth defect. Direct investigation (§2f below) traced it instead to an **already-documented, unfixed bug from 2026-04-19** (`project_naavi_deepgram_first_word_truncation` memory) — Deepgram dropping words from the start of an utterance during barge-in — not a new tool-schema gap. This is folded into this document rather than kept as a separate file, because it materially changes 1e's evidence picture (§2e is updated below) rather than standing alone. No prior section's proven findings are retracted; §2e and §6 are revised, everything else is unchanged from the original revision.

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No code is written in this document. Touches Protected Core (Voice orchestration, Action Rules). Covers the three sub-problems `docs/F19_PHASE2_CHANGE_PLAN_2026-07-15.md` §4 explicitly declined to design without their own investigation: 1c (B9w), 1d (B9x), 1e (B9y).

**Repo/branch check before any evidence below:** `naavi-voice-server` local `main` matches `origin/main` exactly (`git fetch` + `git log main..origin/main` → empty). `main` is 4 commits behind `staging` by content (F12/F17 self-override + resolve-recipient wiring, cherry-picked onto `main` at different hashes: `aeca218` on `main` = `474bd98` on `staging`, etc.) plus 7 further `staging`-only commits that are F11a demo-script work, unrelated to this investigation. Railway deploys from `main` (confirmed in F17 Phase 2). All evidence below is read from `main` at `aeca218` (2026-07-14T21:42:06-04:00) — the actual production-deployed voice code, and it already includes F12/F17's resolve-recipient + self-override wiring. This matters: Phase 1's original 1c/1e reproductions (2026-07-15, after this commit) were tested against this same code, not stale code.

---

## 1. What exactly is broken (revised from original Phase 1 scoping)

**1c — unchanged, root cause now proven with file:line evidence (was: root cause identified, not fully characterized).**

**1d — narrower than originally scoped. New evidence found this session revises its real-world exposure downward.**

**1e — root cause NOT proven. This session did not find a code-level bug; the mechanism is very likely prompt/conversational, not a JS state-machine defect. Flagged explicitly per governance's No Assumptions Rule rather than guessed at.**

---

## 2. Evidence

### 2c. 1c — voice never captures a third-party recipient name for "text NAME when I arrive at [address]"

Both resolution call sites in `naavi-voice-server/src/index.js` were re-read directly against current `main`:

- General (non-location) `SET_ACTION_RULE` handler, `executeAction()` — lines 4668-4825. Resolution logic (lines 4744-4784) is complete and correct: resolves `to` via `resolve-recipient`, captures `to_phone`/`to_email`/`to_name`/`contact_id` on `resolved_contact`, handles `literal_email`/`literal_phone` directly, and **fails closed** on `ambiguous`/`not_found`/`invalid` (`return { success: false, error: ... }` — the row is never inserted with an unresolved destination).
- Location-interceptor handler — lines 11330-11393. Structurally identical resolution logic, same fail-closed behavior on ambiguous/not_found, same `contact_id` capture on success (line 11376).

**Both call sites are gated on `actionConfigNorm.to` / `locActionConfig.to` being non-empty before any of this runs** (`if (!hasSelfOverride && toNameVoice && !actionConfigNorm.to_phone && !actionConfigNorm.to_email)` at line 4744; identical shape at line 11353). If Claude's tool call never populates `to`, none of this code executes at all — confirming Phase 1's original finding that the defect is entirely upstream of resolution.

**Root cause, now located precisely:** `naavi-voice-server/src/anthropic_tools.js`. The shared `ACTION_CONFIG` schema (lines 97-124) does declare a `to` field (`{ type: 'string', description: 'Contact NAME only...' }` — line 100), so the field exists and is available to Claude. But neither location tool's description instructs Claude to use it:

- `set_location_rule_address` (lines 249-278) — description and all 5 examples (lines 253-259) cover only self-alerts (home/office keywords, memory-based addresses, expiry). **Zero mention of `to` or a named recipient anywhere in this tool's description.**
- `set_location_rule_chain` (lines 211-248) — same gap; examples cover chain-brand resolution only, no recipient-name example.

Compare directly to mobile's now-corrected equivalent (`supabase/functions/get-naavi-prompt/index.ts`, deployed to production this session as part of Track A): mobile's prompt now has an explicit instruction — *"When the user names a recipient ('text Bob', 'tell my wife', 'message Sarah') anywhere in the sentence, ALWAYS put that name in action_config.to"* — plus two worked examples showing `to:'Bob'` on a location-triggered SMS. **Voice's tool schema has no equivalent instruction or example anywhere.** This is not a resolution bug and not a Claude/model reasoning failure — it is a documented gap in what Claude is told to do, on one surface but not the other, for the identical phrasing shape.

### 2d. 1d — revised scope, based on new evidence this session

Original Phase 1 (2026-07-15, earlier today) described 1d as: `evaluate-rules`'s (and `report-location-event`'s) classification `noRecipient = !toPhone && !toEmail` cannot distinguish "recipient never specified" from "recipient specified but unresolved," both collapsing to `isSelfAlert = true`. Phase 1 explicitly flagged as unverified: *"whether every write path... reliably captures `contact_id` on a successful resolution... needs explicit verification in Phase 2, not assumed."*

**That verification was done this session, directly against current code, on every write path:**

| Write path | File:line | Captures `contact_id` on success? | Fails closed on ambiguous/not_found? |
|---|---|---|---|
| Voice, general handler | `naavi-voice-server/src/index.js:4776-4777` | Yes | Yes (line 4779: `return { success: false, ... }`) |
| Voice, location-interceptor | `naavi-voice-server/src/index.js:11375-11376` | Yes | Yes (lines 11378-11384: `continue` past the tool-result loop without setting a destination) |
| Mobile, `useOrchestrator.ts` | `hooks/useOrchestrator.ts:3370` | Yes | Yes (`recipientBlocked = true` on lines 3373/3382/3387, checked before any insert — verified by reading the surrounding function, not just this excerpt) |

**All three write paths are consistent: contact_id capture is reliable when a `to` name reaches resolution, and resolution failure blocks row creation rather than silently falling through.**

**What this means for 1d's actual exposure today:** the `noRecipient` misclassification in `evaluate-rules`/`report-location-event` is still a real code-level flaw — it genuinely cannot distinguish the two cases by inspecting `toPhone`/`toEmail` alone. But given the table above, **the only way a row reaches fire time with a recipient the user named but that was never resolved is if the name never reached `resolve-recipient` in the first place** — which is exactly 1c's failure mode, not an independent failure of the classification/resolution pipeline. Both of Phase 1's original 1d reproductions confirm this reading directly: the mobile row (`bb48e478...`, `{"to":"Abdyn"}` only) ran on **production build 301**, which predates F12 entirely and calls `lookupContact()` directly — it never touches the current resolve-recipient pipeline described above. The voice row (`dadde218...`) is 1c itself — no `to` field at all, so the resolution code in the table never ran.

**Revised finding: on the current codebase (post F12/F17), 1d has no proven independent reproduction.** It is downstream of 1c (fix 1c, and any row that reaches fire time with a named-but-unresolved recipient becomes newly impossible, not just less likely) — **with one residual, narrower gap**: `report-location-event` still has no fire-time re-resolution safety net at all (confirmed again this session: zero occurrences of `resolve-recipient` in that file, unchanged from original Phase 1 finding), unlike `evaluate-rules`'s `contact_id`-gated re-resolution at `index.ts:682`. This matters only if a *successfully*-resolved third-party destination becomes stale between rule creation and a location fire (e.g., the contact's phone number changes in Google Contacts) — a materially smaller and slower-moving risk than the original "silently misfires to self" framing implied. Not yet proven whether this residual gap is worth an explicit fix or an accepted risk — flagged for Phase 2 to decide, per Phase 1's own original framing of this exact question.

### 2e. 1e — SMS confirmation loop + digit-capture, root cause not proven

**What this session found:** unlike location alerts, which run through an explicit JS state machine (`pendingLocation`, gated by `AFFIRMATIVE_RE` — `naavi-voice-server/src/index.js:170` and the `if (pendingLocation)` block starting at line 10512), **there is no equivalent hard-coded pending-confirm state for time-triggered (or any non-location) `SET_ACTION_RULE` calls.** Grepped directly: zero matches for `pendingTime`, `pendingReminder`, `pendingSelfOverride`, or any `PENDING_INTENT`-style marker outside the location flow. Confirmation for "text me at +1613... in 3 minutes" is handled entirely by Claude's own conversational judgment, per the shared prompt's generic two-turn pattern (`get-naavi-prompt/index.ts:1533`: *"On yes → emit the tool call with EXACTLY the details named in turn 1"*) — there is no regex or JS gate to inspect for a bug the way `AFFIRMATIVE_RE` would be for location alerts.

**Implication:** B9y's original reproduction (Phase 1 §2e — Naavi repeated the confirmation question 4 times, never accepted "yes") is very unlikely to be a strict-regex-anchoring bug (there is no regex in this path at all) or a JS state-machine defect (there is no state machine in this path). The two most plausible mechanisms, **neither proven**:
1. STT transcribes the phone number slightly differently across turns (consistent with the separately-confirmed digit-transposition finding — `+13433332567` vs `+12343332567` across otherwise-identical attempts, Phase 1 §2e), and Claude's own conversational judgment treats the mismatch as still-unconfirmed, re-asking rather than proceeding.
2. A prompt-level ambiguity in how "confirm-then-act" applies specifically to a raw-digit self-override destination (as opposed to a named contact or a location address) causes Claude to loop defensively.

**Root cause not proven** *as of the original revision.* **Updated this revision — see §2f.** Mechanism 1 above (STT inconsistency) is unchanged in status — still not proven for 1e specifically — but is no longer an unsupported guess: the same class of failure is now directly demonstrated in a closely related scenario, which is exactly the reason to test it first, not a reason to declare it the cause.

### 2f. NEW this revision — live evidence promotes 1e's STT hypothesis to the first thing the planned investigation should test

While verifying 1c's fix, a live test of "Email me at whwh2207@gmail.com when I arrive at Costco" produced a location alert with **no `self_override_email` at all** — first suspected as a fourth tool-schema defect. Direct investigation, in order:

1. **Ruled out prompt/schema gap as the cause of this specific failure.** A controlled test against the exact same phrasing, sent via `naavi-voice-server`'s own `/test/ask` debug endpoint (bypasses the phone call and STT entirely, calls `askClaude()` directly with exact text) correctly produced `self_override_email: "whwh2207@gmail.com"`. Mobile, tested the same way via `naavi-chat` directly, also produced the correct result. The underlying Claude/tool-use logic handles this phrasing correctly on both platforms when it receives clean text.
2. **Pulled the actual Railway deploy logs for the original failing call.** The transcript line is definitive: `[Barge-in] User speaking — stopping playback` immediately followed by `[Deepgram] FINAL: "Me when I arrive at Costco."` — Wael's actual utterance was "Email me at whwh2207@gmail.com when I arrive at Costco"; Deepgram's transcript dropped "Email" and "at whwh2207@gmail.com" entirely, leaving only "Me when I arrive at Costco." Claude never received the email address — the tool call correctly reflects the (truncated) input it was given.
3. **Cross-referenced existing memory:** `project_naavi_deepgram_first_word_truncation.md` documents this exact mechanism, proven reproducing on 2026-04-19 — "Deepgram drops leading word during barge-in." That original reproduction lost one word ("What"). This revision's reproduction lost several ("Email... at whwh2207@gmail.com"), showing the truncation can be more severe than the original write-up captured. Four candidate fixes were proposed in that memory in April and **none were ever implemented.**

**What this means for 1e, stated precisely (per Wael's review, 2026-07-15) — narrower than "STT is probably the cause":**
1. STT truncation **definitely occurred** in a closely related voice scenario this session — not inferred, read directly from Railway logs.
2. That class of failure is **compatible with** the observed confirmation-loop symptom (mechanism 1 in §2e above) — a destination that reads differently to Claude on different turns, because STT delivered it differently, would produce exactly this kind of "still doesn't match, ask again" loop.
3. **Therefore it should become the first hypothesis tested** in the live-traced investigation Phase 2 already planned for 1e — not a conclusion, a starting point. That investigation should explicitly capture, per turn: the raw STT transcript, whether `[Barge-in]` fired, Claude's response, and whether a tool call was issued. Together those four observations can distinguish whether the failure originates in speech recognition, prompt interpretation, or orchestration logic — rather than assuming it's the first of those before checking.

**What this is not:** a new, fourth Track B defect. The tool-schema gap this revision's live test first appeared to expose (missing self-override guidance in the two location tools' own descriptions, mirroring 1c's original shape) is real — confirmed by direct grep, `self_override` appears only in `ACTION_CONFIG`'s field definitions, never in either location tool's own description text, on either platform — but it did not cause this specific observed failure, since Claude generalizes correctly from the shared prompt regardless. This is a latent, low-urgency defense-in-depth gap, not an active bug, and is not elevated to Track B scope by this revision.

---

### 2g. NEW this revision — the live 1e/barge-in trace, evaluated against the predefined criteria, found a third mechanism

**Reproduction (2026-07-15, ~23:17-23:18 EDT):** live call, phrase "Text me at 343-333-2567 in 3 minutes," diagnostic logging (`[F19-1e-diag]`, added per Phase 2 §5, `naavi-voice-server` commit `fb63a29`) active. Full trace, read directly from Railway Deploy Logs:

| Turn | Time (EDT) | Transcript | `bargeIn` | Tool called? | Backend result |
|---|---|---|---|---|---|
| 1 | 23:17:09 | `"Six me at 343333256. Seven in three minutes."` | **true** | No — Claude asked for clarification | n/a |
| 2 | 23:17:33→40 | `"Yes."` | false | **Yes** — `SET_ACTION_RULE`, `self_override_sms:"3433332567"`, `datetime:"2026-07-15T23:20:00-04:00"` | `[Action] SET_ACTION_RULE "SMS to 343-333-2567 in 3 minutes" — status 409` |
| 3 | 23:17:55→18:00 | `"Yes."` | false | **Yes** — identical payload | (status not captured this pass, same signature) |
| 4 | 23:18:15→21 | `"Yes."` | false | **Yes** — identical payload, spoken as `"Done."` | `status 409` (confirmed) |

**Evaluated against Phase 2 §5's predefined table:** turn 1 alone matches "Confirmed STT/barge-in mechanism" (transcript corruption immediately following `[Barge-in]`, and Claude's response — asking for clarification rather than acting — correctly matches what a corrupted transcript should produce). But turns 2-4 don't match "Confirmed prompt mechanism" either: that verdict requires Claude to *fail to act* on consistent input; here Claude *does* act (calls the tool) on every turn, correctly, with the same clean input — it's the *response to what the tool call returned* that's missing. Per the table's own instruction, this is **"Neither confirmed" — continue investigating**, which is what the rest of this section does.

**Primary implementation defect proven** (wording per Phase 3 review of this revision, conditionally approved — distinguishes what is fully proven from what remains open, see the note after the citations below). Two file:line citations:

1. `supabase/migrations/20260525000000_compliance_fixes.sql:45-50` — `action_rules_unique_enabled_time` is a partial UNIQUE index on `(user_id, trigger_config->>'datetime')` for `trigger_type='time' AND enabled=true`. This is working as designed (Configuration Discipline #5 / Data Integrity Layer 1) — it correctly blocked 2nd/3rd duplicate inserts targeting the identical rounded timestamp. **Not itself a bug.**
2. `naavi-voice-server/src/index.js:12194-12199` — the actual defect:
   ```js
   // Execute remaining actions in background AFTER speaking
   if (backgroundActions.length > 0) {
     Promise.all(backgroundActions.map(a => executeAction(a, userId))).catch(err => {
       console.error('[Process] Background action error:', err.message);
     });
   }
   ```
   Two compounding problems, both confirmed by direct code read:
   - **Timing:** `executeAction()` — which does the actual `POST /rest/v1/action_rules` (line 4789) and correctly returns `{ success: res.ok }` (line 4830) — runs *after* the TTS for that turn has already been generated and dispatched to Twilio (confirmed in the log ordering: `[Timing] T10 audio dispatched to Twilio` precedes `[Action] Executing: SET_ACTION_RULE` for the same turn). There is no path for a failure discovered here to change what was already spoken.
   - **Result discarded:** `Promise.all(...)` is fire-and-forget. `.catch()` only fires on a thrown exception — a 409 response resolves normally (`res.ok === false`, no throw), so `{success: false}` is silently dropped. Nothing downstream — not the next turn, not any correction mechanism — ever learns the write failed.
   - **Consequence:** because there is also no JS confirmation gate for this trigger type (established in the original Phase 1 revision, §2e), Claude re-emits the identical tool call on every subsequent "yes," each one racing the same background-fire/no-feedback path. The dedup index then correctly rejects the repeats, but since the rejection is invisible, Claude has no way to know the action never actually landed — it just keeps proposing it, and eventually says "Done" with no more basis for that claim than any of the "say yes to confirm" turns before it.

**Not yet proven — and this is why the wording above says "primary implementation defect," not "root cause" without qualification:** exactly what created the *first* conflicting row (turn 2's very first attempt, 23:17:40, already returned 409 — meaning something with the identical `(user_id, datetime)` key existed before this call's first insert). Two candidates, neither confirmed: an earlier test call today that happened to round "in 3 minutes" to the same target timestamp, or a genuinely unrelated legitimate alert at that same moment. **This open question does not change or weaken the defect proven above** — the silent-discard-after-TTS behavior is a real defect regardless of what triggered any specific 409, and fully explains the repeated confirmations and silent failure observed in the trace on its own. Closing this last question would need a direct `action_rules` query (Wael, via Supabase SQL editor) — not required to design the fix in Phase 2, but recorded here as still open rather than quietly folded into "proven."

**User-facing consequence, confirmed by direct observation:** the "Your Alerts" web page showed 0 active time alerts and no recent entry near this test's timestamp — consistent with the write never having succeeded, and consistent with the Rule 21 (No Silent Failures) / Rule 12 (post-action readback must reflect what actually happened) violation this defect represents. This is very likely the real mechanism behind Track B's original 1e symptom (the "never accepts yes" loop from Phase 1's first revision) — though that original reproduction's own raw logs no longer exist to confirm this retroactively; this is stated as a strong hypothesis, not a proven identity between the two.

**Correction to the third revision:** the confirm-gate implementation defect identified in §2g remains valid and the implemented fix remains correct. Only the explanation for why the write returned HTTP 409 is superseded by the direct database evidence documented below.

### 2h. NEW this revision — live-testing the shipped fix (`74a05d6`) confirms the confirm-gate works, and corrects §2g's citation of which constraint actually fires

**Reproduction (2026-07-16, ~00:11-00:12 EDT):** live call to production, same phrasing as before ("text me at [phone] in 3 minutes"), after the confirm-gate fix (`action_rule_confirm_gate.js` + the two `index.js` changes from Phase 2 §5a) was deployed.

**The fix worked as designed — direct log evidence, three turns:**

1. Turn 1 (STT-garbled by a barge-in, unrelated pre-existing issue — see below): a *different*, pre-existing mechanism (`B4y Phase 2` — the 2026-05-24 create-intent validator, `docs/CLAUDE.md`'s "Phase 1 enforcement" rule) dropped the tool call before it ever reached the new gate, because the garbled transcript didn't read as valid create-intent. Naavi asked for confirmation. **Not a failure of this fix — the gate never got a turn.**
2. Turn 2 (user's first "yes," in reply to turn 1's clarification request): the gate correctly found nothing pending, fell through to Claude, and Claude re-proposed the action with the corrected phone number. *This* proposal reached the gate: `[Process] SET_ACTION_RULE (time trigger) gated — awaiting yes/no confirmation` fires, confirmation speech is set, **nothing executes.**
3. Turn 3 (user's second "yes"): `[Process] Action rule confirm — executing SET_ACTION_RULE` fires **exactly once** — `[Action] Executing: SET_ACTION_RULE` → `status 409` → `[Process] SET_ACTION_RULE (post-confirm) failed` → Naavi speaks the truthful failure message (`action_rule_confirm_gate.js::failSpeechForAction`), not "Done."

**This directly satisfies acceptance criteria 3 and 4 from Phase 2 §5a**: no re-attempt after a completed confirm cycle, and a truthful failure message instead of a false "Done." The confirm-gate defect (§2g) is proven fixed by this trace.

**But the 409 itself needed root-causing, and §2g's citation was wrong.** Direct DB evidence, in order:

1. `SELECT ... FROM action_rules WHERE user_id = ... AND trigger_type = 'time' AND enabled = true` → **0 rows.** No currently-enabled time-trigger row exists for this user at all — ruling out a live collision with an *enabled* row.
2. Widening the query (dropping the `enabled = true` filter) → 9 rows, all `enabled = false`, most recent `created_at = 2026-07-15 14:51:54 UTC` — over 13 hours before this test's insert attempt (2026-07-16 ~04:11 UTC). **None of the 9 rows' `target_time` values are anywhere near this test's target** — ruling out §2g's original theory (a stale row from an earlier test sharing the same *datetime*).
3. **The actual Postgres error, read directly from Supabase's Postgres Logs** (`https://supabase.com/dashboard/project/hhgyppbxgmjrwdpdubcx/logs/postgres-logs`, 2026-07-16 00:11-00:12 EDT / 04:11-04:12 UTC):
   ```
   ERROR: duplicate key value violates unique constraint "action_rules_user_label_unique"
   Key (user_id, label)=(788fe85c-b6be-4506-87e8-a8736ec8e1d1, SMS to 343-333-...
   ```
   The conflicting row is `bcb5e02d-7bcc-44fe-a63e-819a625911ee` — one of the 9 rows from step 2, `created_at = 2026-07-15 05:36:43 UTC`, **`enabled = false`**, `label = "SMS to 343-333-2567 in 3 minutes"` — the *identical* label text this test's proposal generated.

**Root cause of the 409, now proven with the literal error message (not inferred from a migration file):** the constraint that fires is **`action_rules_user_label_unique` on `(user_id, label)`** — not `action_rules_unique_enabled_time` (the datetime-based partial index cited in §2g, which was a reasonable inference from the checked-in migration but was never actually the constraint hit in either reproduction). Because a **disabled** row (`bcb5e02d`, created the day before) still blocked this insert, `action_rules_user_label_unique` is **not scoped to `enabled = true`** — it appears to be an unconditional constraint across all rows regardless of enabled state (not yet confirmed by reading its actual `CREATE UNIQUE INDEX`/`ALTER TABLE ADD CONSTRAINT` statement, since that statement doesn't exist in any tracked migration — see next finding).

**Second finding, independent of the first:** `action_rules_user_label_unique` **does not exist in any file under `supabase/migrations/`** (confirmed by direct grep across the migrations folder — zero matches). The only trace of it anywhere in this repo is a passing mention in `docs/SESSION_HANDOFF_2026-06-14_V115_AAB_NEXT.md`, describing a `manage-rules` bug from over a month before this session where the same constraint fired for an unrelated reason (a missing `label` field defaulting to `'Action rule'`). **This constraint has been live in production since at least 2026-06-14, used by at least one Edge Function (`manage-rules`), with no corresponding migration file in git.** This is a concrete instance of the exact drift class `[[project_naavi_architecture_integrity_audit]]` (T1a) was scoped to catch — a real, currently-enforced schema object with no git-tracked origin.

**Why this matters beyond this test:** because Claude generates the same literal `label` string for the same phone number + relative-time phrasing ("SMS to 343-333-2567 in 3 minutes"), and the constraint appears to ignore `enabled` state, **any real user who says the same alert phrasing twice on different days would hit this same 409** — not just repeated test calls. The first time creates a row; the second time (even after the first has long since fired, delivered, and been disabled) permanently 409s, with no path for the user to ever recreate that literal wording again. This is a plausible, previously-undocumented user-facing bug, independent of Track B-1e's original scope.

**Not yet proven — flagged rather than assumed:**
- The exact `CREATE UNIQUE INDEX` / `ALTER TABLE` statement that defines `action_rules_user_label_unique` — need to read it directly (e.g., via `\d action_rules` or `pg_indexes` in the Supabase SQL editor) to confirm it truly has no `WHERE enabled = true` clause, rather than inferring that from one observed collision against a disabled row.
- Whether this constraint is intentional design (a lighter-weight alternative to the per-trigger-type partial indexes in `20260525000000_compliance_fixes.sql`) or an artifact of an earlier, since-superseded dedup approach that should have been dropped when the per-trigger-type indexes were added.
- Whether other Edge Functions besides `manage-rules` (e.g., `naavi-voice-server`'s direct `POST /rest/v1/action_rules` calls, used by this very code path) are also subject to it, or whether it's somehow scoped narrower than table-wide.

---

## 3. Root cause statement

| Sub-problem | Root cause | Confidence |
|---|---|---|
| 1c | `naavi-voice-server/src/anthropic_tools.js`'s location tool descriptions (`set_location_rule_address`, `set_location_rule_chain`) never instruct Claude to capture a named recipient into `action_config.to`, unlike mobile's now-corrected prompt. Resolution code downstream is correct and unreachable only because the field is never populated. | **Proven** — direct file:line citation, cross-checked against mobile's corrected equivalent |
| 1d | Real code-level flaw exists (`noRecipient` conflates two distinct cases) but **has no proven independent reproduction on the current codebase** — every traced path to the bug's stated symptom passes through either 1c or pre-F12 code. Residual risk is narrower: no fire-time re-resolution safety net in `report-location-event` for destinations that *were* resolved at creation but go stale before firing. | **Revised this session** — verification Phase 1 (original) explicitly flagged as open is now closed with direct evidence |
| 1e | **Primary implementation defect proven, third revision (§2g); fix verified live, fourth revision (§2h).** `naavi-voice-server/src/index.js:12194-12199` (pre-fix) executed `SET_ACTION_RULE` for time/self-override triggers as a fire-and-forget background action *after* TTS was already sent, discarding the result. Fixed by `action_rule_confirm_gate.js` (commit `74a05d6`) — confirmed live, exactly one execution attempt, truthful spoken result on both success and failure paths. STT/barge-in truncation (§2f) is confirmed as a separate, real, co-occurring issue, not this mechanism. | **Defect and fix both proven** — file:line citations, two separate live production traces (pre-fix and post-fix), direct observation. |
| **409 origin (was flagged open in §2g, now corrected in §2h)** | **§2g's citation was wrong.** The constraint that fires is `action_rules_user_label_unique` on `(user_id, label)` — not `action_rules_unique_enabled_time` (the datetime-based index, which was a reasonable inference from the checked-in migration but never the actual constraint hit in either reproduction). Confirmed against a **disabled** row, meaning the constraint likely has no `enabled = true` scoping — unconfirmed pending reading its actual definition. **Second finding: this constraint has no corresponding file anywhere in `supabase/migrations/`** — it is live in production, used by `manage-rules` since at least 2026-06-14, with no git-tracked origin. A concrete instance of the drift class `[[project_naavi_architecture_integrity_audit]]` (T1a) was scoped to catch. | **Proven this revision** — literal Postgres error message (not inferred), direct grep confirming absence from migrations. **Not yet proven:** the constraint's exact definition (partial vs. unconditional), whether it's intentional or a superseded leftover, and its blast radius across other write paths. |

---

## 4. What alternatives were considered

- **"Maybe 1e uses the same `pendingLocation`/`AFFIRMATIVE_RE` machinery and I just haven't found the right call site."** Ruled out by direct grep across the whole file for any pending-confirm marker outside the location flow — none exist. The time-trigger self-override path has no code-level confirm gate at all.
- **"Maybe 1d is still a live, independently-reproducible bug on the current codebase."** Not ruled out with total certainty (a reproduction attempt on current code, post-1c-fix, would be the definitive test) — but every trace of the two existing reproductions in Phase 1 leads back to either pre-F12 code or 1c itself, not to a fresh failure of the resolve-recipient pipeline described in §2d's table.
- **"Maybe voice's tool schema does have recipient-capture guidance somewhere else (a different prompt section) that I missed."** Checked the full `set_location_rule_address`/`set_location_rule_chain` descriptions and the shared `ACTION_CONFIG` block — no such guidance found anywhere in `anthropic_tools.js`. Voice has no `get-naavi-prompt`-equivalent shared prompt file of its own for tool descriptions (per the architecture doc, voice's tool-use schema lives entirely in `naavi-voice-server/src/anthropic_tools.js`, separate from mobile's).

---

## 5. Scope boundary

This covers 1c/1d/1e only. Does not re-open 1a/1g (Track A, closed) or 1f (Track C, not started). Does not include a fix design for any of the three — that is Phase 2's job, and per governance no code is written here.

---

## 6. Next step

Phase 2 — Change Planning, per governance. Given the revised evidence, and per Wael's Phase 1 review (2026-07-15) softening the 1d conclusion to match exactly what's proven — not more:
- **1c** — real implementation defect, proven. Phase 2 can write a full implementation plan: add recipient-capture instruction + examples to voice's two location tool descriptions, mirroring mobile's corrected prompt.
- **1d** — **no independent implementation is currently justified.** The evidence supports: no independent reproduction exists on the current codebase; every traced reproduction passes through either 1c or pre-F12 code; the residual risk (no fire-time re-resolution safety net in `report-location-event`) is real but much smaller than originally scoped. It does **not** yet prove that fixing 1c eliminates every meaningful manifestation of 1d. Phase 2 should therefore treat 1d as an **explicit decision point, not a fix, and not a closure**: after 1c is implemented and verified, explicitly reassess whether any residual 1d behavior remains before deciding whether a separate code change is warranted.
- **1e — primary implementation defect proven (§2g), full implementation plan now justified.** The investigation Phase 2 originally scoped (widened logging, run live) is complete and produced a "Neither confirmed" verdict on the two original hypotheses, then a precisely-located third mechanism — proven for the defect itself; the specific origin of the first 409 remains open but doesn't change that finding (see §2g's closing note). Phase 2 should now write an implementation plan: the minimal fix is to stop treating time/self-override `SET_ACTION_RULE` as a pure fire-and-forget background action — either (a) await `executeAction()`'s result before finalizing what gets spoken (moves the write before TTS, adds latency but makes success/failure truthful), or (b) keep it backgrounded but check the resolved result and, on failure, follow up with a correction (a second short message/notification) rather than staying silent. Also must address the repeated-tool-call symptom itself — e.g., a lightweight JS gate for this trigger type mirroring `pendingLocation`'s pattern, so Claude doesn't re-fire the identical action on every "yes." Phase 2 should evaluate both options against latency/UX tradeoffs before choosing.
- **The barge-in/STT truncation bug itself (`project_naavi_deepgram_first_word_truncation`)** — not part of Track B's original scope, but surfaced material enough by this revision to flag explicitly: it is foundational (can silently corrupt any spoken instruction, not just this feature), has been reproducible and documented since 2026-04-19 with four candidate fixes never implemented, and this session's reproduction shows it can be more severe (multi-word loss, not just one word) than originally recorded. Recommend treating a fix for this as at least equal priority to 1e, and investigating them together rather than sequentially, since they may share one root cause and one fix.
- **The location-tool self-override guidance gap** (§2f) — real, low-urgency, defense-in-depth only. Not elevated to Track B scope. Can be fixed opportunistically alongside future 1c-adjacent work; not a priority on its own.
- **NEW this revision — `action_rules_user_label_unique` (§2h).** Two separate follow-ups, not yet reviewed: (1) read the constraint's actual definition (`\d action_rules` or `pg_indexes` via Supabase SQL editor) to confirm scope (partial vs. unconditional) before proposing any fix — no fix should be designed on the "likely unconditional" inference alone. (2) Regardless of (1)'s answer, the constraint's absence from `supabase/migrations/` is itself an item for `[[project_naavi_architecture_integrity_audit]]` (T1a) — recommend flagging it there directly rather than duplicating T1a's scope inside Track B. Whether the label-based dedup key itself needs redesigning (freeform generated text is a fragile logical key — two unrelated alerts could collide, or the same alert reworded could bypass dedup entirely) is a real open design question, not yet scoped as a fix.

These are different work types, not equal-weight fixes — Phase 2 should decompose them accordingly rather than plan them as a single undifferentiated Track B change.

---

## 7. Phase 1 review record

**Note on scope (added with the fourth revision):** the review round below covers the **third revision only** (§2g, the confirm-gate defect) — it predates and does not cover §2h (the fourth revision's correction of the 409's actual cause, and the untracked-constraint finding). §2h is **not yet reviewed.** The confirm-gate fix itself remains approved and shipped, unaffected by this correction — only the "why did it 409" explanation changes.

### Review of the third revision (2026-07-15)

Reviewer: ChatGPT (External Technical Reviewer), via Wael.

**Governance assessment:**

| Area | Assessment |
|---|---|
| Investigation quality | ✅ Excellent |
| Evidence chain | ✅ Excellent |
| Technical reasoning | ✅ Strong |
| Separation of independent defects | ✅ Excellent |
| Governance compliance | ✅ Excellent |
| Hidden assumptions | One minor wording issue (below) |

**Recommendation:** narrow "Root cause now proven" to distinguish the fully-proven implementation defect (background execution silently discarding failures) from the still-open question (the specific origin of the first 409 response). Proposed replacement wording: *"Primary implementation defect proven. The investigation conclusively identified a defect in how failed background SET_ACTION_RULE operations are handled after TTS dispatch. This defect fully explains the repeated confirmations and silent failure observed in the reproduced trace. The specific origin of the initial 409 response remains under investigation but does not change the existence of the identified defect."*

**Response — adopted directly.** §2g, §3's root-cause table, and §6 all revised to use "primary implementation defect proven" in place of unqualified "root cause proven," with the open 409-origin question stated explicitly alongside rather than folded into the proven claim.

**Phase 2 guidance (adopted into Phase 2 §5a's framing):** this has crossed the threshold where a real implementation plan is justified — Phase 2 no longer needs to investigate whether a bug exists, it needs to decide how to fix the identified behavior. The implementation alternatives are design options for Phase 2 to evaluate, not implementation commitments.

**Verdict: Conditionally Approved**, condition (the wording softening) applied above.

**Follow-up review, same day:** reviewer confirmed the applied wording — governance assessment all ✅ (evidence discipline, technical reasoning, separation of proven vs. open issues, internal consistency, governance compliance; no hidden assumptions) — with one forward-looking observation for whichever session writes Phase 2, not a Phase 1 deficiency: **Phase 2 should evaluate this as two distinct design questions, not one undifferentiated fix** — (1) *truthfulness of user feedback* (don't say "Done" before the system knows the write succeeded) and (2) *conversation control* (prevent repeated identical tool invocations after confirmation). Related, but may have different implementation strategies; keeping them distinct should make Phase 2's trade-off analysis clearer. Noted here for whenever Phase 2 work resumes — not acted on in this document.

**Final verdict: Approved.** This revision (§2g, §3, §6, and this §7) is closed.

### Review of the fourth revision (2026-07-16)

Reviewer: ChatGPT (External Technical Reviewer), via Wael. Subject: §2h — the corrected 409 root cause and the untracked-constraint finding.

**Governance assessment:**

| Area | Assessment |
|---|---|
| Evidence discipline | ✅ Excellent |
| Self-correction | ✅ Excellent |
| Historical integrity | ✅ Excellent |
| Scope control | ✅ Excellent |
| Separation of findings | ✅ Excellent |
| Governance compliance | ✅ Excellent |
| Hidden assumptions | None identified |

**Governance observation (praised, not a correction):** this revision demonstrates the value of separating Phase 1 from Phase 2/3/4 — the process caught an implementation defect, fixed it, then discovered the original root-cause *explanation* for the failure it fixed was incomplete. Because the investigation is documented separately from the implementation, correcting the explanation did not require undoing the fix. "That is exactly why separating Phase 1, Phase 2, Phase 3, Phase 4 has value."

**One recommendation (editorial, non-blocking):** add an orienting sentence immediately before §2h, stating plainly that the §2g defect and fix remain valid and only the 409 explanation is superseded — so a future reader doesn't have to infer that from comparing the two sections.

**Response — adopted directly.** Added as the line immediately preceding §2h's heading: *"Correction to the third revision: the confirm-gate implementation defect identified in §2g remains valid and the implemented fix remains correct. Only the explanation for why the write returned HTTP 409 is superseded by the direct database evidence documented below."*

**Verdict: Approved.** "This is the strongest Phase 1 revision in the Track B series. Rather than weakening the investigation, the correction strengthens it by replacing an inferred explanation with direct production evidence while preserving the validity of the already-deployed confirm-gate fix. The newly identified `action_rules_user_label_unique` constraint and the apparent schema drift are appropriately treated as separate architectural concerns rather than being folded into Track B."

**Final verdict: Approved.** §2h, and this revision as a whole, are closed. The two follow-ups named in §6 (reading the constraint's actual definition; flagging its untracked status to T1a) remain open items, not yet scoped as their own Phase 1 — per this review, that's correctly deferred rather than folded into Track B's own scope.
