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
  { id: 'B1b', desc: 'LIST_RULES backstop on mobile (revised 2026-05-08 after user-test)', surface: 'mobile', notes: 'Phone (PC) lists alerts correctly. Mobile (MV) says "I don\'t have any alerts in your records" when 7+ alerts exist in Settings. Mobile-side fix queued for next AAB.', sa: 'AAB' },
  { id: 'B1d', desc: 'Pre-search "Nothing matched" gag overrides server-side live-overlay', surface: 'mobile', notes: 'After app reopen, the first email question answers correctly but a similar follow-up answers "I don\'t have an email" even when the email exists. Server-side fixes shipped 2026-05-10: search now finds naturally-phrased queries; recent-emails window covers up to 30 emails over 24 h; a TRUTH AT USER LAYER prompt rule makes Naavi answer the source the user named; deleted/trashed emails are excluded. Mobile-side soft-gag wording change is in main — queued for next AAB to fully close.', sa: 'AAB' },
  { id: 'B2a', desc: 'Voice promises to schedule medication but doesn\'t create the events', surface: 'voice', notes: 'Voice says "I\'ll set up your aspirin schedule" but nothing lands in Google Calendar. Mobile already does this correctly. Server-side fix copies the mobile path. While there, verify voice memory-deletion ("forget about X") matches mobile.', sa: 'Server' },
  { id: 'B2e', desc: 'Naavi misses recent emails (1+ hours old) until the hourly sync runs', surface: 'both', notes: 'Naavi missed emails between 1 hour old and the next hourly sync. Shipped 2026-05-09 (window widened to 24 h on both surfaces) + 2026-05-10 (capacity raised from 10 to 30 emails on both surfaces). Effectively closed; move to Closed at next session.', sa: 'Server' },
  { id: 'B3d', desc: 'Verified-address rejection doesn\'t name the address', surface: 'both', notes: 'When Naavi rejects an unverified destination, she says "I can\'t confirm that address" without naming the address. Add the destination to the rejection on both surfaces (e.g., "I can\'t confirm \'<destination>\' for your meeting today"). Mobile change requires AAB; voice prompt is server-only.', sa: 'Both' },
  { id: 'B3e', desc: 'Two blog articles still on age framing (banned-terms violation)', surface: 'website', notes: 'Two blog articles still use age framing (banned per 2026-05-05). Three options: delete both; rewrite in time-scarcity tone; or rewrite cards only and delete posts (avoid — broken links). Pick before next content session. Mynaavi-website repo only.', sa: 'Server' },
];

