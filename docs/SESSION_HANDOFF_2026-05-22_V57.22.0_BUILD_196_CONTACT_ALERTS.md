# Session Handoff 2026-05-22 — V57.22.0 Build 196 (Contact Alerts) + HubSpot

## Top priorities for next session

1. **Debug + verify the contact-from-alert flow on V57.22.0 build 196.** Voice (PC) and mobile chat. Several iterations landed today; user testing was partial and some edge cases need final confirmation. See "Open testing" below.

2. **Complete HubSpot integration.** Carry-over from 2026-05-20 — auto-acknowledgment emails reach non-gmail domains but never reach gmail.com addresses (4 gmail sends → 0 received; 3 non-gmail → 3 received). Next-session starting point is HubSpot's per-recipient Recipients tab + workflow enrollment history. Full detail in `docs/SESSION_HANDOFF_2026-05-20_HUBSPOT_GMAIL_BLOCKER.md`.

---

## What shipped today (server-side, live, no AAB needed)

All voice-server commits on `main` of `munk2207/naavi-voice-server`, auto-deployed via Railway. All Edge Function changes deployed via `npx supabase functions deploy`.

### Voice TTS — digit-drop fix (`c55f2b8`)
Aura silently dropped digits inside email local-parts (`aggan2207@gmail.com` spoken as `aggan@gmail.com`). New `normalizeEmailForTTS` inserts a comma at every letter-digit boundary inside the local-part. Wired into all 3 TTS paths (textToMulaw, streamTTSToTwilio, /tts-play). Live evidence: post-deploy tests heard "agen, two two oh seven" / "again, 2207" — digits preserved.

### Voice typed-contact-lookup deterministic bypass (`7232971`, `52cac74`)
Replaced the Haiku-non-deterministic path for "Find contact X" / "Find X in my contact" with a server-side bypass: at top of askClaude, detect intent → run lookup-contact directly → filter to exact-name match → speak canonical `"Found <name>, email <email>, phone <digits>"` → return. No LLM in the loop = zero non-determinism. Auto-filter excludes Email-substring noise (Robert Keightley with bob.keightley@... when querying "Bob"). User confirmed 5/5 pass clean within a session.

### `lookup-contact` returns `addresses[]` (`9c944db`)
Extended People API readMask to include `addresses`, mapped into the response as `{type, formatted}`. The new field is optional; old callers ignore it. Used by the possessive-location resolver below.

### Voice memory-hit pre-resolve check (`b12dbb2`)
Mobile-parity fix: when the user names a place they already have an alert at, surface "you already have a recurring alert for X" BEFORE calling Google Places. Match is case-insensitive exact `place_name`. Skipped for possessive contact resolutions (place_name was rewritten to street address by that point). Saves ~1s + the confirm-step friction.

### Possessive contact-card address resolver — voice (`b5446d0`, `baeac7d`, `1235ec4`, `352dd10`, `4e7fc4f`)
Five iterations to make "Alert me when I arrive at <Name>'s home" / "Bob office" work end-to-end on voice:

1. `b5446d0` — initial possessive resolver in the SET_ACTION_RULE location handler
2. `baeac7d` — rank candidates by exact-name + has-wanted-address-type (was picking "Leo Lax" over "Leo")
3. `1235ec4` — apostrophe-s is optional (Wael: "people say 'Sam home' not 'Sam's home'")
4. `352dd10` — top-of-askClaude deterministic bypass (Haiku ignoring prompt v85/v86 on cold-cache turns; rewrote "Leo home" to "Leo Max" / dropped name)
5. `4e7fc4f` — drop `^` anchor (Deepgram prefixes utterances with "Whale" — mishearing of "Naavi here, how can I help you, Wael")

Bypass flow: regex detects `[every time]? [verb] me [when I arrive at | at | when I get to | when I leave]? <Name> <home|house|place|office|work>` (or verb-at-end shape) → STOP_WORDS filter rejects captured "at"/"to"/etc. → lookupContactByName(name) → ranked filter → geocode via resolve-place → commitLocationRule → speak `"<one-time | every time> alert set. I'll let you know when you arrive at <Name>'s home — <street>."`

### Mobile parity (`8a437fe`)
- `lib/contacts.ts`: `Contact` interface gains optional `addresses?: ContactAddress[]`
- `hooks/useOrchestrator.ts`: possessive resolver in location interceptor (mirrors voice b5446d0 + baeac7d but without the top-of-pipeline bypass)
- `hooks/useOrchestrator.ts`: memory-hit pre-resolve check (mirrors voice b12dbb2)

Mobile DOES NOT yet have the deterministic top-of-pipeline bypass (`352dd10`+`4e7fc4f`). Mobile uses Sonnet (more consistent than Haiku) so the in-handler possessive resolver should be sufficient — but verify in next-session testing.

