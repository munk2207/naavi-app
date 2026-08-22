# Session handoff — 2026-08-21, evening

**The one thing to read first:** T12 reached its target — **Voice Staging = Voice Production, measured
32/32 with an empty baseline.** But the session ended on an **unresolved disagreement about
production's Google tokens**, and the test that would settle it was never run. Do not act on either
side of that until it is. See §1.

---

## 1. ⛔ UNRESOLVED — production Google tokens. Settle this first.

**Claude's measurement.** `lookup-contact` on production, run three times in the last hour, for
`robert.esm.2207@gmail.com` (`8cd727da…`):

```
HTTP 500  {"error":"Token refresh failed: {\"error\":\"invalid_grant\", ... expired or revoked"}}
```

Same result for four of five production accounts:

| Account | Token row written | Probe |
|---|---|---|
| `wael.aggan@gmail.com` | 2026-08-19 | **WORKS** |
| `robert.esm.2207@gmail.com` | 2026-08-14 | invalid_grant |
| `mynaavi2207@gmail.com` | 2026-08-11 | invalid_grant |
| `mynaavidemo@gmail.com` | 2026-06-20 | invalid_grant |
| `heaggan@gmail.com` | 2026-06-18 | invalid_grant |

**Wael's evidence, live on his phone, same period.** The mobile app listed his calendar for the week,
and Settings showed Gmail / Calendar / Drive / Maps all **"✓ On — Connected"**. His position: *"this
is a live test with robert.esm.2207 accessing his calendar NOW."*

**Claude's reading of why those two are compatible** — both checked, neither is opinion:

- **Settings does not test the token.** `lib/calendar.ts:45` `isCalendarConnected()` returns true on a
  localStorage flag, else on **whether a row exists** in `user_tokens`. It never calls Google. Robert
  has a row, so it shows ✓ On regardless of validity.
- **The calendar list did not need Google.** Production's `calendar_events` holds 4 matching
  `💊 Amoxicillin` rows for Robert, including the 9:00 AM and 9:00 PM entries on his screen. They are
  `SCHEDULE_MEDICATION` events Naavi wrote locally.

**This is recorded as UNRESOLVED, not as Claude being right.** Wael pushed back twice and was correct
three separate times earlier in the session when Claude gave account-level facts an
environment-shaped meaning. His instinct has the better track record today.

**⭐ THE DECISIVE TEST, NOT YET RUN.** On the mobile app, ask Naavi to **search Gmail** —
*"find my last email from Google."* Gmail search cannot be served from `calendar_events` or any local
cache; it must reach Google.
- **Real emails come back** → the measurement is wrong, and why needs finding.
- **It fails or returns nothing** → the token is dead and the Settings screen reports a connection it
  never verified.

**A hypothesis that fits the dates and is worth checking either way:** Google expires refresh tokens
after **7 days** when an OAuth consent screen is in **"Testing"** publishing status rather than
"In production". Aug 19 → 2 days → works. Aug 14 → 7 days → dead. Everything older → dead. Every
data point falls on the correct side. **Confirm or kill it by looking at the consent screen's
publishing status in Google Cloud Console, project `naavi-490516`** — a page Claude cannot read.
If true it is a product-level defect: every user's Google connection dies a week after they connect.

---

## 2. T12 — target reached, Phase 7 incomplete

**The controlling question, set by Wael and kept at the head of every phase document:** *what prevents
Voice Staging from being a functional replica of Voice Production at the starting equilibrium?*

**Answered, and then demonstrated:**

```
parity:verify — identical 32   DIFFERENT 0   one-sided 0
baseline: "accepted": {}   (empty — no difference needed an excuse)
```

**Phases 0–6 complete and approved.** Phase 3 and Phase 6 both returned *Approved*, Phase 6 with four
PASS verdicts. **Phase 7 is incomplete** and Phase 6's approval was explicitly conditional on it.

**Phase 7 automated half: GREEN.** 528 tests, 522 passed, 0 failed, 0 errored, 1 timeout (LLM
latency — a different test each run), 5 environmental skips. All six T12 tests pass, including the T0
gate, which went green because `create-contact` was genuinely repaired, not because a test was
weakened.

**Phase 7 live checks — three still not run**, and they need a phone:

| Check | Verifies | Status |
|---|---|---|
| Voice call → SMS alert, both lines | guard inert on production | **DONE**, both delivered |
| Production call → add a contact | B11j promotion; step 6 of the equilibrium test | **BLOCKED by §1** |
| Demo line "stop" (1-888-916-2284) | D4 — was a 404 on production | not run |
| A push notification | D3's added DB read | not run |
| Mobile regression | 3 functions redeployed today | not run |

**Phase 8 blocked** on four Architecture Reference updates the Phase 6 review made a hard merge
precondition: §0d's *"Nothing compares deployed Edge Function code between projects"* (now false),
§0c's drift-check blind spot, §0b's stale line reference (`:7224` → `:7624`), and §0b's overstated
claim that the guard sits on *every* send path.

### What T12 built

