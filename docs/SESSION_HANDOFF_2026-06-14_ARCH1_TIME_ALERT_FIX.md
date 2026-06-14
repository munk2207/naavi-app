# Session Handoff — 2026-06-14 (Session 2)
## Focus: ARCH-1 time-alert third-party send — root cause found, fix deployed

---

## NEXT SESSION PRIORITY — TEST BOB FIRST

**Do this before anything else:**

1. Clear the chat (fresh conversation, no prior context)
2. Type: **"Text Bob at 9 AM say hello"**
3. Say **"yes"** when Naavi asks to confirm
4. Check the Alerts screen — is there a new TIME alert for Bob?
5. Run this DB query to confirm:

```sql
SELECT id, action_config, trigger_config, enabled, created_at 
FROM action_rules 
WHERE trigger_type='time' 
ORDER BY created_at DESC 
LIMIT 3;
```

If a Bob rule appears with Bob's phone → fix is working. Move to Sarah disambiguation test.
If still no Bob rule → prompt change didn't take effect or Claude isn't following it. See diagnosis below.

---

## What was done this session

### Root cause confirmed (client_diagnostics query)

Queried `client_diagnostics` for Wael's user_id. Found:
- `orch-actions done, turn rendered` appears on Turn 2 "Yes"
- `[SET_ACTION_RULE] action received` is **completely absent**

**This proves: the server returned `actions=[]` on Turn 2.** The mobile never received a SET_ACTION_RULE action. No manage-rules call was made. No DB row.

**Why:** RULE 23 prompt instructs Claude: "Turn 1: speech only, no tool call." Claude says "I'll text Bob at 8:30 AM. Say yes to confirm." with `actions=[]`. ✓ Correct.

But on Turn 2 "Yes", Claude was ALSO generating speech-only "Alert set." without calling the tool. Prompt violation — Claude treated "yes" as verbal acknowledgment, not a trigger to emit the tool call.

### Fix deployed (v114)

**File:** `supabase/functions/get-naavi-prompt/index.ts`
**Version:** `2026-06-14-v114-time-trigger-turn1-tool`

**Change:** Added TIME-TRIGGER EXCEPTION to RULE 23 Turn 1:

> For `set_action_rule` with `trigger_type='time'`: call the tool on Turn 1 WITH the confirm speech. The server intercepts the Turn 1 tool call, holds it until the user confirms, then executes it via Step 1.4. On Turn 2, say "Done." — do NOT emit a tool call again.

Also added a concrete time-trigger example in the EXAMPLES section showing Turn 1 WITH tool call.

**Deployed:** ✅ `npx supabase functions deploy get-naavi-prompt` — successful

**How the fix works:**
1. Claude calls `set_action_rule(trigger_type='time', ...)` on Turn 1
2. B4y gate catches it (no prior "say yes to confirm" on Turn 1) → drops action, sets `b4yDroppedStateChanging=true`
3. `embedPendingTime = true` → PENDING_INTENT embedded in `display` field
4. Claude's confirm speech plays to user
5. User says "Yes" (Turn 2)
6. Step 1.4 reads PENDING_INTENT → calls `lookup-contact` for Bob → 1 result → injects phone → calls `manage-rules create` → rule in DB ✓
7. No Claude call on Turn 2 at all — fully deterministic

### All tests before fix (pre-deploy, before 7:37 AM EST)

All "Text Bob" tests at 7:19 AM and 7:39 AM were BEFORE the deploy. The 7:39 "I just set that up" from Naavi was confabulation (conversation context). DB confirmed: most recent time rule was 7:00 AM EST, no Bob rules ever created.

---

## Uncommitted changes (commit at start of next session — AFTER Bob test passes)

### `supabase/functions/get-naavi-prompt/index.ts`
- v114 time-trigger Turn 1 exception + example
- PROMPT_VERSION bumped to `2026-06-14-v114-time-trigger-turn1-tool`

### `supabase/functions/naavi-chat/index.ts`
Large diff — all deployed but NOT committed. Covers:
- Classifier fix (SET_REMINDER vs SET_ACTION_RULE routing)
- PENDING_INTENT embedding for time-trigger (B4y drop path)
- Step 1.4 gate fix (allows `# N` pick when `awaitingDisambig` present)
- Step 1.4 SET_ACTION_RULE handler (phone resolution + disambiguation)
- T1 phone-injection block (resolves phone before confirm speech)
- T2 intercept block (Turn-2 fallback if speech-only Turn 1 slips through)
- Diagnostic console.log lines at T2 entry (can remove after Bob test passes)

