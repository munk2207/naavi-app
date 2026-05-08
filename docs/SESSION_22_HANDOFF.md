# Session 22 — Handoff

**Date:** 2026-04-23
**Focus:** Build 108 AAB (Slices 1+2+3), S12 location-arrival voice call, Help hub, website FAQ/Contact, graceful shutdown, voice unification on phone (drop Polly).
**Closing state:** V55.4 build 108 on phone. Voice server unified on Aura Hera across all phone paths (inbound greeting, reminder call, S12 location alert). Graceful shutdown live — mid-call drops during redeploy prevented.

---

## 1. What shipped in Session 22

### V55.4 build 108 AAB — Slices 1+2+3

**Slice 1 — Home screen redesign**
- Removed greeting row + 3 labeled buttons (Info/Notes/Settings).
- Added top-right 3-dot menu (TopBarMenu) with 5 items: Alerts, Notes, Info, Help, Settings.
- Time-window filtered brief (morning/midday/evening/night) with empty state + rotating tips.
- Chat takeover hides brief when turns>0; 3-min idle clear + midnight clear.
- Full-width Ask MyNaavi input, 3 icon row (Visits / Hands-free / Mic-Send toggle).
- Screen-level peek bar for icon tooltips (wide text, no clipping).
- Floating sign-in banner (absolute positioned).
- Back chevron hidden on home only via headerLeft: null.

**Slice 2 — Alerts management**
- New `/alerts` screen with grouped list, plain-language formatters, tap-to-expand, delete modal.
- `manage-rules` Edge Function (LIST / DELETE + ownership check + JWT-first user resolution).
- LIST_RULES / DELETE_RULE actions in useOrchestrator + voice server.
- Cross-turn `pendingDelete` state for "delete all X" follow-ups.
- Deterministic regex intercept for "delete all X" / "remove every X" before LLM.
- Highlight param on `/alerts` route — LIST_RULES auto-expands the matching row.

**Slice 3 — Misc AAB items**
- Timezone auto-detection on device.
- `isBroadQuery` narrowing (fewer false-positive "answer from memory" responses).
- Global-search knowledge cap 100 → 20.
- `buildFallback` truncation fix (no more mid-sentence cuts).
- Push notifications default ON.
- Removed Anthropic API key field from Settings (voice server owns it).
- Version bump → V55.4 build 108.

### S12 — Location-arrival voice call (5th alert channel)

- `evaluate-rules` + `report-location-event` now dial the user via Twilio for location-trigger self-alerts.
- New voice server endpoint `/speak-alert` returns TwiML that speaks the alert body and hangs up.
- Alert body runs through `normalizeAbbrevForTTS` (Dr → Drive, etc.).
- SMS + WhatsApp + Email + Push + **voice call** = 5 channels for location self-alerts.

### Help hub + forms

- `/help` hub — 5 rows: How to use, FAQ, Report a problem, Contact support, About.
- `/report` — Formspree `mpqkkdep` form, 4-chip severity grid, FAQ suggestion panel (keyword match, no AI call).
- `/contact` — Formspree `xgorryye` form with FAQ suggestion panel.
- `/about` — version + platform + Privacy/Terms links.
- `lib/faq.ts` — 12 FAQ entries with keyword arrays + `suggestFaq()` + `faqUrl()` helper.

### Website (mynaavi.com)

- New `/faq.html` — 12 Q&A accordion with `id="slug"` anchors for deep-linking.
- New `/contact.html` — Formspree xgorryye form (matches mobile form).
- Nav updated via `shared.js`: Blogs + How to use + FAQ (nav-cta styling). Footer: mailto:hello@ + bugs@ + FAQ link.
- Removed dead inline footers with broken hello@ → /#signup links (index + 3 blog pages).
- How-to-use "Get in touch" link now points to `/contact` instead of `/#signup`.

### Email infrastructure

- Cloudflare aliases confirmed routing correctly: hello@, bugs@, help@, support@ → `wael.aggan@gmail.com`.
- Formspree free tier routes all forms to account email. Workaround: verified-linked email + per-form Workflow email action.
- Fixed typo'd aliases (hello@maynaavi.com etc. → hello@mynaavi.com).

### Graceful shutdown (voice server)

- `activeCalls` Set tracks open media-stream WebSockets.
- `isShuttingDown` flag + `rejectIfShuttingDown` middleware on `/voice`, `/outbound-voice`, `/reminder-call`, `/speak-alert`.
- SIGTERM/SIGINT handler polls for drain (hard cap `DRAIN_TIMEOUT_MS = 180_000ms`).
- Prevents mid-call drops during Railway redeploys (root cause of 18:27 drop in testing).

### Voice unification on phone — drop Polly.Joanna (late-session fix)

- Three remaining `<Say voice="Polly.Joanna">` paths replaced with `<Play>` pointing at a new `/tts-play/:token` endpoint.
- Endpoint generates Aura Hera MP3 on demand via Deepgram.
- Token → text stored in `pendingTTS` Map (10-min TTL, 5-min cleanup interval).
- Paths unified: inbound greeting, reminder call, `/speak-alert`.
- Phone still delivers 8 kHz mulaw (Twilio hard constraint) — but voice model now matches in-call speech, no mid-call speaker switch.
- Commit `0890d63` on `munk2207/naavi-voice-server` main.

