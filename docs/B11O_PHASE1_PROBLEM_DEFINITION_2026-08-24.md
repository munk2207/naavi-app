# B11o — Phase 1: Problem Definition

**Work item:** [[B11o]] — Voice `DELETE_EVENT` sends no `user_id`
**Date:** 2026-08-24
**Scope:** **STRICTLY VOICE STAGING** — branch `staging`, `naavi-voice-server/src/index.js`. Per Phase 0, ruled by Wael.
**Status:** **APPROVED by Wael, 2026-08-24.** §6 updated the same day with the live reproduction, which was outstanding at the time of approval and has since **confirmed the root cause verbatim**. **No code written.**

---

## 1. What exactly is broken

A registered caller asks Naavi by phone to delete a calendar event. The request reaches the backend without saying whose calendar it is, the backend cannot work it out, and the deletion never happens.

**The full chain is intact right up to the last step** — verified end to end below. This is not a wiring gap or a phantom; the feature is fully built and fails on one missing field.

---

## 2. Evidence

### 2.1 The action is genuinely reachable — the whole chain traced

Checked because Rule 17 requires the bug be real before a fix is designed, not assumed from a code read.

| Step | Location | What it does |
|---|---|---|
| 1 | `get-naavi-prompt/index.ts:766-767` | **RULE 6 — DELETE EVENT:** *"If ${userName} asks to delete/cancel a calendar event — call the delete_event tool"* |
| 2 | `naavi-voice-server/src/anthropic_tools.js:345-347` | `delete_event` is a defined tool in `NAAVI_TOOLS` |
| 3 | `src/index.js:3474` | `NAAVI_TOOLS` is sent to Claude on every voice turn |
| 4 | `src/anthropic_tools.js:752` | `delete_event: 'DELETE_EVENT'` — tool name maps to action type |
| 5 | `src/index.js:3582` | `convertToolUseToAction()` produces `{ type: 'DELETE_EVENT', query }` |
| 6 | `src/index.js:3958-3962` | Rule 23 confirm gate — held until the caller says yes |
| 7 | `src/index.js:4625` | `executeAction` case `DELETE_EVENT` — **the defect** |

**Note on the shared prompt.** Step 1 comes from `get-naavi-prompt`, the live shared prompt. The voice server's local `buildVoiceSystemPrompt` (`:2009-2010`) also describes `DELETE_EVENT`, but in the older JSON-action format, and is used **only** when the shared fetch fails (`:3235-3239` — either/or, never both). The reachable path is the shared prompt's tool form.

### 2.2 The defect

`naavi-voice-server/src/index.js:4625-4637`, branch `staging`:

```js
case 'DELETE_EVENT': {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-calendar-event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ query: action.query }),
  });
```

No `user_id`. The `Authorization` header is the **service-role key**, not a user JWT.

### 2.3 What the backend does with that

`supabase/functions/delete-calendar-event/index.ts:60-84` branches on `body.user_id`:

```ts
if (bodyUserId) {                      // admin path — .eq('user_id', bodyUserId)
  ...
} else {                               // JWT path — NO user filter
  const userClient = createClient(..., ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: tokenRow } = await userClient
    .from('user_tokens')
    .select('refresh_token')
    .eq('provider', 'google')
    .single();
}
```

The `else` branch has no user filter **by design** — it expects a real user JWT, so RLS narrows `user_tokens` to that user's single row. It receives the service-role key instead, which RLS does not narrow. `.single()` therefore runs against every Google token row in the project.

### 2.4 Measured, not assumed

`scripts/diag-b11k-user-tokens-count.js`, read-only, re-run 2026-08-24:

```
STAGING:    4 row(s) with provider='google'
PRODUCTION: 5 row(s) with provider='google'
```

`.single()` requires exactly one row. Four fails; five fails. `refreshToken` is undefined, and `:86-90` returns:

```
HTTP 400 {"error":"No Google token found"}
```

Proven live and read-only on both projects during [[B11k]] Phase 1 via `scripts/diag-b11k-delete-event-userpath.js`, using the function's own `diag:true` branch (`:101`), which returns before any delete.

### 2.5 What the caller hears — different on staging than on production

This matters for the live reproduction test.

- **Voice production** (`main:4506`): `ACTION_DEFAULT_SPEECH` maps `DELETE_EVENT: 'Event deleted.'`, and the action was dispatched fire-and-forget. **Naavi claims success on a delete that failed.**
- **Voice staging** (post-[[B11k]], `3bf15c3`): `executeAction` is awaited and the reply is built from the actual result. `src/outcome_report.js:50` registers `DELETE_EVENT: 'delete that event'`, so a failure is spoken truthfully — Naavi says she could not delete it.

