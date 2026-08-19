# Phase 6 Review Prompt — S1 — Voice PIN Authentication

Paste everything below the line into ChatGPT, and attach the two diff files:

- `S1_diff_voice_server.txt` (38 KB)
- `S1_diff_naavi_app.txt` (40 KB)

Both sit in `docs/`, alongside this prompt and every other S1 document.

---

You are the External Technical Reviewer for the MyNaavi project, performing a **Phase 6 — Technical Review (After Coding)** under Release Gate Workflow v4.0.

## What this work item is

**S1 — Voice PIN Authentication Hardening.** A security defect: anyone calling Naavi's voice line from an unregistered phone was prompted for a 4-digit PIN, and that PIN was checked against **every account that had one set**. A guess succeeded if it matched *anyone*. The odds therefore improved as the user base grew — roughly 1 in 2,000 at 5 users, **1 in 10 at 1,000 users** — and the 3-attempt cap counted per *call*, so redialling reset it. Nothing alerted on failed attempts, so an attack would have been invisible.

## What was implemented

| Track | Change |
|---|---|
| **A** | The caller states the **last 4 digits** of their registered number *before* the PIN. That resolves to exactly one account, and the PIN is checked against that account only. Deleted the function that fetched all PIN-holding accounts. |
| **B** | A caller authenticated **by PIN** may no longer change the PIN (previously a guessed PIN meant permanent account takeover). PIN is no longer spoken back aloud. A `variant` parameter now travels to the WebSocket session so it knows how the caller proved identity. |
| **C** | PIN raised **4 → 6 digits** for new PINs; `verify` still accepts 4 during the migration window. |
| **D** | Per-account failure counting with a 7-day window; an SMS alert to the owner at the threshold; the owner replies **BLOCK** to refuse all unregistered-phone access; only the mobile app can re-enable it. |
| **E** | 8 regression tests. |

## Design decisions already taken, with rationale — do not re-litigate unless you find them technically unsound

1. **Last-4 rather than the full number.** An eavesdropper never hears both the identifier and the secret.
2. **Three attempts on a wrong last-4, not an immediate hangup.** Changed after live testing: users mishear their own digits. The wording is identical for "misheard" and "no such account" so it is not an account-existence oracle.
3. **No global or system-wide throttling.** Rejected by the product owner: *"you do not penalize me because someone tried to hack your system."* Counting is per-account, which the identity-first ordering makes possible.
4. **No automatic lockout.** The owner decides (the bank model). Auto-locking would hand an attacker a denial-of-service against the real owner.
5. **7-day failure window, not 24 hours.** A short window is trivially evaded by pacing, and does not survive a user who checks SMS every couple of days.
6. **Re-enabling is possible only in the mobile app**, never over the phone. The recovery channel must be stronger than the channel under attack.
7. **A blocked account gets its own distinct spoken refusal**, unlike other failures. Originally identical wording, changed after live testing: a blocked account is refused on the *first* attempt while a wrong last-4 gets three, so the two were already distinguishable from timing alone — the identical wording was protecting nothing while confusing the legitimate owner, who is the person most likely to hear it.

## Planning assumption invalidated during implementation — please assess explicitly

Governance requires this be recorded distinctly from an omitted feature or a scope cut.

**Phase 2 assumed, and the Phase 3 reviewer required, that the failure counter reset on successful PIN authentication.** Live testing showed that is insufficient. Nothing else cleared the counter, so this sequence disarmed the alert entirely:

> attacked → alerted → owner replies BLOCK → owner unblocks in the app and changes their PIN → counter still sits at the threshold → the next real attack alerts them **never**.

The user doing exactly the right thing switched off their own alarm. The counter was measuring *total* failures where it should measure **unaddressed** ones. Fixed by also clearing the count on a PIN change and on unblocking. Please assess whether that fix is complete, or whether other "the owner has addressed this" signals also need to clear it.

## Deployment and environment facts

- **Everything is on staging only.** Nothing has been promoted to production.
- Staging Supabase `xugvnfudofuskxoknhve`; staging Railway `naavi-voice-staging-production`; staging Twilio `+13435041572`.
- The migration adds three **additive** columns with safe defaults. Production does not have them yet.
- Because of that, two reads were deliberately written as **separate, best-effort queries** rather than folded into existing ones — the blocked-flag read in `app/settings.tsx` and the counter reset in `manage-voice-pin`. Rationale: on an environment without the migration, a combined query fails entirely. This is not hypothetical — a single missing column already breaks the caller-name query on staging today (see "Findings" below). **Please assess whether that pattern is correct or whether it is papering over a schema-management problem.**

## Test coverage

8 regression tests in `tests/catalogue/s1-voice-pin-scoping.ts`. Gate 1 (mobile/shared) and Gate 2 (voice) both green against **staging** — environment confirmed from the runner's banner.

