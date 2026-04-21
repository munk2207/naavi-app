// Generates CLIENT_QUICK_REFERENCE.docx from the source markdown structure.
// Run: node build_client_reference_docx.js
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, LevelFormat,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
} = require('docx');

const FONT = 'Calibri';

function h(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    children: [new TextRun({ text, bold: true, font: FONT })],
    spacing: { before: 240, after: 120 },
  });
}

function p(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 80 },
    ...opts,
  });
}

function plain(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: 22, ...opts });
}

function quote(text) {
  return [plain('“'), plain(text, { italics: true }), plain('”')];
}

function bulletOrch(text) {
  return new Paragraph({
    numbering: { reference: 'orch-bullets', level: 0 },
    children: [
      plain('🔗 ', { bold: true, color: '1F6FEB' }),
      ...quote(text),
    ],
    spacing: { after: 60 },
  });
}

function bulletSimple(text) {
  return new Paragraph({
    numbering: { reference: 'simple-bullets', level: 0 },
    children: [
      plain('• ', { bold: true, color: '808080' }),
      ...quote(text),
    ],
    spacing: { after: 60 },
  });
}

function bulletOrchWithNote(text, note) {
  return new Paragraph({
    numbering: { reference: 'orch-bullets', level: 0 },
    children: [
      plain('🔗 ', { bold: true, color: '1F6FEB' }),
      ...quote(text),
      plain('  '),
      plain(note, { italics: true, color: '505050' }),
    ],
    spacing: { after: 60 },
  });
}

function numbered(text) {
  return new Paragraph({
    numbering: { reference: 'numbered', level: 0 },
    children: [plain(text)],
    spacing: { after: 60 },
  });
}

function note(text) {
  return p(plain(text, { italics: true, color: '505050' }));
}

function hr() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } },
    spacing: { before: 120, after: 120 },
  });
}

// --- Summary table ---
function summaryTable() {
  const border = { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cellMargins = { top: 100, bottom: 100, left: 140, right: 140 };

  function headerCell(text, width) {
    return new TableCell({
      borders,
      width: { size: width, type: WidthType.DXA },
      shading: { fill: '1F6FEB', type: ShadingType.CLEAR },
      margins: cellMargins,
      children: [new Paragraph({
        children: [new TextRun({ text, bold: true, color: 'FFFFFF', font: FONT })],
      })],
    });
  }
  function cell(text, width) {
    return new TableCell({
      borders,
      width: { size: width, type: WidthType.DXA },
      margins: cellMargins,
      children: [new Paragraph({ children: [plain(text)] })],
    });
  }

  const rows = [
    ['Command', 'Services chained'],
    ['Conversation recording (flagship)', 'Audio → Transcription → Claude → Calendar + Drive + Email + SMS + WhatsApp + Memory'],
    ['"When should I leave for…"', 'Calendar + Maps + Traffic'],
    ['"Add appointment with Dr. X"', 'Parse + Contacts + Calendar'],
    ['"Tell me about X"', 'Contacts + Calendar + Memory + Drive'],
    ['"Text my wife…"', 'Contacts alias resolution + SMS'],
    ['Morning brief', 'Calendar + Weather + Email + Reminders'],
    ['Medication from visit', 'Transcription + Claude + Calendar recurring events'],
  ];

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3360, 6000],
    rows: rows.map((row, idx) =>
      new TableRow({
        children: row.map((text, colIdx) =>
          idx === 0
            ? headerCell(text, colIdx === 0 ? 3360 : 6000)
            : cell(text, colIdx === 0 ? 3360 : 6000)
        ),
      })
    ),
  });
}

