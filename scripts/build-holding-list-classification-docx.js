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
  { id: 'B1b', desc: 'LIST_RULES synthesize-action backstop missing', surface: 'both', notes: 'Phantom-action detection loop in hooks/useOrchestrator.ts line 1280-1289 catches \'you have N alerts\' speech without LIST_RULES action and overrides speech to \'Let me pull up your alerts.\' — but doesn\'t synthesize a LIST_RULES action onto claudeActions[]. Naavi promises lookup and goes silent. Fix: parallel block to chain-store auto-fix at line 1258-1273; push {type: \'LIST_RULES\'} when the backstop fires. ~20-30 min, ~10 lines. AAB required (mobile orchestrator). Voice server lacks the speech-override backstop entirely; bundle into voice server\'s LIST_RULES handler same session for surface parity (Server).', sa: 'Both' },
  { id: 'B1c', desc: 'Email instant-search live-overlay (Option #3)', surface: 'backend', notes: 'Architectural principle — Wael 2026-05-08: every queryable channel = background sync at per-channel depth + live-overlay at question-time. Email today: 7-day sync window via sync-gmail cron stays as-is. ADD live Gmail API search at question-time — when user asks email question (voice or chat), naavi-chat triggers fresh Gmail API call with q= against subject + body for the question\'s keywords, Cache-Control: no-cache, merges with cached gmail_messages set, passes merged result to Claude. Same shape as naavi-chat::fetchLiveCalendarEvents (V57.11.2 / V57.11.6). Failure mode without it: Bell bill arrived 20 min ago → cron hasn\'t fired → Naavi says "no". ~30-60 min server-only port from calendar pattern. Unblocks F1b sequencing.', sa: 'Server' },
  { id: 'B2a', desc: 'Voice missing SCHEDULE_MEDICATION action', surface: 'voice', notes: 'Holding-list framing was stale — DELETE_EVENT / LIST_RULES / DELETE_MEMORY already at parity in voice server (lines 1938, 6411, 1967). Only real gap: SCHEDULE_MEDICATION not handled by voice. Port mobile handler at hooks/useOrchestrator.ts line 1549; uses same backend (loop of create-calendar-event). Behavior-diff sweep on DELETE_MEMORY recommended (voice does direct DB DELETE, mobile path may differ). ~1 hour, server-only.', sa: 'Server' },
  { id: 'B2b', desc: 'Voice "Naavi stop" stop-word regression', surface: 'voice', notes: 'Stop-word matcher (naavi-voice-server/src/index.js line 5161) compares exact strings. \'Naavi stop\' lower-cased = \'naavi stop\' which isn\'t in the array. Bare \'stop\' / \'enough\' / \'got it\' still work. Fix: strip leading wake-word (/^(na+h?v+ee?|naavi|navi)\\s+/i) before the stopWords lookup. Optional follow-up: also fire on interim transcripts (not just FINAL) for faster cut-off; track separately if mid-sentence interrupt feels laggy after the fix. ~30 min, server-only.', sa: 'Server' },
  { id: 'B2c', desc: 'Voice Deepgram first-word truncation on barge-in', surface: 'voice', notes: 'Deepgram drops first word on barge-in (\'What time is it?\' → \'Time is it?\'). Trivial fast-path regex (naavi-voice-server/src/index.js line 1343) doesn\'t cover leading-word-clipped variants for time/date/day. Fix: add (?:what\\s+)?time\\s+is\\s+it, (?:what\\s+)?day\\s+is\\s+it, (?:what\\s+)?(?:date|today\'s\\s+date) alternations. ~15 min, server-only. Deeper fixes (audio prebuffer / Deepgram endpointing tuning / STT retry) deferred — track separately if leading-word loss persists.', sa: 'Server' },
  { id: 'B2d', desc: 'Voice name-search mistranscription ("Hussein")', surface: 'voice', notes: 'Keyterm system shipped (fetchKnownNames from knowledge_fragments type=relationship + user_settings.voice_keyterms array + hardcoded naavi/nahvee). Original Apr 21 report predates this fix. Verify first: check whether "Hussein" is in Wael\'s voice_keyterms array OR is a relationship-type knowledge fragment; if missing, add via SQL (UPDATE user_settings SET voice_keyterms=...); re-test "tell me about Hussein" via voice. If it works → close. If it still mistranscribes despite keyterm priming → escalate to phonetic fallback (Soundex / Metaphone / Levenshtein on transcript at orchestrator layer; days of work).', sa: 'Server' },
  { id: 'B3a', desc: 'Standardize on a single Naavi voice across all surfaces (MV / MT / PC + all sub-flows)', surface: 'both', notes: 'Pending external verification — Wael perceives fragmentation between morning brief and in-call on +12495235394; code reads as one voice everywhere on production. Need a second listener to confirm a real audible difference exists before committing fix scope. If confirmed: sweep all TTS call sites + verify Railway deployed commit matches main.', sa: 'Server' },
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
children.push(bullet('Bugs (B): 11 — B1b, B1c, B2a, B2b, B2c, B2d, B3a, B3b, B3c, B3d, B3e'));
children.push(bullet('Features (F): 6 — F1a, F1b, F1c, F2a, F2b, F3a'));
children.push(bullet('Tooling (T): 3 — T1a, T2a, T2b'));
children.push(bullet('Ideas (I): 3 — I2a, I2b, I3a'));
children.push(bullet('Closed without entry: 4 — Items 4, 12, 14, B1a'));
children.push(bullet('Total: 27 (26 holding-list + 1 missed item B1c added 2026-05-08)'));

children.push(h2('Tally by Server/AAB'));
children.push(bullet('Server-only: 13 — ship without AAB cycle'));
children.push(bullet('AAB-only: 3 — bundle into next AAB (B3b cosmetic ruler leak, B3c haptic vibration, plus AAB portion of Both items)'));
children.push(bullet('Both: 7 — cross-surface coordination'));

children.push(h2('Tally by Surface (cross-surface drift discipline)'));
children.push(bullet('voice: 5 — B2a, B2b, B2c, B2d, F2b'));
children.push(bullet('mobile: 4 — B3b, B3c, F1a, F2a, T2a'));
children.push(bullet('both: 7 — B1b, B3a, B3d, F1c, F3a, T1a (parity-required when one surface ships)'));
children.push(bullet('backend: 6 — B1c, F1b, T2b, I2a, I2b, I3a (shared backend; both surfaces benefit)'));
children.push(bullet('website: 1 — B3e (mynaavi-website only)'));
children.push(p('Items tagged "both" are the ones where Voice Completion Roadmap discipline matters most — when one surface ships, the other must follow before drift accumulates. See CLAUDE.md Rule 16 for the commit-message convention enforcing this. Mechanical guarantee comes from Voice Roadmap W2 (Structured Outputs) + W3 (Voice Automated Regression Suite).'));

children.push(h2('Tally by severity (active items only)'));
children.push(bullet('1 (top): 6 — B1b + B1c, F1a + F1b + F1c, T1a'));
children.push(bullet('2 (medium): 10 — B2a + B2b + B2c + B2d, F2a + F2b, T2a + T2b, I2a + I2b'));
children.push(bullet('3 (low): 7 — B3a + B3b + B3c + B3d + B3e, F3a, I3a'));
children.push(p('Total active = 23. Plus 4 closed-without-entry = 27.'));

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
