# Session Handoff — 2026-06-11
## Re-arm + Note Fix (B6a, B6g, soft-delete) — 251/251 tests green

---

## What was done this session

### New bug (unnamed) — soft-delete alerts instead of hard-delete
**Found by Wael** at the start of the session. Disabling an alert from the Alerts screen was removing the row entirely — it should stay greyed with a Reactivate button.

**Fix (mobile + server):**
- `supabase/functions/manage-rules/index.ts` — added `op: 'deactivate'` handler: sets `enabled=false`, returns `{ ok: true }`. Already-existing `op: 'reactivate'` stayed untouched.
- `app/alerts.tsx` — `confirmDelete` changed from `op: 'delete'` → `op: 'deactivate'`. State update changed from `.filter()` (removes row) → `.map()` (sets `enabled: false`, row stays greyed). Modal title/text updated: "Disable alert?" + "You can reactivate it any time."
- Ships with next AAB.

---

### B6a + B6g — Voice re-arm expired location alert + missing coordinates

**Root cause:** voice server had no equivalent of the mobile `reArmLocationRule` flow. When user named an expired alert, the memory-hit check used exact string match (failed on "Canadian Tire" vs "Canadian Tire Innes"), fell through to `resolve-place`, and created a duplicate rule without coordinates.

**Fixes shipped to voice server (Railway auto-deployed):**

1. **Substring match** — memory-hit check changed from exact to substring:
   ```javascript
   rPlace === spokenLower || rPlace.includes(spokenLower) || spokenLower.includes(rPlace)
   ```

2. **`pendingRearm` state** — when an expired (disabled) alert is found by name, Naavi says "Your X alert is expired. Want me to re-enable it?" — on "yes": calls `manage-rules reactivate`, then PATCHes `action_config` with the merged note from the new request.

3. **`pendingNoteUpdate` state** — when an ENABLED alert is found and the new request includes a different body ("saying Y"), Naavi says "You already have a one-time alert for X. Want me to update the message to 'Y'?" — on "yes": PATCHes `action_config.body` only.

4. **Prompt fix** — added two "saying X → action_config.body" examples to `get-naavi-prompt/index.ts`:
   - `"Alert me when I arrive at Costco saying pick up milk"` → `action_config={body:'Pick up milk.'}`
   - `"Notify me at Home Depot saying grab paint brushes"` → `action_config={body:'Grab paint brushes.'}`

5. **Mobile re-arm note fix** — `reArmLocationRule` in `hooks/useOrchestrator.ts` now accepts `action_config` in its `updates` param and merges new body over existing config in the DB update. Both picker call site and resolve-place call site updated to pass `action_config`. Ships with next AAB.

**Tested by Wael 2026-06-11:** voice correctly recognized expired Canadian Tire alert, offered re-arm, applied note on confirmation. Note update on already-enabled alert: offered update, patched body.

---

## Commits this session (main repo)

| Commit | Description |
|--------|-------------|
| `306e5c3` | fix re-arm — new note/body from action_config now applied when re-arming expired location alert |
| `9a86660` | prompt: add 'saying X' examples for location alerts — X goes in action_config.body |
| `7a4fa09` | voice: offer to update note on already-enabled location alert (test) |
| `0bfc074` | holding list — close B6a + B6g (voice re-arm + missing coords, tested 2026-06-11) |
| `5608146` | session sync — 251/251 tests green, voice note-update deployed |
| (earlier) | `fix re-arm — new note/body` + `soft-delete alerts` + `B6h` |

Voice server commits (auto-deployed to Railway):
- `ebebd81` — pendingRearm + substring match
- `30cdf5d` — note merge on re-arm (PATCH action_config)
- `eb602bd` — pendingNoteUpdate: offer to update note on enabled alert

---

## Test count

**251/251 green** as of end of session.

New tests added this session:
- `soft-delete.manage-rules-has-deactivate-op`
- `soft-delete.alerts-screen-calls-deactivate-not-delete`
- `soft-delete.alerts-screen-keeps-row-on-disable`
- `soft-delete.modal-text-updated`
- `rearm.action-config-param-present`
- `rearm.picker-callsite-passes-action-config`
- `note-update.pending-note-update-state-declared`
- `note-update.enabled-branch-offers-update`

---

## Bugs closed this session

| ID | Description | How |
|----|-------------|-----|
| B6h | TRUST BREACH — DELETE_RULE says "Done" but alert not deleted | Pre-Claude intercept + confirm gate (from prior session, closed this session) |
| B6a | Re-arm expired location alert — mobile orchestrator + voice server | Both surfaces fixed and tested |
| B6g | Voice location alert missing coordinates | Resolved by B6a fix (memory-hit intercepts before picker/resolve-place) |
| (soft-delete) | Disabling alert removed it from list entirely | op=deactivate, row stays greyed |

---

## Open bugs remaining (in priority order for next session)

From `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`:

| ID | Description | Surface | Server/AAB |
|----|-------------|---------|------------|
| B7b | Voice bare-name transcription → hallucination (Deepgram drops leading verb, bare name falls to Claude) | voice | Server |
| B7a | Duplicate `client_diagnostics` log events — every event fires twice | mobile | AAB |
| B7c | Homepage storyboard iframes not running | website | Server |
| B6i | Universal confirm-before-act gate (3-5 hr dedicated session) | both | Both |

---

## Next session instructions

**Read first:** this file + `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`.

**Goal:** work bugs from holding list one at a time. Start with B7b (voice, server-only, no AAB needed).

**Rules:**
- No code changes without explicit authorization.
- No AAB build until all mobile fixes accumulated and Wael says build.
- `npm run test:auto` 100% green before any build.
- Firebase Test Lab before any production AAB.

**Pending mobile changes that need AAB (accumulate these, build once):**
- Soft-delete alerts (`op: 'deactivate'`, modal text, row stays greyed)
- Re-arm note fix in `reArmLocationRule` (`action_config` merge)
- B6h pre-Claude delete-intent intercept
- B3z OAuth refresh_token fix (`318e522` / `lib/calendar.ts:154`)
- B4f TTS address normalization (`sanitiseForSpeech`)
- B6c keyboard flicker fix (`app.json` "resize" + KAV disabled)

**B7b fix path (voice server `naavi-voice-server/src/index.js`):**
When STT returns a single-token result that looks like a name (no verb, no question word), route to phone-operator confirmation: "Did you mean to call or find [name]?" instead of calling Claude. The bare-name pattern fires when Deepgram drops the leading verb ("find Fatma" → "Fatima."). See B7b entry in holding list for full detail.
