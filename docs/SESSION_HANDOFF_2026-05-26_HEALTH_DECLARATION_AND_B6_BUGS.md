# Session Handoff — 2026-05-26 — Health declaration accepted + ACTIVITY_RECOGNITION decision permanently closed + B6a-B6e bugs logged

**READ FIRST (in this order):**
1. `CLAUDE.md` (project root) — standing rules unchanged this session
2. This handoff (the file you're reading)
3. `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md` — Bugs table now includes B6a-B6e + new 2026-05-26 Shipped block

---

## ⭐ Wael's directive for next session (2026-05-26)

> *"Totally focus on Bug finding and fix on the two interfaces."*

**The two interfaces = mobile (Expo React Native, `app/`) + voice (Twilio voice server, `naavi-voice-server/`).** No new features, no infrastructure migrations, no architectural rework next session — bug-find and bug-fix only across mobile + voice.

---

## TL;DR

1. **Google Play Health-apps-declaration: RESOLVED.** Two paths investigated:
   - Path B (strip `ACTIVITY_RECOGNITION` from manifest via Expo plugin) — built preview APK V57.22.4 build 200; Wael drove the route; **every test stop failed to fire its alert**. Reverted in commit `2c7f803`. ACTIVITY_RECOGNITION is empirically required for geofencing to function on Samsung at Naavi's 300m radius (Motion API is the wake-from-stationary signal; not a battery optimization).
   - Path A (complete the declaration form on Google Play Console with a 6-section justification) — submitted, **accepted by Google**. Internal Testing track unblocked.
2. **ACTIVITY_RECOGNITION decision permanently closed.** Permission stays in the manifest. The `plugins/withRemoveActivityRecognition.js` file is deleted; SDK config restored.
3. **B6a-B6e logged in the holding list** — 3 newly discovered bugs (B6c keyboard flicker, B6d numbered-list Rule 13 gap, B6e calendar misroute HIGH severity) + 2 location-alert items (B6a re-arm fix coded, B6b cleanup migration written).
4. **Build 200 mobile changes (SOURCE_LABELS + email UI from B5c)** still queued — never built as AAB. Rides in next AAB (V57.22.5 build 201).

---

## Build / branch state

| Item | Value |
|---|---|
| Active branch | `main` |
| Latest commit | `fb57fdb` (this handoff's holding-list update commit was preceded by `fb57fdb`; check `git log -1` for current HEAD) |
| Code version | V57.22.5 build 201 (revert of ACTIVITY_RECOGNITION removal) |
| Last AAB on Play | Build 199 (pre-Build-200 mobile changes); Build 200 + 201 not yet AAB'd |
| Preview APK on Wael's phone | V57.22.4 build 200 (the failing manifest-removal APK — geofencing not working) |
| Auto-tester baseline | 140 / 140 green pre-revert; not re-run after B6a/B6b local code was added |

---

## What shipped this session

| Item | What | Commits |
|---|---|---|
| Path B test (failed) + revert | Built preview APK with `ACTIVITY_RECOGNITION` stripped via new Expo config plugin + `disableMotionActivityUpdates: true`; drive-tested; failed; reverted | `aedf612` → `2c7f803` |
| Path A submission | 6-section Health-apps-declaration justification | (no code commit — submitted via Play Console UI) |
| Holding list update | B6a-B6e added to Bugs table; new "Shipped this session (2026-05-26)" block | `fb57fdb` |

---

## B6a / B6b shipped late in this session (UPDATE)

The "uncommitted local" section from the original handoff was acted on before close. Late-session sequence:

1. Wael approved running the B6b migration against live Supabase.
2. First `npx supabase db push --linked` attempt failed — `supabase/migrations/20260323_epic_tables.sql` was corrupt (contained the single string `pbut`, latent since commit `6ebae94` on 2026-04-03). Restored from git history `b8b7552` and committed in `ab6b9fb`.
3. Second push attempt revealed Supabase CLI migration tracking was misaligned with prod (every migration showed as pending). Marked 26 unique-date versions as applied via `supabase migration repair --status applied <version>` calls.
4. CLI push still blocked by a structural issue with multi-files-per-date filenames (~10 dates have 2-4 files each; CLI can only track one per date). **Logged as B6f for future fix.** Workaround: applied B6b migration via Dashboard SQL Editor (success).
5. `supabase migration repair --status applied 20260526` marked the new migration tracked.
6. `npm run test:auto` returned **144 / 144 green**.
7. B6a + B6b code committed in `318e522`. Holding list updated in `3e6a9c6` (B6b marked CLOSED, B6a status updated, new B6f entry added).

**Final commit chain on `origin/main`:**

```
3e6a9c6  holding-list: close B6b + update B6a status to committed + add B6f
318e522  B6a + B6b: one row per place — re-arm expired location alerts on confirm
ab6b9fb  fix: restore corrupted 20260323_epic_tables.sql from git history
056d2d2  docs: session handoff 2026-05-26 — Health declaration accepted + B6a-B6e
fb57fdb  holding-list: log B6a-B6e + 2026-05-26 Google Play Health declaration outcome
2c7f803  Revert: V57.22.5 build 201 — restore ACTIVITY_RECOGNITION
aedf612  V57.22.4 build 200 — strip ACTIVITY_RECOGNITION from manifest
```

**What changed since the handoff was first written:**
- B6a code: was uncommitted → now committed (`318e522`).
- B6b migration: was un-applied → now applied to live Supabase prod.
- B6f added to holding list (Supabase migration tracking structural issue).
- Auto-tester re-run: 144 / 144 green.

**What still awaits next session:**
- AAB build (V57.22.5 build 201) — gets Build 200 mobile changes + B6a re-arm flow onto the phone via Play.
- The bugs the next session will focus on per Wael's directive (mobile + voice) — full list still in the section below.

---

## Bugs discovered this session (logged in holding list)

Quick reference; full notes in `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md`:

| ID | Surface | Severity | One-liner |
|---|---|---|---|
| B6a | mobile | medium | Orchestrator bails to "tap Reactivate" instead of re-arming expired location alert |
| B6b | backend (migration) | medium | One-time cleanup of duplicate disabled location rules + broader UNIQUE constraint |
| B6c | mobile | low-medium | Keyboard flicker / jump on chat input |
| B6d | server (prompt) | medium | Choice / option lists rendered as bullets instead of numbered (Rule 13 gap, intermittent) |
| B6e | server | **HIGH** | Calendar query *"what is on my calendar this week"* misroutes to LIST_READ of unrelated list — session-blocking — persists after force-close |

---

## Next-session starting points by interface (per Wael's directive)

### Mobile bugs
- **B6e** (HIGH severity) — calendar misroute. Capture `naavi-chat` request/response logs for the failing turn first.
- **B6c** — keyboard flicker. Audit `KeyboardAvoidingView` in `app/index.tsx`.
- **B6a** — code already written locally; needs B6b migration push + commit + AAB to ship.

### Voice bugs
- **B4s** — Voice-server entity-existence parity. Partial: lists context shipped, but alerts context + 3-layer validation + normalizeForEntityMatch helper still missing on voice. Port from `supabase/functions/naavi-chat/index.ts` (commit `93ec701`). ~45-60 min server-only.
- **B4v** — Naavi rejects user's location pick with "closer to you" override. Intermittent — capture transcript + naavi-chat log on next reproduction.

### Cross-surface (mobile + voice)
- **B6d** — Numbered-lists Rule 13 enforcement. Strengthen prompt in `get-naavi-prompt/index.ts`. Wael 2026-05-26 directive: *"All lists should be numbered"* — broaden from choices-only to all lists.
- **B4w** — ⭐ TRUST BREACH. Naavi fabricates contact names on 0-result contact-search. HIGH severity. Server-side bypass for "find contact by attribute" intents needed. Pairs with F2h.
- **B4y Phase 2** — universal confirm-then-act gate. 3-5 hr focused session. AAB build blocked from Phase 2 start until auto-tester returns to 100% green.

### Older queue (in case Wael picks them)
- **B4f** — TTS postal-code / Dr. → Drive / ON → Ontario. Mobile fix queued for next AAB; server normalizers shipped 2026-05-23.

---

## Open items NOT from this session that still carry forward

From the 2026-05-25 handoff:
1. **Build the AAB** — V57.22.5 build 201 to ship Build 200 mobile changes (SOURCE_LABELS + email UI from B5c) AND restore ACTIVITY_RECOGNITION on the Play track. Pre-build checklist per Rule 15: `npm run test:auto` green (currently 140/140 from before B6a/B6b local code was added; needs re-run after committing).
2. **Google Play store listing — non-Health blockers** — tablet screenshots (7-inch + 10-inch each need ≥2) and full-description rewrite (remove *"active seniors"* language). Independent of code.

---

## Verification commands (next session opener)

```bash
git -C "C:\Users\waela\OneDrive\Desktop\Naavi" log --oneline -5
git -C "C:\Users\waela\OneDrive\Desktop\Naavi" status --short
npm run test:auto
```

Expect:
- `git log` shows `fb57fdb` (holding list update) and `2c7f803` (revert) at HEAD or close to it.
- `git status` shows the uncommitted B6a/B6b files in the working tree (6 files listed above under "Uncommitted local code").
- `npm run test:auto` either green at 140/140 baseline (if B6a/B6b tests are not yet wired) OR fails on `integrity.action-rules-disabled-rule-now-blocks-new` (the new test) because the migration hasn't been pushed to live Supabase yet.

---

## At-a-glance reminders

- **ACTIVITY_RECOGNITION stays in the manifest.** Don't try to remove it again. Drive evidence is conclusive (every stop failed at Naavi's 300m radius).
- **The preview APK on Wael's phone is the failing one (build 200).** If Wael complains about geofencing not working, that's why — the next AAB / preview build will restore functional behavior.
- **B6a/B6b are mid-flight** — Wael said "close issues, not put it on hold" but the day's path-shift left them uncommitted. Don't lose this work.
- **Per Wael 2026-05-26: next session = bug-find + fix on mobile + voice ONLY.** Do not start B4y Phase 2 or F2h unless Wael explicitly redirects.
