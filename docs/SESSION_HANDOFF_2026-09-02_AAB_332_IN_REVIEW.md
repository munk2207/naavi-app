# Session handoff — 2026-09-02 → next session: **AAB 332 is in Google's review**

**AAB 332 was built and submitted. Nothing is waiting on this project.** The next session's first
job is to confirm it actually rolled out — not to assume it did.
**Read Part 1 as fact. Part 2 is this session's reading — do NOT inherit it as fact.**

---

# PART 1 — FACTS

## 1. What shipped

**AAB 332 is built, submitted, and in review.** EAS build `6ef23806`, profile `production`,
distribution `store`, versionCode **332**, artifact
`fTw8vhsieqhGkpa0KpCn5Dtx0eo8YYVfElKTEF1rSno.aab`. Submitted to track **beta** (Open Testing) via
submission `3fb7ec1d`. Wael saved the release, submitted it, and the Play Console reported
*"Your changes are now in review."*

**It has NOT rolled out yet.** `eas.json` carries `"releaseStatus": "draft"`, so every AAB
submitted this way lands as a **Draft** and waits for a person. 1.0.325 stayed live throughout.
**Confirm 332 has replaced 325 before telling anyone it shipped.**

**`naavi-chat` was deployed to production** at **2:31 a.m. EST**, via `npm run deploy:fn --
naavi-chat production`, commit `f3fb0e6`, source hash `7bb559bd4222` — the same hash the manifest
already held for staging. That was handoff blocker 3.1 and it is cleared.

**Verified from the DEPLOYED source, not from the push.** Production's copy was downloaded back
and diffed against `HEAD`: both `index.ts` and `intentHandlers.ts` identical.

**Version bumped 331 → 332** in `app.json` and `app/settings.tsx`, commit `a197a3c`, pushed. All
pre-push gates green: drift check (no new separation), schema/code check (clean), parity tripwire.

## 2. Gate status for AAB 332 — state it this way, not as "all gates passed"

| Gate | Result |
|---|---|
| 1 — Auto-tester | **WAIVED** by Wael, 2026-09-02, **B11z only**. Suite stood at 574/575 |
| 2 — Voice regression | **PASSED** — 67/67, zero failed, zero errored, 94.3s |
| 3 — Firebase Test Lab | **PASSED** — `matrix-14wundhywfagf`, both devices green in the console |

**Gate 2's banner is the evidence, and it was read before the result was trusted:**

```
Testing against: PRODUCTION  (hhgyppbxgmjrwdpdubcx)
GATE 2 — VOICE ONLY
Voice server:    PRODUCTION  (naavi-voice-server-production.up.railway.app)
```

**⭐ Gate 3 passed in the CONSOLE. The script's own verdict was unearned.** It printed
`✅ PASSED` while both devices reported `outcome=undefined`; its `allPassed` check fell through to
the `state === 'FINISHED'` fallback, so it would have printed PASSED either way. It happened to be
right. **This is the exact trap CLAUDE.md 15b names, and it is still live in the script.**

**B11z is still open.** The waiver does not fix or close it, and Rule 15 is absolute for the next
AAB.

## 3. What the parity tooling does and does not cover — read before trusting it

**`npm run parity:verify` does NOT cover `naavi-chat`.** It returned 32 identical / 0 different /
0 one-sided, and that result says **nothing** about the function this session was asked about. Its
boundary is derived from `functions/v1/<slug>` call sites inside the voice server;
`naavi-chat` appears there only inside **comments** and is deliberately excluded
(`scripts/edge-function-parity-check.js:109`). Re-derived independently: `naavi-chat in boundary?
false`.

**It also compares the two projects to EACH OTHER, never to the repo.** Both being equally stale
passes clean. The check that answers "is production running the code we think" is
production-deployed vs repo `HEAD`, and it has to be done by hand.

**All 77 production functions were swept against the repo this session.** Ten had a meaningful
gap. **Every difference outside `naavi-chat` is the T2 staging outbound guard** —
`check-reminders`, `evaluate-rules`, `trigger-morning-call`, `report-location-event`,
`outbound-call`, `send-ticket-reply`.

**⛔ Do NOT deploy those six to production.** §0b is explicit that production is protected **by not
having the guard code**, not by a secret staying unset. Deploying them trades a structural
protection for a configuration invariant. They are correct as they are.

`global-search` differs only by `adapters/_interface.ts`, a **type-only** import Deno erases. Every
runtime file is identical.

## 4. The holding list was NOT edited — all five items were already closed

