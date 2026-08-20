# Session Handoff — 2026-08-02 — YouTube Demo Seed Data + Build 314 Incident

## What this session actually accomplished (verified, still live)

**YouTube demo roster expanded from 5 to 7, renamed to an open-ended roster.**
- File: `docs/YOUTUBE_DEMO_ROSTER_2026-08-01.md` (replaces the deleted `YOUTUBE_TOP5_DEMOS_2026-07-20.md`)
- Demos 1-5 carried over with cast fixed to real accounts (Sarah/Bob → Linda, Hussein → James)
- Demo 6 added: "Bill Total" — `spend_summary`, vendor-scoped, e.g. "How much has Reyes Build billed me?"
- Demo 7 added: "Email-Arrival Alert" — "Alert me when I get an email from James," now unblocked (see below)

**Real accounts wired and tested, live on staging:**
- Robert: `robert.esm.2207@gmail.com`, Twilio `+13433260166` (sender), real phone `343-333-2567` (destination — fixed mid-session, was colliding with the sender number and silently failing all self-alert SMS)
- Linda Fournier: `whwh2207@gmail.com`, Twilio `343-655-3227` → forwards to `613-769-7957` (kept separate from Robert deliberately, for Demo 2/4's two-phone proof shots)
- Tom Reyes: `tom.mynaavi@gmail.com`, Twilio `343-500-5082` → forwards to `343-333-2567`, tested working
- Marcus Webb: `Marcus.2207@outlook.com`, Twilio `343-459-8083` (corrected mid-session — Wael's original message said 343-549-8083, that was wrong; Twilio's own console is ground truth) → forwards to `343-333-2567`, tested working
- Priya Nair: `priya.esm.2207@outlook.com`, Twilio `343-947-0135` → forwards to `343-333-2567`, tested working
- James Okafor: `james.esm.2207@outlook.com` (real email added this session, unblocks Demo 7), phone still fictional (not needed for the email-only demo)

**Seed data pushed live to Robert's real Google account (staging), confirmed via direct API queries, not assumed:**
- 16 contacts (13 original + Tom/Marcus/Priya)
- 20 calendar events
- 5 lists with items
- 2 pre-existing action_rules (depart-work→Linda SMS; Sunday-evening→Linda email with grocery list — note: this is a single occurrence, not a true recurring weekly rule, the codebase's `time` trigger doesn't support recurrence)
- Home/work address bug fixed: `work_address` was garbage ("55 Elgin St, Thornhill" then briefly a client-display anomaly showing "688 Bayview Dr") — corrected to `340 Albert St, Ottawa, ON, Canada` in the database, confirmed correct via a clean app reinstall + sign-in screenshot at end of session
- Elena/Linda "wife" conflict resolved: Linda is now the only "wife" (via a backfilled memory fact, not a contact field); Elena repositioned as ex-wife/co-parent; the live "Anniversary dinner" calendar event renamed to "Dinner with Elena — co-parenting check-in" to match

**8 seed PDFs generated** (5 invoices + contract + warranty + receipt) — `docs/youtube-demo-seed-pdfs/`, not yet attached to anything (that only happens via the still-blocked email seed, see below).

**Small bug fixed in passing:** `create-contact` Edge Function only supported JWT auth, no `body.user_id` fallback like the rest of the codebase's Edge Functions — fixed to match the standard 3-step resolution pattern, deployed. Caused a duplicate-contact issue when first used for Tom/Marcus/Priya (old fictional entries weren't found/updated, new ones got created alongside) — cleaned up via a new `delete-contact` function (also now in the repo).

**New one-off admin Edge Functions added this session** (all deployed to staging, all still useful): `delete-contact`, `patch-calendar-event`.

## What's still blocked — Demo 5 and Demo 6

Both depend on 39 seeded emails (with the 8 PDFs attached) landing in Robert's real Gmail inbox via the `seed-demo-emails` function (written and deployed this session, not yet run for real). That function needs the `gmail.insert` OAuth scope, which the app does not currently request.

**This specific claim is verified, not inferred** — see the two pieces of direct evidence in this session:
1. Code: `lib/supabase.ts:172` — current scope list has no `gmail.insert`.
2. Google's own API: calling `seed-demo-emails` before any scope change produced a real 403 from Gmail for all 39 messages — `"reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT"`.

