# B9x — Phase 7: Testing

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-27 |
| **Commit under test** | **`d8fc080`** |
| **Deployed to** | **Supabase staging** (`xugvnfudofuskxoknhve`) only. **Production untouched.** |
| **Governance** | v4.2, §3 Phase 7 |
| **Status** | Complete for what is testable. Closed on Wael's ruling, 2026-08-27. |

---

## 1. Deployment verified from the running function, not from the push

Per Architecture Reference §0d — a push is not a deployment.

`naavi-chat` was deployed to staging, then the **deployed source was downloaded back** and inspected:

```
await resolveLocationRecipient(   → 2 occurrences
:3474  // ── B9x — Site B (2026-08-27)
:4461  // ── B9x — Site A: Path B (Claude tool-use)
```

Both call sites are present in what is actually running. `get-naavi-prompt` was unchanged since
`fc71146` and needed no redeploy; production still serves `2026-08-20-s1-pin-six-digits`.

---

## 2. ⭐ The result that matters

**The exact request that failed 3/3 yesterday now refuses 3/3.**

*"Send sms to Abdyn when I arrive at the office"* — Abdyn is not a contact:

| Trial | Speech | Actions |
|---|---|---|
| 1 | *"I don't have a contact named Abdyn. Tell me their phone number or email directly, or save them to your contacts first."* | `[]` |
| 2 | identical | `[]` |
| 3 | identical | `[]` |

**No alert saved. Nothing to misdeliver later.** Compare `fc71146`, which returned
`action_config: {"to": "Abdyn"}` on all three trials — the exact shape of rule `bb48e478`, which
misdelivered to the user on 2026-07-19.

---

## 3. Nothing that worked before has broken

| Test | Trials | Result |
|---|---|---|
| *"Alert me at Costco"* — no recipient | 3 | **Saves, single turn, no extra question.** `action_config: {}`. The exemption is intact. |
| *"Email me at jane@x.com when I arrive at Costco"* | 1 | **Self-override preserved** — `self_override_email` set, resolution never ran (F15 Defect A). |
| *"Text Bob saying I am running late"* | 1 | **`DRAFT_MESSAGE` completely untouched** — the isolation the Phase 2 v3 reviewer required. |
| *"Every time I leave the office please notify Abdyn by sms"* | 1 | **Refuses and asks.** |

**Non-Determinism Rule:** 3 independent trials on both behaviour-changing cases (§2 and the Costco
row). Distributions were uniform — 3/3 in both directions, no variance observed.

---

## 4. Which path executed — measured, not assumed

Staging logs, filtered on `B9x`:

```
[naavi-chat] B9x: dropping location rule at Site B — I don't have a contact named Abdyn...   ×4
```

**All four drops fired at Site B — the deterministic Universal-gate path.** That is the path both
reproductions came from, the path `fc71146` missed, and the path real requests take.

---

## 5. Site A — **NOT EXERCISED. Not failed.**

**This distinction is Wael's, made explicitly on 2026-08-27, and it is the accurate one.** Site A did
not run and produce a wrong result. **It did not run at all**, so there is no result to characterise.

**Three deliberate attempts to route a request through it, and why each did not reach it:**

| Attempt | What happened |
|---|---|
| *"When I get to the office, send a text to Abdyn and also remind me to lock the car"* | Saved as a self-alert with the message to Abdyn attached as `task_actions:[{to_name:"Abdyn"}]` — **not** as the alert's primary recipient |
| Two-turn: *"I want to set up an arrival alert"* → *"the office, and text Abdyn"* | Returned a confirm ask, `actions: []` |
| …continued with *"yes"* | Same `task_actions` shape as the first |

**The cause is the prompt working as designed.** `get-naavi-prompt:1217` — the LOCATION SELF-ALERT
PRIMARY RULE — instructs that a location alert carrying a third-party send keeps the alert as the
user's own and attaches the message as a task. So on this path a named person lands in
`task_actions`, which the Phase 6 reviewer **deliberately excluded** from B9x's scope.

**What this means, stated plainly rather than dressed up:** Site A's check is a **guard on a shape
that path rarely produces**, not a live route. It contains the identical function proven three times
at Site B. **It is covered and unwitnessed — those are different things, and only the second one is
being claimed here.**

**Wael's ruling:** record as a known coverage gap and close Phase 7. Do not manufacture a request
shape real users do not make in order to tick it off.

---

## 6. Three branches that cannot be tested on staging

The **successful**-resolution branches need contacts to exist. Google **is** connected on the staging
account (`user_tokens`, provider `google`, token refreshed 2026-08-21), but that account has no
contacts — every probe (`Bob`, `Sam`, `Huss`, `Wael`, `Fatma`) returns `not_found`.

| Untested branch | Proven by |
|---|---|
| Name resolves to one contact → saves single-turn with the number filled in | code + static test only |
| Two contacts share the name → asks for the full name | code + static test only |
| Contact has an email but no phone, on an email alert → fails closed | code + static test only |

**The success path — the common case for real users — has never run live.** It is not claimed as
proven. Adding a single contact to the staging Google account would unlock all three.

---

## 7. Static suite

**14 of 14 pass**, including the three added after the `fc71146` failure: both call sites present and
counted, `buildActionConfirm` still synchronous, and `DRAFT_MESSAGE` unaffected at Site B.

Run standalone. **Gate 1 is still not claimed** — `npm run test:auto` defaults to production and its
fixtures delete rows.

---

## 8. Side effects of testing

**None.** `naavi-chat` returns actions; the mobile client is what writes them, and no client was
involved. Confirmed by query: the only location rule on the staging account predates this work
(2026-08-05) and is disabled. **No rows created, none modified, none deleted.**

---

## 9. What remains before Phase 8 can close B9x

1. **The Architecture Reference must be updated** — a hard merge precondition set by the Phase 6
   reviewer under Architecture Drift Outcome 2. `naavi-chat` is now a third `resolve-recipient` call
   site, and §2b still says two. **Not yet done.**
2. Phase 8's own version check against the Reference.
3. Wael's explicit go-ahead for the transition.

**Production deployment is a separate decision and is not part of Phase 8.**
