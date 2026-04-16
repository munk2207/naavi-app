#!/usr/bin/env node
/**
 * Generate docs/TEST_PLAN.docx from docs/TEST_PLAN.md structured content.
 *
 * Not a generic markdown-to-docx converter — this script knows the shape of
 * TEST_PLAN.md (sections, tables with "Mobile / Web / Voice" columns, etc.)
 * and builds a clean Word document formatted for stakeholder review.
 *
 * Run:  node scripts/build-test-plan-docx.js
 */

const fs = require('fs');
const path = require('path');

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageNumber, PageOrientation, PageBreak,
} = require('docx');

// ──────────────────────────────────────────────────────────────────────────
// Content definitions
// ──────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    num: '1', title: 'Authentication',
    rows: [
      ['A1', 'Sign in with Google', 'Sign-in button → Google OAuth consent → land on home', 'Same flow in-browser', 'No sign-in; caller identified by phone'],
      ['A2', 'Sign out + back in', 'Settings → Sign out → home goes to "Sign in" screen', 'Same', 'N/A'],
      ['A3', 'Cross-account test', 'Sign in as Huss → should see HIS calendar/contacts (not Wael\u2019s)', 'Same', 'Call from Huss\u2019s phone → should hear HIS morning brief'],
    ],
    note: 'Pass criteria: logging in as Wael never shows Huss\u2019s data and vice versa.',
  },
  {
    num: '2', title: 'Morning brief tile',
    rows: [
      ['B1', 'Load home page, see "Today" brief', 'Calendar, weather, email, task tiles populate within 5 s', 'Same', 'N/A'],
      ['B2', 'Toggle Today / 3 days / 7 days', 'Calendar tile re-filters', 'Same', 'Voice uses fixed 30-day window'],
      ['B3', 'Weather card shows Ottawa weather', 'Yes', 'Yes', 'Say "what\u2019s the weather" → spoken reply'],
    ],
    note: 'Pass criteria: today\u2019s events appear, dates are correct, no "Something went wrong".',
  },
  {
    num: '3', title: 'Calendar',
    rows: [
      ['C1', 'Create event: "Schedule lunch with Sarah tomorrow at 12"', 'Event appears in Google Calendar', 'Same', 'Same — call and say it'],
      ['C2', 'Priority event: "Schedule a critical doctor\u2019s call tomorrow 4pm"', 'is_priority=true set', 'Same', 'Same'],
      ['C3', 'Query calendar: "What\u2019s on my calendar Friday?"', 'Chat reply lists Friday', 'Same', 'Voice reply, 1–2 sentences'],
      ['C4', 'Delete event: "Delete the lunch with Sarah"', 'Removed from Google Calendar', 'Same', 'Same'],
      ['C5', 'Query critical items: "What are my critical events?"', 'Only priority-flagged items listed', 'Same', 'Should NOT invent urgency'],
    ],
    note: 'Pass criteria (C5): Naavi never lists ordinary events as "critical" unless they were explicitly flagged.',
  },
  {
    num: '4', title: 'Reminders',
    rows: [
      ['D1', '"Remind me to take my vitamin at 9 pm tonight"', 'Reminder saved + calendar event created', 'Same', 'Same'],
      ['D2', '"Remind me every day at 8 am to take meds" (recurring)', 'Uses CREATE_EVENT with RRULE', 'Same', 'Same'],
      ['D3', 'Wait for reminder fire → cron sends SMS + WhatsApp + push', 'All 3 channels', 'Same (push via web)', 'Push goes to any signed-in device'],
    ],
    note: 'Pass criteria: reminder fires to the correct user\u2019s phone, not the other user\u2019s.',
  },
  {
    num: '5', title: 'Contacts',
    rows: [
      ['E1', '"Save John, email john@example.com"', 'Added to Supabase contacts + Google Contacts', 'Added to Supabase only (no Google Contacts write on web)', 'Same as mobile'],
      ['E2', '"What\u2019s Sarah\u2019s email?"', 'Contact lookup returns email', 'Same', 'Must return calling user\u2019s Sarah (multi-user check)'],
      ['E3', '"Draft a WhatsApp to Sarah saying hi"', 'Draft shown, name resolves to phone', 'Same', 'Same — confirm with "yes" to send'],
    ],
    note: 'Pass criteria (E2): Wael asking about Sarah never returns Huss\u2019s Sarah.',
  },
  {
    num: '6', title: 'Knowledge / preferences',
    rows: [
      ['F1', '"Remember my favorite coffee is espresso"', 'Saved to knowledge_fragments under caller\u2019s user_id', 'Same', 'Same'],
      ['F2', '"What are my preferences?"', 'Lists stored items, then stops (no fabrication)', 'Same', 'Voice reads them as bullets'],
      ['F3', '"Forget my coffee preference"', 'DELETE_MEMORY removes matching fragments', 'Same', 'Same'],
      ['F4', 'Cross-user leak test', 'As Wael, ask "what do you know about me" → Should NOT include Huss\u2019s memories', 'Same', 'Same'],
    ],
    note: 'Pass criteria (F4): zero cross-contamination between users\u2019 knowledge.',
  },
  {
    num: '7', title: 'Email / Drive / Travel (Google integrations)',
    rows: [
      ['G1', '"Draft an email to Bob saying thanks"', 'Draft card → tap Send', 'Same', 'Draft → say "yes" to send'],
      ['G2', '"Save a note that I met Alice"', 'Creates Google Doc in Drive', 'Same', 'Same'],
      ['G3', '"Find my tax receipts document"', 'DRIVE_SEARCH returns matches', 'Same', 'Same'],
      ['G4', '"How long to Parliament Hill?"', 'FETCH_TRAVEL_TIME → reply with minutes', 'Same', 'Same'],
    ],
  },
  {
    num: '8', title: 'Lists',
    rows: [
      ['H1', '"Create a shopping list"', 'LIST_CREATE', 'Same', 'Same'],
      ['H2', '"Add milk and eggs to my shopping list"', 'LIST_ADD', 'Same', 'Same'],
      ['H3', '"What\u2019s on my shopping list?"', 'LIST_READ → items read aloud', 'Same', 'Same'],
      ['H4', '"Remove eggs from my shopping list"', 'LIST_REMOVE', 'Same', 'Same'],
    ],
  },
  {
    num: '9', title: 'Action rules / email alerts',
    rows: [
      ['I1', '"Alert me when Sandra emails"', 'Inserts into action_rules (trigger=email, action=sms)', 'Same', 'Same (added today)'],
      ['I2', '"When Sandra emails me, WhatsApp John"', 'SET_ACTION_RULE', 'Same', 'Same (added today)'],
      ['I3', 'Trigger test: Sandra sends email → within ~6 min Twilio SMS arrives', 'Yes', 'Yes', 'Yes'],
    ],
    note: 'Pass criteria (I3): alert goes to the user\u2019s OWN phone number from user_settings.phone, not Wael\u2019s hardcoded number.',
  },
  {
    num: '10', title: 'Daily briefing call (UPDATE_MORNING_CALL)',
    rows: [
      ['J1', '"Set my daily briefing to 8 am"', 'Action emitted but mobile UI not wired yet — check user_settings.morning_call_time in DB', 'Same', 'Voice IS wired — writes to user_settings'],
      ['J2', 'At scheduled time → Twilio calls your phone → Naavi reads brief', 'Requires morning_call_enabled=true', 'Same', 'Voice\u2019s native feature'],
      ['J3', 'During the call, say "tell me about my Wednesday"', 'N/A', 'N/A', 'Should hear upcoming schedule'],
    ],
    note: 'Pass criteria (J2): call rings, Naavi speaks greeting after pickup, tick sound fills silent gaps.',
  },
  {
    num: '11', title: 'Voice server — phone call only',
    rows: [
      ['K1', 'Call +1 249 523 5394 → Naavi greets you by name', '—', '—', 'Greeting uses YOUR name from user_settings.name based on caller ID'],
      ['K2', 'Soft ticking sound between greeting and your first question', '—', '—', 'Audible, low volume, every 0.8 s'],
      ['K3', '"Are you still there?" prompt after ~30 s silence', '—', '—', 'Waits 30 s; resets on any speech'],
      ['K4', 'Say "goodbye" → Naavi says "Talk to you soon" + hangs up', '—', '—', 'Yes'],
      ['K5', '"Remember my favorite team is the Senators" → call again later → "what do I like"', '—', '—', 'Should recall'],
    ],
  },
  {
    num: '12', title: 'Mobile-only features (not on web)',
    rows: [
      ['L1', 'Hands-free mode (walkie-talkie) — "Hi Naavi" wake word', 'Hold button, say "Hi Naavi", Deepgram streams transcription', 'Shows "Hands-free mode is only available on mobile" error', 'N/A'],
      ['L2', 'Native contacts save to Android contact book', 'Yes', 'Supabase-only save', 'N/A'],
      ['L3', 'Conversation recorder (external audio, multi-speaker via AssemblyAI)', 'Yes', 'Works if browser mic permission granted', 'N/A'],
      ['L4', 'Push notifications', 'Android FCM', 'Web Push; needs browser permission', 'Goes to any signed-in device'],
      ['L5', 'Google Assistant deep links (brief / calendar / contacts App Actions)', 'Yes', 'No', 'N/A'],
    ],
  },
  {
    num: '13', title: 'Web-only quirks',
    rows: [
      ['M1', 'Browser Back button works (SPA history)', 'N/A', 'Yes', 'N/A'],
      ['M2', 'Session persists across browser restart', 'N/A', 'Yes (Supabase session in localStorage)', 'N/A'],
      ['M3', 'Page doesn\u2019t blank on JavaScript errors', 'N/A', 'Yes after today\u2019s native-imports guard fix', 'N/A'],
    ],
  },
  {
    num: '14', title: 'Multi-user safety (critical)',
    rows: [
      ['N1', 'Sign in mobile as Wael, web as Huss simultaneously', 'Each surface shows only that user\u2019s data; no cross-leak', 'Same', 'N/A'],
      ['N2', 'Voice: call from Wael\u2019s phone, then from Huss\u2019s phone', 'N/A', 'N/A', 'Each call personalizes greeting, calendar, contacts to correct user'],
      ['N3', 'Wael creates an event via voice → check mobile (Wael\u2019s login)', 'Event appears', '—', '—'],
      ['N4', 'Huss creates an event via voice → check Wael\u2019s mobile', 'Event does NOT appear in Wael\u2019s list', '—', '—'],
      ['N5', 'Both users trigger an email alert simultaneously', 'Each gets SMS at their OWN phone number', 'Same', 'Same'],
    ],
  },
];