To unblock: add `gmail.insert` to the scope lists in `lib/supabase.ts` and `lib/calendar.ts`, bump `REQUIRED_OAUTH_SCOPE_VERSION`, ship it (build or OTA), have Robert re-sign-in, then call `seed-demo-emails` once. All of this was done once already this session (as build 314) and then fully reverted — see incident writeup below before repeating it.

## The build 314 incident — full honest account

**What build 314 was:** exactly the `gmail.insert` scope change described above, nothing else. Verified at the time — it was the only client-app file diff in the working tree.

**What went wrong:** after installing build 314 and testing sign-out/sign-in, Wael reported: no account picker shown, forced into an account, and "Sign Out" didn't return to a sign-in screen. This was the first time this behavior had been seen.

**Two diagnostic hypotheses were offered. Both turned out to be wrong, confirmed by direct evidence, not assumption:**

1. *"Build 314 was never actually exercised"* — based on `client_diagnostics` log rows all showing `build_version: v1.0.313-313`. This was **contradicted** by a screenshot clearly showing "(build 314)" on the Settings screen. The actual flaw in the reasoning: `remoteLog()` only fires at specific hardcoded instrumentation points in the code, not universally — so "no log rows tagged 314" does not prove "314 wasn't running," it's equally consistent with 314 running but never touching an instrumented code path. This was an overconfident inference stated as settled fact — a real process failure, flagged explicitly to Wael and owned as such.

2. *"The Google sign-in `prompt: 'consent'` parameter needed `select_account` added to force the account picker"* — **contradicted directly**: after reverting to build 313 and testing live, the account picker showed up correctly on the exact same `prompt: 'consent'` code that had been unchanged since before 314. This was never the problem.

**Per this project's own 2-hypothesis-cap rule, no third hypothesis was proposed.** Root cause of the original build-314 sign-in behavior is **unresolved and unknown** — there was no way to inspect that specific session's actual runtime state after the fact, and it wasn't reproduced live before the decision to revert.

**Resolution:** Wael explicitly withdrew trust in the diagnostic process and instructed a full revert. Executed via `git revert --no-edit` (commit `6283b3c`, reverting `c41920b`), pushed to `origin/main`. Confirmed post-revert: `app.json` back to versionCode 313 / version 1.0.313, `app/settings.tsx` back to "(build 313)", `gmail.insert` removed from both `lib/supabase.ts` and `lib/calendar.ts`, `REQUIRED_OAUTH_SCOPE_VERSION` back to 2.

**Current state, confirmed via a clean install + fresh screenshots at the very end of the session:** build 313 is stable — sign-out returns to the sign-in screen correctly, tapping "Sign in with Google" shows the account picker correctly (Bob/mynaavi/Robert all listed), home/work addresses load correctly from the database. No known-broken behavior remains on 313.

## Next steps, for whoever picks this up

1. **Demo 5 and 6 are blocked** until `gmail.insert` is re-added, shipped, and Robert re-signs-in. Before repeating this: read the incident section above in full. The scope-addition work itself was never the problem — it's a small, verified, low-risk change. What's unresolved is a sign-in UX glitch that appeared once during that specific test and was never reproduced or explained.
2. **If retrying:** reproduce any sign-in issue live, step by step, watching it happen in real time (screen-shared or narrated), rather than diagnosing after the fact from logs. The `client_diagnostics` table is genuinely useful for this (real infrastructure, not fabricated) but only for events that are actually instrumented with `remoteLog()` calls — know which code paths are and aren't covered before trusting an absence-of-log-rows argument again.
3. Build 313's APK, if ever needed again: `https://expo.dev/artifacts/eas/7LD-s5vHmBbGfdVSQDtKWuIgvLNCaJgXnyTkWAkUUQE.apk` (build id `ba89e1a4-4f4f-4569-bd51-a626c0f9fa41`, staging profile).
4. `docs/youtube-demo-seed-pdfs/` and the `seed-demo-emails` function are both ready and untouched — no work needed there when `gmail.insert` eventually lands, just run the one call.
