# T12 — Phase 7: Testing Record

**Work item:** [[T12]] — Voice environment equilibrium
**Date:** 2026-08-21
**Status: PHASE 7 COMPLETE.** Automated half green (522/528 on staging). Four live checks passed;
**check 3 closed on partial evidence by Wael's explicit Governance §3 decision, 2026-08-22** — see
§2c. **Check 2 — the one the equilibrium test hinged on — PASSED** on the criterion committed before
the promotion existed. Phase 6's approval was conditional on Phase 7 completing; it has.

**Phase 8's own precondition is already discharged** — the four Architecture Reference corrections
landed at version `2026.07.18.9` (`9845182`, amended `fee91c2`).

**Two things this record does NOT claim, stated here so the summary is not read as broader than it
is:** `ingest-ticket` and `send-user-email` were redeployed and **never exercised** (§2d), and the
spoken-word half of check 3 is unproven (§2c).

---

## 1. Automated — GREEN on staging

**Final run, 2026-08-21, banner-confirmed `Testing against: STAGING (xugvnfudofuskxoknhve)`:**

```
Naavi Auto-Tester — 528 tests
✓ 522 passed   ✗ 0 failed   ⨯ 0 errored   ⧗ 1 timed out   ○ 5 skipped
Duration: 456.6s
```

**All six T12 tests pass**, including the T0 gate, which was correctly red before `create-contact`
was repaired:

```
t12.create-contact.service-role-body-userid-resolves … PASS
t12.boundary.excludes-comment-only-mentions          … PASS   (voice platform, Gate 2)
t12.parity-check.declares-itself-not-proof           … PASS
t12.parity-gate.wired-into-pre-push                  … PASS
t12.deploy-wrapper.refuses-uncommitted-source        … PASS
t12.parity.normalization-ignores-formatting          … PASS
```

**The 1 timeout is not a defect.** Two runs produced timeouts in *different* prompt-regression tests
(`chain-store-tim-hortons`, then `b6d-display-uses-numbers-not-bullets`), both at the 30s cap. That
pattern is LLM latency, not a broken assertion.

**The 5 skips are environmental** — the test account has no qualifying calendar event and no contact
with a birthday on file. Each skip states its own reason and its coverage gap.

### 1a. Three runs, and what changed between them

| Run | Result | Cause of the non-green |
|---|---|---|
| 1 | 520 pass / 2 error / 1 timeout | one real defect (T0 gate), one defect in a T12 test |
| 2 | 507 pass / 8 error | **all eight** downstream of one expired Google token |
| 3 | **522 pass / 0 error** | — |

**Between runs 1 and 3 two things were fixed** — `create-contact` was repaired on both environments
(turning the T0 gate green legitimately, not by weakening it), and a defective assertion of mine was
corrected. **Neither fix touched a test to make it pass.**

### 1b. The token incident, and the three ways I mischaracterised it

Run 2's eight errors all traced to `invalid_grant — Token has been expired or revoked`. Recorded
because the misreadings are more instructive than the incident:

1. **I reported it as "staging's token expired."** It was **production's** stored token. Staging's
   worked, verified by direct probe.
2. **I framed it as an environment-parity hazard** — two projects sharing one OAuth client, so
   authorising on one could revoke the other. **Wael's correction:** Google authorises an *account*.
   If a credential is used in a hundred places and access is revoked, everything stops. That is
   ordinary OAuth, not an architectural finding, and writing it up would document the obvious as a
   discovery.
3. **I said "the account's Google connection is dead."** The account is fine and proved it — staging
   authenticated as `mynaavi2207@gmail.com` against Google and returned a real contact. What is
   rejected is **one stale row** in production's `user_tokens`, last written 11 August, while
   staging's row for the same account was rewritten the same evening.

**And the deeper correction, also Wael's:** probing both environments never tested the account at
all. One successful call anywhere answers "is the account authorised?" Testing the second only
reports which stored copy is current — bookkeeping. With a hundred environments it would be a
hundred copies of the same answer.

**The pattern in all three: an account-level fact given an environment-shaped meaning it does not
have.** Same error as reading a duplicate phone-number row as a test hazard on a number that has
worked across ten videos.

**What actually follows, and it is one line:** production's `user_tokens` row for
`mynaavi2207@gmail.com` needs a fresh token before **Gate 1 can be run against production**. That is
a prerequisite for a production AAB. It is not a defect and needs no item.

---

## 2. Live checks — the part Phase 7 exists for

