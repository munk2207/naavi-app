# B10h — Phase 2: Change Planning

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. Builds on `docs/B10H_PHASE1_PROBLEM_DEFINITION_2026-07-17.md` (reviewed across two rounds, no further changes requested). Touches Protected Core (Action Rules, Notification routing, Geofencing) — automatically requires Phase 3 technical review before coding, per governance §4.

Scope is bounded by Phase 1 §5/§6: closing the fail-open content gap for location-triggered third-party alerts, designed within the 5-layer defense-in-depth model Phase 1 posed, anchored to the invariant Phase 1 explicitly left for Phase 2 to operationalize: *"no outbound communication may be generated unless the semantic payload explicitly intended by the user is present and validated."*

**New evidence gathered while designing this plan (not assumed from Phase 1 alone):** Phase 1 traced one location-alert insert path (`commitPending`'s location branch, via `pendingLocationRef`, used when address resolution needs user confirmation). Designing this plan surfaced a **second, independent insert path** — `hooks/useOrchestrator.ts:3693-3816`, the "memory hit" fast path used when the place name matches a known personal keyword (`resolve-place` returns `source: 'settings_home'`/`'settings_work'`/`'contact'`) and inserts immediately with **no confirmation turn at all**. This precisely explains the discrepancy Wael observed between the two reproductions ("home" showed no confirmation; "854 Bayview Dr" did) — different insert paths, same underlying object with the same missing `body`. Both paths sit downstream of one shared point in the code (§1 below), which is where this plan places the guard, rather than duplicating it at each insert call.

---

## 1. Files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `hooks/useOrchestrator.ts` | Frontend (Protected Core — mobile, Action Rules) | **Layer 2/3 guard.** One check added at the top of the `if (triggerType === 'location')` block (current line 3411), immediately after contact resolution completes and before either downstream insert path (`settings_home`/`settings_work`/`contact` memory-hit at line ~3693, or the `pendingLocationRef` confirm flow) runs. If `actionConfig.to_phone` or `actionConfig.to_email` is present (a third-party recipient was already resolved) **and** `body`/`tasks`/`list_name` are all empty, block before any address-resolution work starts, set `turnSpeechOverride` to a clarifying question (*"What should I tell [name]?"*), and `continue` — same pattern already used by the existing `recipientBlocked` check three lines above it. | High — Protected Core, gates alert creation |
| `supabase/functions/report-location-event/index.ts` | Backend (Protected Core — Geofencing, Notification routing) | **Layer 4 guard.** Inside `fireLocationAction`, separate "was real content found" from "apply the self-alert fallback" — currently one `body` variable serves both purposes (`buildAlertBody(...) || fallbackText`, used unconditionally for every channel). Change: check `buildAlertBody`'s result for emptiness *before* applying the fallback; if empty **and** a third-party recipient exists (`toPhone`/`toEmail` set — i.e., not self-alert), skip the third-party channel sends specifically and log the reason, while self-alert channels continue to use the fallback exactly as today (self-fallback is legitimate, not a defect — see Phase 1 §4's scoping note). **Whether this check is written once (shared) or twice (duplicated with `evaluate-rules`) is an explicit open question for Phase 3 — see §2's flagged note. Not decided here.** | High — changes send behavior on a live Protected Core path |
| `supabase/functions/evaluate-rules/index.ts` | Backend (Protected Core — Action Rules, Notification routing) | **Layer 4 guard, symmetric with the above.** Same separation of "real content" from "self-alert fallback," applied to `fireAction`'s equivalent third-party sends for time/calendar/weather/contact_silence-triggered alerts. Included even though Phase 1 did not prove the *write-time* bug exists on this trigger family (§5, deferred) — this is a defense-in-depth backstop, not a write-time fix, and it directly extends the invariant Phase 1 posed to a second, independently-maintained fan-out function on principle, before a fourth instance of the "fixed one copy, not the other" pattern (F5c, B10d, B10g) has a chance to occur here too. **Deliberately proposed as "symmetric with report-location-event's change" rather than "the same shared code as report-location-event's change" — per review feedback, that distinction is exactly what Phase 3 must resolve, not assume either way.** | Medium — same behavioral change, but this function's write-time path is not proven broken, so this is a pure hardening addition, not closing a proven leak |

