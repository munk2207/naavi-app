/**
 * 2026-05-19 — Convert docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md to
 * .docx so Wael can add comments via Word's review tools.
 *
 * Reads the markdown directly (no hardcoded data), preserves headings /
 * paragraphs / tables / bullets / inline bold + italic. Output:
 * docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.docx
 *
 * Run: node scripts/md-to-docx-holding-list.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, BorderStyle, WidthType, ShadingType, AlignmentType,
} = require('docx');

const SRC = path.join(__dirname, '..', 'docs', 'HOLDING_LIST_CLASSIFICATION_2026-05-08.md');
const OUT = path.join(__dirname, '..', 'docs', 'HOLDING_LIST_CLASSIFICATION_2026-05-08.docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

// ── Inline parser ──────────────────────────────────────────────────────
// Handles **bold**, *italic*, `code`, and plain text. Returns TextRun[].
function parseInline(text) {
  const runs = [];
  let i = 0;
  let buf = '';
  const flush = (opts = {}) => {
    if (buf) { runs.push(new TextRun({ text: buf, ...opts })); buf = ''; }
  };
  while (i < text.length) {
    // **bold**
    if (text.startsWith('**', i)) {
      flush();
      const end = text.indexOf('**', i + 2);
      if (end === -1) { buf += text[i]; i++; continue; }
      runs.push(new TextRun({ text: text.slice(i + 2, end), bold: true }));
      i = end + 2;
      continue;
    }
    // *italic*
    if (text[i] === '*' && text[i + 1] !== '*') {
      flush();
      const end = text.indexOf('*', i + 1);
      if (end === -1) { buf += text[i]; i++; continue; }
      runs.push(new TextRun({ text: text.slice(i + 1, end), italics: true }));
      i = end + 1;
      continue;
    }
    // `code`
    if (text[i] === '`') {
      flush();
      const end = text.indexOf('`', i + 1);
      if (end === -1) { buf += text[i]; i++; continue; }
      runs.push(new TextRun({ text: text.slice(i + 1, end), font: 'Consolas', size: 18 }));
      i = end + 1;
      continue;
    }
    buf += text[i];
    i++;
  }
  flush();
  return runs;
}

// ── Block helpers ──────────────────────────────────────────────────────
function paragraphFromLine(line) {
  return new Paragraph({
    children: parseInline(line),
    spacing: { after: 120 },
  });
}
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true, size: 32, color: '1F3A68' })],
    spacing: { before: 280, after: 140 },
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, size: 26, color: '1F3A68' })],
    spacing: { before: 220, after: 100 },
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true, size: 22 })],
    spacing: { before: 180, after: 80 },
  });
}
function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: parseInline(text),
    spacing: { after: 60 },
  });
}

function tableFromMarkdown(headerCells, bodyRows) {
  const headerCellWidths = (() => {
    // Heuristic widths: first column narrow (IDs), last few narrow, middle wide
    const n = headerCells.length;
    const widths = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const label = headerCells[i].toLowerCase();
      if (label === 'id' || label === 'holding-list #') widths[i] = 7;
      else if (label === 'surface' || label === 'server/aab' || label === 'status') widths[i] = 10;
      else widths[i] = 25;
    }
    // Normalize so they sum to 100
    const sum = widths.reduce((a, b) => a + b, 0);
    return widths.map(w => Math.max(5, Math.round((w / sum) * 100)));
  })();

  function headerCell(text, widthPct) {
    return new TableCell({
      width: { size: widthPct, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.CLEAR, fill: '1F3A68' },
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20 })] })],
    });
  }
  function bodyCell(text, widthPct, opts = {}) {
    return new TableCell({
      width: { size: widthPct, type: WidthType.PERCENTAGE },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
      children: [new Paragraph({ children: parseInline(text), spacing: { after: 0 } })],
    });
  }

  const rows = [];
  rows.push(new TableRow({
    tableHeader: true,
    children: headerCells.map((h, i) => headerCell(h, headerCellWidths[i])),
  }));
  for (const r of bodyRows) {
    rows.push(new TableRow({
      children: r.map((c, i) => {
        const opts = {};
        // Tint the ID column on classification tables
        if (i === 0 && headerCells[0].toLowerCase() === 'id') opts.fill = 'F2F2F2';
        return bodyCell(c, headerCellWidths[i], opts);
      }),
    }));
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ── Markdown parser (line-by-line) ─────────────────────────────────────
function parseMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const children = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines
    if (line.trim() === '') { i++; continue; }

    // Horizontal rule (skip)
    if (/^---+\s*$/.test(line)) { i++; continue; }

    // Heading
    if (line.startsWith('### ')) { children.push(h3(line.slice(4).trim())); i++; continue; }
    if (line.startsWith('## '))  { children.push(h2(line.slice(3).trim())); i++; continue; }
    if (line.startsWith('# '))   { children.push(h1(line.slice(2).trim())); i++; continue; }

    // Table
    if (line.trim().startsWith('|') && lines[i + 1] && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1])) {
      const headerCells = line.split('|').slice(1, -1).map(s => s.trim());
      i += 2; // skip header + separator
      const bodyRows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].split('|').slice(1, -1).map(s => s.trim());
        bodyRows.push(cells);
        i++;
      }
      children.push(tableFromMarkdown(headerCells, bodyRows));
      // Spacer paragraph after the table
      children.push(new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 120 } }));
      continue;
    }

    // Bullet list
    if (/^[-*]\s+/.test(line)) {
      children.push(bullet(line.replace(/^[-*]\s+/, '')));
      i++;
      continue;
    }

    // Paragraph
    children.push(paragraphFromLine(line));
    i++;
  }
  return children;
}

// ── Build the document ──────────────────────────────────────────────────
const md = fs.readFileSync(SRC, 'utf8');
const children = parseMarkdown(md);

const doc = new Document({
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{
        level: 0,
        format: 'bullet',
        text: '•',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 360, hanging: 360 } } },
      }],
    }],
  },
  styles: {
    default: {
      document: {
        run: { font: 'Calibri', size: 22 },
      },
    },
  },
  sections: [{
    properties: { page: { size: { orientation: 'landscape' } } },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log(`Wrote ${OUT} (${(buf.length / 1024).toFixed(1)} KB)`);
});