**None of these has been run.** Boot checks proved the deployed functions *load*; they do not prove a
real send completes, and Phase 6 approved on that condition.

| # | Check | Verifies | Status |
|---|---|---|---|
| 1 | **Voice call → SMS alert, both lines** | `send-sms` guard genuinely inert on production | **DONE** — both delivered; staging sent from its own number, the deliberate caller-ID divergence |
| 2 | **Production call → add a contact** | the promoted B11j fix; step 6 of the equilibrium test | **✅ PASSED** — see §2a |
| 3 | **Demo line "stop"** (1-888-916-2284) | D4 — `receive-demo-sms-reply`, which was a 404 on production | **CLOSED on partial evidence — Wael's decision, 2026-08-22.** See §2c |
| 4 | **A push notification** | D3's added `user_settings` read did not break delivery | **✅ PASSED** — see §2b |
| 5 | **Mobile regression pass** | mobile calls three functions redeployed today | **✅ PASSED** — see §2d |

### 2a. Check 2 — PASSED, on the criterion recorded before the promotion existed

**Two calls were made, and they had different outcomes for different reasons. Read both — the first
one looks like a failure of the promotion and is not.**

**Call A — FAILED, and not because of B11j.** From `+13433332567`, 2026-08-21 evening. Dictated
*"John, phone 12345, email john@gmail.com"*, confirmed, heard **"Saved."** Nothing was created.
The production log resolves the caller and then shows the cause:

```
[Voice] Incoming call from "+13433332567" to "+12495235394"
[Context] User ID resolved by phone +13433332567: 7739bab9-bfb1-4553-b3f0-3ed223e9dee8
[Action] Executing: ADD_CONTACT
[Action] ADD_CONTACT result: { error: 'Token refresh failed: invalid_grant' }
```

**User resolution SUCCEEDED — which is precisely what B11j fixed.** The call then died on the Google
credential for that account, whose production `user_tokens` row was last written 2026-08-11 (10 days
old). Confirmed independently by probing `lookup-contact` for the same account. `[fetchLiveCalendarEvents]
token refresh failed` also repeats throughout the whole call, from the same dead token.

**Call B — PASSED.** From `+16137697957`, which resolves to `788fe85c…` (`wael.aggan@gmail.com`) —
Naavi greeted him as *"Wael"*, not *"Robert"*. Dictated *"Linda, phone 12345, email linda@gmail.com"*:

```
[Claude DIAG] tool_use name=add_contact jsonStr: {"name": "Linda", "phone": "12345", "email": "Linda@Gmail.com"}
[Action] Executing: ADD_CONTACT
[Action] ADD_CONTACT result: { success: true, resourceName: 'people/c6500953237091116222' }
```

**Verified in Google, not just in the log.** `lookup-contact` re-queried live at 11:11 p.m. EST
returned `Linda · 12345 · Linda@Gmail.com · people/c6500953237091116222`. Google's own docs state
`people.searchContacts` covers *"the authenticated user's grouped contacts"* — the ordinary contact
list, not the hidden "other contacts" bucket — so the record is where a person would see it.
**Wael then confirmed it visually in his own Google Contacts.**

**That is the pass condition from `c3d6b5e`, met exactly:** *a contact bearing the digits dictated.*
Not what Naavi said — [[B11k]] means her wording could not settle it either way, and in Call A it
actively misled.

**⭐ Why Call B initially read as a failure, and this is worth carrying:** Wael reported
*"nothing added"* because he was looking at Robert's contacts. The call came from **his own** number,
so the contact went to **his own** Google account. Neither the log nor the spoken reply says which
account it landed in. **On production both `7739bab9` and `8cd727da` are named "Robert" in
`user_settings.name`, so the greeting cannot distinguish accounts either.** A contact-creation
readback that named the destination account would have removed the whole ambiguity.

**One defect found while running this check, now tracked as [[B4z]] (restored to the holding list,
`33fef96`):** Call A asked *"Say yes to confirm"* and waited; Call B executed in the same turn with
no confirmation at all. Neither behaviour is required — `add_contact` is absent from the prompt's
RULE 23 scope AND from its exempt list, and the voice server's gate only fires at **two or more**
state-changing actions (`src/index.js:12086`, `…length > 1`). The confirmation in Call A was Claude's
discretion, not a guarantee.

### 2b. Check 4 — PASSED

Sent 2026-08-21, 11:25:34 p.m. EST, to `788fe85c…` on production:

```
HTTP 200  {"success":true,"sent":1}
```

