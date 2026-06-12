/**
 * Build docs/PRE_INVITE_SMOKE_TEST.docx from the matching markdown.
 *
 * Output is a Word-readable document with:
 *   - Headings (h1-h4)
 *   - Body paragraphs (with inline **bold** and `code` runs)
 *   - Bulleted and numbered lists
 *   - Tables (parsed from markdown pipe syntax)
 *   - Code blocks rendered as monospace pre-formatted boxes
 *
 * Run:  node scripts/build-pre-invite-smoke-test-docx.js
 * Deps: docx (installed via `npm install --no-save docx` for one-shot).
 */

const fs   = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat,
} = require('docx');

const MD_PATH  = path.join(__dirname, '..', 'docs', 'PRE_INVITE_SMOKE_TEST.md');
const OUT_PATH = path.join(__dirname, '..', 'docs', 'PRE_INVITE_SMOKE_TEST.docx');

const border       = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const cellBorders  = { top: border, bottom: border, left: border, right: border };

// ─── Inline run parsing — **bold** and `code` ─────────────────────────────

function parseInlineRuns(line) {
  // Split on bold or code, preserving the markers as separate tokens.
  // Order matters: handle `code` first so a backtick inside a bold span
  // doesn't get mis-parsed.
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    const codeOpen = line.indexOf('`', i);
    const boldOpen = line.indexOf('**', i);

    // Pick the nearest marker.
    const nextCode = codeOpen === -1 ? Infinity : codeOpen;
    const nextBold = boldOpen === -1 ? Infinity : boldOpen;
    const next     = Math.min(nextCode, nextBold);

    if (next === Infinity) {
      tokens.push({ kind: 'plain', text: line.slice(i) });
      break;
    }
    if (next > i) tokens.push({ kind: 'plain', text: line.slice(i, next) });

    if (next === codeOpen) {
      const close = line.indexOf('`', codeOpen + 1);
      if (close === -1) {                // unmatched — treat as plain
        tokens.push({ kind: 'plain', text: line.slice(codeOpen) });
        break;
      }
      tokens.push({ kind: 'code', text: line.slice(codeOpen + 1, close) });
      i = close + 1;
    } else {
      const close = line.indexOf('**', boldOpen + 2);
      if (close === -1) {                // unmatched — treat as plain
        tokens.push({ kind: 'plain', text: line.slice(boldOpen) });
        break;
      }
      tokens.push({ kind: 'bold', text: line.slice(boldOpen + 2, close) });
      i = close + 2;
    }
  }

  return tokens.map(t => {
    if (t.kind === 'bold') return new TextRun({ text: t.text, bold: true });
    if (t.kind === 'code') return new TextRun({ text: t.text, font: 'Consolas', size: 18 });
    return new TextRun({ text: t.text });
  });
}

// ─── Block constructors ───────────────────────────────────────────────────

function paragraph(text, opts = {}) {
  return new Paragraph({
    children: parseInlineRuns(text),
    spacing:  { after: 120, ...(opts.spacing || {}) },
    ...opts,
  });
}

function heading(level, text) {
  const map = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
  };
  return new Paragraph({
    heading: map[level] || HeadingLevel.HEADING_4,
    children: [new TextRun({ text: text.replace(/^#+\s*/, ''), bold: true })],
    spacing:  level === 1 ? { before: 320, after: 160 }
            : level === 2 ? { before: 240, after: 120 }
            : { before: 180, after: 100 },
  });
}

function bullet(text, indent = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: indent },
    children:  parseInlineRuns(text),
    spacing:   { after: 60 },
  });
}

function numbered(text, indent = 0) {
  return new Paragraph({
    numbering: { reference: 'numbered', level: indent },
    children:  parseInlineRuns(text),
    spacing:   { after: 60 },
  });
}

function codeBlock(lines) {
  // Render as a single paragraph with line breaks, monospace font,
  // grey background. Word will let the user select / copy the text.
  return new Paragraph({
    spacing: { before: 80, after: 120 },
    shading: { type: ShadingType.SOLID, color: 'F4F4F4' },
    children: lines.flatMap((l, i) => {
      const runs = [new TextRun({ text: l, font: 'Consolas', size: 18 })];
      if (i < lines.length - 1) runs.push(new TextRun({ break: 1 }));
      return runs;
    }),
  });
}

function horizontalRule() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } },
    spacing: { before: 120, after: 200 },
    children: [new TextRun('')],
  });
}

// ─── Table parsing ────────────────────────────────────────────────────────

