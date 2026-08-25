# B11o — Phase 7: Testing

**Work item:** [[B11o]] — Voice `DELETE_EVENT` sends no `user_id`
**Date:** 2026-08-25
**Scope:** **STRICTLY VOICE STAGING**
**Status:** **Deployed. Automated tests green. Manual validation RUN — 2 passed, 1 could not be exercised.**

> ### ⚠️ Tests are named, not numbered
>
> The first pass of this document numbered the manual tests 1–4, and Wael was reporting results against his own numbering from the call. **The two lists collided and a delete result was briefly attributed to the wrong test.** Named from here: **delete-existing**, **delete-nonexistent**, **cross-user**.
>
> The ambiguity was introduced by this document, not by the reporting.

---

## 1. Deployment confirmed — from the running deployment, not from the push

Architecture Reference §0d: *"do not infer a deployment from a successful push."*

| | |
|---|---|
| Deployment ID | `21446de5-d9ff-4268-b5ea-6a2eb232c1c4` |
| Status | **SUCCESS** |
| Branch | `staging` |
| **Commit hash** | **`b1575a82ec7e6a388f1e7c7415c1650591fe8bcd`** |
| Deployed at | **2026-08-25, 8:52:33 AM EST** |
| Commit authored | 2026-08-25, 8:52:20 AM EST |
| Service | `naavi-voice-staging` |

**The deployed commit hash matches the commit containing the fix.** That is the evidence — not the push succeeding, not a boot line, not a `commit=` marker.

### ⚠️ One measurement that proved nothing, recorded so it is not repeated

The first attempt to confirm the deploy polled `railway logs` for `[Boot]` lines over three minutes:

```
check 1 (t+30s):  [Boot] lines = 3
...
check 6 (t+180s): [Boot] lines = 3
```

**Stable at 3 throughout — and it would have read exactly the same if no deploy had occurred**, because the log window always contains that many boot lines. A measurement that cannot distinguish the two outcomes is not evidence of either.

This is §0d's own lesson, which names the `/` route and the `commit=` marker as things that *"briefly looked like evidence and were not."* The `[Boot]` count belongs on that list. **`railway deployment list --json`, which carries the commit hash, is the check that works.**

### Demo staging redeployed too

Per Architecture Reference §0b, `generous-tenderness-production-9235` deploys the same `staging` branch, so it received this commit as well. **Demo behaviour does not change** — action execution is unreachable from the demo line (Phase 1A §2) — but the redeploy is real and is recorded rather than omitted.

---

## 2. Automated tests — PASS

### Voice repo suite

```
ℹ tests 162
ℹ pass 162
ℹ fail 0
```

Four of those are B11o's:

```
✔ DELETE_EVENT resolves the caller before deleting
✔ DELETE_EVENT sends user_id in the request body
✔ DELETE_EVENT never reverts to the identity-less body that caused B11o
✔ DELETE_EVENT reports a no-match delete as a failure, not a success
```

### Verified in both directions

Run against the pre-fix source (`git show HEAD:src/index.js`), all four **FAIL**. Against the fixed source, all four **PASS**. The test catches the original defect *and* the false-success defect the fix could have introduced.

### Pre-push lint gate

```
[pre-push] checking for calls to things that do not exist...
[pre-push] clean.
```

### What automated coverage cannot reach

These are **source-assertion** tests — `src/index.js` has no `module.exports` and cannot be imported without booting a server. **They prove the two lines exist. They do not prove a delete succeeds end to end.** That is §3's job, and Governance Phase 7 is explicit: *"Passing automated tests alone is not sufficient"* — manual validation is mandatory for voice.

---

## 3. Manual validation — RUN by Wael, 2026-08-25, on +1 343 504 1572

### delete-existing — ✅ **PASS**

Asked Naavi to delete a real meeting. She read the details back, asked for confirmation, he said yes, she said *"Done."* **The meeting was deleted, confirmed in Google Calendar.**

```
[Claude DIAG] tool_use name=delete_event jsonStr: {"query": "David meeting"}
[Claude DIAG] converted actions: 1 (DELETE_EVENT)
[Action] Executing: DELETE_EVENT
[Action] DELETE_EVENT result: OK
final_speech: "Done."
```

**This is the same call that returned `No Google token found` in Phase 1 §6's reproduction.** It now returns OK. **B11o's core defect is fixed, verified end to end from the user's side.**

**This also closes the regression check** — the scenario is Phase 1 §6's own reproduction, and it no longer reproduces.

### cross-user — ✅ **PASS**

Wael confirmed no other account's calendar was affected.

**Corroborating log evidence:** the same call's `CREATE_EVENT` printed `result for user f1bc46b8-a478-43ad-bf09-e138099c8847` — the staging Robert account, i.e. the caller's own `user_id`, resolved from the calling phone number. The identity being threaded through is the caller's, not an arbitrary one.

### delete-nonexistent — ⚠️ **NOT EXERCISED — the guard remains unverified live**

**Recorded as inconclusive rather than as a pass, because the user-visible outcome was correct by a mechanism this work item did not build.**

