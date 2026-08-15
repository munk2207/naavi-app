# Visits Flow Redesign — Phase 2 — Change Plan

Status: Content resolved (2026-08-15) — the one open issue (person-mentions within calendar actions) is settled per Wael's decision below. No code has been written; the tests in this document call already-deployed staging Edge Functions to observe existing behavior, exactly as permitted by Phase 2's "no code yet" rule. Scope: Mobile only (Phase 0 Amendment 2). Awaiting Wael's separate, explicit go-ahead to Phase 3.

---

## Wael's three required proofs — evidence, not assumption

### Proof 1 — a Visits-generated request receives the same `naavi-chat` calendar confirmation behavior as a normal live request

**Live test against staging `naavi-chat`**, real request/response pasted, not paraphrased:

Turn 1 — sent a compound message shaped exactly like `extract-actions`' real output (4 actions: prescription, test, appointment, email with a literal address), one imperative line per action:

```
"Start me on Amoxicillin, 09:00 and 21:00, for the full 10 days, starting 2026-08-15 through 2026-08-24.
Get a blood test on 2026-08-21.
Schedule a follow-up appointment with Dr. Ahmed on 2026-08-29 at 10:00.
Draft an email to whwh2207@gmail.com about my questions. Body: Hello, I have a question following my appointment."
```

Response: `"actions":[]`, `"speech":"Here are your 4 actions:\n\n1. Start Amoxicillin...\n\nSay yes to confirm all, or no to cancel."` — **nothing executed.** Exactly the compound-confirm behavior a live typed request gets.

Turn 2 — sent the same history plus `"Yes"`. Response: `"actions":[{"type":"SCHEDULE_MEDICATION",...},{"type":"CREATE_EVENT","summary":"Blood test",...},{"type":"CREATE_EVENT","summary":"Follow-up appointment...",...},{"type":"DRAFT_MESSAGE","to":"whwh2207@gmail.com","channel":"email",...}]` — **only now** are the real actions returned for execution. Confirms `naavi-chat`'s existing confirm-then-act gate applies identically to a Visits-shaped compound message, with no code changes needed to get this behavior — it already exists and already works.

**Bonus finding:** `SCHEDULE_MEDICATION` came back using `naavi-chat`'s own proper recurring-schedule shape (`times`, `on_days`/`off_days`, `duration_days`) — confirming the currently-duplicated Visits-local dose-expansion loop (`hooks/useConversationRecorder.ts` lines ~400-449, one `create-calendar-event` call per dose per day) can be deleted entirely rather than translated; `naavi-chat` already handles it, better.

### Proof 2 — the exact recipient-resolution path satisfies real 0/1/N ambiguity behavior, not `lookupContact()`'s blind first-match

Two things had to be confirmed together: (a) does a Visits-derived email action reliably come back as `channel: "email"`, and (b) does `channel: "email"` reliably route to the *good* resolution mechanism (`resolveRecipient()`, not the blind `lookupContact()`)?

**(a) — confirmed by the same live test above and a second one with no literal address**, only a name:
```
"...Draft an email to Dr. Ahmed about my questions. Body: Hello, I have a question following my appointment."
```
Turn 2 ("Yes") returned: `{"type":"DRAFT_MESSAGE","to":"Dr. Ahmed","channel":"email",...}`. Both the literal-address and name-only cases came back correctly tagged `channel: "email"`.

**(b) — confirmed by direct code read, `hooks/useOrchestrator.ts:3225-3230`:**
```js
if (action.type === 'DRAFT_MESSAGE' || action.type === 'ADD_CONTACT') {
  const ch = String((action as any).channel ?? 'sms').toLowerCase();
  const isAutoSend = action.type === 'DRAFT_MESSAGE' && dedupedActions.length > 1 && (ch === 'sms' || ch === 'whatsapp');
```
The compound-confirm auto-send bypass (which skips DraftCard entirely) is gated to `ch === 'sms' || ch === 'whatsapp'` **only** — `email` is excluded by construction, so it always falls through to `turnDrafts.push(action)` and renders as a real DraftCard. DraftCard's email path (Phase 1A citation, `app/index.tsx:427`) calls `resolveRecipient()` — the one mechanism with genuine 0/1/N handling (picker on 2+ matches, ask on 0, readback on 1).

**Conclusion:** a Visits-derived email action, real address or name-only, reaches the good resolution path — not the blind one — as a direct consequence of `channel: "email"` always being set and always excluded from the SMS/WhatsApp auto-send shortcut. This is proven for the email action type specifically.

### Correction (2026-08-15, after Wael's review) — a person named inside a calendar action, distinct from a message recipient

