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

## 5a. ⭐ The success path — **proven live 2026-08-27**, on a case that would have misdelivered

Originally recorded below as untestable. It was tested, once the staging Google connection was
restored and once the test stopped depending on contacts existing.

**Input:** *"When I arrive at Costco send an email to hussein.test@example.com"*

**Result:**

```json
"action_config": { "to": "hussein.test@example.com", "to_email": "hussein.test@example.com" }
```

**Saved in one turn. No question, no confirmation, no friction.** `resolve-recipient` returned
`literal_email`, the helper populated `to_email`, and the alert went straight through — exactly what
Phase 0 v3's governing principle requires of a recipient that resolves.

**⭐ And this is not merely a positive control — it is the defect, prevented.** Before `d8fc080` the
same request saved with `to` set and `to_email` **empty**, because `naavi-chat` passed
`action_config` through untouched. At fire time `report-location-event:765` computes
`noRecipient = !toPhone && !toEmail` — **true** — and `:772` classifies it as a self-alert. That is
the 19 July mechanism exactly. **The one thing that changed is `to_email` now being populated at
creation.**

**Why a literal address rather than a contact:** it exercises the same success branch of the helper
without depending on what any Google account happens to hold. The contact-lookup route to the same
branch is still unproven — §6.

---

## 5b. Correction to §6 as first written — the staging account was not empty

**§6 originally stated that the staging Google account "has no contacts". That was wrong, and it was
never checked.** It was inferred from five invented names — Bob, Sam, Huss, Wael, Fatma — all
returning `not_found`. **Five guessed names missing proves nothing about an account's contents.**

The real cause, found only when Wael challenged the claim:

```
lookup-contact → {"error":"Token refresh failed: invalid_grant — Token has been expired or revoked"}
```

**The Google connection was broken.** Wael reconnected it on 2026-08-27; `user_tokens.updated_at`
moved to 04:18 AM EST and the token error stopped.

**⭐ A finding that outlives this item, and it is in the path B9x now depends on.**
`resolve-recipient:96` returns `not_found` when the lookup returns nothing **or fails**. A broken
Google connection and a genuinely unknown person are indistinguishable to every caller. So Naavi
says *"I don't have a contact named X — save them to your contacts first"* when the contact exists
and the connection is what needs fixing. **The refusal is right; the reason given is false.**
Pre-dates B9x, affects voice identically. **No tracked item created — Rule 1b.**

---

## 6. Branches that cannot be tested on staging

The success branch itself is now proven (§5a). What remains unproven is reaching it **through a
Google Contacts lookup**, which needs a name that account's search actually returns.

| Untested branch | Status |
|---|---|
| Name resolves via **Google Contacts** → saves single-turn with the number filled in | **Untested.** The branch is proven via a literal address (§5a); the contact route to it is not. |
| Two contacts share the name → asks for the full name | **Untested.** Needs two contacts with one name. |
| Contact has an email but no phone, on an email alert → fails closed | **Untested.** Needs such a contact. |

**Attempted with a real name.** Wael supplied `Hussein Aggan`. After the reconnect, `lookup-contact`
returns `{"contact":null,"contacts":[]}` for `Hussein`, `hussein`, `Aggan`, `Huss` and
`Hussein Aggan` — an empty result, no error. Naavi therefore refuses, **which is correct behaviour
on an empty result.** Whether that contact is reachable by the search is not established here:
`lookup-contact:16` uses `people:searchContacts`, which covers **My Contacts** and not the
auto-collected **Other contacts** list. **Stated as a limitation of the search, not as a claim about
the account.**

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
