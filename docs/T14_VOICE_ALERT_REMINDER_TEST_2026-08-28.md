# T14 — Voice Alert & Reminder Test: running record

**Opened 2026-08-28.** Test campaign against **voice production** (`+1 249 523 5394` →
`naavi-voice-server`, commit `5dff3d5d`, Supabase `hhgyppbxgmjrwdpdubcx`).

**This document records findings. It does not track them.** Nothing here is a holding-list item.
Under CLAUDE.md Rule 1b, each candidate below is explained to Wael on its own and approved before
any row or ID exists. **Writing "recorded" here is not putting it on the general list** — that is
the B11o Phase 7 lesson this campaign is deliberately not repeating.

**Caller:** `+1 613 769 7957` → account `788fe85c-b6be-4506-87e8-a8736ec8e1d1` ("Wael").
Channels enabled: sms, email, push, voice_call. **WhatsApp is off**, so a self-alert fans out to
four channels, not five.

**Baseline, verified before the first call:** 0 enabled `action_rules`, 0 unfired `reminders`.
Wael cleared four pre-existing enabled rules from the app first (1 email "Alert when Bob emails",
3 location) so nothing pre-existing could fire or clutter a list-back.

---

## Test 1 — Time alert — CREATION PASS, FIRING PASS

`"Set alert in 5 minutes tell me good morning"`

Rule `59083329-27ae-4f43-9db2-4d12f5a7b9fb`, created **05:23:18 EST**, fired **05:28:39 EST**.
Wael confirmed receipt on all four channels.

```
trigger_type   : time
trigger_config : {"datetime":"2026-08-28T05:27:00-04:00"}
action_type    : sms
action_config  : {"body":"Good morning, Wael!","to_phone":"+16137697957"}
one_shot       : true      enabled: false (auto-disabled after firing — correct)
```

**It landed in `action_rules`, not the `reminders` table.** First data point on the B10l question.
Recipient is Wael's own number with no stray third party.

**Retest (05:46:58 call) also passed**, including the list-back: *"You have 1 active alert.
1. Text me in 5 minutes saying Hello."* — returned in **2325 ms**.

---

## Test 2 — Location alert — PASS

Wael asked for a Costco arrival alert telling him to pay at Costco. An **expired** Costco rule from
21 July already existed, disabled. Naavi name-matched it and offered to re-enable rather than create
a second one — which is the intended design (alerts are the saved-place memory; one logical key, one
row).

```
05:59:53  Wael : "When I arrive to Costco, pay I at Costco."
06:00:12  [Voice/memory-hit] name-match for "Costco" -> rule 916c25bd
                             (enabled=false, mode=one-time) — skipping resolve-place
06:00:12  Naavi: "Your Costco arrival alert is expired. Want me to re-enable it?"
06:00:21  Wael : "Yes."
06:00:26  [pendingRearm] reactivate rule 916c25bd → ok
06:00:26  Naavi: "Re-enabled your Costco."
06:00:43  Naavi: "You have 1 active alert. 1. Costco."          (2034 ms)
```

Rule `916c25bd-393c-42a4-ac5f-77ef582c156d`, now `enabled: true`:

```
trigger_config: Costco, 1405 Blair Towers Pl, Ottawa — arrive, 300 m, 45.4356743 / -75.6030379
action_config : {"body":"Reminder: Pay at Costco.","tasks":["Pay at Costco"]}
```

**Wael confirmed the stored content is what he asked for.** No new rule was created; no duplicate.
No picker appeared, correctly — the name-match skips `resolve-place` when an existing rule already
holds coordinates. Verified in the app by Wael as active, and listed correctly by voice.

**A finding was raised here and withdrawn.** Claude asserted the stored body differed from the
request, on the assumption Wael had used the wording Claude scripted for him. He had not. The
transcript showing different words was read as speech-to-text mangling rather than as evidence of a
different request. **The evidence was real; the conclusion covered more ground than it supported** —
the same shape recorded in Architecture Reference §2e. The correct move was to ask what he said.

**One observation kept, without claiming it caused harm here:** the reactivation readback is
hardcoded at `src/index.js:11627` as `` `Re-enabled your ${label}.` `` — it names the label and
nothing else: no message text, no address, no direction. Rule 12 asks for a readback naming every
resolved input. **On this call the stored content was correct, so nothing went wrong.** It is
recorded as an observation about what the caller can verify, not as a demonstrated defect.

---

