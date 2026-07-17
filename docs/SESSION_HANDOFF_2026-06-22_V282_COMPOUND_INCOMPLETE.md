# Session Handoff — 2026-06-22 — V282 Compound Fix Incomplete

## Status
**ACTIVE APK = V282** (staging APK on emulator + phone)
**Server changes deployed to STAGING only** (`xugvnfudofuskxoknhve`)
**Production untouched.**

---

## What this session attempted

Fix the V282 compound question so it shows a numbered breakdown of all 6 actions before executing them (confirm-then-act flow). All fixes are server-side (no new APK needed for this).

**Test compound question:**
```
Naavi, her is in my mind, book a meeting with Bob next Monday at 2pm to discuss Budget planning
Remind me to discus my break maintenance when I arrive to Toyota
Add Todo and latest schedule to my work list
Attach my work list to office arrival
text Sarah that I'll be 30 minutes late,
Remind me to call Jasmine one day before her Graduation
```

---

## What was changed (staging only)

### `supabase/functions/naavi-chat/index.ts`

**Change 1 — max_tokens raised from 1024 → 2048** (line ~1882)
```ts
// OLD:
const max_tokens = Math.min(rawMaxTokens ?? 1024, 1024);
// NEW:
const max_tokens = Math.min(rawMaxTokens ?? 2048, 2048);
```
Reason: the 1024 cap cut Claude off after ~2 tool calls in a 6-item compound.

**Change 2 — `resolveBeforeEventDate` injection fixed** (deployed in PRIOR session)
Removed `"Do NOT show a numbered list."` from the Jasmine graduation date injection. That phrase was causing Claude to suppress the numbered breakdown globally.

**Change 3 — Compound detection + `tool_choice: "none"`** (line ~3188–3231)
- Detects compound: user message has 4+ non-empty lines (length > 8 chars)
- When compound detected:
  - Appends a system note instructing Claude to output a numbered list + "Say yes to confirm all, or no to cancel."
  - Sets `claudeParams.tool_choice = { type: 'none' }` — forces text-only output at the API level
- On "yes" confirmation turn (short message, compound not re-detected): normal tool use resumes with max_tokens=2048

---

## What failed

The compound test still failed after all three changes were deployed. Exact failure mode not confirmed — Wael said "Failed" and stopped the session.

**Possible remaining issues to investigate next session:**

1. **The compound detection threshold may be wrong.** The message has 6 action items but they were typed inline with a leading "Naavi, her is in my mind" preamble. Count of lines > 8 chars might be counting differently than expected. Add a log line to confirm: `console.log('[compound-detection] lines:', msgNonEmptyLines.length, 'isCompound:', isCompoundTurn)` and check Supabase logs.

2. **`tool_choice: { type: 'none' }` may not be supported on Haiku 4.5.** The Anthropic API supports `tool_choice` as `{ type: "auto" | "any" | "tool" | "none" }` — but "none" might be a newer API feature not yet supported on all model versions. Verify in Anthropic docs.

3. **The confirmation turn ("yes") may not execute all 6 tools.** Even if the breakdown shows correctly, Claude on the "yes" turn needs to look back at the numbered list and emit all 6 tool_use blocks. With max_tokens=2048 this should fit, but Haiku may need more context injection.

4. **Demo Mode interaction.** Demo Mode auto-sends "yes" after 700ms. If compound breakdown shows correctly in demo mode, the auto-confirm should trigger execution. Verify demo mode is OFF during testing.

---

## Next session priority

### Priority 1 — Fix compound on staging (no APK)

1. Add debug log to compound detection block:
   ```ts
   console.log(`[compound-detection] lines=${msgNonEmptyLines.length} isCompound=${isCompoundTurn}`);
   ```
2. Deploy to staging, run compound test, check Supabase Function logs to confirm compound was detected.
3. If not detected → fix the line-count logic.
4. If detected but still failing → investigate `tool_choice: "none"` support.
5. Test "yes" confirmation turn — confirm all 6 execute.

### Priority 2 — Fix V282 APK issues (new staging APK)

From V282 revert record / previous sessions, these items were failing:
- Compound header pinning
- 5 failed test items from V281
- Office alert lookup (B4x false negative — see below)

### Priority 3 — B4x false negative for "Office arrival"

Wael has an "Arrive at Office · 55 Queen St" alert. When compound question ran in old mode (without `tool_choice: none`), B4x returned "You don't have a Office arrival alert." 

Root cause investigation:
- `matchAlertByName("office arrival")` strips "arrival" → searches for "office"
- "Arrive at Office" normalized = "arrive at office" → `.includes("office")` = TRUE
- So match SHOULD work — unless `userId` was null/wrong at validation time, OR the alert's `label` column contains something different than what the UI shows
- **Check**: `SELECT id, label, trigger_config, enabled FROM action_rules WHERE user_id = '788fe85c-b6be-4506-87e8-a8736ec8e1d1' AND trigger_type = 'location'` on staging DB — confirm label value

---

## Staging state at session end

- `naavi-chat` on staging has all 3 changes deployed
- No migrations, no mobile code changes, no new APK
- Emulator (Naavi-Test) was working at end of last session (lock files cleared)
- Production (`hhgyppbxgmjrwdpdubcx`) is untouched

---

## Key files

| File | What changed |
|------|-------------|
| `supabase/functions/naavi-chat/index.ts` | max_tokens 1024→2048, compound detection, tool_choice:none |

## Git status
All changes are uncommitted (server-side only — deployed directly to staging Edge Function). Nothing to commit for the mobile app changes until the APK build.

---

## Memory reference
- `project_v281_reverted_v282_plan.md` — V282 plan and revert context
