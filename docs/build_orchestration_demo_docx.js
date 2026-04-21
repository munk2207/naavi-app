/**
 * Build NAAVI_ORCHESTRATION_DEMO.docx from hand-written content.
 *
 * One-shot script — run: node build_orchestration_demo_docx.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageBreak,
} = require('docx');

const OUT = path.join(__dirname, 'NAAVI_ORCHESTRATION_DEMO.docx');

// ─── Page + table constants ──────────────────────────────────────────────────
const PAGE_WIDTH   = 12240;   // US Letter width, DXA
const PAGE_HEIGHT  = 15840;   // US Letter height, DXA
const MARGIN       = 1440;    // 1" margins
const CONTENT_W    = PAGE_WIDTH - 2 * MARGIN; // 9360

// ─── Styles ──────────────────────────────────────────────────────────────────
const defaultFont = 'Calibri';
const bodySize    = 22; // 11pt

const docStyles = {
  default: {
    document: { run: { font: defaultFont, size: bodySize } },
  },
  paragraphStyles: [
    {
      id: 'Heading1',
      name: 'Heading 1',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: defaultFont, size: 44, bold: true, color: '1F3A5F' },
      paragraph: { spacing: { before: 320, after: 200 }, outlineLevel: 0 },
    },
    {
      id: 'Heading2',
      name: 'Heading 2',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: defaultFont, size: 30, bold: true, color: '1F3A5F' },
      paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 },
    },
    {
      id: 'Heading3',
      name: 'Heading 3',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: defaultFont, size: 26, bold: true, color: '2E5A8F' },
      paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 2 },
    },
    {
      id: 'Quote',
      name: 'Quote',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: defaultFont, size: bodySize, italics: true, color: '555555' },
      paragraph: {
        spacing: { before: 120, after: 120 },
        indent: { left: 540 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: '888888', space: 12 } },
      },
    },
  ],
};

const numberingConfig = {
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
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
const h3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(text)] });

const p = (runs, opts = {}) => new Paragraph({
  children: Array.isArray(runs) ? runs : [runs],
  spacing: { before: 80, after: 80 },
  ...opts,
});

const text = (t) => new TextRun(t);
const bold = (t) => new TextRun({ text: t, bold: true });
const italic = (t) => new TextRun({ text: t, italics: true });

const bullet = (runs) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  children: Array.isArray(runs) ? runs : [runs],
  spacing: { before: 40, after: 40 },
});

const quote = (t) => new Paragraph({
  style: 'Quote',
  children: [italic(t)],
  spacing: { before: 120, after: 120 },
});

const hr = () => new Paragraph({
  spacing: { before: 160, after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } },
  children: [],
});

// Label + body pair, e.g. "User says: ..." or "Services touched: ..."
const labelBlock = (label, body) => p([bold(label + ': '), text(body)]);

// Multi-line paragraph with inline bold label
const labelPara = (label, bodyLines) => {
  const paras = [p([bold(label + ':')])];
  for (const line of bodyLines) {
    paras.push(bullet([italic(line)]));
  }
  return paras;
};

// Table cell with standard padding + border
const border = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' };
const cellBorders = { top: border, bottom: border, left: border, right: border };

const cell = (paragraphs, opts = {}) => new TableCell({
  borders: cellBorders,
  width: { size: opts.width ?? (CONTENT_W / 2), type: WidthType.DXA },
  shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
  margins: { top: 100, bottom: 100, left: 160, right: 160 },
  children: Array.isArray(paragraphs) ? paragraphs : [paragraphs],
});

const row = (cells) => new TableRow({ children: cells });

// ─── Command entries ─────────────────────────────────────────────────────────
const commands = [
  {
    num: 1,
    title: 'Buried warranty, instantly surfaced',
    variants: [
      'Find the warranty for my washing machine.',
      'When does the washer warranty expire?',
      'Pull up my warranty paperwork.',
    ],
    plugs: 'Gmail → Claude Haiku (classify) → Google Drive (harvest) → Google Vision OCR → Supabase documents → Global Search → Claude Sonnet (answer)',
    reply: 'LG 4.5 Cu. Ft. WM3900H washing machine — warranty covers through July 14, 2028. The document is in your MyNaavi Drive folder.',
    replaces: 'Remembering which email, downloading the scanned PDF, trying to read faded image text, finding the expiry date.',
  },
  {
    num: 2,
    title: 'Geofenced grocery list that stays current',
    variants: [
      'Alert me at Costco with my grocery list.',
      'When I get to Costco, remind me what I need.',
    ],
    plugs: 'Google Places API → Supabase action_rules → Supabase lists → Google Drive (live Doc content) → phone GPS + OS geofence → Twilio SMS + WhatsApp + Gmail + FCM push',
    reply: 'Arrived at Costco. Grocery list: milk, eggs, bread, coffee, toilet paper.',
    replaces: 'A static reminder that has to be manually updated, opened, and read on the right device at the right moment.',
  },
  {
    num: 3,
    title: 'School calendar question answered from the PDF',
    variants: [
      'When is the first day of school?',
      "What's the next PA day?",
      'When does spring break start?',
    ],
    plugs: 'Gmail (attachment harvest) → Claude Haiku (classify as calendar) → Drive → Supabase documents → Claude Sonnet reads the PDF grid at ask-time → answer',
    reply: 'The first day of school is September 2, 2026.',
    replaces: 'Opening the school website, locating the PDF, navigating to September in a grid layout.',
  },
  {
    num: 4,
    title: 'Ambient absence detection',
    variants: [
      "Tell me if my sister Sarah hasn't emailed me in 30 days.",
      'Let me know if John goes quiet for two weeks.',
    ],
    plugs: 'Gmail sync → Supabase gmail_messages → evaluate-rules cron (every minute) → Twilio SMS + WhatsApp + Gmail + FCM push',
    reply: "Heads up — Sarah hasn't emailed you in 30 days. Worth a check-in.",
    replaces: 'No existing app reminds about the absence of something. This is a novel class of reminder.',
  },
  {
    num: 5,
    title: 'Morning brief as a phone call',
    variants: [
      "(Robert's phone rings at 8 AM)",
    ],
    plugs: 'Twilio voice → Google Calendar (all subscribed calendars) → Gmail (tier-1 summarization) → Open-Meteo weather → Supabase reminders → Claude Sonnet composes → Deepgram Aura Hera TTS',
    reply: 'Good morning, Wael. You have two things today: dentist at 2 PM on Bank Street, and Sarah is calling around 5. Ottawa is 4 degrees with rain by 3 PM — grab an umbrella for the dentist run. Two important emails: Bell confirmed your bill is paid, and the condo board sent the AGM date. Anything else?',
    replaces: 'Five apps glanced at in sequence, then mentally stitched together.',
  },
  {
    num: 6,
    title: 'In-call visit recorder',
    variants: [
      'Naavi, record my visit. (during a Twilio call)',
    ],
    plugs: 'Twilio recording → AssemblyAI transcription → Claude summary → Google Drive (save transcript) → Gmail (email summary to self) → Supabase documents → Global Search',
    reply: 'Recording your visit. [conversation happens] Email arrives: "Visit summary — Dr. Chen, April 21. BP 142/88, increase Atorvastatin to 40 mg, follow-up in 3 months. Full transcript in your Drive."',
    replaces: 'Robert trying to remember what the doctor said. Wife calling to ask. Reading scribbled notes.',
  },
  {
    num: 7,
    title: 'Home becomes a real place',
    variants: [
      'Alert me when I arrive home.',
      "Text me when I'm at the house.",
    ],
    plugs: 'Supabase user_settings.home_address → Google Geocoding API → user_places cache → phone GPS + OS geofence → Twilio SMS + WhatsApp + Gmail + FCM push',
    reply: "Your home from Settings — I'll alert you when you arrive.",
    replaces: 'Having to type coordinates, drop a pin on a map, or remember what Google thinks "home" means this week.',
  },
  {
    num: 8,
    title: 'Weather + checklist, one morning ping',
    variants: [
      'Text me at 7 AM if rain is forecast tomorrow with my umbrella list.',
      "Every morning, if it's snowing, remind me to clear the steps and salt the driveway.",
    ],
    plugs: 'Open-Meteo forecast → evaluate-rules cron → user timezone gate → Supabase lists → Google Drive (live list content) → Twilio SMS + WhatsApp + Gmail + FCM push',
    reply: 'Heads up — 80% chance of rain tomorrow afternoon. Umbrella list: umbrella, raincoat, waterproof shoes.',
    replaces: 'Manually checking the forecast, remembering to grab the umbrella, updating a static checklist.',
  },
  {
    num: 9,
    title: 'What do I know about David?',
    variants: [
      'What do I know about David?',
      'Pull everything on David Chen.',
    ],
    plugs: 'Google People API (contact card) + Supabase knowledge_fragments (REMEMBER notes via pgvector) + Global Search (emails, sent SMS, calendar events mentioning David) + Claude Sonnet synthesis',
    reply: "David Chen, architect at Hammond. You haven't emailed him in three weeks. Last message from him: the cottage renovation quote on March 30. You flagged him as 'wife's cousin' in memory last year.",
    replaces: 'Searching Contacts, then Gmail, then scrolling old messages, then piecing it together.',
  },
  {
    num: 10,
    title: 'Bill due surfaced from an invoice PDF',
    variants: [
      'When do I owe money to Bell?',
      "What's due on my Bell account?",
    ],
    plugs: "Gmail → Claude Haiku extract (action_type='pay') → attachment harvest → Vision OCR on scanned invoice → Supabase email_actions → Global Search",
    reply: "Your Bell invoice for $89.56 is due April 28. That's 5 days away.",
    replaces: 'Opening the email, downloading the PDF, reading the due line, doing the date math.',
  },
  {
    num: 11,
    title: 'Leave time with a weather buffer',
    variants: [
      'What time should I leave for my 3 PM dentist?',
      'When do I need to head out for the doctor?',
    ],
    plugs: 'Google Calendar (find the event + address) → Google Maps Directions API → Open-Meteo weather (rain buffer) → Claude Sonnet reasoning',
    reply: "Leave at 2:10. Normal drive is 25 minutes but rain is forecast, so I'm adding 15 minutes for traffic.",
    replaces: 'Looking up the event, copying the address to Maps, guessing the buffer for rain.',
  },
  {
    num: 12,
    title: 'Cross-channel recall of a conversation',
    variants: [
      'What did I tell the doctor about my blood pressure?',
      "Did I mention to David that I'd be late?",
    ],
    plugs: 'Supabase sent_messages (SMS + WhatsApp + email) + Supabase documents (voice transcripts) + Supabase knowledge_fragments (saved notes) → Global Search → Claude Sonnet',
    reply: 'On March 30 you told Dr. Chen your BP was running 140 over 85. You also texted Sarah on April 2 saying the new medication made you dizzy.',
    replaces: 'Scrolling through Messages, then Email, then Voice Memos — no unified search across them exists natively.',
  },
  {
    num: 13,
    title: 'Calendar-triggered message to a specific contact',
    variants: [
      "30 minutes before my dentist, text my wife I'll be late for dinner tonight.",
      'An hour before my flight, email my brother the arrival time.',
    ],
    plugs: 'Google Calendar event match → Supabase action_rules (calendar trigger) → Google People API (contact resolution: "my wife") → Twilio SMS + WhatsApp',
    reply: "(Sends to wife's phone:) He'll be late for dinner tonight — dentist appointment ran over.",
    replaces: 'Robert having to remember to text his wife while sitting in a waiting room.',
  },
  {
    num: 14,
    title: 'One sentence, two writes',
    variants: [
      "Remember Sarah's birthday is April 15.",
      'Save that my insurance number is POL-8841.',
    ],
    plugs: 'Claude Sonnet (extract) → Supabase knowledge_fragments (pgvector embed) → Google Calendar (auto-create annual event) → Global Search coverage',
    reply: "Saved. Also added 'Sarah's birthday' to your calendar as a yearly reminder on April 15.",
    replaces: 'Two separate trips — once to the notes app, once to the calendar.',
  },
  {
    num: 15,
    title: 'Prescription timeline from unstructured pharmacy email',
    variants: [
      'When does my Atorvastatin run out?',
      'How many days of blood pressure pills do I have left?',
    ],
    plugs: 'Gmail (pharmacy emails) → attachment harvest (prescription PDFs) → Claude Haiku extract (refill date, dosage) → Supabase email_actions + documents → Global Search → Claude Sonnet',
    reply: 'Your Atorvastatin 40 mg bottle has 12 days left based on the April 8 fill. Refill is authorized through July. Want me to flag a pickup reminder 3 days before?',
    replaces: 'Reading the pharmacy label, doing the math, remembering to re-order.',
  },
];

// ─── Build command sections ─────────────────────────────────────────────────
function buildCommand(c) {
  const blocks = [];
  blocks.push(h3(`${c.num}. ${c.title}`));
  blocks.push(p([bold('User says:')]));
  for (const v of c.variants) blocks.push(bullet([italic(`"${v}"`)]));
  blocks.push(labelBlock('Services touched', c.plugs));
  blocks.push(p([bold('Naavi replies:')]));
  blocks.push(quote(c.reply));
  blocks.push(labelBlock('What this replaces', c.replaces));
  blocks.push(hr());
  return blocks;
}

// ─── Summary table — "What this list proves" ────────────────────────────────
function buildSummaryTable() {
  const rows = [
    ['Claim', 'Commands that prove it'],
    ['Naavi reads documents, not just emails', '1, 3, 10, 15'],
    ['Naavi acts on the user\u2019s absence, not just their actions', '4'],
    ['Naavi operates when the user doesn\u2019t', '5, 8, 13'],
    ['Naavi unifies content across channels', '9, 12'],
    ['Naavi transforms unstructured input into structured output', '1, 3, 10, 14, 15'],
    ['Naavi respects personal language ("home", "wife", "my sister")', '2, 7, 13'],
    ['Naavi combines location, time, weather, and content in one action', '2, 8, 11'],
  ];

  const colA = 6240;
  const colB = CONTENT_W - colA; // 3120

  const tableRows = rows.map((r, idx) => {
    const isHeader = idx === 0;
    const shading = isHeader ? 'D5E3F0' : undefined;
    const runA = isHeader ? new TextRun({ text: r[0], bold: true }) : new TextRun(r[0]);
    const runB = isHeader ? new TextRun({ text: r[1], bold: true }) : new TextRun(r[1]);
    return row([
      cell([new Paragraph({ children: [runA] })], { width: colA, shading }),
      cell([new Paragraph({ children: [runB] })], { width: colB, shading }),
    ]);
  });

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [colA, colB],
    rows: tableRows,
  });
}

// ─── Build document ──────────────────────────────────────────────────────────
const children = [];

// Cover
children.push(h1('MyNaavi — Orchestration in Action'));
children.push(h2('15 commands that prove Naavi is not just integration'));
children.push(quote('Integration forwards data between two apps. Orchestration transforms it, reasons about it, and acts across many services on the user\u2019s behalf. Every command below reaches through at least three systems to deliver a result no single app can match.'));
children.push(hr());

// How to read this sheet
children.push(h2('How to read this sheet'));
children.push(bullet([bold('User says'), text(' — what Robert types or speaks, with natural variants.')]));
children.push(bullet([bold('Services touched'), text(' — each system Naavi calls to answer.')]));
children.push(bullet([bold('Naavi replies'), text(' — an example answer using real data shape.')]));
children.push(bullet([bold('What this replaces'), text(' — the human effort that goes away.')]));
children.push(hr());

// Commands
for (const c of commands) {
  for (const blk of buildCommand(c)) children.push(blk);
}

// What this list proves
children.push(h2('What this list proves'));
children.push(p([text('')]));
children.push(buildSummaryTable());
children.push(hr());

// Closer
children.push(h2('Why this is the product, not a feature'));
children.push(p([text('A calendar app tells you what\u2019s next. An email app tells you what came in. A weather app tells you whether to bring an umbrella.')]));
children.push(p([text('MyNaavi reads them all, reasons across them, and acts in the world on the user\u2019s behalf — via SMS, voice, email, and push — so that the senior using it never has to stitch any of it together manually.')]));

// ─── Build + write ───────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'MyNaavi',
  title: 'MyNaavi — Orchestration in Action',
  description: '15 multi-plug commands demonstrating Naavi\u2019s orchestration.',
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
