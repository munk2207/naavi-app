# Session Handoff — 2026-06-03 | Build 228 | V227/228 Testing

---

## Status at Close

- **Build 227** — ✅ submitted to Google Play Internal Testing
- **Build 228** — ✅ submitted to Google Play Internal Testing  
- **Auto-tester** — 221/221 green
- **Staff portal** — fully working (OTP login, tickets, replies, close flow)

---

## What Shipped This Session

### Staff Portal (staff.mynaavi.com) — FULLY WORKING
- Login switched from magic link to 8-digit OTP code (fixes Gmail pre-fetch token burn)
- Postmark token rotated (security incident — old token was in handoff doc on GitHub)
- JWT expiry extended from 1hr to 8hrs
- Thread view: Customer → Naavi draft → Staff → Customer → Naavi (interleaved)
- Auto-detect close intent via Claude (not regex) — generates thank-you closing draft
- Ticket status: new → sent (auto on first staff reply) → closed (manual)
- Audit notice when ticket closed with no outbound reply
- Reply-To set to wael.aggan@gmail.com so customer replies land in Wael's inbox
- check-ticket-replies: dedup by message_id, search by subject only (no Support label required)
- dispatch-reanalyze-on-reply: rewrote to use DB replies instead of HubSpot API

### Mobile (Build 227)
- contact.tsx: routes Contact Support to ingest-ticket instead of Formspree
- lookup-contact: search MyNaavi community first, removed other-contacts fallback
- Briefing greeting by time of day: morning/afternoon/evening/night

### Mobile (Build 228)
- useOrchestrator: fall back to single address on contact (no typed address type label)
- useOrchestrator: merge tasks/list into existing alert at name-match level
- useOrchestrator: merge tasks/list into existing alert at coordinate level
- alerts.tsx: fix delete button stuck after first delete (track deletingId per-alert)

### Server-side (live, no AAB)
- lookup-contact: removed other-contacts fallback, MyNaavi community first
- resolve-entity-ref: personal keywords my office/home resolve via saved address
- resolve-entity-ref: strip label prefix for core matching (office alert fix)
- manage-rules: new merge_tasks operation for task merging via service_role
- get-naavi-prompt: No Frills brand name fix
- get-naavi-prompt: pronouns → contact name in place_name
- get-naavi-prompt: remind me when I arrive = location alert, no confirm-ask
- get-naavi-prompt: ADDING REMINDERS TO EXISTING ALERT rule
- get-naavi-prompt: list_connect disambiguation — "add a note" ≠ list_connect (PARTIAL — still failing)
- naavi-chat: pending_actions cross-turn queue (preserves actions across clarification turns)
- analyze-ticket: Claude-based close intent detection (strips quoted reply text)

---

## Open Bugs — Next Session Priority

### 1. ⭐ "Add note to alert" still routes to list_connect (CRITICAL)
**Symptom:** User says "Add a note to my Mercedes alert saying check brakes" → Claude attaches the "remember" list instead of adding a task.
**Root cause:** Claude equates "note" with the "remember" list (Naavi's notes ARE remember items). The prompt fix removed "add" from connect verbs but Claude still reaches list_connect via "note" = "remember list".
**Fix needed:** Much stronger prompt rule — "the word 'note' in 'add a note to an alert' is NEVER the remember list. It is free text that goes in action_config.tasks[]. list_connect requires an explicit list name."
**Files:** `supabase/functions/get-naavi-prompt/index.ts`
**No AAB needed.**

### 2. ⭐ Merge tasks silently fails in Build 228 (useOrchestrator still uses direct client)
**Symptom:** Merge fires, speech says "Got it — I've added...", but DB not updated.
**Root cause:** Build 228 useOrchestrator uses `supabase.from('action_rules').update()` directly — this silently fails. Fixed in the committed code (routes through manage-rules Edge Function) but needs Build 229 AAB.
**Files:** `hooks/useOrchestrator.ts` — already committed, needs AAB.

### 3. Delete button stuck after first delete — fixed in code, needs Build 229 AAB
**Symptom:** Second alert delete shows `...` (disabled).
**Fix:** Track `deletingId` per-alert instead of shared `deleting` boolean.
**Files:** `app/alerts.tsx` — already committed, needs AAB.

### 4. Confirm-before-resolve trust gap (location alerts)
**Symptom:** Naavi says "I'll alert you when you arrive at James's home. Say yes to confirm" BEFORE resolving the address. User says Yes. Then Naavi says "I don't have James's home address." Broken promise.
**Root cause:** Claude generates confirmation speech BEFORE orchestrator runs resolve-place. Order must be reversed.
**Documented in:** `project_naavi_deterministic_design.md` Principle #8
**Fix:** Architectural — orchestrator must resolve address first, THEN confirm. Significant work.

### 5. "Remind me at James home" — contact lookup finding wrong James
**Status:** Fixed — removed other-contacts fallback. James Stewart now found correctly.
**Remaining issue:** When user says "his home" (pronoun), possessive resolution fails. Prompt fix deployed. Needs more testing.

---

## Build 229 — Ready to Build
Changes committed, waiting for approval:
1. `app/alerts.tsx` — delete button fix (deletingId per-alert)
2. `hooks/useOrchestrator.ts` — merge via manage-rules Edge Function
3. `app/contact.tsx` — already in 228 (confirmed working)

**Pre-build checklist:**
- [ ] Fix "add note to alert" prompt issue (open bug #1 above)
- [ ] Run `npm run test:auto` — must be 221/221 green
- [ ] Bump versionCode to 229 in app.json
- [ ] Bump version text to V57.39.0 (build 229) in app/settings.tsx

---

## Staff Portal Open Items
- Postmark account approved ✅ — full email delivery working
- Debug bar removed ✅
- "remember" list incorrectly attached to Mercedes alert — needs manual cleanup:
  ```sql
  UPDATE action_rules SET action_config = jsonb_set(action_config, '{list_name}', 'null'::jsonb) 
  WHERE user_id = '788fe85c-b6be-4506-87e8-a8736ec8e1d1' AND label ILIKE '%mercedes%';
  ```
  Or simpler: ask Naavi to "remove the remember list from my Mercedes alert"

---

## Repos
- Mobile app: `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: main)
- Website: `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website` (branch: main)
- Staff portal: `C:\Users\waela\OneDrive\Desktop\naavi-staff` (branch: main)
- Voice server: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server` (branch: main)
- Build clone: `C:\Users\waela\naavi-mobile` (branch: main)

---

## Voice Parity — Next Dedicated Session
See drift audit in previous message. Priority items:
1. DELETE_RULE + LIST_RULES missing on voice
2. TTS normalization missing on mobile (B4f)
3. Location alert merge not ported to voice
4. Stop-word regression ("Naavi stop" doesn't interrupt TTS)