**So on staging today, the expected symptom is Naavi audibly reporting failure.** That is the reproduction signal for the live test — not silence, and not a false success.

---

## 3. Root cause

**The voice entry point already holds the caller's identity and does not pass it on.**

- The caller is resolved by phone at `src/index.js:6650` — `const userId = await getUserIdByPhone(callerPhone)` — with no fallback; an unregistered number never reaches this code.
- That `userId` is threaded into the executor: `executeAction(a, userId)`, and the function signature is `executeAction(action, userIdOverride, effectiveTimezone)` (`:4517`).
- **`userIdOverride` is in scope inside the `DELETE_EVENT` case and is simply never read.**

Every sibling action in the same `switch` opens by consuming it:

```js
const uid = userIdOverride || await getUserId();
```

All 11 cases were scanned. `CREATE_EVENT`, `SCHEDULE_MEDICATION`, `REMEMBER`, `DELETE_MEMORY`, `SAVE_TO_DRIVE`, `DRIVE_SEARCH`, `GLOBAL_SEARCH`, `SET_EMAIL_ALERT`, `SET_ACTION_RULE` all do. **`DELETE_EVENT` is the only case that never computes `uid` at all.**

**Root cause stated in one line:** an omission in the voice entry point — the identity is present in the function's own parameter and not used — not a defect in Shared Core, and not a design flaw in the Edge Function's dual-auth branch.

### 3.1 Two properties of this root cause worth recording

1. **It is the identical shape to [[B11j]]** (voice `ADD_CONTACT`), fixed 2026-08-21 — for `ADD_CONTACT` alone. The same omission in `DELETE_EVENT` was never examined at the time.

2. **It fails safe today only because of the current user count.** `.single()` errors because *more than one* Google user exists. In a project with exactly one Google-connected user it would resolve — and delete from that person's calendar regardless of who phoned. **The safety is a property of the data, not of the code**, which makes this a live CLAUDE.md Rule 4 / Rule 10 violation rather than a latent one. `getUserId()` (`:1029`) is a deliberately neutered stub returning `null` with a warning, so `userIdOverride` is the only real identity source in this file.

---

## 4. Architecture ownership

**Capability:** Calendar — writes (create/delete event).
**Architecture Reference §2 classification:** **Shared Core** — `create-calendar-event`, `delete-calendar-event`, *"Genuinely shared."*
**Owning component per §0a:** Shared Core = `munk2207/naavi-app/supabase/functions/*`.

**But the defect does not sit in the owning component.** It sits in the **Voice entry point** — owner `munk2207/naavi-voice-server` per §0a — in its translation of a call into a Shared Core request.

This is precisely the failure §3 of the Reference describes: *entry points translate rather than implement*. The voice entry point is failing at translation — it holds the caller identity and does not carry it across the boundary. Shared Core behaves correctly given what it is sent.

**Consequence for scope:** the fix belongs in the entry point, and Shared Core must not be modified. Changing `delete-calendar-event` to tolerate a missing `user_id` would move business logic in the wrong direction and would alter behaviour for mobile and `naavi-chat`, both of which work correctly today.

**Protected Core:** yes, twice — Voice orchestration and Calendar integration (Reference §4). Full Phase 1–8 applies.

### Cross-surface verification (Phase 1A will formalise this; provenance tagged now)

- **Mobile — freshly verified this session.** `lib/calendar.ts:538` sends `{ query }` via `supabase.functions.invoke`, which attaches the signed-in user's JWT; the Edge Function's `else` branch then works as designed. `supabase/functions/naavi-chat/intentHandlers.ts:1124` sends `user_id: userId` explicitly. **Not affected. No matching change required.**
- **Demo — freshly verified this session.** Unreachable. `/voice/demo/name:7676` and `/voice/demo/confirm:7714` route into `buildDemoWalkthroughGateTwiml`; `/voice/demo/connect` (`:8580`), the only route that would open a conversation, is called by nothing. Action execution cannot be reached from the demo line. **Not affected.**
- **Voice production — freshly verified this session.** `origin/main:4625-4633` is byte-identical to `staging`. **Carries the same defect. Explicitly out of scope** per Phase 0 and STAGING-FIRST; receives the fix only on Wael's separate "deploy to production."

---

## 5. Alternatives considered

