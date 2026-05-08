/**
 * Build docs/MOBILE_VS_PHONE_AUDIT_2026-05-04.docx — functional parity
 * audit between the mobile (Expo) and phone (Twilio voice) surfaces.
 *
 * Run: node scripts/build-mobile-vs-phone-audit-docx.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageBreak, PageOrientation,
} = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 120 },
  });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun(text)],
  });
}

function bulletRich(runs) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: runs,
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun(text)],
    spacing: { before: 240, after: 120 },
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
    spacing: { before: 0, after: 120 },
    children: [new TextRun({ text, bold: true, size: 40, color: '1F3A68' })],
  });
}

function subtitle(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 360 },
    children: [new TextRun({ text, italics: true, size: 24, color: '555555' })],
  });
}

function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: '1F3A68' },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20 })],
    })],
  });
}

function bodyCell(text, width, opts = {}) {
  const fill = opts.fill || null;
  const shading = fill ? { type: ShadingType.CLEAR, fill } : undefined;
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading,
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [new Paragraph({
      children: [new TextRun({ text, size: 20, bold: !!opts.bold, color: opts.color })],
    })],
  });
}

function statusFill(value) {
  const v = String(value).toLowerCase().trim();
  if (v === 'yes') return 'E6F4EA';
  if (v === 'no') return 'FCE8E6';
  if (v === 'same') return 'E6F4EA';
  return null;
}

// Action coverage: Action Type | Mobile | Phone | Notes
function buildActionTable() {
  const rows = [
    ['Action Type', 'Mobile', 'Phone', 'Notes'],
    ['CREATE_EVENT', 'Yes', 'Yes', 'Parallel; both call calendar Edge Function'],
    ['DELETE_EVENT', 'Yes', 'No', 'DRIFT: Mobile only'],
    ['SET_ACTION_RULE', 'Yes', 'Yes', 'Both supported'],
    ['FETCH_TRAVEL_TIME', 'Yes', 'Yes', 'Both supported'],
    ['GLOBAL_SEARCH', 'Yes', 'Yes', 'Cross-source'],
    ['LIST_RULES', 'Yes', 'No', 'DRIFT: Mobile only'],
    ['DELETE_RULE', 'Yes', 'Yes', 'Both; mobile has multi-match disambiguation'],
    ['REMEMBER', 'Yes', 'Yes', 'Both supported'],
    ['DELETE_MEMORY', 'Yes', 'No', 'DRIFT: Mobile only'],
    ['SAVE_TO_DRIVE', 'Yes', 'Yes', 'Both'],
    ['SCHEDULE_MEDICATION', 'Yes', 'No', 'DRIFT: Mobile only'],
    ['LIST_CREATE / ADD / REMOVE / READ', 'Yes', 'Yes', 'Both supported'],
    ['DRAFT_MESSAGE', 'Yes', 'Yes', 'Both'],
    ['ADD_CONTACT', 'Yes', 'Yes', 'Both'],
    ['SET_REMINDER', 'Yes', 'Yes', 'Both'],
    ['SET_EMAIL_ALERT', 'Yes', 'Yes', 'Both'],
    ['UPDATE_MORNING_CALL', 'No', 'Yes', 'DRIFT: Voice only'],
    ['START_CALL_RECORDING', 'No', 'Yes', 'DRIFT: Voice only'],
    ['SPEND_SUMMARY', 'Yes', 'Yes', 'Server-side backstop on both'],
  ];
  const widths = [2400, 1200, 1200, 4560]; // sum 9360
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) => new TableRow({
      children: r.map((cell, ci) => {
        if (i === 0) return headerCell(cell, widths[ci]);
        if (ci === 1 || ci === 2) {
          return bodyCell(cell, widths[ci], { fill: statusFill(cell), bold: true });
        }
        return bodyCell(cell, widths[ci]);
      }),
    })),
  });
}

// TTS normalization: Rule | Mobile | Phone | Parity
function buildTTSTable() {
  const rows = [
    ['Rule', 'Mobile', 'Phone', 'Parity'],
    ['Phone number splitting', 'Yes', 'Yes', 'Same'],
    ['Ordinal word expansion ("15th" → "fifteenth")', 'Yes', 'No', 'DRIFT: Voice doesn’t expand ordinals'],
    ['Ordinal rejoin ("1 5 t h" → "15th")', 'Yes', 'No', 'DRIFT'],
    ['Street suffixes (Dr / St / Ave / Blvd / Rd / etc.)', 'Yes', 'Yes', 'Same — 13 suffix rules'],
    ['Province codes (ON / QC / BC / AB)', 'No', 'Yes', 'DRIFT: Voice has 4-province expansion; mobile lacks'],
    ['Postal code phonetics (K2C 5M5)', 'No', 'Yes', 'DRIFT: Voice phonetizes; mobile doesn’t'],
    ['Period expansion ("..." for pauses)', 'No', 'Yes', 'DRIFT: Voice adds pause; mobile doesn’t (minor)'],
  ];
  const widths = [3400, 1200, 1200, 3560]; // sum 9360
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) => new TableRow({
      children: r.map((cell, ci) => {
        if (i === 0) return headerCell(cell, widths[ci]);
        if (ci === 1 || ci === 2) {
          return bodyCell(cell, widths[ci], { fill: statusFill(cell), bold: true });
        }
        if (ci === 3) {
          const fill = cell.startsWith('DRIFT') ? 'FFF3E0' : (cell === 'Same' ? 'E6F4EA' : null);
          return bodyCell(cell, widths[ci], { fill });
        }
        return bodyCell(cell, widths[ci]);
      }),
    })),
  });
}

const children = [];

children.push(title('MyNaavi — Mobile vs Phone Functional Parity Audit'));
children.push(subtitle('2026-05-04 — Session-end snapshot'));

children.push(h1('Executive Summary'));
children.push(p(
  'Mobile (Expo React Native) and Phone (Twilio voice) surfaces share most core actions and retrieval paths through the shared naavi-chat Edge Function and get-naavi-prompt, but diverge significantly in:'
));
children.push(bulletRich([
  new TextRun({ text: 'Action execution scope: ', bold: true }),
  new TextRun('Voice has UPDATE_MORNING_CALL and START_CALL_RECORDING (mobile equivalent: none). Mobile has DELETE_RULE prompt + disambiguation flow; voice has it inline.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'TTS normalization parity: ', bold: true }),
  new TextRun('Voice’s normalizeAbbrevForTTS (naavi-voice-server/src/index.js:2408) has 1 extra rule (province codes: ON→Ontario) vs. mobile’s text-to-speech Edge Function, plus voice handles postal codes with letter phonetics (M→"em", W→"double u").'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Calendar freshness: ', bold: true }),
  new TextRun('Mobile now fetches live Google Calendar per-request (naavi-chat:397–479) to eliminate staleness, but voice still pulls static calendar from Supabase REST endpoint (index.js:395–427).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Prompt context injection: ', bold: true }),
  new TextRun('Both now include home/work address in user reference section (naavi-chat:500–584), fixing a known gap.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Phantom-action backstop: ', bold: true }),
  new TextRun('Implemented server-side (naavi-chat:52–91) mirrored to mobile’s client-side check (useOrchestrator). SPEND_SUMMARY phantom detection on both.'),
]));
children.push(p(''));
children.push(new Paragraph({
  spacing: { before: 120, after: 120 },
  children: [
    new TextRun({ text: 'Biggest drift: ', bold: true }),
    new TextRun('Voice recording + morning-call feature has no mobile counterpart; mobile DraftCard confirm-to-send has no voice equivalent.'),
  ],
}));

children.push(h1('Action Coverage'));
children.push(p('One row per action across both surfaces. "DRIFT" = the action is implemented on only one surface.'));
children.push(buildActionTable());

children.push(h1('Prompt Context Comparison'));
children.push(h2('Mobile injects'));
children.push(p('User name, phone, home address (V57.11.2), work address (V57.11.2), live calendar events (V57.11.2), brief items, health context, knowledge fragments, upcoming days, language.'));
children.push(h2('Voice injects'));
children.push(p('User name, phone, home address (V57.11.2), work address (V57.11.2), calendar events (STATIC Supabase snapshot — drift), knowledge fragments, user lists, upcoming days, language.'));
children.push(h2('Drift markers'));
children.push(bullet('Calendar staleness on voice (mobile fetches live, voice uses snapshot).'));
children.push(bullet('Home/work address parity verified.'));

children.push(h1('TTS Normalization Parity'));
children.push(p('One row per normalization rule. "Same" = identical behavior; "DRIFT" = surfaces differ.'));
children.push(buildTTSTable());

children.push(h1('Backstop Coverage'));
children.push(p('Server-side phantom-action detection mirrored to both surfaces.'));
children.push(bulletRich([
  new TextRun({ text: 'CREATE_EVENT phantom: ', bold: true }),
  new TextRun('catches "I’ve scheduled / added / booked" speech without action.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'DRAFT_MESSAGE phantom: ', bold: true }),
  new TextRun('catches "I’ve drafted / sent" speech without action.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'REMEMBER phantom: ', bold: true }),
  new TextRun('catches "I’ve saved / saved to memory" speech without action.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'SET_ACTION_RULE phantom: ', bold: true }),
  new TextRun('catches "I’ll alert / notify you when" speech without action.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'SPEND_SUMMARY phantom: ', bold: true }),
  new TextRun('catches "let me add up / tally / sum up" speech without action.'),
]));
children.push(p('Both surfaces protected.', { bold: true }));

children.push(h1('Surface-Unique Features'));
children.push(p('Intentional asymmetries — NOT bugs.'));
children.push(h2('Voice-only'));
children.push(bullet('Barge-in detection'));
children.push(bullet('Soft-tick thinking sound'));
children.push(bullet('Call recording (START_CALL_RECORDING)'));
children.push(bullet('Morning brief call (UPDATE_MORNING_CALL)'));
children.push(bullet('Wake-word detection'));
children.push(bullet('Hands-free conversation'));
children.push(h2('Mobile-only'));
children.push(bullet('Visits panel'));
children.push(bullet('DraftCard confirm-to-send'));
children.push(bullet('Walkie-talkie mode'));
children.push(bullet('Brief panel UI'));
children.push(bullet('Calendar PDF injection'));
children.push(bullet('Health context panel'));
children.push(bullet('Contact resolution UI'));
children.push(bullet('Deletion UI confirmations'));

children.push(h1('Prioritized Drift Findings'));
children.push(h2('P0 — Functional gaps'));
children.push(bulletRich([
  new TextRun({ text: '1. DELETE_EVENT missing on voice — ', bold: true }),
  new TextRun('Voice users can’t delete calendar events.'),
]));
children.push(bulletRich([
  new TextRun({ text: '2. Calendar staleness on voice — ', bold: true }),
  new TextRun('Voice fetches static Supabase snapshot; mobile fetches live. Voice gives stale meeting times.'),
]));
children.push(bulletRich([
  new TextRun({ text: '3. Postal code phonetics missing on mobile — ', bold: true }),
  new TextRun('Mobile says "K2C5M5" and Deepgram guesses "five meter five"; voice spells out correctly.'),
]));

children.push(h2('P1 — Feature gaps'));
children.push(bulletRich([
  new TextRun({ text: '4. SCHEDULE_MEDICATION missing on voice.', bold: true }),
]));
children.push(bulletRich([
  new TextRun({ text: '5. LIST_RULES missing on voice — ', bold: true }),
  new TextRun('Voice users can’t list their own active alerts.'),
]));
children.push(bulletRich([
  new TextRun({ text: '6. Ordinal expansion missing on voice — ', bold: true }),
  new TextRun('Date speech quality slightly lower on voice.'),
]));
children.push(bulletRich([
  new TextRun({ text: '7. Province codes missing on mobile — ', bold: true }),
  new TextRun('"Ottawa, ON" reads as "Ottawa, on" instead of "Ottawa, Ontario".'),
]));

children.push(h2('P2 — Implementation divergence (both work, different paths)'));
children.push(bulletRich([
  new TextRun({ text: '8. DELETE_RULE flow asymmetry — ', bold: true }),
  new TextRun('Mobile has two-turn disambiguation; voice inlines it.'),
]));
children.push(bulletRich([
  new TextRun({ text: '9. Home/work address freshness — ', bold: true }),
  new TextRun('Voice always sees current; mobile may see stale until app refreshes settings.'),
]));

// Page break before Limitations
children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(h1('Limitations of This Audit'));
children.push(bullet('Runtime behavior not tested — differing regex edge cases not verified with live Deepgram output.'));
children.push(bullet('Phone number format variations — Deepgram handling of "+1 6 1 3 ..." vs. "+1 613" not confirmed in production calls.'));
children.push(bullet('Email alert disambiguation — contact lookup failure modes (0 matches, >1 matches) may differ subtly.'));
children.push(bullet('Calendar PDF injection scope — boundary conditions not verified.'));
children.push(bullet('Phantom-action regex rigor — safety net, not a guarantee — Haiku V4.5 speech generation varies by prompt context.'));
children.push(bullet('Prompt caching efficiency — cache hit rates not benchmarked across both surfaces.'));
children.push(bullet('Knowledge injection breadth — truncation thresholds may differ in practice.'));
children.push(bullet('Supabase schema drift — silent retrieval failures possible if schemas diverge.'));

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
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    children,
  }],
});

const outPath = path.join(__dirname, '..', 'docs', 'MOBILE_VS_PHONE_AUDIT_2026-05-04.docx');

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log('Wrote', outPath);
});