**No change to `naavi-voice-server/src/index.js`.** Voice-originated location alerts do not go through `hooks/useOrchestrator.ts` at all — Layer 2/3 (write-time) is mobile-specific by construction, matching where the bug was actually reproduced (Phase 1, both reproductions were via the mobile app). Layer 4 (fire-time) is trigger/surface-agnostic and protects voice-originated alerts too, without any voice-server change required — this is the concrete reason Layer 4 is not optional even though Layer 2/3 closes the proven mobile case.

**No change to `hooks/useGeofencing.ts` or `supabase/functions/fire-pending-dwells/index.ts`** — neither constructs or validates alert content; both are unaffected by this content-integrity question.

---

## 2. Proposed change (for Phase 3 review — not yet applied)

**Design principle, directly operationalizing Phase 1's invariant:** the guard is not "does `action_config.body` exist" (too narrow, as Phase 1 §6 noted) — it is "does the alert have *any* form of validated content the user actually provided" — `body`, `tasks`, or `list_name`, any one of which is sufficient, matching what `_shared/alert_body.ts`'s `buildAlertBody` already treats as valid content sources. The guard checks the same three fields `buildAlertBody` reads, so Layer 2/3 and Layer 4 share one definition of "has content," not two independently-maintained ones.

**Architectural principle for Phase 3 to hold to (per review feedback):** the semantic validation rule should exist in exactly one authoritative implementation. All creation-time and fire-time checks should consume that same definition rather than maintaining parallel logic. This does not necessarily mean one function today — it means Phase 3 must consciously decide whether a shared implementation is practical before accepting duplicated logic, rather than duplicating by default the way this exact bug's root cause (two independently-maintained fan-out functions, §1's Phase 1 cross-reference to F5c/B10d/B10g) already shows is dangerous.

**Explicit open question for Phase 3 (not decided here — flagged per review feedback):** *can the "has validated outbound semantic content" decision be implemented once, in a shared helper — e.g. a new `_shared/outbound_validation.ts`, or an extension of the existing `_shared/alert_body.ts` (which both `report-location-event` and `evaluate-rules` already import) — instead of writing the equivalent check independently inside `fireLocationAction` and `fireAction`?* Given `alert_body.ts` already defines exactly the three fields (`body`/`tasks`/`list_name`) this validation reads, extending it to also expose "does this actionConfig have real content" (a boolean, alongside the existing `buildAlertBody` string-builder) is a plausible, low-effort way to satisfy this — but Phase 3 should evaluate it explicitly, not accept two independently-written copies of the same check by default. This document does not require a shared implementation; it requires Phase 3 to decide with reasons, not skip the question.

**(a) Layer 2/3 — `hooks/useOrchestrator.ts`, top of the location branch:**
```ts
if (triggerType === 'location') {
  // B10h — fail-closed content guard. A resolved third-party recipient
  // with no body/tasks/list_name means Naavi has nothing real to tell
  // them; block before any address work starts rather than saving an
  // alert that will later synthesize fallback content for a real person.
  const hasThirdPartyRecipient = Boolean(actionConfig.to_phone || actionConfig.to_email);
  const hasContent = Boolean(
    String(actionConfig.body ?? '').trim() ||
    (Array.isArray(actionConfig.tasks) && actionConfig.tasks.length > 0) ||
    String(actionConfig.list_name ?? '').trim()
  );
  if (hasThirdPartyRecipient && !hasContent) {
    locationIntercepted = true;
    turnSpeechOverride = `What should I tell ${actionConfig.to_name || 'them'}?`;
    continue;
  }
  // ... existing placeName extraction and resolve-place flow, unchanged
}
```
Placed after contact resolution (so `to_phone`/`to_email` are already populated if a real contact was found) and before placeName extraction — a blocked alert costs nothing (no wasted `resolve-place` call).

**(b) Layer 4 — `report-location-event/index.ts`, inside `fireLocationAction`:**
```ts
// current:
// const body = await buildAlertBody(config, ...) || `You've arrived at ${rule.label}.`;

