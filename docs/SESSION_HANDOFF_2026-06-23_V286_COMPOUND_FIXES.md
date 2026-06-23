# Session Handoff — 2026-06-23 — V286 Compound Fixes

## Status
**Staging deployed and working** (simple questions confirmed passing).
**V286 APK built** — download: https://expo.dev/artifacts/eas/6sX7Ha1F34k6B19Ol1zmmHDtOIuVe3UGOdCURTgPtbg.apk
**Production NOT promoted** — V286 staging testing incomplete.

---

## What Was Shipped This Session (all staging only)

### Server-side fixes (naavi-chat + manage-list + manage-rules)
1. **Compound 500 fix** — `delete claudeParams.tools` on compound turns instead of `tool_choice:none` (unsupported on Haiku 4.5)
2. **Jasmine date fix** — `resolveBeforeEventDate` uses `metadata.start_time` before `createdAt` so calendar event date is used, not DB row creation date
3. **Compound confirm date injection** — scans back for original compound message, runs `resolveBeforeEventDate` on it before confirm turn executes
4. **Count auto-correct** — server post-processes compound planning response and fixes the header count to match actual numbered lines
5. **No auto contact save** — confirm rule 8: `ADD_CONTACT` only on explicit "save contact" request; "Book a meeting with Bob" = `CREATE_EVENT` only
6. **List item dedup (manage-list)** — `LIST_ADD` normalizes before dedup to prevent "Sam and Lila" vs "Sam, Lila" duplicates
7. **Notes dedup (manage-rules)** — `merge_tasks` normalizes task strings before dedup

### APK fixes (V286)
1. **Delete alert button** — shows "Delete" for enabled alerts, "Disable" is gone (fixed `app/alerts.tsx`)
2. **Compound scroll-to-top** — fires on planning turn too, not just result turn
3. **List item deletion** — tap to select items (red highlight + checkmark), "Delete N items" button, calls `manage-list LIST_REMOVE`

---

## ONE OPEN BUG — Compound planning drops Jasmine

**Symptom:** User sends 8-line compound message. The planning turn (breakdown) consistently shows 7 items — "Remind me to call Jasmine one day before her Graduation" is dropped. The confirm turn DOES create Jasmine's reminder correctly (reads original message), but the planning display misses her.

**Root cause identified:** When Jasmine's line appears immediately before the James line ("Remind me with James kids names..."), Haiku clusters them and drops Jasmine. This is a systematic Claude behavior, not a random drop.

**Second root cause identified (NEW):** When Jasmine's line is moved to a different position in the message, the Level A early-return handlers (SET_REMINDER pattern matcher) fire on "Remind me to call Jasmine one day before her Graduation" BEFORE compound detection runs. The function returns a single-reminder confirmation, never reaching the compound code.

**Fix needed:** Add `if (_isEarlyCompound) { /* skip this handler */ }` guards at specific Level A early-return points. Do NOT use a do-while wrapper — it skips variable definitions (`augmentedMessages`, `cachedSystem`) that are declared inside the section.

**Where to add the guard:** Look for the Section A handlers that deal with SET_REMINDER, date-before patterns, and resolveBeforeEventDate. Each one needs:
```ts
if (_isEarlyCompound) { /* fall through to compound */ }
else {
  // existing handler code
  return jsonResponse(...);
}
```

`_isEarlyCompound` is already defined at the top of the section:
```ts
const _earlyNonEmptyLines = userText.split('\n').filter((l: string) => l.trim().length > 8);
const _isEarlyCompound = _earlyNonEmptyLines.length >= 4;
```

---

## Current State of compound prompt (V284 original — restored)

```
[COMPOUND REQUEST — planning turn, NO tool calls allowed]
Start your response with exactly this line: "Here are your [N] actions:" ...
Then output a numbered list — ONE line per action the user EXPLICITLY requested.
STRICT RULES:
- Only include actions the user directly asked for.
- Do NOT add contact saves...
- Do NOT duplicate actions...
- NEVER combine two separate user requests into one numbered item... 
  "Remind me to call X one day before Y" AND "Remind me with Z's information 
  when I arrive at their home" are ALWAYS two separate items.
- The count in the header MUST match the number of items.
After the last item: "Say yes to confirm all, or no to cancel."
```

---

## Next Session Priority

1. **Fix compound Level A guard** — add `_isEarlyCompound` check at specific SET_REMINDER early-return handlers (NOT do-while wrapper)
2. **Retest compound** with the same 8-item message
3. **If compound passes** → run Gate 1 (`npm run test:auto`) + Gate 2 (voice regression) → production AAB

## Test Command
```
npx supabase functions deploy naavi-chat --no-verify-jwt --project-ref xugvnfudofuskxoknhve
```

## V286 APK
Already built and available at the URL above. No need to rebuild unless code changes.