- **`scripts/deploy-edge-function.js`** — refuses to deploy a function whose source is uncommitted.
- **`scripts/edge-function-parity-check.js`** — `parity:check` (fast tripwire, pre-push, states in its
  own output that it is **not** proof) and `parity:verify` (downloads deployed source from both
  projects and diffs it — **the only output entitled to claim equilibrium**).
- Pre-push gate, empty baseline, six auto-tester tests, and a manifest.

### Deploys performed, each verified individually

`create-contact` → both. `send-sms`, `send-user-email`, `ingest-ticket`, `send-push-notification`,
`receive-demo-sms-reply` → production. **D4 fixed a live defect**: the demo line's verbal STOP had
been POSTing to a 404, so callers were told *"you won't hear from us again"* and no opt-out was ever
written.

---

## 3. The equilibrium test Wael designed and ran

**Steps 1–5 complete. Step 6 blocked by §1.** Full record: `docs/T12_EQUILIBRIUM_TEST_RECORD_2026-08-21.md`.

He rejected his own first design — break production, watch staging survive — on the grounds that
*"this same test will be valid even if we have two different platforms."* Correct: that measures
isolation, and two unrelated systems are also isolated. The test he ran instead uses a real defect and
runs **forward**: equal → change staging → test → predict → promote → verify.

**His prediction was committed before the promotion existed** (`c3d6b5e`), so it could not be fitted
to the result afterwards.

**Step 6 ran and did not produce a contact — but this is NOT a failure of the promotion.** The
production error moved from `No user found — provide JWT or user_id in body` to
`Token refresh failed: invalid_grant`. **User resolution now succeeds**, which is exactly what B11j
fixed. It then failed on the Google credential in §1.

---

## 4. Opened this session

- **[[B11j]]** — voice ADD_CONTACT sent no `user_id`, so `create-contact` could not identify the
  caller. Broken on both environments. **Fixed, validated on staging, promoted** (`55ce1d3`).
- **[[B11k]]** — **Naavi tells the caller an action succeeded when it failed.** Voice executes actions
  *after* dispatching speech (`src/index.js:13407`, `Promise.all(...).catch()`, not awaited, result
  discarded), so the outcome cannot reach the caller. **Twelve state-changing actions exposed**,
  including `DELETE_EVENT` and `DELETE_MEMORY` — destructive, ungated, silent.
  **Mobile is NOT affected and fixed this in V57.8**; the comment there describes the voice bug
  exactly. Same defect, solved on one surface, never mirrored.

**A third candidate, deliberately NOT opened.** The Settings screen reports Google as connected
without verifying the token (§1). It is the same family as B11k. It should be opened **once §1 is
resolved**, because if the token is actually alive the finding changes shape.

---

## 5. Claims Claude made this session that were wrong

Recorded because the corrections all came from Wael knowing the real state, not from any check:

1. **"Staging's Google token expired."** It was production's. Staging worked.
2. **"The two environments share an OAuth client, so authorising on one revokes the other — worth an
   item."** Wael: Google authorises an *account*; if a credential is used in a hundred places and is
   revoked, everything stops. Ordinary OAuth, not an architectural finding.
3. **"The account's Google connection is dead."** The account is fine and proved it. One stored token
   row is stale.
4. **Probing both environments to test the account.** Wael: one successful call anywhere answers it;
   the second only reports which stored copy is current. With a hundred environments it would be a
   hundred copies of the same answer.
5. **Reading the duplicate `+1 343 333 2567` row as a test hazard.** Wael has used that number across
   ten YouTube videos and it has never caused an issue.
6. **The boundary was 39 functions.** It is 32; seven were slugs inside comments.
7. **`ezbr_sha256` as a comparator** — 20 flagged differences, 15 byte-identical. Also
   **deploy timestamps**: code is deployed *before* it is committed here, so a deploy predating a fix
   proves nothing. Four claims died to these two.
8. **A T12 test of Claude's own** failed on the documentation of the rule it enforces, and the first
   description of that flaw overstated it.

**The pattern across 1–5:** taking an account-level or ordinary fact and giving it an
environment-shaped meaning, then proposing Wael change something because of it.

---

## 6. ⭐ The honest summary of where defects came from

**Every genuine defect found today came from Wael doing something physical** — calling two lines,
dictating a contact, reading his own contacts list, opening Settings. B11j, B11k, the demo-STOP 404,
and the §1 token question all surfaced that way.

**528 automated tests, three gates, two external reviews and a full governance cycle passed over all
of them.** The gates were not useless — the drift check, the schema/code check and the T0 gate each
refused something real. But none of them found what a person on a phone found in an afternoon.

---

## 7. State of the repositories

**`munk2207/naavi-app` `main`** — pushed through `c3d6b5e`. Uncommitted at session end: the Phase 7
testing record and the equilibrium-record update (committed with this handoff).

**`munk2207/naavi-voice-server`** — `main` and `staging` byte-identical in `src/`, both carrying
B11j. `main` at `55ce1d3`.

**Branch `t12/create-contact-user-id-resolution`** (`55f2d7e`) — merged; can be deleted.

**Gate status:** Gate 1 green against **staging**. **Gate 1 cannot run against production** until §1
is resolved. Voice regression 133/133. Firebase Test Lab not run.