**Suggested commit message after Bob test passes:**
```
fix(naavi-chat+prompt): ARCH-1 time-alert Turn 1 tool-call + server-side phone resolution — v114

- Prompt v114: time-trigger SET_ACTION_RULE calls tool on Turn 1; B4y
  intercepts and embeds PENDING_INTENT; Step 1.4 executes on Turn 2 "yes"
  deterministically — no dependency on Claude emitting tool on Turn 2
- naavi-chat: PENDING_INTENT embedding for time-trigger on B4y drop
- naavi-chat: Step 1.4 gate extended for # N disambiguation pick
- naavi-chat: Step 1.4 SET_ACTION_RULE handler with lookup-contact +
  disambig response when 2+ contacts share name
- naavi-chat: T1 phone resolution before confirm speech
- naavi-chat: T2 intercept fallback for speech-only Turn 1 edge case
- naavi-chat: classifier fix (time-trigger → SET_ACTION_RULE not SET_REMINDER)

parity-impact: mobile=shipped voice=TBD
```

---

## ARCH-1 test status

| Step | Status |
|------|--------|
| Classifier routes "send X SMS at time" → SET_ACTION_RULE | ✅ Fixed |
| B4y drops action on Turn 1, prompts confirm | ✅ Working |
| PENDING_INTENT embedded for Turn 2 to execute | ✅ Working |
| Turn 2 "yes" executes via Step 1.4 | ✅ Working |
| Root cause of no-rule-created identified | ✅ Confirmed via client_diagnostics |
| Prompt fix deployed (Claude calls tool on Turn 1) | ✅ Deployed — **UNTESTED** |
| Correct phone resolved (community-first) | ⏳ Will be tested next session (Bob = 1 contact) |
| Sarah disambiguation (2 contacts) | ⏳ After Bob passes |
| Confirm speech shows phone number | ⏳ After Bob passes |
| evaluate-rules fires the SMS at trigger time | ⏳ After phone confirmed correct |
| SMS delivered to correct number | ⏳ Final verification |

---

## Key architecture (for next session reference)

**The PENDING_INTENT pipeline (Turn 1 → Turn 2):**

1. `naavi-chat` receives "Text Bob at 9 AM say hello"
2. Claude calls `set_action_rule(trigger_type='time', action_config:{to:'Bob', body:'hello'}, ...)` + confirm speech
3. B4y gate (line 2914-2971): captures as `pendingTimeRule`, drops from `actions[]`
4. T1 block (line 3050+): calls `lookup-contact('Bob')` → 1 result → sets `resolvedConfirmPhone` → injected into speech
5. `embedPendingTime = true` → `display = speech + <!--PENDING_INTENT:{...}-->`
6. Mobile stores `display` as `assistantSpeech` in conversation history
7. User says "Yes" → Step 1.4 (line 1820) reads PENDING_INTENT from last assistant message
8. Step 1.4 SET_ACTION_RULE handler (line 1966): re-resolves Bob, injects phone, returns `actions:[SET_ACTION_RULE]`
9. Mobile receives action → calls `manage-rules create` → DB row created ✓

**Key files:**
| File | Role |
|------|------|
| `supabase/functions/get-naavi-prompt/index.ts` | Prompt — v114 deployed |
| `supabase/functions/naavi-chat/index.ts` | B4y + PENDING_INTENT + Step 1.4 — deployed, not committed |
| `hooks/useOrchestrator.ts` | Mobile — NOT touched; lookupContact takes contacts[0] but server resolves before mobile sees the action |
| `supabase/functions/manage-rules/index.ts` | Writes action_rules row — no changes needed |

---

## If Bob test FAILS next session

Check client_diagnostics:
```sql
SELECT step, payload, created_at 
FROM client_diagnostics 
WHERE user_id = '788fe85c-b6be-4506-87e8-a8736ec8e1d1' 
ORDER BY created_at DESC 
LIMIT 20;
```

Look for:
- `[SET_ACTION_RULE] action received | trigger=time` — if missing, server returned actions=[]
- `[SET_ACTION_RULE] manage-rules response | ok=... | error=...` — if present, check the error

Also check Supabase Edge Function logs for naavi-chat (clear any filter, look at raw logs) for:
- `[naavi-chat] T2-intercept-check | b4yDropped=...` — confirms T2 ran
- `[naavi-chat] Embedded PENDING_INTENT for time-trigger` — confirms B4y captured on Turn 1
- `[timing] Step1.4 — executing confirmed intent: SET_ACTION_RULE` — confirms Step 1.4 ran on Turn 2
