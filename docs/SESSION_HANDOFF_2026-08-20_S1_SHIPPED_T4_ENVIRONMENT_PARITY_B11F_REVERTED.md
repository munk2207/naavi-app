# Session Handoff — 2026-08-19 → 2026-08-20

**S1 shipped · T4 environment parity opened and half done · B11f built and REVERTED · B11c fixed**

---

## ⭐ START HERE — the three things that matter most

**1. B11f is REVERTED and its root cause is unknown.** The pause/resume feature was built, passed four governance gates, 102 tests and a full external review — and broke normal conversation the first time Wael spoke to it. Reverted from staging (`9e69732`). **Do not re-attempt it without finding the cause first.** §4.

**2. A question is open and unanswered.** After the revert, saying "stop" made Naavi **restart the answer from the beginning**. That is different from the original bug report ("stop doesn't stop her") and points somewhere new. Two clarifying questions were asked and not yet answered — §4.3. **Ask them before touching the code.**

**3. Staging and production are not equal, and now we know exactly how.** T4 measured it: 184 differences at definition level, where a name-level comparison had found 14. Two passes done, four remaining. §3.

---

## 1. What shipped and is confirmed working

### S1 — Voice PIN authentication hardening (Phases 0–8 COMPLETE, staging)

The defect: a caller from an unregistered phone entered a PIN, and it was checked against **every account that had one**. A guess succeeded if it matched *anyone* — odds roughly 1 in 2,000 at 5 users, **1 in 10 at 1,000**. Fixed by inverting the order: the caller claims an identity (last 4 digits), which resolves to one account, and the PIN is checked against that account only.

Also: PIN 4 → 6 digits, PIN no longer spoken aloud, a PIN-authenticated caller cannot change the PIN, per-account failure counting with a 7-day window, an SMS alert to the owner, and owner-controlled lockdown by replying **BLOCK**.

**Live-verified end to end by Wael** — alert SMS → BLOCK reply → app shows blocked → unblock → access restored.

**⚠️ Production promotion is a SEPARATE decision** and needs the three gates. Its two migrations are deliberately *not* applied to production.

### B11c — the 30-second greeting (CLOSED, verified)

Staging replayed a 30-second uninterruptible onboarding script **on every call** while production greeted him in seven words. Cause: `user_settings.first_call_completed_at` existed in production and not staging, and **PostgREST fails the WHOLE query when any selected column is missing** — so `select=name,first_call_completed_at` returned HTTP 400 and took the caller's name down with it.

Fixed by T4 Pass 2a. **Verified by Wael calling twice:** first call still played onboarding (correct — the flag had never been recorded), then the second call gave the short greeting.

### A migration that would have damaged production (FIXED)

`20260721000000_sync_active_email_alerts_cron` called `cron.schedule()` unconditionally with a hardcoded **staging** URL and an unfilled `<SERVICE_ROLE_KEY>`. Applied to production — which any routine `db push` would have done — **production would have called staging every five minutes, forever, with no valid auth.**

It already carried a header saying *"STAGING ONLY… must not be applied to production."* `db push` does not read comments. **Now made to refuse**: a no-op unless the operator sets `t4.allow_env_specific_cron`. Verified by running it as `db push` would — cron count 11 before, 11 after.

---

## 2. ⭐ The pattern that recurred four times

Every one of these was **knowledge correctly written down, with nothing mechanically enforcing it**:

- The Architecture Reference sat stale for four months while everyone believed it current.
- Its version number went unbumped through three separate edits.
- `people` printed a missing-table warning in **every auto-tester run for months**, read as noise.
- A migration's "STAGING ONLY" comment failed to stop anything, because the tool doesn't read comments.

**The fix is the same shape every time: make it refuse, don't make it warn.** The external reviewer named it explicitly at T4 Pass 1 Phase 6.

---

## 3. T4 — Staging/Production functional parity

**The target, in Wael's words:** *"production and staging as 100% replica (FUNCTION)"* — equal in capability, not in data.

**How it was found:** Wael called both lines within a minute of each other and got different behaviour.

**Why staging was never a copy:** it is a *reconstruction from the migration files*. It contains what those files describe and nothing else. Production holds things the files never captured.

### Measurement (Phase 1, definition-level)

A name-level comparison found **14** differences. Definition-level found **184** — 89 missing, 44 staging-only, **51 present in both but defined differently**, a category the name-level pass reported as matching.

*(A raw count of 207 missing was corrected to 89 before reporting: 118 were pgvector/pg_trgm functions in different schemas. Real project functions missing: zero.)*

