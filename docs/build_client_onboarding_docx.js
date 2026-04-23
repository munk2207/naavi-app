/**
 * Build NAAVI_CLIENT_ONBOARDING.docx — the private-preview welcome document
 * sent to new beta testers (active seniors invited personally by Wael).
 *
 * Tone: warm, respectful, non-technical. Matches mynaavi.com.
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType,
} = require('docx');

const OUT = path.join(__dirname, 'NAAVI_CLIENT_ONBOARDING.docx');

// ─── Page + table constants ──────────────────────────────────────────────────
const PAGE_WIDTH  = 12240;   // US Letter, DXA
const PAGE_HEIGHT = 15840;
const MARGIN      = 1440;
const CONTENT_W   = PAGE_WIDTH - 2 * MARGIN;

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
      run: { font: defaultFont, size: 48, bold: true, color: '1F3A5F' },
      paragraph: { spacing: { before: 360, after: 220 }, outlineLevel: 0 },
    },
    {
      id: 'Heading2',
      name: 'Heading 2',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { font: defaultFont, size: 32, bold: true, color: '1F3A5F' },
      paragraph: { spacing: { before: 300, after: 180 }, outlineLevel: 1 },
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
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: '5DCAA5', space: 12 } },
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
    {
      reference: 'numbered',
      levels: [
        {
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
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
  spacing: { before: 100, after: 100 },
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
  spacing: { before: 200, after: 200 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } },
  children: [],
});

const numberedItem = (num, titleText, body) => {
  // Number + title on first line (bold), body below as normal paragraph.
  return [
    new Paragraph({
      children: [
        new TextRun({ text: `${num}. `, bold: true, color: '5DCAA5', size: 26 }),
        new TextRun({ text: titleText, bold: true, size: 26 }),
      ],
      spacing: { before: 200, after: 80 },
    }),
    ...(Array.isArray(body) ? body : [p([text(body)])]),
  ];
};

// ─── Build document ──────────────────────────────────────────────────────────
const children = [];

// Title
children.push(h1('Welcome to MyNaavi'));

// A personal note
children.push(h2('A personal note'));
children.push(p([text('If you\u2019re reading this, it\u2019s because I asked you personally to try Naavi. Thank you \u2014 this early stage is where the product learns what it should become, and you\u2019re part of that.')]));
children.push(p([text('Naavi isn\u2019t finished. Some things will feel polished; others will have rough edges. I\u2019d be grateful for your honest reaction either way \u2014 the good, the awkward, and the moments where you wished she did something differently.')]));
children.push(p([italic('\u2014 Wael')]));
children.push(hr());

// What Naavi is
children.push(h2('What Naavi is, in one paragraph'));
children.push(p([text('Naavi is a voice assistant built for this time in life \u2014 when the number of small things you\u2019re asked to hold in your head has quietly grown longer. Warranties, prescriptions, birthdays, appointments, the email you meant to deal with Thursday night and forgot. She reads your calendar, your email, your saved files, and she remembers what you tell her. When she sends anything on your behalf, she reads it back and waits for you to say yes. She is yours.')]));
children.push(hr());

// Three ways to reach her
children.push(h2('Three ways to reach her'));
children.push(p([bold('1. In the MyNaavi app, by typing.')]));
children.push(p([text('Open the app, tap the message box, type, send. Like a text message.')]));
children.push(p([bold('2. In the MyNaavi app, by speaking.')]));
children.push(p([text('Open the app, tap the green microphone button (bottom left), speak, let go. She listens and replies.')]));
children.push(p([bold('3. By phone call.')]));
children.push(p([text('Save the MyNaavi phone number in your contacts. Call it like any other number. She picks up. You talk. You hang up when you\u2019re done.')]));
children.push(p([italic('All three give you the same Naavi. She remembers what you told her in one channel when you reach her through another.')]));
children.push(hr());

// First five minutes — setup
children.push(h2('Your first five minutes \u2014 one-time setup'));

children.push(h3('1. Sign in with Google'));
children.push(p([text('Open the MyNaavi app. On the welcome screen, tap '), bold('Sign in with Google'), text(' and pick your Google account. This is the step that connects Naavi to your calendar, your email, and your Google Drive \u2014 nothing else in the app will work until you sign in.')]));
children.push(p([text('Once you\u2019re signed in, tap the '), bold('\u2699 Settings'), text(' icon at the top right of the home screen to finish the rest of setup.')]));

children.push(h3('2. Your name'));
children.push(p([text('Type your first name. Tap '), italic('Save name'), text('. This is what Naavi will call you.')]));

children.push(h3('3. Your phone number'));
children.push(p([text('Type your number in international format, like '), new TextRun({ text: '+1 613 555 1234', font: 'Consolas' }), text('. Tap '), italic('Save'), text('. This is how Naavi calls you for morning briefs and reminders.')]));

children.push(h3('4. Home address'));
children.push(p([text('Scroll down to '), italic('Location alerts'), text('. Type your home street address (e.g., '), new TextRun({ text: '123 Main St, Ottawa, ON', font: 'Consolas' }), text('). Tap '), italic('Save home address'), text('. This lets you say things like '), italic('"alert me when I arrive home"'), text(' and have Naavi know where "home" is.')]));

children.push(h3('5. Work or office address (optional)'));
children.push(p([text('If you have a regular workplace or office, add it too. Then '), italic('"when I arrive at the office"'), text(' will work the same way.')]));

children.push(h3('6. Morning brief call'));
children.push(p([text('Scroll to '), italic('Morning Brief Call'), text('. Turn it '), bold('On'), text('. Pick a call time (default 8:00 AM). Tap '), italic('Save'), text('. Naavi will call you every morning at that time with your day in one paragraph \u2014 schedule, weather, priority emails, reminders.')]));

children.push(h3('7. Location permission (only if you want arrival alerts)'));
children.push(p([text('On the '), italic('Location alerts'), text(' card, tap '), italic('Manage location alerts'), text('. A permission page appears. Tap '), italic('Allow location'), text('. When Android asks, choose '), bold('Allow all the time'), text('. This is how Naavi knows to fire an alert when you arrive somewhere.')]));

children.push(p([bold('That\u2019s it for setup.'), text(' You\u2019re ready to talk to her.')]));
children.push(hr());

// Ten things to try
children.push(h2('Ten things to try on your first day'));
children.push(p([italic('Pick any \u2014 say them out loud on a voice call, or type them in the app.')]));

const tryExamples = [
  { title: 'Ask about your schedule', lines: ['"What\u2019s on my calendar today?"', '"Do I have anything Thursday afternoon?"'] },
  { title: 'Create an event', lines: ['"Put Layla\u2019s hockey practice Tuesday at six on the calendar."', '"Book my dentist Thursday at 2 PM."'] },
  { title: 'Set a reminder', lines: ['"Remind me to call Sarah this Friday at 10."', '"At 5 PM today, remind me to take my pills."'] },
  { title: 'Remember something for later', lines: ['"Remember that the garage door opener code is 4471."', '"Save that my insurance policy number is AB-884120."'] },
  { title: 'Find something in your email', lines: ['"Pull up the last invoice from Bell."', '"When did Canadian Tire last service my brakes?"'] },
  { title: 'Ask about a person', lines: ['"What do I know about David Chen?"', '"When is my sister\u2019s birthday?"'] },
  {
    title: 'Send a text or email on your behalf',
    lines: ['"Text my daughter I\u2019ll be 20 minutes late."', '"Email my lawyer to confirm the meeting Thursday."'],
    note: 'Naavi drafts the message, reads it back, and waits for your "yes" before sending. Nothing leaves the phone without your approval.',
  },
  { title: 'Set a location alert', lines: ['"Alert me when I arrive at Costco."', '"Text my wife when I leave the office."'] },
  { title: 'Set a weather alert', lines: ['"Text me at 7 AM if rain is forecast tomorrow."', '"Alert me if it snows in Ottawa this weekend."'] },
  {
    title: 'Record a conversation, like at the doctor',
    note: 'On a phone call with Naavi, at the start of your doctor\u2019s visit:',
    lines: ['"Naavi, record my visit."'],
    trailingNote: 'She records. She stays quiet. At the end:',
    trailingLines: ['"Naavi, stop."'],
    result: [
      'By the time you reach your car:',
      '- A full written summary is in your email.',
      '- The conversation transcript is saved to your Drive.',
      '- Any medication changes she heard are on your calendar.',
      '- Any follow-up appointments are booked.',
    ],
  },
];

tryExamples.forEach((ex, i) => {
  const body = [];
  if (ex.note) body.push(p([text(ex.note)]));
  for (const line of ex.lines) body.push(quote(line));
  if (ex.trailingNote) body.push(p([text(ex.trailingNote)]));
  if (ex.trailingLines) for (const line of ex.trailingLines) body.push(quote(line));
  if (ex.result) {
    body.push(p([bold(ex.result[0])]));
    for (const r of ex.result.slice(1)) body.push(bullet([text(r.replace(/^- /, ''))]));
  }
  for (const blk of numberedItem(i + 1, ex.title, body)) children.push(blk);
});

children.push(hr());

// What to expect when she replies
children.push(h2('What to expect when she replies'));
children.push(p([bold('She keeps it short. '), text('One or two sentences, most of the time. If she needs more, she\u2019ll ask.')]));
children.push(p([bold('She reads back before she sends. '), text('Every message \u2014 SMS, WhatsApp, email \u2014 she reads back to you first and waits for "yes". If she got it wrong, just tell her what to change.')]));
children.push(p([bold('She says "from your saved locations" or "from Settings" when she pulls from memory. '), text('That way you know when she\u2019s using a saved value vs. finding something new.')]));
children.push(p([bold('She asks before she guesses. '), text('If she doesn\u2019t know which Costco you mean, she asks. If after a few tries she still can\u2019t find the place, she says "please check the exact location and call me back" rather than setting something wrong.')]));
children.push(hr());

// Your privacy
children.push(h2('Your privacy'));
children.push(bullet([bold('Your data is yours. '), text('Nothing you tell Naavi is shared with anyone. There is no dashboard your children or anyone else can watch.')]));
children.push(bullet([bold('Nothing is sent without your confirmation. '), text('Every outgoing SMS, WhatsApp, or email is read back first.')]));
children.push(bullet([bold('Your location is used only to fire alerts you set up. '), text('No history of where you\u2019ve been is stored.')]));
children.push(bullet([bold('Your files stay in your Google Drive. '), text('Naavi reads them with your permission; she doesn\u2019t move them or share them.')]));
children.push(bullet([bold('You can turn anything off in Settings. '), text('Location, morning call, Naavi herself.')]));
children.push(hr());

// When something goes wrong
children.push(h2('What to do when something goes wrong'));
children.push(p([text('Nothing works right every time, especially this early. If something feels off:')]));
children.push(bullet([bold('Try rephrasing. '), text('Say the same thing a slightly different way.')]));
children.push(bullet([bold('Try typing instead of speaking '), text('(or vice versa). Sometimes the text path works when voice misunderstands a name or number.')]));
children.push(bullet([bold('Say "cancel" '), text('if Naavi seems stuck waiting for a yes.')]));
children.push(bullet([bold('Screenshot it and send to me. '), text('Reply to my invitation email with a screenshot or a quick description.')]));
children.push(p([italic('Your "rough edges" reports are what make Naavi better. Don\u2019t worry about sounding polite \u2014 I\u2019d rather hear "this didn\u2019t work" ten times than not at all.')]));
children.push(hr());

// The morning call
children.push(h2('The morning call \u2014 what to expect'));
children.push(p([text('If you turned it on, at your chosen morning time your phone rings from the MyNaavi number. Pick up. In one paragraph, Naavi gives you:')]));
children.push(bullet([text('Today\u2019s calendar.')]));
children.push(bullet([text('The weather where you are.')]));
children.push(bullet([text('Two or three priority emails that landed overnight.')]));
children.push(bullet([text('Any reminders or bills due soon.')]));
children.push(bullet([text('A closing "Anything else?" \u2014 you can ask a question right there and keep the conversation going.')]));
children.push(p([italic('If you miss the call, she\u2019ll try again. If you miss all three attempts, the brief is saved as a document in your Drive so you can read it later.')]));
children.push(hr());

// Quick reference table
children.push(h2('Quick reference \u2014 the Settings screen'));
{
  const colA = 2800;
  const colB = 3600;
  const colC = CONTENT_W - colA - colB;
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (run, width, shading) => new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: shading ? { fill: shading, type: ShadingType.CLEAR } : undefined,
    margins: { top: 100, bottom: 100, left: 160, right: 160 },
    children: [new Paragraph({ children: [run] })],
  });
  const row = (a, b, c, isHeader) => new TableRow({
    children: [
      cell(isHeader ? new TextRun({ text: a, bold: true }) : new TextRun(a), colA, isHeader ? 'D5E3F0' : undefined),
      cell(isHeader ? new TextRun({ text: b, bold: true }) : new TextRun(b), colB, isHeader ? 'D5E3F0' : undefined),
      cell(isHeader ? new TextRun({ text: c, bold: true }) : new TextRun(c), colC, isHeader ? 'D5E3F0' : undefined),
    ],
  });

  children.push(new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [colA, colB, colC],
    rows: [
      row('What', 'Where', 'What it does', true),
      row('Your name', 'Settings \u2192 Your Name', 'What Naavi calls you'),
      row('Phone', 'Settings \u2192 Your Phone Number', 'How Naavi calls you'),
      row('Home address', 'Settings \u2192 Location alerts \u2192 Home address', 'What "home" means in alerts'),
      row('Work address', 'Settings \u2192 Location alerts \u2192 Work address', 'What "office" / "work" means in alerts'),
      row('Location alerts', 'Settings \u2192 Location alerts \u2192 Manage', 'Permission for arrival / departure alerts'),
      row('Morning call', 'Settings \u2192 Morning Brief Call', 'Daily wake-up briefing call'),
      row('Sign out', 'Settings \u2192 Sign Out', 'Log out; your data stays'),
    ],
  }));
}

children.push(hr());

// Closing
children.push(h2('A last word'));
children.push(p([text('Try her for a few days. See what sticks. Notice what you start to reach for her for, and what you still reach for your phone for. Tell me where she felt useful and where she felt in the way. That feedback is the whole point of this early preview.')]));
children.push(p([text('Thank you again.')]));
children.push(p([italic('\u2014 Wael')]));
children.push(p([italic('MyNaavi \u2014 hello@mynaavi.com')]));

// ─── Build + write ───────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'MyNaavi',
  title: 'MyNaavi \u2014 Client onboarding',
  description: 'Welcome + first-five-minutes setup + ten things to try, for new private-preview users.',
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
