// Generates WEB_WORK_SESSION_11.docx from the same content as the MD file.
// Run: node build_web_work_docx.js
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Footer, AlignmentType, HeadingLevel, LevelFormat,
  BorderStyle, WidthType, ShadingType, PageNumber,
} = require('docx');

const FONT = 'Calibri';

function h(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    children: [new TextRun({ text, bold: true, font: FONT })],
    spacing: { before: 240, after: 120 },
  });
}
function p(children, opts = {}) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { after: 100 },
    ...opts,
  });
}
function t(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: 22, ...opts });
}
function bullet(runs) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 60 },
  });
}
function numbered(runs) {
  return new Paragraph({
    numbering: { reference: 'numbered', level: 0 },
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 60 },
  });
}
function hr() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } },
    spacing: { before: 120, after: 120 },
  });
}

// --- Commits table ---
function commitsTable() {
  const border = { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const pad = { top: 100, bottom: 100, left: 140, right: 140 };
  function cell(text, width, isHeader = false) {
    return new TableCell({
      borders,
      width: { size: width, type: WidthType.DXA },
      shading: isHeader ? { fill: '1F6FEB', type: ShadingType.CLEAR } : undefined,
      margins: pad,
      children: [new Paragraph({
        children: [new TextRun({ text, font: FONT, size: 22, bold: isHeader, color: isHeader ? 'FFFFFF' : '000000' })],
      })],
    });
  }
  const rows = [
    ['SHA', 'Title'],
    ['ab454ba', 'Rewrite homepage and tighten blog CTAs'],
    ['4e7d47f', 'Remove public phone number; replace with private-preview CTAs'],
    ['e7eeffb', 'Wire up Formspree form ID for the signup form'],
    ['ad1b543', 'Guide: align branding and add voice-by-phone section'],
  ];
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1600, 7760],
    rows: rows.map((row, idx) => new TableRow({
      children: row.map((text, colIdx) => cell(text, colIdx === 0 ? 1600 : 7760, idx === 0)),
    })),
  });
}

