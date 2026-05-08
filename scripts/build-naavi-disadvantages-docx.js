/**
 * Generates docs/MYNAAVI_DISADVANTAGES.docx — honest list of MyNaavi's
 * competitive disadvantages relative to Apple Intelligence, Google Gemini,
 * ChatGPT, Microsoft Copilot, and other software-only competitors.
 *
 * Wael 2026-05-02: capture for strategic planning use.
 */

const fs = require('fs');
const path = require('path');

const DOCX_PATH = 'C:\\Users\\waela\\AppData\\Roaming\\npm\\node_modules\\docx';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat, PageOrientation,
} = require(DOCX_PATH);

// ─── Page geometry (US Letter) ───────────────────────────────────────────────
const PAGE_WIDTH = 12240;
const PAGE_HEIGHT = 15840;
const MARGIN = 1440;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

// ─── Colors ──────────────────────────────────────────────────────────────────
const ACCENT = '8B0000';        // dark red — disadvantages tone
const ACCENT_LIGHT = 'F4DDDD';  // very light red — table header
const ROW_ALT = 'F8F8F8';
const BORDER_GRAY = 'BFBFBF';
const TEXT_BLACK = '000000';
const TEXT_DIM = '555555';

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY };
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
const cellMargins = { top: 100, bottom: 100, left: 140, right: 140 };

// ─── Reusable helpers ────────────────────────────────────────────────────────
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

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true, size: 32, color: TEXT_BLACK, font: 'Arial' })],
    spacing: { before: 360, after: 200 },
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, size: 26, color: ACCENT, font: 'Arial' })],
    spacing: { before: 280, after: 140 },
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true, size: 22, color: TEXT_BLACK, font: 'Arial' })],
    spacing: { before: 200, after: 100 },
  });
}

// ─── Disadvantage section helper ─────────────────────────────────────────────
// Renders one disadvantage as: number+title heading, then the body text.
function disadvantage(num, title, body) {
  const blocks = [
    pMixed([
      { text: `${num}. `, bold: true, size: 24, color: ACCENT, font: 'Arial' },
      { text: title, bold: true, size: 24, color: TEXT_BLACK, font: 'Arial' },
    ], { spacing: { before: 200, after: 80 } }),
  ];
  for (const para of body.split('\n').filter(s => s.trim().length > 0)) {
    blocks.push(p(para.trim(), { size: 22, color: TEXT_BLACK, font: 'Arial' }));
  }
  return blocks;
}

// ─── Document content ────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);

const sections = [];