`sent: 1` proves the function ran, resolved the user, performed **D3's added `user_settings` read**,
found one live token and had it accepted by Firebase. It does not prove delivery to the handset —
that last hop is only observable by the user. **Wael confirmed receipt.** D3's added read did not
break delivery.

**Prerequisite that mattered:** a push token for that account was registered at 10:44:26 p.m. EST
the same evening. Under [[B11i]] a token only lands on app launch, so a stale-token account would
have produced `sent: 0` and looked like a D3 regression when it was not.

**Noted, not acted on:** production holds **148** `push_subscriptions` rows, the large majority
belonging to two accounts and clustered in late June. That is [[B11i]]'s dead-token accumulation
half, already tracked.

### 2d. Check 5 — PASSED, and it found a defect on the way

**Scope, from Phase 2's regression matrix:** *"Mobile — YES, as a regression surface only, not a
target. Mobile calls `send-sms`, `send-push-notification` and `ingest-ticket`."* Not a mobile parity
investigation — a blast-radius check on functions T12 redeployed.

**Result.** Wael sent a text from the production app to his own number. Recorded on production at
2026-08-21, 11:53:18 p.m. EST:

```
channel   "sms"
to_phone  "+16137697957"
body      "Hello"
user_id   "788fe85c-…"
source    null
```

**`source: null` is the field that makes this the mobile path.** Every other recent row carries
`source: "alert"` — server-side firing from `evaluate-rules` / `report-location-event`. A null source
is the client. So `send-sms` v50 was exercised from the app, end to end, and **Wael confirmed the
text arrived on his handset.**

**Coverage of the three named functions, stated honestly:**

| Function | Exercised post-deploy | How |
|---|---|---|
| `send-sms` | ✅ from the app | this check |
| `send-push-notification` | ✅ from the mobile path | check 4; `lib/push.ts:197` is the client call site |
| `ingest-ticket` | ❌ **not exercised** | zero ticket rows since the 4:26:47 p.m. deploy |
| `send-user-email` | ❌ **not exercised** | zero email rows since deploy |

**Two of four are unexercised.** Both are additive-with-guard-inert like the other two, and no
behaviour change is expected — but "expected" is not "observed", and this record should not be read
as saying all four were regression-tested.

**⭐ THE DEFECT THIS CHECK FOUND — now [[B11l]].** The first attempt used the phrasing *"text me"*.
The mobile draft card rendered **`To: me (+1 438 765 0528)`** — not Wael's number. Wael did not press
Send, and asked about it. Measured directly on production for his account:

```
lookup-contact name="me"  →  AbdelMegid EL Mehelmy | +1 438-765-0528 | mehelmyam@yahoo.com
```

The two letters `me` matched inside "**Me**helmy". A real person, with a real phone number, returned
as the top hit and then **labelled "me" on the confirmation card** — so the readback asserted the
wrong recipient rather than exposing it. The digits were the only tell. Naming himself explicitly
(*"text Wael"*) resolved correctly to `+1 (613) 769-7957` and the send succeeded, which is the row
above.

**Consistent with the pattern this whole work item has produced:** 528 automated tests, three gates
and two external reviews passed over it. It was caught by a person reading a card and declining to
press a button.

### 2c. Check 3 — CLOSED on partial evidence, by Wael's explicit decision

**⭐ This is a Phase-Gate decision under Governance §3, which states that closing a phase on
alternative evidence instead of a live test "is itself a phase-gate decision and needs Wael's
explicit sign-off, not Claude's own judgment call." He gave it, 2026-08-22:** *"I do not care, if it
is broken it is OK, if it works, let someone else stop."* **No live call was made. Do not re-raise
this check.**

**What the check exists for.** The demo line is public. A stranger calls 1-888-916-2284, Naavi texts
them, and every one of those texts says *"Reply STOP to opt out."* Before D4, saying "stop" on the
call POSTed to an address that did not exist — **a 404** — so the caller heard *"you won't hear from
us again"* and **nothing was recorded anywhere.** The next demo reminder would have gone to someone
who had just declined. D4 deployed `receive-demo-sms-reply` to production so that address exists.

**Verified without a call — three of the four links, at no cost to anyone:**

