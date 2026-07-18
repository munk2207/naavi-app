# MyNaavi — Current High-Level Architecture Reference

**Purpose:** a single reference for where things actually live in this codebase — not where they were designed to live, not where a comment claims they live, but where direct code verification confirms they live. This document exists because assumptions about "shared vs. duplicated" have caused real bugs this project has already paid for (see §6 and the Appendix). Every claim below was checked against the actual source, not inferred from file names or comments.

**Scope:** high-level only, no source code. File paths are given as location references, the way a floor plan gives room names — not as code to read.

**How to read this document:** if you're about to add a feature or fix a bug, read §1 to find where the capability actually lives, §3 to check if you're touching Protected Core, and §6 before deciding whether to reuse or duplicate.

---

## 0. The Three Codebases

Naavi is not one program — it's three, talking to one shared database:

1. **Mobile app** (`munk2207/naavi-app`, this repo) — the Android app itself (React Native/Expo), plus its backend Edge Functions (`supabase/functions/*`), which run on Supabase.
2. **Voice server** (`munk2207/naavi-voice-server`, separate repo, `naavi-voice-server/src/index.js`) — a single large Node.js program on Railway that answers phone calls via Twilio.
3. **Supabase** — the shared Postgres database, Edge Functions, and cron jobs both the mobile backend and the voice server call into.

The mobile app and the voice server **do not call each other**. They are two independent clients of the same backend. Whether a capability is "shared" depends entirely on whether both clients call the *same* Edge Function, or whether each has written its own version of the same logic.

---

## 1. Shared Core Boundaries

For each capability, where the authoritative implementation actually lives — verified against source, not assumed.

| Capability | Authoritative implementation | Status |
|---|---|---|
| Contacts / name resolution | `lookup-contact`, `resolve-recipient` (Shared Core) | Genuinely shared — voice calls the real Edge Functions, no inline reimplementation |
| Action Rules — execution/firing | `evaluate-rules`, `report-location-event` (Shared Core) | Genuinely shared — single non-duplicated functions, confirmed by exhaustive grep of the voice codebase |
| `task_actions` (third-party sends attached to an alert) | Mobile-only creation, Shared Core execution | Voice cannot currently create this — its own action-creation path never populates the field |
| Notification sending (SMS/email) | `send-sms`, `send-email` (Shared Core) | Genuinely shared senders — every alert-firing function funnels through these |
| Global Search | `global-search` (Shared Core) | Genuinely shared — voice calls the same 10-adapter search |
| Claude system prompt (non-classifier) | `get-naavi-prompt` (Shared Core) | Genuinely shared — voice fetches this Edge Function live, same bytes mobile uses |
| List creation | `manage-list` (Shared Core) | Genuinely shared for writes |
| List reading | Duplicated | Both mobile-backend and voice independently query the `lists` table directly, rather than through one read function |
| Calendar — writes (create/delete event) | `create-calendar-event`, `delete-calendar-event` (Shared Core) | Genuinely shared |
| Calendar — reads (live event fetch) | Duplicated | Both `naavi-chat` and the voice server independently call the Google Calendar API themselves |
| Gmail — background sync | `sync-gmail` (Shared Core) | Genuinely shared, cron-driven, writes to `gmail_messages` |
| Gmail — live/recent read | Duplicated | Both sides independently call the Gmail API directly for "what's new" reads |
| Drive saves (notes, transcripts, lists) | `save-to-drive` (Shared Core) | Genuinely shared — both mobile client and voice call it |
| Document harvesting (attachments → Drive) | Mobile-backend only | Voice never calls this; it's wired into the email-sync pipeline only |
| Reminders (`reminders` table) | Voice-only in current practice | Mobile's equivalent requests are redirected into `action_rules` instead of the `reminders` table; a mobile client function that writes to `reminders` exists but is dead code (never called) |
| Geofencing (background location) | Mobile-only, by nature | A phone call has no background location; this capability structurally cannot exist on voice |
| **Action Rules — creation (the classifier)** | **Duplicated, two independent implementations** | The single most important duplication in the system — see §1a below |
| Conversation/turn state (pending confirmations) | Duplicated, two independent state machines | Mobile and voice each track "what are we in the middle of" separately; neither reads the other's state |
| Authentication / user identity | Two genuinely different mechanisms, not a duplication | Mobile identifies the user via login (JWT). Voice identifies the user via caller phone number lookup. Different problems, correctly solved differently — both ultimately read the same `user_settings` table |