## Candidate findings — NOT items, NOT numbered as holding-list IDs

### A — Saying "stop" silences the answer to your *next* question

Call at 05:23. Wael said "Stop, Naavi" to interrupt her, then asked a new question. The answer to
the **new** question was computed correctly and never spoken.

```
05:24:17  transcript="Stop, Navi."
05:24:17  [B11f] pause while composing — reply will be held
05:24:23  [Deepgram] FINAL: "What alerts do I have?"
05:24:36  [MediaStream] Stream stopped            ← caller hung up
05:25:17  [ARCH-1] Level A answer in 104090ms
05:25:19  [B11f] answer held (69 chars, 0 bytes spoken)
05:25:19  [B11f] reply born held — pause arrived while composing
```

The held answer was correct: *"You have 1 active alert. 1. Text me in 5 minutes saying good
morning."* The pause was aimed at her previous sentence; it swallowed the reply to the question
asked **after** it. Nothing tells the caller a reply is waiting, and releasing it requires knowing
to say a resume word.

**Confirmed in both directions.** A retest that avoided "stop" answered normally.

### B — The listing turn intermittently takes ~110 seconds

Call at 05:34, no pause involved.

```
05:34:52  turn starts — "List me the alerts that I have."
05:35:08  fetchLiveCalendarEvents — 16623ms
05:35:10  searchKnowledgeSpecific — 18345ms
05:35:15  [MediaStream] Stream stopped            ← caller hung up, 23s in
05:35:31  T6 Claude stream complete +39188ms      (Claude itself: 3645ms)
05:36:42  T8 TTS stream start +110416ms
05:36:42  [TTS] Cannot stream — WebSocket not open
05:36:42  [Process] TTS stream failed — no audio sent
```

**The same two lookups on the earlier turn of the same call took 1008 ms and 2262 ms** — 16× faster,
ninety seconds apart, same code and same account. Claude was not the bottleneck at 3.6 s. A further
**71 s** sits between T7 and T8, where the LIST_RULES action executed and rewrote the speech.

**Intermittent, not constant:** the 05:48 retest answered the same question in 2325 ms. Any fix
attempt must account for that — one fast run is not evidence the cause is gone.

### C — Speech-to-text dropped the front of an utterance; Naavi answered a greeting

```
05:47:06  transcript="Me hello."
05:47:27  final_speech="Hey Wael! How can I help you today?"
```

Wael's opening request reached Claude as **"Me hello."** and was answered as a greeting. His second
attempt went through. Matches the existing `project_naavi_deepgram_first_word_truncation` and
`project_naavi_stop_word_regression` memories — a fresh production instance of that shape.

### D — A confirmation request that names nothing, and a "yes" that approves nothing

```
05:47:38  Wael : "Set alert in five minutes Tell me hello."
05:47:48  Naavi: "I need your confirmation before I can make that change.
                  Please say yes to confirm."
05:47:57  Wael : "Yes."
05:48:06  Naavi: "I'll set up: Text me in 5 minutes saying Hello.
                  Say yes to confirm, no to cancel, or tell me what to change."
05:48:18  Wael : "Yes."
```

Mechanism — `naavi-voice-server/src/index.js:3997`:

```
[Claude] B4y Phase 2: dropped [SET_ACTION_RULE] — not a valid confirm-turn.
         userText="Set alert in five minutes Tell me hello."
```

Claude emitted the action on the first turn without asking. The B4y Phase 2 gate saw the prior
assistant message was not a confirm-ask, **discarded the action**, and substituted the fixed
sentence.

**The gate is not the defect — it correctly prevented an unconfirmed write.** The defect is the
sentence:

1. **It names nothing.** "That change." CLAUDE.md Rule 12 requires a pre-confirmation to state the
   specific commitment naming every resolved input. **The guard enforcing Rule 12 emits a message
   that violates Rule 12.**
2. **The first "yes" approves nothing** — the action was already discarded. It teaches a caller that
   "yes" is what you say before knowing what you are agreeing to, which is the exact habit the
   readback rule exists to break.
3. **It costs a whole turn**, on a surface where turns ran 8–20 s that night.

**Not consistent.** The gate fired on the 05:47 call and **not** on the 05:23 call, for the same
kind of request, with no code change in between. Governance's Non-Determinism Rule applies: one
call each cannot establish how often this happens.

**Wael's note, 2026-08-28:** *"I noticed that but I did not bring it, it is very important to
record it."* He saw it live and had not yet raised it.