### Progress

| Pass | Scope | State |
|---|---|---|
| **Pass 1** | 42 definition differences | **Applied to both environments. Phases 0–6 approved.** Phase 7 tests **not run**; Phase 8 not done |
| **Pass 2a** | 10 missing columns | **Applied and verified.** Needs Phases 5–8 |
| **Pass 2b** | 4 tables (`people`, `conversations`, `pending_disambig`, `waitlist_signups`) | **GATED** on RLS intent verification |
| **Pass 2c** | 6 secrets, 2 crons | **GATED** on Wael's credential decision |
| **Pass 3** | 13 indexes, 14 constraints, 5 constraint diffs | Not started |
| **Pass 4** | 22 missing + 13 staging-only RLS policies | Not started |
| **Pass 5** | 54 staging-only items (debris triage) | Not started |
| **The drift check** | An automatic test that fails when they separate | **Not started — and it is the one that decides whether any of this lasts** |

### Pass 1 result

42 → 12 differences; the remaining 12 are **[[T5]]**, deliberately excluded. Production migrations recorded 67 → 82. **Production schema changed nothing — proven, zero rows.** A live phone number (`+16137697957`) removed from a column default.

### Pass 2a result

All 10 columns present and byte-identical to production. **Zero columns now missing on shared tables.** Restored: first-call state (B11c), `voice_keyterms` (staging was transcribing names worse than production — relevant to the open B4b work, which was being observed *on staging*), three morning-call columns, two OCR columns.

### ⚠️ Production is 18 migrations behind — resolved, but read this

A blanket `db push` would have applied **all 18**, not one. Handled by classifying each against production's own fingerprint: 13 already satisfied and recorded without running, 1 defused (the cron), 2 held back as S1's, 1 applied, 1 pending a decision.

**`user_settings.twilio_from_number` still needs a decision** — production genuinely lacks it, staging has it, and production's SMS path uses an env var rather than the column.

### Still missing from staging (not yet fixed)

| Feature | Why |
|---|---|
| **Calendar sync** | `sync-calendar-every-6h` cron missing — `calendar_events` never populated *(voice reads live from Google, so voice is unaffected)* |
| **Push notifications** | Firebase + 3 VAPID secrets missing |
| **OCR** | `GOOGLE_VISION_API_KEY` missing |
| **Inbound email** | `POSTMARK_SERVER_TOKEN` missing |

**Only 6 of the 12 "missing" secrets are real.** Five are referenced by no code at all and are **deliberately left in production, not deleted** (Phase 3 ruling: evidence a secret is unused justifies not copying it, not deleting it from a live system).

**⚠️ A claim corrected mid-session:** "WhatsApp reminders/tasks cannot work on staging" was **wrong** — the only WhatsApp template secret any code reads is one staging already has.

---

## 4. ⚠️ B11f — pause/resume. REVERTED. Root cause unknown.

### 4.1 What it was meant to do

Wael's reframing, from how people actually behave: *"If I'm on speaker phone and someone comes to my office, I say stop — and I mean pause until I say start again."*

Design: a stop word silences her **immediately and holds the answer**; "continue" resumes with *"as I was saying…"*; "cancel" drops it; silence lets it expire after 5 minutes. Silent by design — she says nothing at all until spoken to, because the whole scenario is someone walking into the room.

### 4.2 What went wrong

It changed **when speech gets processed**: from *"process unless Naavi is thinking"* to *"process unless Naavi is thinking **or speaking**"* — so talking over her would defer rather than produce overlapping answers.

**If `isSpeaking` ever gets stuck true, every subsequent utterance is buffered and never released.** Wael called: greeting played (TwiML, before the WebSocket), he asked a question, **silence**.

Reverted at `9e69732`. Voice suite still 102/102.

**Leading hypothesis, unproven:** the generation-tagged `response_end` marks. If a mark is rejected as stale, `endSpeech()` never runs and `isSpeaking` never clears. **The decisive evidence is whether `[Speech] end` appears in the Railway log for that call** — needs Railway access.

### 4.3 ⭐ The unanswered question — ask this first

After the revert, Wael reported: **saying "stop" makes Naavi restart the answer from the beginning.**

That is *not* the original bug report ("stop doesn't stop her"), and restarting implies something triggered a **new** response — suggesting "stop" is not being recognised as a stop command and is reaching Claude as ordinary speech.

**Two questions were asked and not answered:**