const features = [
  { id: 'F1a', desc: 'Lists wired to entities (alerts / calendar events / reminders)', surface: 'mobile', notes: 'A list is a first-class entity that can be CONNECTED to any alert / calendar event / reminder. One list ↔ many entities; each entity ↔ at most one list. Voice vocabulary (connect / attach / link / disconnect / query), confirmation flow, cascade behavior, and migration of today\'s two patterns (inline tasks + shared-list name) all defined. New Lists section in the 3-dots menu with three subcategories (All / Connected / Standalone). Spec locked 2026-05-09 — no open design questions. ~1.5–2 focused sessions: backend migration + mobile UI.', sa: 'Both' },
  { id: 'F1d', desc: 'User-controlled mute on PC + Mobile (replaces F1c)', surface: 'both', notes: 'User stops Naavi mid-reply when in public — long-press on mobile chat, or "no sound" / "quiet" / "shh" on phone. Phone path then offers "Want me to text the rest to your phone?" — confirmed reply delivers the full content via email + SMS hot link. Replaces the auto-classify approach (F1c, closed 2026-05-09). Mute vocabulary (kill-response bucket vs new privacy-mute bucket), content delivery, recovery, and 9 edge cases all defined. Spec locked 2026-05-09 — no open design questions. ~0.5–1 session, server-only (mobile already has the stop primitive).', sa: 'Both' },
  { id: 'F2a', desc: 'Onboarding Review (multi-phone + 7 other gaps)', surface: 'mobile', notes: 'Onboarding doc + Settings UI covering 8 gaps (multi-phone setup, voice keyterms capture at setup, quiet hours field, verified-address expectation, consolidated privacy callout, post-install rehearsal with starter prompts, re-install / new-phone flow, first-week-vs-week-two expectation calibration). Postponed 2026-05-09 — not all 8 have crisp product decisions; needs a dedicated session looking at onboarding end-to-end. Settings UI changes require AAB; doc is a build-script regen.', sa: 'Both' },
  { id: 'F2b', desc: 'Demo line maturity (richer scenarios + conversion path + telemetry)', surface: 'voice', notes: 'Demo phone line gets richer scenarios, a conversion path back to a real account, and telemetry to see what works. Postponed 2026-05-09 — marketing/growth decisions (which metrics matter, which scenarios resonate) need a focused session. Three sub-pieces in sequence: telemetry first (total calls, scenario popularity, opt-in rate, signup conversion), conversion attribution second (per-call token in the SMS link), scenario richness third (medication scheduling, navigation, recurring delegation, variable data, light branching). Already shipped: 5 canned scenarios, name capture, personalized SMS recap.', sa: 'Server' },
  { id: 'F3a', desc: 'Picovoice Eagle voice biometric (caller voiceprint ID)', surface: 'both', notes: 'Naavi recognizes who\'s speaking on a shared phone via voiceprint ID. Deferred until unknown-number caller confusion shows up as a real user pattern. Decoupled from F2a multi-phone work — multi-phone ships first via the additional-phones list, no biometric coupling. Vendor: Picovoice Eagle primary, ID R&D backup. Stays in Features (not Ideas) — solution exists; only vendor selection is open.', sa: 'Both' },
];

const tooling = [
  { id: 'T1a', desc: 'Migrate both surfaces to Anthropic Structured Outputs', surface: 'both', notes: 'Migrate phone and mobile to Anthropic\'s Structured Outputs API (Nov 2025 GA). Voice on tool-use today; mobile on JSON-in-prompt; neither on Structured Outputs. Convergence eliminates the recurring prompt-drift cycle at the API level and mechanically guarantees action-emission parity across surfaces. ~1 focused session.', sa: 'Server' },
  { id: 'T2a', desc: 'Maestro full-suite mobile UI test coverage', surface: 'mobile', notes: 'Mobile UI test suite — 13 scenarios. Smoke passes. Full suite 2026-05-08: 6 pass, 7 fail. Failures look like a mix of stale assertions (UI labels renamed since test was written) and real regressions. Triage required before the suite becomes a pre-build gate.', sa: 'Server' },
  { id: 'T2b', desc: 'Phase 2 demo data (Gmail seeding for mynaavidemo)', surface: 'backend', notes: 'Demo-data seeding for the demo account — Phase 1 (calendar) shipped; Phase 2 (Gmail) gap. Use cases: mobile-app demo recordings without personal data, deterministic backing for the Maestro spend-summary scenario, and future un-canning of the demo phone line. ~30 min to add and run the seed.', sa: 'Server' },
];

const ideas = [
  { id: 'I2a', desc: 'list_change alert trigger', surface: 'backend', notes: 'Alert when a list changes — e.g., "alert when grocery list hits 10 items" or "alert when to-do is empty." Deferred — 7 design questions open with stub answers (third-party routing, threshold semantics, etc.). ~½ session design + ½ session build.', sa: 'Server' },
  { id: 'I2b', desc: 'price alert trigger', surface: 'backend', notes: 'Alert when a price drops — flight, retail item, gas. Deferred — external integration path not chosen (scraping fragility, paid-API costs, vertical fragmentation across flights / hotels / retail / gas). Path-selection decision is a focused session; build is real engineering after that.', sa: 'Both' },
  { id: 'I3a', desc: 'health alert trigger (Epic / wearable integration)', surface: 'backend', notes: 'Alert when a health metric changes — "alert me if my pulse is above 120", "text my wife if BP > 180". Blocked — Epic FHIR account, healthcare-data agreement, privacy review, and wearable SDK integration are multi-month wall-clock prereqs. Trigger handler itself is small; compliance + ingestion infrastructure dwarfs it. Parked-deep until any one of those prereqs becomes a live initiative.', sa: 'Both' },
];