const children = [
  // Title
  new Paragraph({
    children: [new TextRun({ text: 'MyNaavi — Client Quick Reference', bold: true, size: 40, font: FONT, color: '1F6FEB' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'What to ask MyNaavi — hands-free from any room or car', italics: true, size: 22, font: FONT, color: '505050' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
  }),

  p(plain('Who this is for: a client reaching MyNaavi by phone. Print it, put it by the phone — or next to the car keys.')),
  new Paragraph({
    children: [
      plain('Legend: '),
      plain('🔗 ', { bold: true, color: '1F6FEB' }),
      plain('Orchestrated ', { bold: true }),
      plain('— one command, Naavi chains multiple services together. '),
      plain('• ', { bold: true, color: '808080' }),
      plain('Single service ', { bold: true }),
      plain('— one simple lookup.'),
    ],
    spacing: { after: 160 },
  }),
  hr(),

  // How to reach Naavi
  h('📞  How to reach Naavi', HeadingLevel.HEADING_2),
  p(plain('You don\'t need to pick up the phone to dial her. Once Naavi is saved as a contact on your phone (done during sign-in), just speak to whichever voice assistant you already use:')),
  new Paragraph({
    children: [plain('"Hey Google, call Naavi." ', { bold: true, color: '1F6FEB' }), plain('— from your phone, your car (Android Auto), your smart display')],
    spacing: { after: 60 },
    indent: { left: 360 },
  }),
  new Paragraph({
    children: [plain('"Hey Siri, call Naavi." ', { bold: true, color: '1F6FEB' }), plain('— from iPhone, Apple Watch, CarPlay, HomePod')],
    spacing: { after: 120 },
    indent: { left: 360 },
  }),
  p(plain('Your phone places the call. Naavi answers. No screen tapped.', { italics: true })),
  hr(),

  // Schedule & Calendar
  h('📅  Schedule & Calendar', HeadingLevel.HEADING_2),
  bulletSimple('What\'s on my schedule today?'),
  bulletSimple('What do I have this week?'),
  bulletSimple('Am I free Tuesday afternoon?'),
  bulletOrchWithNote('Add a doctor appointment with Dr. Smith on Friday at two.', '(parses time + date + person → looks up doctor → creates event)'),
  bulletOrchWithNote('When should I leave for my three pm meeting?', '(calendar + location + Maps traffic)'),
  bulletSimple('Move my dentist visit to next Monday.'),

  // Contacts
  h('👥  Contacts & People', HeadingLevel.HEADING_2),
  bulletOrchWithNote('Tell me about Fatma.', '(contacts + calendar history + recorded conversations)'),
  bulletOrch('Who is John?'),
  bulletSimple('What\'s Sarah\'s phone number?'),
  note('If a name is hard to catch, spell it NATO-style:'),
  p([plain('   '), ...quote('Tell me about F like Frank, A like Apple, T like Tom, M like Mary, A like Apple.')]),

  // Email
  h('📧  Email', HeadingLevel.HEADING_2),
  bulletSimple('Do I have any important emails?'),
  bulletSimple('What\'s my most recent email?'),
  bulletOrchWithNote('Email Sarah about tomorrow\'s lunch.', '(looks up email → drafts → confirms → sends)'),
  bulletOrch('Reply to John saying I\'ll call him tonight.'),

  // Messages
  h('💬  Messages (SMS & WhatsApp)', HeadingLevel.HEADING_2),
  bulletOrchWithNote('Text my wife that I\'m running late.', '(resolves "wife" from contacts → SMS)'),
  bulletOrchWithNote('Send a WhatsApp to John saying I\'ll be there in thirty minutes.', '(resolves John → WhatsApp template → sends)'),

  // Recording — flagship
  h('🎙️  Conversation Recording — flagship orchestration', HeadingLevel.HEADING_2),
  p([plain('"'), plain('Record my visit', { italics: true }), plain('" — starts recording. Then have the conversation naturally. Say "'), plain('Naavi stop', { italics: true }), plain('" to end it.')]),
  p([plain('Naavi asks title + participants. If a name is hard, say "'), plain('no, spell it', { italics: true }), plain('".')]),
  p(plain('After ending, one command triggers all of this automatically:', { bold: true })),
  numbered('Audio downloaded from phone carrier'),
  numbered('Full transcription via AssemblyAI'),
  numbered('Claude extracts appointments, prescriptions, tasks, tests'),
  numbered('Every prescription becomes daily calendar reminders'),
  numbered('Every appointment becomes a calendar event'),
  numbered('Summary saved to Google Drive (in your MyNaavi folder)'),
  numbered('Email with title, participants, summary, Drive link'),
  numbered('SMS + WhatsApp + push notification'),
  numbered('Participants indexed to memory — you can ask about them later'),
  p(plain('This is the strongest demonstration of Naavi\'s orchestration.', { bold: true, italics: true })),

  // Memory
  h('🧠  Memory & Knowledge', HeadingLevel.HEADING_2),
  bulletOrchWithNote('Tell me about my last visit with Dr. Smith.', '(conversations + calendar + notes)'),
  bulletOrch('What did Fatma say about my knee?'),
  bulletSimple('Remember I prefer afternoon appointments.'),
  bulletSimple('Forget that I drink coffee — I switched to tea.'),

  // Lists
  h('🛒  Lists (shopping, todos)', HeadingLevel.HEADING_2),
  bulletSimple('Add milk to my shopping list.'),
  bulletSimple('What\'s on my grocery list?'),
  bulletSimple('Read me my shopping list.'),
  bulletSimple('Remove bread from the list.'),

  // Medications
  h('💊  Medications', HeadingLevel.HEADING_2),
  p(plain('🔗 When a recorded doctor visit mentions a prescription, Naavi automatically:', { bold: true, color: '1F6FEB' })),
  numbered('Parses dosage and schedule'),
  numbered('Creates daily calendar reminders for the full duration'),
  numbered('Stores the medication plan in memory'),
  bulletSimple('When do I need to take my next pill?'),
  bulletSimple('What medications am I on?'),

  // Weather
  h('🌤️  Weather', HeadingLevel.HEADING_2),
  bulletSimple('What\'s the weather today?'),
  bulletSimple('Will it rain tomorrow?'),

  // Travel
  h('🚗  Travel Time', HeadingLevel.HEADING_2),
  bulletSimple('How long to drive to the clinic?'),
  bulletOrchWithNote('When should I leave for my next appointment?', '(calendar + location + Maps traffic)'),

  // Notes
  h('📝  Notes (Google Drive)', HeadingLevel.HEADING_2),
  bulletSimple('Save a note called medication schedule…'),
  bulletOrchWithNote('Find my note about the house.', '(searches memory AND your MyNaavi Drive folder)'),
  note('All notes saved in the MyNaavi folder — searchable from any device.'),

  // Morning brief
  h('🌅  Morning Brief — scheduled orchestration', HeadingLevel.HEADING_2),
  p(plain('Auto-delivered by phone at your set morning-call time. One call combines:')),
  numbered('Calendar for today'),
  numbered('Weather'),
  numbered('Important overnight emails'),
  numbered('Medication reminders'),
  numbered('Action-item follow-ups'),
  p([plain('Interrupt anytime: "'), plain('stop', { italics: true }), plain('", "'), plain('skip ahead', { italics: true }), plain('", "'), plain('tell me more', { italics: true }), plain('".')]),

  hr(),

  // Summary
  h('Where orchestration shines', HeadingLevel.HEADING_1),
  p(plain('The 🔗 commands are where Naavi is doing something no single app can do alone.')),
  summaryTable(),
  p([plain('Single-service commands (•) are convenience; orchestration (🔗) is the product.', { italics: true })]),

  hr(),
  p([plain('Document created April 17, 2026. Keep this printed beside the phone.', { italics: true, color: '707070', size: 20 })]),
];

const doc = new Document({
  creator: 'MyNaavi',
  title: 'MyNaavi Client Quick Reference',
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: FONT, color: '1F6FEB' },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: FONT, color: '0D4B9D' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'orch-bullets',
        levels: [{ level: 0, format: LevelFormat.NONE, text: '', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 360 } } } }] },
      { reference: 'simple-bullets',
        levels: [{ level: 0, format: LevelFormat.NONE, text: '', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 360 } } } }] },
      { reference: 'numbered',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          plain('MyNaavi Client Quick Reference  —  Page ', { color: '707070', size: 18 }),
          new TextRun({ children: [PageNumber.CURRENT], color: '707070', size: 18, font: FONT }),
        ],
      })] }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buffer => {
  const out = path.join(__dirname, 'CLIENT_QUICK_REFERENCE.docx');
  fs.writeFileSync(out, buffer);
  console.log(`Wrote ${out} (${buffer.length} bytes)`);
});
