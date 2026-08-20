# Session handoff — 2026-08-20, afternoon

**B11f found, fixed and confirmed working · T4 Passes 2b, 2c, 3 and 4 applied · the drift check exists**

Supersedes §4 of `SESSION_HANDOFF_2026-08-20_S1_SHIPPED_T4_ENVIRONMENT_PARITY_B11F_REVERTED.md`
(that document says B11f's root cause is unknown and lists two unanswered questions — both are
answered below). Everything else in that document still stands.

---

## 1. Read this first

**1. B11f works.** Pause and resume is live on voice staging and Wael confirmed it on a call.
It took two root causes, neither of which was the one guessed at last night. §2.

**2. T4 went from 184 differences to 89.** Four passes applied, all to Supabase staging.
A drift check now exists that fails when the two environments separate further. §3.

**3. Nothing was deleted anywhere.** Wael's instruction, mid-session. Two policies removed
earlier in the day were restored. Pass 5's premise — "triage staging-only items into
deliberate versus debris" — was wrong and is retired: staging-only means *not yet promoted*.
§3.4.

**4. Almost everything left needs a decision from Wael, not work.** §5.

**⭐ The pattern of the day, and it is not the same as last night's.** Last night's was
*knowledge written down with nothing enforcing it*. Today's is **tooling defects wearing the
costume of real findings**. Five times a difference that looked like a live risk turned out
to be formatting, truncation, or a broken query of mine:

| Looked like | Actually was |
|---|---|
| Ten cron jobs defined differently | Three were Windows vs Unix line endings |
| Geofence dwell logic differs between environments | One space after a bracket |
| Five of our functions missing from staging | pgvector's, caught by a filter that missed the names |
| Four crons drifting | The fingerprint truncated production mid-key, because its key is longer |
| All three shared functions still differ | My own shell escaping ate the backslash in `\s` |

Each one buried the real findings underneath it. **A check that cries wolf becomes wallpaper**,
and the fixes for all five are committed.

---

## 2. B11f — pause and resume, working

### 2.1 The first cause: a function nobody wrote

`isPauseCommand()` was called from two places and never defined. Every finished sentence threw
`ReferenceError`; the catch logged it as `[Deepgram] Parse error`, which reads like a
transcription fault; the caller got silence.

Retrieved from the removed Railway deployment — the log was still there, nobody had fetched it:

```
02:12:37  [Deepgram] Parse error: isPauseCommand is not defined
02:13:03  [Deepgram] Parse error: isPauseCommand is not defined
02:13:48  [Deepgram] Parse error: isPauseCommand is not defined
```

Three calls, three times, each at the moment Wael stopped speaking.

**Last night's revert commit blamed the wrong thing.** It reasoned the cause out "by
construction rather than by log" — a stuck `isSpeaking` deferring speech forever. The log said
otherwise and was retrievable the whole time.

`node --check` passed (syntax only). 102 voice tests passed (none reached the line). Four
governance phases and two external reviews passed.

### 2.2 The second cause: half the feature was never wired up

After the function was written, Wael tested and pause still failed. The log:

```
[B11f] pause while speaking (0 bytes spoken)
```

— with no `answer held` line at all.

`processUserMessage` forks. When askClaude has already generated the audio and no action
rewrote the speech, the whole buffer goes to `sendAudioToTwilio` — logged as
*"T8/T9 using pre-generated audio"*. Otherwise it goes through `speak()`.

**B11f instrumented `speak()` and nothing else.** Its own commit says so: *"sendAudioToTwilio
and its 43 call sites are untouched."* So on a normal answer nothing recorded the text and
nothing tracked progress.

That is why it looked intermittent. It worked at 12:39 and failed at 14:36 with the same words,
because which path runs depends on whether the speech was modified. **A feature that works on
one of two delivery paths looks like a race and is not one.**

Fixed by recording the text and estimating position from elapsed playback time on the fast
path — playback is real time, so wall clock since dispatch *is* the position, at 8000 bytes per
second, capped at the buffer length. That is an estimate, which is all the resume point ever
was.

### 2.3 Confirmed working

```
14:46:22  [B11f] answer held (182 chars, 70936 bytes spoken)
14:46:22  [B11f] pause while speaking (70936 bytes spoken, pre-generated)
14:46:33  [B11f] resume from char 61 of 182
```

70936 bytes is 8.9 seconds of audio. She resumed from character 61 of 182, backed up to a
sentence boundary. Wael: *"Passes"*.

### 2.4 "start" now resumes

Wael said "start" unprompted on a live call. It was not in `RESUME_WORDS`, so it reached Claude
as a new question and she answered from the top — which was the whole "she restarts from the
beginning" symptom. It was never a replay bug.

Added `start`, `go on`, `keep talking`. All three vocabularies now live in
`src/voice/pauseCommand.js` with 15 tests. The test drives off the real lists, so any word
added to resume or cancel is automatically checked against the pause matcher and the two can
never overlap.