The original wording above ("calendar-type actions have no recipient to resolve at all") was too broad. Investigated further, per Wael's explicit instruction to resolve this before Phase 3, not to redesign preemptively.

**Finding: this is not a gap Visits' redesign introduces — it's existing, deliberate, dated design already governing live chat.** `supabase/functions/get-naavi-prompt/index.ts:601-611` ("ATTENDEE SCOPE — INVITE ONLY WHEN USER EXPLICITLY ASKS," dated **Wael, 2026-05-06** — predates this work item entirely):

> *"'Schedule a meeting with [name]' by itself means CREATE the calendar event titled with that person — DO NOT auto-send them an invite. The 'with [name]' wording is descriptive (the meeting topic includes them) NOT a directive to send an invite. Leave the attendees array EMPTY in this case."*

Worked example, same file, line 609: *"'Schedule a meeting with Bob on Friday at 4 PM' → CREATE_EVENT with attendees: []."* — no contact lookup, no clarification, by design. This matches exactly what the live test observed for "follow-up appointment with Dr. Ahmed": the name became descriptive text in `summary`, nothing more.

**But when an invite is explicitly requested, resolution already exists** — same file, lines 604 and 610: *"'Schedule a meeting with Bob and invite him' → look up Bob in contacts. If found, attendees: [resolved email]. If not found, attendees: []. Speech: 'I've added the calendar event but don't have Bob's email — please add it before I can send the invite.'"*

So there are genuinely three cases, not one:
1. **A named person mentioned only descriptively in a calendar action** ("appointment with Dr. Ahmed," no invite requested) — by existing, dated, Wael-authored design, treated as text, not a recipient. This is true for live chat today, independent of this work item.
2. **A named person with an explicit invite request** — already resolved via `lookup-contact` today, inherited automatically once Visits routes through `send()`, same as everything else in this design.
3. **A named recipient of an actual message** (email/SMS/WhatsApp) — covered above, real 0/1/N resolution.

**Resolution, not a redesign:** since Phase 0's User Intent was explicitly "handle confirmation and contact resolution the same way the live voice/chat assistant already does," and case 1 above **is** how live chat already does it — deliberately, since 2026-05-06 — routing Visits through `send()` achieves exact parity with the stated baseline, not a partial fix. It does not introduce a new gap; it inherits an existing, intentional one that predates this work item and applies equally to every live-chat user today.

**Resolved by Wael (2026-08-15): match live chat's existing behavior — no scope expansion.** Case 1 (descriptive person-mention, no invite requested) is accepted as-is; Visits inherits it automatically by routing through `send()`, with no additional code needed for this point. This closes Phase 2's one outstanding issue — no other change to the proposed design resulted from this investigation.

### Proof 3 — calling `send()` from Visits cannot destroy or corrupt an existing `pendingActionRef`

**No data corruption occurs** — confirmed by direct code read, `hooks/useOrchestrator.ts:985-1041`. But there is a real, related behavioral risk that must be designed around, not just "proven safe":

If `pendingActionRef.current` is set (an unconfirmed DraftCard exists — e.g. the user had asked Naavi to draft something moments before finishing a Visits recording) and a new `send()` call arrives whose text isn't a yes/no/correction match, the existing pending action is **silently cleared** (lines 1036-1041, comment: "Fresh command (edit / new question)") and the new message proceeds. Nothing is corrupted or crashes — but the user's prior unconfirmed draft is abandoned with no warning.

**This means Proof 3, as literally stated, is only half-satisfiable by the existing code as-is** — no corruption, but a real silent-interference risk. The mitigation is straightforward and cheap: `pendingAction` (the state mirror of `pendingActionRef`, already returned from `useOrchestrator()` and already in scope in `app/index.tsx`) can be checked before Visits calls `send()`. If truthy, don't send — surface something to the user instead (e.g. "finish your current request first, then I'll go through what I found in your visit"). This is now an explicit part of the design below, not left as residual risk.

---

## Proposed design (Alternative A, per Wael's stated strong preference, now evidence-backed)

`hooks/useConversationRecorder.ts`'s `confirmSpeakers` stops executing anything directly. After `extract-actions` returns, the hook returns the extracted actions to its caller. `app/index.tsx` builds one imperative line per action (matching the tested format above) and calls the existing `send()` — guarded by a `pendingAction` check (Proof 3's mitigation) — letting `naavi-chat`'s already-verified confirm-then-act pipeline do the rest.

## Files that will change