### 1a. Why "Action Rules creation" is the important one

This is the capability most likely to surprise you, and the one that produced this session's most expensive lesson. When a user asks to create an alert — "remind me when I arrive at Costco," "text Bob at 9am" — **mobile and voice each decide what to do independently**, using separately-written classification logic. Voice never calls the mobile backend's Edge Function for this at all. It has its own, much simpler classifier that only recognizes read-only questions (contacts, calendar, lists) — anything resembling "create an alert" falls straight through to voice's own full Claude reasoning, which is a different code path (though it does successfully use the genuinely-shared `get-naavi-prompt` system prompt once it gets there).

**Practical consequence:** a bug fixed in mobile's alert-creation classifier does not fix voice's alert-creation behavior, and vice versa. A fix must be evaluated against both, deliberately, every time — never assumed to transfer.

---

## 2. Entry Point Responsibilities

An "entry point" should only translate between the user and the Shared Core — not reimplement business logic. Current state, honestly:

**Mobile app should own:**
- UI rendering, navigation, screens
- Sign-in / session management
- Capturing what the user typed or said (text input, voice-to-text for hands-free mode)
- Rendering Naavi's response (chat bubbles, alert cards, TTS playback)
- Local-only concerns: settings screen, permission prompts, background task registration (geofencing is a mobile-only capability by nature, not a violation of this principle)

**Mobile app currently also contains (drift from the ideal):**
- Its own alert-creation classifier and confirmation-speech logic (`hooks/useOrchestrator.ts`) — this is genuinely part of the mobile entry point's job today, not a violation, but it's also NOT shared with voice, which is the drift worth naming.

**Voice server should own:**
- Answering the Twilio call, managing the WebSocket audio stream
- Speech-to-text (Deepgram) and text-to-speech (Deepgram/Polly)
- Caller identification (phone number → user)
- Playing audio back, handling barge-in/interruption

**Voice server currently also contains (drift from the ideal):**
- Its own alert-creation classifier and reasoning loop, its own turn-state tracking, its own direct Gmail/Calendar API calls, its own direct database inserts for reminders and rules — none of which route through the mobile backend's equivalent logic. This is the single biggest gap between "what an entry point should do" and "what voice actually does."

---