### 2.5 The gate that would have caught it

`.githooks/pre-push` refuses any push that calls something undefined. eslint, one rule,
`no-undef`. Railway deploys straight from a push, so refusing the push is the only place that
can stop a broken deploy — a GitHub check would only report after the line was already down.

Proven both directions: it flagged both `isPauseCommand` sites in about a second when B11f was
restored, and it found a live one nobody knew about — `timeOfDay` was used in the morning
brief's error handler while scoped to the try block, so a brief that failed to build threw
inside its own error handler and the caller got silence instead of an apology.

**Enable on a fresh clone:** `git config core.hooksPath .githooks`

---

## 3. T4 — 184 → 89

All work is on **Supabase staging** (`xugvnfudofuskxoknhve`), which is also what the staging APK
points at. Production was read from, never written to.

### 3.1 What was applied

| Pass | What | Result |
|---|---|---|
| **2c** | 6 secrets, 2 crons | Complete. Vision key and Postmark token copied (fingerprints match production exactly), Firebase regenerated, push given its own identity, 2 crons created |
| **2b** | 4 tables | `people`, `conversations`, `pending_disambig`, `waitlist_signups`. **Four code paths were failing silently on staging** because the table wasn't there |
| **3** | 13 indexes and constraints | All applied. Three value rules added `NOT VALID` — see 3.3 |
| **4** | Access policies | Four real gaps closed out of a reported 35 — see 3.2 |
| — | Two CHECK constraints | Staging rejected the `calendar` document type that CLAUDE.md documents as valid, and every ticket raised from the website |

### 3.2 Pass 4 — why 35 differences were mostly 4

Comparing policies **by effect rather than by name** changed the picture completely. Postgres
uses the `USING` expression as the write check when `WITH CHECK` is omitted, so several staging
policies already behaved identically. Several production policies are redundant against their
own `ALL` policy. One pair differs only in capitalisation.

Genuinely fixed: staging could *write* calendar events and gmail messages where production only
allows reading; users couldn't delete their own token; support tickets couldn't be read or
worked on staging.

**⚠️ Deliberately not copied — production's Epic policies.** Production has `using = true` on
`epic_conditions`, `epic_medications`, `epic_appointments`, `epic_observations`: any
authenticated user can read every user's rows. **Staging is the correct one.** Parity was the
wrong instinct — copying would have imported the weaker rule.

Epic was trialled around April/May 2026 and postponed. Its three Edge Function folders are
empty, nothing in the codebase inserts into those tables, and the rows on production are
leftovers from that trial. The client also gates all three medical reads behind
`isEpicConnected()`, which **is** scoped per user, so the loose policy was never reachable from
the app. **Left for whenever Epic is picked up.**

### 3.3 The rule that could not be copied, and the trade that solved it

Three `knowledge_fragments` CHECK constraints could not be added: 35 rows on staging carry a
`source` production rejects (`conversation` ×34, `demo-seed` ×1).

Those rows are `robert.esm.2207@gmail.com`'s memories — a doctor, a prescription, a blood test,
a follow-up appointment. **They are data and out of scope.** Wael, on what parity means:
*"functions not data that belong to the individual testing each system."*

Added `NOT VALID`: the rule applies to every row written from now on, existing rows are never
examined. Proven after applying — 36 memories still present, and a new row with
`source='conversation'` is refused.

**⚠️ This changes staging's behaviour on purpose.** Whatever writes `source='conversation'`
will now be refused on staging exactly as production would refuse it. If that path is still
live, memories that used to save on staging will stop saving. **That is the point** — a failure
production would have had becomes visible where someone can see it.

**Open question nobody has answered:** nothing in the codebase writes `source='conversation'`.
`ingest-note` takes it from the request body, defaulting to `'notes'`; the voice server sends no
`source` at all. What wrote those 34 memories is unidentified.

### 3.4 Pass 5 is retired

Scoped as "triage 54 staging-only items into deliberate versus debris." **There is no debris.**
Staging-only means not yet promoted. The 43 remaining items are a promotion list.

Also retired: the proposal to drop `email_alert_log`. Wael: the email-alert function is major —
positive *and* negative acknowledgement, *"tell me when Bob emails"* and *"tell me if Bob hasn't
emailed in 30 days"*. It stays. (For the record: that feature runs on `action_rules` and
`action_rule_log`, both of which production has; `email_alert_log` is an empty leftover from the
retired `email_watch_rules` implementation and is referenced by no code.)

### 3.5 The drift check

`npm run drift:check` reads staging live, compares against the production snapshot, and exits
non-zero on any difference **new** since the baseline. Today's 89 are recorded in
`docs/T4_accepted_differences.json` and are not failures.

Three categories, deliberately not merged: **missing** is the real gap, **staging-only** is
usually unpromoted work, **defined differently** is the dangerous one that looks identical to
any name-level check.

Proven both ways: green at the recorded count, and exit 1 naming both items when two were
removed from the baseline.

