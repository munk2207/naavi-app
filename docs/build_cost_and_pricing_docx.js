/**
 * Build NAAVI_COST_AND_PRICING.docx — cost estimates + pricing analysis
 * companion to the team status brief.
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType,
} = require('docx');

const OUT = path.join(__dirname, 'NAAVI_COST_AND_PRICING.docx');

const PAGE_WIDTH  = 12240;
const PAGE_HEIGHT = 15840;
const MARGIN      = 1080;
const CONTENT_W   = PAGE_WIDTH - 2 * MARGIN;

const defaultFont = 'Calibri';
const bodySize    = 20;

const docStyles = {
  default: { document: { run: { font: defaultFont, size: bodySize } } },
  paragraphStyles: [
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: defaultFont, size: 40, bold: true, color: '1F3A5F' },
      paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: defaultFont, size: 26, bold: true, color: '1F3A5F' },
      paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
      run: { font: defaultFont, size: 22, bold: true, color: '2E5A8F' },
      paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 } },
  ],
};

const numberingConfig = {
  config: [
    { reference: 'bullets',
      levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
    { reference: 'numbered',
      levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
  ],
};

const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const h3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const p = (runs) => new Paragraph({
  children: Array.isArray(runs) ? runs : [runs],
  spacing: { before: 80, after: 80 },
});
const text = (t) => new TextRun(t);
const bold = (t) => new TextRun({ text: t, bold: true });
const italic = (t) => new TextRun({ text: t, italics: true });
const bullet = (runs) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  children: Array.isArray(runs) ? runs : [runs],
  spacing: { before: 30, after: 30 },
});
const numItem = (runs) => new Paragraph({
  numbering: { reference: 'numbered', level: 0 },
  children: Array.isArray(runs) ? runs : [runs],
  spacing: { before: 30, after: 30 },
});
const hr = () => new Paragraph({
  spacing: { before: 160, after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } },
  children: [],
});

// Table helper — variable column widths, header shading optional
const buildTable = (columnWidths, rows) => {
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (run, width, shading) => new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: shading ? { fill: shading, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [run], spacing: { before: 0, after: 0 } })],
  });
  const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
  const tableRows = rows.map((row, idx) => {
    const isHeader = idx === 0;
    return new TableRow({
      children: row.map((cellText, colIdx) => {
        const run = isHeader
          ? new TextRun({ text: cellText, bold: true, size: 18 })
          : new TextRun({ text: cellText, size: 18 });
        return cell(run, columnWidths[colIdx], isHeader ? 'D5E3F0' : undefined);
      }),
    });
  });
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths,
    rows: tableRows,
  });
};

// ─── Build document ──────────────────────────────────────────────────────────
const children = [];

children.push(h1('MyNaavi — Cost and Pricing Analysis'));
children.push(new Paragraph({
  children: [new TextRun({ text: 'Companion to the team status brief • April 21, 2026', italics: true, color: '555555' })],
  spacing: { before: 0, after: 160 },
}));
children.push(p([text('This document estimates the monthly cost to run MyNaavi, split into fixed infrastructure and per-user variable cost, so the team can reason about subscription pricing.')]));
children.push(p([italic('All numbers below are estimates based on public provider pricing and projected usage profiles. Real costs will vary by user behavior, provider promotions, and volume discounts.')]));
children.push(hr());

// ── 0. How much to trust these numbers
children.push(h2('0. How much to trust these numbers'));
children.push(p([text('Short version: '), bold('my per-user estimates could be off by \u00B130\u201350%.'), text(' Aggregate cost at 100+ users is much tighter (\u00B110%) because individual user variance averages out.')]));

children.push(h3('Realistic per-user ranges'));
children.push(buildTable(
  [1600, 2000, 2200, 2800],
  [
    ['Profile',  'Point estimate', 'Realistic range', '80% confidence band'],
    ['Light',    '$13',            '$8\u2013$25',     '$10\u2013$18'],
    ['Moderate', '$30',            '$20\u2013$55',    '$25\u2013$40'],
    ['Heavy',    '$106',           '$70\u2013$180',   '$80\u2013$140'],
  ],
));

children.push(h3('Top three sources of deviation (largest to smallest)'));
children.push(numItem([bold('User behavior variance. '), text('The "moderate profile" (50 chat turns/day, 15 min voice, 20 alerts) is a hypothesis, not a measurement. One user might hit 15 turns/day, another 80. That alone moves Claude + Deepgram + Twilio costs by 3\u20135\u00D7. Until we have 30 days of actual usage across 5+ users, this is the single biggest uncertainty.')]));
children.push(numItem([bold('Claude token patterns. '), text('Two specific risks where actual cost may exceed estimates:')]));
children.push(bullet([text('The isBroadQuery regex injects up to 100 knowledge fragments for open-ended questions. ~30k extra input tokens per query. If fired 5\u201310\u00D7/day, adds '), bold('$13\u2013$27/month'), text(' per user on top of the $14 Claude estimate.')]));
children.push(bullet([text('Calendar PDF ask-time reader attaches entire PDFs to Claude. ~20k tokens per attach. Three attaches/day = $5.40/month per user.')]));
children.push(p([italic('Working in our favor: Anthropic prompt caching gives a 90% discount on cached prefix. Not yet implemented. Once it is, Claude cost drops 30\u201340% at steady state.')]));
children.push(numItem([bold('Feature adoption variance. '), text('AssemblyAI (voice recording) and Twilio voice minutes are binary: most users won\u2019t use them; a few will use them heavily. My moderate profile splits the difference \u2014 which means most actual users will be below, and a small tail will be well above.')]));

children.push(h3('Systematic risks \u2014 cost could be higher than estimated'));
children.push(buildTable(
  [3800, 2500, 2280],
  [
    ['Risk', 'How much it could add', 'Mitigation'],
    ['Claude token count per turn higher than 1,500',         '+$10\u2013$15/mo per user',  'Measure actual from naavi-chat logs'],
    ['isBroadQuery path firing often',                        '+$13\u2013$27/mo per user', 'Narrow regex; cap knowledge fetch to 20 not 100'],
    ['Twilio voice minutes climbing if users treat Naavi\nas phone buddy', '+$15\u2013$25/mo per user', 'Soft cap on minutes; reach out if exceeded'],
    ['Support costs not modeled',                             '+$5\u2013$15/mo per user',  'Price Plus tier with headroom; triage volume'],
  ],
));

children.push(h3('Random risks \u2014 could go either way'));
children.push(bullet([text('OCR usage depends on each user\u2019s email mix (scanned vs text PDFs).')]));
children.push(bullet([text('Places API calls depend on location rule churn.')]));
children.push(bullet([text('Voice recording adoption is feature-specific and binary.')]));

children.push(h3('What would shrink the uncertainty'));
children.push(numItem([bold('30 days of real usage '), text('from the 2 current users. Supabase logs + Twilio console + Deepgram dashboard + Anthropic console give exact per-user cost. The estimates then become measurements.')]));
children.push(numItem([bold('Implement Anthropic prompt caching. '), text('30\u201340% Claude savings at steady state.')]));
children.push(numItem([bold('Log token counts per turn '), text('in the naavi-chat table. Lets us project accurately per user.')]));

children.push(h3('What this means for pricing'));
children.push(bullet([bold('Don\u2019t price below $49. '), text('The $39 Essentials tier has 22% margin at the moderate estimate; if moderate cost is actually $40 instead of $30, that margin collapses. $49 is a safer floor.')]));
children.push(bullet([bold('Plus at $59 has a buffer. '), text('Even if moderate cost comes in at $40, margin stays around 30%.')]));
children.push(bullet([bold('Heavy users can be unprofitable on any tier. '), text('$150/month provider cost on a $89 Premium tier is a $61/month loss. Soft-cap usage (works for 95%), hard-cap (complaints), or bump Premium to $119.')]));
children.push(bullet([bold('Expect pricing to require one revision '), text('within 60\u201390 days of paying users. Build it into the ToS.')]));

children.push(hr());

// ── 1. Fixed infrastructure
children.push(h2('1. Fixed infrastructure cost'));
children.push(p([text('These costs are incurred whether the service has 2 users or 2,000. They don\u2019t grow with user count until volume thresholds (bandwidth, storage, build quotas) are crossed.')]));
children.push(buildTable(
  [3000, 2000, 1800, 3280],
  [
    ['Line item', 'Provider', 'Monthly cost', 'Notes'],
    ['Database + Edge Functions + Auth + Storage', 'Supabase Pro', '$25', 'Production tier. Free tier insufficient for production.'],
    ['Voice call server (Node + Twilio glue)', 'Railway Hobby', '$5\u201310', 'Usage-based. Current footprint is small.'],
    ['Marketing site', 'Vercel', '$0', 'Free tier covers mynaavi.com (static HTML).'],
    ['Domain registration', 'Registrar', '$1.25', '$15/year amortized.'],
    ['Mobile CI/CD builds', 'EAS (Expo) Hobby', '$19', '30 builds/month included.'],
    ['Google Play developer account', 'Google', '$2', '$25 one-time, amortized.'],
    ['Apple Developer (if iOS)', 'Apple', '$8.25', 'Not active today; $99/year if iOS ships.'],
    ['Monitoring (optional, not yet used)', 'Sentry Team', '$0 today', 'Likely $26/month pre-scale.'],
    ['Fixed monthly baseline (Android only)', '', '~$50\u201355', ''],
    ['Fixed monthly baseline (Android + iOS)', '', '~$60', ''],
  ],
));

children.push(p([bold('One-time costs (not monthly):'), text(' Google Play dev account $25 (paid), Apple $99/year (if iOS ships), domain $15/year.')]));

// ── 2. Per-user variable cost
children.push(h2('2. Per-user variable cost'));
children.push(p([text('These costs scale linearly with user activity. Three user profiles modeled:')]));
children.push(bullet([bold('Light \u2014 '), text('20 chat turns/day, 5 min voice/day, 10 alerts/day, no voice recording.')]));
children.push(bullet([bold('Moderate \u2014 '), text('50 chat turns/day, 15 min voice/day, 20 alerts/day, occasional voice recording. (Baseline assumption.)')]));
children.push(bullet([bold('Heavy \u2014 '), text('150 chat turns/day, 45 min voice/day, 50 alerts/day, regular doctor-visit recordings.')]));

children.push(h3('2.1 Anthropic Claude (reasoning)'));
children.push(p([text('Primary: Claude Sonnet 4.6 ($3/M input, $15/M output). Secondary: Claude Haiku ($1/M input, $5/M output) for email action extraction and document classification.')]));
children.push(buildTable(
  [2000, 2200, 2200, 2200, 1500],
  [
    ['Profile', 'Sonnet input', 'Sonnet output', 'Haiku (email/doc)', 'Monthly'],
    ['Light',    '900k toks ($2.70)',  '180k toks ($2.70)', '$0.20', '~$5.60'],
    ['Moderate', '2.25M toks ($6.75)', '450k toks ($6.75)', '$0.50', '~$14.00'],
    ['Heavy',    '9M toks ($27.00)',   '2.25M toks ($33.75)', '$1.20', '~$61.95'],
  ],
));
children.push(p([italic('Assumes ~1.5k input + 300 output per chat turn. System prompt cached (40% discount possible via Anthropic prompt caching; not applied in conservative estimates).')]));

children.push(h3('2.2 Deepgram (speech)'));
children.push(p([text('Aura TTS: $0.015/1,000 characters. Nova-2 STT: $0.0043/minute (live voice + in-app mic).')]));
children.push(buildTable(
  [1800, 1600, 1600, 1700, 1700, 1700],
  [
    ['Profile', 'Voice min', 'STT cost', 'TTS chars', 'TTS cost', 'Monthly'],
    ['Light',    '150',   '$0.65', '15k',  '$0.23', '~$0.88'],
    ['Moderate', '450',   '$1.94', '45k',  '$0.68', '~$2.62'],
    ['Heavy',    '1,350', '$5.81', '120k', '$1.80', '~$7.61'],
  ],
));

children.push(h3('2.3 AssemblyAI (voice-call recording transcription)'));
children.push(p([text('$0.37 per hour of audio.')]));
children.push(buildTable(
  [2500, 3000, 4580],
  [
    ['Profile', 'Hours recorded', 'Monthly'],
    ['Light', '0', '$0.00'],
    ['Moderate', '2', '$0.74'],
    ['Heavy', '5', '$1.85'],
  ],
));

children.push(h3('2.4 Google Cloud APIs'));
children.push(p([text('Places Text Search: $17/1,000 requests. Geocoding: $5/1,000 requests. Vision OCR (DOCUMENT_TEXT_DETECTION): $1.50/1,000 pages.')]));
children.push(buildTable(
  [1800, 1800, 1800, 1800, 2880],
  [
    ['Profile', 'Places calls', 'Geocode', 'OCR pages', 'Monthly'],
    ['Light',    '10', '5',  '5',  '$0.22'],
    ['Moderate', '30', '15', '10', '$0.60'],
    ['Heavy',    '80', '40', '30', '$1.61'],
  ],
));

children.push(h3('2.5 Twilio (SMS + WhatsApp + Voice)'));
children.push(p([text('SMS (CA/US): ~$0.008/message. WhatsApp business template: ~$0.005/message. Outbound voice (morning brief): ~$0.014/min. Inbound voice (user-initiated): ~$0.0085/min.')]));
children.push(p([italic('Note: every self-alert fires on 4 channels (SMS + WhatsApp + Email + Push). Email and push are effectively free (Gmail via user OAuth, FCM free). So per alert, Twilio cost \u2248 $0.013.')]));
children.push(buildTable(
  [1500, 1500, 2300, 2300, 2480],
  [
    ['Profile', 'Alerts/day', 'Morning calls', 'Inbound voice min', 'Monthly'],
    ['Light',    '10', '30 \u00D7 2 min = $0.84', '150 \u00D7 $0.0085 = $1.28', '$6.02'],
    ['Moderate', '20', '$0.84',                   '450 \u00D7 $0.0085 = $3.83', '$12.47'],
    ['Heavy',    '50', '$1.68',                   '1,350 \u00D7 $0.0085 = $11.48', '$32.66'],
  ],
));

children.push(h3('2.6 Push notifications + weather'));
children.push(p([text('FCM and Open-Meteo both free tier at our scale. $0.00 per user.')]));

// ── 3. Per-user totals
children.push(h2('3. Per-user totals'));
children.push(buildTable(
  [3000, 1800, 1800, 3480],
  [
    ['Cost component', 'Light', 'Moderate', 'Heavy'],
    ['Anthropic Claude', '$5.60', '$14.00', '$61.95'],
    ['Deepgram',         '$0.88', '$2.62',  '$7.61'],
    ['AssemblyAI',       '$0.00', '$0.74',  '$1.85'],
    ['Google Cloud',     '$0.22', '$0.60',  '$1.61'],
    ['Twilio',           '$6.02', '$12.47', '$32.66'],
    ['Point estimate',      '~$13',        '~$30',         '~$106'],
    ['Realistic range',     '$8\u2013$25', '$20\u2013$55', '$70\u2013$180'],
    ['80% confidence band', '$10\u2013$18', '$25\u2013$40', '$80\u2013$140'],
  ],
));
children.push(p([text('The moderate profile \u2014 the expected baseline for the target senior user \u2014 is '), bold('~$30/month at the point estimate, with a realistic range of $20\u2013$55.'), text(' See \u00A70 for the sources of variance.')]));

// ── 4. Total cost at scales
children.push(h2('4. Total cost at different scales'));
children.push(p([text('Assuming moderate-profile users:')]));
children.push(buildTable(
  [1500, 2000, 2000, 2500, 2080],
  [
    ['Users', 'Fixed', 'Variable', 'Total monthly', 'Per-user run cost'],
    ['1',     '$55',  '$30',     '$85',     '$85.00'],
    ['10',    '$55',  '$300',    '$355',    '$35.50'],
    ['50',    '$55',  '$1,500',  '$1,555',  '$31.10'],
    ['100',   '$55',  '$3,000',  '$3,055',  '$30.55'],
    ['500',   '$90',  '$15,000', '$15,090', '$30.18'],
    ['1,000', '$150', '$30,000', '$30,150', '$30.15'],
  ],
));
children.push(p([text('At ~100+ users, per-user cost stabilizes around the variable cost (~$30/month for moderate). Fixed costs become negligible per-user.')]));

// ── 5. Subscription pricing
children.push(h2('5. Subscription pricing analysis'));

children.push(h3('What the cost floor tells us'));
children.push(p([text('A single moderate user costs ~$30/month in direct provider fees. Any subscription pricing must clear that plus cover customer acquisition, ongoing development, customer support, payment processing (Stripe ~3% + $0.30), taxes, and margin.')]));
children.push(p([bold('Rule of thumb:'), text(' subscription price should be 2\u20133\u00D7 variable cost to have durable margins and reinvestment capacity.')]));

children.push(h3('Pricing scenarios at 100 users, moderate profile'));
children.push(buildTable(
  [2500, 2000, 2000, 1800, 1080],
  [
    ['Tier price', 'Revenue @ 100', 'Total cost @ 100', 'Gross margin', '% margin'],
    ['$39 (cost-plus)',        '$3,900', '$3,055', '$845',   '21.6%'],
    ['$59 (market-aligned)',   '$5,900', '$3,055', '$2,845', '48.2%'],
    ['$79 (premium-aligned)',  '$7,900', '$3,055', '$4,845', '61.3%'],
    ['$99 (high-touch)',       '$9,900', '$3,055', '$6,845', '69.1%'],
  ],
));

children.push(h3('Competitive reference points'));
children.push(bullet([text('ChatGPT Plus: $20/month \u2014 general-purpose AI, no messaging, no phone calls.')]));
children.push(bullet([text('Google Nest Aware: $8\u201315/month \u2014 home monitoring only.')]));
children.push(bullet([text('LifeAlert / Philips Lifeline: $30\u201350/month \u2014 single-function medical alert.')]));
children.push(bullet([text('Concierge services (GoGoGrandparent, Papa): $30\u2013300/month \u2014 human agents, variable.')]));

children.push(h3('Recommended three-tier structure'));
children.push(buildTable(
  [1800, 1400, 4880, 1320],
  [
    ['Tier', 'Price/mo', 'Features', 'Target user'],
    ['Essentials', '$39',
      'Text chat, morning brief call, SMS/email alerts, 2 hrs voice/month, basic location alerts',
      'Reliability without heavy voice use'],
    ['Plus (default)', '$59',
      'Essentials + unlimited voice, WhatsApp alerts, voice recording up to 4 hrs/month, weather alerts, context-aware alerts',
      'Expected default. Normal usage.'],
    ['Premium', '$89',
      'Plus + unlimited voice recording, priority support, multi-location alerts, family access',
      'Heavy users. Small households.'],
  ],
));
children.push(p([text('Unit economics at 100 users with a 15 / 70 / 15 tier split:')]));
children.push(bullet([text('Revenue: (15 \u00D7 $39) + (70 \u00D7 $59) + (15 \u00D7 $89) = $585 + $4,130 + $1,335 = $6,050/month')]));
children.push(bullet([text('Cost: $55 fixed + 100 \u00D7 avg $30 variable = $3,055/month')]));
children.push(bullet([bold('Gross margin: $2,995 (49.5%)')]));

// ── 6. Break-even
children.push(h2('6. Break-even analysis'));
children.push(p([text('Assuming Plus tier at $59 as the reference price:')]));
children.push(buildTable(
  [1200, 2200, 2200, 2800],
  [
    ['Users', 'Monthly revenue', 'Monthly cost', 'Monthly margin'],
    ['1',   '$59',    '$85',    '-$26 (loss)'],
    ['5',   '$295',   '$205',   '$90'],
    ['10',  '$590',   '$355',   '$235'],
    ['25',  '$1,475', '$805',   '$670'],
    ['50',  '$2,950', '$1,555', '$1,395'],
    ['100', '$5,900', '$3,055', '$2,845'],
  ],
));
children.push(bullet([bold('Break-even: '), text('~2 paying users at $59/month.')]));
children.push(bullet([bold('Sustain part-time development (~$3,000/month): '), text('~10 paying users.')]));
children.push(bullet([bold('Sustain full-time development (~$15,000/month): '), text('~50 paying users.')]));

// ── 7. Assumptions / risks
children.push(h2('7. Assumptions, risks, and sensitivity'));
children.push(h3('Where numbers could drift'));
children.push(bullet([bold('Claude usage: '), text('complex questions + isBroadQuery path inflate Sonnet input tokens. Heavy-use Claude cost could double.')]));
children.push(bullet([bold('Voice minutes: '), text('third-largest cost driver. Users treating Naavi as phone buddy (hours/day) push this 5\u201310\u00D7.')]));
children.push(bullet([bold('Fan-out multiplier: '), text('every self-alert fires on 4 channels. 20 alerts/day = 80 Twilio events. Reliability/cost tradeoff accepted.')]));
children.push(bullet([bold('Prompt caching: '), text('Anthropic offers 90% discount on cached prefixes. Not applied; could reduce Claude cost 30\u201340% steady-state.')]));
children.push(bullet([bold('Volume discounts: '), text('Twilio, Deepgram, Google Cloud have tiers at 10k+/month. Not factored.')]));

children.push(h3('Not yet paid for'));
children.push(bullet([bold('Observability (Sentry, Datadog): '), text('$0 today. $30\u2013100/month at scale.')]));
children.push(bullet([bold('Voice server scaling: '), text('$5/month today. ~$30\u201350 at 500 active users.')]));
children.push(bullet([bold('Legal / compliance / HIPAA: '), text('not factored.')]));
children.push(bullet([bold('Support: '), text('even light email support = time cost.')]));

children.push(h3('Not in per-user variable cost'));
children.push(bullet([bold('Customer acquisition: '), text('large unknown. Word-of-mouth cheapest; paid senior-targeted ads expensive.')]));
children.push(bullet([bold('Payment processing: '), text('Stripe ~3% + $0.30. On $59: ~$2.07/month deducted from revenue.')]));

// ── 8. Recommendations
children.push(h2('8. Recommendations for the subscription decision'));
children.push(numItem([bold('Adopt the three-tier structure '), text('(Essentials $39 / Plus $59 / Premium $89). Captures different willingness-to-pay; gives margin room.')]));
children.push(numItem([bold('Price Plus at $59 as the default '), text('\u2014 clears ~2\u00D7 variable cost, leaves room for development, aligns with senior-targeted service pricing.')]));
children.push(numItem([bold('Offer a 14-day free trial, not a freemium tier. '), text('Free tier bleeds cash on Twilio per-send costs with no upside.')]));
children.push(numItem([bold('Set soft usage caps on Premium '), text('(e.g., "up to 10 hrs voice recording/month"). Soft caps let you have a conversation with 1\u20132% heavy outliers.')]));
children.push(numItem([bold('Revisit pricing at 100, 500, 1,000 users. '), text('Volume discounts + actual usage data will make the $30/moderate estimate more precise.')]));
children.push(numItem([bold('Separate family-member seats. '), text('Wael paying for his parent\u2019s arrival alerts = secondary seat at ~$10/month, limited features.')]));
children.push(numItem([bold('Don\u2019t underprice. '), text('Seniors value reliability and support. Naavi\u2019s advantage is orchestration + integration + voice. Price for value delivered, not raw token cost.')]));

// ── 9. Summary
children.push(h2('9. Summary one-liner'));
children.push(new Paragraph({
  style: 'Quote',
  children: [italic('The $30/moderate estimate is my best guess from public pricing and assumed usage. Actual could land anywhere from $20 to $55 per user per month. I would bet on $25\u2013$40 with 70% confidence \u2014 which is why the $59 Plus tier leaves room. Ship at that price, measure actual costs over the first 60 days from 5+ users, and be prepared to adjust within 90 days.')],
  spacing: { before: 120, after: 120 },
  indent: { left: 540 },
  border: { left: { style: BorderStyle.SINGLE, size: 12, color: '5DCAA5', space: 12 } },
}));

children.push(hr());
children.push(new Paragraph({
  children: [new TextRun({ text: 'Prepared by Wael and Claude Code. All figures are estimates based on public pricing as of April 2026 and projected usage. Revisit quarterly.', italics: true, color: '777777', size: 18 })],
  alignment: AlignmentType.CENTER,
  spacing: { before: 200, after: 0 },
}));

// ─── Build + write ───────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'MyNaavi',
  title: 'MyNaavi \u2014 Cost and pricing analysis',
  description: 'Cost estimates + pricing analysis companion to the team status brief.',
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
