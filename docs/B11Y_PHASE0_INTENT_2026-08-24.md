# B11y — Phase 0: Intent Approval

**Work item:** [[B11y]] — two call sites ask `sync-gmail` to sync one user and it syncs every user
**Date:** 2026-08-24
**Scope:** **Shared Core** (`sync-gmail`) **+ possibly Mobile** — see §4, which is the decision this Phase 0 exists to get
**Governance:** Full Phase 1–8 — `sync-gmail` is Protected Core (Architecture Reference §4, Gmail integration)
**Risk:** **LOW–MEDIUM.** Nothing user-visible is wrong today. The risk is in the fix: narrowing a sync that currently covers everyone could stop covering someone.

**Status:** **DRAFT — awaiting Wael's Phase 0 approval.** No mechanism approved. No code written.

---

## 1. ⭐ The root cause is not what the holding-list row says

The row — written by me during B11x Phase 1A — says two callers "pass a parameter `sync-gmail` does not read." True, but it blames the wrong end.

**Every other Edge Function in the project reads `user_id`. Only `sync-gmail` requires `target_user_id`.**

*Freshly verified this session:*

| Function | Body param read |
|---|---|
| `ingest-note`, `global-search`, `manage-list`, `lookup-contact`, `create-calendar-event`, `search-knowledge` | `user_id` |
| `naavi-chat` | `user_id` (and `target_user_id` only where it *calls* `sync-gmail`) |
| **`sync-gmail`** | **`target_user_id` only** (`:131-132` — there is no `body.user_id` branch) |

`grep -rln "target_user_id" supabase/functions/` returns exactly three files: `sync-gmail`, and the two functions that call it.

**CLAUDE.md's Configuration Discipline Rule 4** mandates one user-resolution pattern everywhere: *"(a) JWT auth, (b) Request body `user_id`, (c) `user_tokens` lookup."*

**`sync-gmail` violates Rule 4.** The callers are following the documented convention; `sync-gmail` is the outlier. That reframing matters because it changes the fix from *"correct two call sites"* to *"bring one function into line with the project's own standard"* — which is smaller, backend-only, and fixes one of the two callers outright.

---

## 2. ⭐ Correcting my own severity claim

The holding-list row and B11x's Phase 1A both call this *"a correctness and **privacy-surface** question."*

**That overstates it, and I wrote it. No user data crosses between users.** `sync-gmail` runs as service-role and writes each user's mail to that user's own rows under their own `user_id`. A sync triggered by user A does work for user B, but user A never sees user B's mail, and nothing in the fan-out exposes one account to another.

**The accurate framing:** work is performed for users who did not ask for it, at a cadence nobody chose. That is waste and semantic wrongness — not a data-protection incident. **Phase 1 must not inherit the stronger claim.**

---

## 3. What is actually wrong, and what it costs now

### The two callers

| # | Caller | `file:line` | Sends | `sync-gmail` sees |
|---|---|---|---|---|
| 3 | **Mobile app**, 60-second interval | `app/index.tsx:1269` → `:1250` → `email.adapter.ts:75-77` → `lib/gmail.ts:33` | **no body at all** | all active users, 7 days |
| 4 | `naavi-chat` email-search intent | `intentHandlers.ts:346` | `{ user_id }` | all active users, 7 days |

Caller 3's adapter is the tell: `async sync(userId: string) { await triggerGmailSync(); }` — **it accepts a user id and discards it.**

### ⭐ B11x already removed most of the cost

**This item's justification changed today.** Before B11x, each redundant sync re-sent every in-window email to Claude. Since B11x (production 7:12 PM EST), a redundant sync classifies nothing already classified.

**What remains:**

| Cost | Status after B11x |
|---|---|
| Claude calls | ✅ **largely eliminated** — that was B11x |
| **Gmail API calls** | ❌ still ~5 users × 60/hour from mobile alone — **quota pressure, not dollars** |
| Edge Function invocations | ❌ unchanged |
| DB reads/writes per sync | ❌ unchanged |

**Blast radius today: 5 users** with Google connected on production (*measured, not estimated*). So the fan-out multiplies work by up to 5×, not by thousands. **It scales linearly with beta signups** — the dormancy filter (`sync-gmail:162`, 30 days) caps it at *active* users, which is why the number is small now and would not stay small.

**Stated plainly: this is no longer an urgent cost item.** It is a correctness item with a quota tail. If Wael's priority is money, B11z and B12a are cheaper and B11y can wait.

---

## 4. The decision this Phase 0 needs

**The two callers do not have the same fix, and only one of them needs a mobile build.**

| Part | Fix shape | Needs a client build? |
|---|---|---|
| **A — caller 4** | Make `sync-gmail` accept `user_id` as well as `target_user_id`, per Rule 4 | **No.** One Edge Function, backend only |
| **B — caller 3** | Mobile must send *something* — it currently sends no body, and authenticates with the **anon key**, not a user session (`lib/gmail.ts:33`), so `sync-gmail` cannot derive the user from a JWT either | **Yes.** `lib/gmail.ts` + `email.adapter.ts`, then an APK/AAB |

**Part B pulls in everything a client change carries:** the Cross-Cutting Change Parity Check, and Rule 15's three test gates — **which are currently blocked by [[B11z]]'s red Gate 1.**

**Three options for Wael:**

1. **Part A only.** Backend-only, ships today, fixes the conversational path. Mobile keeps fanning out. Honest half-fix, and the half that needs no gates.
2. **A + B together.** Complete fix, but gated behind B11z and a mobile build.
3. **Neither yet.** Defer until B11z clears, then do both.

**No recommendation is offered here** — Phase 0 records intent, and this is a scope decision, not a technical one.

---

## 5. A separate question this investigation raised

**Is a 60-second sync interval right at all?** `app/index.tsx:1269` polls while the home screen is open. Even scoped correctly to one user, that is 60 Gmail syncs per hour per open app.

**Not part of this item** and not authorized by this Phase 0. Recorded because a session fixing the *scope* of that call will be looking directly at its *frequency*, and should not silently change both.

---

## 6. User Intent

A sync requested for one user should sync that user. Nothing should perform work for accounts that did not ask for it.

## 7. Success Criteria

1. A `sync-gmail` call carrying a user identifier syncs **only** that user.
2. The hourly cron, which legitimately syncs everyone, is **unaffected**.
3. `sync-active-email-alerts` (already correct) is unaffected.
4. No user who is currently synced stops being synced. **This is the real risk** — a narrowing fix that is slightly too tight silently stops syncing someone, and the symptom is missing email in the brief, with no error.
5. An auto-tester regression test locks in "a call naming one user does not sync others."

## 8. Out of Scope

- **Cadence.** The 60-second interval, and the hourly and 5-minute crons. §5 records the question; changing any of them is a separate decision, and cron definitions are a second Protected Core area.
- **Anything B11x covered.** Classification idempotency is done and deployed.
- **Voice.** Never calls `sync-gmail` — *freshly verified during B11x Phase 1A: no `fetch` to it exists in `naavi-voice-server/src/index.js`.*
- **`backfill-email-actions`.** Correct already.

## 9. Constraints

- Staging first (`xugvnfudofuskxoknhve`) until Wael says otherwise.
- No cron or cadence change.
- No schema change.
- Rule 15a: the regression test exists and passes before this item is done.

## 10. What this document authorizes

**On Wael's approval:** the Phase 0 → Phase 1 transition, and Phase 1's investigation only — **including a decision on §4, which Phase 1 cannot proceed without.**

**Does not authorize:** any code change, any mechanism, any deploy, or drafting Phase 2.