Wael asked Naavi to delete a meeting with John, which did not exist. She replied *"I don't see a meeting with John on your upcoming schedule. Would you like me to add one?"* — correct, honest, and helpful.

**But `delete_event` was never called:**

```
===== [VOICE-TURN-START] text="My meeting with John." =====
[Claude DIAG] converted actions: 0 (none)
final_speech: "I don't see a meeting with John on your upcoming schedule..."
```

**Claude answered from the live calendar context, which the voice turn fetches before every reply** (`fetchLiveCalendarEvents`). The request never reached `executeAction`, so `delete-calendar-event` was never called, so `{ success: true, deleted: 0 }` was never returned, so **the guard added by the Phase 3 mandatory change never ran.**

#### Why this is hard to test deliberately, and what it means

The guard fires only when Claude *does* emit `delete_event` and Google's own event search then matches nothing. That requires the calendar context Claude reads and the search `delete-calendar-event` performs to **disagree** — different query mechanisms over the same calendar. Possible (stale context, title tokenisation, an event outside the fetched window), but not straightforward to force on demand.

**Current coverage of the guard:**

| Layer | Covers it? |
|---|---|
| Source-assertion test (`test/deleteEventUserId.test.js`) | ✅ Asserts the guard is present and would fail loudly if removed |
| Live behavioural evidence | ❌ **None** |

**This is a declared coverage gap, not a silent one.** The guard is defensive: it changes nothing on the paths exercised today, and it prevents a specific false-success on a path that is real but rare. **Whether that is acceptable to ship is Wael's call, and it is recorded here so the decision is made rather than assumed.**

**What it does NOT undermine:** the identity fix, which is the whole of B11o's original defect, is verified live by delete-existing.

---

## 4. Gate status

| Gate | Applies? | Status |
|---|---|---|
| **Gate 1** — `npm run test:auto` | **No** — gates *production AAB builds*, not staging voice deploys | Red, from the parked [[B11z]]. Flagged so it is not mistaken for a blocker here, and not forgotten if a mobile build is ever wanted. |
| **Gate 2** — voice regression | Yes, before any production promotion | Not run |
| **Gate 3** — Firebase Test Lab | No — no mobile artifact in this work item | N/A |

**No production AAB and no production voice promotion is in scope for B11o.** Phase 0 confined this to voice staging.

---

## 5. Findings during testing — reported, NOT investigated, NOT fixed

Per Wael's standing instruction: findings go to the general list, work stays on the priority item.

### ⭐ Naavi contradicts herself about the current time, in one sentence

Asked to add a meeting at 6 PM, at 9:00 AM, she said — verbatim from the log:

> *"**It's already past 6 PM today** — the current time is 9:00 AM, so **6 PM today is actually in the future**. I'll add Meeting with John to your calendar today at 6 PM. Say yes to confirm, no to cancel, or tell me what to change."*

**She asserts a false statement, then corrects it mid-sentence.** The caller hears "it's already past 6 PM" first and has to wait for the reversal.

**The action was correct** — `CREATE_EVENT` fired with `start: 2026-08-25T18:00:00` and the event was created properly. **This is a speech defect, not an action defect**, which is what makes it easy to miss.

**Not investigated and not fixed** — outside B11o's scope. **For the general list**, with this quote as the evidence.

### `[Action] DELETE_EVENT result:` does not log which user it resolved to

`CREATE_EVENT` logs `result for user f1bc46b8-…`. The `DELETE_EVENT` line implemented in Phase 4 logs only `OK` or the error.

**For a fix whose entire subject is multi-user identity, the user id is the single most useful thing that line could carry** — and the change did not add it, despite the sibling case two screens away doing exactly that.

**Not fixed.** Doing so now would mean another edit, commit, deploy and re-test cycle, invalidating the evidence above for one log field. **For the general list.**

---

## 6. Phase 7 verdict

**PASS, with one declared coverage gap.**

| | |
|---|---|
| Deployment | ✅ Confirmed by commit hash on the running deployment |
| Automated tests | ✅ 162/162, verified in both directions |
| **delete-existing** | ✅ **PASS** — live, end to end. **The original defect is fixed.** |
| **cross-user** | ✅ **PASS** — confirmed by Wael, corroborated by the log's user id |
| Regression (Phase 1 §6 reproduction) | ✅ No longer reproduces |
| **delete-nonexistent** | ⚠️ **Could not be exercised.** Guard covered by source assertion only |

**Phase 0's Success Criteria, assessed honestly:**

1. *Event deleted from the caller's own calendar* — ✅ verified live.
2. *Spoken reply matches what happened* — ✅ **for every path tested.** The no-match path is correct by construction and by source assertion, **but has no live evidence.**
3. *No path by which one caller's delete reaches another's calendar* — ✅ verified.
4. *Nothing else changes* — ✅ no other behaviour altered.

**The one decision Phase 8 must not inherit silently:** whether shipping the no-match guard without live behavioural evidence is acceptable. It is defensive, it is source-tested, and forcing it live requires the calendar context and Google's search to disagree on demand. **Wael's call, recorded rather than assumed.**

Phase 7 → Phase 8 requires Wael's own separate word (Governance §3, Phase-Gate Approval Rule).
