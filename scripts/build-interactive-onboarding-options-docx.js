/**
 * Build docs/INTERACTIVE_ONBOARDING_OPTIONS.docx — analysis of how to
 * turn the static onboarding guide into an interactive flow that pushes
 * the collected data directly into Naavi's user_settings.
 *
 * Run: node scripts/build-interactive-onboarding-options-docx.js
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

function calloutBox(label, text, fill = 'EAF2FB') {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders,
        width: { size: 9360, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill },
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

function optionTableRow(num, label, scope, audience, effort, fill) {
  const widths = [600, 2400, 2400, 2400, 1560];
  return new TableRow({
    children: [
      new TableCell({
        borders,
        width: { size: widths[0], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: '1F3A68' },
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: String(num), bold: true, color: 'FFFFFF', size: 24 })],
        })],
      }),
      new TableCell({
        borders,
        width: { size: widths[1], type: WidthType.DXA },
        shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 22 })] })],
      }),
      new TableCell({
        borders,
        width: { size: widths[2], type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: scope, size: 22 })] })],
      }),
      new TableCell({
        borders,
        width: { size: widths[3], type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: audience, size: 22 })] })],
      }),
      new TableCell({
        borders,
        width: { size: widths[4], type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: effort, bold: true, size: 22 })],
        })],
      }),
    ],
  });
}

function optionsTable() {
  const widths = [600, 2400, 2400, 2400, 1560];
  const headerRow = new TableRow({
    children: ['#', 'Option', 'Scope', 'Best for', 'Effort'].map((h, i) => new TableCell({
      borders,
      width: { size: widths[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: '1F3A68' },
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 22 })],
      })],
    })),
  });
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      headerRow,
      optionTableRow(1, 'Web onboarding form', 'HTML form on mynaavi.com → Edge Function → pending_onboarding table → mobile app pre-fills on first sign-in', 'Helpers, pre-install', '~1-2 days'),
      optionTableRow(2, 'In-app onboarding wizard', 'React Native first-launch screens → writes directly to user_settings via JWT', 'User installing alone', '~3-4 days'),
      optionTableRow(3, 'Both — web pre-install, in-app post-install', 'Helper fills web form, user installs, wizard pre-fills + asks confirm/skip', 'All three audiences', '~5-6 days'),
    ],
  });
}

const children = [];

children.push(title('MyNaavi — Interactive Onboarding Options'));
children.push(subtitle('Analysis for an onboarding flow that auto-populates Naavi settings'));

// ────────────────────────────────────────────────────────────────
children.push(h1('What "Interactive Onboarding" Means Here'));
children.push(p(
  'The current onboarding guide (MYNAAVI_ONBOARDING_GUIDE.docx) is a static checklist. The helper gathers the information, sits down with the user, and types each item into Settings manually. Friction is moderate; errors are common (typos, missed fields).'
));
children.push(p(
  'An interactive onboarding flow flips that. The helper (or user) fills the form ONCE in a digital surface; on submit, the data flows automatically into Naavi\'s user_settings table. When the user installs the app and signs in, their Settings page is already populated — home address, work address, emergency contacts, brief schedule, all there. They review, confirm, and Naavi is ready on day one with no manual typing.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('How It Would Work — Data Flow'));
children.push(p('The technical flow, in plain language:'));
children.push(bullet('1. Helper opens the digital onboarding form (web page on mynaavi.com, or in-app first-launch wizard).'));
children.push(bullet('2. They fill in each field — name, phone, addresses, emergency contacts, brief time, etc. — exactly as the static checklist describes.'));
children.push(bullet('3. They verify the user\'s email (a one-time code is emailed; they enter it back in the form).'));
children.push(bullet('4. On submit, the data is sent to a new Supabase Edge Function. The function writes the data to a new pending_onboarding table, keyed by email.'));
children.push(bullet('5. The user installs the mobile app and signs in with Google.'));
children.push(bullet('6. The app detects an existing pending_onboarding row matching their email and prompts: "I see your welcome form was filled out for you — import the answers?" The user taps Yes.'));
children.push(bullet('7. App copies the data into user_settings (their JWT-authenticated row). The pending_onboarding row is marked imported.'));
children.push(bullet('8. Settings page shows everything pre-filled. User reviews, edits if needed, taps Save. Naavi is fully configured.'));

// ────────────────────────────────────────────────────────────────
children.push(h1('Three Options'));
children.push(p('Increasing scope and polish. Pick based on which audience you most want to optimize for.'));
children.push(optionsTable());

children.push(h2('Option 1 — Web onboarding form'));
children.push(p(
  'A page on mynaavi.com (e.g., mynaavi.com/onboarding) that looks like the static checklist but is interactive. Helper fills it out before the user installs the app. On submit, data goes to pending_onboarding via an Edge Function. When the user signs in on mobile, the app detects the pre-filled data and offers to import.'
));
children.push(p('Strongest for helpers and pre-install gathering. Easiest to share via partnerships (a user care organization can link directly to it).'));

children.push(h2('Option 2 — In-app onboarding wizard'));
children.push(p(
  'React Native screens shown after the user signs in for the first time. Walks them through the same checklist one screen at a time, writing each field directly to user_settings via their authenticated JWT. No pre-install path; the user (or whoever is helping at install time) fills it as they go.'
));
children.push(p('Strongest for the user installing alone. Lower friction at install but no pre-install handoff for helpers.'));

children.push(h2('Option 3 — Both, integrated'));
children.push(p(
  'Helper fills the web form pre-install. User installs and signs in. The in-app wizard checks for pending_onboarding; if found, it pre-fills each step and lets the user review/edit/skip ahead instead of typing from scratch. If no pending_onboarding row exists, the wizard runs as a normal first-time setup.'
));
children.push(p('Highest effort but covers all three audiences from the static guide. Helpers like the web form; users get the in-app wizard; the team can demo either.'));

// PAGE BREAK before concerns
children.push(new Paragraph({ children: [new PageBreak()] }));

// ────────────────────────────────────────────────────────────────
children.push(h1('Real Concerns to Flag'));
children.push(p('Things that need careful design before any code is written.'));

children.push(h2('Authentication before install'));
children.push(p(
  'The web form collects personally-identifiable information (home address, emergency contacts, doctor info) BEFORE any account exists. We can\'t use Naavi\'s normal Supabase auth (which requires sign-in). Instead, we need:'
));
children.push(bullet('Email verification — helper enters user\'s email; system emails a 6-digit code; helper types it back. Prevents random submissions.'));
children.push(bullet('Rate limiting — at most 3 submissions per email per day, at most 100 submissions per IP per hour.'));
children.push(bullet('No password — pending_onboarding is identified by email only; the user\'s real account is created via Google sign-in later.'));

children.push(h2('Schema design'));
children.push(p(
  'A new pending_onboarding table:'
));
children.push(bullet('email — primary key (unique, lowercase)'));
children.push(bullet('verification_code_hash — bcrypt hash of the 6-digit code, expires after 30 minutes'));
children.push(bullet('verified_at — timestamp; null until the code is entered correctly'));
children.push(bullet('payload — JSON column with all the form data (addresses, contacts, brief schedule, etc.)'));
children.push(bullet('expires_at — auto-deletes after 30 days if no install happens (TTL via cron job)'));
children.push(bullet('imported_at — timestamp set when the mobile app pulls the data into user_settings'));
children.push(bullet('imported_by_user_id — the user_id who claimed the data, for audit trail'));

children.push(h2('Privacy and trust'));
children.push(p(
  'The form collects information BEFORE the user is in control of their data. Two safeguards:'
));
children.push(bullet('Clear language at the top of the form: "This information will be saved temporarily until [name] installs MyNaavi and signs in. It will be automatically deleted after 30 days if they don\'t install."'));
children.push(bullet('On import, the user sees a screen showing every field that was pre-filled, with the option to delete any line they don\'t want. They are in control.'));
children.push(bullet('No third-party sharing. The data lives in our Supabase project (Canadian region). No analytics, no marketing.'));

children.push(h2('Mobile-side changes'));
children.push(p(
  'For Option 1, the mobile app needs a new first-launch flow:'
));
children.push(bullet('On sign-in, query pending_onboarding by the user\'s email.'));
children.push(bullet('If a row exists and is verified and not yet imported, show an import-prompt screen with all fields visible.'));
children.push(bullet('On Yes, write the payload to user_settings and mark imported_at + imported_by_user_id.'));
children.push(bullet('On No, drop into normal first-launch (or in-app wizard if Option 3).'));
children.push(p('This is an AAB build — touches app/_layout.tsx and adds a new "Welcome" screen.'));

children.push(h2('Edge cases'));
children.push(bullet('User already has user_settings populated (existing user reinstalling): pending_onboarding import overwrites? Or merges? Recommend: confirm field-by-field rather than overwriting silently.'));
children.push(bullet('Helper fills the form but the user never installs: 30-day TTL, then auto-delete via cron.'));
children.push(bullet('Two helpers fill the form for the same email: second submission OVERWRITES the first (with email verification each time). Or warn "an existing form is in progress, do you want to replace it?"'));
children.push(bullet('User signs in with a different Google email than the helper entered: pending_onboarding lookup fails; user falls into normal first-launch. Edge-case but worth designing for — maybe show "is this email associated with a welcome form?" on first launch.'));

// ────────────────────────────────────────────────────────────────
children.push(h1('Strategic Fit'));
children.push(p(
  'Onboarding friction is the number-one user-tech adoption killer. A helper who can fill a form in fifteen minutes BEFORE the user sees the phone, then hand the user a phone where Naavi already knows their name and address, is ten times more likely to result in a daily user than a user fumbling through Settings on day one.'
));
children.push(p(
  'This is also a sales / partnership asset. A user care organization, a pharmacy chain, or an insurer can link to the form directly. Their staff fills it for the user. The user gets a working assistant on day one. The partnership becomes "we make Naavi installs easy" — measurable conversion uplift.'
));
children.push(p(
  'The risk is doing it badly. A clumsy form that loses data, breaks email verification, or imports wrong fields will sour every user care partnership we try to land. This is a "do it carefully or not at all" feature — not a session-end task.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('Honest Recommendation'));
children.push(p(
  'Schedule it as a dedicated two-session sprint. Session A: web form + pending_onboarding table + email verification + Edge Function (Option 1, ~1-2 days). Session B: mobile import flow + UI for the welcome screen + edge cases (~2-3 days). After Session B, Option 3 is essentially complete.'
));
children.push(p(
  'Do NOT bundle it with any current bug-fix or feature work. The schema, the auth model, and the privacy language all benefit from a fresh, focused session — not the tail end of a long testing day.'
));
children.push(p(
  'Add to the roadmap. Pick a date when you have two clear days available. Until then, the static onboarding guide (MYNAAVI_ONBOARDING_GUIDE.docx) covers the gap.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('Summary'));
children.push(calloutBox(
  'In one paragraph',
  'Yes, this is buildable and worth building. The cleanest path is Option 3 (web pre-install + in-app post-install), implemented across two dedicated sessions. The hardest parts are NOT the code — they are the schema, the email verification, and the privacy language. Plan it, do it once, do it right.',
  'EAF2FB'
));

// ────────────────────────────────────────────────────────────────
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

const outPath = path.join(__dirname, '..', 'docs', 'INTERACTIVE_ONBOARDING_OPTIONS.docx');

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log('Wrote', outPath);
});