function buildTable(rows) {
  // rows: array of arrays of cell strings.
  const headerRow = rows[0];
  const bodyRows  = rows.slice(2);   // skip the separator row (---)

  const docxRows = [
    new TableRow({
      tableHeader: true,
      children: headerRow.map(cellText => new TableCell({
        borders: cellBorders,
        shading: { type: ShadingType.SOLID, color: 'F0F0F0' },
        children: [new Paragraph({
          children: [new TextRun({ text: cellText.trim(), bold: true })],
          spacing:  { after: 0 },
        })],
      })),
    }),
    ...bodyRows.map(rowCells => new TableRow({
      children: rowCells.map(cellText => new TableCell({
        borders: cellBorders,
        children: [new Paragraph({
          children: parseInlineRuns(cellText.trim()),
          spacing:  { after: 0 },
        })],
      })),
    })),
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows:  docxRows,
  });
}

// ─── Markdown → docx blocks ───────────────────────────────────────────────

function convertMarkdown(md) {
  const lines  = md.split(/\r?\n/);
  const blocks = [];
  let   i      = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code fence (``` or ```language).
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      blocks.push(codeBlock(buf));
      i++;                              // skip the closing ```
      continue;
    }

    // Heading.
    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      blocks.push(heading(headingMatch[1].length, headingMatch[2]));
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^---+\s*$/.test(line)) {
      blocks.push(horizontalRule());
      i++;
      continue;
    }

    // Table — line that has at least 2 pipes AND next line is the
    // separator (---|---).
    if (line.includes('|') && /\|/.test(lines[i + 1] ?? '') && /^[\s|:-]+$/.test(lines[i + 1] ?? '')) {
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        const cells = lines[i].split('|').map(c => c).slice(1, -1); // trim leading/trailing pipe artifacts
        rows.push(cells.length > 0 ? cells : lines[i].split('|'));
        i++;
      }
      blocks.push(buildTable(rows));
      continue;
    }

    // Bullet list.
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bulletMatch) {
      const indent = Math.min(2, Math.floor(bulletMatch[1].length / 2));
      blocks.push(bullet(bulletMatch[2], indent));
      i++;
      continue;
    }

    // Numbered list.
    const numMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (numMatch) {
      const indent = Math.min(2, Math.floor(numMatch[1].length / 2));
      blocks.push(numbered(numMatch[2], indent));
      i++;
      continue;
    }

    // Blockquote — render as italic paragraph with indent.
    if (/^>\s+/.test(line)) {
      blocks.push(new Paragraph({
        children: [new TextRun({ text: line.replace(/^>\s+/, ''), italics: true })],
        indent:   { left: 360 },
        spacing:  { after: 120 },
      }));
      i++;
      continue;
    }

    // Blank line.
    if (line.trim() === '') {
      blocks.push(new Paragraph({ children: [new TextRun('')], spacing: { after: 60 } }));
      i++;
      continue;
    }

    // Plain paragraph (with inline bold/code).
    blocks.push(paragraph(line));
    i++;
  }

  return blocks;
}

// ─── Build + write ────────────────────────────────────────────────────────

const md     = fs.readFileSync(MD_PATH, 'utf8');
const blocks = convertMarkdown(md);

const doc = new Document({
  creator:  'MyNaavi build-pre-invite-smoke-test-docx',
  title:    'MyNaavi — Pre-Invite Smoke Test',
  styles: {
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next:    'Normal',
        run:     { size: 32, bold: true, color: '1F3A68' },
        paragraph: { spacing: { before: 320, after: 160 } },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next:    'Normal',
        run:     { size: 28, bold: true, color: '1F3A68' },
        paragraph: { spacing: { before: 240, after: 120 } },
      },
      {
        id: 'Heading3',
        name: 'Heading 3',
        basedOn: 'Normal',
        next:    'Normal',
        run:     { size: 24, bold: true, color: '1F3A68' },
        paragraph: { spacing: { before: 200, after: 100 } },
      },
      {
        id: 'Heading4',
        name: 'Heading 4',
        basedOn: 'Normal',
        next:    'Normal',
        run:     { size: 22, bold: true, color: '4A6B96' },
        paragraph: { spacing: { before: 180, after: 80 } },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 240 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 240 } } } },
          { level: 2, format: LevelFormat.BULLET, text: '▪', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 240 } } } },
        ],
      },
      {
        reference: 'numbered',
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 240 } } } },
          { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 240 } } } },
          { level: 2, format: LevelFormat.LOWER_ROMAN, text: '%3.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 240 } } } },
        ],
      },
    ],
  },
  sections: [{ properties: {}, children: blocks }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT_PATH, buf);
  console.log(`Wrote ${OUT_PATH} (${buf.length.toLocaleString()} bytes)`);
});
