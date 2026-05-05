/**
 * Build docs/MYNAAVI_ONBOARDING_GUIDE.docx — friendly onboarding guide
 * for three audiences: family/helpers, the user user, and internal
 * team members.
 *
 * Run: node scripts/build-onboarding-guide-docx.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageBreak,
} = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 140 },
  });
}

function pRich(runs) {
  return new Paragraph({ children: runs, spacing: { after: 140 } });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun(text)],
    spacing: { after: 60 },
  });
}

function bulletRich(runs) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: runs,
    spacing: { after: 60 },
  });
}

function numbered(text) {
  return new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
    children: [new TextRun(text)],
    spacing: { after: 80 },
  });
}

function checkbox(text, why) {
  const runs = [
    new TextRun({ text: '☐  ', size: 24 }),
    new TextRun(text),
  ];
  if (why) {
    runs.push(new TextRun({ text: ' — ' }));
    runs.push(new TextRun({ text: why, italics: true, color: '555555' }));
  }
  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: 360 },
    children: runs,
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
    spacing: { before: 220, after: 110 },
  });
}

function title(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 120 },
    children: [new TextRun({ text, bold: true, size: 48, color: '1F3A68' })],
  });
}

function subtitle(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 360 },
    children: [new TextRun({ text, italics: true, size: 24, color: '555555' })],
  });
}

function calloutBox(label, text) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders,
        width: { size: 9360, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: 'EAF2FB' },
        margins: { top: 140, bottom: 140, left: 200, right: 200 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: label, bold: true, color: '1F3A68', size: 22 })],
            spacing: { after: 60 },
          }),
          new Paragraph({
            children: [new TextRun({ text, size: 22 })],
          }),
        ],
      })],
    })],
  });
}

function permRow(perm, why) {
  const widths = [2400, 6960];
  return new TableRow({
    children: [
      new TableCell({
        borders,
        width: { size: widths[0], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: 'F4F7FB' },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: perm, bold: true, size: 22 })] })],
      }),
      new TableCell({
        borders,
        width: { size: widths[1], type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: why, size: 22 })] })],
      }),
    ],
  });
}

function permTable() {
  const widths = [2400, 6960];
  const headerRow = new TableRow({
    children: [
      new TableCell({
        borders,
        width: { size: widths[0], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: '1F3A68' },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: 'Permission', bold: true, color: 'FFFFFF', size: 22 })] })],
      }),
      new TableCell({
        borders,
        width: { size: widths[1], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: '1F3A68' },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: 'Why Naavi needs it', bold: true, color: 'FFFFFF', size: 22 })] })],
      }),
    ],
  });
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      headerRow,
      permRow('Microphone', 'So you can talk to Naavi by voice — tap-to-talk or press-and-hold anywhere on the chat.'),
      permRow('Location (Allow all the time)', 'So Naavi can alert you when you arrive home, at the doctor, or at any saved place — even when the app is closed.'),
      permRow('Notifications', 'So Naavi can ping you when an email needs your attention, an appointment is coming, or an alert fires.'),
      permRow('Google Calendar', 'So Naavi knows your meetings and can give you timely reminders.'),
      permRow('Gmail (read-only)', 'So Naavi can scan your inbox for bills, appointments, and warranties — and answer questions like "did I pay the hydro bill?"'),
      permRow('Google Contacts', 'So Naavi can text the right person when you say "tell my wife I\'m running late."'),
      permRow('Google Drive', 'So Naavi can save important documents (receipts, briefs, conversation transcripts) into your own MyNaavi folder.'),
    ],
  });
}

function qaPair(q, a) {
  return [
    new Paragraph({
      spacing: { before: 160, after: 60 },
      children: [new TextRun({ text: 'Q. ' + q, bold: true, color: '1F3A68', size: 22 })],
    }),
    new Paragraph({
      spacing: { after: 100 },
      indent: { left: 280 },
      children: [
        new TextRun({ text: 'A. ', bold: true, color: '2E7D32' }),
        new TextRun({ text: a, size: 22 }),
      ],
    }),
  ];
}

const children = [];

children.push(title('MyNaavi'));
children.push(subtitle('Onboarding Guide — for new users, helpers, and the team'));
children.push(calloutBox(
  'In one paragraph',
  'MyNaavi is a personal assistant for active users — like a calm, familiar voice on the phone who keeps your calendar, scans your email for bills and appointments, sends messages on your behalf, and reminds you when something matters. You can talk to her by voice on your mobile or call her phone number from any phone. This guide walks through everything we need to set her up well — once, on day one — so she works the way you expect from the very first conversation.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('1. Before You Install'));
children.push(p(
  'Have these things on hand before you sit down to install the app. Most of them are quick to gather, but going through the checklist now means the install will take fifteen minutes instead of an hour.'
));

children.push(h2('Identity'));
children.push(checkbox('Full name', 'so Naavi greets you by name and personalizes every reply.'));
children.push(checkbox('Mobile phone number', 'so Naavi recognizes you the moment you call her phone line — no PIN, no password.'));
children.push(checkbox('Google account email and password', 'so Naavi can read your calendar, scan your email for bills, look up contacts, and save documents to your Drive.'));

children.push(h2('Addresses'));
children.push(checkbox('Home address (full street + city + province / state)', 'so "alert me when I get home" works, and so Naavi can compute travel time from anywhere back to your house.'));
children.push(checkbox('Work or office address — if you still go to one', 'same purpose — alerts and travel time when you leave or arrive at work.'));
children.push(checkbox('Doctor\'s clinic address', 'for medical appointment reminders, arrival alerts, and travel time on appointment day.'));
children.push(checkbox('Pharmacy address', 'so Naavi can remind you when a prescription is ready and route you there.'));

children.push(h2('Important People'));
children.push(checkbox('Spouse or partner — name, phone, email', 'so Naavi can text or call them when you say "tell my wife I\'m running late."'));
children.push(checkbox('One or two emergency contacts — name and phone for each', 'so Naavi has someone to alert if you don\'t answer your morning call or trigger an emergency word.'));
children.push(checkbox('Adult children or close family who should hear about emergencies — name and phone', 'so urgent alerts (no answer to morning call, fall detection, etc.) reach the right people.'));

children.push(h2('Health'));
children.push(checkbox('Chronic medications — name, dose, and time of day you take each one', 'so Naavi reminds you on schedule and tracks compliance day-to-day.'));
children.push(checkbox('Doctor\'s name and clinic phone', 'so Naavi can place a call to the clinic when you ask, and quote the right doctor in reminders.'));
children.push(checkbox('Health card number — keep handy but DO NOT share it during install (Naavi never asks for this)', 'sensitive information; useful when you need to look it up but stored separately, not in the app.'));

children.push(h2('Daily Rhythm'));
children.push(checkbox('Time you would like a morning briefing call (e.g., 8:00 AM)', 'so Naavi calls at the right time every day with weather, calendar, and important emails.'));
children.push(checkbox('Days of the week the morning call should run (every day, weekdays only, etc.)', 'so the call doesn\'t wake you on days you sleep in.'));
children.push(checkbox('Quiet hours — when Naavi should NOT call or send messages (e.g., after 9:00 PM)', 'so non-urgent alerts don\'t disturb you in the evening.'));

// PAGE BREAK before install steps
children.push(new Paragraph({ children: [new PageBreak()] }));

// ────────────────────────────────────────────────────────────────
children.push(h1('2. Step-by-Step Install'));
children.push(p('Plan to set aside about fifteen minutes the first time. The phone needs to be unlocked and connected to the internet (Wi-Fi is fine).'));
children.push(numbered('Open the Google Play Store on your Android phone.'));
children.push(numbered('Search for "MyNaavi", or open the install link your helper / our team sent you.'));
children.push(numbered('Tap "Install" and wait for the app to download (usually under a minute).'));
children.push(numbered('Tap "Open" once it has finished installing.'));
children.push(numbered('On the welcome screen, tap "Sign in with Google."'));
children.push(numbered('Pick the Google account you use for email and calendar — DO NOT create a new one.'));
children.push(numbered('Approve the permissions Naavi asks for (Calendar, Gmail, Contacts, Drive). Tap "Allow" or "Continue" on each screen.'));
children.push(numbered('When the phone asks about Microphone — tap "Allow."'));
children.push(numbered('When the phone asks about Location — pick "Allow all the time." This matters: arrival alerts only work with this setting.'));
children.push(numbered('When the phone asks about Notifications — tap "Allow."'));
children.push(numbered('You will land on the home screen. The chat area is the big dark space; the input row is at the bottom.'));
children.push(calloutBox(
  'Tip',
  'Press and hold anywhere on the chat area to start talking; release to send. Or tap the green microphone button. Or just type. Whatever feels easiest.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('3. First-Day Settings'));
children.push(p(
  'Tap the three-dot menu in the top-right corner of the home screen, then choose Settings. Fill in everything below — most fields take ten seconds each.'
));

children.push(h2('Your Identity'));
children.push(bullet('Your name — confirm the spelling Naavi will use when greeting you.'));
children.push(bullet('Your phone number — paste the same number from the checklist above. This number is how Naavi knows it is you when you call her phone line.'));

children.push(h2('Your Addresses'));
children.push(bullet('Home address — full street + city + province. Naavi will use this when you say "alert me when I get home."'));
children.push(bullet('Work address — same format. Use this only if you still go to a workplace.'));

children.push(h2('Voice Preferences'));
children.push(bullet('Voice on / off — when on, Naavi speaks her replies out loud. We recommend leaving it on.'));
children.push(bullet('Avoid highways — toggle on if you prefer side streets when Naavi calculates travel time.'));

children.push(h2('Brief Schedule'));
children.push(bullet('Morning brief time — pick what time you would like Naavi to call you with the day\'s overview (e.g., 7:30 AM).'));
children.push(bullet('Skip days — pick weekends or specific days off if you do not want a daily call.'));

// PAGE BREAK before permissions table
children.push(new Paragraph({ children: [new PageBreak()] }));

// ────────────────────────────────────────────────────────────────
children.push(h1('4. Permissions Explained in Plain Language'));
children.push(p(
  'During install, Android and Google will each ask you to approve several permissions. Here is exactly what each one means and why Naavi needs it. You can change any of these later through the phone\'s Settings → Apps → MyNaavi.'
));
children.push(permTable());
children.push(calloutBox(
  'Privacy promise',
  'Naavi only ever sees data from your own Google account. She does not share your information with anyone — not other Naavi users, not the team building her, not advertisers. Your conversations are stored on a Canadian server (Supabase) and used only to make Naavi smarter for you.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('5. What Naavi Learns Over Time'));
children.push(p(
  'You do not have to teach Naavi everything on day one. As you talk to her, she remembers what matters and gets quicker. The first week is the slowest; by week two she will feel like she has been with you for years.'
));
children.push(bulletRich([
  new TextRun({ text: 'Saved places: ', bold: true }),
  new TextRun('the first time you say "alert me at the gym" or "navigate to the dentist," Naavi will ask you to confirm the address. After that, she remembers — every "the gym" or "the dentist" lands the same place.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'People: ', bold: true }),
  new TextRun('phone numbers and email addresses you give her ("Bob\'s number is plus one six one three..."). She will use them next time you say "text Bob."'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Memory items: ', bold: true }),
  new TextRun('anything you say "remember" or "Naavi, remember that..." — your medications, your blood pressure target, your daughter-in-law\'s birthday, your insurance policy number.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Patterns: ', bold: true }),
  new TextRun('which emails you tend to act on, which calendar events you arrive late for, which alerts you ask to be reminded about. She learns the rhythm of your life.'),
]));

// PAGE BREAK before helpers section
children.push(new Paragraph({ children: [new PageBreak()] }));

// ────────────────────────────────────────────────────────────────
children.push(h1('6. Common Questions'));
children.push(p(
  'Whether you are setting MyNaavi up for yourself or helping a friend or family member, these are the questions that come up the most.'
));

qaPair(
  'Can MyNaavi work without looking at the screen?',
  'Yes. Two options. On the mobile app, press and hold anywhere on the chat and talk; release to send. Or call Naavi\'s phone number from any phone — it is a real phone call, no app needed, and works even on a flip phone.'
).forEach(c => children.push(c));

qaPair(
  'What if I forget a password?',
  'You sign in with Google — there is no separate MyNaavi password to remember. As long as you remember your Google sign-in, the app works. If you get locked out of Google, that is a Google support call, not a MyNaavi one.'
).forEach(c => children.push(c));

qaPair(
  'How do I see what alerts are set?',
  'Open the app, tap the three-dot menu in the top right, then Alerts. Or — even simpler — say "what alerts do I have?" and Naavi reads them out.'
).forEach(c => children.push(c));

qaPair(
  'Can I get copies of alerts on someone else\'s phone too?',
  'Yes. When setting up an alert, say "alert me AND tell my daughter when I leave the house" — Naavi will text both of you. You can also designate a default emergency recipient so they receive every safety alert automatically.'
).forEach(c => children.push(c));

qaPair(
  'What if Naavi gets confused and creates the wrong alert?',
  'Say "delete that alert" or "delete the alert about the dentist" and she will. Or open Settings → Alerts, tap the alert, then delete. She always asks for confirmation before sending messages or texts on your behalf.'
).forEach(c => children.push(c));

qaPair(
  'Is the app private?',
  'Yes. Naavi only sees what you share with her — your own email, calendar, contacts. Other MyNaavi users cannot see your data. The team building Naavi can see usage patterns (so we can fix bugs) but not the content of your conversations.'
).forEach(c => children.push(c));

qaPair(
  'What happens if my phone is lost or stolen?',
  'Sign in to your Google account from another device and revoke MyNaavi\'s access (Google account → Security → Third-party access). That immediately disconnects the lost phone\'s app from your calendar, email, contacts, and Drive.'
).forEach(c => children.push(c));

qaPair(
  'Can I use MyNaavi without a helper?',
  'Absolutely. The whole product is designed for the user to be self-sufficient day-to-day. If a helper sets it up for you, their role ends after the first install — you take it from there.'
).forEach(c => children.push(c));

// PAGE BREAK before technical appendix
children.push(new Paragraph({ children: [new PageBreak()] }));

// ────────────────────────────────────────────────────────────────
children.push(h1('7. Technical Appendix — For the Internal Team'));
children.push(p(
  'Plain-language reference for the team — useful in demos, partnership conversations, and pilot rollouts.'
));

children.push(h2('Architecture in one paragraph'));
children.push(p(
  'Two surfaces share one backend. Mobile (React Native / Expo, Android first, iOS later) is for visual confirmation, tap-to-talk, and press-and-hold-anywhere voice input. Phone (Twilio voice line) is for natural always-listening conversation — the user just calls a number and talks. Both surfaces hit the same Supabase Edge Functions (naavi-chat, get-naavi-prompt, resolve-place, evaluate-rules, sync-gmail, etc.) which call Anthropic Claude Haiku 4.5 and return a structured response (speech + actions). Voice path also routes through Deepgram for STT and TTS.'
));

children.push(h2('What we collect at install'));
children.push(bullet('Google OAuth grant — scopes: openid, email, profile, calendar (read+write), gmail.readonly, contacts.readonly, drive.file. No google.users.update or admin scopes.'));
children.push(bullet('User-typed name (user_settings.name) — drives Claude system prompt and TTS greeting.'));
children.push(bullet('User-typed phone (user_settings.phone) — used by the voice surface for caller-ID identity match.'));
children.push(bullet('Optional: home_address, work_address (user_settings.home_address / .work_address).'));
children.push(bullet('Push token (FCM) — registered on every launch, auto-pruned on 404 / NOT_FOUND / UNREGISTERED.'));

children.push(h2('Permissions requested at runtime'));
children.push(bullet('RECORD_AUDIO — for the press-and-hold mic and tap-to-talk button.'));
children.push(bullet('ACCESS_FINE_LOCATION + ACCESS_BACKGROUND_LOCATION — for OS-level geofencing (expo-location + TaskManager).'));
children.push(bullet('POST_NOTIFICATIONS — push delivery.'));
children.push(bullet('Battery exemption (Android 13+) — required for reliable geofence firing on Samsung devices; prompted on first location-rule creation.'));

children.push(h2('Voice surface'));
children.push(bullet('Twilio number per deployment (currently +1 249 523 5394 on the Wael testing line).'));
children.push(bullet('Caller-ID match against user_settings.phone resolves the user_id.'));
children.push(bullet('Multi-phone fast path (additional_phones[]) and Picovoice Eagle voice biometric are queued for a future release.'));
children.push(bullet('Demo line (different Twilio number) handles unknown callers with a "may I have your name?" greeting and curated example prompts.'));

children.push(h2('Multi-channel alerts'));
children.push(bullet('Self-alerts (recipient = the user themselves) fire on SMS + WhatsApp + Email + Push — all four channels — for reliability when WiFi or cell coverage is patchy.'));
children.push(bullet('Third-party alerts (recipient = someone else) fire on SMS + WhatsApp only.'));
children.push(bullet('Channel choice is not a per-rule preference; it is a reliability guarantee.'));

children.push(h2('Data residency and privacy'));
children.push(bullet('Supabase project hosted in Canada (region ca-central-1).'));
children.push(bullet('Conversations and memory live under the user\'s own user_id with RLS policies enforcing "user can only see their own rows."'));
children.push(bullet('No analytics on conversation content; only operational metrics (function call counts, error rates).'));
children.push(bullet('Google Drive files are written into the user\'s own Drive under MyNaavi/ — NOT into a shared team drive.'));

children.push(h2('Multi-user safety'));
children.push(bullet('Voice server: caller phone → user_settings.phone → user_id; never picks "first user" from a shared table.'));
children.push(bullet('Mobile: JWT-based identity from the moment the user signs in; every Edge Function verifies user_id from JWT or request body.'));
children.push(bullet('Edge Functions never use auth.admin.listUsers().sort() or .limit(1) on shared tables.'));

children.push(h2('Footprint'));
children.push(bullet('Mobile APK install: ~80 MB.'));
children.push(bullet('Daily backend cost per active user (current heavy testing): about $0.30 / day — Anthropic + Twilio + Deepgram + Supabase combined.'));
children.push(bullet('Per-call voice cost (Twilio + Deepgram + Anthropic): about $0.10 for a 3-minute call.'));

// ────────────────────────────────────────────────────────────────
children.push(h1('Bottom line'));
children.push(p(
  'Walk through the checklist in section 1, install in section 2 (about fifteen minutes), fill in Settings in section 3, and Naavi is ready. Everything else she will learn from your daily conversations.'
));

// ────────────────────────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Calibri', color: '1F3A68' },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Calibri', color: '2E5599' },
        paragraph: { spacing: { before: 220, after: 110 }, outlineLevel: 1 },
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
      {
        reference: 'numbers',
        levels: [
          {
            level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
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

const outPath = path.join(__dirname, '..', 'docs', 'MYNAAVI_ONBOARDING_GUIDE.docx');

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log('Wrote', outPath);
});
