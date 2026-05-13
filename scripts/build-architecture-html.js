/**
 * Build docs/ARCHITECTURE_2026-05-13.html from the matching markdown.
 *
 * Output is a single self-contained HTML file with:
 *   - Markdown rendered to HTML server-side (via `marked`)
 *   - Mermaid blocks preserved as <pre class="mermaid"> so client-side
 *     mermaid.js can paint them as SVG
 *   - GitHub-ish styling (dark headings, monospace code blocks,
 *     bordered tables, blockquote accent bar)
 *   - Mermaid.js loaded from cdn.jsdelivr.net (browser caches after
 *     first load — works offline thereafter)
 *
 * Run:   node scripts/build-architecture-html.js
 * Deps:  marked (installed via `npm install --no-save marked@12`).
 *
 * Open the output by double-clicking docs/ARCHITECTURE_2026-05-13.html —
 * any modern browser will render the diagrams. The file is portable;
 * email it, print to PDF from the browser, or commit it (HTML isn't
 * gitignored in this repo).
 */

const fs   = require('fs');
const path = require('path');
const { marked, Renderer } = require('marked');

const MD_PATH  = path.join(__dirname, '..', 'docs', 'ARCHITECTURE_2026-05-13.md');
const OUT_PATH = path.join(__dirname, '..', 'docs', 'ARCHITECTURE_2026-05-13.html');

// Custom code-block renderer — preserve mermaid blocks for client-side
// rendering by mermaid.js, escape everything else as <pre><code>.
const renderer = new Renderer();
const originalCode = renderer.code.bind(renderer);
renderer.code = (codeArg) => {
  // marked v12 passes { text, lang, escaped } object; older versions
  // pass (text, lang, escaped) — handle both.
  const text = typeof codeArg === 'object' ? codeArg.text : codeArg;
  const lang = typeof codeArg === 'object' ? codeArg.lang : arguments[1];
  if (lang === 'mermaid') {
    return `<pre class="mermaid">${text}</pre>\n`;
  }
  return originalCode(codeArg);
};

marked.use({ renderer });

const md         = fs.readFileSync(MD_PATH, 'utf8');
const bodyHtml   = marked.parse(md);
const buildTime  = new Date().toISOString();

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MyNaavi — Architecture &amp; Wiring (V57.15.0)</title>
<style>
  :root {
    --fg:           #1f2328;
    --fg-muted:     #57606a;
    --bg:           #ffffff;
    --bg-soft:      #f6f8fa;
    --accent:       #1F3A68;
    --accent-2:     #5DCAA5;
    --border:       #d0d7de;
    --code-bg:      #f4f4f4;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    line-height: 1.55;
    font-size: 16px;
  }
  main {
    max-width: 980px;
    margin: 2.5rem auto;
    padding: 0 2rem 4rem;
  }
  h1, h2, h3, h4, h5, h6 {
    color: var(--accent);
    margin-top: 1.8em;
    margin-bottom: 0.6em;
    line-height: 1.25;
  }
  h1 {
    border-bottom: 2px solid var(--border);
    padding-bottom: 0.3em;
    font-size: 2em;
  }
  h2 {
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.3em;
    font-size: 1.5em;
  }
  h3 { font-size: 1.25em; }
  h4 { font-size: 1.05em; color: #4A6B96; }
  p, ul, ol { margin: 0.6em 0; }
  ul, ol { padding-left: 1.6em; }
  li { margin: 0.2em 0; }
  a { color: #0969da; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    background: var(--code-bg);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 0.88em;
  }
  pre {
    background: var(--code-bg);
    padding: 1em 1.2em;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.85em;
    line-height: 1.45;
    margin: 1em 0;
  }
  pre code { background: none; padding: 0; font-size: inherit; }
  pre.mermaid {
    background: var(--bg-soft);
    border: 1px solid var(--border);
    text-align: center;
    padding: 1.4em;
    overflow: visible;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 1.2em 0;
    font-size: 0.95em;
  }
  th, td {
    border: 1px solid var(--border);
    padding: 0.5em 0.8em;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: var(--bg-soft);
    font-weight: 600;
  }
  tr:nth-child(2n) td { background: #fafbfc; }
  blockquote {
    border-left: 4px solid var(--accent-2);
    padding: 0.4em 1em;
    color: var(--fg-muted);
    margin: 1em 0;
    background: var(--bg-soft);
  }
  hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 2em 0;
  }
  .build-info {
    color: var(--fg-muted);
    font-size: 0.85em;
    text-align: right;
    margin-top: 3em;
    border-top: 1px solid var(--border);
    padding-top: 1em;
  }
  /* Mermaid SVG sizing */
  pre.mermaid svg { max-width: 100%; height: auto; }
</style>
</head>
<body>
<main>
${bodyHtml}
<div class="build-info">Generated locally from ARCHITECTURE_2026-05-13.md · ${buildTime}</div>
</main>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
  mermaid.initialize({
    startOnLoad: true,
    theme: 'default',
    securityLevel: 'loose',
    flowchart: { useMaxWidth: true, htmlLabels: true },
    sequence: { useMaxWidth: true, mirrorActors: false },
  });
</script>
</body>
</html>
`;

fs.writeFileSync(OUT_PATH, html);
console.log(`Wrote ${OUT_PATH} (${html.length.toLocaleString()} bytes)`);
