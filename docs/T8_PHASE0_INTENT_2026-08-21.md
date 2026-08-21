# T8 — Phase 0: Intent Approval

**Work item:** [[T8]] — Epic health integration: mark it unmistakably, disconnect it, keep it
**Date:** 2026-08-21
**Risk: LOW** — no external review required. §7's Cosmetic Change Policy does **not** apply, because
`lib/naavi-client.ts` is shared logic rather than UI, so the change is reclassified by actual risk.
**Status:** awaiting Wael's approval. **No implementation begins until this is approved.**

---

## Why this exists

Epic was raised three times in one session after Wael had already ruled it irrelevant. His
objection was correct, and the cause was structural rather than careless: **Epic sat on two lists
([[T6]] and [[T7]]) and neither said what it actually is.** Each time it surfaced, it looked like an
open question.

Direct inspection on 2026-08-21 established what nothing had recorded:

| Layer | Reality |
|---|---|
| User interface | **None.** `epicConnected`/`epicLoading` declared at `app/settings.tsx:111-112`, referenced nowhere else. |
| Server | **Three empty folders.** `exchange-epic-code`, `store-epic-token`, `sync-epic-data` — 0 files, 0 bytes. |
| Data | 12 rows on production under `00000000-…-0001`, a placeholder id. Token issued 24 March, expired an hour later. Staging: zero. |

**But it is not dormant.** `getEpicHealthContext()` runs on **every chat turn**
(`lib/naavi-client.ts:631`, inside the parallel fetch with a 6-second timeout), and
`isEpicConnected()` runs twice on every Settings open. The app queries five permanently-empty tables
on every message and discards the result — live cost on the mobile chat path for a feature no user
can reach.

---

## User Intent

Wael's words, 2026-08-21: *"put clear statement that this code never used, or something stronger,
and remove it from the current implementation, but keep it as future in the holding."*

Stop Epic running on the live path, make its status impossible to misread from the code itself, and
**keep every line for a future Epic effort.**

**Explicitly not deletion.** Deleting the code and the tables was offered and declined.

---

## Success Criteria

1. No Epic function is called on the chat path or on Settings open.
2. Anyone opening `lib/epic.ts` or `app/auth/epic/callback.tsx` sees within the first few lines that
   it is not in use, why, and what would be needed to revive it.
3. All Epic code, all five tables, and all 12 rows still exist.
4. Mobile behaviour is otherwise unchanged. The app builds and Settings opens normally.

## In Scope

- Removing the `getEpicHealthContext()` call from `lib/naavi-client.ts`'s parallel fetch.
- Removing the two `isEpicConnected()` calls and the two unused state variables from
  `app/settings.tsx`.
- A prominent NOT-IN-USE header in `lib/epic.ts` and `app/auth/epic/callback.tsx`.
- A short `README.md` in each of the three empty function folders saying why they are empty — an
  empty folder communicates nothing, and is the reason the server side kept being described as
  "trialled" rather than "never built".
- Closing [[T6]] and removing Epic's 12 items from [[T7]].

## Out of Scope

- **Deleting anything** — no file, no folder, no table, no row, no policy. Declined by Wael.
- Any change to the five Epic tables on either project.
- Building, fixing, or designing the Epic integration itself.
- Any other unrelated cleanup in the two files being edited (Rule 0.3, minimal change).

## Constraints

- **Mobile only.** No voice, no Edge Functions, no schema, no cron.
- Keep the code compiling and lint-clean — removing an import while leaving its call, or vice
  versa, is the failure mode to avoid, and the reason both ends of each reference are named above.
- Behaviour-preserving **except** for the intended removal: one fewer parallel fetch per chat turn,
  and two fewer queries per Settings open. Both are removals of work that produced nothing.

## Completion Criteria

1. `grep -rn "getEpicHealthContext\|isEpicConnected" app/ lib/ hooks/` returns matches **only**
   inside `lib/epic.ts` itself.
2. `lib/epic.ts` and the callback route carry the not-in-use header; the three folders carry a
   README.
3. `npx tsc --noEmit` (or the project's existing type check) passes, and lint is clean.
4. `npm run test:auto` unaffected — no test references Epic, to be confirmed rather than assumed.
5. T6 closed and T7 reduced to 28 items in the holding list.
6. Wael confirms on a staging build that chat and Settings behave normally.

---

## A note on what this does NOT fix

The five tables stay, with their production policies as they are. **That is deliberate and is
Wael's decision**, recorded here so a future session does not read T6's closure as "the permissive
policy was fixed." It was not. It was assessed as guarding 12 rows of sandbox data belonging to a
user id that does not exist, and closed on that basis. **If Epic work ever starts, that policy must
be fixed before the first real row is written** — the loose rule is already in place, so whoever
builds the integration inherits it silently and will find nothing wrong.

---

## Required output

Approve, approve with changes, or reject. No implementation — including drafting Phase 1 — until
Wael's own explicit go-ahead.
