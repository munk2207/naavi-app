/**
 * Generates docs/COMPETITIVE_TOUCHPOINTS.docx from the markdown source.
 * One-off build script — re-run if the markdown changes.
 */

const fs = require('fs');
const path = require('path');

// docx is installed globally; node won't auto-find it from a project script,
// so we resolve via the global npm path explicitly.
const DOCX_PATH = 'C:\\Users\\waela\\AppData\\Roaming\\npm\\node_modules\\docx';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat, PageOrientation,
} = require(DOCX_PATH);

// ─── Page geometry (US Letter) ───────────────────────────────────────────────
const PAGE_WIDTH = 12240;   // 8.5"
const PAGE_HEIGHT = 15840;  // 11"
const MARGIN = 1440;        // 1"
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN; // 9360

// ─── Colors ──────────────────────────────────────────────────────────────────
const ACCENT = '2E7D6A';        // teal — section headings
const ACCENT_LIGHT = 'D5E8E2';  // light teal — table header shading
const ROW_ALT = 'F4F4F4';       // alternating row shading
const BORDER_GRAY = 'BFBFBF';
const TEXT_BLACK = '000000';
const TEXT_DIM = '666666';

// ─── Borders helper ──────────────────────────────────────────────────────────
const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY };
const cellBorders = {
  top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder,
};
const cellMargins = { top: 100, bottom: 100, left: 140, right: 140 };

// ─── Reusable text runs ──────────────────────────────────────────────────────
function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 120 },
  });
}

function pMixed(runs, paraOpts = {}) {
  return new Paragraph({
    children: runs.map(r => r instanceof TextRun ? r : new TextRun(r)),
    spacing: { after: 120 },
    ...paraOpts,
  });
}

function bullet(runs) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: runs.map(r => r instanceof TextRun ? r : new TextRun(r)),
    spacing: { after: 80 },
  });
}

function divider() {
  return new Paragraph({
    children: [new TextRun('')],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER_GRAY, space: 1 } },
    spacing: { before: 240, after: 240 },
  });
}

// ─── Table helpers ───────────────────────────────────────────────────────────
function headerCell(text, width) {
  return new TableCell({
    borders: cellBorders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: ACCENT_LIGHT, type: ShadingType.CLEAR, color: 'auto' },
    margins: cellMargins,
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 20 })],
    })],
  });
}

function bodyCell(content, width, opts = {}) {
  // content can be a string, a TextRun, or an array of TextRuns
  let runs;
  if (typeof content === 'string') {
    runs = [new TextRun({ text: content, size: 20 })];
  } else if (content instanceof TextRun) {
    runs = [content];
  } else if (Array.isArray(content)) {
    runs = content;
  } else {
    runs = [new TextRun({ text: String(content), size: 20 })];
  }
  const shading = opts.alt
    ? { fill: ROW_ALT, type: ShadingType.CLEAR, color: 'auto' }
    : undefined;
  return new TableCell({
    borders: cellBorders,
    width: { size: width, type: WidthType.DXA },
    shading,
    margins: cellMargins,
    children: [new Paragraph({ children: runs })],
  });
}

function makeTable(columnWidths, headers, rows) {
  const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths,
    rows: [
      new TableRow({
        children: headers.map((h, i) => headerCell(h, columnWidths[i])),
        tableHeader: true,
      }),
      ...rows.map((row, rowIdx) => new TableRow({
        children: row.map((c, i) => bodyCell(c, columnWidths[i], { alt: rowIdx % 2 === 1 })),
      })),
    ],
  });
}

// ─── Section A — Google ecosystem ────────────────────────────────────────────
const sectionAColumns = [600, 2400, 6360];
const sectionAHeaders = ['#', 'Touchpoint', 'What Naavi does'];
const sectionARows = [
  ['1', 'Gmail', 'Reads tier-1 emails, classifies action items, harvests attachments, sends outbound'],
  ['2', 'Google Calendar', 'Reads ALL calendars (including subscribed + birthdays), creates / edits / deletes events'],
  ['3', 'Google Drive', 'Saves notes, transcripts, briefs, lists, and harvested attachments into a typed folder tree (MyNaavi/Documents/invoice/, etc.); searches both metadata and full-text'],
  ['4', 'Google Maps', 'Travel time, directions, traffic-aware ETA'],
  ['5', 'Google Places', 'Location-name resolution (home / office / branch-specific names) with cache'],
  ['6', 'Google People (Contacts)', 'Live multi-match lookup with otherContacts fallback'],
  ['7', 'Google Vision', 'OCR on scanned PDFs and image attachments'],
];