## 3. Protected Core

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` §4, these areas require technical review before *and* after any change, regardless of how small the change looks. Mapped to actual files:

| Protected Core area | Files | Why | Review level |
|---|---|---|---|
| Voice orchestration | `naavi-voice-server/src/index.js` (entire file) | Controls every phone call; a mistake here is heard live by a real caller with no undo | Full Phase 1-8 |
| Action Rules | `naavi-chat/index.ts` (classifier + confirm logic), `manage-rules`, `evaluate-rules`, `report-location-event`, `_shared/task_actions.ts`, `_shared/alert_body.ts`, `hooks/useOrchestrator.ts` (mobile write paths) | Governs every alert a user creates; a mistake here silently misdirects or drops real messages to real people | Full Phase 1-8 |
| Reminder Engine | `check-reminders`, the `reminders`-table write paths | Same class of risk as Action Rules — a dropped reminder is invisible until the user notices it never happened | Full Phase 1-8 |
| Geofencing | `hooks/useGeofencing.ts`, `report-location-event`, `fire-pending-dwells` | Background location on a phone is fragile by nature (OS kills, permission changes); a regression here is hard to notice and hard to reproduce | Full Phase 1-8 |
| Calendar integration | `create-calendar-event`, `delete-calendar-event`, both sides' live-fetch code | Touches the user's real Google Calendar — a bug can create or delete a real event | Full Phase 1-8 |
| Gmail integration | `sync-gmail`, both sides' live-fetch code, `extract-email-actions`, `harvest-attachment` | Reads a real inbox; privacy-sensitive, and feeds several other features (document harvesting, alerts) | Full Phase 1-8 |
| Authentication | `lib/supabase.ts` (mobile session config), `naavi-chat`'s JWT resolution, voice's caller-phone resolution | A mistake here can leak one user's data to another (see CLAUDE.md's Rule 10, multi-user safety) | Full Phase 1-8 |
| Permissions | `hooks/useGeofencePermissions.ts`, Android manifest entries | Getting this wrong silently breaks location alerts with no error the user can see | Full Phase 1-8 |
| Background scheduling | Cron definitions (`cron.job` entries) for `evaluate-rules`, `check-reminders`, `sync-gmail`, dwell timers | A duplicate or missing cron job either double-fires alerts or silently stops them | Full Phase 1-8 |
| Notification routing | `send-sms`, `send-email`, the fan-out logic inside `evaluate-rules`/`report-location-event`, `user_settings.alert_channels_enabled` | Directly controls whether and how a real message reaches a real phone | Full Phase 1-8 |
| Database schema | All migrations, RLS policies, unique constraints on `action_rules`/`reminders`/`lists`/`contacts` | A bad migration or a missing constraint is the hardest category of mistake to reverse safely | Full Phase 1-8, migration reviewed separately |
| API contracts | The shape of `action_config`, `trigger_config`, `task_actions`, and every Edge Function's request/response shape | An undocumented shape change breaks whichever caller wasn't updated — exactly the failure class this document exists to prevent | Full Phase 1-8 |

**Who is allowed to modify Protected Core:** per the project's standing rule, any AI session working in this codebase — but only by following the full governance process (Phase 1 Problem Definition through Phase 8 Merge), with Wael's own explicit go-ahead required between every phase. No phase's "Approved" review verdict is itself permission to proceed to the next phase.

**What is NOT Protected Core** (candidate for a lighter process, but still requires asking first): pure UI/display code with zero shared-logic or backend touch — e.g., how a screen renders existing data, wording-only changes with no behavior change. Even these should be confirmed with Wael before assuming the lighter path applies.

---

## 4. Duplication Inventory

| Capability | Shared | Duplicated | Planned to unify |
|---|---|---|---|
| Contacts / name resolution | ✅ | | |
| Action Rules execution (firing) | ✅ | | |
| Notification sending | ✅ | | |
| Global Search | ✅ | | |
| Claude system prompt (non-classifier) | ✅ | | |
| List creation | ✅ | | |
| Calendar writes | ✅ | | |
| Gmail background sync | ✅ | | |
| Drive saves | ✅ | | |
| **Action Rules creation (classifier)** | | ✅ | Not scheduled — no plan exists yet |
| Calendar reads | | ✅ | Not scheduled |
| Gmail live reads | | ✅ | Not scheduled |
| List reads | | ✅ | Not scheduled |
| Conversation/turn state | | ✅ | Not scheduled — architecturally difficult (different runtimes, different session models) |
| `task_actions` on location alerts, real-world reach | | ✅ (voice literally cannot produce this input) | Deferred pending a production-promotion or voice-staging decision (see Appendix) |

**Reading this table:** every ✅ in the "Duplicated" column is a place where a fix applied to one side silently does not apply to the other, and nothing in the codebase enforces that they stay in sync. This has already caused at least four confirmed incidents in this project's history (see Appendix's T1a reference) — it is the single highest-leverage category of future bug.

---

## 5. Data Flow

```
Voice caller
     │
     ▼