### F — The alert fires more than once. Wael received THREE emails for one alert

**Found by Wael from his own inbox**, not by any check here — three emails at 05:29 for the first
alert, two at 05:52 for the retest.

**Server side, the fan-out ran three times.** `sent_messages`, all stamped the same second, each
with a **distinct** Twilio SID:

```
05:29:04  voice ×3   sms ×3     (+ 3 emails, per Wael's inbox)
05:52:27  voice ×2   sms ×2     (+ 2 emails)
```

**And `action_rule_log` recorded ONE fire each:**

```
05:29:06  rule 59083329  ref 2026-08-28T05:27:00-04:00
05:52:27  rule 4e784312  ref 2026-08-28T05:52:00-04:00
```

**Mechanism — `supabase/functions/evaluate-rules/index.ts:136-172`:**

```
SELECT id FROM action_rule_log WHERE rule_id=? AND trigger_ref=?   ← read
if (existing) continue;
await fireAction(...)                                              ← SENDS EVERYTHING
INSERT INTO action_rule_log {rule_id, trigger_ref}                 ← write
```

Read, send, write — three separate network round-trips. **Any concurrent invocation that reads
before the first one writes passes the dedup check and sends the whole fan-out again.** The single
log row proves the INSERT is protected by a constraint; the sends are not, because they happen
first.

**This is the same defect class as the voice-PIN counter in Architecture Reference §2c**, whose
recorded lesson is exactly this: *"An entry point talking to the database across the network cannot
make a read-modify-write atomic; only the owner of the data can."* That one was fixed by collapsing
the operation into a single atomic Postgres function. This one has not been.

**Blast radius.** The per-rule rate limit is 20 fires/hour, so the ceiling is twenty duplicate
fan-outs per rule per hour — and the code's own comments name the Hussein 100+ pushes incident as
what the dedup exists to prevent. The rule was due at 05:27:00 and fired at 05:29:04, two minutes
late and then all at once, consistent with invocations queueing and running simultaneously.

**⭐ Scope, corrected by Wael 2026-08-28 — user-visible duplication was EMAIL ONLY.** His phone
showed **one** SMS and **one** call per fire. Twilio's API reports all three SMS "delivered" and all
three calls "completed" with real durations, and his handset disagrees. **His phone is the ground
truth for what a user experiences; Twilio's records are evidence of what was sent. Both stand, and
the gap between them is unexplained — no cause is offered here rather than inventing one.**

Claude initially reported this as "three phone calls and three texts," reading the database rows as
delivery. That was wrong and is corrected here. **What is not in question is the server-side triple
fire, which the rows and the single log entry prove independently of any delivery question** — along
with three Twilio charges per fire.

