/**
 * Build docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.docx — research-and-planning
 * session output. Walks the 26-item holding list from
 * docs/SESSION_HANDOFF_2026-05-07_V57.13.7_BUILD_165.md and classifies each
 * item into Bugs / Features / Tooling / Ideas with severity-encoded IDs.
 *
 * Mirrors the markdown source at docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md.
 *
 * Run: node scripts/build-holding-list-classification-docx.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType,
} = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 120 },
  });
}

function pBold(text) {
  return p(text, { bold: true });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun(text)],
    spacing: { after: 60 },
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun(text)],
    spacing: { before: 280, after: 140 },
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun(text)],
    spacing: { before: 200, after: 100 },
  });
}

function title(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
    children: [new TextRun({ text, bold: true, size: 44, color: '1F3A68' })],
  });
}

function subtitle(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 280 },
    children: [new TextRun({ text, italics: true, size: 22, color: '555555' })],
  });
}

function calloutBox(heading, body) {
  return new Table({
    rows: [
      new TableRow({
        children: [new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: 'EAF2FB' },
          margins: { top: 140, bottom: 140, left: 200, right: 200 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: heading, bold: true, color: '1565C0' })],
              spacing: { after: 80 },
            }),
            new Paragraph({
              children: [new TextRun({ text: body })],
            }),
          ],
        })],
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ─── Table-cell helpers ────────────────────────────────────────────────────

function headerCell(text, widthPct) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, fill: '1F3A68' },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20 })],
    })],
  });
}

function cellText(text, opts = {}) {
  // Word table cells with very long text — use 9pt to keep tables readable.
  return new TableCell({
    width: { size: opts.widthPct, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
    children: [new Paragraph({
      children: [new TextRun({ text: String(text || ''), size: 18, bold: opts.bold || false })],
    })],
  });
}

function classificationTable(rows) {
  const widths = { id: 7, desc: 25, surface: 10, notes: 50, sa: 8 };
  return new Table({
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          headerCell('ID', widths.id),
          headerCell('Description', widths.desc),
          headerCell('Surface', widths.surface),
          headerCell('Notes', widths.notes),
          headerCell('Server/AAB', widths.sa),
        ],
      }),
      ...rows.map((r) => new TableRow({
        children: [
          cellText(r.id,      { widthPct: widths.id, bold: true, fill: 'F2F2F2' }),
          cellText(r.desc,    { widthPct: widths.desc }),
          cellText(r.surface, { widthPct: widths.surface, bold: true, fill: surfaceFill(r.surface) }),
          cellText(r.notes,   { widthPct: widths.notes }),
          cellText(r.sa,      { widthPct: widths.sa }),
        ],
      })),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// Surface column tag colours — easier scanning. Reuses the same palette
// hint as Server/AAB green/red/purple for consistency.
function surfaceFill(surface) {
  switch (String(surface || '').toLowerCase()) {
    case 'voice':    return 'E8F5E9'; // light green — voice is the moat
    case 'mobile':   return 'E3F2FD'; // light blue — mobile is configuration
    case 'both':     return 'FFF8E1'; // light amber — parity-required
    case 'backend':  return 'F3E5F5'; // light purple — shared backend
    case 'website':  return 'EFEBE9'; // light brown — out of mobile/voice scope
    default:         return undefined;
  }
}

// ─── Data ──────────────────────────────────────────────────────────────────

const bugs = [
  { id: 'B1b', desc: 'LIST_RULES backstop on mobile (revised 2026-05-08 after user-test)', surface: 'mobile', notes: 'Validated 2026-05-08 under Rule 17. Voice (PC) tested CLEAN — correctly listed alerts; voice half closed. Mobile (MV) tested BROKEN — Naavi said "I don\'t have any alerts in your records" when 7+ alerts exist in Settings. Revised fix scope: the phantom-action backstop regex (hooks/useOrchestrator.ts line 1207) catches "you have N alerts" but NOT "I don\'t have any alerts" / "you don\'t have any" / "there are no alerts" (wrong-direction phrasings). Two-part fix: (1) extend the regex to cover wrong-direction patterns; (2) synthesize a {type: \'LIST_RULES\'} action onto claudeActions[] when the backstop fires (original B1b ask). ~30-40 min code in hooks/useOrchestrator.ts. AAB required. Fix deferred to next AAB cycle.', sa: 'AAB' },
  { id: 'B1c', desc: 'Naavi misses brand-new emails for up to an hour', surface: 'backend', notes: 'When you ask Naavi about an email that arrived in the last hour, she may say she doesn\'t see it. She refreshes her view of your inbox once an hour; anything newer than the last refresh is invisible until next refresh. The fix makes her also peek at Gmail directly at the moment you ask, so a Bell bill that arrived 20 minutes ago shows up immediately. Validated 2026-05-08: voice clearly shows the gap (Naavi says "I don\'t have that email in your records"). Mobile masks the gap by surfacing related Drive documents instead, which feels helpful but isn\'t actually finding the email. Server-side change in shared backend code; both surfaces benefit. No app build needed. Same architectural pattern as live-calendar (already shipped). Sequencing: ship before F1b inbound SMS / WhatsApp because that feature reuses this overlay shape.', sa: 'Server' },
  { id: 'B2a', desc: 'Voice promises to schedule medication but doesn\'t create the events', surface: 'voice', notes: 'When you ask voice to schedule a medication ("aspirin once a day for the next 5 days"), Naavi confirms verbally that she\'ll set it up — but nothing actually gets created in your Google Calendar. Validated 2026-05-08: voice said "I\'ll set up your aspirin schedule for once daily over the next 5 days" and zero events landed in Google Calendar. The mobile app already does this correctly. The fix copies the mobile path over to voice. Server-only change, no app build. About an hour of work. Fix deferred to next focused server-side session. While at it, double-check that voice memory-deletion ("forget about X") removes the same items mobile would for the same input.', sa: 'Server' },
  { id: 'B2b', desc: 'You can\'t interrupt Naavi mid-sentence on the phone', surface: 'voice', notes: 'When Naavi is reading a long answer aloud and you want to cut her off, neither "Naavi stop" nor just "stop" makes her stop talking. Validated 2026-05-08: both forms tested, neither worked — Naavi kept reading. The original classification said only "Naavi stop" was broken and that bare "stop" still cut her off; that\'s no longer true. The whole interrupt path needs a fresh look, not just the wake-word handling. Server-only change, no app build. Fix deferred to next focused server-side session.', sa: 'Server' },
  { id: 'B2c', desc: 'You can\'t talk over Naavi on the phone', surface: 'voice', notes: 'When Naavi is reading aloud and you want to cut in with a new question (e.g. "What time is it?") without waiting for her to finish, nothing happens — she keeps reading and your interrupt has no visible effect. Validated 2026-05-08: tried a mid-sentence question while Naavi was talking; she kept reading and never acknowledged it. Likely the same root cause as B2b (stop words don\'t interrupt either) since both produce the same observable outcome — but the test does not distinguish "system never received your audio" from "system received it but didn\'t act on it." Root cause TBD pending further investigation (server log check, or a follow-up test where we listen for whether the interrupt question gets processed AFTER Naavi finishes). Original classification was a narrower hypothesis (Deepgram dropping the first word). Server-only change once root cause is confirmed. Fix deferred — investigate B2b and B2c together; they may be one bug or two.', sa: 'Server' },
  { id: 'B3a', desc: 'User hears two voices on mobile: Naavi\'s voice + the phone\'s built-in voice', surface: 'both', notes: 'Voice fragmentation confirmed 2026-05-08 by direct user observation (Wael heard the "other voice" on a long Naavi reply about Bob\'s invitation). Trace: the mobile app prefers Deepgram Aura via the cloud text-to-speech path, but falls back to the phone\'s built-in voice (Android native TTS via expo-speech) whenever the cloud path fails — Edge Function error, JWT expired, network blip, audio-focus hiccup, or any audio chunk returns null. The two sound noticeably different because they\'re separate TTS engines entirely. The architecture is intentional (cloud-preferred + native fallback so a reply is never silent). The user experience of "two voices" means the cloud path is failing often enough to be noticeable. Real fix is not "use one voice everywhere" — both are by design. Real fix: make cloud TTS reliable enough that fallback rarely fires. Connected to existing memory project_naavi_mobile_tts_loss.md (V54.2 fixed full-failure variant; per-call partial failures still happen). Diagnosis is server-side (check remote-logs for tts-chunk-null and tts-fallback-expo events). Fix scope depends on what diagnosis reveals — could be Edge Function reliability, JWT lifecycle, network timeout tuning, or chunked-fetch resilience. Phone-call (PC) fragmentation perception originally reported separately is NOT yet traced — different TTS architecture (voice server streams Aura via Twilio); may be a different phenomenon from the mobile fallback.', sa: 'Server' },
  { id: 'B3b', desc: 'Cosmetic ruler leak on long-wrap user bubbles', surface: 'mobile', notes: 'V57.13.7 two-layer overlay design (components/ConversationBubble.tsx on main): ruler Text contains invisible user content (color: \'transparent\') + faded dots; overlay Text positioned absolute on top. On long-wrap, Samsung One UI renders color: \'transparent\' as faintly visible text glyphs (compositor doesn\'t fully suppress). One-line fix: bubbleRulerInvisible: { color: \'transparent\' } → bubbleRulerInvisible: { opacity: 0 }. Compositor-level invisibility instead of glyph-level. AAB required. Architecture (invisible-user-content in ruler) must stay — it\'s what gives the bubble correct HEIGHT for long messages; just dots wouldn\'t size right.', sa: 'AAB' },
  { id: 'B3c', desc: 'Haptic vibration feels too subtle on Samsung long-press', surface: 'mobile', notes: 'Permission half already done — VIBRATE is in app.json line 31. Remaining: bump Vibration.vibrate(80) at app/index.tsx:1104 to 150 or pattern [0, 100, 50, 100] for stronger / more distinctive long-press confirmation. Fires on onChatLongPress (primary hands-free entry). Wael\'s feedback 2026-05-06: even with system haptics maxed, 80 ms feels too subtle on Samsung. AAB required. A/B during next AAB cycle: try 150 single buzz first, fall back to pattern if still subtle.', sa: 'AAB' },
  { id: 'B3d', desc: 'Verified-address rejection doesn\'t name the address', surface: 'both', notes: 'hooks/useOrchestrator.ts:1423 rejects unverified FETCH_TRAVEL_TIME with generic \'I can\'t confirm that address.\' but the captured destination variable (line 1400) is never interpolated. Fix: `I can\'t confirm \'${destination}\' for your meeting today. Please check the exact location and call me back.`. Mirror change in supabase/functions/get-naavi-prompt/index.ts line 620 (canonical fallback phrasing taught to Claude). ~5 min each side. AAB required for orchestrator; prompt deploy is server-only.', sa: 'Both' },
  { id: 'B3e', desc: 'Two blog articles still on age framing (banned-terms violation)', surface: 'website', notes: 'Two articles violate the 2026-05-05 banned-terms rule + the 2026-04-25 time-scarcity pivot: /blog/aging-in-place-gap.html and /blog/retrieval-not-storage.html, plus their cards on blog.html lines 110-116 and 126-132. Three options: (1) delete both articles + cards (cleanest, ~10 min); (2) rewrite cards + full posts in time-scarcity tone (~30-60 min per article); (3) rewrite cards only + delete posts — DON\'T (broken links). Repo: mynaavi-website (separate from mobile/voice). No AAB, no migrations. Choose option before next focused content session.', sa: 'Server' },
];

const features = [
  { id: 'F1a', desc: 'Mobile-side todo-list-per-alert', surface: 'mobile', notes: 'Pre-flight: 4 design questions to answer before code: (1) voice phrasing to reference the attached list vs shared lists; (2) coexistence with list_name field — both allowed or mutually exclusive? backwards compat for existing rules using list_name?; (3) visibility — show in Lists view or only inline with alert?; (4) reuse — what happens to the attached list when the alert is duplicated? Build pieces: schema migration ALTER TABLE action_rules ADD COLUMN list_id UUID REFERENCES lists(id) + cascade trigger; manage-list lazy-create when adding to alert-attached list; prompt teaching voice phrasing; buildAlertBody read path (mirror list_name); alert-detail UI (AAB); disambiguation logic for \'add X to my Y list\'. Wael 2026-05-08 rationale: removes post-creation friction (current tasks[] is set-once, list_name requires shared-list management), matches the Costco accumulating-items pattern, and could simplify architecture by absorbing tasks[]. ~1 session total: ½ design + ½ implementation.', sa: 'Both' },
  { id: 'F1b', desc: 'Inbound SMS / WhatsApp queryability', surface: 'backend', notes: 'Both SMS AND WhatsApp inbound coverage. Outbound already covered via sent_messages + adapter; inbound has no capture path on either channel. Plan in memory project_naavi_inbound_sms_whatsapp.md (2026-05-06). New inbound_messages table with channel column (sms / whatsapp) + 2 Twilio webhooks (one per channel) → voice-server endpoints → upsert; extract-message-actions Edge Function (Haiku) for action-candidate extraction; Global Search adapter; live-overlay path on naavi-chat. ~1–2 sessions, server-only, no AAB. Sequence after B1c email live-overlay (live-overlay pattern paid once). Out of scope: auto-reply (CLAUDE.md Rule 12), MMS/OCR, threading.', sa: 'Server' },
  { id: 'F1c', desc: 'Voice privacy UX (4-piece bundle)', surface: 'both', notes: '4-piece bundle (Wael 2026-04-20 directive: ship all four together): (1) per-result privacyTag from document_type in _interface.ts + drive / email_actions adapters; (2) privacy mode toggle — user_settings.privacy_mode_default column + Settings UI + voice command \'I\'m not alone\'; (3) voice-server decision layer in naavi-voice-server — pre-TTS check, SMS-offer dialog, response handling; (4) per-category preferences — privacy_medical / privacy_financial / privacy_legal columns + Settings UI. End-state: privacy-tagged items prompt \'Want me to text it?\' instead of being read aloud. Already in place: SearchAdapter.privacyTag field exists (hardcoded \'general\'), send-sms supports user_id+source. ~2 sessions. Server portions ship without AAB; Settings UI requires AAB.', sa: 'Both' },
  { id: 'F2a', desc: 'Onboarding Review (multi-phone + 7 other gaps)', surface: 'mobile', notes: 'Pre-implementation: every item below to be reviewed and approved by Wael before any code/doc work begins. Bundle: (1) multi-phone — additional_phones[] schema + Settings UI + per-phone SMS verify; (2) voice keyterms capture at setup (ties to B2d); (3) quiet hours field in First-Day Settings (currently checklist-only); (4) verified-address-rule expectation under \'What Naavi Learns\'; (5) consolidated \'data NOT to share\' privacy callout; (6) post-install first-call rehearsal with 5 starter prompts; (7) re-install / new-phone flow guidance; (8) first-week-vs-week-two expectation calibration. Source doc: scripts/build-onboarding-guide-docx.js → docs/MYNAAVI_ONBOARDING_GUIDE.docx. Settings UI additions require AAB; doc is a build-script regen.', sa: 'Both' },
  { id: 'F2b', desc: 'Demo line maturity (richer scenarios + conversion path + telemetry)', surface: 'voice', notes: 'Three sub-pieces, kept together as one decision point: (1) Telemetry — today everything is console.log(), nothing aggregates. Add events table + dashboard query: total calls, avg scenarios played, % opt-in for SMS, click-through on link, conversion to signup, scenario popularity, drop-off points. ~½ day. (2) Conversion attribution — SMS link mynaavi.com/start doesn\'t track which demo call the lead came from. Add per-call signup token in the SMS link; form captures token; DB join lets us see scenario-to-signup correlations. ~½ day. (3) Scenario richness — current 5 scenarios are fully hardcoded. Add more scenarios (medication scheduling, navigation, recurring delegation), variable data per call, one-level branching with canned follow-up responses. ~1–2 days. Sequencing: 1+2 first (measurement infrastructure unlocks decisions); 3 deferred until telemetry says which scenarios engage / fall flat. All server-side, no AAB. Already shipped: 5 canned scenarios, DTMF+speech routing, personalized greeting + name capture, 3-scenario / 5-min cap, personalized SMS recap from +14313006228.', sa: 'Server' },
  { id: 'F2c', desc: 'Walkie-talkie style turn-taking on voice — explicit end-of-message signal', surface: 'voice', notes: 'Today on the phone, Naavi has to guess when you\'ve finished talking. She uses silence detection — if you stop speaking for a while, she assumes you\'re done. This guessing causes problems: your full message can get cut off if you pause to think, the system can mistake background noise for speech, and there\'s no clear way to interrupt Naavi mid-sentence. The walkie-talkie idea: borrow the radio convention where each speaker says a clear end-marker word ("Over" is traditional) to signal "I\'m done, your turn." Apply this to phone calls — you say a designated word at the end of your message; Naavi knows the message is complete and responds. Open design question: which end-marker word to use. "Over" is the standard walkie-talkie term but appears in everyday speech ("the meeting is over there", "I have over fifty emails"); Wael agrees "Over" is the standard term but probably not the right word for this case. Alternatives to consider: "Naavi" at sentence end, "go ahead", or a hybrid where the marker is optional and silence-detection still works as fallback. May address the cluster of voice-input bugs (B2a / B2b / B2c) by replacing the always-listening, guess-when-done architecture they all depend on — though that\'s a hypothesis to validate during design, not a guaranteed outcome. Server-only change, no app build. Significant scope: design (pick end-marker, decide on hybrid vs strict) + implementation + user education. Pick the end-marker word before coding.', sa: 'Server' },
  { id: 'F3a', desc: 'Picovoice Eagle voice biometric (caller voiceprint ID)', surface: 'both', notes: 'Deferred — revisit when unknown-number caller confusion shows up as a real pattern, not before. Decouple from F2a Onboarding multi-phone work: build multi-phone via additional_phones[] on its own, no biometric coupling. Drop dead Azure columns (azure_voice_profile_id, azure_voice_offered_at) in next migration. Vendors if revived: Picovoice Eagle primary, ID R&D fallback. Stays in F (not Ideas): real solution exists; only the vendor is blocking.', sa: 'Both' },
];

const tooling = [
  { id: 'T1a', desc: 'Migrate both surfaces to Anthropic Structured Outputs', surface: 'both', notes: 'Three states across surfaces today: voice on tool-use (naavi-voice-server line 1777, post-V57.12.0); mobile on JSON-in-prompt (naavi-chat); neither on Structured Outputs (Anthropic Nov 2025 GA response_format: json_schema). Convergence target: both surfaces use Structured Outputs. Eliminates chain-store auto-fix bridge + the v57→v58→v59 prompt-drift cycle at the API level. ~1 day focused session, ~10 files. Holding-list framing was inverted — drift is real but neither side is "catching up"; both need migration to a third path. Detailed plan referenced in docs/SESSION_HANDOFF_2026-05-06_FIX_AAB.md.', sa: 'Server' },
  { id: 'T2a', desc: 'Maestro full-suite mobile UI test coverage', surface: 'mobile', notes: '13 scenarios in e2e/ (README says 11 — also stale). Smoke (01-smoke-launch) verified passing 2026-05-08. Full-suite run 2026-05-08: 6/13 PASS, 7/13 FAIL. Failing: 07 collapse-expand, 08 create-list, 09 clear-chat, 10 settings, 11 DraftCard send, 12 multi-location picker, 13 bubble truncation. All failures are <text> is visible mismatches — likely mix of stale assertions (UI labels renamed since test was written) and real regressions. Triage required before suite becomes a pre-build gate. README claim of "11 scenarios" also out of date. Setup doc: docs/MAESTRO_SETUP.docx.', sa: 'Server' },
  { id: 'T2b', desc: 'Phase 2 demo data (Gmail seeding for mynaavidemo)', surface: 'backend', notes: 'Phase 1 (calendar, 5 events) shipped via scripts/seed-demo-google-data.js. Phase 2 (Gmail) gap — script header comment ready (line 126), seed rows + run not done. Use cases: mobile-app demo recordings without Wael\'s personal data; deterministic backing for Maestro #6 (spend-summary-anthropic); future un-canning of demo line per F2b. ~30 min to add seed rows + one-time run. Idempotent via deterministic gmail_message_ids. DEMO_USER_ID 1dd01ef2-98d0-4ad0-aebc-ed4f878d7c53.', sa: 'Server' },
];

const ideas = [
  { id: 'I2a', desc: 'list_change alert trigger', surface: 'backend', notes: 'Deferred 2026-04-21 Session 20 with 7 design questions open + Wael\'s recommended stub answers in memory project_naavi_list_change_trigger_deferred.md. Pre-built but not applied: ~85-line findListChangeTriggers handler sketch, SQL migration to add \'list_change\' to trigger_type CHECK constraint, prompt addition to Rule 15. ~½ session design (confirm 7 stubs) + ½ session build. Server-only. Use cases: \'alert when grocery list hits 10\', \'alert when to-do is empty\', third-party routing (Q7). I2 = decisions answerable in a focused session.', sa: 'Server' },
  { id: 'I2b', desc: 'price alert trigger', surface: 'backend', notes: 'Deferred by design — external scraping / paid-API path not chosen. Concerns: scraping fragility (DOM changes, Cloudflare, Captcha), ToS issues, paid-API costs (Skyscanner / Kayak per-request), vertical fragmentation (flights / hotels / retail / gas each need its own integration), polling cadence + cost management. Use cases: flight price drops, retail item-on-sale, gas-station floors. I2 = path-selection decision answerable in a focused session; build is real-engineering after that.', sa: 'Both' },
  { id: 'I3a', desc: 'health alert trigger (Epic / wearable integration)', surface: 'backend', notes: 'Blocked — not actionable today. Epic FHIR account + BAA + PHIPA/PIPEDA review + wearable SDK integration (Withings / Garmin / Apple Health / Fitbit) all required as prereqs. Multi-month wall-clock, not session-scale. Trigger-handler work itself is small (mirrors weather / contact_silence patterns); compliance + ingestion infrastructure dwarfs it. Schema drafted in memory project_naavi_alert_scope.md. Use cases: \'alert me if my pulse is above 120\', \'text my wife if BP > 180\'. I3 = parked-deep until Epic / wearable integration becomes a live initiative.', sa: 'Both' },
];

const closed = [
  { num: 4,  item: 'Geofence reliability (pending phone reboot)', reason: 'Tested per Wael 2026-05-08 — no problems found. Will be reported if recurs. Underlying Google-OAuth disconnect bug (Phase 3 background-mode blocker) noted but not preemptively tracked — same rule.' },
  { num: 12, item: 'naavi-spend-summary Edge Function',          reason: 'Already shipped — function exists at supabase/functions/naavi-spend-summary/index.ts, aggregates documents.extracted_amount_cents directly, multi-user safe, multi-currency aware. Maestro e2e/06-spend-summary-anthropic.yaml PASSED in 2026-05-08 full-suite run. Holding-list "approved 2026-04-30, not built" was stale.' },
  { num: 14, item: 'Demo line "remind me" time-extraction loop', reason: 'Symptom impossible by architecture — demo line is now fully canned (5 hard-coded scenarios via DTMF + speech routing); no real reminder path exists on demo. Underlying bug (time-extraction loop) may still affect authenticated users on production line — log if it surfaces.' },
  { num: 'B1a', item: 'Voice live-calendar fetch (voice still on stale snapshot)', reason: 'Validated by user test 2026-05-08 (first item under CLAUDE.md Rule 17). Wael created a fresh Google Calendar event, asked voice (PC) — correct answer. Changed time + location, asked voice and mobile — both correct. Bug as classified does NOT reproduce in real use. The architectural read (voice reads from Supabase snapshot table populated every 6h) was correct about the code path but did not predict user-visible behavior; some sync mechanism keeps the snapshot fresh enough that staleness is not perceived. Reopen only if surfaces.' },
  { num: 'B2d', item: 'Voice name-search mistranscription ("Hussein")', reason: 'Pivoted to Feature 2026-05-08. User-facing test surfaced that name mistranscription is one symptom of a deeper architectural issue: voice (PC) uses an always-on noisy channel where Naavi has to guess turn boundaries; mobile (MV) uses clean push-to-talk. The right fix is structural (walkie-talkie style turn-taking) rather than name-by-name STT tuning. Tracked as F2c.' },
];

// ─── Build the document ────────────────────────────────────────────────────

const children = [];

children.push(title('Holding List Classification'));
children.push(subtitle('Research and planning session output — 2026-05-08'));

children.push(p('Walks the 26-item holding list from docs/SESSION_HANDOFF_2026-05-07_V57.13.7_BUILD_165.md and classifies each item into Bugs / Features / Tooling / Ideas with severity-encoded IDs.'));

children.push(h1('Classification scheme'));
children.push(p('Four lists, each with the same column shape (ID | Description | Surface | Notes | Server/AAB):'));
children.push(bullet('Bugs (B) — broken or incomplete behavior on a user-facing surface'));
children.push(bullet('Features (F) — new user-facing capabilities'));
children.push(bullet('Tooling (T) — internal dev / test / measurement infrastructure'));
children.push(bullet('Ideas (I) — brainstorming-stage entries; deferred-by-design or path-not-chosen items not yet committed as real features'));
children.push(p('Severity is encoded in the ID: 1 = top, 2 = medium, 3 = low. Letter suffix (a, b, c…) disambiguates within a severity tier (e.g., B1a, B1b, B1c are all top-severity bugs).'));
children.push(p('Server/AAB column tells you where the work lands:'));
children.push(bullet('Server — Edge Function, SQL, voice server, web; no AAB build required'));
children.push(bullet('AAB — mobile code; requires npx eas build --auto-submit'));
children.push(bullet('Both — server + mobile pieces'));
children.push(p('Surface column tells you which user-facing surface owns the work — used for cross-surface drift discipline (CLAUDE.md Rule 16):'));
children.push(bullet('voice — work lands on voice-server codebase only; no mobile change required'));
children.push(bullet('mobile — work lands on mobile codebase only; no voice change required'));
children.push(bullet('both — both surfaces; parity required (when one ships, the other must follow before drift)'));
children.push(bullet('backend — shared backend (Edge Functions / SQL); both surfaces benefit automatically'));
children.push(bullet('website — mynaavi-website repo only; neither mobile nor voice'));

children.push(calloutBox(
  'Architectural principle (Wael 2026-05-08)',
  'Every queryable channel = background sync at per-channel depth + live-overlay at question-time. Applies to calendar, email, SMS, WhatsApp.'
));

children.push(calloutBox(
  'Cross-surface drift discipline',
  'Surface column is best-effort interim discipline. The mechanical guarantee comes from Voice Completion Roadmap W2 (Anthropic Structured Outputs) + W3 (Voice Automated Regression Suite) — see VOICE_COMPLETION_ROADMAP_2026-05-08. Until W2 + W3 land, Surface tag + CLAUDE.md Rule 16 (parity-impact: on commits) are the human-discipline net.'
));

children.push(h1('Bugs (B)'));
children.push(classificationTable(bugs));

children.push(h1('Features (F)'));
children.push(classificationTable(features));

children.push(h1('Tooling (T)'));
children.push(classificationTable(tooling));

children.push(h1('Ideas (I)'));
children.push(p('Brainstorming-stage entries. Path or scope not yet chosen. Promote to F when committed as a real feature.'));
children.push(classificationTable(ideas));

children.push(h1('Closed without entry'));
children.push(p('Items walked but not added to any table. Reopen if symptom recurs.'));

const closedTable = new Table({
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell('Holding-list #', 10),
        headerCell('Item', 35),
        headerCell('Reason closed', 55),
      ],
    }),
    ...closed.map((c) => new TableRow({
      children: [
        cellText(String(c.num), { widthPct: 10, bold: true, fill: 'F2F2F2' }),
        cellText(c.item, { widthPct: 35 }),
        cellText(c.reason, { widthPct: 55 }),
      ],
    })),
  ],
  width: { size: 100, type: WidthType.PERCENTAGE },
});
children.push(closedTable);

children.push(h1('Final tally'));
children.push(bullet('Bugs (B): 10 — B1b, B1c, B2a, B2b, B2c, B3a, B3b, B3c, B3d, B3e'));
children.push(bullet('Features (F): 7 — F1a, F1b, F1c, F2a, F2b, F2c, F3a'));
children.push(bullet('Tooling (T): 3 — T1a, T2a, T2b'));
children.push(bullet('Ideas (I): 3 — I2a, I2b, I3a'));
children.push(bullet('Closed without entry: 5 — Items 4, 12, 14, B1a, B2d'));
children.push(bullet('Total: 28 (26 holding-list + 1 missed item B1c added 2026-05-08 + 1 new feature F2c added 2026-05-08)'));

children.push(h2('Tally by Server/AAB'));
children.push(bullet('Server-only: 13 — ship without AAB cycle'));
children.push(bullet('AAB-only: 4 — bundle into next AAB (B1b LIST_RULES backstop, B3b cosmetic ruler leak, B3c haptic vibration, plus AAB portion of Both items)'));
children.push(bullet('Both: 6 — cross-surface coordination'));

children.push(h2('Tally by Surface (cross-surface drift discipline)'));
children.push(bullet('voice: 5 — B2a, B2b, B2c, F2b, F2c'));
children.push(bullet('mobile: 6 — B1b, B3b, B3c, F1a, F2a, T2a'));
children.push(bullet('both: 5 — B3a, B3d, F1c, F3a, T1a (parity-required when one surface ships)'));
children.push(bullet('backend: 6 — B1c, F1b, T2b, I2a, I2b, I3a (shared backend; both surfaces benefit)'));
children.push(bullet('website: 1 — B3e (mynaavi-website only)'));
children.push(p('Items tagged "both" are the ones where Voice Completion Roadmap discipline matters most — when one surface ships, the other must follow before drift accumulates. See CLAUDE.md Rule 16 for the commit-message convention enforcing this. Mechanical guarantee comes from Voice Roadmap W2 (Structured Outputs) + W3 (Voice Automated Regression Suite).'));

children.push(h2('Tally by severity (active items only)'));
children.push(bullet('1 (top): 6 — B1b + B1c, F1a + F1b + F1c, T1a'));
children.push(bullet('2 (medium): 10 — B2a + B2b + B2c, F2a + F2b + F2c, T2a + T2b, I2a + I2b'));
children.push(bullet('3 (low): 7 — B3a + B3b + B3c + B3d + B3e, F3a, I3a'));
children.push(p('Total active = 23. Plus 5 closed-without-entry = 28.'));

children.push(h1('Session method'));
children.push(bullet('Walked all 26 holding-list items one at a time, with explicit user "done" signal between items.'));
children.push(bullet('Each item: research the codebase + memory, propose classification + severity + notes, user accepts / pushes back / closes.'));
children.push(bullet('One missed item surfaced post-walk (B1c email instant-search) and was added on Wael\'s catch.'));
children.push(bullet('Architectural principle (sync + live-overlay per channel) crystallized via B1c discussion.'));
children.push(bullet('Three holding-list items closed without entry (Items 4, 12, 14) where the symptom was already gone or already shipped.'));
children.push(p('This document is the canonical output. Future implementation work should reference IDs (e.g., "ship B1a + B1c together; both port the live-fetch pattern").'));

// ─── Document assembly ─────────────────────────────────────────────────────

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: 'Calibri', color: '1F3A68' },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Calibri', color: '2E5599' },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          {
            level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        // Landscape orientation — the four-column tables with long Notes
        // cells need the extra horizontal room.
        size: { width: 15840, height: 12240, orientation: 'landscape' },
        margin: { top: 720, right: 720, bottom: 720, left: 720 },
      },
    },
    children,
  }],
});

const outPath = path.join(__dirname, '..', 'docs', 'HOLDING_LIST_CLASSIFICATION_2026-05-08.docx');

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log('Wrote', outPath);
});