// ─── Section B — Naavi-managed ────────────────────────────────────────────────
const sectionBHeaders = ['#', 'Touchpoint', 'What it stores'];
const sectionBRows = [
  ['8',  'Reminders', 'One-off time-based reminders (mirrored to Calendar for visibility)'],
  ['9',  'Memory / REMEMBER', 'Free-text knowledge with pgvector embeddings'],
  ['10', 'Lists', 'Groceries, todo, packing — synced to Drive Docs'],
  ['11', 'Action Rules', 'Generic trigger framework: email, time, calendar, weather, contact-silence, location'],
  ['12', 'Sent Messages', 'Log of every SMS / WhatsApp / email Naavi sent'],
  ['13', 'Documents (typed)', '11 categories: invoice, warranty, receipt, contract, medical, statement, tax, ticket, notice, calendar, other'],
  ['14', 'Email Actions', 'Structured action items Claude pulls from emails (bills, appointments, renewals)'],
  ['15', 'Conversation Transcripts', 'Record-a-visit recordings + speaker-diarized transcripts saved to Drive'],
];

// ─── Section C — Real-world signals ───────────────────────────────────────────
const sectionCHeaders = ['#', 'Touchpoint', 'What Naavi does'];
const sectionCRows = [
  ['16', 'Geolocation / Geofencing', 'OS-level geofences fire arrival / departure events for location alerts'],
  ['17', 'Weather', 'External weather API drives weather-trigger rules'],
  ['18', 'MyChart (Epic) Health portal', 'OAuth-authenticated read of Robert’s medical records, lab results, appointments, and prescriptions from his Epic-backed health system. Brings clinical context into Naavi’s brief, search, and reminders alongside the rest of his data.'],
];

// ─── Section D — Voice + delivery ─────────────────────────────────────────────
const sectionDHeaders = ['#', 'Touchpoint', 'What it does'];
const sectionDRows = [
  ['19', 'Twilio Voice', 'Inbound call line and outbound morning brief calls'],
  ['20', 'Twilio SMS / WhatsApp', 'Alert delivery and confirmations'],
  ['21', 'Push Notifications (Expo)', 'Per-device alerts'],
  ['22', 'Deepgram STT + TTS (Aura)', 'Streaming voice in mobile and voice server'],
  ['23', 'AssemblyAI', 'Conversation diarization for Record-a-visit'],
];

// ─── Section E — Document processing pipeline ────────────────────────────────
const sectionEHeaders = ['#', 'Touchpoint', 'What it does'];
const sectionERows = [
  ['24', 'Attachment harvesting', 'Pulls PDF / JPG / PNG / DOCX / XLSX off tier-1 Gmail messages, uploads them into typed Drive folders, de-dupes per (user, message, filename)'],
  ['25', 'OCR + classification + routing', 'Claude Haiku reads PDF text layer; Vision DOCUMENT_TEXT_DETECTION handles scanned PDFs and images; Haiku classifies into 11 document types; sidecar .ocr.txt saved alongside; Drive file moved to the correct typed folder if the content-based classification differs from the harvest-time guess'],
];