// proposed:
const realBody = await buildAlertBody(config, rule.user_id, supabaseUrl, interFnKey, rule.id);
const hasThirdPartyRecipient = Boolean(toPhone || toEmail);
if (!realBody && hasThirdPartyRecipient) {
  console.warn(`[report-location-event] B10h: SKIPPED third-party send (no_content) rule=${rule.id} to=${toName || toPhone || toEmail}`);
  // third-party sends omitted from `sends[]` below; self-alert sends (if any
  // channels also target the user) still use the fallback exactly as today
}
const body = realBody || `You've arrived at ${rule.label ?? 'your destination'}.`;
```
Exact mechanics of "omit third-party sends from the fan-out array" depend on `fireLocationAction`'s existing `sends[]`/`Promise.allSettled` structure (read in full during Phase 3, not redesigned here) — the principle is: self-alert channels are unaffected; third-party channels do not fire when `realBody` is empty, and the skip is logged with a distinct, named reason (`no_content`), matching F5c's and B10g's established logging discipline.

**(c) Layer 4 — `evaluate-rules/index.ts`, symmetric change inside `fireAction`**, same principle applied to that function's third-party sends.

### Acceptance criteria — what Phase 5 must verify

1. Reproducing Phase 1's exact failing phrasing ("text NAME MESSAGE," no self-reminder) now blocks at creation time with a clarifying question, for **both** insert paths found during this planning (`settings_home`/`settings_work` memory-hit, and the `pendingLocationRef` confirm flow) — not just one.
2. A location alert with real content (`body`, `tasks`, or `list_name` present) for a third-party recipient is completely unaffected — same save, same fire, same delivery as before this change.
3. A **self-alert** with no body (e.g. "alert me when I arrive at Costco") is completely unaffected at both layers — still saves, still fires, still sends the generic fallback text, exactly as today. This is the explicit scope boundary from Phase 1 §4 — self-alert fallback is legitimate, not a defect.
4. If Layer 2/3 is somehow bypassed (a rule reaches fire time with a third-party recipient and no content, for any reason not yet identified — the defense-in-depth rationale), Layer 4 independently blocks the third-party send at fire time and logs `no_content`, without touching any self-alert channel on the same rule.
5. `evaluate-rules`'s existing F5c/B10g-shared `task_actions` execution path is unaffected — this change touches the *primary* recipient's body construction, a different code region from the `task_actions` block.
6. **Conversational state is preserved across the clarification turn (per review feedback — explicit acceptance criterion, not assumed).** After Naavi asks *"What should I tell Bob?"* and the user replies with just the message (e.g. *"Goodnight"*), rule creation must resume using everything already understood — recipient, location, direction — without asking the user to repeat any of it or restart the request. Concretely: the blocked turn (§2(a)) must leave enough state behind (e.g. re-embed the partially-built `action`/`actionConfig` in a pending-turn marker, mirroring the pattern `naavi-chat`'s own `awaitingField`/`PENDING_INTENT` mechanism already uses for a missing-body question on time-triggered alerts, per `naavi-chat/index.ts:2147-2163`) that the user's one-word reply completes the same transaction rather than triggering a fresh, from-scratch `SET_ACTION_RULE` interpretation. Phase 3 should confirm this mechanism exists or design it explicitly — conversational state handling is exactly the kind of place a subtle regression hides.

---

## 3. Regression impact

| Area | Impact | Why |
|---|---|---|
| Voice commands | **Not directly affected by Layer 2/3** (mobile-only, matching where the bug was reproduced) — **affected by Layer 4**, which protects voice-originated location alerts too, since fire-time is surface-agnostic. No `naavi-voice-server` file touched. | Layer 4 is the backstop for exactly this gap |
| Geofencing | **Affected — Layer 4 changes `report-location-event`'s send behavior.** Must be scoped precisely to "no content + third-party" so the existing, working self-alert fallback and all resolved-content third-party sends are untouched. | Direct change to the real-time geofence fan-out |
| Gmail integration | Not affected. | No overlap |
| Calendar integration | Not affected. | No overlap |
| Reminders | Not affected — separate table/Edge Function. | No overlap |
| SMS / call alerts | **Affected — this is the fix's purpose.** A third-party send that would previously have gone out with synthesized content now either never saves (Layer 2/3) or never fires (Layer 4). No change to any send that already has real content. | Direct purpose |
| Onboarding | Not affected. | No overlap |
| Staging build | Mobile change (Layer 2/3) requires a staging APK build (`eas build --profile staging`) per the Two-Phase Build Process — no gates required for staging per `CLAUDE.md`. Edge Function changes (Layer 4, both functions) deploy via `npx supabase functions deploy <name> --no-verify-jwt --project-ref xugvnfudofuskxoknhve`, staging first per the staging-first rule. | Both surfaces touched, both need staging verification independently before either promotes |

---

## 4. Risk classification

**Overall: High.** Protected Core (Action Rules + Notification routing + Geofencing), and unlike B10g (a pure addition with zero current blast radius), this change **alters existing send behavior on live paths** — a location alert that previously would have sent a fallback-content SMS to a third party now, correctly, does not. That is the intended fix, but same as F5c's own risk framing: the downside is bounded to "a send that previously happened (with wrong content) now doesn't happen (and the user is asked to clarify instead)" — never a new way to send wrong content, only a removal of a wrong send in favor of either a clarifying question (Layer 2/3) or a silent skip with a logged reason (Layer 4).

**The two layers carry different risk shapes:**
- **Layer 2/3** (mobile, write-time) risk: the `hasThirdPartyRecipient && !hasContent` condition must be precise — a false positive would block a legitimate alert Phase 1 didn't anticipate. **Phase 3 must resolve this definitively, not leave it as an open concern (per review feedback):** prove one of exactly two statements — either *"`buildAlertBody` has exactly these three semantic inputs (`body`, `tasks`, `list_name`) and no others"* (in which case this plan's condition is complete as written), or *"there is a fourth input that must be included"* (in which case §2(a)'s condition needs that field added before implementation). This is a direct read of `_shared/alert_body.ts`'s current source, not a judgment call — Phase 3 should state the answer plainly, with the file:line citation, before authorizing Phase 4.
- **Layer 4** (server, fire-time) risk: must not affect self-alert channels on a rule that *also* has a third-party recipient (e.g., could a single location alert ever target both self and a third party simultaneously? Phase 3 should confirm this against the actual `fireLocationAction` fan-out structure before finalizing the exact code shape in §2(b)).

**Two open follow-ups from Phase 1 §5, still not resolved, relevant to finalizing scope:** whether a different message word than "goodnight" reproduces the same write-time loss (would strengthen confidence Layer 2/3's condition is correctly shaped), and whether self-alerts genuinely never have this gap (Wael's recollection, not independently re-verified) — recommended as cheap checks during Phase 3 or Phase 5, not blockers to approving this plan.

---

## 5. Explicitly deferred (per Phase 1 §5/§6 — not part of this Phase 2's implementation)

- **Whether time-triggered third-party alerts have the same write-time content-loss bug** (Phase 1 §5, unproven) — Layer 4's `evaluate-rules` change is a hardening backstop regardless of the answer, but a write-time (Layer 2/3-equivalent) guard for time-triggered alerts, if needed, requires its own investigation into `naavi-chat`'s server-side write path (a completely different code location from this plan's mobile-only Layer 2/3) and is not designed here.
- **Whether a different message word reproduces the failure** and **whether self-alerts share the gap** (Phase 1 §5) — recommended as cheap confirming checks, not required before this plan can be implemented, since the fix's shape (validate for *any* content source, scoped to third-party recipients only) is correct regardless of either answer.
- **Instrumenting a direct capture of the raw naavi-chat response** (Phase 1 §6 item 6) — closes Phase 1's one remaining evidentiary gap (generation-time omission by elimination vs. direct observation) but does not change this plan's design either way, since the fix operates on persisted/fired state, not on Claude's raw output.
- **Extending the invariant to other outbound-communication features** (Phase 1 §6's broader framing) — `task_actions` (F5c/B10g's own domain), list-connected content, and any future feature that generates outbound messages are all candidates for the same invariant, but applying it there is separate scoped work, not assumed as part of this plan.

---

## 6. Next step

Phase 3 — Technical Review (Before Coding), mandatory per governance §4 (Protected Core) and given the High risk classification in §4 — **not started, and will not be started without Wael's own separate, explicit go-ahead**, per the Phase-Gate Approval Rule. **No code has been written.**

**Two items Phase 3 is explicitly required to resolve before this can proceed to Phase 4 (per review feedback — approved with these as conditions, not open suggestions):**

1. **Decide whether Layer 4 validation should be one shared validator or duplicated in two Protected Core functions** (§2's flagged open question) — evaluate extending `_shared/alert_body.ts` or a new `_shared/outbound_validation.ts` against writing the equivalent check independently in `fireLocationAction` and `fireAction`. Decide with stated reasons; do not default to duplication.
2. **Verify the clarification flow preserves conversational state** (acceptance criterion 6, §2) — confirm or design the mechanism by which answering *"What should I tell Bob?"* resumes the existing alert-creation transaction rather than requiring the user to recreate the whole alert.

Phase 3 should also: (a) confirm the exact `fireLocationAction`/`fireAction` fan-out structures support cleanly separating third-party sends from self-alert sends when content is missing (§2(b)/(c) sketched the principle, not the precise diff); (b) resolve the `buildAlertBody` field-completeness question definitively (§4); (c) decide whether the two cheap follow-up checks from §5 should run before or during implementation; (d) confirm no other location-alert insert path exists beyond the two found while planning this document — a third path would need the same guard, and this planning pass searched `hooks/useOrchestrator.ts` specifically, not exhaustively re-verified against the full codebase.

---

## 7. Phase 2 review record (2026-07-17)

Reviewer feedback received via Wael. Four items, all adopted:

1. **Layer 4 duplication flagged as an explicit Phase 3 question, not silently accepted.** §1 and §2 now state plainly that whether `report-location-event` and `evaluate-rules` share one validator or each carry their own copy is undecided, with a concrete candidate (`_shared/outbound_validation.ts`, or extending `_shared/alert_body.ts`) named for Phase 3 to evaluate. §2 gained an explicit architectural principle: the semantic validation rule should exist in exactly one authoritative implementation, with all creation-time and fire-time checks consuming that same definition — not necessarily one function today, but a conscious Phase 3 decision, not a default.
2. **Conversational-state preservation added as acceptance criterion 6.** After the clarification question, rule creation must resume without re-asking for recipient or location — named explicitly rather than assumed, with a concrete mechanism pointed to (`naavi-chat`'s existing `awaitingField`/`PENDING_INTENT` pattern) for Phase 3 to confirm or design.
3. **The `buildAlertBody` field-completeness question turned into a required Phase 3 proof, not an open concern.** §4 now requires Phase 3 to state one of exactly two facts, with file:line evidence: either `buildAlertBody` has exactly three semantic inputs (this plan's condition is complete), or a fourth exists (the condition needs it added).
4. **§6 restructured** to name the shared-validator decision and the conversational-state verification as the two explicit conditions of approval, not general suggestions folded into a longer list.

Reviewer's stated assessment: design driven by Phase 1 evidence rather than speculation, every proposed change tied to a specific failure mode, defense-in-depth philosophy consistent throughout, regression risk discussed honestly, scope boundaries disciplined, and the mid-design discovery of the second insert path treated as a strength rather than a setback. Explicitly praised the decision not to touch the voice server — the defect was reproduced in mobile, and Layer 4's fire-time protection covers voice automatically, keeping the change smaller.

**Verdict: Approved, conditioned on Phase 3 resolving the two items in §6.** This is the reviewer's assessment of the plan's quality and the two conditions attached to it — it is not, by itself, authorization to begin Phase 3. Per the Phase-Gate Approval Rule (`docs/AI_DEVELOPMENT_GOVERNANCE.md` §3): moving to Phase 3 requires Wael's own separate, explicit go-ahead for this specific transition, regardless of this review verdict.

---

## 8. Status

**Phase 2 drafted and reviewed 2026-07-17, revisions above adopted, approved conditioned on Phase 3 resolving two named items.** Phase 3 has NOT started and will not start until Wael gives explicit, separate approval for this specific transition.
