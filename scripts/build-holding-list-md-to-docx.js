/**
 * Build a today-dated DOCX from the canonical holding-list markdown.
 *
 * Reads:  docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md  (canonical inventory)
 * Writes: docs/HOLDING_LIST_CLASSIFICATION_<YYYY-MM-DD>.docx (today's snapshot)
 *
 * Supersedes the older hardcoded-data script
 * (scripts/build-holding-list-classification-docx.js) which drifted from the
 * MD source. This one parses the markdown so future regenerations are zero-
 * effort — just `node scripts/build-holding-list-md-to-docx.js` after any
 * MD edit.
 *
 * Supports the markdown subset the inventory uses:
 *   - H1 (#), H2 (##), H3 (###)
 *   - Tables (pipe-delimited with separator row)
 *   - Bullet lists (- )
 *   - Paragraphs
 *   - Horizontal rules (---)
 *   - Inline: **bold**, *italic*, `code`, ~~strikethrough~~, [text](url)
 *
 * Run: node scripts/build-holding-list-md-to-docx.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, BorderStyle, WidthType, ShadingType,
  ExternalHyperlink,
} = require('docx');

// ─── CLI / paths ────────────────────────────────────────────────────────────

const SOURCE_MD = path.join(__dirname, '..', 'docs', 'HOLDING_LIST_CLASSIFICATION_2026-05-08.md');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }); // YYYY-MM-DD
const OUT_DOCX = path.join(__dirname, '..', 'docs', `HOLDING_LIST_CLASSIFICATION_${today}.docx`);

if (!fs.existsSync(SOURCE_MD)) {
  console.error(`Source not found: ${SOURCE_MD}`);
  process.exit(1);
}

const md = fs.readFileSync(SOURCE_MD, 'utf8');

// ─── Styling primitives ─────────────────────────────────────────────────────

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const cellBorders = { top: border, bottom: border, left: border, right: border };
const HEADER_SHADING = { type: ShadingType.SOLID, color: 'E8EEF7', fill: 'E8EEF7' };

// ─── Inline markdown → array of TextRun / ExternalHyperlink children ────────
//
// Handles the inline subset the inventory uses. Order of operations matters:
// links FIRST (so URL contents aren't bold-mangled), then bold/italic/code/
// strike. Backslash-escaped pipes inside cells were already split out by the
// table parser; we don't need to handle them here.
function inlineToRuns(text, baseOpts = {}) {
  const out = [];
  // Tokenize into segments by recognizing the leftmost markdown token.
  // Iterative scan keeps the order intact across mixed inline markers.
  let i = 0;
  const len = text.length;
  let buf = '';
  const flushPlain = () => {
    if (buf) {
      out.push(new TextRun({ text: buf, ...baseOpts }));
      buf = '';
    }
  };
  while (i < len) {
    const rest = text.slice(i);
    // Link [text](url)
    const linkM = rest.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkM) {
      flushPlain();
      out.push(new ExternalHyperlink({
        children: [new TextRun({ text: linkM[1], style: 'Hyperlink', color: '2E5599', underline: { type: 'single' }, ...baseOpts })],
        link: linkM[2],
      }));
      i += linkM[0].length;
      continue;
    }
    // Bold **text**
    const boldM = rest.match(/^\*\*([^*]+)\*\*/);
    if (boldM) {
      flushPlain();
      out.push(...inlineToRuns(boldM[1], { ...baseOpts, bold: true }));
      i += boldM[0].length;
      continue;
    }
    // Italic *text* (must not match ** which is bold; handled above first)
    const italM = rest.match(/^\*([^*]+)\*/);
    if (italM) {
      flushPlain();
      out.push(...inlineToRuns(italM[1], { ...baseOpts, italics: true }));
      i += italM[0].length;
      continue;
    }
    // Strikethrough ~~text~~
    const strikeM = rest.match(/^~~([^~]+)~~/);
    if (strikeM) {
      flushPlain();
      out.push(...inlineToRuns(strikeM[1], { ...baseOpts, strike: true }));
      i += strikeM[0].length;
      continue;
    }
    // Inline code `code`
    const codeM = rest.match(/^`([^`]+)`/);
    if (codeM) {
      flushPlain();
      out.push(new TextRun({ text: codeM[1], font: 'Consolas', ...baseOpts }));
      i += codeM[0].length;
      continue;
    }
    // Plain character
    buf += rest[0];
    i += 1;
  }
  flushPlain();
  return out;
}

// ─── Block helpers ──────────────────────────────────────────────────────────

function pPlain(text, spacingAfter = 120) {
  return new Paragraph({
    children: inlineToRuns(text),
    spacing: { after: spacingAfter },
  });
}

function h1(text) {
  return new Paragraph({
    style: 'Heading1',
    children: inlineToRuns(text, { bold: true, size: 30, color: '1F3A68' }),
  });
}

function h2(text) {
  return new Paragraph({
    style: 'Heading2',
    children: inlineToRuns(text, { bold: true, size: 24, color: '2E5599' }),
  });
}

function h3(text) {
  return new Paragraph({
    children: inlineToRuns(text, { bold: true, size: 22, color: '2E5599' }),
    spacing: { before: 160, after: 80 },
  });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: inlineToRuns(text),
    spacing: { after: 60 },
  });
}

function hr() {
  return new Paragraph({
    children: [new TextRun({ text: '────────────────────────────────────────', color: 'AAAAAA' })],
    spacing: { before: 120, after: 120 },
    alignment: AlignmentType.CENTER,
  });
}

function tableCell(text, opts = {}) {
  return new TableCell({
    borders: cellBorders,
    shading: opts.header ? HEADER_SHADING : undefined,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({
      children: inlineToRuns(text, opts.header ? { bold: true } : {}),
      spacing: { after: 0 },
    })],
  });
}

function mdTable(headerCells, rows) {
  const widths = headerCells.length > 0
    ? Array(headerCells.length).fill(Math.floor(100 / headerCells.length))
    : [];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headerCells.map((h, i) => tableCell(h, { header: true, width: widths[i] })),
      }),
      ...rows.map(cells => new TableRow({
        children: cells.map((c, i) => tableCell(c, { width: widths[i] })),
      })),
    ],
  });
}

// ─── Markdown line walker ───────────────────────────────────────────────────

function parseTable(lines, startIdx) {
  // lines[startIdx] is the header row "| col | col |"
  // lines[startIdx + 1] is the separator "|---|---|"
  // lines[startIdx + 2...] are data rows until the first non-table line.
  const split = (row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
  const headerCells = split(lines[startIdx]);
  let i = startIdx + 2;
  const rows = [];
  while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
    rows.push(split(lines[i]));
    i += 1;
  }
  return { headerCells, rows, nextIdx: i };
}

function buildChildren() {
  const out = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let pendingBlank = false;
  while (i < lines.length) {
    const line = lines[i];
    // H1
    if (/^#\s+/.test(line)) {
      out.push(h1(line.replace(/^#\s+/, '')));
      i += 1; continue;
    }
    // H2
    if (/^##\s+/.test(line)) {
      out.push(h2(line.replace(/^##\s+/, '')));
      i += 1; continue;
    }
    // H3
    if (/^###\s+/.test(line)) {
      out.push(h3(line.replace(/^###\s+/, '')));
      i += 1; continue;
    }
    // HR
    if (/^---+\s*$/.test(line)) {
      out.push(hr());
      i += 1; continue;
    }
    // Table — line that starts with | and the next line is a separator row
    if (/^\|.*\|\s*$/.test(line)
      && i + 1 < lines.length
      && /^\|[-:|\s]+\|\s*$/.test(lines[i + 1])) {
      const { headerCells, rows, nextIdx } = parseTable(lines, i);
      out.push(mdTable(headerCells, rows));
      // Small spacer paragraph after the table for breathing room.
      out.push(pPlain(''));
      i = nextIdx; continue;
    }
    // Bullet list line
    if (/^\s*-\s+/.test(line)) {
      out.push(bullet(line.replace(/^\s*-\s+/, '')));
      i += 1; continue;
    }
    // Blank line
    if (/^\s*$/.test(line)) {
      pendingBlank = true;
      i += 1; continue;
    }
    // Paragraph — collect continuation lines until blank or block-start line.
    let para = line;
    let j = i + 1;
    while (
      j < lines.length
      && !/^\s*$/.test(lines[j])
      && !/^#/.test(lines[j])
      && !/^---+\s*$/.test(lines[j])
      && !/^\|.*\|\s*$/.test(lines[j])
      && !/^\s*-\s+/.test(lines[j])
    ) {
      para += ' ' + lines[j].trim();
      j += 1;
    }
    out.push(pPlain(para));
    i = j;
  }
  return out;
}

// ─── Assemble + write ───────────────────────────────────────────────────────

const children = buildChildren();

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
        // Landscape — the four/six-column tables with long Notes cells need the
        // extra horizontal room.
        size: { width: 15840, height: 12240, orientation: 'landscape' },
        margin: { top: 720, right: 720, bottom: 720, left: 720 },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT_DOCX, buffer);
  console.log(`Wrote ${OUT_DOCX} (${(buffer.length / 1024).toFixed(1)} KB) from ${SOURCE_MD}`);
}).catch(err => {
  console.error('DOCX build failed:', err);
  process.exit(1);
});
