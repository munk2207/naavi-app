# Session Handoff — 2026-06-04 | Build 229 | V229 Bug Review

---

## ⭐ MAJOR TASK FOR NEXT SESSION — Review and Fix V229 Open Bugs

Build 229 was installed and tested. Several bugs were found still open or newly discovered. These must be addressed before Build 230.

---

## Status at Close

- **Build 229** — ✅ submitted to Google Play Internal Testing
- **APK 229** — ✅ available at https://expo.dev/accounts/waggan/projects/naavi/builds/f336cd41-322b-4a92-8338-4b65273ab3e8
- **Auto-tester** — 221/221 green
- **Server-side fixes** — all deployed and live

---

## What Shipped This Session

### Server-side (live, no AAB needed)
- `sync-gmail` — now syncs Primary + Updates tabs (fixes billing receipts never being picked up)
- `sync-gmail` — tier-1 is now a ranking signal, not a processing gate
- `extract-email-actions` — added receipt/charge keywords; removed tier-1 hard gate
- `_shared/institutional_domains.ts` — added billing domains (anthropic.com, stripe.com, paypal.com, etc.)
- `naavi-chat` — billing intent pipeline trigger (`BILLING_INTENT_RE`); live email fetch covers Updates tab
- `get-naavi-prompt` — "add note to alert" disambiguation; "this week" period label; "remember" list not a note
- `naavi-spend-summary` — "this week" period resolution (Monday of current week → today)

### Mobile (Build 229)
- `alerts.tsx` — delete button fix: `deletingId` per-alert instead of shared boolean
- `useOrchestrator.ts` — merge tasks via manage-rules Edge Function (service_role, fixes silent RLS failure)
- `useOrchestrator.ts` — label-match extended to include `label` field for add-note-to-alert
- `useOrchestrator.ts` — spend_summary wording: "invoices" → "charges"; "this week" phrase
- `index.tsx` — bottom buttons space-between fix (REVERTED — see open bugs)

---

## ⭐ V229 Open Bugs — Fix All Before Build 230

### Bug 1 — Delete button stuck on 2nd delete (CRITICAL)
**Symptom:** First delete in a session works. Every subsequent delete — the confirmation card's Delete button is already grayed out when the card opens.
**Investigation status:** Root cause not confirmed. The `deletingId` per-alert fix (commit `0eda366`) is in Build 229 but still reproduces. Static code analysis shows the logic should work (`deletingId === null` after first delete). Suspect a runtime state issue not visible statically. Need diagnostic log at modal-open time.
**File:** `app/alerts.tsx:305` (`deletingId` state), `app/alerts.tsx:797` (disabled condition)
**Fix needed:** Add diagnostic log capturing `deletingId` + `pendingDelete.id` at modal open. Identify why `deletingId` is non-null when second dialog opens. Fix root cause — do not add a third band-aid.

### Bug 2 — List detach not persisting (re-appears after close/reopen)
**Symptom:** User taps X on attached list chip in alert detail → chip disappears (local state updates) → user closes and reopens alerts screen → chip is back.
**Root cause confirmed:** The detach deletes the `list_connections` row correctly. But `action_config.list_name` on the `action_rules` row still holds the list name. On next session, `ensureListAttachedToRule` runs again (called by orchestrator for rules with `action_config.list_name`) and re-creates the `list_connections` row.
**Fix needed:** In `onDetachList` in `alerts.tsx`, after successfully deleting the `list_connections` row, also call `manage-rules` with a new operation to null out `action_config.list_name` if it matches the detached list name.
**Files:** `app/alerts.tsx:520` (`onDetachList`), `supabase/functions/manage-rules/index.ts`

### Bug 3 — "Add note to existing alert" still broken (two sub-issues)
**Symptom:** User says "Add note to Mercedes alert saying discuss brakes" → Naavi shows Google Places picker instead of recognizing existing alert → after saying Yes, Naavi says "you already have an alert" instead of merging the note.

**Sub-issue A — Label-match not firing:**
The label-match fix in `useOrchestrator.ts` (Build 229) should match "Mercedes alert" → strip "alert" → "mercedes" → find rule whose label includes "mercedes". But Google Places was called instead, meaning the match didn't fire.
Possible cause: `existingRows` query may not include `label` field, OR `normalizePlaceName` produces unexpected result. Need to verify what `existingRows` actually contains at runtime.
**File:** `hooks/useOrchestrator.ts` — name-match block around line 2612

**Sub-issue B — Coord-match path has no merge logic:**
After Google Places resolves and the coordinate-match finds the existing alert, the code says "you already have an alert" and stops. It never checks if the new action has `tasks[]` to merge.
The merge logic only exists in the name-match path (lines 2627-2643). The coord-match path (after Google Places) needs the same merge check.
**File:** `hooks/useOrchestrator.ts` — coord-match block

### Bug 4 — Bottom button layout reverted
**Symptom:** Changed `justifyContent` from `flex-end` (when idle) to always `space-between`. This caused contacts button to sit on far left when Stop is not showing, which looked wrong.
**Status:** Reverted to original in this session. The original `flex-end` behavior is back. No new fix attempted — original behavior is correct for now.
**File:** `app/index.tsx:2316`

---

## Demo Video — Ready to Film

Rehearsal script: `docs/NAAVI_DEMO_SCRIPT_BUILD229.docx`

**Pre-filming checklist:**
- [ ] Open app → say "Add USB-C cable, smart plug, and AA batteries to my electric list"
- [ ] Verify electric list reads back 3 items
- [ ] Note live Anthropic spend figure
- [ ] Phone charged to 100%, Do Not Disturb on, chat history cleared

**Scenarios (in filming order):**
1. "How much has Anthropic charged me this month?" — zero setup, works now
2. "Remind me at 9:30 to review the deck before Pricing Strategy" — calendar confirmed
3. "What's on my list for Best Buy?" — add electric list items first
4. "When I get to the office, remind me to call Sarah about the proposal, and text Ahmed I'll be there by 9" — test day before

**Data seeded:**
- Sarah: +12366882719, sarah.elgillani@gmail.com — community ✓
- Ahmed: +16137976874, ahmed_elgillani@hotmail.com — community ✓
- Office alert (688 Bayview) — confirmed active ✓
- Best Buy alert with electric list — confirmed active ✓

---

## Server-Side Billing Pipeline — Fully Working

The full pipeline now works for non-Primary Gmail emails:
- `sync-gmail` picks up Updates tab (receipts, invoices from any sender)
- `extract-email-actions` processes all non-marketing emails (not just tier-1)
- `harvest-attachment` and `extract-document-text` run on all receipts
- `naavi-spend-summary` aggregates by vendor and period
- Billing questions trigger a background sync so next question finds fresh data

**Known gap:** May 2026 Anthropic charges are missing (lost during the period when `category:primary` filter was active). No backfill needed unless Wael specifically requires May totals.

---

## Repos
- Mobile app: `C:\Users\waela\OneDrive\Desktop\Naavi` (branch: main)
- Build clone: `C:\Users\waela\naavi-mobile` (branch: main)
- Voice server: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server` (branch: main)
- Staff portal: `C:\Users\waela\OneDrive\Desktop\naavi-staff` (branch: main)
- Website: `C:\Users\waela\OneDrive\Desktop\Naavi\mynaavi-website` (branch: main)