**Known gaps, stated rather than implied:**
- The set-PIN refusal (Track B) is **code-verified only**, not exercised on a live call.
- **No true last-4 collision was constructed** — staging has only one PIN-bearing account, so the multi-candidate path could not be reached with real data.
- C5/D6 are client-side screens the auto-tester cannot reach (Rule 15a exception path); validated manually instead.

The Phase 5 reviewer refused to waive one earlier gap — that an existing **4-digit** PIN still verifies — and required it be tested for real. It now is: a legacy bcrypt hash was written directly to the test account, and the correct 4-digit PIN authenticates through the live voice path while a wrong one retries. **You may wish to apply the same standard to the two gaps above.**

## Findings surfaced by this work but deliberately NOT fixed in it

Please confirm that leaving these out was correct scope control, and flag any that you believe block S1.

1. **B11c root-caused.** The registered-caller greeting drops the user's name on staging because `select=name,first_call_completed_at` includes a column that does not exist there, and PostgREST fails the *whole* query (HTTP 400, `42703`). Production has the column.
2. **Untracked production schema.** No migration in the repository creates that column. It was added to production by hand. Scale unknown; this is the first instance found.
3. **No barge-in during the PIN prompts.** `<Play>` sits outside `<Gather>` by design (landline silence bug, 2026-05-13), so a caller cannot speak or key during a prompt. S1 did not introduce this, **but S1 made the caller pay it twice per call** by adding a prompt.
4. **Barge-in fails in normal conversation too.** This is the voice equivalent of the mobile Stop button — on a call there is no screen, so speaking over Naavi *is* the Stop control. Traced but not root-caused; S1's diff is ruled out as the cause. Ranked by the product owner as a broken primary control.

## Architecture context you need

- Three codebases: mobile app, voice server (Node on Railway), Supabase (shared Postgres + Edge Functions). Supabase Edge Functions are **Shared Core** — used by both mobile and voice.
- **Entry points translate; they do not implement business logic.**
- The single architecture reference is `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`. Creating any other architecture document is forbidden.
- **Identity asymmetry that matters here:** on voice, identity *is* the caller's phone number, and the user record is secondary. On mobile, identity is the signed-in user and the phone is an attribute.
- `naavi-voice-server/src/index.js` is Protected Core and very large. Phase 3 explicitly forbade opportunistic refactoring in it.

## Required output — four independent verdicts

1. **Technical Review: PASS / FAIL**
2. **Architecture Completeness: PASS / FAIL** — state explicitly whether the implementation increased or reduced duplication, bypassed Shared Core, introduced another independent implementation, violated entry-point responsibilities, changed an API contract, changed a capability's ownership, or expanded Protected Core.
3. **Governance Compliance: PASS / FAIL**
4. **Overall Recommendation: Approved / Approved with Mandatory Changes / Rejected**

Do not use numeric scores — they hide failures in individual dimensions.

**Also apply the Architecture Drift Rule.** Does the implementation still match what the Architecture Reference claims? Three outcomes, handled differently: (a) matches — proceed; (b) diverges because of an intentional approved change in this work item — not a FAIL, but the Reference update becomes a hard merge precondition; (c) diverges for any other reason — **implementation stops** until reconciled.

Specifically assess:
- Whether adding an identification step ahead of the PIN changes the voice entry point's responsibilities.
- Whether the failure-counting and alerting logic sits at the right layer, or whether business logic has leaked into an entry point.
- Whether `receive-sms-reply` — previously a support-ticket webhook — taking on a security command is appropriate, or whether that conflates two responsibilities in one function.

## Files changed

**Voice server** (`naavi-voice-server`, branch `staging`) — 452 insertions, 48 deletions, all in `src/index.js`.

**naavi-app** (branch `main`) — 640 insertions, 32 deletions:

```
app/settings.tsx                                          154 +-
supabase/functions/manage-voice-pin/index.ts               42 +-
supabase/functions/receive-sms-reply/index.ts              64 +-
supabase/migrations/20260819000000_s1_voice_pin_...sql     44 +
tests/catalogue/s1-voice-pin-scoping.ts                   368 +-
```

Full diffs are attached.

---

## Diff file locations (for attaching)

Both sit in `docs/`, alongside every other S1 document:

```
docs\S1_diff_voice_server.txt
docs\S1_diff_naavi_app.txt
```

Supporting documents, if the reviewer asks for them:

- `docs/S1_PHASE_5_VOICE_PIN_AUTHENTICATION_2026-08-19.md` — the evidence package
- `docs/S1_PHASE_3_VOICE_PIN_AUTHENTICATION_2026-08-19.md` — the approved plan and implementation boundaries
