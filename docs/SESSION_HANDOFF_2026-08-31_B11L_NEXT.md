# Session Handoff — 2026-08-31

**Next job: [[B11l]] — "text me" resolves to a stranger.** Top of the priority list, by Wael's ruling.

**Read Part 1 as fact. Do NOT inherit Part 2 as fact** — it is my reading, and this session proved repeatedly that my readings need checking.

---

# PART 1 — FACTS

## 1. Two items shipped and closed

**B12a** — the auto-tester now records which environment it tested, in the saved report and not only the console banner. `SuiteReport` gained `environment` and `projectRef`, populated from the same variables the banner prints. A report with no environment says *"not recorded — cannot be attributed"* rather than omitting the line. Three tests, verified both ways. Shipped `83a86b5`. No deploy needed.

**B11n** — a fired one-shot alert stays in today's brief reading *"Alerted at …"* instead of vanishing. **Confirmed by Wael on a device**, build 328: alert created 10:05, fired 10:09, still visible. Shipped `e739030`, closed `58258d3`.

## 2. Build 328 exists as a staging APK, and production is still on 327

Build ID `bc1a08f0-2004-4bbb-a0b3-e2da7cbfea43`, V57.99.0, versionCode 328, staging profile, installed and verified on Wael's phone.

It carries three changes committed since build 327 (2026-08-19) and never shipped:
- **T8** — stops the wasted Epic lookup in `sendToNaavi`
- **T4 Pass 2c** — VAPID key reads `EXPO_PUBLIC_VAPID_PUBLIC_KEY`; production falls through to the same literal, so production behaviour is unchanged by construction
- **B11n**

**Wael's decision, 2026-08-31: do NOT build a production AAB for these three.** A 2–3 day Google review for changes nobody is waiting on is not worth it. They wait for a bundle. **He declined a memory entry for this — do not add one.**

## 3. Epic is dead, and four of its six entry points are closed

Wael, verbatim: *"EPIC was an idea in May this year, and I stated many times that it is dead, and recorded many things to close it, however it comes again."*

Closed this session: **CLAUDE.md**'s deferred `health` trigger (now an explicit prohibition), **I3a** (moved to a new *Closed Ideas (I)* archive section), **T7**'s naming of it, and **two memory files**. Epic now appears nowhere in the open holding list and nowhere in the memory folder.

**Still present, both by Wael's instruction:** the code (76 references across four files, marked dead in their own headers) and build 327 on production. He ordered a full deletion, then reversed it — *"Can you revert back all what you did reference EPC? No DELETION."* The revert was complete and verified byte-identical; **nothing was ever committed.** No database was touched.

**What Epic actually is, so nobody re-derives it as promising:** never built — no user interface, three Edge Function folders containing only a README saying no code was ever written, and the only data anywhere is **12 rows of vendor sandbox test data on production under user id `00000000-0000-0000-0000-000000000001`, which matches no account.** Verified by reading the rows, not by counting them.

## 4. The "13 Fast items" finished at zero

Wael asked to start the Fast items. There were never thirteen.

| | |
|---|---|
| Real and shipped | B12a, B11n |
| Protected Core once checked against Architecture Reference §4 | B9s, B10i, B11v, I4b, F20 |
| TBD — root cause or scope unsettled | B9b, B9d, B10v, F22, I4a |
| Closed outright by Wael | I3a |

**F20 carried a partial waiver that had been restated as a total one.** Its row said *"waived… Phases 2/4/5/7/8 only"* — Phases 3 and 6 skipped, not governance. It also misquoted its own precedent: F10a's archive record says *"Phases 1, 2, 4, 5, 7, 8 were followed."* Wael ruled F20 **Full**.

**B9m was TBD and is now Full, on Wael's ruling.** `lookup-contact` and `resolve-recipient` are named nowhere in §4, so by the letter it read Fast — but it is one keystroke from a message reaching a stranger. **§4 is a list of files, and a list of files cannot capture consequence.**

**B10v and B9b stay TBD by Wael's ruling — *"it is safer."*** B10v genuinely passes the file test and is held anyway, deliberately. Do not re-propose either without asking him.

## 5. FOR WAEL'S EYES — new, at the top of the holding list

Every open item, one line, plain English, with **Platform** and **Fix** columns. Built because the list had grown past the point of being reviewable — his words: *"it is becoming so complex and long it loses for me the major reason of creating it."*

**Enforced by `scripts/wael-eyes-check.js`**, gate 4 of 7 in `.githooks/pre-push` (also `npm run eyes:check`). It refuses a push when an open item has no line, a line points at a closed item, one item has two lines, a line grows a backtick / path / line reference / over 240 characters, or the section is renamed. **No baseline, deliberately.** Verified failing in every direction before wiring.

**Platform is derived from each row's own Surface column and the gate checks they agree** — it is never typed twice.

**⚠️ What the gate cannot do, stated in three places so a green run is not misread: it checks a line EXISTS and is SHORT AND PLAIN. It cannot check that it is TRUE.**

## 6. Priority list — 5 of 5, now in priority order

1. **B11l** — "text me" resolves to a stranger; the card reads "To: me" beside their number
2. **B10a** — on a call, an alert meant to text a named person silently becomes a self-reminder
3. **B10c** — time defects; Instance 2 now changes the action, not only the speech
4. **B11m** — "what reminders do I have" says none while "what alerts" lists the same item
5. **S2** — two people on one phone, identified silently and inconsistently

