/**
 * Build NAAVI_TEAM_STATUS_BRIEF.docx — semi-technical status brief for
 * internal team meeting. Focus: functionality + models/services powering
 * each function. Target length: ~3-4 printed pages.
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType,
} = require('docx');

const OUT = path.join(__dirname, 'NAAVI_TEAM_STATUS_BRIEF.docx');

const PAGE_WIDTH  = 12240;
const PAGE_HEIGHT = 15840;
const MARGIN      = 1080;  // 0.75" — tighter margins for density
const CONTENT_W   = PAGE_WIDTH - 2 * MARGIN;

const defaultFont = 'Calibri';
const bodySize    = 20; // 10pt — tighter for a brief

const docStyles = {
  default: { document: { run: { font: defaultFont, size: bodySize } } },
  paragraphStyles: [
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: defaultFont, size: 40, bold: true, color: '1F3A5F' },
      paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: defaultFont, size: 26, bold: true, color: '1F3A5F' },
      paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: defaultFont, size: 22, bold: true, color: '2E5A8F' },
      paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 } },
  ],
};

const numberingConfig = {
  config: [
    { reference: 'bullets',
      levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
    { reference: 'numbered',
      levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
  ],
};

const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const h3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const p = (runs) => new Paragraph({
  children: Array.isArray(runs) ? runs : [runs],
  spacing: { before: 80, after: 80 },
});
const text = (t) => new TextRun(t);
const bold = (t) => new TextRun({ text: t, bold: true });
const italic = (t) => new TextRun({ text: t, italics: true });
const bullet = (runs) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  children: Array.isArray(runs) ? runs : [runs],
  spacing: { before: 30, after: 30 },
});
const numItem = (runs) => new Paragraph({
  numbering: { reference: 'numbered', level: 0 },
  children: Array.isArray(runs) ? runs : [runs],
  spacing: { before: 30, after: 30 },
});
const hr = () => new Paragraph({
  spacing: { before: 160, after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } },
  children: [],
});

// ─── Build document ──────────────────────────────────────────────────────────
const children = [];

children.push(h1('MyNaavi — Status Brief'));
children.push(new Paragraph({
  children: [new TextRun({ text: 'For internal team review • April 21, 2026', italics: true, color: '555555' })],
  spacing: { before: 0, after: 160 },
}));
children.push(hr());

// ── 0. Current state in one paragraph
children.push(h2('Current state in one paragraph'));
children.push(p([text('MyNaavi is a private-preview voice assistant for active seniors, currently shipping on Android via Google Play Internal Testing. Build V54.2 (103) is live on the test device with 11 of 11 end-to-end user journeys verified. The product spans a mobile Expo React Native app, a Twilio-based phone-call service on Railway, and 30+ Supabase Edge Functions orchestrating Anthropic Claude models, Deepgram speech, Google Workspace APIs, Open-Meteo weather, and Twilio messaging. The assistant supports six trigger types (email, time, calendar, weather, contact-silence, location), context-aware alerts that fan out across SMS + WhatsApp + Email + Push simultaneously, and a verified-address flow that refuses to create location alerts from guesswork.')]));

// ── 1. Functional surface
children.push(h2('1. Functional surface — what Naavi does today'));

children.push(h3('A. Natural-language orchestration'));
children.push(bullet([text('Creates calendar events, reminders, memory notes, and alerts from a single spoken sentence (multi-action parsing).')]));
children.push(bullet([text('Answers retrieval questions across calendar, contacts, email, lists, sent messages, saved documents, memory (pgvector), and Google Drive.')]));
children.push(bullet([text('Drafts messages (SMS / WhatsApp / email) on the user\u2019s behalf, reads them back, waits for explicit "yes" before sending.')]));

children.push(h3('B. Alerts and triggers'));
children.push(bullet([bold('Six trigger types: '), text('email, time, calendar, weather, contact_silence, location.')]));
children.push(bullet([bold('Self-alerts fan out to 4 channels '), text('(SMS + WhatsApp + Email + Push) in parallel for reliability across WiFi-only / cell-only conditions.')]));
children.push(bullet([bold('Context-carrying alerts: '), text('any rule can attach inline tasks or reference a live list \u2014 the list\u2019s current contents are resolved at fire time.')]));
children.push(bullet([bold('Expiry awareness: '), text('temporal phrases ("this weekend", "next 3 days") auto-set an expiry; a daily cron disables expired rules across every trigger type.')]));

children.push(h3('C. Morning brief call'));
children.push(bullet([text('Phone call from a Twilio number at the user\u2019s chosen time; reads today\u2019s calendar, weather, priority emails summarized, reminders due.')]));
children.push(bullet([text('Composed by Claude in one natural paragraph; spoken via Deepgram Aura Hera voice.')]));
children.push(bullet([text('Missed-call fallback: brief saved to Drive for later reading.')]));

children.push(h3('D. Voice-call recording and summarization'));
children.push(bullet([text('During a Twilio call, user says "record my visit". Naavi records.')]));
children.push(bullet([text('After call: transcribed (AssemblyAI), summarized (Claude Sonnet), saved to Drive, emailed, indexed to knowledge for future recall.')]));
children.push(bullet([text('Use case: doctor visits, mechanic appointments, phone interviews.')]));

children.push(h3('E. Email attachment pipeline (OCR \u2192 classify \u2192 harvest)'));
children.push(bullet([text('Inbound Gmail attachment pipeline runs asynchronously after sync-gmail.')]));
children.push(bullet([text('Attachment downloaded (PDF/JPG/PNG/DOCX/XLSX) \u2192 classified by Claude Haiku into 11 document types \u2192 uploaded to MyNaavi/Documents/{type}/ in user\u2019s Drive \u2192 text extracted (PDF text layer OR Google Vision OCR for scanned images) \u2192 indexed to documents table for Global Search.')]));
children.push(bullet([text('Result: scanned paper invoices become searchable in seconds.')]));

children.push(h3('F. Location intelligence'));
children.push(bullet([text('Place names resolved via Google Places API, biased by the user\u2019s home address.')]));
children.push(bullet([text('Every resolved address requires user confirmation before the rule is saved.')]));
children.push(bullet([text('Background geofencing uses Android OS-level fences (Expo Location + TaskManager) \u2014 survives app kill, battery-efficient.')]));
children.push(bullet([text('Personal keyword shortcuts ("home" / "office") map to saved addresses in user_settings.')]));

children.push(h3('G. Global Search'));
children.push(bullet([text('Single Edge Function fans out to 10 adapters in parallel: knowledge, rules, sent_messages, contacts, lists, calendar, gmail, email_actions, drive, reminders.')]));
children.push(bullet([text('Query normalization handles plural/singular ("payments" = "pay"), synonyms (bill \u2194 pay, meeting \u2194 appointment), email-username expansion.')]));
children.push(bullet([text('Results grouped by source for the UI, flat-ranked for voice read-aloud.')]));

children.push(h3('H. Multi-user architecture'));
children.push(bullet([text('Two user accounts in production. Each identified by caller phone on the voice side and JWT in the mobile app.')]));
children.push(bullet([text('Every Edge Function uses a strict 3-step user resolution: JWT \u2192 body user_id \u2192 user_tokens fallback. No .limit(1) shortcuts on shared tables.')]));

// ── 2. AI and service stack
children.push(h2('2. AI and service stack — what powers each function'));

{
  const colA = 4200;
  const colB = 3700;
  const colC = CONTENT_W - colA - colB;
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' };
  const borders = { top: border, bottom: border, left: border, right: border };

  const cell = (run, width, shading) => new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: shading ? { fill: shading, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      children: [run],
      spacing: { before: 0, after: 0 },
    })],
  });

  const row = (a, b, c, isHeader) => new TableRow({
    children: [
      cell(isHeader ? new TextRun({ text: a, bold: true, size: 18 }) : new TextRun({ text: a, size: 18 }), colA, isHeader ? 'D5E3F0' : undefined),
      cell(isHeader ? new TextRun({ text: b, bold: true, size: 18 }) : new TextRun({ text: b, size: 18, bold: true }), colB, isHeader ? 'D5E3F0' : undefined),
      cell(isHeader ? new TextRun({ text: c, bold: true, size: 18 }) : new TextRun({ text: c, size: 18 }), colC, isHeader ? 'D5E3F0' : undefined),
    ],
  });

  const rows = [
    row('Function', 'Primary model / service', 'Secondary / fallback', true),
    row('Main conversation reasoning', 'Anthropic Claude Sonnet 4.6', '\u2014'),
    row('Email action extraction, document classification', 'Anthropic Claude Haiku', '\u2014'),
    row('Text-to-speech (app + phone call)', 'Deepgram Aura (aura-hera-en)', 'expo-speech on network failure'),
    row('Speech-to-text (phone call live stream)', 'Deepgram Nova-2', '\u2014'),
    row('Speech-to-text (in-app mic)', 'Deepgram via transcribe-memo', '\u2014'),
    row('Voice-call recording transcription', 'AssemblyAI', '\u2014'),
    row('OCR on scanned images / PDFs', 'Google Vision DOCUMENT_TEXT_DETECTION', '\u2014'),
    row('Knowledge search (semantic)', 'pgvector + Claude embeddings', 'ILIKE on identifier-shape queries'),
    row('Place resolution', 'Google Places Text Search + Geocoding', '\u2014'),
    row('Calendar read / write', 'Google Calendar API', '\u2014'),
    row('Email read / send', 'Google Gmail API (user\u2019s OAuth)', '\u2014'),
    row('Contacts', 'Google People API (live)', 'Local contacts table (phones only)'),
    row('Drive read / write', 'Google Drive API v3', '\u2014'),
    row('Weather', 'Open-Meteo (free tier)', '\u2014'),
    row('SMS + WhatsApp outbound', 'Twilio Programmable Messaging', '\u2014'),
    row('Voice inbound call', 'Twilio Voice on Railway Node', '\u2014'),
    row('Push notifications', 'FCM (Android) + VAPID Web Push', '\u2014'),
    row('Persistence + auth', 'Supabase (Postgres + Edge Functions + Auth)', '\u2014'),
    row('Vector embeddings storage', 'Supabase pgvector', '\u2014'),
  ];

  children.push(new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [colA, colB, colC],
    rows,
  }));
}

// ── 3. Core architectural patterns
children.push(h2('3. Core architectural patterns'));

children.push(h3('Single source of truth for the Claude system prompt'));
children.push(p([text('One Edge Function (get-naavi-prompt) serves both the mobile app and the voice server. Either surface fetches the latest prompt at session start and appends channel-specific context. Prompt is at v13.')]));

children.push(h3('Single rule store'));
children.push(p([text('Every trigger type lives in one action_rules table with a generic trigger_type + trigger_config (JSONB) shape. One evaluate-rules cron runs every minute. Adding a new trigger = add a handler branch + extend the CHECK constraint.')]));

children.push(h3('Alert fan-out on self-alerts'));
children.push(p([text('Self-alerts fan out to SMS + WhatsApp + Email + Push. Third-party alerts stay on the requested channel. Rationale: SMS requires cell reception; a senior on WiFi-only misses SMS silently. Reliability trumps per-send cost.')]));

children.push(h3('Verified-address-only location rules'));
children.push(p([text('Naavi never creates a location alert from a guessed address. Every rule\u2019s address is either in memory from a prior conversation or freshly resolved and confirmed in-conversation with a readback. After 3 failed clarification attempts, Naavi stops and asks the user to call back.')]));

children.push(h3('Global-first user data'));
children.push(p([text('user_settings carries timezone, home_address, work_address, phone, name. Mobile auto-detects device timezone at signin. Foundation already in place for users outside Canada.')]));

// ── 4. Channels
children.push(h2('4. Channels — how the user reaches Naavi'));

{
  const colA = 2800;
  const colB = 4900;
  const colC = CONTENT_W - colA - colB;
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' };
  const borders = { top: border, bottom: border, left: border, right: border };

  const cell = (run, width, shading) => new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: shading ? { fill: shading, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [run], spacing: { before: 0, after: 0 } })],
  });

  const row = (a, b, c, isHeader) => new TableRow({
    children: [
      cell(isHeader ? new TextRun({ text: a, bold: true, size: 18 }) : new TextRun({ text: a, size: 18, bold: true }), colA, isHeader ? 'D5E3F0' : undefined),
      cell(isHeader ? new TextRun({ text: b, bold: true, size: 18 }) : new TextRun({ text: b, size: 18 }), colB, isHeader ? 'D5E3F0' : undefined),
      cell(isHeader ? new TextRun({ text: c, bold: true, size: 18 }) : new TextRun({ text: c, size: 18 }), colC, isHeader ? 'D5E3F0' : undefined),
    ],
  });

  children.push(new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [colA, colB, colC],
    rows: [
      row('Channel', 'Stack', 'Primary use', true),
      row('Mobile chat (typed)', 'Expo RN \u2192 naavi-chat Edge Function \u2192 Claude Sonnet', 'Precise queries, list review, settings'),
      row('Mobile voice (in-app mic)', 'Expo Audio \u2192 Deepgram STT \u2192 Claude \u2192 Deepgram Aura \u2192 expo-av playback', 'Hands-free capture, commands while multitasking'),
      row('Phone call (Twilio)', 'Twilio inbound \u2192 Railway Node \u2192 Deepgram streaming \u2192 Claude \u2192 Deepgram Aura', 'Conversations, morning brief, recording doctor visits'),
    ],
  }));
}

children.push(p([italic('All three share session memory, rule store, and knowledge. Saying "text my daughter" on a phone call produces the same draft flow as typing it in chat.')]));

// ── 5. Privacy
children.push(h2('5. Privacy and data boundaries'));
children.push(bullet([text('No third-party telemetry on user data. All personal data lives in the user\u2019s Supabase project and their own Google Workspace.')]));
children.push(bullet([text('Every outbound message (SMS, WhatsApp, email) requires explicit user "yes" before sending \u2014 voice-confirm pattern on every channel.')]));
children.push(bullet([text('Location stored only as "last-known", never as history. Geofence crossings are transient events; no trail persisted.')]));
children.push(bullet([text('Mobile app requests ACCESS_BACKGROUND_LOCATION only after a clear pre-ask screen (Google Play policy compliance).')]));

// ── 6. Ship state
children.push(h2('6. Ship state'));
children.push(bullet([bold('Mobile app: '), text('V54.2 build 103 on Google Play Internal Testing. Bundled via EAS on Expo SDK 55.')]));
children.push(bullet([bold('Voice server: '), text('Node + Twilio + Deepgram + Claude on Railway. Auto-deploys from GitHub main.')]));
children.push(bullet([bold('Backend: '), text('30+ Supabase Edge Functions. Postgres with pgvector + RLS policies per table.')]));
children.push(bullet([bold('Cron jobs: '), text('evaluate-rules (every minute \u2014 expiry sweep + all trigger types), Gmail sync, sent-message logging.')]));
children.push(bullet([bold('Test accounts: '), text('2 live users.')]));

children.push(h3('Recent deployment highlights (this week)'));
children.push(bullet([text('V54.0 \u2192 V54.1 \u2192 V54.2: three AAB builds covering weather + contact-silence + location trigger, verified-address flow, alert fan-out, mobile UX polish, voice-loss-mid-session fix.')]));
children.push(bullet([text('4 new migrations: action_rules_weather, action_rules_contact_silence, action_rules_location (+ user_places), user_settings_addresses.')]));
children.push(bullet([text('Prompt v11 \u2192 v12 \u2192 v13: added location rule + clarification cap.')]));

// ── 7. What's next
children.push(h2('7. What\u2019s next'));

children.push(h3('Focus of next session: end-to-end test and validation'));
children.push(bullet([text('Formal E2E test matrix (15 commands \u00D7 3 channels).')]));
children.push(bullet([text('Pre-ship smoke checklist (10 tests in 5 minutes before each AAB release).')]));
children.push(bullet([text('Server-only Node.js harness that exercises every Edge Function programmatically.')]));
children.push(bullet([text('Voice + text parity tester \u2014 confirm both input paths produce identical DB side-effects.')]));
children.push(bullet([text('Bug triage workflow \u2014 documented diagnostic path when a test fails.')]));

children.push(h3('Known bugs deferred to focused sessions'));
children.push(bullet([text('Voice STT mangles proper nouns \u2014 works for text, fails for voice name lookups. Voice server fix.')]));
children.push(bullet([text('Chat response text occasionally truncates ("Nothing stored on" missing the name token). Diagnostic logging live; needs repro capture.')]));
children.push(bullet([text('Voice stop-word regression ("Naavi stop" no longer interrupts TTS). Voice server fix.')]));

children.push(h3('Backlog items flagged but not started'));
children.push(bullet([text('list_change trigger (7 design questions logged, deferred).')]));
children.push(bullet([text('Voice-side privacy UX (4-piece feature for not reading medical/financial aloud in public).')]));
children.push(bullet([text('location trigger full polish (Phase 3-6 of the 6-phase plan).')]));
children.push(bullet([text('Epic FHIR health integration (schema drafted, not activated).')]));
children.push(bullet([text('Health-based triggers (requires Epic / wearable wiring).')]));

// ── 8. Open questions
children.push(h2('8. Open questions for the team'));
children.push(numItem([text('Target rollout timeline to a wider private-preview pool beyond the current 2 users?')]));
children.push(numItem([text('Appetite to prioritize voice bugs ahead of new features?')]));
children.push(numItem([text('Policy on deferred list_change trigger \u2014 ship with recommended defaults, or wait for the 7 design questions to be resolved?')]));
children.push(numItem([text('Plans for iOS port? Current stack (Expo) supports it; needs separate OAuth setup and APNs for push.')]));

children.push(hr());
children.push(new Paragraph({
  children: [new TextRun({ text: 'Prepared by Wael and Claude Code for internal team review. Questions: hello@mynaavi.com.', italics: true, color: '777777', size: 18 })],
  alignment: AlignmentType.CENTER,
  spacing: { before: 200, after: 0 },
}));

// ─── Build + write ───────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'MyNaavi',
  title: 'MyNaavi \u2014 Status brief',
  description: 'Semi-technical status brief for internal team review.',
  styles: docStyles,
  numbering: numberingConfig,
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT, buffer);
  console.log('Wrote', OUT);
}).catch((err) => {
  console.error('Failed to write docx:', err);
  process.exit(1);
});