**Not yet determined:** whether duplicate cron entries drive `evaluate-rules` (Configuration
Discipline Rule 1's exact scenario) or whether a slow run overruns the one-minute cadence and
invocations overlap. Answering it needs `SELECT jobname, schedule, command FROM cron.job` in the
production SQL editor — no production database credentials exist here, by design (§0c).

### G — The two fan-out functions disagree about whether channel preferences exist

Proven by grep and by live sends on the same account, the same night:

| Fire | Function | Reads `alert_channels_enabled`? | WhatsApp |
|---|---|---|---|
| 05:29 time alert | `evaluate-rules` | **yes** — selected at `:766`, gated at `:781` | not sent |
| 06:23 Costco | `report-location-event` | **no — zero occurrences in the file** | sent (`MM6c0c9693ce95f6`) |

This is Architecture Reference **Priority 1b** recurring: the two fan-out implementations are
independently maintained with only a code comment holding them together, and one of the three drift
incidents already recorded against it is *"B10d's channel-preference gap."* **It was closed in one
function and left open in the other.**

**The location fire was otherwise clean** — one voice, one SMS, one WhatsApp, one
`action_rule_log` row, rule correctly `one_shot`-disabled at 06:23:15. Whatever causes F does not
affect the location path.

### H — Settings shows WhatsApp ON while storage has it OFF ⭐ the most consequential so far

**Wael checked the toggle at Claude's request: WhatsApp is ON in Settings.** Storage, read twice,
is `["email","push","voice_call","sms"]` — no WhatsApp. Row last written **06:26:25 EST**, still
without it.

**The cost, from tonight's own data:** Wael reported test 1 arrived "on all channels." It did not.
`evaluate-rules` honoured storage and silently skipped WhatsApp, and the app gave him no way to know.
The location alert then sent WhatsApp — not because the setting said so, but because that function
reads no setting at all.

**Why this outranks G.** G is two functions disagreeing with each other. **H is the product
disagreeing with the person using it.** A user who switches a channel on, sees it on, and is never
told otherwise will reasonably believe alerts reach them there. On the time path they do not, and
nothing surfaces the gap.

**Root cause NOT proven.** What the code shows:

- **Save** (`app/settings.tsx:366-398`) writes the full `next` array and appears correct.
- **Load** (`:298-304`) calls `setAlertChannels(saved)` **only if** the query returns an array; the
  screen's initial state is `DEFAULT_CHANNELS`, **all five** (`:172`).
- An all-five display is therefore what a failed or skipped load would look like. **This is not
  asserted as the cause** — no evidence has been gathered for it yet, and every column in the
  `:237` select was verified to exist, so the B11c missing-column failure is ruled out.

**Wael's standing point, earned tonight:** *"That is another example not trust what the DB is
saying."* Twice this session Claude read database rows as though they described what reached him —
three SMS rows against one message on his phone, then a preference column against what his screen
shows. **His phone and his screen are ground truth for what a user experiences; the database is
evidence only of what the system tried to do.** Both belong in a finding, labelled as which.

---

## Test 3 — Email trigger — PASS, negative control included

Rule `c616d38f-4834-4a5a-8193-62b29a3007bb`, created **06:38:09 EST**:

```
trigger_config: {"from_name":"Bob"}
action_config : {"body":"You have an email from Bob.","to_phone":"+16137697957"}
one_shot: false    enabled: true
```

**Negative control — the valuable half.** At 06:39:41 an email arrived from **"Linda"** with subject
*"This is about BOB appointment"*. It correctly did **not** fire: the match runs on `sender_name`,
and `"linda"` does not contain `"bob"`. Wael asked for mail *from* Bob, not mail *mentioning* Bob.
A fire here would have been the defect.

**Positive control.** A genuine email from display-name **"Bob"** arrived 06:42 and fired at
**06:48:18**. Wael confirmed receipt: call and SMS.

**Sync latency, measured:** the email landed at 06:42 and was not in `gmail_messages` at 06:45:36;
it appeared by 06:46:14 and fired at 06:48:18 — about **six minutes end to end**, consistent with
the 5-minute `sync-active-email-alerts` cadence plus the 1-minute `evaluate-rules` cron. Not a
defect; recorded so a future session does not read a 6-minute delay as a failure.

**Order matters and was followed:** the rule must exist before the email arrives —
`findEmailTriggers` only considers mail received after `rule.created_at`.

### F — third occurrence, and it moves the fault to `evaluate-rules` itself

```
06:48:28  voice ×3   (distinct SIDs)
06:48:29  sms   ×3
06:48:29  action_rule_log ×1
```

**Caught live while polling:** `sends=6 fires=0` at 06:48:30, `fires=1` at 06:49:01. The sends
completed before the dedup row existed.

**This instance is on an EMAIL trigger; the first two were TIME triggers.** All three run through
`evaluate-rules`. The location fire at 06:23, through `report-location-event`, was clean — one of
each. **So the race is in `evaluate-rules`, not in any one trigger type**, which narrows any fix to
that function's read-send-write sequence.

**User-visible again: one call and one SMS on the handset**, per Wael. Server-side triple, handset
single — same split as 05:29.

### H — confirmed a third time

No WhatsApp on this fire either, while the Settings toggle shows WhatsApp **ON**. Now demonstrated
across time, location and email triggers: every path that reads `alert_channels_enabled` skips
WhatsApp, and the only path that sent it is the one that reads no preference at all.

---

## Expected behaviour for the tests still to run

- **Location alerts are exempt from the voice confirmation gate.**
  `RULE23_NONEMAIL_TRIGGERS = ['time','calendar','weather','contact_silence']` at
  `src/index.js:3962` — **`location` is not in the set**, matching the shared prompt's statement
  that a location alert saves in the same turn with no confirmation. **If test 2 asks for
  confirmation, that is a new finding.**
- **"Costco" should return a picker.** No place cache; fresh Google every time, the user picks.
- **A fired one-shot rule leaves the alert list.** `LIST_RULES` filters `enabled=is.true`, so an
  alert that has already fired correctly disappears — the row remains with `enabled=false`.