| File | Classification | Change |
|---|---|---|
| `hooks/useConversationRecorder.ts` | Mobile / Shared Logic (client hook) | Remove the calendar auto-create loop and prescription dose-expansion block (`confirmSpeakers`, ~lines 380-470) and the now-false "Added to your calendar" spoken summary. `confirmSpeakers` returns the extracted `ConversationAction[]` to its caller instead. |
| `app/index.tsx` | Mobile / UI | After `confirmSpeakers` resolves (both call sites — the speaker-labeling modal's "Done" button and the single-speaker auto-skip path), build the compound message and call `send()`, guarded on `pendingAction`. Remove the `ConversationActionCard` render block once verified working. |
| `components/ConversationActionCard.tsx` | Mobile / UI | Deleted — confirmed by Phase 1A's repo-wide check to have no other consumers. |

No Edge Function, database, or Voice file changes. `naavi-chat`, `extract-actions`, `hooks/useOrchestrator.ts` are unmodified — reused exactly as they exist today, per Phase 0's Constraint and the Phase 0 condition that Phase 2 not introduce a Shared Core mechanism justified by a future Voice need (none is proposed here at all).

## Risk classification: **Medium**

Touches Protected Core (Calendar integration, per Architecture Reference §4) but modifies only Mobile entry-point code — no Shared Core logic changes, no schema changes, no new Edge Function. Full Phase 1-8 review still applies per §4's rule regardless of this classification.

## Change Impact Matrix

| Layer | Affected? | Details |
|---|---|---|
| Mobile | **Yes** | The three files above. |
| Voice | **No** | Explicitly out of scope (Phase 0 Amendment 2); `naavi-voice-server` untouched. |
| Shared Core | **No** | `naavi-chat`, `extract-actions`, `create-calendar-event`, `send-email` all called as-is, no modifications. |
| Database | **No** | No schema, migration, or RLS change. |
| Cron | **No** | Not touched. |
| API contracts | **No** | No Edge Function request/response shape changes. |
| Tests | **Yes** | The existing `tests/catalogue/session-2026-08-15-conversation-recorder-fix.ts` regression test calls `extract-actions` directly and is unaffected (that function doesn't change). A new test should assert `confirmSpeakers` no longer calls `create-calendar-event` directly — detailed under Phase 5's plan, not written yet. |

## Mandatory Architecture Impact Checklist

- Does this change modify Shared Core? **No.**
- Does this change modify an Entry Point (translating logic rather than Shared Core)? **Yes** — `hooks/useConversationRecorder.ts` and `app/index.tsx`, both Mobile entry-point code, per the Architecture Reference's own principle (§1) that entry points should translate rather than implement business logic. This change moves the Visits flow *toward* that principle (removing locally-duplicated execution logic), not away from it.
- Does this change introduce new duplication? **No** — it removes the calendar-creation and prescription-expansion logic that duplicated what `naavi-chat`/`SCHEDULE_MEDICATION` already does.
- Does this change eliminate existing duplication? **Yes** — the Mobile-side half of the Mobile/Voice duplication found in Phase 1. (Voice's half remains, tracked separately as `B11b`.)
- Does this change modify Protected Core? **Yes** — Calendar integration (Architecture Reference §4), via Mobile entry-point code only, not Shared Core.

## Regression Impact

| Area | Affected? | Details |
|---|---|---|
| Voice commands | No | Not touched. |
| Geofencing | No | Not touched. |
| Gmail integration | No | Not touched. |
| Calendar integration | **Yes, by design** — this is the fix. Live-chat `CREATE_EVENT`/`SCHEDULE_MEDICATION` paths themselves are unmodified (Shared Core reused as-is); only Visits' own bypass of them is removed. |
| Reminders | No | Not touched. |
| SMS / call alerts | No | Not touched. |
| Onboarding | No | Not touched. |
| Staging build | Yes | A new staging APK is required to test this (Mobile client change) — no build has been requested or made yet. |

## Regression Matrix — `confirmSpeakers` consumer trace

Every call site, found by grep (not recalled), both inside `app/index.tsx`:
1. The speaker-labeling modal's "Done — Extract Action Items →" button handler.
2. The single-speaker auto-skip `useEffect` (when AssemblyAI returns exactly one speaker, the modal is bypassed entirely).

Both will be updated in the same change to call the new compound-message path. No other file calls `confirmSpeakers` (confirmed Phase 1A). `ConversationActionCard`'s only consumers are these same two files' render output, already covered above.

## No code yet

Nothing in this document has been implemented. The evidence above came entirely from calling already-deployed staging Edge Functions and reading existing files — no Visits code has changed since the Phase 0 revert.