// ─── Comparison table ────────────────────────────────────────────────────────
const cmpColumns = [2000, 1200, 2880, 3280];
const cmpHeaders = ['Service', 'Touchpoints', 'What’s covered', 'What’s missing vs Naavi'];
const cmpRows = [
  [
    [new TextRun({ text: 'Naavi', bold: true, size: 20 })],
    [new TextRun({ text: '~25', bold: true, size: 20 })],
    'Full list above + unified Global Search across 10 of them',
    'Banking, smart home, photos, music, wearables (planned in later phases)',
  ],
  [
    [new TextRun({ text: 'Google Workspace + Gemini', bold: true, size: 20 })],
    '5–8',
    'Gmail, Calendar, Drive, Meet, Chat — Gemini adds Photos, Maps, Search context',
    'No phone-call interface, no morning brief, no proactive triggers, no SMS / WhatsApp, no attachment harvesting, no senior-friendly voice loop',
  ],
  [
    [new TextRun({ text: 'Microsoft 365 + Copilot', bold: true, size: 20 })],
    '5–8',
    'Outlook, Teams, OneDrive, Word / Excel / PowerPoint, LinkedIn (light)',
    'Same gaps as Google. No voice-first or phone-line mode.',
  ],
  [
    [new TextRun({ text: 'Apple Intelligence (Siri)', bold: true, size: 20 })],
    '8–10',
    'Mail, Calendar, Notes, Reminders, Contacts, Maps, Photos, Health, Find My, Music',
    'Shallow reasoning, no proactive briefs, no email harvesting, no SMS / WhatsApp / email triggers, no Twilio voice line, iOS-only',
  ],
  [
    [new TextRun({ text: 'ChatGPT (with connectors)', bold: true, size: 20 })],
    '4–6',
    'Drive, OneDrive, Slack, web browsing, file upload, basic memory',
    'No phone calls, no SMS triggers, no calendar control, no geofencing, no document harvesting pipeline',
  ],
  [
    [new TextRun({ text: 'Amazon Alexa', bold: true, size: 20 })],
    '4–6',
    'Calendar (via integration), lists, music, smart home, skills, reminders',
    'Voice-only single device, no email / SMS understanding, no document layer, no global knowledge across sources',
  ],
  [
    [new TextRun({ text: 'Lively (Best Buy)', bold: true, size: 20 })],
    '3',
    'Phone, urgent response, concierge',
    'Single-device, no AI knowledge layer, no calendar / email / drive',
  ],
  [
    [new TextRun({ text: 'GrandPad', bold: true, size: 20 })],
    '5',
    'Photos, video calls, music, games, family feed',
    'Tablet-only, no AI, no email / calendar / drive integration',
  ],
];

