# Session Handoff — 2026-06-15 — B2m Parity Audit (Build 254 baseline)

## What shipped this session (voice server only — no new AAB)

### Voice gap: Re-arm expired location alert (High — CLOSED)
- **Problem:** 4 paths in `naavi-voice-server/src/index.js` said "Open the mobile app, go to Alerts, and tap Reactivate" when `commitLocationRule` returned `already_exists_expired`.
- **Fix:** All 4 paths now set `pendingRearm` and ask "Want me to re-enable it?" inline — same as mobile B6a behaviour.
- **Commits:** `0a42ffa` (voice), `1bfedf7` (tests)
- **Tests:** `voice.rearm.no-mobile-app-bail-out`, `voice.rearm.pendingRearm-set-on-expired` (306/306 green)

### Voice gap: LOG_CONCERN + UPDATE_PROFILE missing handlers (Medium — CLOSED)
- **Problem:** Both actions fell through to Claude with no DB write.
- **Fix:** Two new `else if` cases in voice server action loop — POST to `topics` table via REST API, matching mobile's `saveTopic()`.
- **Commits:** `fe82638` (voice), `cac7be7` (tests)
- **Tests:** `voice.parity.log-concern-handler-present`, `voice.parity.update-profile-handler-present` (306/306 green)

### Parity audit corrections (no code change)
- `SPEND_SUMMARY`: confirmed already handled in voice (line 10082) — prior audit entry was stale.
- Source-hint filtering: accepted, no action — answer identical either way.
- Parity doc updated: `docs/MOBILE_VS_VOICE_PARITY_AUDIT_2026-06-12.md`

## Auto-tester status
306/306 green (last run 2026-06-15)

## Next session focus: Configure briefing time via chat (both surfaces)

### The problem
`UPDATE_MORNING_CALL` voice handler writes to legacy `morning_call_time` column only.
`trigger-morning-call` Edge Function ignores `morning_call_time` for any user who has `brief_windows` set (i.e. opened the web Briefings page). So the voice action silently does nothing for those users.
Mobile has NO handler at all — action falls through to Claude with no DB write.

### The design (agreed 2026-06-15)
- Keep action shape unchanged: `{ type: "UPDATE_MORNING_CALL", time: "14:00", enabled: true }`
- Server-side: derive the window from `action.time` using brief-logic thresholds:
  - before 11:00 → `morning`, before 15:00 → `midday`, before 20:00 → `evening`, else → `night`
- Write to `brief_windows[window]` (new system) AND update legacy columns (fallback for users without brief_windows)
- Update voice server handler + add mobile handler in same session
- AAB required for mobile side

### Files to touch
- `naavi-voice-server/src/index.js` — `case 'UPDATE_MORNING_CALL'` around line 4840
- `hooks/useOrchestrator.ts` — add `else if (action.type === 'UPDATE_MORNING_CALL')` after line 2760
- `supabase/functions/get-naavi-prompt/index.ts` — confirm RULE 9 wording matches multi-window reality (may need minor update)
- `tests/catalogue/session-2026-06-15.ts` (or new file) — regression tests for both surfaces

### brief_windows JSONB shape (from trigger-morning-call source)
```json
{
  "morning": { "enabled": true, "time": "08:00", "channels": ["sms", "voice_call"] },
  "midday":  { "enabled": false, "time": "12:00", "channels": [] },
  "evening": { "enabled": false, "time": "17:00", "channels": [] },
  "night":   { "enabled": false, "time": "21:00", "channels": [] }
}
```
Handler must PATCH only the relevant window key — not overwrite the full object.
Use Supabase `jsonb_set` or read-modify-write pattern.

## Carry-forward from prior sessions
- B7d: Show task_actions participant SMS recipients in Alerts screen card UI (next AAB)
- B7d: Remove `saveReminder()` at `hooks/useOrchestrator.ts:2699` + calendar event block at lines 2701-2714 (next AAB)
- Settings: `pushEnabled` mount check — always shows "Enable" even when subscription exists (next AAB)
- CLAUDE.md: remove "voice call only for location arrival" outdated restriction comment