const closed = [
  { num: 4,  item: 'Geofence reliability (pending phone reboot)', reason: 'Tested per Wael 2026-05-08 — no problems found. Will be reported if recurs. Underlying Google-OAuth disconnect bug (Phase 3 background-mode blocker) noted but not preemptively tracked — same rule.' },
  { num: 12, item: 'naavi-spend-summary Edge Function',          reason: 'Already shipped — function exists at supabase/functions/naavi-spend-summary/index.ts, aggregates documents.extracted_amount_cents directly, multi-user safe, multi-currency aware. Maestro e2e/06-spend-summary-anthropic.yaml PASSED in 2026-05-08 full-suite run. Holding-list "approved 2026-04-30, not built" was stale.' },
  { num: 14, item: 'Demo line "remind me" time-extraction loop', reason: 'Symptom impossible by architecture — demo line is now fully canned (5 hard-coded scenarios via DTMF + speech routing); no real reminder path exists on demo. Underlying bug (time-extraction loop) may still affect authenticated users on production line — log if it surfaces.' },
  { num: 'B1a', item: 'Voice live-calendar fetch (voice still on stale snapshot)', reason: 'Validated by user test 2026-05-08 (first item under CLAUDE.md Rule 17). Wael created a fresh Google Calendar event, asked voice (PC) — correct answer. Changed time + location, asked voice and mobile — both correct. Bug as classified does NOT reproduce in real use. The architectural read (voice reads from Supabase snapshot table populated every 6h) was correct about the code path but did not predict user-visible behavior; some sync mechanism keeps the snapshot fresh enough that staleness is not perceived. Reopen only if surfaces.' },
  { num: 'B1c', item: 'Naavi misses brand-new emails for up to an hour', reason: 'Closed 2026-05-09 — fully verified on both surfaces. When the user asks an email-shaped question, Naavi now reaches Gmail directly so brand-new emails show up even before the hourly cron sync picks them up. Mobile half verified 2026-05-08 (Bob Invitation email found 3 min after arrival). Voice half initially appeared inconsistent on 2026-05-08; root cause traced 2026-05-09 to missing Railway env vars (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) — without them the voice OAuth refresh failed silently and the live-overlay never reached Gmail. After adding the env vars, both surfaces verified working with fresh emails (Football Game and Birthday Cake tests). Companion enhancement same session: live-overlay now states arrival time as clock time (e.g. "arrived at 10:59 AM") instead of relative minutes, on both surfaces.' },
  { num: 'B2b', item: 'You can\'t interrupt Naavi mid-sentence on the phone', reason: 'Closed 2026-05-09 — improved by music-queue drain fix. Root cause was Twilio\'s outbound audio queue holding 5+ seconds of thinking music ahead of Naavi\'s reply; stopMusic() only cancelled the music interval but didn\'t drain the queue. Fix: stopMusic() now sends Twilio event:\'clear\' to drain the outbound buffer. After the fix, "Naavi stop" successfully interrupts; first attempt sometimes missed (likely phone-side echo cancellation in speakerphone mode), second attempt always works. Was "broken" → now "works on second attempt 100%, first attempt sometimes missed." Real usability gain. Reopen if first-interrupt miss becomes a recurring complaint.' },
  { num: 'B2c', item: 'You can\'t talk over Naavi on the phone', reason: 'Closed 2026-05-09 — same root cause and fix as B2b. Both interrupts share the stopMusic() code path; the queue drain that fixed B2b also fixes B2c. Same first-interrupt-miss limitation in speakerphone mode.' },
  { num: 'B2d', item: 'Voice name-search mistranscription ("Hussein")', reason: 'Closed 2026-05-10 — the F2c structural fix was decided not to implement. Originally pivoted to F2c (walkie-talkie turn-taking) on 2026-05-08, but F2c was closed 2026-05-10 (marker-word ambiguity + today\'s latency work reduced the underlying pain). The remaining mitigation for name-search STT failures is the existing keyterms-capture feature and the continuing silence-detection improvements. Reopen if Hussein-style mistranscription recurs as a real user pattern.' },
  { num: 'F1b', item: 'Inbound SMS / WhatsApp queryability', reason: 'Closed 2026-05-09 — no viable architecture identified. WhatsApp inbound is structurally impossible (Meta restricts the WhatsApp Business API to business-to-customer messaging; would require Robert\'s contacts to message a separately-verified business number, not viable). SMS via OS-level READ_SMS carries Google Play rejection risk (use case not on Google\'s allowlist for AI assistants) and iOS isn\'t supported at all. SMS via Twilio proxy / carrier forwarding requires every contact to change behavior or carrier-level config most users can\'t set up alone. Email already covers ~80% of the underlying use case. Reopen if a clean architectural path emerges. Reference memory: project_naavi_inbound_sms_whatsapp.md.' },
  { num: 'F1c', item: 'Voice privacy UX (4-piece auto-classification bundle)', reason: 'Closed 2026-05-09 — superseded by F1d (user-controlled mute). The 4-piece bundle would have auto-classified items as private (medical / financial / legal) and offered SMS alternatives at read time. Wael 2026-05-09: auto-classification creates an unfixable social problem — forcing Robert to publicly engage in the privacy dialogue ("want me to text it?") itself reveals he has something to hide. False positives compound this: a pharmacy newsletter wrongly tagged "medical" would force the dialogue for nothing. Robert can\'t gracefully recover from misclassification in a public setting. The simpler reactive approach (F1d) — Robert decides in the moment whether to mute — avoids the false-positive social cost entirely while solving the same underlying privacy need. Reference memory: project_naavi_voice_privacy.md.' },
  { num: 'F2c', item: 'Walkie-talkie style turn-taking on voice — explicit end-of-message signal', reason: 'Closed 2026-05-10 — decided not to implement. Marker-word ambiguity remained unresolved ("over" appears in everyday speech; alternatives like "go ahead" / sentence-ending "Naavi" each had their own issues). Today\'s voice-call latency work (Polly gate prompt, pre-fetch on call connect, Haiku for brief, Twilio AMD removal) brought the answer-to-brief gap from ~13s to ~6s — the turn-boundary pain F2c targeted is less acute now. Existing silence-detection improvements (echo cancellation, smarter timing) remain the right ongoing path. Reopen only if a concrete marker-word design plus a real recurring turn-boundary symptom both surface.' },
  { num: 'B3c', item: 'Haptic vibration feels too subtle on Samsung long-press', reason: 'Parked 2026-05-10 — duration bump did NOT solve the bug. Build 166 shipped Vibration.vibrate(80) → Vibration.vibrate(150). On Wael\'s Samsung One UI / Android 14 device: long-press triggers the recording UI (function fires correctly) but produces NO perceptible buzz — both Vibration.vibrate and Haptics.impactAsync(Heavy) silently fail despite OS-level vibration intensity ~80% and all System vibration toggles ON. Suggests an Android 14 / Samsung-specific API issue, not a code-logic issue. Reopen with a new approach (vibration pattern instead of single shot, runtime VIBRATE permission re-check, or a different library like react-native-haptic-feedback) when haptic UX becomes a priority again.' },
  { num: 'B3b', item: 'Cosmetic ruler leak on long-wrap user bubbles', reason: 'Parked 2026-05-10 — cosmetic, low priority. Build 166 shipped the one-line fix (color:transparent → opacity:0 on the chat-bubble ruler style). Not retested by Wael (haptic distraction took precedence). The fix is shipped and ready to verify in a future session; until then it\'s parked because it\'s a cosmetic-only issue (faint dots behind a long user bubble on Samsung) with no functional impact. Reopen if the dots are visibly annoying when next viewed on a long bubble.' },
  { num: 'B3a', item: 'User hears two voices on mobile: Naavi\'s voice + the phone\'s built-in voice', reason: 'Parked 2026-05-10 — Path 1 only partially solved the bug. Build 166 shipped Path 1 (staysActiveInBackground: true + FOREGROUND_SERVICE_MEDIA_PLAYBACK permission). Wael\'s test result: background-during-reply keeps the cloud voice cleanly (Path 1 working), but resume-to-foreground mid-reply still triggers fallback to phone\'s native voice (Path 1 doesn\'t cover the resume case). Path 2 (custom Expo plugin declaring an Android foreground service for media playback) is the next step but parked until cloud-voice consistency becomes a recurring complaint. Reopen with Path 2 when the foreground-resume audio fragmentation becomes annoying.' },
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

children.push(h1('Shipped this session (2026-05-09)'));
children.push(p('Items not in the original 26-item holding list but addressed during the session:'));
children.push(bullet('PC outbound latency — user-perceived gap from "you finish speaking" to "Naavi starts replying" on phone calls reduced from ~14 s to ~4 s on trivial questions. Wave-test ground truth showed ~7 s of stale thinking-music tail blocking Naavi\'s reply (Twilio\'s outbound audio queue held up to 5 s of music ahead of every reply). Fix: stopMusic() now drains Twilio\'s outbound buffer immediately via event:\'clear\'. Companion change: chunk size aligned to Twilio\'s documented 20 ms expectation (was 1 s). Reverses the 2026-04 "do NOT drain queue" memory directive — the original cost was assumed to be 1.3–1.5 s but was actually 5–7 s. Memory file project_naavi_music_queue_latency.md updated. Bonus: the same fix also closes B2b and B2c (interrupts now work) since they shared the stopMusic() code path.'));

children.push(h1('Final tally'));
children.push(bullet('Bugs (B): 9 — B1b, B1d, B2a, B2e, B3a, B3b, B3c, B3d, B3e'));
children.push(bullet('Features (F): 6 — F1a, F1d, F2a, F2b, F2c, F3a'));
children.push(bullet('Tooling (T): 3 — T1a, T2a, T2b'));
children.push(bullet('Ideas (I): 3 — I2a, I2b, I3a'));
children.push(bullet('Closed without entry: 10 — Items 4, 12, 14, B1a, B1c, B2b, B2c, B2d, F1b, F1c'));
children.push(bullet('Total: 31 (26 holding-list + 1 missed item B1c added 2026-05-08 + 1 new feature F2c added 2026-05-08 + 1 new feature F1d added 2026-05-09 superseding F1c + 1 new bug B2e added 2026-05-09 + 1 new bug B1d added 2026-05-10)'));

children.push(h2('Tally by Server/AAB'));
children.push(bullet('Server-only: 10 — ship without AAB cycle'));
children.push(bullet('AAB-only: 5 — bundle into next AAB (B1b LIST_RULES backstop, B1d pre-search gag fix, B3b cosmetic ruler leak, B3c haptic vibration, plus AAB portion of Both items)'));
children.push(bullet('Both: 6 — cross-surface coordination'));

children.push(h2('Tally by Surface (cross-surface drift discipline)'));
children.push(bullet('voice: 3 — B2a, F2b, F2c'));
children.push(bullet('mobile: 7 — B1b, B1d, B3b, B3c, F1a, F2a, T2a'));
children.push(bullet('both: 6 — B2e, B3a, B3d, F1d, F3a, T1a (parity-required when one surface ships)'));
children.push(bullet('backend: 4 — T2b, I2a, I2b, I3a (shared backend; both surfaces benefit)'));
children.push(bullet('website: 1 — B3e (mynaavi-website only)'));
children.push(p('Items tagged "both" are the ones where Voice Completion Roadmap discipline matters most — when one surface ships, the other must follow before drift accumulates. See CLAUDE.md Rule 16 for the commit-message convention enforcing this. Mechanical guarantee comes from Voice Roadmap W2 (Structured Outputs) + W3 (Voice Automated Regression Suite).'));

children.push(h2('Tally by severity (active items only)'));
children.push(bullet('1 (top): 5 — B1b + B1d, F1a + F1d, T1a'));
children.push(bullet('2 (medium): 9 — B2a + B2e, F2a + F2b + F2c, T2a + T2b, I2a + I2b'));
children.push(bullet('3 (low): 7 — B3a + B3b + B3c + B3d + B3e, F3a, I3a'));
children.push(p('Total active = 21. Plus 10 closed-without-entry = 31.'));

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
