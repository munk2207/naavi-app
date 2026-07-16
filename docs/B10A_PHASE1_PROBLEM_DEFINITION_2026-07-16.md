# B10a — Phase 1: Problem Definition

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No code is written in this document. Touches Protected Core (Voice orchestration, Action Rules).

**Origin:** found live, while running F19 Track B-1d's live-test procedure (`docs/F19_TRACKB_PHASE2_CHANGE_PLAN_2026-07-15.md` §4) — a real voice call, real named contact, real production. This is a distinct, independent defect from 1d's original framing, found via 1d's own test method — not the same bug, a sharper one.

---

## 1. What exactly is broken

Voice, for **time-triggered SMS/WhatsApp alerts naming a real third-party contact** ("text Bob... in 3 minutes"), never resolves the named contact to a phone number — the alert silently redirects the recipient to the registered user's own phone number instead, with no indication to the user that the recipient was dropped. This is the general (non-location) `SET_ACTION_RULE` handler only — the location-trigger handler is confirmed unaffected (different code, checked directly, §4).

---

## 2. Evidence

**Live reproduction (2026-07-16, ~08:32-08:33 EDT), full turn-by-turn trace from Railway logs:**

1. **Pre-context lookup, correct:** before Claude even responds, `naavi-voice-server` runs a context-enrichment contact lookup. Result (08:32:27): `{"contact":{"name":"Bob","email":"aggan2207@gmail.com","phone":"+13433332567",...}}` — the *correct* Bob, correct number, found cleanly.
2. **Claude's tool call, correct:** `[Claude DIAG] tool_use name=set_action_rule jsonStr: {"trigger_type":"time","trigger_config":{"datetime":"2026-07-16T08:35:00-04:00"},"action_type":"sms","action_config":{"to":"Bob","body":"Good morning"},"label":"Text Bob Good morning in 3 minutes"}` — Claude correctly emitted `to:"Bob"` as a name, no `to_phone`, exactly as designed (mirrors 1c's now-fixed pattern).
3. **Confirm-gate, correct:** `[Process] SET_ACTION_RULE (time trigger) gated — awaiting yes/no confirmation` — B9z/Track B-1e's confirm-gate held the action pending, unexecuted, exactly as designed.
4. **Execution, wrong:** on the user's "Yes," `[Action] Executing: SET_ACTION_RULE` fires, immediately followed by **`[Action] B4y: defaulted SET_ACTION_RULE to_phone from user_settings: +16137697957`** — the user's own registered phone. Then `[Action] SET_ACTION_RULE "Text Bob Good morning in 3 minutes" — status 201`.
5. **Stored row — observed facts:**
   ```
   to_name: "Bob"
   to_phone: "+16137697957"   -- the user's own registered number, not Bob's
   to_name_resolved: NULL
   contact_id: NULL
   body: "Good morning"
   ```
   **Interpretation:** `contact_id` and `to_name_resolved` both `NULL` means Bob was never actually matched against a real contact record — recipient resolution did not complete for this row.
6. **Delivery — observed fact:** the SMS was received on the user's own phone, not Bob's. **Interpretation:** confirms the stored `to_phone` value is what the system actually acted on, not a display-only artifact — this is a real-world misdelivery, not a cosmetic bug.

**Root cause, located precisely — two blocks of code in the wrong order.** `naavi-voice-server/src/index.js`, the general (non-location) `SET_ACTION_RULE` handler:

- **Line 4725-4739 ("B4y," added 2026-05-24):**
  ```js
  if (!hasSelfOverride && (actType === 'sms' || actType === 'whatsapp') && !actionConfigNorm.to_phone) {
    // ...fetch user_settings.phone...
    actionConfigNorm.to_phone = userPhone;
    console.log('[Action] B4y: defaulted SET_ACTION_RULE to_phone from user_settings:', userPhone);
  }
  ```
  Its own comment states the intent: *"Without this, rules land with no destination phone and silently fail at evaluate-rules fire time"* — written for the case where **no recipient was named at all** (a genuine self-alert, e.g. "text me... in 3 minutes"). Its condition only checks whether `to_phone` is empty — it never checks whether `to` (a name still awaiting resolution) is present.