const ACCOUNTS = [
  ['User', 'Email', 'Phone'],
  ['Wael (you)', 'wael.aggan@gmail.com', '+1 613 769 7957'],
  ['Huss (coworker)', 'heaggan@gmail.com', '+1 343 575 0023'],
];

const ENTRY_POINTS = [
  ['Surface', 'Where to test'],
  ['Mobile', 'Installed AAB from Google Play Internal Testing — currently V50 build 91'],
  ['Web', 'https://naavi-app.vercel.app — sign in with Google'],
  ['Voice', 'Call +1 249 523 5394 from your phone (Twilio → Railway voice server)'],
];

// ──────────────────────────────────────────────────────────────────────────
// Style helpers
// ──────────────────────────────────────────────────────────────────────────

const BORDER = { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

// Content width: 12240 (US Letter) − 1440 (left) − 1440 (right) = 9360 DXA
const CONTENT_WIDTH = 9360;

const COL_ID = 700;
const COL_TEST = 2660;
const COL_EACH_SURFACE = 2000;  // 3 surface columns
const COL_SURFACE_TOTAL = COL_EACH_SURFACE * 3;
const COLS = [COL_ID, COL_TEST, COL_EACH_SURFACE, COL_EACH_SURFACE, COL_EACH_SURFACE];

function styledCell(text, { bold = false, bg = null, width = null, align = AlignmentType.LEFT } = {}) {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    ...(bg ? { shading: { fill: bg, type: ShadingType.CLEAR } } : {}),
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text, bold, size: 18 })],  // 9pt
    })],
  });
}

