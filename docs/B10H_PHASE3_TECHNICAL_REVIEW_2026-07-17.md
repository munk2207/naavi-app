# B10h — Phase 3: Technical Review (Before Coding)

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3. Subject: `docs/B10H_PHASE2_CHANGE_PLAN_2026-07-17.md`, reviewed and **Approved conditioned on two items**. This document resolves both conditions with direct evidence, then formalizes Implementation Boundaries and Deferred Architectural Decisions.

Required because the plan touches Protected Core (Action Rules, Notification routing, Geofencing) and is classified High Risk.

---

## 1. Condition 1 resolved — shared validator: not needed, and here's the evidence why

Phase 2 posed the question without deciding it: should the "has validated content" check be one shared helper, or duplicated in `report-location-event` and `evaluate-rules`?

**Investigated directly rather than assumed:** `_shared/alert_body.ts`'s `buildAlertBody` (lines 121-162) is **already** the single authoritative source both functions call. Its return value — empty string when there's no content, a real string otherwise — is already the one true "has content" signal. Phase 2's own Layer 4 sketch (§2(b)/(c) of the Phase 2 doc) already calls this shared function directly and checks its result; it does not hand-roll a second, independent content check.

**What would a new `_shared/outbound_validation.ts` actually add?** Only a one-line wrapper around `!(await buildAlertBody(...))` — renaming an existing, already-shared boolean check. Per `CLAUDE.md`'s AI Coding Discipline (Rule 19: *"new abstractions must justify their existence... if the justification is 'cleaner code' without a concrete problem it solves, the abstraction is not justified"*), this doesn't clear that bar. **Decision: no new shared module. `buildAlertBody` is the single authoritative source for semantic-content determination at fire time; both Layer 4 call sites consume it identically, satisfying the review's underlying principle without adding a wrapper that duplicates nothing but a variable name.** (Worded deliberately this way, per review feedback: Layer 2/3 still performs its own creation-time validation using the subset of information available before persistence — §3 below explains precisely why that subset is correct for that moment — while Layer 4 relies on `buildAlertBody`'s complete fire-time view. The two layers check different things at different times; only Layer 4's check is "authoritative" in the sense of complete.)

**What is genuinely per-caller, and correctly so:** *what happens* when content is missing — which sends get skipped from `report-location-event`'s or `evaluate-rules`'s own fan-out array — is inherently specific to each function's own send-construction logic (a real difference in shape, not an accident of duplication). Unifying that would mean merging the two functions' entire fan-out logic, which Phase 1 §7 and Phase 2 §5 both already held is premature, broader-blast-radius work, not this fix's job.

---

## 2. Condition 2 resolved — conversational state, mechanism named and evidenced

Phase 2 required confirming or designing how *"What should I tell Bob?"* resumes the existing alert instead of restarting it.

**Investigated directly:** `hooks/useOrchestrator.ts` already has exactly this shape of mechanism, proven working, for a structurally identical problem — the address-confirmation flow. `pendingLocationRef` (declared line 612, checked at the very top of `send()`, line 1271: *"Skips the Claude round-trip entirely"*) stores the original `action` object across a turn boundary, with staleness handling (5-minute expiry, line 1285) and escape-pattern handling (a fresh command or unrelated question drops the pending state instead of hijacking it, line 1286-1290) already built and battle-tested.

