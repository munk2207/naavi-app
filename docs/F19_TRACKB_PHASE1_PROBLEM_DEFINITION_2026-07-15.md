# F19 Track B — Phase 1: Problem Definition

**Second revision (this revision), added after 1c shipped and was verified live.** During Phase 5 verification of 1c's fix (`docs/F19_TRACKB_PHASE2_CHANGE_PLAN_2026-07-15.md`), a live test of a *different* acceptance criterion (self-override + location, criterion 3) surfaced what first looked like a new, fourth defect. Direct investigation (§2f below) traced it instead to an **already-documented, unfixed bug from 2026-04-19** (`project_naavi_deepgram_first_word_truncation` memory) — Deepgram dropping words from the start of an utterance during barge-in — not a new tool-schema gap. This is folded into this document rather than kept as a separate file, because it materially changes 1e's evidence picture (§2e is updated below) rather than standing alone. No prior section's proven findings are retracted; §2e and §6 are revised, everything else is unchanged from the original revision.

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

## 3. Root cause statement

| Sub-problem | Root cause | Confidence |
|---|---|---|
| 1c | `naavi-voice-server/src/anthropic_tools.js`'s location tool descriptions (`set_location_rule_address`, `set_location_rule_chain`) never instruct Claude to capture a named recipient into `action_config.to`, unlike mobile's now-corrected prompt. Resolution code downstream is correct and unreachable only because the field is never populated. | **Proven** — direct file:line citation, cross-checked against mobile's corrected equivalent |
| 1d | Real code-level flaw exists (`noRecipient` conflates two distinct cases) but **has no proven independent reproduction on the current codebase** — every traced path to the bug's stated symptom passes through either 1c or pre-F12 code. Residual risk is narrower: no fire-time re-resolution safety net in `report-location-event` for destinations that *were* resolved at creation but go stale before firing. | **Revised this session** — verification Phase 1 (original) explicitly flagged as open is now closed with direct evidence |
| 1e | Not proven as this bug's mechanism. What is proven: STT truncation during barge-in definitely occurs in this system (§2f, direct log evidence, unrelated scenario), and that failure class is compatible with the observed confirmation-loop symptom. Promoted to the first hypothesis the planned live-trace investigation should test — not a conclusion. | **Revised this revision** — from an unsupported guess to an evidence-backed first-thing-to-test; still not confirmed for 1e specifically |

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
- **1e** — investigation plan, not an implementation plan. Per §2f, this revision's evidence should **widen what the investigation captures, not preselect its conclusion**: Phase 2's logging plan should record, per turn, the raw STT transcript, whether `[Barge-in]` fired, Claude's response, and whether a tool call was issued — so the live-traced reproduction can test the STT hypothesis first while still being able to show it's wrong, rather than treating it as confirmed in advance.
- **The barge-in/STT truncation bug itself (`project_naavi_deepgram_first_word_truncation`)** — not part of Track B's original scope, but surfaced material enough by this revision to flag explicitly: it is foundational (can silently corrupt any spoken instruction, not just this feature), has been reproducible and documented since 2026-04-19 with four candidate fixes never implemented, and this session's reproduction shows it can be more severe (multi-word loss, not just one word) than originally recorded. Recommend treating a fix for this as at least equal priority to 1e, and investigating them together rather than sequentially, since they may share one root cause and one fix.
- **The location-tool self-override guidance gap** (§2f) — real, low-urgency, defense-in-depth only. Not elevated to Track B scope. Can be fixed opportunistically alongside future 1c-adjacent work; not a priority on its own.

These are different work types, not equal-weight fixes — Phase 2 should decompose them accordingly rather than plan them as a single undifferentiated Track B change.