### Punctuation-strip ordering (`74f658b` mobile + `c3d154b` voice)
"Find Bob in my contact." (with Deepgram's trailing period) was leaving `"Bob in my contact"` as the search query because the trailing `in my <type>` strip required `\s*$` and the period blocked it. Moved punctuation strip earlier in the chain.

### Prompt v85 → v86 (`9c944db`, `60666f9`)
- v85: "<Name>'s home" / "<Name>'s office" is a VERIFIED ADDRESS (the contact card is in the user's own Google Contacts). Claude must emit SET_ACTION_RULE immediately, NOT ask for clarification.
- v86: PRESERVE THE LITERAL PHRASING. Never add 's the user didn't speak. Never resolve "Leo" to "Leo Lax". Pass through exact words.

Note: Haiku at cold-cache still ignores v85/v86 occasionally. That's why the top-of-pipeline bypass (`352dd10`) exists as a belt-and-suspenders.

---

## V57.22.0 Build 196 — built and shipped

- **AAB:** built + auto-submitted to Google Play Store. Build ID `5cfa8b33-397b-4b37-a197-f3bddac9f6cf`. URL: https://expo.dev/artifacts/eas/ctVrPfmg6pfGFy4nD7BkbF.aab. Sitting in Play Console — **needs manual promotion to Internal Testing.**
- **Preview APK:** built. Install URL: https://expo.dev/accounts/waggan/projects/naavi/builds/fd9efdc8-e767-480b-8d36-9020aa11099a. Wael installed on Samsung + emulator and confirmed V57.22.0 build 196 visible in Settings.

### What's in V57.22.0 (mobile)
- 74f658b — contact-search punctuation-strip ordering fix
- 8a437fe — possessive contact resolver + memory-hit pre-resolve + Contact.addresses[]
- 60666f9 — apostrophe-s optional in mobile possessive regex (parity with voice v86)

Server-side companions are already live (lookup-contact addresses[], prompt v86) so mobile gets the full feature on install.

---

## Open testing — Day 1 of V57.22.0

### Voice (PC) — known passing
- ✅ `Find contact Bob` — 4/4 consistent in a session (deterministic bypass)
- ✅ `Find Bob in my contact` — works via bypass
- ✅ TTS speaks email digits — `aggan, two two oh seven at gmail dot com` audible (transcript tools sometimes hear it as "agen 2207" / "again, 2207" — that's transcription error, not Aura)
- ✅ Repeat alert at same place → "You already have an alert at X" (memory-hit pre-resolve)

### Voice (PC) — needs verification on current state
- ⚠️ `Alert me when I arrive at Bob home` — failed once (Bob had no address yet during test) then Wael added Parliament St to Bob's contact card. Live curl confirms Bob now has the address. **Retest expected: should hit bypass → resolve to Parliament Street → either create new alert or detect existing duplicate cleanly.** This is the highest-priority verification for next session.
- ⚠️ `Alert me when I arrive at Leo home` — Deepgram mishears "Leo" as "Liu" sometimes → People API matches "Liu" to "Wai Dalu" → honest-out misfires. **The bypass logic is correct; the STT layer is the bottleneck.** Known holding-list item (B?? Deepgram name-search phonetic fallback). Real fix: add user's contact names to Deepgram keyterms list so it biases toward known names.
- ⚠️ `Alert me when I arrive at home` — should bail on stop-word "at" → fall through to Claude → settings_home → user's own address. Confirm this works after the v86c regex update.

### Mobile chat (Samsung + emulator) — needs first-pass testing
- `"Alert me when I arrive at Bob's home"` — should resolve to Parliament Street via the in-handler possessive resolver. Note: mobile asks to confirm ("Found Parliament Street at X. Say yes...") — this is a known parity gap with voice (voice instant-inserts; mobile defers). Not a blocker; nice-to-have.
- `"Alert me at Bob home"` (no apostrophe) — should work after v86 regex update.
- `"Find contact Bob"` — mobile doesn't have the deterministic bypass; goes through Claude. Should work via personMatch + contactContext (Sonnet is more consistent than Haiku).
- Same-place repeat alert — should hit the new memory-hit pre-resolve.

### Cross-surface drift to verify (next AAB)
- Mobile parity for: deterministic typed-contact-lookup bypass (currently voice-only)
- Mobile parity for: possessive-location top-of-pipeline bypass (currently voice-only — `352dd10` + `4e7fc4f`)
- Both can ship in a follow-up AAB if testing shows the in-handler mobile path is unreliable.

---

## Carry-over from 2026-05-20 — HubSpot gmail.com deliverability blocker

Full detail: `docs/SESSION_HANDOFF_2026-05-20_HUBSPOT_GMAIL_BLOCKER.md`.

**Verified facts:** 4 gmail.com sends → 0 received; 3 non-gmail sends → 3 received instantly. All 3 contacts have identical `hs_marketable_status=false`. HubSpot reports "Sent to 1, delivered to 1" for gmail sends. So contact marketing status isn't the differentiator; somewhere between HubSpot's MTA and Gmail's inbox is the gap.

**Next-session starting points:**
1. HubSpot per-recipient delivery log: Marketing → Email → click "Ticket received" row → Recipients tab. Shows exact Sent/Delivered/Opened/Bounced/Filtered status per recipient.
2. Workflow enrollment history: Automation → Workflows → "Auto-acknowledge new ticket" → Performance history → Enrollment history. Confirms the workflow actually enrolled the gmail.com tickets and whether Send Email fired.
3. If logs show "Sent" but Gmail dropped silently → likely DMARC alignment; fix is to connect mynaavi.com as Email Sending Domain in HubSpot (free, DNS only).
4. If logs show "Bounced/Filtered" → different fix path (sender warm-up, Transactional Email add-on, or vendor switch).
5. Vendor alternatives if HubSpot can't be made to reach gmail.com: Zendesk Suite Team ($55/seat/mo, native SMS via Talk) or Plain (~$60/seat/mo, modern dev-friendly, no SMS). DB schema + ingest-ticket skeleton are vendor-agnostic; switch cost ~2-3 hours.

**HubSpot Sales Hub Professional trial expires 2026-06-03** — time-bounded.

---

## Auto-tester — still suspended (Rule 15)

108 ✓ / 0 ✗ at last green. Currently DISABLED pending the 5-file destructive-write audit. Item 8 in next-session backlog. Not blocking V57.22 ship; flag in conversation if doing more AAB builds.

---

## Holding-list items closed today

- ⭐ NEW capability shipped (not on prior holding list): **"Alert me at <Name>'s home/office" via contact-card address.** Full pipeline: lookup-contact addresses[] → possessive resolver in voice + mobile → prompt v86 → top-of-pipeline bypass → memory-hit dedup. This is a foundational user-facing feature that lets Robert reference saved contacts for location alerts without re-typing addresses.
- ⭐ NEW capability: **deterministic Claude-bypass for typed contact lookups.** Same pattern as F1a LIST_CONNECTION_QUERY — server owns the answer, no LLM discretion.

## Holding-list items still open (server-side, no AAB)

- Deepgram contact-name phonetic fallback (B?? — "Leo" → "Liu" mishearing surfaced today)
- Add user's contact names to Deepgram keyterms list (related fix for above)
- Voice action parity — DELETE_EVENT, LIST_RULES, DELETE_MEMORY, SCHEDULE_MEDICATION
- Voice migration to Anthropic Structured Outputs (~200 lines drift vs mobile)
- Spend summary Edge Function (`naavi-spend-summary`)
- LIST_RULES synthesize-action backstop
- Demo line "remind me" time-extraction loop

## Holding-list items still open (AAB-required)

- Mobile parity for typed-contact-lookup deterministic bypass (carry from V57.22 testing)
- Mobile parity for possessive-location top-of-pipeline bypass (carry from V57.22 testing)
- Multi-phone identity — DONE per V57.15.6 (auto-persist)
- Demo line maturity (richer scenarios + conversion path + telemetry)
- Voice privacy UX (4-piece feature)
- Blog age reframe (2 articles still on age framing)

---

## Where to start next session

1. **Verify Bob-home flow end-to-end** on PC + mobile (current state has Bob with Parliament St address). If pass, the V57.22 contact-from-alert feature is shipped clean.
2. **HubSpot deliverability investigation** (Recipients tab + workflow enrollment history). If gmail.com problem is fixable, the support system is complete.
3. **Promote V57.22.0 build 196 AAB to Internal Testing** in Play Console (manual step).
4. **Auto-tester re-enablement** (5-file audit) if no other priorities are urgent.

---

## Active branches / worktrees

- Main repo: `C:\Users\waela\OneDrive\Desktop\Naavi` (branch `main`, current head `60666f9`)
- Build clone: `C:\Users\waela\naavi-mobile` (branch `main`, synced to `74e7fc2` — version bump commit)
- Voice server: `C:\Users\waela\OneDrive\Desktop\Naavi\naavi-voice-server` (branch `main`, current head `4e7fc4f`)
- Worktree `sharp-curie-81944a` — was used today but per CLAUDE.md "work on main" rule, all edits landed on main repo directly.

## Live URLs

- Voice server: https://naavi-voice-server-production.up.railway.app
- Voice number: +1 249 523 5394
- AAB build artifact: https://expo.dev/artifacts/eas/ctVrPfmg6pfGFy4nD7BkbF.aab
- APK install: https://expo.dev/accounts/waggan/projects/naavi/builds/fd9efdc8-e767-480b-8d36-9020aa11099a
- Play Console: https://play.google.com/console (needs manual promotion to Internal Testing)
- Supabase project: https://supabase.com/dashboard/project/hhgyppbxgmjrwdpdubcx
- HubSpot portal: 343125145

## Last shipped versions on devices

- Wael's Samsung: V57.22.0 build 196 (preview APK sideloaded today)
- Wael's emulator: V57.22.0 build 196 (preview APK installed today)
- Robert's phone: V56.6 build 115 (do NOT promote V57.x until geofence reliability solved — Transistorsoft trial failed 2026-05-15)