**Decision, corrected during Phase 4 implementation (2026-07-17, Wael's explicit call — recorded here rather than left undocumented):** true mid-flow resume (storing the full parsed `action` and replaying address resolution) was found, while implementing, to require either extracting ~400 lines of address-resolution logic (possessive-contact lookup, `resolve-place`, the memory-hit vs. confirm-flow branch) into a new callable function, or duplicating it — the exact "two independently-maintained copies" failure mode this project has already paid for three times (F5c, B10d, B10g). Phase 3's original sketch below is retained struck through for the record; the implemented mechanism is a **retry through Claude**, not a Claude-skipping resume:

~~Add a new ref, `pendingContentClarificationRef`, modeled directly on `pendingLocationRef`'s proven shape~~

```ts
const pendingContentClarificationRef = useRef<{
  originalAction: any;   // the full action Claude emitted, blocked at the Layer 2/3 guard
  createdAt: number;
} | null>(null);
```

~~Set when Layer 2/3 blocks... Checked at the top of `send()`... Skips the Claude round-trip entirely...~~

**As actually implemented:** `pendingContentClarificationRef` stores only the minimum needed to reconstruct a complete sentence — `toName` and `placeName` (the raw strings, not resolved state) — not the full parsed `action`. When the user answers the clarification question, the handler builds a corrected natural-language message (e.g. *"Text Bob saying Goodnight when I arrive at Home"*) and re-enters the **normal** Claude round-trip with it (via the existing `sendRef.current` re-invocation pattern already used elsewhere in this file for compound-question auto-advance), rather than skipping Claude and resuming mid-flow. This reuses 100% of the already-working address-resolution and insert logic — including both insert paths found while designing Phase 2 — with zero new duplication, at the cost of one extra Claude round-trip per clarification. Acceptance criterion 7 (§ below) is satisfied the same way regardless of mechanism: the recipient and place are never re-asked, because the corrected message already contains them.

### Acceptance criterion, added per this resolution (Phase 5 must verify)

7. After Naavi asks *"What should I tell Bob?"* and the user replies with only the message (e.g. *"Goodnight"*), the alert saves with the original recipient and location intact, with no re-prompt for either — confirmed by checking the saved row's `trigger_config.place_name`/`action_config.to_name` match what was said in the *first* message, not asked again in the second. **Extended per review feedback to be end-to-end, not persistence-only:** Phase 5 shall also verify that the *delivered* outbound SMS — not just the saved database row — exactly matches the clarification response the user supplied, and does not contain synthesized fallback content ("You've arrived at...") anywhere in it. The customer experiences the SMS, not the database row; this criterion is not satisfied by a correct `action_rules` row alone.

---

## 3. `buildAlertBody`'s field-completeness — proven with the fourth source found, and why it doesn't require changing Layer 2/3

Phase 2 §4 required Phase 3 to prove one of two statements. Direct read of `_shared/alert_body.ts` (lines 24-28, `ActionConfig` interface, and lines 121-162, `buildAlertBody`'s body) plus a repo-wide check for how each field gets populated:

**There is a fourth input, and it changes the picture — but only for Layer 4, not Layer 2/3.** `buildAlertBody` reads four things, not three:
1. `actionConfig.body` (line 128)
2. `actionConfig.tasks` (line 129)
3. `actionConfig.list_name` (line 130, triggers a live `manage-list` lookup)
4. **`list_connections` for the rule, via the optional `ruleId` parameter** (lines 150-159, `fetchConnectedListForRule`) — a **separate DB relationship**, not a field on `action_config` at all, established via the standalone `manage-list-connections` Edge Function (confirmed live and in active use: `lib/list_connections.ts`, called from `hooks/useOrchestrator.ts:2819`, and from the web/mobile Lists management screens per `CLAUDE.md`'s "Mobile = conversation, Web = management" split).

**Why Layer 2/3's 3-field check is still correct, not incomplete:** `list_connections` is keyed by `ruleId` — the row does not and cannot exist before the `action_rules` insert happens, because there is no id to attach it to yet. Layer 2/3 runs *before* insert. It is therefore structurally impossible for source #4 to hold content at the moment Layer 2/3 checks — the 3-field check is complete for that specific point in time, not an oversight.

**Why Layer 4 is already correct, by construction, not by luck:** Phase 2 §2(b)/(c) already specified calling `buildAlertBody(config, ..., rule.id)` directly and checking *its return value* for emptiness — not a hand-rolled re-check of `body`/`tasks`/`list_name`. Since `buildAlertBody` already incorporates source #4 internally, Layer 4 as designed in Phase 2 already accounts for a list attached to the alert *after* creation, with no change needed to the code sketched in Phase 2. This is worth stating explicitly rather than leaving implicit, since it's the reason Phase 2's design survives this finding unchanged.

**Conclusion, precisely: `buildAlertBody` has four semantic inputs, not three. Layer 2/3's write-time check correctly covers the three that can exist pre-insert. Layer 4's fire-time check, exactly as Phase 2 specified it, already correctly covers all four.** No design change required in either layer — this section exists to make the proof explicit, per Phase 2's requirement, not to revise the plan.

---

## 4. Fan-out structure confirmed (Phase 2's item (a))

`report-location-event/index.ts`'s `fireLocationAction` builds an array of send promises (`sends: Promise<{channel, ok}>[]`, confirmed by direct read of the function) gated by channel-specific conditions (`isSelfAlert`, `toPhone`, `toEmail`, per-channel `alert_channels_enabled` checks). Adding a `hasThirdPartyRecipient && !realBody` guard around the third-party-specific push calls (the ones using `toPhone`/`toEmail`, not the self-alert channel calls using the user's own registered contact info) cleanly excludes only the third-party sends, confirmed structurally separable from the self-alert sends in the existing code — Phase 2's principle holds without requiring a restructure of the array itself. `evaluate-rules/index.ts`'s `fireAction` follows the equivalent structure for its own third-party sends.

---

## 5. Implementation Boundaries Confirmed

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3's Implementation Boundaries requirement:

- **Authorized files, exactly:**
  - `hooks/useOrchestrator.ts` — the Layer 2/3 guard (Phase 2 §2(a)) at the top of the `if (triggerType === 'location')` block, **plus** the new `pendingContentClarificationRef` mechanism (§2 above) and its check at the top of `send()`, mirroring `pendingLocationRef`'s existing pattern exactly (staleness/escape handling reused, not reinvented).
  - `supabase/functions/report-location-event/index.ts` — the Layer 4 guard inside `fireLocationAction` (Phase 2 §2(b)), calling `buildAlertBody` and gating third-party sends on its result, per §4 above.
  - `supabase/functions/evaluate-rules/index.ts` — the symmetric Layer 4 guard inside `fireAction` (Phase 2 §2(c)).
- **No additional files are approved.** Not `_shared/alert_body.ts` itself (no change needed — its existing behavior is correct and sufficient, per §3 above). Not a new shared validation module (§1's decision). Not `fire-pending-dwells/index.ts` or `naavi-voice-server/src/index.js` (Phase 2 §1's explicit exclusions, reaffirmed).
- **No opportunistic refactoring is approved.** Neither function's existing fan-out/channel-selection/self-alert-detection logic is touched, renamed, or reorganized while these files are open for this change.
- **No architectural changes are approved beyond what Phase 2 + this document describe.** No unification of the two fan-out functions (Phase 1 §7 / Phase 2 §5 both hold this premature). No new table, no schema/migration change.
- **Explicitly excluded from this authorization** — each would need its own Phase 1/2/3:
  - Whether time-triggered alerts have the same *write-time* content-loss gap (Phase 1 §5, unproven) — only Layer 4's hardening extends there in this plan, not a write-time guard for that trigger family.
  - The 3rd location-alert insert path found while designing Phase 2 (`useOrchestrator.ts:862-917`, the compound-request handler with zero contact resolution) — logged onto [[B9x]], not part of this authorization.
  - Extending the invariant to `task_actions`, list-connected content generally, or future outbound-message features (Phase 1 §6's broader framing).

---

## 6. Deferred Architectural Decisions

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 3's Deferred Architectural Decisions requirement:

**Idea:** unify `report-location-event` and `evaluate-rules`'s entire fan-out implementations into one shared execution path (raised in B10g's own Phase 1 §7, reaffirmed in B10g's Phase 3 §4, and implicitly relevant here since this document's §1 confirms `buildAlertBody` is already the shared piece and everything else stays separate).

**Not approved for this implementation.** Same reasoning as B10g's own Phase 3 §4 — broader blast radius than either B10g's or this fix requires; premature before confirming the narrower, already-shared-where-it-matters pattern (this fix reuses `buildAlertBody`, adds nothing new to share) holds up in practice.

**Condition for reconsidering:** unchanged from B10g's own Phase 1/3 — already arguably met at three instances (F5c, B10d, B10g); this document adds a fourth data point in favor of T1a's priority without itself requiring the unification.

---

## 7. Outcome

**Implementation is authorized only within the boundaries defined in §5, using the resolutions in §1-4 above.** Any change outside those boundaries requires returning to Phase 2 (or Phase 1, if new evidence changes scope — as it did once already during Phase 2's own design). No code has been written under this document. Phase 4 (Implementation), Phase 5 (Evidence Package — including acceptance criterion 7, §2), and Phase 6 (Technical Review After Coding) follow, per governance — none have started.

---

## 8. Phase 3 review record (2026-07-17)

Reviewer feedback received via Wael. Two items adopted, one confirmed as-is:

1. **Acceptance criterion 7 extended to end-to-end** (§2) — Phase 5 must now verify the actual delivered SMS matches the clarification response and contains no synthesized fallback content, not just that the database row looks correct. The customer experiences the SMS, not the row.
2. **Wording tightened** (§1) — "buildAlertBody's existing return value is the single authoritative implementation" → "buildAlertBody is the single authoritative source for semantic-content determination at fire time," with an added clause distinguishing Layer 2/3's creation-time validation (subset of information available pre-persistence) from Layer 4's complete fire-time view.
3. **Separate `pendingContentClarificationRef` confirmed correct, not changed** — reviewer agreed overloading `pendingLocationRef` would have mixed two distinct concepts (address clarification vs. message clarification); keeping them separate reduces future maintenance risk.

Reviewer's stated assessment: no unresolved technical issue blocks implementation; deferred items are appropriately scoped as future work, not hidden assumptions; scope discipline (no voice changes, no schema changes, no shared fan-out refactor, no time-trigger write-path investigation) specifically praised as one of the biggest improvements seen in this project's recent governance documents.

**Verdict: Approved, authorized to proceed to Phase 4 Implementation**, with the one Phase 5 enhancement in §2's extended acceptance criterion 7.

**This is the reviewer's assessment of the document's quality — it is not, by itself, authorization to begin Phase 4.** Per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3): Phase 4 begins only when Wael says so explicitly, in a separate instruction, regardless of this review verdict.

---

## 9. Status

**Phase 3 drafted and reviewed 2026-07-17, revisions above adopted.** Phase 4 has NOT started and will not start until Wael gives explicit, separate approval for this specific transition.