| # | Alternative | Verdict |
|---|---|---|
| **A** | **Pass `userIdOverride` in the request body**, matching the pattern all 10 sibling actions already use | **Preferred.** Smallest change, uses the Edge Function's existing admin branch as designed, identical to how [[B11j]] was fixed. Confined to the one authorized file. |
| B | Make `delete-calendar-event` tolerate a missing `user_id` under service-role auth | **Rejected.** There is no correct answer to "which user" when none is given — any default is a guess at whose calendar to delete. Also a Shared Core change, out of Phase 0 scope, affecting two working callers. |
| C | Have the voice server send a real user JWT instead of the service-role key | **Rejected.** Voice has no user JWT — it identifies callers by phone number, not login (Reference §2, *"two genuinely different mechanisms"*). It would also diverge from the pattern every other voice action uses. |
| D | Change `.single()` to `.maybeSingle()` in the Edge Function | **Rejected.** Converts a loud failure into a silent one and still never identifies the user. This is the *masking* variant of the bug, not a fix. |

**Alternative A is what Phase 2 should plan.** Phase 1 does not authorize it.

---

## 6. Live reproduction — RUN AND CONFIRMED (Wael, 2026-08-24)

Rule 17 requires the symptom be observed from the user's side, not inferred from a code read. **It was, and it reproduced exactly.**

**What Wael did:** created a meeting with David on the calling account, called voice staging (**+1 343 504 1572**), asked Naavi to delete the David meeting, heard her confirm the meeting back with the correct time, said yes.

**What he heard:** *"I can not do that"* — his paraphrase of the utterance recorded below.

**Log evidence** — `railway logs --service naavi-voice-staging`, captured immediately after the call. Timestamps in the raw log are relative to call start; no wall-clock stamp was present in the captured window, so none is asserted here.

**Turn 1 — the confirm gate, working as designed:**

```
[Claude DIAG] textBlocks=1 toolUseBlocks=0 stopReason=end_turn
[Claude DIAG] text-block: "I'll delete your David meeting tonight. Say yes to confirm,
              no to cancel, or tell me what to change."
[Claude DIAG] converted actions: 0 (none)
```

Speech only, zero actions. Rule 23's universal gate (`:3958-3962`) held the action for the confirm turn.

**Turn 2 — "Yes." — the full chain, and the failure:**

```
[Claude DIAG] textBlocks=1 toolUseBlocks=1 stopReason=tool_use
[Claude DIAG] tool_use name=delete_event jsonStr (26 chars): {"query": "David meeting"}
[Claude DIAG] converted actions: 1 (DELETE_EVENT)
[Action] Executing: DELETE_EVENT
[Action] DELETE_EVENT result: No Google token found
[Process] action DELETE_EVENT → failure
```

**`No Google token found` is the literal string predicted in §2.4**, produced by `delete-calendar-event/index.ts:86-90` when `.single()` cannot resolve against the project's multiple `provider='google'` rows.

### What this settles

1. **Every step of the chain traced in §2.1 fired.** Claude emitted `delete_event`; `convertToolUseToAction` produced `DELETE_EVENT`; `executeAction` ran it. **The action is reachable, the feature is fully wired, and it dies on the one missing field.** Not a phantom (Rule 17), not a prompt-level refusal.

2. **A refusal was the live alternative hypothesis and is now excluded.** *"I can not do that"* could have meant Claude declined and never emitted the tool — which would have made §3's root cause wrong. `toolUseBlocks=1` rules that out.

3. **Calendar reads work on voice.** `[Timing] fetchLiveCalendarEvents — 635ms, 8 event(s) from 2 calendar(s)`, and Naavi read the meeting's time back correctly. Reads are a separate duplicated path (Reference §2, ADR 0002) and are unaffected.

### §2.5's staging/production divergence — confirmed live

```
final_speech: "I wasn't able to delete that event. Please try again."
speech_modified: true
```

Claude's own words were **"I'll delete the David meeting now."** [[B11k]] discarded that sentence and replaced it with the truth — `speech_modified: true` is the override firing.

**On voice production, `main:4506` would have said "Event deleted."** The same failure, reported as a success. B11k is the only reason this test produced an honest symptom to observe.

---

## 7. Phase 1 conclusion

**Root cause: PROVEN.** File, line, function, branch, the missing field, the branch it forces the Edge Function into, the measured row counts that make that branch fail, and the exact HTTP response.

**Root cause NOT proven for:** nothing. No statement in this document rests on inference about the code path.

**Outstanding: nothing.** The live reproduction in §6 has been run and returned the predicted failure string verbatim. Rule 17 is satisfied — the symptom is user-facing, observed, and logged.

**No code written. No mechanism authorized.** Phase 1→1A requires Wael's own separate word.