**It is not enforced by anything.** It is a command someone has to remember to run — which is
the pattern this whole session was spent undoing. §5.

---

## 4. Step 1 — the ten unknowns, answered

Last night's document flagged three function bodies and seven crons as unresolved risk, because
the fingerprint stored them as hashes. Wael pasted production's definitions from the SQL editor.

**Exactly one of the ten is real.**

| | |
|---|---|
| `try_enter_geofence` | **Identical.** One space after a bracket. The geofence dwell logic is the same in both |
| `tickets_set_updated_at` | **Identical.** Indentation |
| `search_knowledge_fragments` | **REAL.** Staging lacks production's `SET search_path TO 'public','pg_temp'` hardening. It also returns 12 columns where production returns 7, but all three callers read only `similarity` and `content`, so the extra columns are read by nobody |
| 7 cron jobs | **All artifacts.** One trailing semicolon; four truncated mid-key; four differing only in how the auth header is assembled |

**Not a parity gap but worth fixing:** staging hardcodes the service key inside four cron
definitions. Production reads it from a database setting. Configuration Discipline rule 1 says
the hardcoded kind should be replaced — production is doing it correctly and staging isn't.

**Housekeeping not done:** the fingerprint SQL now hashes normalised bodies and redacts cron
keys before truncating, but production's snapshot on disk is still the old format from 12:47am.
Until it's recaptured, those nine keep appearing in the accepted list. They are known-false and
recorded; recapturing is tidiness, not information.

---

## 5. Decisions waiting on Wael

1. **The promotion list** — 43 things staging can do that production cannot. S1's PIN security,
   the phone-number uniqueness guard, the 5-minute targeted email sync (`sync-active-email-alerts`,
   committed 21 July, deployed to staging and never to production), the Epic integrity
   constraints and correct policies, two performance indexes. Each is a production change.
2. **T5** — 12 columns where production is *looser* than staging. Blocks T4's completion by
   definition. Fixing it means tightening production.
3. **3 foreign keys** — staging cascades on user delete, production doesn't.
4. **`gmail_messages.is_unread`** — defaults to *true* on production, *false* on staging. A new
   email arrives unread on one and already-read on the other.
5. **Production's Epic policies** — §3.2.
6. **`user_settings.twilio_from_number`** — production genuinely lacks it, staging has it.
7. **Where the drift check gets enforced** — a command nobody runs is a warning, not a gate.
8. **S1 production promotion** — unchanged from last night, needs the three gates.

---

## 6. Owed, and not done

- **No automated test for the B11f fast-path fix.** `bytesSpokenSoFar` lives inside the
  per-connection closure and cannot be imported without extracting it, and that branch carries
  every spoken answer on every call. Flagged rather than done quietly. Wael has not ruled.
- **Pass 1 Phases 7–8 and Pass 2a Phases 5–8** — governance paperwork, still open from last
  night.
- **Push on staging needs a new APK.** The new key only takes effect in a build; staging's
  current APK still carries production's.
- **`web/app/page.tsx` has pre-existing typecheck errors**, untouched and uninvestigated.

---

## 7. Environment facts worth not rediscovering

- **There are two stagings, not three.** Mobile staging *is* Supabase staging
  (`xugvnfudofuskxoknhve`) — `eas.json`'s staging profile points the APK at it. Voice staging is
  the separate Railway service, two days old.
- **The voice server has two branches**, not one: `staging` → `naavi-voice-staging`, `main` →
  `naavi-voice-server`. CLAUDE.md said single-branch and was corrected today.
- **Railway CLI is installed and logged in.** `railway logs --service <name>`, and
  `railway deployment list --service <name> --json` carries the commit hash — the only reliable
  way to know which code is actually live.
- **`railway redeploy --from-source`** pulls the latest commit when a push doesn't trigger a
  deploy. One push today never reached Railway; forty minutes were spent blaming a genuine
  Railway incident that had nothing to do with it. Check `git ls-remote` first.
- **`STAGING_DB_URL` is in `tests/.env`** (gitignored). No production database credentials exist
  anywhere, by choice.
- **A third Railway service, `generous-tenderness`**, runs the same staging code — it carries
  `STAGING_DEMO_TWILIO_NUMBER` and `STAGING_DEMO_USER_ID`, so it is the staging demo line. It
  places no calls; the voice server never dials, it only answers.

---

## 8. One thing found in passing, not chased

The morning call reaches voicemail and holds a conversation with it — transcribing
*"If you are satisfied with your message, press 1…"* as speech and answering it, for 98 seconds.
The gate that decides human-versus-machine accepts *any* speech as proof of a person, and a
voicemail greeting is speech:

```
[Gate] Speech detected "Three seven" — delivering brief
```

*"Three seven"* is a voicemail greeting reading a phone number back. Naavi then delivered the
morning brief into voicemail. Wael knows the calls go to voicemail and considers that expected;
what happens afterwards was not examined further.