// Title page
sections.push(
  new Paragraph({
    children: [new TextRun({ text: 'MyNaavi', bold: true, size: 48, color: TEXT_BLACK, font: 'Arial' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 1200, after: 200 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Honest Competitive Disadvantages', bold: true, size: 32, color: ACCENT, font: 'Arial' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Software-only competitor frame (Apple Intelligence, Google Gemini, ChatGPT, Microsoft Copilot, Inflection Pi, Replika)', italics: true, size: 22, color: TEXT_DIM, font: 'Arial' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }),
  new Paragraph({
    children: [new TextRun({ text: `Captured ${today}`, size: 20, color: TEXT_DIM, font: 'Arial' })],
    alignment: AlignmentType.CENTER,
  }),
);

// Purpose section
sections.push(h1('Purpose'));
sections.push(p(
  'This document lists MyNaavi\'s competitive disadvantages with no softening. ' +
  'Use it for strategic planning: every weakness called out here is either a thing ' +
  'we accept (with a strategy to neutralize) or a thing we plan to fix on a roadmap.',
  { size: 22, color: TEXT_BLACK, font: 'Arial' }
));
sections.push(p(
  'Hardware-required competitors (Echo, ElliQ, Pillo, Jitterbug) are excluded ' +
  'because MyNaavi is software-only.',
  { size: 22, color: TEXT_BLACK, font: 'Arial', italics: true }
));

// Disadvantages
sections.push(h1('Disadvantages'));

sections.push(...disadvantage(
  1,
  'Solo founder, no engineering team',
  `Wael is the only person building MyNaavi (with an AI assistant). Every fix, feature, design decision, and on-call response runs through one pair of eyes. Apple has thousands of engineers on Apple Intelligence; Google has hundreds on Gemini; OpenAI has hundreds on ChatGPT; Microsoft has hundreds on Copilot.

Today's V57.10.3 to V57.10.4 emergency cycle is symptomatic: a one-character variable typo (diagSessionId vs diagSession) caused every spend-summary chat query to throw a JavaScript ReferenceError. The auto-tester didn't catch it because it doesn't exercise the mobile orchestrator's SPEND_SUMMARY handler. With a team, code review or a broader test matrix would have caught it before ship.`
));

sections.push(...disadvantage(
  2,
  'Stability — many bugs over recent versions',
  `V57.x has been bumpy: geofence loops generating 1000+ events in 6 minutes from a stationary phone, JS ReferenceErrors crashing chat, phantom actions where Naavi says "Let me add up..." with no follow-through, JWT-refresh races causing brief Google "disconnects" in the UI, mic-doesn't-release after Cancel.

Each bug has been root-caused and fixed (the V57.10.x series is mostly fixes of fixes), but the cumulative pattern shows a system that needs more hardening cycles before it's quiet enough for confident scale. Apple/Google's polished baseline is hard to compete with on raw reliability.`
));

sections.push(...disadvantage(
  3,
  'One real user (no usage signal beyond the founder)',
  `"Robert" is a persona name Wael uses to describe the target user; in reality Wael is the only installer and tester. There are no other users producing real-world usage data: no sessions to learn from, no edge cases discovered organically, no signal on which features actually matter. Every product decision is informed by one person's daily life.

Apple Intelligence is being shaped by hundreds of millions of iPhones. Google Gemini sees billions of queries. ChatGPT has hundreds of millions of users. MyNaavi has 1.`
));

sections.push(...disadvantage(
  4,
  'Android only',
  `MyNaavi is Android-only today. Half of the senior demographic in North America uses iPhone, and Apple Intelligence ships free with iOS 18+ on iPhone 15 Pro and newer. Those users are functionally unreachable until MyNaavi releases an iOS app — which is its own multi-month build with separate App Store review, separate Apple developer account, separate native module work.`
));

sections.push(...disadvantage(
  5,
  'No defined free tier',
  `Apple Intelligence, Google Gemini Free, Inflection Pi, and Replika Free are all $0. A senior considering MyNaavi has to choose between paying for it and using something free that already lives on their phone. Without a compelling free tier, MyNaavi has to win on features alone — every single time.`
));

sections.push(...disadvantage(
  6,
  'No distribution / brand recognition',
  `Apple, Google, Microsoft, and OpenAI have App Store top-billing, OEM preloads, billions in ad budget, and reflexive name recognition. "Apple," "Google," "ChatGPT" are household terms. "MyNaavi" is unknown. Even with a superior product, the discovery problem alone could keep usage flat.`
));

sections.push(...disadvantage(
  7,
  'Heavy third-party API dependency',
  `MyNaavi depends on Anthropic (Claude Haiku 4.5), Google APIs (Gmail, Calendar, Drive, Maps, People, Places), Twilio (SMS, WhatsApp, Voice), Deepgram (STT, TTS), OpenAI (embeddings), Epic FHIR (health records). Any pricing change, deprecation, or rate-limit change at any of these vendors hits MyNaavi immediately. Apple and Google control their full stack end-to-end and don't carry that exposure.`
));

sections.push(...disadvantage(
  8,
  'AI non-determinism (Claude Haiku flakes)',
  `MyNaavi uses Claude Haiku 4.5 — fast and cheap, but non-deterministic for prompt-driven shape assertions. Today's spend-summary bug is a perfect example: the LLM returned forward-looking speech ("Let me add up...") without emitting the SPEND_SUMMARY action it was supposed to. The auto-tester catches this most of the time, but the model still flakes occasionally. ChatGPT (GPT-4o) and Gemini 2 Pro have larger underlying models with more RLHF tuning; their action-emission is more reliable.`
));

sections.push(...disadvantage(
  9,
  'No regulatory framework or compliance certifications',
  `MyNaavi has no HIPAA Business Associate Agreement, no SOC 2 Type 2 audit, no GDPR DPA, no HITRUST. This blocks any partnership with healthcare providers, eldercare facilities, insurance companies, or enterprise buyers who require these certifications before purchasing.`
));

sections.push(...disadvantage(
  10,
  'Privacy story weaker than Apple Intelligence',
  `Apple Intelligence markets "your data stays on your iPhone" with on-device processing for most queries (and Private Cloud Compute for the rest). MyNaavi processes everything in the cloud (Anthropic for chat, Google for services, Twilio for messaging). For privacy-sensitive seniors and their adult children making the buying decision, this is a real selling-point disadvantage.`
));

sections.push(...disadvantage(
  11,
  'Test infrastructure thin',
  `MyNaavi has 44 auto-tester cases. Apple/Google have millions of automated tests across their AI products. Today's mobile-side ReferenceError slipped through because the test suite doesn't exercise the mobile orchestrator's SPEND_SUMMARY handler — only the server-side naavi-chat function. The test coverage for mobile-side action handlers is essentially zero.`
));

sections.push(...disadvantage(
  12,
  'Pricing model not yet defined',
  `MyNaavi has no public price. Without a pricing decision, every conversation about competitive value has to dance around the cost question. Apple Intelligence is free with the iPhone. Gemini is free or $20/mo. ChatGPT is $20-200/mo. ElliQ is $25-30/mo. Where does MyNaavi fit? The answer needs to be locked in before serious go-to-market.`
));

sections.push(...disadvantage(
  13,
  'Voice quality (Deepgram is good but not best)',
  `Deepgram nova-3 STT and TTS are excellent for the price, but Apple's, Google's, and OpenAI's proprietary voice models are state-of-the-art. Side-by-side, OpenAI's "shimmer" voice or Google's "Aoede" sound more natural. For a voice-first product where Robert spends most of his time hearing Naavi speak, this is a real delta — even if small.`
));

sections.push(...disadvantage(
  14,
  'AI reasoning quality (Haiku is small)',
  `Claude Haiku 4.5 is optimized for speed and cost. For complex reasoning tasks (multi-step planning, ambiguous query resolution, nuanced classification), GPT-4o, Gemini 2 Pro, and Claude Opus all outperform Haiku. MyNaavi runs on Haiku to keep latency and cost down — but on the hardest queries, the user experience may visibly trail what they'd get from ChatGPT.`
));

sections.push(...disadvantage(
  15,
  'No memorable brand',
  `"MyNaavi" requires explanation. "Apple," "Google," "ChatGPT" do not. In the 10-second introduction a senior gets from a friend or family member, brand familiarity does enormous work. MyNaavi has none of that built up yet.`
));

// Summary
sections.push(h1('Summary'));
sections.push(p(
  'Net read: MyNaavi has structural disadvantages of resources (1 vs. thousands), reach (1 user vs. billions), platform (Android only), and brand (unknown vs. household). It has dependency exposure on every third-party API in the stack. The free-tier competition from Apple Intelligence and Google Gemini is the single hardest go-to-market problem.',
  { size: 22, color: TEXT_BLACK, font: 'Arial' }
));
sections.push(p(
  'These are real and they are listed honestly. The strategic question is whether MyNaavi\'s structural advantages — voice phone-call interface, 5-channel alert fan-out, cross-ecosystem orchestration of ~28 touchpoints, senior-first UX — are large enough to overcome them in the segment of the market that genuinely needs those features.',
  { size: 22, color: TEXT_BLACK, font: 'Arial' }
));

// ─── Doc ─────────────────────────────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: TEXT_BLACK },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: ACCENT },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: 'Arial', color: TEXT_BLACK },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
    },
    children: sections,
  }],
});

const outPath = path.join(__dirname, '..', 'docs', 'MYNAAVI_DISADVANTAGES.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log(`Wrote ${outPath} (${buf.length} bytes)`);
});