function makeTestTable(rows) {
  const header = new TableRow({
    tableHeader: true,
    children: [
      styledCell('ID', { bold: true, bg: 'D9E8F4', width: COL_ID, align: AlignmentType.CENTER }),
      styledCell('Test', { bold: true, bg: 'D9E8F4', width: COL_TEST }),
      styledCell('Mobile', { bold: true, bg: 'D9E8F4', width: COL_EACH_SURFACE, align: AlignmentType.CENTER }),
      styledCell('Web', { bold: true, bg: 'D9E8F4', width: COL_EACH_SURFACE, align: AlignmentType.CENTER }),
      styledCell('Voice', { bold: true, bg: 'D9E8F4', width: COL_EACH_SURFACE, align: AlignmentType.CENTER }),
    ],
  });
  const dataRows = rows.map(([id, test, m, w, v]) => new TableRow({
    children: [
      styledCell(id, { width: COL_ID, align: AlignmentType.CENTER }),
      styledCell(test, { width: COL_TEST }),
      styledCell(m, { width: COL_EACH_SURFACE }),
      styledCell(w, { width: COL_EACH_SURFACE }),
      styledCell(v, { width: COL_EACH_SURFACE }),
    ],
  }));
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: COLS,
    rows: [header, ...dataRows],
  });
}