- **Line 4755-4787 (F12 recipient resolution, added 2026-07-06 — six weeks later):**
  ```js
  const toNameVoice = String(actionConfigNorm.to ?? '');
  if (!hasSelfOverride && toNameVoice && !actionConfigNorm.to_phone && !actionConfigNorm.to_email) {
    // ...call resolve-recipient...
  }
  ```
  This is the code that should resolve `to:"Bob"` into a real phone number via `resolve-recipient`/`lookup-contact`. Its own guard condition includes `!actionConfigNorm.to_phone`.

**The defect:** B4y's block runs first and unconditionally sets `to_phone` whenever it's empty — regardless of whether a name is waiting to be resolved. This is deterministic, not timing-dependent: by the time execution reaches F12's resolution block a few lines later, `to_phone` is no longer empty (B4y already filled it with the user's own number), so F12's guard condition evaluates false and the resolution attempt is skipped, every time, for every request shaped this way. Bob's name is never looked up. `contact_id` is never set. The row is created with the user's own number under a label that still says "Text Bob."

**Confirmed unaffected — location-trigger handler.** Same file, lines 11375-11414 — resolves the named recipient immediately (no B4y-style pre-default in front of it). Directly read, not inferred. This is exactly why "Text Bob when I arrive at Costco" (tested earlier this session) worked correctly and "Text Bob... in 3 minutes" did not — genuinely different code paths, only one has this defect.

---

## 3. Root cause statement

| Finding | Root cause | Confidence |
|---|---|---|
| Time-triggered SMS/WhatsApp alerts naming a real contact silently redirect to the user's own number instead | `naavi-voice-server/src/index.js:4725-4739` (B4y's default-to-self, designed for the no-recipient case) runs *before* `:4755-4787` (F12's named-recipient resolution). This is deterministic sequential execution, not a race: B4y's assignment satisfies F12's guard condition (`!actionConfigNorm.to_phone`) before the F12 block ever executes, so F12's resolution code is skipped every time a name is present, regardless of timing. | **Proven** — direct file:line citation, live production trace (transcript → tool call → confirm-gate → execution → stored row → actual SMS delivery), all independently confirmed at each step |
| Location-trigger handler | Not affected — confirmed by direct code read, no equivalent pre-default exists in that handler | **Proven** — direct file:line citation |

---

## 4. What alternatives were considered

- **"Maybe this is the same thing 1c already covers."** Ruled out — 1c only touched the location tools' *schema* (`anthropic_tools.js`), telling Claude to populate `to`. This bug is in a completely different file section (the general handler's *execution* logic, not schema), and Claude already correctly populates `to` here — the defect is entirely downstream of Claude's output.
- **"Maybe this is 1d exactly as originally scoped."** Related, but not identical. 1d's Phase 1 (`docs/F19_TRACKB_PHASE1_PROBLEM_DEFINITION_2026-07-15.md` §2d) concluded no independent reproduction existed on post-F12 code, and every traced case passed through 1c or pre-F12 code. This reproduction is 100% post-F12 code, independent of 1c, and traces to a specific ordering bug between two named commits (B4y, F12) — sharper and more specific than 1d's original framing. Recommend closing 1d as superseded by this finding, not running 1d's original procedure further.
- **"Maybe mobile has the same bug."** Not checked — mobile's `useOrchestrator.ts` has entirely separate `SET_ACTION_RULE` code (already flagged as unverified in the parity audit, 2026-07-16). Not assumed broken, not assumed safe — genuinely unchecked, out of scope for this document.

---

## 5. Scope boundary

Covers only the general (non-location) `SET_ACTION_RULE` handler's B4y/F12 ordering defect. Does not cover: location alerts (confirmed unaffected), mobile's equivalent code (unchecked), or the confirm-gate itself (working correctly, confirmed in this same trace).