// ─── Build the document ──────────────────────────────────────────────────────
const children = [
  // Title
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun('Competitive touchpoints matrix')],
  }),
  // Subtitle / metadata
  pMixed([
    new TextRun({ text: 'Internal document — Naavi product strategy', italics: true, color: TEXT_DIM, size: 22 }),
  ]),
  pMixed([
    new TextRun({ text: 'Last updated: ', bold: true, size: 22 }),
    new TextRun({ text: '2026-04-29', size: 22 }),
  ]),
  // Lead paragraph
  pMixed([
    new TextRun({ text: 'Naavi’s value comes from the breadth of its integration touchpoints AND the fact that 10 of them feed a single unified Global Search. Competitors aggregate at the suite level — 5 apps under one brand — but each app is its own data silo. This document maps Naavi’s integration surface against the major competitor categories.', size: 22 }),
  ]),
  divider(),

  // ── Naavi's touchpoints ──
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun('Naavi’s integration touchpoints (~25)')],
  }),
  pMixed([new TextRun({ text: 'Everything below is operational today (or partially built and noted), beyond Claude’s reasoning layer.', size: 22 })]),

  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun('A. Google ecosystem (7)')],
  }),
  makeTable(sectionAColumns, sectionAHeaders, sectionARows),
  p(''),

  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun('B. Naavi-managed personal data (8)')],
  }),
  makeTable(sectionAColumns, sectionBHeaders, sectionBRows),
  p(''),

  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun('C. Real-world signals (3)')],
  }),
  makeTable(sectionAColumns, sectionCHeaders, sectionCRows),
  p(''),

  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun('D. Voice and delivery infrastructure (5)')],
  }),
  makeTable(sectionAColumns, sectionDHeaders, sectionDRows),
  p(''),

  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun('E. Document processing pipeline (2)')],
  }),
  makeTable(sectionAColumns, sectionEHeaders, sectionERows),
  divider(),

  // ── Comparison table ──
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun('Comparison table')],
  }),
  makeTable(cmpColumns, cmpHeaders, cmpRows),
  divider(),

  // ── Why the count matters ──
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun('Why the count matters')],
  }),
  pMixed([
    new TextRun({ text: 'Most competitors aggregate at the suite level (multiple apps under one brand), but each app is its own data silo. Naavi is the only product where 10 touchpoints feed a single unified Global Search — when Robert asks ', size: 22 }),
    new TextRun({ text: '“when do I owe Bell?”', italics: true, size: 22 }),
    new TextRun({ text: ', the answer pulls from gmail + email_actions + drive + sent_messages simultaneously and composes one sentence.', size: 22 }),
  ]),
  pMixed([
    new TextRun({ text: 'The 10 Global Search adapters live today: knowledge, rules, sent_messages, contacts, lists, calendar, gmail, email_actions, drive, reminders.', size: 22 }),
  ]),

  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun('How competitors stack up against the unified-search axis')],
  }),
  bullet([
    new TextRun({ text: 'Google Gemini', bold: true, size: 22 }),
    new TextRun({ text: ' is moving toward unified search but stops at the Workspace boundary. No SMS, no Twilio voice, no proactive brief.', size: 22 }),
  ]),
  bullet([
    new TextRun({ text: 'Apple Intelligence', bold: true, size: 22 }),
    new TextRun({ text: ' is closest in personal-data breadth (~10 sources) but narrowest in reach. iOS-only, no phone-call interface for seniors, no third-party SMS / WhatsApp, no proactive morning brief.', size: 22 }),
  ]),
  bullet([
    new TextRun({ text: 'Senior-care products', bold: true, size: 22 }),
    new TextRun({ text: ' (Lively, GrandPad) have fewer than 5 touchpoints and zero AI knowledge layer. They solve hardware needs, not orchestration.', size: 22 }),
  ]),

  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun('The pipeline effect')],
  }),
  pMixed([
    new TextRun({ text: 'Five touchpoints chain together to make a single email attachment searchable, classified, and ready for retrieval:', size: 22 }),
  ]),
  // Code-style block — monospace runs in shaded paragraph
  ...[
    'Gmail (1)',
    '  → Attachment harvesting (24)',
    '  → OCR + classification (25)',
    '  → Drive typed folders (3)',
    '  → Documents store (13)',
    '  → Global Search (drive adapter)',
  ].map(line => new Paragraph({
    children: [new TextRun({ text: line, font: 'Consolas', size: 20 })],
    shading: { fill: 'F2F2F2', type: ShadingType.CLEAR, color: 'auto' },
    spacing: { after: 0 },
  })),
  p(''),
  pMixed([
    new TextRun({ text: 'No competitor today owns this end-to-end orchestration for a senior user.', bold: true, size: 22 }),
  ]),
  divider(),

  // ── Notes for revisions ──
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun('Notes for revisions')],
  }),
  bullet([
    new TextRun({ text: 'This document is internal. Re-cut for investor / sales decks as needed (see ', size: 22 }),
    new TextRun({ text: 'docs/LAUNCH_PLAN.md', font: 'Consolas', size: 20 }),
    new TextRun({ text: ' for messaging).', size: 22 }),
  ]),
  bullet([
    new TextRun({ text: 'When Naavi adds a new touchpoint, update Section A–E above and bump the total count in the comparison table.', size: 22 }),
  ]),
  bullet([
    new TextRun({ text: 'When a competitor announces meaningful new coverage (e.g. Apple Intelligence adds third-party SMS), update their row.', size: 22 }),
  ]),
];

const doc = new Document({
  creator: 'Naavi',
  title: 'Competitive touchpoints matrix',
  description: 'Internal document mapping Naavi’s integration touchpoints against major competitors.',
  styles: {
    default: {
      document: { run: { font: 'Arial', size: 22 } }, // 11pt body
    },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial', color: TEXT_BLACK },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: ACCENT },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 1 },
      },
      {
        id: 'Heading3',
        name: 'Heading 3',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: TEXT_BLACK },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 2 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_WIDTH, height: PAGE_HEIGHT, orientation: PageOrientation.PORTRAIT },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
    },
    children,
  }],
});

const outputPath = path.resolve(__dirname, '..', 'docs', 'COMPETITIVE_TOUCHPOINTS.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outputPath, buf);
  console.log(`Wrote ${outputPath} (${(buf.length / 1024).toFixed(1)} KB)`);
});