function makeSimpleTable(rows, widths) {
  const cols = widths;
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: cols,
    rows: rows.map((r, i) => new TableRow({
      tableHeader: i === 0,
      children: r.map((cell, ci) => styledCell(cell, {
        bold: i === 0,
        bg: i === 0 ? 'D9E8F4' : null,
        width: cols[ci],
      })),
    })),
  });
}

function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 180 }, children: [new TextRun({ text, bold: true })] });
}
function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 }, children: [new TextRun({ text, bold: true })] });
}
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [new TextRun({ text, size: 22, ...opts })],
  });
}
function bullet(text) {
  return new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun({ text, size: 22 })] });
}
function spacer() {
  return new Paragraph({ children: [new TextRun({ text: '' })] });
}

// ──────────────────────────────────────────────────────────────────────────
// Build document
// ──────────────────────────────────────────────────────────────────────────

const children = [
  // Title page-ish header
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: 'MyNaavi', bold: true, size: 44, color: '2E75B6' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: 'Test Plan — Mobile + Web + Voice', bold: true, size: 32 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 480 },
    children: [new TextRun({ text: 'Generated 2026-04-16', italics: true, size: 22, color: '7F7F7F' })],
  }),

  // Accounts
  h2('Test accounts'),
  makeSimpleTable(ACCOUNTS, [2000, 3680, 3680]),
  spacer(),

  // Entry points
  h2('Surface entry points'),
  makeSimpleTable(ENTRY_POINTS, [1800, 7560]),
  spacer(),

  // Notes
  h2('Notes before you start'),
  bullet('Sign in on web and mobile with the same Google account or test results will differ.'),
  bullet('Voice resolves the user from your caller ID — call from +16137697957 to get Wael\u2019s data, +13435750023 for Huss\u2019s.'),
  bullet('Hard-refresh the web browser (Ctrl+Shift+R) after any deploy.'),
  bullet('Mobile AAB build 91 pre-dates the post-sanity cleanup (commit 18d67bc). Some mobile-specific bug fixes land only in build 92+.'),

  new Paragraph({ children: [new PageBreak()] }),
];

// Each numbered section
for (const s of SECTIONS) {
  children.push(h1(`${s.num}. ${s.title}`));
  children.push(makeTestTable(s.rows));
  if (s.note) {
    children.push(new Paragraph({
      spacing: { before: 120, after: 240 },
      children: [new TextRun({ text: s.note, italics: true, size: 20, color: '5F5F5F' })],
    }));
  } else {
    children.push(spacer());
  }
}

// Known limitations + smoke test
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('15. Known limitations / deferred work'));
children.push(p('These are expected to fail — do not report as bugs.'));
children.push(bullet('SET_EMAIL_ALERT and SET_ACTION_RULE on voice just landed today, may need live call to verify.'));
children.push(bullet('Huss\u2019s Google token is revoked — his calendar is empty until he re-signs-in via mobile.'));
children.push(bullet('Mobile AAB installed on phone is build 91, pre-dating the post-sanity fixes. Next build will be V50 build 92.'));

children.push(h1('How to run a quick smoke test (15 minutes)'));
children.push(new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: [new TextRun({ text: 'Web — open https://naavi-app.vercel.app in an incognito window, sign in. Check home page loads, type "what\u2019s on my calendar this week", verify reply.', size: 22 })] }));
children.push(new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: [new TextRun({ text: 'Mobile — open the installed Naavi app. Do the same calendar query. Compare reply to web.', size: 22 })] }));
children.push(new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: [new TextRun({ text: 'Voice — call +1 249 523 5394 from your phone. Ask "what\u2019s on my calendar tomorrow". Compare.', size: 22 })] }));
children.push(new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: [new TextRun({ text: 'Cross-check — any divergence between the three answers is a bug.', size: 22 })] }));
children.push(p('If all three give consistent answers, the core loop is healthy.'));

// ──────────────────────────────────────────────────────────────────────────
// Build the doc
// ──────────────────────────────────────────────────────────────────────────

const doc = new Document({
  creator: 'MyNaavi',
  title: 'MyNaavi Test Plan',
  description: 'End-to-end test plan covering mobile, web, and voice surfaces.',
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: '2E75B6' },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },  // US Letter
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'MyNaavi Test Plan', size: 18, color: '7F7F7F' })] })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Page ', size: 18, color: '7F7F7F' }), new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '7F7F7F' })] })] }),
    },
    children,
  }],
});

const out = path.resolve(__dirname, '..', 'docs', 'TEST_PLAN.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf);
  console.log('Wrote', out, `(${(buf.length/1024).toFixed(1)} KB)`);
});