naavi-voice-server (Twilio + Deepgram STT/TTS)
     │
     ├──► shared Edge Functions (lookup-contact, resolve-recipient,
     │     evaluate-rules-fired-sends via send-sms/send-email,
     │     global-search, manage-list writes, save-to-drive,
     │     create/delete-calendar-event, get-naavi-prompt)
     │
     └──► voice's OWN logic (classifier, Gmail/Calendar live reads,
           list reads, action_rules/reminders inserts, turn state)
                                                              │
                                                              ▼
                                                          Supabase
                                                       (Postgres + cron)
                                                              ▲
     ┌──► shared Edge Functions (same list as above) ─────────┤
     │                                                        │
Mobile app (React Native)                                     │
     │                                                        │
     └──► mobile's OWN logic (hooks/useOrchestrator.ts —      │
           classifier confirm, address resolution, task      │
           creation, its own Gmail/Calendar live reads) ──────┘
```

**The one-sentence version:** both clients share the database and a real set of Edge Functions for read-only lookups, sending messages, and firing alerts — but each independently decides *what an alert should be* before it ever reaches that shared layer, and each independently re-fetches live Calendar/Gmail data rather than sharing one fetch.

---

## 6. Decision Rules

When adding new functionality, in order:

1. **Can it live in Shared Core (an Edge Function both mobile and voice call)?** If yes, it must be built there — not duplicated separately inside `hooks/useOrchestrator.ts` and `naavi-voice-server/src/index.js`.
2. **Entry points may only translate.** Mobile should convert taps/typed text into a request and convert the response into UI. Voice should convert speech into a request and convert the response into audio. Neither should independently decide business logic that the other surface also needs.
3. **Duplication requires explicit approval, named as duplication, not discovered later.** If a capability truly cannot be shared (e.g., geofencing is mobile-only by nature — that's fine, it's not duplication, it's a mobile-specific capability), say so explicitly in the Phase 2 Change Plan. If two surfaces really do need independent implementations of the same idea, that decision needs its own stated reason, not silence.
4. **Before claiming "this is already shared," verify it against the actual other codebase.** This document exists because that exact assumption, unverified, was wrong once this session and cost real re-work. Grep the other codebase for the specific function or logic in question before writing "shared" anywhere.
5. **A shared Edge Function does not guarantee shared behavior.** Confirm both callers actually reach the code path you changed — see §1a: `evaluate-rules`/`report-location-event` are genuinely shared, but voice's own creation path can't produce the input (`task_actions`) that exercises the shared fix. "The backend is shared" and "both surfaces can actually trigger this" are two separate claims — check both.
6. **Protected Core changes always follow the full governance process** (`docs/AI_DEVELOPMENT_GOVERNANCE.md`), regardless of how small the diff looks. Size of change and required rigor are not correlated in this codebase's history — several of its cheapest-looking fixes caused the most expensive regressions.

---

## Appendix — Where this document came from

This reference was written 2026-07-18, immediately after a session that surfaced exactly the risk this document is meant to prevent: a governance document confidently claimed a classifier fix was "shared across mobile and voice, no voice-server change needed" — a claim that turned out to be false when actually checked against the voice codebase. That specific gap is tracked as **B10k** in `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` (Tier 1, top of the priority queue as of this writing) — the fix exists in mobile's Shared-Core-adjacent prompt file, but has not been promoted to the production environment voice actually runs against.

The broader pattern — features added to one of two independently-maintained implementations and never mirrored to the other — is tracked as **T1a** (architecture integrity audit) in the same holding list, with four confirmed instances at the time of writing (recipient resolution, channel-preference handling, `task_actions` execution, and the alert-creation classifier itself).

This document should be treated as a snapshot, not a permanent truth — re-verify any specific claim before relying on it for a real decision, the same way every claim in it was verified before being written down.
