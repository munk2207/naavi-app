# Session Handoff — 2026-06-18
## Build 262 (Preview APK) + Critical Location Alert Regression

---

## CRITICAL OPEN BUG — FIX THIS FIRST

**"Alert me when I arrive home" → "I didn't catch the place for that alert"**
- Broken on Build 261 production (main account, wael.aggan@gmail.com)
- Broken on Build 262 preview APK (mynaavidemo@gmail.com)
- This was working before this session. Root cause NOT yet found.

### What was confirmed this session

All server-side changes from this session were **reverted and redeployed clean**:
- `naavi-chat/index.ts` — reverted to committed state (re-deployed ✅)
- `_shared/anthropic_tools.ts` — reverted to committed state (re-deployed ✅)

The bug persisted on Build 261 production AFTER the revert. This means the regression is **NOT from today's naavi-chat deploys** — it was already broken in the committed code.

### Where to look next

The speech "I didn't catch the place for that alert" is generated in **`hooks/useOrchestrator.ts` line 2939**:
```js
if (!placeName) {
  locationIntercepted = true;
  turnSpeechOverride = "I didn't catch the place for that alert. Can you say it again?";
  continue;
}
```

`placeName` comes from `action.trigger_config?.place_name` (line 2935). If it's empty, this fires.

This means Claude (Haiku) is calling `set_location_rule_address` WITHOUT a `place_name` value for "arrive home" phrasing. Or Claude is not calling the tool at all and the action is arriving without `trigger_config.place_name`.

**Hypothesis:** The phrase "arrive home" (without "at" or "to") doesn't trigger the tool call reliably. Claude emits `set_location_rule_address` but leaves `place_name` empty, OR the orchestrator receives a SET_ACTION_RULE action without the place populated.

**To investigate:**
1. Add a `console.log` at line 2935 to print `action.trigger_config` raw — what does Claude actually send?
2. Check Supabase Edge Function logs for `naavi-chat` — does it show the tool call happening? Does it show `place_name`?
3. Check `anthropic_tools.ts` `set_location_rule_address` tool definition — does it have examples for "arrive home" (no preposition)?

### What the "arrive TO home" variation requires

Separately, "alert me when I arrive TO home" (with "to") was failing on `mynaavidemo@gmail.com`. This was a secondary issue, also not fixed. Both bugs may have the same root cause.

---

## What was SHIPPED this session (committed + builds)

### Build 262 — Preview APK (NOT production AAB)
- versionCode 262, version "1.0.262", label "V57.58.1"
- `eas build --profile preview` — APK only, affects Wael's test devices only

### Commits shipped this session

| Commit | What |
|--------|------|
| `a8d9d3b` | Bump to build 262 (V57.58.1) |
| `945085d` | Alert title: use spoken place name instead of resolved address |
| `e2d2f67` | Compound queue: prevent speech override on SET_ACTION_RULE failure |
| `1885474` | Compound queue: skip Turn 2 for clarifying questions |
| `8818d8b` | Test: update list-connect and step1.5 tests |

### Server-side changes deployed (committed)

**`supabase/functions/manage-rules/index.ts`** (commit `e2d2f67` area):
- 23505 unique-constraint violation → returns `{ok: true, duplicate:true}` with HTTP 200 instead of 500
- Prevents compound queue speech from being overridden by a duplicate-rule insert

**`supabase/functions/get-naavi-prompt/index.ts`** — **NOT deployed, NOT committed**
- Has local formatting change to "capability question" section (numbered plain-text list instead of bold markdown)
- Was in prior session, no decision to deploy. Leave as-is until next session addresses it.

### Client-side changes (Build 262 APK only)

**`hooks/useOrchestrator.ts`:**
1. `formatLocationLabel()` helper — capitalizes spoken place name: "james's home" → "James's Home"
2. `commitPending` insert uses `formatLocationLabel(pending.placeName)` for alert title
3. Memory-hit insert also uses `formatLocationLabel(placeName)` for alert title
4. Compound queue guard: `isCompoundBatch` check prevents speech override when response starts with "On it."

---

## Test results

- Auto-tester: **327/327 green** (last run this session)
- Firebase Test Lab: NOT run this session (no production AAB)

---

## T3c — Voice regression suite item (reminder to note)

When "remind me about James's kids (Sam, Lila, wife Trayla) when I arrive to their home" runs as a compound queue:
- The REMEMBER for James's family info was NOT saved — only the location alert was created
- Wael asked to note this in T3c. Add to `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` as a compound queue item: REMEMBER action in compound batch not executing when paired with location alert

---

## State of repos

**Main repo** (`C:\Users\waela\OneDrive\Desktop\Naavi`, branch: `main`):
- Clean except `get-naavi-prompt/index.ts` local formatting change (uncommitted, not deployed — leave it)

**naavi-mobile** (`C:\Users\waela\naavi-mobile`): needs `git fetch origin && git merge origin/main` to pick up Build 262 commits before next build

**naavi-voice-server**: no changes this session

---

## Next session priorities

1. **Fix location alert regression** — "Alert me when I arrive home" broken on all builds/accounts. Investigate `naavi-chat` logs + `anthropic_tools.ts` tool description for "arrive home" phrasing
2. **Once fixed:** Build production AAB (requires auto-tester green + Firebase Test Lab)
3. **T3c note:** Add compound REMEMBER+location bug to holding list
4. **get-naavi-prompt formatting change:** Decide whether to deploy the capability question reformat