| Link | Status | Evidence |
|---|---|---|
| The endpoint exists on production | ✅ | `POST` returned **HTTP 200** and valid TwiML. The 404 is gone. Probed with `Body: 'hello'` — a non-opt-out keyword, so the function ignored it and **wrote nothing**; `demo_optouts` stayed at its 1 baseline row |
| The voice server points at it | ✅ | `handleDemoStopRequest` builds the URL from `demoEnv.supabaseUrl` — per-environment config, not a hardcoded address — and posts to `/functions/v1/receive-demo-sms-reply` |
| The payload shape is right | ✅ | `URLSearchParams({ From: callerPhone, Body: 'STOP', MessageSid: '' })`, exactly what that function parses from a real inbound SMS |
| Deepgram hears the spoken word, and the write lands | ❌ **unproven** | requires a real call; not made |

**The keyword set is deliberately narrower than the SMS one:** `/\b(stop|stopall|unsubscribe)\b/i`.
The code comment gives the reason — *"cancel"/"end"/"quit" are too likely to appear in unrelated
natural speech when spoken, unlike typed.*

**⭐ One thing found while reading the path, which is NOT a reason to reopen this check but is worth
carrying:** the opt-out write is **fire-and-forget** — `fetch(...).catch(err => console.error(...))`,
not awaited. **So the caller hears "you won't hear from us again" regardless of whether the write
succeeded.** That is deliberate (a transient failure must never block someone hanging up) and it is
the right trade — but it means **the spoken sentence is never evidence that the opt-out landed.**
Same shape as [[B11k]]: a promise dispatched before its outcome exists. If this path ever needs
assurance, the assurance has to come from `demo_optouts`, never from the call.

**Residual risk, stated plainly so the decision is legible later:** if Deepgram mishears "stop", a
member of the public who declined keeps receiving demo texts, and the TCPA promise in those texts
stays unmet. The three verified links mean the failure that was actually demonstrated — the 404 — is
fixed. The unverified link is speech recognition, which is a different and pre-existing risk class
([[B10m]], [[B4b]]).

**Baseline for whoever runs this later:** production `demo_optouts` held exactly **1 row**,
`+15555550100`, a fake test number, at 2026-08-22 12:13 a.m. EST. Anything beyond that is a real
opt-out. **Do not run this check from `+1 343 333 2567`** — that number appears across ten YouTube
recordings and no code path removes an opt-out row.

### 2c-1. Corrections recorded from the discussion of this check

The demo-line "stop" check writes a real row into `demo_optouts`
(`receive-demo-sms-reply/index.ts:69`, `upsert({ phone }, { onConflict: 'phone' })`), and **no code
path anywhere removes one** — there is no un-subscribe keyword and no UI. Two enforcement points then
refuse to send to that number: `create-demo-reminder` at creation and `evaluate-rules::fireAction` at
send time.

**So running it from `+13433332567` would opt Wael's own demo number out of the demo line** — the
number used across ten YouTube recordings. **Run it from a throwaway number instead.**

**Correction, recorded because it was stated in-session:** this was first described as
*"permanently"* opting the number out. It is permanent as far as the product is concerned, but the
row is a single primary-keyed record and can be deleted with one service-role query. **It was also
implied at one point that the number was already on the list. It is not.** Measured 2026-08-21:
production `demo_optouts` holds exactly one row, `+15555550100`, a fake test number; staging holds
none. Nobody has declined, and nothing is suppressed.

**Check 3 has a real consequence to state before it is run:** it now writes a genuine `demo_optouts`
row for the calling number, because D4 fixed the path that previously wrote nothing. Before D4 the
promise *"you won't hear from us again"* was false; now it is true.

---

## 3. What Phase 7 has already produced that was not on its list

Both found by Wael on a phone, neither by any automated gate:

- **[[B11k]]** — Naavi reports success for actions that failed. Voice executes actions *after*
  dispatching speech, so the outcome cannot reach the caller. Twelve state-changing actions are
  exposed, including `DELETE_EVENT` and `DELETE_MEMORY`. **Mobile is unaffected and fixed this in
  V57.8** — the same defect, solved on one surface and never mirrored.
- **[[B11j]] confirmed and closed by promotion** — voice ADD_CONTACT sent no `user_id`. Fixed on
  staging, validated, promoted.

**This is the pattern worth carrying:** 528 automated tests, three gates and two external reviews
passed over both. A person dictating a contact into a phone found them in an afternoon.

---

## 4. Condition for Phase 7 to close

Checks 2–5 run, with results recorded here. **Check 2 in particular is judged against the prediction
recorded in `c3d6b5e` before the promotion existed** — a contact bearing the exact digits dictated,
not what Naavi says.

Phase 8 remains blocked on the Architecture Reference updates the Phase 6 review made a hard merge
precondition.
