# Session Handoff — 2026-08-13 — Location Disclosure Shipped (Build 318), Production AAB Drafted, SMS Forwarding Mystery Open

## ⭐ Next session — explicit priority per Wael

**Debug why the SMS forward from `+13436553227` ("Linda," a Twilio number) to `+16137697957` (Wael's real phone) is confirmed "delivered" by Twilio's own API, with no error, but never actually arrives on the real device.** See "Open mystery" section below for full evidence — this needs investigation from a different angle than what was tried this session (Twilio API checks were exhausted; the contradiction is unresolved).

---

## What shipped this session

### 1. Three real production bugs — found live by Wael, fixed, deployed, committed

All confirmed via live testing (staging first, then production), each with a regression test added to `tests/catalogue/`:

- **PERSON_LOOKUP false negative** — "Who is my wife" answered "I didn't find anything" even though the fact was saved. Root cause: the classifier's bare-word extraction ("wife") was too weak for the embedding search to clear its similarity threshold against the full saved sentence. Fixed in `naavi-chat/intentHandlers.ts` — expands known relationship words into "who is my `<word>`" before searching.
- **DRAFT_MESSAGE channel default bug** — "Send sms to my wife..." silently became an email draft. Root cause: naavi-chat's fast-path classifier never extracted a `channel` field; the DraftCard UI defaulted to email. Fixed in `naavi-chat/index.ts` (classifier prompt + action builder).
- **"wife" never resolved to a real contact** — `lookup-contact` never checked `knowledge_fragments` for a saved relationship fact before searching Google Contacts literally for "wife" (which never exists). Fixed via new `_shared/resolve_relationship_contact.ts`, wired into `lookup-contact`. This benefits both mobile and voice since it's the shared backend function.
- Bonus fixes: mechanical "Wife Saying Goodnight" subject line → natural "Goodnight" (classifier now asked for `subject` too); auto-tester's `ingestNote` adapter was sending an invalid `source: 'auto-tester'` value that production's DB constraint silently rejected (staging didn't enforce the constraint, masking the bug) — fixed to `source: 'stated'`.

Commits: `43ac5c7`, `e949a44`, `b09da68` — all pushed to `main`. Deployed to both staging and production Edge Functions.

### 2. Google Play rejection — in-app prominent disclosure for background location (Build 318)

**The rejections (Aug 13):**
1. "Permissions and APIs that Access Sensitive Information policy: Issues with submitted video"
2. "Prominent Disclosure and Consent Requirement: Missing Prominent Disclosure"

**Root cause investigation, in order of discovery:**
- No path that requests background location ever showed an in-app explanation first — every one called Android's OS dialogs directly.
- A disclosure screen already existed (`app/permission-location.tsx`) but was only reachable via a Settings button — exactly what Google's policy prohibits ("must not require navigating into a menu").
- The worst offender, found via Wael's own screenshots of a fresh install: `hooks/useGeofencing.ts`'s auto-sync-on-sign-in requested background location **unconditionally, immediately after Google sign-in**, before the user had ever touched a location feature — the first and unavoidable prompt any fresh install (including a reviewer's test) would hit.

**Fix (commit `bde98d3`):**
- New `components/LocationDisclosureModal.tsx` + `lib/locationDisclosure.ts` (imperative show/resolve controller) — content matches the already-approved language from `mynaavi.com/discover/start`'s Step 4.
- New `lib/location.ts::ensureBackgroundLocationPermission()` — the single gated entry point. Shows the modal only when background isn't already granted, then requests foreground → background in order.
- Made the check **lazy**: `hooks/useGeofencing.ts` now queries the user's location rules FIRST and returns immediately if there are none, before ever touching a permission API — matches intent already stated in an old code comment ("ask the moment Robert creates a location-trigger rule") that was never actually followed.
- Rewired all 6 direct-permission-request call sites (3 in `useOrchestrator.ts`, 1 in `useGeofencePermissions.ts`'s Fix button, 1 in `app/alerts.tsx`'s banner, plus the lazy-gated `useGeofencing.ts` sync) through the same helper.
- `lib/maps.ts`'s foreground-only request (live travel-time feature) correctly left untouched — not covered by this policy.

**Verified live, extensively, on staging APK build 318:** fresh OAuth test account (`aggan@cloudmask.com`, added to both Play Console Internal Testing and the Google Cloud OAuth consent screen's test-user list since the app is in OAuth "Testing" publishing status) — confirmed sign-in shows nothing location-related, and the disclosure only appears after deliberately tapping "Fix" on the location item. Multiple recording iterations to get a clean, ~24s video showing the full disclosure → Agree → Android dialogs → granted sequence with nothing extraneous mixed in.

**Play Console declaration form** (`Test and release → Policy and programs → Policy status → Permissions and APIs... → Permissions Declaration Form`, a.k.a. `App content → Location permissions`) was located and filled in — App purpose + Location access text fields, plus a **YouTube Shorts link** in the "Video instructions" field (this field is a link, not a file upload — YouTube preferred, Drive also accepted per Google's docs).

**Research agent findings on video requirements** (full report in conversation, not re-copied here) — Google's video must show 4 things: (1) the declared feature in action, (2) how it uses location in the background, (3) how the user triggers the disclosure, (4) the OS runtime permission dialog with consent. The recorded video only clearly covers (3) and (4) — it does not show the alert actually firing. Google's own guidance for features with no visible UI at the moment of firing: "demonstrate the feature or its impacts as much as possible" (i.e., show the resulting SMS/push/call landing). **This gap was never closed** — see "Still open" below.

### 3. Critical catch (by Wael) — the recorded video was on the wrong build entirely

The first compliance video was recorded on the **staging APK** ("Naavi Staging" branding, package `ca.naavi.app.staging`, staging Supabase). The actual app Google reviews is the **production AAB** on the Open Testing track — different package, different branding, and critically, **that production build had never received the build-318 fix at all** (only `eas build --profile staging` had been run). Submitting the declaration with that video would have shown a reviewer a mismatch between the video and the actual live app — likely the same "doesn't accurately reflect the in-app experience" rejection again.

**Fix:** built and submitted the production AAB for build 318 (`eas build --platform android --profile production --auto-submit`). Confirmed via build log:
```
Release track:    beta   (= Open Testing)
Release status:   DRAFT
App Version:      1.0.318
```
This lands as a **Draft** release on Open Testing — not sent to Google, not published — specifically so Wael can install and record the real compliance video against the actual production build before manually sending it for review. AAB artifact: `https://expo.dev/artifacts/eas/AZOlcVUnaHXrtHPdjILm4L0LEbbzNeDXcabuWEzl0AM.aab`

Installed via **Internal App Sharing** (Google's tool for exactly this — install any uploaded build immediately, no review needed). Flagged but not yet confirmed: Internal App Sharing re-signs builds with a Google-managed certificate different from both the Play signing cert and the EAS preview cert — if Google Sign-In fails on that specific install, the fix is registering that cert's SHA-1 in the OAuth consent screen, not a code change.

---

## Where this was left — still open, in priority order

### 1. ⭐ SMS forwarding mystery (Wael's explicit next-session priority)

While recording the new production video, ran Demo 2's exact script ("When I arrive home, remind me to feed the cat and send my wife a text saying I'm home") on production, then simulated the arrival via a direct call to `report-location-event`. Self-alert fanout worked correctly (SMS/WhatsApp/Voice all landed on Robert's own number). The third-party "wife" resolution also worked correctly — resolved to Linda, sent to her real number `+13436553227`.

**The mystery:** `+13436553227` is a Twilio number (`friendly_name: "Linda"`) configured to forward incoming SMS to `+16137697957` (Wael's real phone) via a TwiML Bin containing `<Message to="+16137697957">{body}</Message>`. This was verified directly — not inferred — by:
- Fetching the phone number's Twilio config (`IncomingPhoneNumbers` API) and finding its `sms_url`.
- Executing that TwiML Bin directly with a correctly-computed `X-Twilio-Signature` (HMAC-SHA1 with the real Auth Token), confirming it returns the forwarding `<Message>` TwiML.
- Querying Twilio's `Messages` API for the actual forward (`SMc74a800970ad73672474714887abd7f4`, from `+13436553227` to `+16137697957`, body "I'm home.") — status: **delivered**, no error code, no error message.
- Confirming `+16137697957` is NOT itself a Twilio number on this account (empty result from `IncomingPhoneNumbers?PhoneNumber=+16137697957`) — it's genuinely Wael's real, external number.
- Querying our own `sent_messages` table for anything sent to `+16137697957` — the most recent row is from 2026-08-05, unrelated. **Our application never directly sends to `+16137697957` at all** — the forward happens entirely inside Twilio, invisible to our database. This is expected (it's Twilio-internal), not itself the bug.

**Wael has directly, repeatedly checked the real device's SMS inbox for `+16137697957` — "I'm home." never arrived. Only the unrelated self-alert ("feed the cat," via a different forwarding path) shows up, at the same approximate time.**

This is a genuine, unresolved contradiction between Twilio's own reported "delivered" status and real-world on-device receipt. Not yet explained. Twilio-API-side investigation was exhausted this session (every check came back clean/delivered) — next session needs a different angle: likely checking the receiving device/carrier side directly (is `+16137697957` on a carrier known for unreliable DLR reporting; is there a spam/blocked-numbers filter silently catching messages from `+13436553227` specifically; is there a second SMS/RCS app on the device with a separate inbox not yet checked), since nothing further can be learned from Twilio's API alone — every available Twilio-side signal has already been checked and comes back clean.

**Credentials note for next session:** `scripts/.env` has `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — usable to query Twilio's API directly (Messages, IncomingPhoneNumbers, etc.) and to compute valid `X-Twilio-Signature` headers for hitting TwiML Bins directly, as done this session.

### 2. Play Store resubmission — still incomplete

- Production AAB build 318 is sitting as a **Draft** on the Open Testing track — has NOT been sent to Google for review yet.
- The compliance video still needs to be **re-recorded on this production build** (the one currently in the declaration form is the staging-APK version, now known to be the wrong build).
- The re-recorded video should ideally also address the "feature in action" / "background location usage" gap the research agent flagged (showing the alert's consequence firing, not just the disclosure+permission grant) — this was never resolved; Wael chose to proceed with the disclosure-only video for the first (now-superseded) submission attempt, accepting that risk. Worth revisiting for the real resubmission.
- OAuth consent screen "Testing" vs "In production" publishing status was flagged early this session as a possible blocker for real Open Testing reviewers (test-user allowlist gates sign-in regardless of Play Console track) — **never actually checked**. Should verify in Google Cloud Console → APIs & Services → OAuth consent screen → Publishing status before assuming a real reviewer can even sign in.

### 3. Known, deliberately deferred (not urgent)

- `hooks/useGeofencing.ts`'s background re-sync path (`AppState` foreground listener) still isn't disclosure-gated in the same way as the sign-in path — flagged as a smaller, lower-risk gap during the build-318 work, intentionally left as-is.
- A separate, unrelated UI bug found during testing: the "Location alerts need a little setup" card didn't re-flag "Location — Allow all the time" as missing after a user selected "while using the app only" instead of "all the time," even after app restart. Confirmed not to affect Google compliance (agreed with Wael to deprioritize). Root cause not found — worth a proper look if it recurs.

---

## Git state

- Main repo (`Naavi`): `bde98d3` is the latest commit, pushed to `origin/main`. Working tree otherwise matches session start (many long-standing untracked doc/script files from prior sessions, untouched).
- Build clone (`naavi-mobile`): merged up to `bde98d3` via `git merge origin/main` (clean, no conflicts). `app.json` has `versionCode: 318` / `version: "1.0.318"`.
- No further commits needed for the SMS mystery investigation — nothing was changed in code for that; it was pure diagnostic querying against live Twilio/Supabase data.