---

## 6. Next step

Phase 2 — Change Planning, per governance. **This document identifies the ordering defect only — it does not recommend a resolution behavior.** Whether an unresolved named recipient should fail the alert entirely (fail-closed, matching F12's existing design for ambiguous/not_found) or fall back to the user (fail-open to self, matching B4y's original intent for the genuine no-recipient case) is an architectural policy decision belonging to Phase 2, not implied or pre-selected here. Candidate approaches, not yet designed or chosen:
1. **Move B4y's block to run *after* F12's resolution attempt**, only defaulting to self if resolution was never attempted (no `to` at all). Requires Phase 2 to explicitly decide the fail-open-vs-fail-closed question above for the case where a name *was* present but resolution failed (ambiguous/not_found) — F12's own resolution is fail-closed by design, which would need to be deliberately reconciled with, not silently overridden by, B4y's fail-open intent.
2. **Add a guard to B4y's condition** — skip the default entirely when `actionConfigNorm.to` is present (a name is waiting), regardless of order. Simpler, smaller diff, but leaves the two blocks in their current order (more fragile long-term if a third block is added later).

Phase 2 should also confirm whether this same defect pattern exists anywhere else `to_phone` gets defaulted ahead of resolution — this was found by accident in one call site; a full grep for "B4y" and similar default patterns is warranted before considering the fix complete.

---

## 7. Phase 1 review record (2026-07-16)

Reviewer: ChatGPT (External Technical Reviewer), via Wael. Confidence: Very High (9.8/10).

**What the reviewer praised:**
- **Evidence chain** — every stage independently verified (lookup → tool call → confirm-gate → execution → stored row → real SMS), not asserted from the symptom alone.
- **Root cause supported, not guessed** — a genuine causal chain (state → B4y executes → state changes → F12 condition becomes false → resolution skipped → wrong destination), not a plausibility argument.
- **Scope control** — explicitly stating the location handler is unaffected, rather than over-generalizing to "recipient resolution is broken" everywhere.
- **Alternatives considered** — explicitly ruling out 1c, original 1d framing, and mobile parity as the same issue, closing off reopening already-answered questions.
- Specifically flagged: *"Claude already correctly emitted `to:"Bob"` as designed"* — narrows responsibility correctly, doesn't blame Claude/orchestration/database before the evidence points there.

**Four editorial recommendations, all adopted:**
1. **Separate observed fact from interpretation** — §2 item 5/6 rewritten: the raw stored values and the real-world SMS delivery are now stated as observations, with a separate "Interpretation:" line drawing the conclusion, rather than blending the two.
2. **Remove "race" language** — this is deterministic sequential execution, not concurrency. §2 and §3 reworded to state plainly that B4y's assignment satisfies F12's guard condition before F12 runs, every time, not "wins" anything.
3. **Make the fail-open/fail-closed question an explicit Phase 2 architectural decision, not implied by Phase 1** — §6 rewritten with an explicit statement that this document identifies the ordering defect only and does not recommend a resolution behavior.
4. **Terminology** — "silently becomes a self-alert" replaced with "silently redirects the recipient to the registered user phone" throughout (§1, root cause table) — the latter is what's actually observable; "self-alert" implies a designed state that this isn't.

**Governance checklist (all ✅):** single defect, no implementation, evidence-based, root cause identified, alternatives documented, scope bounded, ready for Phase 2.

**Risk assessment:** User impact High, Architecture risk Medium, Regression risk Medium, Root-cause confidence Very High, Scope confidence High. *"The bug is serious because it silently delivers a message to the wrong recipient rather than failing visibly, but the defect itself appears localized to one execution path."*

**Verdict: Approved.** "This is a mature Phase 1 document. It demonstrates disciplined debugging by following the execution path from user action through lookup, orchestration, execution, persistence, and real-world outcome before identifying the defect. It also maintains a clear separation between problem definition and solution design."
