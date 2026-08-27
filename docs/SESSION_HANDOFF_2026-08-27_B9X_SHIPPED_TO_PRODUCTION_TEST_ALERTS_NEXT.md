# Session Handoff — 2026-08-27

**B9x closed and shipped to production. Next session: test Alerts and Reminders.**

---

## ⭐ WHAT THE NEXT SESSION DOES

**Wael's instruction, 2026-08-27: test the Alert and the Reminder.**

That is the task. Not a new item, not more B9x work. Live testing of alerts and reminders end to
end, with Wael driving and Claude observing — **he tests, you notice and comment. Do not run ahead
of his verdict** (`feedback_wael_tests_claude_comments`).

**Before proposing any test, read §5 — several things were ruled on today and must not be re-raised.**

---

## 1. B9x — CLOSED, in production. Do not reopen.

**The defect:** you set an alert meant to text someone else; Naavi never worked out who they were;
when it fired, the message came to **you**, worded as your own alert. The other person got nothing
and nothing told you.

**⭐ It was not theoretical.** Rule `bb48e478` misdelivered on **2026-07-19 at 7:58 PM EST** — SMS
`dcb3d6ec…`, WhatsApp `ac67c3d4…`, voice call `0352ed18…`, all to Wael's own number, body *"You've
arrived at Office."* The item's row had claimed *"not yet observed at actual fire time"* for six
weeks. **The proof was in `sent_messages` the whole time; nobody had read `select=*`.**

**Root cause was at CREATION, not at fire time.** `get-naavi-prompt:1215` tells Claude to pass a bare
name in `action_config.to` because *"the server resolves the contact"* — **no server did.**

**The fix** (`d8fc080`): `resolveLocationRecipient()` in `naavi-chat`, awaited at **both** places a
location alert is built. Resolves silently when it can; **fails closed and asks** when it cannot.

**Live in production**, verified from the running functions — deployed source contains both call
sites, prompt version matches staging, and a live request refuses correctly.

**Not covered, deliberately:** Reproduction 2 (`dadde218` — stored no recipient at all, cause
unproven) · `task_actions` recipients · the fire-time safety net Wael deferred · **Site A not
exercised (NOT failed)** · Gate 1 unclaimed · the contact-lookup route and two-contacts-same-name,
both untested.

---

## 2. ⭐⭐⭐ The lesson worth carrying, and it is not about location alerts

**The first fix was correct code on the wrong one of two execution paths.** `naavi-chat` builds a
location alert in **two** places — Path B tool-use, and a deterministic "Universal gate" that returns
~966 lines earlier. **Eleven static tests passed, `deno check` was clean, and two external reviews
approved it, while the fix sat unreachable.** Three live calls caught it in seconds.

**Now recorded in Architecture Reference §2e (revision 13). Read it before touching action creation
in `naavi-chat`.**

**The claim that caused it:** Phase 1A said *"location alerts always route through Path B"*, tagged
**freshly verified**, on the strength of a grep of `intentHandlers.ts` — a file with no location
handling at all. The grep was real; the conclusion covered far more ground.

> **A provenance tag records that evidence was gathered. It cannot record whether the evidence covers
> the claim.**

**Two more unverified claims the same session**, both caught by Wael, not by any check:

- *"Both reproduction rules are still enabled and will misdeliver"* — they were `one_shot`, had
  already fired, and had disabled themselves. `last_fired_at` was in the row. **This one materially
  misinformed a decision Wael then made.**
- *"The staging Google account has no contacts"* — the **connection was expired**
  (`invalid_grant`); the claim came from five invented names returning `not_found`.

**⭐ The reviewer explicitly ruled: do NOT add a governance rule for this.** One sentence is enough —
*state what was directly observed separately from what was inferred from it.* **Considered and
declined. Do not re-propose it as an oversight.**

---

## 3. State of the world

| | |
|---|---|
| **Priority list** | **4 of 5, one slot free** — `node scripts/priority-cap-check.js`. In order: **B11m**, **B10c**, **B11l**, **S2** |
| **Governance** | **v4.2** — the Architecture Audit Trigger can now fire more than once. **External review NOT obtained** for that change (Wael's instruction); the changelog says so |
| **Architecture Reference** | **2026.07.18.13** — §2b's third resolver call site, and new **§2e** |
| **Opened this week** | **B12b** — Naavi says *"Done, I've forgotten that"* when nothing was deleted (`naavi-voice-server/src/index.js:4689`, live on both branches) |
| **Production** | `naavi-chat` + `get-naavi-prompt` at the B9x build. Voice server **unchanged** |
| **Deleted 2026-08-26** | Both B9x reproduction rules, on Wael's ruling. Contents preserved in `B9X_PHASE0_INTENT_APPROVAL_V3_2026-08-26.md`. The three `sent_messages` rows were **not** touched |
| **Staging Google** | `robert.esm.2207@gmail.com` reconnected 2026-08-27 **4:18 AM EST** — it had been expired |

---

## 4. Two findings recorded, NO items created (Rule 1b — Wael's decision, not yours)

1. **A broken Google connection is reported to the user as "contact not found."**
   `resolve-recipient:96` returns `not_found` when the lookup returns nothing **or fails**. So Naavi
   says *"I don't have a contact named X — save them to your contacts first"* when the contact exists
   and the connection is what needs reconnecting. **The refusal is right; the reason is false.**
   Affects voice identically. **Directly relevant to testing alerts** — if a lookup fails during your
   testing, this is what it will look like.
2. **`lookup-contact` searches My Contacts only** (`people:searchContacts`), not the auto-collected
   "Other contacts" list.

---

## 5. ⭐ Ruled on — do NOT raise these again

- **The website folder contradiction** (`mynaavi-website/my-naavi-site/` vs the root). *"This
  repeated many times before… I will NOT ask you to investigate, I know."* **Dead, do not touch.**
- **The staging DB password in CLAUDE.md.** Ruled 2026-08-24, do not raise.
- **The two rules numbered 19, the Firebase step order, the stale worktree names.** All ruled *"no
  harm, leave it"* on 2026-08-25.
- **The unswept Edge Functions** (code deployed but committed nowhere). Ruled *"speculation, leave"*.
- **A new rule about observation vs inference** — see §2. Declined by the reviewer.
- **The parity audit's staleness** — closed by scoping to B9x; not a live concern.
- **`task_actions` on location alerts silently not sending.** Claude raised this as a defect;
  **Wael tested it and it works, and has video.** *"Do not bring it."* **Closed.**

---

## 6. Where things are

- **27 commits, all pushed** to `munk2207/naavi-app` `main`.
- **Memory index updated** — opens with B9x closed and shipped, the current priority order, and §2's
  lesson.
- `docs/.obsidian/workspace.json` is modified in the working tree; it predates this session and is
  not ours.
- **B9x's full trail:** `docs/B9X_PHASE*` — Phase 0 has three versions and Phase 2/3/6 two each.
  **Superseded versions are retained with headers, not deleted** — Phase 0 is the contract, and a
  contract that was wrong should show that it was.

---

## 7. One caution for the alert/reminder testing

**Testing by phoning Naavi does NOT exercise the B9x fix.** The voice server was never changed — it
already resolved recipients correctly and refused when it couldn't. B9x lives in `naavi-chat`, which
voice does not call. **Type or speak in the app** to test that path.

**And reminders are a separate engine.** `check-reminders` has its own fan-out and contains no
self/third-party logic at all — verified during B9x. Nothing in this work touched it.