### Prompt evolution (get-naavi-prompt)

v14 → v24 across the session. Key additions:
- v15: no-raw-metadata rule.
- v16-17: two-sentence honest-out + tightened mandates.
- v18: RULE 15 priority over RULE 19.
- v19: ambiguous-brand ask-first rule.
- v20: LIST_RULES / DELETE_RULE (RULE 20).
- v21: RULE 19 strengthened for question-form queries.
- v22: LIST_RULES match param.
- v23-24: DELETE_RULE.all flag + stronger "all" keyword guidance.

---

## 2. State at session close

- **V55.4 build 108** installed on Wael's phone, under live testing.
- **Voice server** on Railway — latest `0890d63` (voice unification) just deployed.
- **Graceful shutdown** deployed earlier — verified via Railway redeploy without dropping calls.
- **All forms** wired to Formspree and routing to Wael's inbox.
- **Website** synced with mobile — FAQ and Contact pages live.

---

## 3. Deferred / open issues

### Confirmed observations from phone testing (candidates for build 109)

| ID | Observation | Notes |
|---|---|---|
| P1 | "What's my home" truncated by Samsung keyboard | User-input capture issue |
| P2 | "Let me check what's stored for…" — Naavi reply cut mid-sentence | Response parser issue |
| P3 | Text says "I don't have a warranty" but card shows 2 Drive results | S2 false-positive still surfacing (condo meeting + Canadian Tire for "warranty" query) |
| P4 | Morning brief shows 7 days instead of today only | Voice server `fetchCalendarEvents` window |
| P5 | Voice identity gap phone-vs-mobile remains | Physics of 8 kHz telephony vs broadband MP3 — unfixable on Twilio |

### From AAB_BUNDLE_NEXT_RELEASE.md

S1 through S19 as logged in Session 21 — still open except where addressed in this session's Slice 3.

### Not yet tested

- `/speak-alert` (S12) end-to-end — no real location-arrival test performed this session. Geofence trigger → Twilio dial-out → voice should speak alert body in Aura Hera → hang up.

---

## 4. Commits this session

### naavi-app (mobile)
Multiple commits merging into V55.4 build 108 — home redesign, alerts screen, manage-rules wiring, help hub, forms, prompt v15–v24, S12 voice dial-out hookup.

### naavi-voice-server
- `b5959e4` — Graceful shutdown handler (activeCalls Set, drain polling, rejectIfShuttingDown middleware)
- `0890d63` — Voice unification (Aura Hera on greeting + reminder + speak-alert via /tts-play endpoint)

### mynaavi-website
Commits covering new faq.html + contact.html, shared.js nav/footer updates, dead-footer cleanup.

---

## 5. Next session — Session 23: Sync between Voice server and Mobile Voice

**Goal:** close the remaining gap between phone-call voice (voice server) and mobile voice (mobile app). After Session 22's unification, both now use Deepgram Aura Hera, but behaviors still diverge across channels. Audit and align end-to-end.

**In scope:**
1. **Voice-identity audit** — confirm Session 22's unification worked. Call Twilio, verify greeting + mid-call reply + reminder call + /speak-alert all sound like one voice. Note the physics-based 8 kHz phone vs broadband mobile gap (unfixable, document only).
2. **Behavioral parity** — same query on mobile voice vs phone voice should produce the same answer, the same retrieval, the same action. Map every divergence.
3. **Shared prompt coverage** — verify both surfaces fetch `get-naavi-prompt` and fall back sanely. Fallback copies in `lib/naavi-client.ts::buildSystemPrompt` and `naavi-voice-server/src/index.js::buildVoiceSystemPrompt` should stay roughly in sync with the Edge Function.
4. **Abbreviation / number / name normalisation** — `normalizeAbbrevForTTS` + `normalizePhoneForTTS` should run on both surfaces identically. Audit for drift.
5. **Action handler parity** — mobile useOrchestrator vs voice server. LIST_RULES, DELETE_RULE, SET_ACTION_RULE, SCHEDULE_MEDICATION, etc. — each should behave the same.
6. **STT quality** — Deepgram Nova-3 keyterm boost list (voice server) vs mobile Web Speech API. Known mobile voice gaps: "Hussein" name search fails (STT mis-transcription). Consider moving mobile to Deepgram STT for parity.
7. **Cue sync** — mobile "I'm listening" / "Goodbye" / hands-free cues should not feel like different voices. Verify all go through `lib/tts.ts::speakCue` (Aura Hera MP3).

**Out of scope (next session):**
- Build 109 (P1–P5 bug fixes) — separate session.
- S1–S19 burndown — separate session.

**Then after Session 23:**
- Test S12 end-to-end (location arrival → voice dial-out).
- Triage P1–P5 + start build 109.
- Continue S1–S19 burndown from `docs/AAB_BUNDLE_NEXT_RELEASE.md`.

---

## 6. Session rules honored

- No EAS build kicked off without explicit approval (after the mid-session correction).
- Numbered choices used consistently.
- No destructive git operations.
- Graceful shutdown deployed before further Railway redeploys to protect active calls.
- Test verdicts deferred to user's end.
