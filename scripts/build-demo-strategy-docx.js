/**
 * Generates docs/MYNAAVI_DEMO_STRATEGY.docx — concrete plan for using
 * voice phone-call demo line + YouTube + web-based trial to showcase
 * MyNaavi's #1 differentiator (voice phone call interface).
 *
 * Wael 2026-05-02: capture the strategy + tactics documented in chat.
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
const ACCENT = '2E7D6A';        // teal — strategy / positive tone
const ACCENT_LIGHT = 'D5E8E2';
const ROW_ALT = 'F4F4F4';
const BORDER_GRAY = 'BFBFBF';
const TEXT_BLACK = '000000';
const TEXT_DIM = '555555';

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY };
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
const cellMargins = { top: 100, bottom: 100, left: 140, right: 140 };

// ─── Reusable helpers ────────────────────────────────────────────────────────
function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Arial', size: 22, color: TEXT_BLACK, ...opts })],
    spacing: { after: 120 },
  });
}

function pMixed(runs, paraOpts = {}) {
  return new Paragraph({
    children: runs.map(r => r instanceof TextRun ? r : new TextRun({ font: 'Arial', size: 22, color: TEXT_BLACK, ...r })),
    spacing: { after: 120 },
    ...paraOpts,
  });
}

function bullet(text, opts = {}) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun({ text, font: 'Arial', size: 22, color: TEXT_BLACK, ...opts })],
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
    children: [new TextRun({ text: 'Voice Demo Strategy', bold: true, size: 32, color: ACCENT, font: 'Arial' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'How to demonstrate MyNaavi\'s #1 differentiator (voice phone call) using public phone, web, and YouTube.', italics: true, size: 22, color: TEXT_DIM, font: 'Arial' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }),
  new Paragraph({
    children: [new TextRun({ text: `Captured ${today}`, size: 20, color: TEXT_DIM, font: 'Arial' })],
    alignment: AlignmentType.CENTER,
  }),
);

// Strategic premise
sections.push(h1('Strategic premise'));

sections.push(p(
  'MyNaavi has one structural advantage no software competitor can easily copy: a voice phone-call interface. ' +
  'Apple Intelligence, Google Gemini, ChatGPT, Microsoft Copilot, Inflection Pi, and Replika all require an app, ' +
  'a screen, and an account. MyNaavi alone lets a senior dial a phone number and talk like calling a person.'
));

sections.push(p(
  'For the senior demographic, this difference is not subtle. A senior who would never download an app, ' +
  'never learn to chat with Siri, never type into ChatGPT, will dial a phone number. That is the wedge.'
));

sections.push(p(
  'This document captures three concrete demonstration channels — public phone line, web "click to talk," ' +
  'and YouTube — plus distribution multipliers, ranked by impact-to-effort ratio.',
  { bold: true }
));

// Plan A
sections.push(h1('Plan A — Public demo phone number'));

sections.push(h2('What it is'));
sections.push(p(
  'A second Twilio number that any North American phone can dial. The number routes to a sandboxed "demo user" ' +
  'account with sample data (fake calendar events, fake contacts, fake email rules) so callers experience MyNaavi ' +
  'without needing an app, a download, or sign-up.'
));

sections.push(h2('Status'));
sections.push(pMixed([
  { text: 'Status: ', bold: true },
  { text: 'IMPLEMENTED. Live at ', },
  { text: '+1 (925) 886-2284', bold: true, color: ACCENT },
  { text: '. Demo user (mynaavidemo@gmail.com) seeded with 5 contacts, 5 emails, 3 invoices, 1 location alert, 5 knowledge fragments.' },
]));

sections.push(h2('Marketing copy'));
sections.push(pMixed([
  { text: '"Try MyNaavi right now — dial ', italics: true },
  { text: '+1 (925) 886-2284', italics: true, bold: true },
  { text: ' from any phone. No app needed."', italics: true },
]));

sections.push(h2('Cost'));
sections.push(bullet('Twilio number rental: $1/month'));
sections.push(bullet('Inbound minutes: ~$0.013/min'));
sections.push(bullet('Anthropic Haiku per call: ~$0.01'));
sections.push(bullet('Deepgram TTS per call: ~$0.30'));
sections.push(bullet('100 demo calls/month, 5 minutes each: roughly $40/month total'));

sections.push(h2('Safety'));
sections.push(p('Demo callers cannot send real SMS, WhatsApp, or email — Naavi acknowledges audibly that the demo line does not actually send messages, then continues the conversation. Prevents abuse without breaking the conversational illusion.'));

// Plan B
sections.push(h1('Plan B — Web-based "Click to Talk" demo'));

sections.push(h2('What it is'));
sections.push(p(
  'A button on the MyNaavi website that opens a live voice call inside the visitor\'s browser. ' +
  'They click "Talk to MyNaavi" — browser asks mic permission — they are talking to Naavi within seconds.'
));
sections.push(p(
  'Same Naavi backend as Plan A. Different transport (WebRTC instead of phone network). ' +
  'Cost is similar — Twilio Voice JS SDK is free; per-minute is even cheaper than PSTN ($0.004 vs $0.013).'
));

sections.push(h2('Status'));
sections.push(p('Not yet built. Estimated effort: ~1 day to wire Twilio Voice JS SDK + a server endpoint for access tokens + a button on the website.'));

sections.push(h2('Trade-off'));
sections.push(p('Requires modern browser + mic permission. Roughly 70 percent of senior visitors will go through cleanly; 30 percent on older browsers or with mic blocked will not. Plan A (phone call) covers 100 percent.'));

// Plan C
sections.push(h1('Plan C — YouTube demo videos'));

sections.push(h2('What it is'));
sections.push(p(
  'Short videos (60-90 seconds) showing real conversations with Naavi via phone call. ' +
  'Distributed on YouTube, embedded on the website, repurposed for Instagram, Facebook, TikTok, and Email.'
));

sections.push(h2('Recommended first video — 60 seconds'));

sections.push(h3('Structure'));
sections.push(bullet('0-3 seconds: phone in hand, dialing the Naavi demo number (close-up shot)'));
sections.push(bullet('3-6 seconds: "Hi MyNaavi" — Naavi answers'));
sections.push(bullet('6-25 seconds: scenario one — "Remind me when I get to my doctor\'s tomorrow at 2 PM" — Naavi confirms with verified address'));
sections.push(bullet('25-40 seconds: scenario two — "Text my daughter I\'m running late" — Naavi sends, confirms'));
sections.push(bullet('40-50 seconds: scenario three — "What\'s on my calendar today?" — Naavi reads it'));
sections.push(bullet('50-60 seconds: text overlay reading "0 apps. 1 phone number. MyNaavi.com"'));

sections.push(h3('Production'));
sections.push(bullet('Recording: use the phone\'s built-in call recorder (Samsung has one, or any third-party recorder)'));
sections.push(bullet('Visuals: film the phone screen separately OR use stock footage of a senior holding a phone (free from Pexels/Unsplash)'));
sections.push(bullet('Editing: CapCut (free, mobile/desktop) or DaVinci Resolve (free, desktop)'));
sections.push(bullet('Captions: add via the editor — many seniors watch with sound off'));
sections.push(bullet('Background music: free from YouTube Audio Library'));
sections.push(bullet('Total time investment: ~2-4 hours for first video'));

sections.push(h3('Distribution multiplier'));
sections.push(bullet('60-second horizontal version → YouTube'));
sections.push(bullet('30-second vertical version → Instagram Reels, TikTok, YouTube Shorts'));
sections.push(bullet('Embed on website hero (above the fold)'));
sections.push(bullet('Email signature link'));
sections.push(bullet('Facebook video upload (where seniors actually are)'));

// Side-by-side comparison
sections.push(h1('Bonus — Side-by-side comparison videos'));

sections.push(p(
  'Most persuasive format for the adult-child decision-maker (the person buying for their parent). ' +
  'Show the same task done two ways: "Mom asks Siri" vs "Mom calls MyNaavi."'
));

sections.push(p(
  'Siri path: open phone, unlock, hold home button, miss the keyword, retry, give up. ' +
  'MyNaavi path: dial, talk, done.'
));

sections.push(p(
  'The demo writes itself. The adult child watching feels the difference viscerally. ' +
  'This is the format that converts the buying decision-maker.'
));

// Senior content marketing
sections.push(h1('Senior-channel content marketing'));

sections.push(h2('Where the demographic actually is'));
sections.push(bullet('AARP Magazine and AARP.org — adult children 50+ reading for their parents'));
sections.push(bullet('NextDoor — neighborhood community for active retirees'));
sections.push(bullet('Senior-focused YouTube channels (Senior Planet, Skip the Drugstore, etc.)'));
sections.push(bullet('Facebook groups for caregivers ("Working Daughter," "Caregiver Action Network")'));
sections.push(bullet('Podcasts targeting adult-child audience (sandwich generation themes)'));

sections.push(h2('Content angle'));
sections.push(p(
  'Article format: "Why your dad won\'t use ChatGPT but he\'ll call MyNaavi." ' +
  'Frame the problem as a generational tech-adoption mismatch — voice phone interface fixes it.'
));

sections.push(p('Cost: writing time. Distribution leverages existing audiences.'));

// Pharmacy / calling cards
sections.push(h1('Pharmacy / senior-center calling cards'));

sections.push(p(
  'Physical card distributed where the demographic actually shows up. ' +
  'Pharmacy pickup counters, senior-center bulletin boards, doctor offices, community centers.'
));

sections.push(p('Card content:'));
sections.push(bullet('Front: "Free demo: dial 1-888-916-2284 (1-888-91-NAAVI) to talk to MyNaavi"'));
sections.push(bullet('Back: 5 bullets of features (your daily brief, send a text by voice, set arrival alerts, save a note, ask anything)'));

sections.push(p('Cost: print run + distribution. Best leveraged via existing relationships with pharmacies that serve a senior clientele.'));

// User testimonials
sections.push(h1('User testimonial videos (later)'));

sections.push(p(
  'Most powerful format for trust-building, but requires real users with stories. ' +
  'Hold this until you have ten or more daily-active seniors using MyNaavi for two months or more.'
));

sections.push(p('Two formats:'));
sections.push(bullet('Adult child on camera: "Mom uses MyNaavi every morning to plan her day."'));
sections.push(bullet('Senior on camera: "Naavi reminded me about my grandson\'s birthday."'));

// Recommended sequence
sections.push(h1('Recommended execution sequence'));

sections.push(pMixed([
  { text: '1. ', bold: true },
  { text: 'Plan A is live. Use it. Drive the demo number into every conversation, email signature, and pitch deck immediately.', },
]));

sections.push(pMixed([
  { text: '2. ', bold: true },
  { text: 'Record the first 60-second YouTube video using a real call to the demo number. Total time: an afternoon. Cost: zero.', },
]));

sections.push(pMixed([
  { text: '3. ', bold: true },
  { text: 'Embed the video on the website hero. Replace any text-heavy hero with the video.', },
]));

sections.push(pMixed([
  { text: '4. ', bold: true },
  { text: 'Cut a 30-second vertical version for Instagram, TikTok, YouTube Shorts.', },
]));

sections.push(pMixed([
  { text: '5. ', bold: true },
  { text: 'Plan B (web "Click to Talk") — only after Plan A and YouTube are driving traffic. The web button converts visitors who got curious from the video.', },
]));

sections.push(pMixed([
  { text: '6. ', bold: true },
  { text: 'Senior-channel content marketing — write one anchor article, post in three communities. Iterate based on response.', },
]));

sections.push(pMixed([
  { text: '7. ', bold: true },
  { text: 'Calling cards — once 50-100 trial calls per month are flowing through Plan A, scale physical distribution.', },
]));

sections.push(pMixed([
  { text: '8. ', bold: true },
  { text: 'User testimonials — once you have 10+ real users with stories, add as the trust-building layer.', },
]));

// Summary
sections.push(h1('Bottom line'));

sections.push(p(
  'The demo phone line is the wedge. Apple/Google/ChatGPT/Microsoft cannot match it without rebuilding their entire access model. ' +
  'Every marketing surface should lead with the phone number.'
));

sections.push(p(
  'A 60-second YouTube video showing one phone call to the demo number, embedded on the website, distributed across TikTok and Reels, ' +
  'is the single highest-leverage marketing investment available — measured in dollars per demo call generated.',
  { bold: true }
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

const outPath = path.join(__dirname, '..', 'docs', 'MYNAAVI_DEMO_STRATEGY.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log(`Wrote ${outPath} (${buf.length} bytes)`);
});
