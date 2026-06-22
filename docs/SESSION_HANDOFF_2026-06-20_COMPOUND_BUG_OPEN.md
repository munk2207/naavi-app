# SESSION HANDOFF — 2026-06-20
## Build 271 shipped. Compound question bug OPEN — 3 failed fix attempts.

---

## CURRENT BUILD

- **Production AAB**: v271 (versionCode 271) — built and auto-submitted to Google Play Internal Testing
- **EAS build ID**: `46c4be9c-fc87-4c43-892d-c444094fcf18`
- **Git**: `main` at commit `86c6d46` — `chore: bump to build 271`
- **Prompt version**: `2026-06-20-v128-compound-emit-now` — deployed to Supabase

---

## THE OPEN BUG — COMPOUND QUESTION RE-NARRATION (PRIORITY #1)

### What the bug looks like (tested live on v271 by Wael, 2026-06-20)

User asks a compound request (6 items):
1. Draft email to Sarah — budget review
2. Add meeting with Bob to calendar — Monday 11 AM
3. Remind Sunday to prepare
4. Attach work list to office arrival alert
5. Remind call Jasmine one day before her birthday (Jun 22 at 9 AM)
6. Ask where to be reminded about James's kids names

**Turn 1 — Naavi:** presents numbered list, says "Say yes to go ahead or no to cancel."
**Turn 2 — User:** "Yes"
**Turn 3 — Naavi (BUG):** Re-narrates ALL 6 items again ("On it, first I'll draft an email to Sarah... Next, I'll add meeting with Bob... Next..."), then says "Say yes to send or tell me what to change."
**Turn 4–N:** User must say "yes" multiple times; between steps "yes" does nothing, user has to say something unrelated to unstick it.
**Result:** Only 2 of 6 items actually executed. "All done. Two of two."

### Three fix attempts — all failed

| Attempt | What was tried | Why it failed |
|---------|---------------|---------------|
| 1 — Client race guard (prior session) | Check `compoundQueueRef.length > 0` when "yes" arrives; skip sending to Claude | `compoundQueueRef` was empty (Claude emitted no actions in turn 1 — only text) |
| 2 — Prompt v128 | Rewrote RULE 24 with ⚠️ markers, WRONG/CORRECT examples, explicit "no two-step" rule | Claude's training overrides the prompt rule — re-narration continues |
| 3 — Code injection (v271) | Detect compound pre-confirm + affirmative → inject `[SYSTEM — EXECUTE NOW]` into enrichedMessage before sending to Claude | Claude still re-narrates despite the injected directive |

### Root cause (confirmed)

Claude is executing a **two-step pre-confirmation pattern** that the code never designed for:
- Claude turn 1: present numbered list, ask "say yes" → emits **ZERO tool calls**
- User: "yes"
- Claude turn 3: re-narrates the whole list AGAIN, then starts executing one item
- Each subsequent "yes" goes back to Claude (not the client queue), because `compoundQueueRef` is empty

The compound queue was designed for Claude to **emit all tool calls in turn 1**, with the client showing each confirmation card one at a time (RULE 23 gate). Claude broke this by inventing an extra pre-confirmation layer.

### What to try next session

**Approach: Remove the compound pre-confirmation from the prompt entirely.**

Reasoning: RULE 12 already requires Naavi to pre-confirm every state-changing action via a confirmation card. The compound-level "say yes to go ahead for all 6" is a Claude invention that conflicts with the card-based system.

**Prompt change needed in `get-naavi-prompt/index.ts`:**

Remove / rewrite RULE 24 so that for compound requests, Claude:
1. Says a brief speech summary ("I'll take care of these six things.")
2. Emits ALL tool calls in the same response — no "say yes to go ahead" first
3. The client shows each card one at a time — user confirms or skips each
4. Claude NEVER presents a pre-numbered list and waits for a global "yes"

**The confirmation gate (RULE 12 / RULE 23) stays** — it still applies at the individual action level via the card system. The compound-level confirmation is redundant and broken.

**Also consider:** Check whether the `isCompoundPreConfirm` regex in `useOrchestrator.ts` is matching correctly. Add a remote log to confirm the intercept fires. If it does fire and Claude still re-narrates, the prompt approach above is the only remaining lever.

**File to edit:** `supabase/functions/get-naavi-prompt/index.ts` — RULE 24 section
**Deploy:** `npx supabase functions deploy get-naavi-prompt --no-verify-jwt --project-ref hhgyppbxgmjrwdpdubcx`
**Test WITHOUT building new APK** — prompt changes are server-side, take effect immediately on current v271 install.

---

## MAESTRO — GATE 3 STILL SUSPENDED

### Status
Gate 3 (Maestro) remains suspended. Root cause confirmed this session:

- `clearState: true` in `00-sign-in.yaml` forces a fresh Google OAuth
- Preview APK SHA-1 is NOT registered in Google Cloud OAuth for `mynaavidemo@gmail.com`
- OAuth fails → flow 00 fails → all 18 flows fail (18/18 failed this session)

### What was tried this session
- Switched `00-sign-in.yaml` from Test Lab Sign In button (`firebase-testlab@mynaavi.com`) to Google OAuth for `mynaavidemo@gmail.com`
- Result: 0/18 pass (worse than before — previously Test Lab button gave 10/18)

### What `00-sign-in.yaml` currently contains
Google OAuth flow with `clearState: true` — this will always fail until SHA-1 is registered.

### Fix options (choose one next Maestro session)
1. **Register preview APK SHA-1** in Google Cloud OAuth for `mynaavidemo@gmail.com` → `clearState: true` flows work
2. **Restore Test Lab button** (`firebase-testlab@mynaavi.com`) → 10/18 pass, 8 data-dependent flows fail
3. **Take new emulator snapshot** with `mynaavidemo@gmail.com` signed in → remove `clearState: true` from flow 00 → all flows inherit that session

Gate 3 suspension remains in effect. Gates 1 and 2 (auto-tester + voice regression) are the only mandatory gates before production builds.

---

## AUTO-TESTER

353/353 green as of this session. No regressions introduced.

---

## WHAT WAS SHIPPED THIS SESSION

| Item | Status |
|------|--------|
| Prompt v128 (RULE 24 rewrite, compound-emit-now) | Deployed to Supabase |
| Client-side compound pre-confirm intercept | In v271 (`hooks/useOrchestrator.ts`) |
| `00-sign-in.yaml` — Google OAuth for mynaavidemo | Committed (but not working — see Maestro section) |
| Version string test fixes (session-2026-05-27, session-2026-05-28) | Committed |
| Build 271 | Built + auto-submitted to Google Play Internal Testing |

---

## NEXT SESSION PRIORITY

1. **Fix compound question bug** — prompt approach (remove compound pre-confirmation, emit all tool calls in turn 1)
2. Test WITHOUT new build first (prompt is server-side)
3. If prompt fix works → build v272
4. Maestro fix is separate session (Gate 3 remains suspended)