Asked to close S1, T4, T8, B11n and B11l. **None of them is in any open table.** All five are in
`HOLDING_LIST_CLOSED_ARCHIVE_2026-07-28.md`, and the list says so itself: line 32 records B11l
CLOSED 2026-09-01, line 20 records B11n closed on build 328.

**"Waiting for a production AAB" never meant "open."** The work was finished and closed; what was
waiting was the effect reaching real users. Treating those as the same thing would have corrupted
the list.

**Two stale things found while reading, not acted on (Rule 5 reserves this for Wael):**

1. **Line 112 contradicts line 20 in the same section** — it warns that B11x *"is still sitting in
   the open Bugs table"*, but line 20 records B11x moved to the archive on 2026-08-31 and it is not
   in that table. The warning outlived the problem.
2. **The open-item count says 55.** Not recounted this session, so unverified.

## 5. Discrepancies between CLAUDE.md and what the tools actually did

Found by running them, not by reading. **None fixed.**

1. **`scripts/submit-firebase-test.js` texted `+1 613 879 6681`**, not the `+1 613 769 7957`
   CLAUDE.md documents.
2. **The same script names Firebase project `mynaavi-3b74b`**, not `naavi-490516`.
3. **CLAUDE.md's Firebase step 3 hardcodes a GCS filename.** It was still `naavi-v311.apk`;
   bumped to `naavi-v332.apk` this session. It needs bumping every build and nothing enforces it.
4. **The Play release step in CLAUDE.md does not match the console.** There is no
   "Start rollout" on this account: the flow is **Save → Publishing overview → Submit N changes for
   review**, because `releaseStatus` is `draft`.

## 6. Observation carried out, not investigated

**The previous Test Lab matrix is dated Jul 20, 2026, and production AAB 325 shipped in August.**
Rule 15b makes Test Lab mandatory before every production AAB, so either 325's run is somewhere
that list does not show, or it was waived, or it did not happen. **Noticed in a screenshot, never
checked.** No item opened.

## 7. Still open, unchanged by this session

- **[[B11z]]** — competitor named twice in the marketing answer. Gate 1's waiver was for this.
- **[[T15]]** — staging's outbound allowlist does not track the test account's contacts. Wael's
  decision: live contact check on every staging send, no cache. Full Phase 0-8. Not started.
- The seven findings carried out of the 2026-09-01 session. **Wael ruled no items were to be
  created.** They are recorded in that handoff, §6.

---

# PART 2 — THIS SESSION'S READING. NOT FACT.

**Everything above is measured or quoted. Everything here is judgement, and the next session should
re-derive it rather than inherit it.**

**On what to do first:** confirm 1.0.332 has actually replaced 1.0.325 in Open Testing, and that
Wael's phone took the update. Everything else in this handoff assumes the release completed, and
nothing has verified that yet.

**On the parity tooling:** the honest summary is that this project owns three checks that each
answer a *different* question, and the failure mode is using one to answer another's. `drift:check`
compares schema. `parity:verify` compares the two projects to each other, across 32 of 77
functions. Nothing routinely compares deployed code to the repo — that had to be done by hand
tonight, and it is what actually found the state of things. **That gap looks worth closing, but it
is Wael's call and he has not been asked.**

**On the Firebase script:** it can report PASSED on a run where it never read an outcome. That is a
gate that can pass itself. It felt like the most consequential thing found tonight, and it was
found by reading output that had already said PASSED.

**On this session's own failures, recorded because they will recur:**

1. **Deploy timestamps were used as evidence** for blocker 3.1 — the exact comparator §0d names as
   useless, in a document read later the same session. The conclusion happened to hold.
2. **A new preview APK was built without putting the cost to Wael**, when the existing 331 APK
   differed from it by three lines, all of them the version number.
3. **He was told installs would appear in 5-15 minutes.** `releaseStatus: draft` meant they would
   never appear without him acting.
4. **A Play Console step was given that the screen contradicted** — "Start rollout" when the footer
   said Save → Publishing overview.
5. **CLAUDE.md's SMS number was repeated without checking it**, and it was wrong.
6. **He was asked for a go-ahead he had already given** ("run Gate 3"), and said so.
7. **"What functionality will be added" was answered in Edge-Function terms three times** before he
   got the answer he asked for. He had to say *"for the third time without taking me in loops."*

**Every one of these was caught by Wael asking a question, not by any check. That is the same
sentence the 2026-09-01 handoff ends with, and it was true again tonight.**