1. Was it the same answer **word-for-word from the very beginning**, or did she say something else first?
2. Did she **go quiet at all** before restarting, or carry straight on?

A pause-then-restart and a no-pause restart point at different faults.

### 4.4 What survives the revert

Phases 0–3 of B11f remain valid and are worth re-reading rather than re-deriving:

- **Root cause:** `streamTTSToTwilio` (`index.js:5730`) cannot be cancelled. Twilio's `clear` drains a buffer but cannot stop a producer still producing, so it refills.
- **Two audio senders exist:** `streamTTSToTwilio` (14 sites, asynchronous, affected) and `sendAudioToTwilio` (**43 sites**, synchronous, unaffected).
- **Mobile already solved this** with a generation counter (`useOrchestrator.ts:5048`), including a recorded ordering bug (`B-NEW-4`) worth not repeating.
- **The PrivacyMute feature** — "quiet"/"shh" offering to text you the rest — was disabled during B11f and is **restored by the revert**. It is untested by Wael and he considers it out of scope (*"discussion not feature"*). Logged as **F24**.

---

## 5. Decisions waiting on Wael

1. **Staging credentials** — separate keys per vendor (the reviewer's default) or shared with production? Sharing means staging can send real push notifications and spend production's quota. **Blocks T4 Pass 2c.**
2. **`user_settings.twilio_from_number`** — add to production, or leave it staging-only?
3. **S1 production promotion** — separate decision, three gates.
4. **B11f** — re-attempt after root cause, or leave reverted?

---

## 6. Open items in the holding list

| ID | What |
|---|---|
| **T5** | 12 columns where **production** is looser than staging. **BLOCKS T4 completion** |
| **B11f** | Pause/resume — reverted, root cause unknown |
| **B11g** | No barge-in during PIN prompts — a documented 2026-05-13 trade-off (`<Play>` outside `<Gather>` to fix landline silence) |
| **F24** | Channel redirect — *"email me / text me"* as a follow-up to any question. ⚠️ Collides with existing alert vocabulary |
| **B4b** | Deepgram drops leading words — **was being observed on staging, which lacked `voice_keyterms`.** Worth re-checking now that staging matches |
| **B11e** | Garbled first fraction of speech |
| **F23** | Hardcoded city/timezone vocabulary |

**Also outstanding, smaller:**
- `multiuser.send-sms.no-auth-no-body-rejects` — fails on staging because T2's outbound guard intercepts before the auth check. **Fix the test, never the guard** (Phase 6 ruling); it is a safety test.
- `b10j.negative-control-text-wife-work` — times out at 30 s, **uninvestigated**.
- **Debris cleanup** — 5 unused production secrets, 5 dead staging-only Edge Functions, an extra staging trigger, `pg_net` version difference.
- **Build 327** (staging APK) carries S1's C5/D6 but predates the counter-reset fix.

---

## 7. Environment facts worth not rediscovering

- **Staging APK shares production's package name** (`ca.naavi.app`) and only changes the display name to **"Naavi Staging"** — so it **replaces** production on the device and sorts under **N**, not M. `app.config.js` says so; CLAUDE.md's staging table is wrong about this.
- **Staging voice line:** `+1 343 504 1572`. Production: `+1 249 523 5394`.
- **The demo line is not a separate platform** — production demo runs *inside* the voice production server; both staging services deploy the same branch. Recorded in Architecture Reference §0b.
- **Staging SMS now sends from the staging number** and replies reach staging's `receive-sms-reply` — fixed during S1, after a BLOCK reply landed on production and did nothing.
- **`npm run test:auto` targets PRODUCTION by default.** Read the banner. `--grep` does not limit blast radius.
- **The health endpoint's build string is hardcoded** (`ebcbba9-delete-all-intercept`) and says nothing about what is deployed. There is no way to confirm a Railway deploy from outside.

---

## 8. Governance state

All work followed Release Gate Workflow v4.0 with external review at Phases 3 and 6. Every phase document is in `docs/`, named `S1_PHASE_*`, `B11F_PHASE_*`, `T4_PHASE_*`.

**The Phase-Gate Approval Rule held throughout:** a reviewer's "Approved" was never treated as authorization; each transition waited for Wael's own word.

**One place the process did not protect us:** B11f passed Phase 0, 1, 1A, 2, 3 (twice), 4, 102 unit tests and two external reviews — and broke the product the first time a human spoke to it. Every genuine defect this session was found by Wael doing something physical: pressing keypad keys, calling two numbers a minute apart, asking for a migration to be applied, saying one sentence out loud.