**B12m was moved out** — on Wael's own axis it was the only entry where nothing is actually wrong.

**Row order IS the priority.** It sat in insertion order until Wael caught it: *"the Priority list should be sorted by Priority, not by anything else, why you do not sort it alphabetically."* Both tables were in *different* wrong orders. A new item goes where it belongs, not at the bottom.

## 7. Four holding-list rows were corrected because they had gone stale

- **F11a** — recorded as awaiting promotion; it has been live on production since **2026-08-20**, carried in on merge `2391241` with the S1/B11f promotion. **Nobody promoted it**, and its own field test was never run.
- **B10c** — said Instance 2 was *"a speech defect, not an action defect."* On 2026-08-31 it changed the proposed date by a full day. Instance 1 **did not reproduce** and was resolved on Wael's ruling; the row stays open on Instance 2.
- **B11i** — its counts came from staging only. Production holds **152** dead push rows to staging's 34; the demo account alone has 95, Wael's own 11 for one phone. The one prune that exists is `platform === 'web'`, and **there is not one web row in either project**.
- **B4z** — extended into the collector for the whole confirmation class.

## 8. B4z — confirmation gating is implemented four times inside voice

`list_confirm_gate.js` (2026-05-12) · B4y Phase 1 (2026-05-24) · B4y Phase 2 (2026-05-28) · `action_rule_confirm_gate.js` (2026-07-15), plus `pendingLocation`.

**`trigger_type: 'time'` is the one action type two of them both claim**, which is why a reminder takes **two "yes"** — Phase 2 drops the action on the request turn, B-1e stores it and asks again on the first yes.

**And the re-emitted action is not the one that was read back.** Turn 1's body was *"Call the firm — The Home Store Appliance Warehouses at 613-224-2484…"*; turn 2's was *"Call the firm."* The datetime held; the message did not.

**The Architecture Reference records none of this.** §5a has rows for the classifier, fan-out, outcome reporting and mobile-vs-voice turn state — none for confirmation gating built four times inside voice.

## 9. Deployment state

- Mobile production: **327**. Staging APK: **328**, on Wael's phone.
- Build clone `C:\Users\waela\naavi-mobile`: synced, 0 behind, clean.
- Voice: `origin/main` and `origin/staging` identical.
- No Edge Function deployed this session. No migration run. No database written.

## 10. Open, and deliberately NOT tracked

- **B11x's closed row notes the failed-attempt case still needs an answer** — a failed Claude call leaves no sentinel, so "never attempted" cannot be told from "attempted and failed."
- **A row can sit in entirely the wrong section and four of the five gates report clean.** Only `priority-cap-check` caught it, and only because a count changed.
- **`project_naavi_alert_scope` contains "Real senior use case"** — a banned word under the positioning rule. Left alone because the task was scoped to Epic.

---

# PART 2 — ANALYSIS (my reading; verify before acting)

## Why B11l is the right next job

Two of the top five are the same defect class: **a message that does not reach the person it was meant for.** B11l is the visible version — the card shows a wrong number, and Wael caught it by reading that number and declining to press Send. B10a is the silent version, with nothing to read.

B11l's root cause is measured, not inferred: `lookup-contact` for `name="me"` returns **AbdelMegid EL Mehelmy · +1 438-765-0528** as the top hit on Wael's production account, because the two letters `me` match inside "**Me**helmy". Google People API `searchContacts` does substring matching and nothing rejects a two-character query.

**The part I would fix first is not the matching.** It is that the card **labelled a stranger "me"**. CLAUDE.md Rule 12 requires a readback so the user can *"detect mis-resolutions immediately"* — here the safety mechanism itself produced the lie. A better matcher still leaves a readback that will confidently misdescribe the next failure.

## Errors I made this session — the pattern matters more than the incidents

**Every misclassification ran in the same direction: toward Fast, toward done, toward the cheaper answer.** That is not random error.

- I called five items Fast that were Protected Core, three of them while proposing each as "the next safe thing to start."
- I said production held *"real medical data on a real account — almost certainly yours"* from a **row count**, without reading a row. Reading them showed vendor sandbox data on a null user.
- I claimed *"45 references"*, then *"76"* — both before separating `rePick` (which contains "ePic") from real matches. Four "Epic" files were not Epic at all, including the voice server, which is Protected Core.
- I said removing a variable would *"break the build."* It would have passed the bundler and thrown on every chat send at runtime — worse, not better.
- I queried the wrong account three times looking for an alert that existed, and told Wael it did not exist.
- My first two attempts at a table edit put rows in the wrong sections, because the detail tables use `| ---- |` and my separator regex only matched `|---`. Use `/^\|\s*-{3,}/`.

**The common thread: I found something plausible and stopped.** Every one was caught by Wael asking a question, not by a check. The gate built this session catches a summary line that is missing or malformed; it cannot catch one that is simply no longer true.

## What I would do first on B11l

Reproduce it before touching anything — Rule 17. Call `lookup-contact` against Wael's production account with `name="me"` and confirm the top hit is still the Mehelmy record. The row's evidence is from 2026-08-21 and contacts change.

Then answer one question before designing: **is the readback wrong because resolution is wrong, or is it independently wrong?** If a correct resolution would still render "To: me", they are two defects and the readback is the one that matters more.
