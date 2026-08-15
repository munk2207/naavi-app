# Visits Flow Redesign — Phase 1 — Problem Definition

Status: DRAFT — for Wael's review. No code has been written. Per Wael's instruction, the previously-discussed `send()`/`naavi-chat` routing is treated below as one hypothesis among several, not a predetermined answer.

---

## What exactly is broken?

After a recorded conversation is transcribed and actions are extracted, the action items are **executed immediately with no human confirmation and no attempt to resolve who a recipient actually is** — on both platforms that implement this feature, independently.

## Evidence — Mobile

`hooks/useConversationRecorder.ts`, function `confirmSpeakers` (as committed — this file has since been reverted to this exact state per Phase 0):

- Line 372-374: calls `extract-actions` to get a list of proposed actions.
- Line 382: `const calendarTypes = ['appointment', 'meeting', 'call', 'test', 'prescription', 'follow_up'];`
- Lines 388-469: loops every extracted action whose type is in `calendarTypes` and calls `registry.calendar.createEvent(...)` directly — no confirmation prompt, no user interaction, before the user has seen a single card.
- No call to `lookup-contact` anywhere in this function (confirmed by grep — the only mention of `lookup-contact` in the file is a comment at line ~52 explaining why it's deliberately *not* called for the `suggested_by` speaker label).
- The only action type that gets any recipient verification is `email`, and only if the user manually taps "Draft Email" on the resulting card (`components/ConversationActionCard.tsx` line 93, gated on `action.email_draft`) — which routes the message through `send()` (`app/index.tsx` line ~2557-2566), the same pipeline used for live chat. Every other action type (appointment, prescription, test, follow-up, call) is created with zero review.

## Evidence — Voice (newly found this session, not previously documented)

`naavi-voice-server/src/index.js`, function `processCallRecording` (line 5881), triggered from `startTwilioRecording`/the recording-complete webhook handler (line 643-650):

- Line 5879: the function's own comment states its job plainly: *"downloads audio, transcribes, extracts actions, creates calendar events, saves Drive doc, emails summary, sends SMS/WhatsApp/push ping. Runs async after webhook."*
- Line 5959-5965: calls the **same** `extract-actions` Shared Core Edge Function mobile uses.
- Line 5973: `const calendarTypes = new Set(['appointment', 'meeting', 'call', 'test', 'prescription', 'follow_up', 'task', 'reminder', 'email']);` — note this set is **not identical** to mobile's: it additionally includes `task`, `reminder`, and — critically — `email`. Voice creates a **calendar event** for an extracted `email`-type action; it does not appear to draft or send an actual email for it the way mobile's Draft Email button does (not fully verified — flagged below as needing confirmation in Phase 1A, not assumed here).
- Lines 6065-6100: loops every action matching that type set and calls `create-calendar-event` directly — no confirmation, no `lookup-contact` call, no interaction with the caller before creating real calendar events. The call has typically already ended by the time this runs (line 5880: "Runs async after webhook").

**This means: the exact defect Wael flagged — silent auto-execution, no recipient resolution — exists independently on both platforms, implemented separately, with subtly different behavior (different type sets, different handling of `email`-type actions). Neither implementation currently reuses the other's logic, and neither reuses `naavi-chat`'s confirmation/resolution mechanism.**

## Root cause

Two independently-written implementations of "turn `extract-actions`' output into real calendar events" each skip the confirmation step every other state-changing action in this app goes through (CLAUDE.md Rule 12), and neither calls `lookup-contact` to verify a recipient before acting. This is not a bug in `extract-actions` itself (it only proposes actions; it does not execute anything) — it is a gap in what happens *after* extraction, on both platforms, independently.

## Architecture Reference status — "Architecture location not proven," then resolved

The Architecture Reference (`docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`) does not mention this capability anywhere — not in §2's Shared Core Boundaries table, not in §4 Protected Core's file mapping, not in §5's Duplication Inventory. Per Phase 1's own rule, this is stated plainly rather than assumed: **the Reference does not cover this capability.**

Resolved by fresh grep against both repositories this session (not previously verified anywhere):

- **`upload-conversation`, `poll-conversation`, `extract-actions`** — genuinely Shared Core. Both `hooks/useConversationRecorder.ts` (mobile) and `naavi-voice-server/src/index.js` line 5907/5924/5959 (voice) call the same three Edge Functions. This part of the capability belongs in §2's "Shared" rows.
- **Execution of the extracted actions (auto-creating calendar events, with no confirmation)** — genuinely **Duplicated**, previously undocumented. Mobile: `hooks/useConversationRecorder.ts` lines 380-470. Voice: `naavi-voice-server/src/index.js` lines 5971-6100. Two independent implementations, confirmed by direct code reading (not inferred), with a confirmed behavioral difference (the `calendarTypes` sets don't match).
- **Calendar integration** is listed in the Architecture Reference's §4 Protected Core table — so this duplication sits inside Protected Core, which is why Phase 3/6 external review is mandatory regardless of how small any individual code change looks.

**This is a new architecture finding, not something Phase 0 anticipated.** The Architecture Reference will need updating in whichever phase actually changes this (per governance §8, Architecture Change Procedure) — not deferred to a later cleanup.

## What alternatives were considered

Genuinely comparing three directions, not presupposing the first one discussed earlier this session:

**A — Route mobile's extracted actions through `send()`/`naavi-chat` (the hypothesis discussed before Phase 0).**
Reuses `naavi-chat`'s existing tool-use loop, `lookup-contact` resolution, and confirm-before-act (`PENDING_INTENT`) mechanism for mobile. Verified this session that this mechanism is real and working (Wael: "this is working good" re: live voice/chat name resolution). **Limitation newly found:** this only touches mobile. Voice's independent implementation (`processCallRecording`) has no equivalent way to "route through `naavi-chat`'s chat history" — per the Architecture Reference §2 row "Conversation/turn state (pending confirmations)": *"Duplicated, two independent state machines... neither reads the other's state,"* formally accepted as an Architecture Exception (ADR 0008) for the stated reason that **no shared cross-runtime session layer exists between mobile and voice.** Alternative A, even if fully correct for mobile, leaves voice's identical defect completely unaddressed.

**B — Add a local confirm-before-execute step independently to each platform.**
Mobile: keep showing action cards, but require an explicit tap (e.g. "Add to calendar") before any `create-calendar-event` call, and add a real `lookup-contact` call for any action needing a recipient. Voice: before creating events, speak the extracted items back and listen for a yes/no, mirroring how voice already handles other confirmations in its own independent turn-state machine. Keeps both platforms self-contained; doesn't require a new Shared Core function. **Downside:** duplicates confirmation/resolution logic a third and fourth time (mobile already has one such mechanism in `naavi-chat`+`useOrchestrator.ts`; voice has its own separate one per the Architecture Reference) — the Reference's own Decision Rules (§7, Rule 1) direct new shared logic toward Shared Core when possible, which this alternative doesn't do.

**C — Move the confirmation/resolution step itself into Shared Core**, so both `extract-actions`' mobile and voice callers get a genuinely shared "resolve recipients, stage for confirmation" step, and each platform's entry point only handles the platform-specific part (mobile: render cards + buttons; voice: speak + listen). Most consistent with the Architecture Reference's own stated principle (§1: "Entry points translate requests rather than implement business logic") and §7's Decision Rule 1. **Downside:** largest change — a new Shared Core Edge Function, changes required on both mobile and voice, both independently Protected Core (Voice orchestration and Calendar integration are both listed separately in §4). Bigger blast radius than what Phase 0 scoped, which was written before this voice-side finding existed.

**No alternative is recommended here — that is a Phase 2/3 decision, not Phase 1's.** Phase 1's job is to establish the facts above accurately; which alternative to build is deliberately left open for the next phases and for Wael's own judgment.

## Open scope question for Wael, before Phase 1A proceeds

Phase 0 was written and approved based on the mobile-only picture. This phase found the identical defect exists independently on voice too, previously undocumented anywhere. Two honest paths, and this needs your call before Phase 1A's formal Cross-Repository Verification proceeds:

1. **Expand this work item's scope to cover both platforms** (likely points toward Alternative C, or Alternative B applied to both sides) — bigger, but actually closes the real gap.
2. **Keep this work item mobile-only, as Phase 0 originally scoped**, and record voice's matching defect as its own separate, explicitly out-of-scope tracked item (an ADR or holding-list entry, the same way this project already tracks other known duplications) — smaller, faster, but leaves voice's identical bug live.

Neither is obviously wrong; this is a real scope decision, not something Phase 1 should decide unilaterally.
