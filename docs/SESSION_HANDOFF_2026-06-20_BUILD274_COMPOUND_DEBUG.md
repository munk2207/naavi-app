# Session Handoff — 2026-06-20 — Build 274 / Compound Debug

## Status at session end

All 5 production gates remain suspended (Wael decision). Debugging mode active.

---

## What shipped this session

### Build 272 (already on Play)
- **manage-rules 23505 merge** — tasks/list_name merged into existing rule on duplicate datetime conflict
- **Alert context enabled filter** — `naavi-chat` alert context query now filters `enabled=true` only (deleted/disabled alerts no longer visible to Claude)

### Build 273 (on device, installed)
- **Bug 1 attempt** — `advanceCompoundQueue()` marks unconfirmed DRAFT_MESSAGE as `_discarded: true` before advancing. BUT this only covers PATH A (server-side compound queue). PATH B auto-advance (useEffect → `send(nextItem)` directly) was NOT covered. Bug 1 still fails visually.
- **Bug 2 server-side fix** — `naavi-chat` now detects "remind me N days/one day before her/his graduation/birthday" pattern BEFORE calling Haiku. Searches calendar server-side, filters by event type keyword, calculates reminder date, returns PENDING_INTENT confirm response directly. On "yes" → SET_REMINDER executes via Step 1.4 → writes to `reminders` table. **PASSED** — "I found Jasmine's graduation on your calendar June 23rd. That means I'll remind you to call her on June 22nd at 9:00 AM."

### Edge Functions deployed (no build needed)
- `naavi-chat` — before-event server-side handler (multiple iterations to fix regex + result field)

---

## Build 274 — COMMITTED BUT NOT PUSHED/BUILT YET

**One uncommitted change ready to push:**

File: `hooks/useOrchestrator.ts` lines ~4452-4461  
Change: Added `setTurns` discard call in the PATH B auto-advance useEffect, right before `send(nextItem)`:

```typescript
// Discard any unconfirmed draft cards from prior turns before advancing
setTurns(prev => prev.map(t => ({
  ...t,
  drafts: (t.drafts ?? []).map((d: any) =>
    d.type === 'DRAFT_MESSAGE' && !d._voiceConfirmed ? { ...d, _discarded: true } : d
  ),
})));
send(nextItem);
```

Also bumped: `app.json` → v1.0.274 / versionCode 274, `app/settings.tsx` → V57.59.9 (build 274)

**These changes are committed locally but NOT pushed. Next session should `git push origin main` then sync naavi-mobile and build.**

---

## Compound question — current state

### What works
- Jasmine graduation reminder (Bug 2) ✅
- Compound queue detects multiple items correctly
- Individual items work standalone

### What's broken — 3 patterns observed in testing

**1. RULE 23 clarification loops stall the queue**
When a compound item requires clarification (e.g. "remind me on Monday to go to gym" → STT hears "Jim" → Naavi asks "do you mean Jim's place or call Jim?"), the compound queue doesn't pause. It either stalls or auto-advances, losing context. Result: clarification never resolves, item never executes.

**2. Items re-asked after queue completes**
Naavi re-introduces items already processed in a prior compound pass. Likely the compound items list isn't being cleared cleanly between runs.

**3. Draft cards persist during compound flow (Bug 1)**
Email draft for Sarah still shows live Send/Discard when Naavi advances to item 2+. Build 274 fix (PATH B auto-advance) should resolve this but hasn't been built yet.

### Root cause (established last session)
RULE 23 (2-turn confirm per action) races with compound auto-advance. When Naavi stops to ask a clarification within an item, the compound queue doesn't know to pause — it treats the clarification turn as a completed item and moves on.

### Proposed fix — [COMPOUND-ITEM N of M] tag approach
Add a tag in the compound item prompt so Claude knows it's inside a compound flow and should NOT ask clarification questions mid-item. Each compound item is sent as:

```
[COMPOUND-ITEM 2 of 5] Remind me on Monday to go to gym
```

The prompt rule: when a message starts with `[COMPOUND-ITEM N of M]`, skip per-item RULE 23 confirm. Commit to the best-effort interpretation and emit the action directly. If truly ambiguous, pick the most literal reading rather than asking.

This bypasses the RULE 23 confirm race entirely for compound sub-items.

**Implementation scope:** `get-naavi-prompt` (add the rule), `useOrchestrator.ts` PATH B auto-advance (prepend the tag to each nextItem before calling `send()`), regression tests.

---

## Files touched this session

| File | Change |
|------|--------|
| `supabase/functions/naavi-chat/index.ts` | before-event regex + server-side handler + data.ranked fix |
| `supabase/functions/manage-rules/index.ts` | 23505 merge (build 272) |
| `hooks/useOrchestrator.ts` | PATH A + PATH B draft discard; 23505 merge (build 272) |
| `app/index.tsx` | DraftCard `_discarded` useEffect sync |
| `app.json` | v1.0.274 / 274 |
| `app/settings.tsx` | V57.59.9 (build 274) |

---

## Next session: Debug compound question

**Step 1:** Push build 274 and build it:
```
git push origin main
cd C:\Users\waela\naavi-mobile
git fetch origin && git merge origin/main
npx eas build --platform android --profile production --auto-submit --non-interactive
```

**Step 2:** Test Bug 1 on build 274 — Sarah email card should now show "✕ Draft discarded" when compound advances past it.

**Step 3:** Implement [COMPOUND-ITEM N of M] tag fix:
1. `get-naavi-prompt` — add rule: when message starts with `[COMPOUND-ITEM N of M]`, skip clarification questions, pick literal interpretation, emit action directly
2. `useOrchestrator.ts` PATH B auto-advance — prepend tag: `send(\`[COMPOUND-ITEM ${idx} of ${total}] ${nextItem}\`)`
3. Add regression tests
4. Build + test full compound flow

**Test compound question for full pass:**
> "Draft an email to Sarah asking for budget review, add a meeting with Bob on Monday at 11 AM to discuss summer plans, remind me on Monday to go to the gym, send me my work list when I arrive at my office, remind me to call Jasmine one day before her graduation"

Expected: all 5 items execute cleanly without clarification loops, email card auto-discards.