const children = [
  // Title
  new Paragraph({
    children: [new TextRun({ text: 'MyNaavi Website — Session 11 Work Summary', bold: true, size: 36, font: FONT, color: '1F6FEB' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'April 17, 2026  ·  Repo munk2207/mynaavi-website  ·  Deployed to mynaavi.com', italics: true, size: 22, font: FONT, color: '505050' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
  }),
  hr(),

  h('What was done', HeadingLevel.HEADING_1),

  h('1. Honest website review', HeadingLevel.HEADING_2),
  p(t('An end-to-end assessment of the previous mynaavi.com, covering strengths, weaknesses, and gaps. Key findings:')),
  bullet(t('Pitch was too abstract ("AI life orchestration") — didn\'t say what Naavi actually does')),
  bullet(t('No product demo, screenshots, or video')),
  bullet(t('Waitlist as primary CTA was weak given the product is actually working')),
  bullet(t('Non-profit framing was risky without reinforcement')),
  bullet(t('No social proof, no comparison to existing voice assistants')),
  bullet(t('Blog existed but was invisible from the homepage')),

  h('2. Homepage rewrite', HeadingLevel.HEADING_2),
  p(t('Complete content rewrite, same dark-teal visual style. Sections now include:')),
  bullet([t('Hero — ', { bold: true }), t('"One phone number. Naavi handles the rest." with a third-person Robert narrative')]),
  bullet([t('Sixty-second doctor-visit scene — ', { bold: true }), t('three numbered steps ending in a "while Robert walks to his car" list showing nine orchestrated outcomes')]),
  bullet([t('Comparison table — ', { bold: true }), t('five rows comparing Naavi to Siri / Alexa / Google Assistant')]),
  bullet([t('"Who Naavi is for" — ', { bold: true }), t('active senior, adult child, care facility, healthcare partner')]),
  bullet([t('Founder letter — ', { bold: true }), t('named signature (Wael Aggan), concrete origin story')]),
  bullet([t('Blog teaser cards — ', { bold: true }), t('surface the three essays directly on the homepage')]),
  bullet([t('Expanded signup form — ', { bold: true }), t('email + role dropdown + optional message')]),

  h('3. Blog articles refreshed', HeadingLevel.HEADING_2),
  p(t('All three articles polished. Each now has a tightened lead where appropriate, a "what this looks like in practice" section tying to a real Naavi interaction, and a unified CTA block.')),
  bullet([t('/blog/aging-in-place-gap — ', { bold: true }), t('leads with the 81% / 26% gap')]),
  bullet([t('/blog/orchestration-not-automation — ', { bold: true }), t('Google Maps analogy intact; Naavi-in-action close added')]),
  bullet([t('/blog/retrieval-not-storage — ', { bold: true }), t('Carvalho memory story intact; "what retrieval looks like when it works" added')]),

  h('4. Phone-number removal (critical)', HeadingLevel.HEADING_2),
  p(t('Identified a gap: the voice server has no onboarding path for strangers. A visitor calling the public number before signing in through the mobile app hits a dead-end — no Google refresh token means no Gmail / Calendar / Drive access.')),
  p(t('Removed the public phone number from: homepage hero CTA, homepage meta text, all three blog article CTAs, and blog article body copy.')),
  p([t('Replaced with a two-button approach: '), t('"Join the private preview"', { bold: true }), t(' (primary) and '), t('"Talk to us"', { bold: true }), t(' (secondary), both scrolling to the same signup form.')]),
  p([t('Hero meta text now reads: '), t('"Currently in private preview with families in Ontario. Expanding soon."', { italics: true })]),

  h('5. Signup form expansion', HeadingLevel.HEADING_2),
  p(t('The form previously collected only email. It now collects:')),
  bullet(t('Email (required)')),
  bullet(t('"I\'m a…" dropdown — Active senior / Family / Care facility / Healthcare organization / Other')),
  bullet(t('Optional message textarea')),
  bullet(t('Reply-within-3-business-days promise set visible')),
  p([t('Submissions are delivered to Formspree (form ID '), t('xvzdkjod', { font: 'Consolas' }), t(', wired up in commit e7eeffb).')]),

  h('6. Guide page update (/guide)', HeadingLevel.HEADING_2),
  p(t('Two changes:')),
  bullet([t('Rebranding — ', { bold: true }), t('"MyNaavi Foundation" replaced with "MyNaavi" everywhere (nav, footer, copyright, OG tags)')]),
  bullet([t('New "Voice by Phone" section — ', { bold: true }), t('three steps explaining how the phone-call experience relates to mobile app sign-in. Sets the expectation: app first for onboarding, phone for everyday voice. Resolves the inconsistency between the new homepage\'s voice-first promise and the guide\'s app-only walkthrough.')]),

  hr(),

  h('Commits pushed this session', HeadingLevel.HEADING_1),
  p(t('All on munk2207/mynaavi-website branch main. Vercel auto-deploys every push.')),
  commitsTable(),

  hr(),

  h('What\'s live now at mynaavi.com', HeadingLevel.HEADING_1),
  bullet([t('Homepage — ', { bold: true }), t('new hero, doctor-visit scene, Siri/Alexa comparison, audience cards, founder letter, blog teasers, signup form')]),
  bullet([t('Blog — ', { bold: true }), t('three essays with consistent private-preview CTAs')]),
  bullet([t('Guide (/guide) — ', { bold: true }), t('app setup + voice-by-phone explanation')]),
  bullet([t('Signup form — ', { bold: true }), t('live, delivering to Formspree')]),
  bullet([t('No public phone number anywhere — ', { bold: true }), t('protects against strangers hitting a broken onboarding path')]),

  hr(),

  h('What\'s still outstanding', HeadingLevel.HEADING_1),

  h('Short-term (content / credentials)', HeadingLevel.HEADING_2),
  numbered([t('Verify Formspree delivery — ', { bold: true }), t('submit a test entry from the live site; confirm email arrives. First submission usually requires a one-time confirmation click.')]),
  numbered([t('Review copy — ', { bold: true }), t('confirm the Robert and Marie names work, or substitute actual target users.')]),
  numbered([t('Founder photo — ', { bold: true }), t('replace the "W" dot placeholder with a headshot for credibility.')]),

  h('Medium-term (requires product work)', HeadingLevel.HEADING_2),
  numbered([t('SMS-triggered OAuth onboarding — ', { bold: true }), t('when an unknown number calls, Naavi texts a sign-up link. Unlocks the "call to try" path without requiring mobile-app install first. ~1 hour.')]),
  numbered([t('Web signup-then-OAuth flow — ', { bold: true }), t('make the signup form the start of onboarding: email → Google sign-in → phone number → automatically registered. ~2 hours.')]),
  numbered([t('Reinstate phone number — ', { bold: true }), t('after either of the above is live, bring the Twilio number back to the homepage as a working "try it now" CTA.')]),

  h('Longer-term (optional polish)', HeadingLevel.HEADING_2),
  numbered([t('Demo video or audio clip — ', { bold: true }), t('30-60 second recording of a real "record my visit" flow in the hero.')]),
  numbered([t('Social proof — ', { bold: true }), t('one quote from a private-preview family would move conversion meaningfully.')]),
  numbered([t('Pricing / model page — ', { bold: true }), t('explain the service model (subscription / insurance / non-profit).')]),
  numbered([t('Plausible or Fathom analytics — ', { bold: true }), t('privacy-friendly visitor tracking; ~$9-14/month.')]),

  hr(),

  h('Hosting recommendation', HeadingLevel.HEADING_1),
  p([t('Stay on Vercel.', { bold: true }), t(' Free, fast, auto-deploys from GitHub, SSL included, no migration pain. HubSpot is wrong for this stage — it\'s a CRM + marketing platform priced for teams with active sales funnels.')]),
  p(t('For the current stack:')),
  bullet([t('Vercel (hosting) — ', { bold: true }), t('free')]),
  bullet([t('Formspree (forms) — ', { bold: true }), t('free tier sufficient')]),
  bullet([t('Plausible (analytics) — ', { bold: true }), t('add when desired, ~$9/month')]),
  bullet([t('Buttondown (newsletter) — ', { bold: true }), t('add when you have ~50 subscribers, ~$9/month')]),
  p([t('Total stack: '), t('$0-20/month', { bold: true }), t(' through 10,000 visitors and 1,000 signups.')]),
  p(t('Revisit HubSpot when you have paying users and a team handling lead follow-up.')),

  hr(),
  p([t('Generated April 17, 2026 as part of the Session 11 website overhaul.', { italics: true, color: '707070', size: 20 })]),
];

const doc = new Document({
  creator: 'MyNaavi',
  title: 'MyNaavi Website — Session 11 Work Summary',
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
      { reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: 'numbered',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          t('Web Work Session 11  —  Page ', { color: '707070', size: 18 }),
          new TextRun({ children: [PageNumber.CURRENT], color: '707070', size: 18, font: FONT }),
        ],
      })] }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buffer => {
  const out = path.join(__dirname, 'WEB_WORK_SESSION_11.docx');
  fs.writeFileSync(out, buffer);
  console.log(`Wrote ${out} (${buffer.length} bytes)`);
});
