/**
 * Build docs/F1A_LISTS_AND_CONNECTIONS_SPEC.docx — product spec for F1a
 * (Lists wired to events). Mirrors the markdown source at
 * docs/F1A_LISTS_AND_CONNECTIONS_SPEC.md.
 *
 * Run: node scripts/build-f1a-spec-docx.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType,
} = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

function p(text, opts = {}) {
  const runs = Array.isArray(text)
    ? text
    : [new TextRun({ text, ...opts })];
  return new Paragraph({
    children: runs,
    spacing: { after: 120 },
  });
}

function pBold(text) {
  return p(text, { bold: true });
}

function bullet(text, opts = {}) {
  const runs = Array.isArray(text)
    ? text
    : [new TextRun({ text, ...opts })];
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: runs,
    spacing: { after: 60 },
  });
}

function numbered(text, opts = {}) {
  const runs = Array.isArray(text)
    ? text
    : [new TextRun({ text, ...opts })];
  return new Paragraph({
    numbering: { reference: 'numbered', level: 0 },
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
    spacing: { before: 200, after: 100 },
  });
}

function title(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
    children: [new TextRun({ text, bold: true, size: 44, color: '1F3A68' })],
  });
}

function subtitle(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 280 },
    children: [new TextRun({ text, italics: true, size: 22, color: '555555' })],
  });
}

function quote(text) {
  return new Table({
    rows: [
      new TableRow({
        children: [new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: 'F5F5F5' },
          margins: { top: 120, bottom: 120, left: 240, right: 240 },
          children: [new Paragraph({
            children: [new TextRun({ text, italics: true })],
          })],
        })],
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function callout(headingText, bodyText) {
  return new Table({
    rows: [
      new TableRow({
        children: [new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: 'EAF2FB' },
          margins: { top: 140, bottom: 140, left: 200, right: 200 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: headingText, bold: true, color: '1565C0' })],
              spacing: { after: 80 },
            }),
            new Paragraph({
              children: [new TextRun({ text: bodyText })],
            }),
          ],
        })],
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ─── Document children ─────────────────────────────────────────────────────

const children = [];

// Title page
children.push(title('F1a — Lists wired to events'));
children.push(subtitle('Product spec — locked 2026-05-09'));
children.push(p([
  new TextRun({ text: 'Author: ', bold: true }),
  new TextRun('Wael (decisions) + collaborator (drafting)'),
]));
children.push(p([
  new TextRun({ text: 'Status: ', bold: true }),
  new TextRun('Spec locked 2026-05-09. Ready for engineering planning.'),
]));
children.push(p([
  new TextRun({ text: 'Source: ', bold: true }),
  new TextRun('Walked through with Wael 2026-05-09 in continuation of the holding-list classification session.'),
]));

// Concept
children.push(h1('Concept'));
children.push(p('Three independent entities, with one relationship type between them:'));
children.push(bullet([
  new TextRun({ text: 'Alert', bold: true }),
  new TextRun(' — an active thing. Triggers something based on a condition (time, location, calendar, email, SMS, WhatsApp, etc.). Created by geofencing, REMEMBER, voice, or direct UI. Already exists in the system.'),
]));
children.push(bullet([
  new TextRun({ text: 'List', bold: true }),
  new TextRun(' — a passive container of items. Independent first-class entity. The user names it ("groceries", "errands", "questions for Mom") and adds items at any time.'),
]));
children.push(bullet([
  new TextRun({ text: 'Other entities Naavi knows about', bold: true }),
  new TextRun(' — calendar events, emails, contacts, documents, reminders, sent messages, knowledge fragments, and lists themselves.'),
]));
children.push(p([
  new TextRun({ text: 'A ', }),
  new TextRun({ text: 'connection', bold: true }),
  new TextRun(' wires a list to any entity. The list provides context for the entity:'),
]));
children.push(bullet('When an alert fires, Naavi can read items from the connected list aloud.'));
children.push(bullet("When a calendar event arrives, Naavi can surface the connected list as the meeting's notes."));
children.push(bullet("When an email arrives, the connected list shows the user's planned response or follow-up items."));
children.push(p('The list itself does nothing on its own — it is just the content. The entity does the triggering.'));

// Cardinality
children.push(h1('Cardinality'));
children.push(pBold('One list to many entities. Each entity to at most one list.'));
children.push(bullet('A single "groceries" list can be connected to your Costco arrival alert AND your Saturday calendar event AND a reminder to text Sarah.'));
children.push(bullet('A single alert or event has at most one list at a time.'));
children.push(bullet("If the user wants two lists' worth of items at one event, they create a third combined list."));
children.push(p([
  new TextRun({ text: 'Why not many-to-many? ', bold: true }),
  new TextRun('The user can always combine. Many-to-many would force Naavi to make editorial decisions at fire time (which list first? merged or separate?) and complicate every voice query. The simpler model gives the user full control.'),
]));

// Voice command vocabulary
children.push(h1('Voice command vocabulary'));
children.push(p('Naavi recognizes natural-language synonyms — the user is never required to memorize a verb.'));
children.push(p([
  new TextRun({ text: 'Connect (any of): ', bold: true }),
  new TextRun({ text: '"Connect / attach / wire / link / use / put / hook / tie / add my X list to my Y."', italics: true }),
]));
children.push(p([
  new TextRun({ text: 'Disconnect (any of): ', bold: true }),
  new TextRun({ text: '"Disconnect / detach / unlink / unwire / take off / remove my X list from my Y."', italics: true }),
]));
children.push(p([
  new TextRun({ text: 'Query connections: ', bold: true }),
  new TextRun({ text: '"Where is my X list connected / used / attached?", "Which alerts use my X list?", "What list is on my Y?", "What\'s connected to my Y?"', italics: true }),
]));
children.push(p([
  new TextRun({ text: 'Query list contents: ', bold: true }),
  new TextRun({ text: '"Read me the items on my X list."', italics: true }),
  new TextRun(' (existing list-read flow)'),
]));
children.push(h2('Disambiguation'));
children.push(bullet([
  new TextRun({ text: '"Add" ', bold: true }),
  new TextRun('is shared between list-item operations and connection operations. Naavi disambiguates from context — "add milk to groceries" (item) vs "add my groceries list to Costco alert" (connection).'),
]));
children.push(bullet([
  new TextRun({ text: '"Remove" ', bold: true }),
  new TextRun('is shared between list-item removal, connection removal, and list deletion. Same context-based disambiguation.'),
]));
children.push(h2('Auto-create on missing list'));
children.push(p([
  new TextRun('When the user says '),
  new TextRun({ text: '"connect my groceries list to my Costco alert"', italics: true }),
  new TextRun(' and no "groceries" list exists, Naavi asks: '),
  new TextRun({ text: '"You don\'t have a groceries list — should I create one?"', italics: true }),
  new TextRun(' Doesn\'t silently create.'),
]));

// Confirmation flow
children.push(h1('Confirmation flow'));
children.push(pBold('Every CRUD operation on lists or connections is confirmed before execution. No silent commits.'));
children.push(p('Standardized confirmation phrase across ALL confirmable actions (DRAFT_MESSAGE, list operations, default fallback):'));
children.push(quote('"Say yes to confirm, no to cancel, or tell me what to change."'));
children.push(p('The user replies with:'));
children.push(bullet([
  new TextRun({ text: 'yes / send / go ahead / ok / sure', bold: true }),
  new TextRun(' → confirm and execute'),
]));
children.push(bullet([
  new TextRun({ text: 'no / cancel / never mind / forget it', bold: true }),
  new TextRun(' → cancel, no action taken'),
]));
children.push(bullet([
  new TextRun({ text: 'anything else', bold: true }),
  new TextRun(' (e.g. "change the destination to my Saturday alert") → free-form edit instruction; Naavi re-drafts and re-asks'),
]));
children.push(h2('Examples'));
children.push(bullet('"Connect groceries to Costco alert" → Naavi: "I\'ll connect your groceries list to your Costco arrival alert. Say yes to confirm, no to cancel, or tell me what to change." → user: "Yes." → Naavi: "Connected."'));
children.push(bullet('"Add milk to groceries" → Naavi: "I\'ll add milk to your groceries list. Say yes to confirm, no to cancel, or tell me what to change." → user: "Yes." → Naavi: "Added."'));
children.push(bullet('"Delete groceries list" → Naavi: "Your groceries list is connected to your Costco alert and Saturday meeting. I\'ll delete the list and remove both connections. Say yes to confirm, no to cancel, or tell me what to change." → user: "Yes." → Naavi: "Deleted."'));
children.push(p('This applies to confirmable actions across the system. The existing voice-confirm framework already has the three-mode classifier (confirm / cancel / edit); the standardization is in the spoken prompts only.'));

// Entity reference resolution
children.push(h1('Entity reference resolution'));
children.push(p('When the user says "my Costco alert" or "my Tuesday meeting" or "Bob\'s email", Naavi searches across all entity types to find a match.'));
children.push(bullet([
  new TextRun({ text: 'Single match', bold: true }),
  new TextRun(' → confirm-and-execute via the standard confirmation flow.'),
]));
children.push(bullet([
  new TextRun({ text: 'Multiple matches', bold: true }),
  new TextRun(' → Naavi asks for clarification: "I see two Costcos: your Costco arrival alert and Saturday\'s calendar event. Which one do you mean?" — numbered list per CLAUDE.md Rule 13.'),
]));
children.push(bullet([
  new TextRun({ text: 'No match', bold: true }),
  new TextRun(' → "I don\'t have anything called Costco. Did you mean…?"'),
]));
children.push(p('User can also be explicit ("my Costco alert") which narrows the search to one entity type.'));

// Cascade behavior
children.push(h1('Cascade behavior'));
children.push(pBold('When an entity is deleted (e.g., user deletes a Costco alert):'));
children.push(bullet('The connection between that entity and its list is removed silently.'));
children.push(bullet('The list itself stays intact and remains connected to any other entities.'));
children.push(bullet('The list shows up in the Lists view as a standalone list (or still wired elsewhere if applicable).'));
children.push(pBold('When a list is deleted:'));
children.push(bullet('Naavi warns first, listing every entity the list is connected to.'));
children.push(bullet('The user explicitly confirms.'));
children.push(bullet('After confirmation: list and all its connections are removed. Each entity stays intact (just without its list).'));
children.push(p('The asymmetry is intentional: deleting an entity is a single-wire severing; deleting a list is a multi-wire destructive action that the user should see the full impact of first.'));

// Migration plan
children.push(h1('Migration plan (one-time, at F1a deploy)'));
children.push(p('Existing alerts today carry list context two ways:'));
children.push(numbered([
  new TextRun({ text: 'tasks[]', bold: true }),
  new TextRun(' array — inline items set at alert creation time.'),
]));
children.push(numbered([
  new TextRun({ text: 'list_name', bold: true }),
  new TextRun(' — a string referencing a shared list by name.'),
]));
children.push(p('At F1a deploy time, a one-shot migration converts all existing alerts to the new model:'));
children.push(bullet('tasks[] → create a new List named after the alert (e.g., alert "Costco arrival" → list "Costco arrival"). Add the alert\'s items to the list. Create a connection row from the new list to the alert.'));
children.push(bullet('list_name → resolve to the existing list by name. Create a connection row from that list to the alert.'));
children.push(bullet('After all alerts are migrated, the tasks[] and list_name columns are dropped from the schema.'));
children.push(bullet('Duplicate list names (if migrating two alerts both named "Costco") → append " (1)", " (2)" to disambiguate.'));
children.push(p('After migration, every alert uses the new model uniformly. The user immediately benefits from the new query capability ("where is my Costco list connected?") for ALL their alerts.'));

// Mobile UI
children.push(h1('Mobile UI'));
children.push(h2('New top-level entry in the 3-dots menu'));
children.push(p('Today the menu has Alerts and Notes (each with subcategories). F1a adds Lists as a sibling, with subcategories:'));
children.push(bullet([
  new TextRun({ text: 'All lists', bold: true }),
  new TextRun(' (default) — every list with item count + connection count.'),
]));
children.push(bullet([
  new TextRun({ text: 'Connected', bold: true }),
  new TextRun(' — only lists currently wired to alerts/events.'),
]));
children.push(bullet([
  new TextRun({ text: 'Standalone', bold: true }),
  new TextRun(' — lists not wired anywhere (drafts, archived, recently disconnected).'),
]));
children.push(p('Lists is a first-class top-level concept, separate from Notes.'));

children.push(h2('Alert detail card'));
children.push(p('When viewing the Costco alert:'));
children.push(bullet('Below the alert title and trigger info: "List: errands (5 items)" with a chevron tap target.'));
children.push(bullet('Tap → opens the connected list in the existing list-detail view (same edit surface as standalone lists).'));
children.push(bullet([
  new TextRun({ text: 'Explicit delete-connection control', bold: true }),
  new TextRun(' — an "X" or trash icon next to the list line. Tap prompts: "Disconnect \'errands\' from this alert? Say yes to confirm, no to cancel, or tell me what to change." — removes the connection only, list itself stays.'),
]));

children.push(h2('List detail (in the new Lists section)'));
children.push(p('When viewing the errands list:'));
children.push(bullet('At the top: "Connected to: Costco alert · Saturday meeting" — each is tap-to-navigate to that entity\'s detail.'));
children.push(bullet('If the list has many connections, collapse: "Connected to 7 events — tap to see all."'));
children.push(bullet('Below: the list items themselves, with the existing edit affordances (add, remove, reorder).'));

children.push(h2('List operations from voice'));
children.push(p('All voice commands (connect, disconnect, add item, remove item, delete list, query connections) work identically on PC (phone calls) and MV (mobile chat).'));

// Engineering scope
children.push(h1('Engineering scope'));
children.push(p('Roughly 1.5–2 focused sessions to ship.'));
children.push(h2('Server-side (no AAB needed)'));
children.push(numbered('SQL migration: list_connections table + indexes + RLS policies.'));
children.push(numbered('One-shot data migration: convert existing tasks[] and list_name references into the new model. Drop the old columns.'));
children.push(numbered('New Edge Function manage-list-connections (or extend manage-list) with CRUD operations: connect, disconnect, query-connections.'));
children.push(numbered('New Anthropic tool definitions for the connection operations.'));
children.push(numbered('Voice + mobile prompt rules in get-naavi-prompt: how to recognize the natural-language phrasings, the auto-create-on-missing flow, the disambiguation behavior, and the standardized three-option confirmation phrase.'));
children.push(numbered('Update voice-confirm SPEECH constants to use the new three-option phrase across all confirmable actions.'));
children.push(h2('Mobile (AAB required)'));
children.push(numbered('New Lists screen in the 3-dots menu (with the three subcategories).'));
children.push(numbered('List-detail screen showing connections + item editing.'));
children.push(numbered('Alert-detail card update: connected-list line + delete-connection control.'));
children.push(h2('Testing'));
children.push(numbered('Auto-tester additions per Rule 15:'));
children.push(bullet('Prompt-regression tests for new voice command patterns.'));
children.push(bullet('Data-integrity tests for the UNIQUE constraint on (entity_type, entity_id).'));
children.push(bullet('Multi-user matrix tests for cross-tenant isolation.'));

// Future considerations
children.push(h1('Future considerations (not in F1a v1)'));
children.push(bullet([
  new TextRun({ text: 'Many-to-many cardinality. ', bold: true }),
  new TextRun('If usage shows users genuinely need two parallel lists per entity (and combining feels wrong), reconsider. Schema migration is cheap if the UNIQUE is dropped.'),
]));
children.push(bullet([
  new TextRun({ text: 'Per-event filtering of a shared list. ', bold: true }),
  new TextRun('If users want the same list to show different items per context (e.g., "groceries for Costco" vs "groceries for the corner store" using the same backing list), that\'s a tags-on-items + filter-at-fire-time enhancement.'),
]));
children.push(bullet([
  new TextRun({ text: 'Cross-user shared lists. ', bold: true }),
  new TextRun('All lists are currently per-user. Sharing across users (e.g., a household "groceries" list shared between two MyNaavi users) is out of scope.'),
]));
children.push(bullet([
  new TextRun({ text: 'List templates. ', bold: true }),
  new TextRun('Pre-built list templates ("travel checklist", "doctor visit prep") that users can instantiate. Out of scope.'),
]));

// Closing
children.push(h1('Open work'));
children.push(p('None at the spec level. Spec is locked.'));
children.push(p('Build can begin in a future focused session. The engineering scope section above is the launch checklist.'));

// ─── Document assembly ─────────────────────────────────────────────────────

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22 } },
    },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        run: { font: 'Calibri', size: 30, bold: true, color: '1F3A68' },
        paragraph: { spacing: { before: 280, after: 140 } },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        run: { font: 'Calibri', size: 26, bold: true, color: '1F3A68' },
        paragraph: { spacing: { before: 200, after: 100 } },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 260 } } },
        }],
      },
      {
        reference: 'numbered',
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 260 } } },
        }],
      },
    ],
  },
  sections: [{ properties: {}, children }],
});

const out = path.resolve(__dirname, '..', 'docs', 'F1A_LISTS_AND_CONNECTIONS_SPEC.docx');
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(out, buffer);
  console.log(`Wrote ${out} (${buffer.length} bytes)`);
});
