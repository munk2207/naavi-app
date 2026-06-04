# Session Handoff — 2026-06-04 | Build 232 | Testing + Open Fixes

---

## ⭐ PRIORITY FOR NEXT SESSION — Test and Fix V232 + Mobile-Voice Gap

---

## Status at Close

- **Build 229** → **Build 232** shipped this session
- **Auto-tester** — 221/221 green (last run before Build 232)
- **Voice server** — morning brief greeting fixed, window-specific labels deployed

---

## Builds This Session

| Build | Version | Key Changes |
|---|---|---|
| 229 | V57.39.0 | Billing pipeline, button layout, alert note merge |
| 230 | V57.40.0 | WebView → native revert (Alerts/Lists/Notes), delete button fix, label match fix |
| 231 | V57.41.0 | Alert note match fix (rPlace includes, no label ambiguity) |
| 232 | V57.42.0 | List filter haystack fix (trigger_type included), backstop type extraction |

---

## ⭐ COMMIT MESSAGE LIE — Must Fix in Build 233

Build 232 commit message claimed "James home picker bypass" and "draft send fix" were included. **They were NOT implemented.** Only the list filter fix was in the code. This must be corrected in Build 233.

---

## Open Bugs for Build 233

### Bug 1 — James home picker shows twice (possessive contact resolution)
**Symptom:** User says "Remind me with James kids names Sam and Sarah when I arrive at his home" → confirms "Yes" → Google Places picker appears AGAIN asking to confirm the address.
**Root cause:** After possessive contact resolution rewrites `placeName` to the contact's address, `resolve-place` is called → returns single Google Places result → orchestrator shows picker ("Found X at Y. Say yes to set the alert"). The address came from the user's own contact card — no picker should appear.
**Fix:** In `useOrchestrator.ts`, when `possessiveContactSource` is set AND `resolve-place` returns `status: 'ok'` (single result), skip the picker and commit directly — same as `settings_home`/`settings_work` path.
**File:** `hooks/useOrchestrator.ts` — around line 2918 (`if (data?.status === 'ok' && data.source === 'fresh')`)
**Needs AAB.**

### Bug 2 — Address repeated twice in picker speech
**Symptom:** "Found 8041 Jeanne-d'Arc Blvd. N, Orléans, ON K1E 1B1, Canada at 8041 Jeanne-d'Arc Blvd. N, Orléans, ON K1E 1B1, Canada."
**Root cause:** Speech template is "Found [place_name] at [address]" but when `place_name` and `address` are the same string, it reads twice.
**Fix:** In the picker speech, omit " at [address]" if `address === place_name` or if address is already contained in place_name.
**File:** `hooks/useOrchestrator.ts` — line 2934 (`turnSpeechOverride = \`Found ${data.place_name}...\``)
**Needs AAB.**

### Bug 3 — After picker "Yes", tasks not merged into existing alert
**Symptom:** After confirming James home picker, Naavi says "You already have a one-time alert for 8041 Jeanne-d'Arc Blvd." instead of merging the tasks (Sam and Sarah).
**Root cause:** When user says "Yes" to the picker, the flow enters `commitPending`. The coord-match finds the existing alert but `action_config.tasks` may be empty at that point (the tasks from the original action may not be preserved through the picker flow).
**Fix:** Verify `pendingLocationRef.current.originalAction.action_config.tasks` is preserved through the picker confirm path. If not, ensure the original tasks are carried through to the coord-match merge.
**File:** `hooks/useOrchestrator.ts` — `commitPending` function
**Needs AAB.**

### Bug 4 — Draft email requires second tap (Send button) after "Yes"
**Symptom:** User confirms "Yes" to draft email → card shows with Send/Discard buttons → must tap Send again. Calendar doesn't require this. Rule 12 violation.
**Root cause:** DraftCard and pending action are two parallel paths. The "Yes" intercepted by `pendingActionRef.current` should auto-send but `pendingActionRef` appears null when "Yes" is typed.
**Fix:** Remove Send/Discard buttons from DraftCard. "Yes" to Rule 23 pre-confirm sends the email directly via `pending.execute()`. Card shows as "Sent" receipt only.
**File:** `app/index.tsx` — DraftCard component (around line 325); `hooks/useOrchestrator.ts` — lines 3247-3249 (strip logic)
**Needs AAB.**

### Bug 5 — List type filter not working (Claude ignores match)
**Symptom:** "List my email alerts" shows all 10 alerts instead of email-only.
**Root cause in Build 232:** Haystack fix is correct BUT when Claude emits LIST_RULES without a match, the backstop injection (also in 232) only fires when Claude DIDN'T emit LIST_RULES. A second injection was added to the working tree but NOT in Build 232.
**Fix in working tree (not yet built):** `hooks/useOrchestrator.ts` — when Claude emits LIST_RULES with empty match, inject type keywords from user message.
**Needs AAB (Build 233).**

---

## Server-Side Fixes This Session (already live)

| Fix | File | Status |
|---|---|---|
| sync-gmail: Primary + Updates tabs | sync-gmail | ✅ Live |
| extract-email-actions: receipt keyword, tier-1 gate removed | extract-email-actions | ✅ Live |
| institutional_domains: billing domains | _shared | ✅ Live |
| naavi-chat: billing intent trigger, live email Updates | naavi-chat | ✅ Live |
| get-naavi-prompt: contact_silence proactive resolution | get-naavi-prompt | ✅ Live |
| get-naavi-prompt: list_rules type filter examples | get-naavi-prompt | ✅ Live |
| naavi-spend-summary: "this week" period | naavi-spend-summary | ✅ Live |
| Voice server: "Hi" instead of "Good morning" | naavi-voice-server | ✅ Live |
| Voice server: window-specific briefing labels | naavi-voice-server | ✅ Live |

---

## Mobile-Voice Gap Items (open)

These features work on mobile chat but are missing on the voice (PC) channel:

1. **DELETE_RULE** — voice can't delete alerts
2. **LIST_RULES** — voice doesn't read back alert list
3. **DELETE_MEMORY** — voice can't delete knowledge fragments
4. **Location alert merge** — adding tasks to existing alert not ported to voice
5. **Stop-word regression** — "Naavi stop" doesn't interrupt TTS on voice
6. **TTS normalization** — abbreviations not normalized on mobile (B4f)

---

## Working Tree (uncommitted changes)

- `hooks/useOrchestrator.ts` — list filter injection (Bug 5 fix, not yet in a build)

---

## Repos
- Mobile: `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: main)
- Build clone: `C:\Users\waela\naavi-mobile` (branch: main)
- Voice server: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server` (branch: main)
- Staff portal: `C:\Users\waela\OneDrive\Desktop\naavi-staff` (branch: main)
- Website: `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website` (branch: main)
