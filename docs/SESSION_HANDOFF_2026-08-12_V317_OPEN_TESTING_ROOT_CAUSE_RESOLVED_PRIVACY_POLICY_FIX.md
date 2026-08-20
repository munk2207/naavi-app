# Session Handoff — 2026-08-12 — V317 Open Testing Root Cause Found & Fixed (Privacy Policy Resubmission In Progress)

## What this session resolved

Continuing from `docs/SESSION_HANDOFF_2026-08-11_V317_PRODUCTION_MIGRATION_OPEN_TESTING_VERSION_MISMATCH_OPEN.md` — the "Wael's device shows build 311 instead of the confirmed-live 317" mystery is **fully resolved**, with two real, independent root causes found through direct evidence (not inference). Memory `project_naavi_open_testing_version_mismatch.md` is now closed/updated to match.

### Root cause #1 (real, but not the final answer): Internal Testing exclusivity — confirmed, then found insufficient

- Wael's account (`wael.aggan@gmail.com`) was on the Internal Testing → Testers list. Play Store's own UI showed **"You're an internal tester"** at install time, and the installed app was a genuinely different binary (**V57.84.0 build 311**) vs. the 317 source (**V57.88.0**, verified in both the main repo and the exact build-clone commit used for the AAB).
- Per Google's own docs, an account enrolled in Internal Testing is excluded from Open/Closed testing until it opts out. Wael removed his own email from Internal Testing → Testers in Play Console (confirmed saved).
- **This did not fix it** — afterward, the app disappeared from Play Store search entirely and showed "App not available. Your account isn't currently eligible for this app's testing program." This was the tell that something else, independent of tester-list status, was blocking Open Testing.
- A research agent was deployed to check Google's official docs; ruled out geo-restriction (the 3-country Open Testing release list — Canada, USA, UK — includes Canada) and the "must complete closed testing before Open Testing" policy (Wael confirmed he already completed and got Google's approval for the 12-testers/14-days closed test requirement).

### Root cause #2 (the real, direct answer): Open Testing track was paused, and the release was never actually published

- Play Console → App Dashboard → "Show test tracks" showed **Open testing: Inactive** (Internal: Active, Closed testing: Active·1 track, Production: Inactive) — a track-level status, separate from the release's `completed` API status that had been misread as "live" in the 2026-08-11 session.
- Drilling into Open testing → 1.0.317 → Release summary showed explicitly: **"Superseded by another release · Not published."** No publish/review button existed on that release page — it was dead-ended.
- Root Open testing page showed a **"This track is paused"** banner with a **"Resume test"** button. Clicking it queues the change to be sent to Google for review via Publishing overview.
- **Correction to the 2026-08-11 handoff:** that session's claim "Built and submitted. Google approved and published" was an unverified inference from the Play Developer API's `status: completed` field, which reflects the release object's internal rollout state, not whether it was actually published/committed to the track. This was the first-ever submission to the `beta` track (the `eas.json` track config was changed to `"beta"` in that same session) — the automated `eas build --auto-submit` flow appears to have uploaded the bundle but never completed the publish/commit step for a brand-new track.

### Root cause #3 (found via the resubmission flow): a real, valid Google Play policy violation

- After resuming the Open Testing track and sending for review, Play Console Dashboard showed **"Update rejected."**
- Policy status page: **"Privacy Policy section of the User Data policy: Invalid Privacy policy — LOCATION data is accessed by the app but not disclosed in privacy policy."** Enforced Aug 12, 2026.
- This is accurate and not a false flag — Naavi's location alerts/geofencing were never disclosed in `mynaavi-website/privacy.html`.
- **Fixed and shipped this session:** added a location-data bullet to Section 1 and a new Section 3 ("How We Use Location Data") explaining background location access for arrival/departure alerts and the Places/Maps API. Also removed the health-data (Epic MyChart) bullet per Wael's explicit request — no other health mentions existed in the file. "Last updated" bumped to August 12, 2026. Committed (`972f120`) and pushed to `munk2207/mynaavi-website` main — Vercel auto-deploys, confirmed live at `https://mynaavi.com/privacy`.

## Where this was left — next session's first job

**In progress, not yet completed:** resubmitting the privacy policy fix to Google for review.

1. Play Console → Dashboard → "Go to Policy status" → click into the "Invalid Privacy policy" issue row → "Go to Privacy policy" link (under "How to fix") → confirm/re-enter URL `https://mynaavi.com/privacy` → Save.
2. Go to Publishing overview → send the change to Google for review.
3. Wait for Google's review (hours, not minutes — check Publishing overview status or the developer account email for the verdict, not just the Console UI at a glance).
4. Once approved: confirm Open testing → track summary shows "Active" (not "Inactive"), then have Wael retry install via `play.google.com/store/apps/details?id=ca.naavi.app` and confirm Settings reads **V57.88.0 (build 317)**.

**Also flagged, not yet done — Wael will handle himself:** the other Internal Testing testers (`heaggan@gmail.com`, `mynaavi2207@gmail.com`, `mynaavidemo@gmail.com`, `Robert.esm.2207 for YouTube`) are still on the Internal Testing → Testers list. Wael confirmed Internal Testing will not be used going forward — same exclusivity mechanism (root cause #1) will block each of them from Open Testing until removed from that list, same as it did for Wael.

## Next session — explicit focus per Wael

**"YouTube demos running on APK V317 staging"** — Wael's own words, captured verbatim since the exact scope wasn't elaborated this session. Worth noting: one of the Internal Testing testers is literally named **"Robert.esm.2207 for YouTube"**, confirming there's an existing YouTube demo-recording workflow tied to a specific tester account — likely relevant context for whatever this next-session task actually is. See also `project_naavi_production_governance` memory (the YouTube-demo-video governance doc — distinct from Play Store release readiness, don't conflate). Clarify scope with Wael at the start of next session rather than guessing further.

## Git state

- `mynaavi-website` repo: commit `972f120` ("Disclose location data collection, remove health data mention"), pushed to `main`, Vercel auto-deployed.
- No changes to the `Naavi` main repo or `naavi-mobile` build clone this session — purely a Play Console configuration + website content fix, no new AAB needed.

## Tooling note

`scripts/` has no committed script for direct Play Developer API queries — this session recreated the JWT-signed request pattern ad hoc (service account key at `C:\Users\waela\naavi-mobile\google-play-key.json`, scope `https://www.googleapis.com/auth/androidpublisher`, package `ca.naavi.app`). Worth formalizing as a real script next time this kind of ground-truth check is needed, rather than rewriting it from scratch.
