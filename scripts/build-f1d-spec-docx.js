/**
 * Build docs/F1D_USER_CONTROLLED_MUTE_SPEC.docx — product spec for F1d
 * (User-controlled mute on PC + Mobile). Mirrors the markdown source
 * at docs/F1D_USER_CONTROLLED_MUTE_SPEC.md.
 *
 * F1d replaces F1c (auto-classification privacy bundle) — closed
 * 2026-05-09 because auto-classification creates an unfixable social
 * false-positive cost.
 *
 * Run: node scripts/build-f1d-spec-docx.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType,
} = require('docx');

function p(text, opts = {}) {
  const runs = Array.isArray(text)
    ? text
    : [new TextRun({ text, ...opts })];
  return new Paragraph({
    children: runs,
    spacing: { after: 120 },
  });
}

function pBold(text) { return p(text, { bold: true }); }

function bullet(text) {
  const runs = Array.isArray(text) ? text : [new TextRun(text)];
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: runs,
    spacing: { after: 60 },
  });
}

function numbered(text) {
  const runs = Array.isArray(text) ? text : [new TextRun(text)];
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
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: 100, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, fill: 'F5F5F5' },
        margins: { top: 120, bottom: 120, left: 240, right: 240 },
        children: [new Paragraph({ children: [new TextRun({ text, italics: true })] })],
      })],
    })],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ─── Document children ─────────────────────────────────────────────────────

const children = [];

// Title page
children.push(title('F1d — User-controlled mute'));
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
  new TextRun({ text: 'Replaces: ', bold: true }),
  new TextRun('F1c (auto-classification privacy bundle) — closed 2026-05-09 because auto-classification creates an unfixable social false-positive cost (forcing Robert to publicly engage in privacy dialogue itself reveals he has something to hide).'),
]));

// The problem
children.push(h1('The problem'));
children.push(p('Robert uses Naavi in taxis, waiting rooms, cafés, family dinners — not just at home. When Naavi reads results aloud, biopsy follow-ups, bank balances, and lawyer notices get broadcast to whoever is nearby. This is the single biggest UX gap in the voice-call experience for the older healthy independent adult persona.'));
children.push(p('The 2026-04 plan (F1c) tried to solve this by auto-classifying items as "private" (medical / financial / legal) and offering an SMS alternative at read time. That approach was rejected 2026-05-09 because:'));
children.push(bullet([
  new TextRun({ text: 'The privacy dialogue itself reveals secrets. ', bold: true }),
  new TextRun('Naavi asking "this looks private — want me to text it?" in a taxi tells the driver Robert has something to hide.'),
]));
children.push(bullet([
  new TextRun({ text: 'False positives compound the cost. ', bold: true }),
  new TextRun('A pharmacy newsletter wrongly tagged "medical" forces Robert into the dialogue for nothing.'),
]));
children.push(bullet([
  new TextRun({ text: "Robert can't gracefully recover from misclassification. ", bold: true }),
  new TextRun('He has to say "no, just read it" publicly, opting into less privacy in front of strangers.'),
]));
children.push(p([
  new TextRun({ text: 'F1d takes the opposite approach: ', bold: true }),
  new TextRun('Robert controls the mute himself, in the moment. No classification, no false positives, no public dialogue.'),
]));

// End-state behavior
children.push(h1('End-state behavior'));
children.push(h2('Phone (PC)'));
children.push(p('Robert in a taxi listening to Naavi read his calendar:'));
children.push(quote('Naavi: "You have lunch with Bob at noon, then your follow-up appointment at—"\nRobert: "No sound"\nNaavi: (audio stops immediately) "Want me to text the rest to your phone?"\nRobert: "Yes"\nNaavi: (silently sends SMS or email with the full list) "Sent."\n— OR —\nRobert: "No" (or stays silent for ~3 seconds)\nNaavi: (moves on; the response content is discarded)'));

children.push(h2('Mobile (MV)'));
children.push(p('Robert at a family dinner, listening to Naavi via the mobile app:'));
children.push(quote('Naavi: (reading aloud)\nRobert: (long-presses anywhere on the chat screen)\nNaavi: (audio stops; the chat bubble remains visible for Robert to read silently)'));
children.push(p('No SMS-the-rest follow-up on mobile — the chat bubble already shows the text. Robert can read it on the screen if he wants.'));

// PC mute vocabulary
children.push(h1('PC mute vocabulary'));
children.push(p('Two distinct buckets — same spoken syntax, different code paths and different intents.'));
children.push(h2('Existing kill-response (unchanged from today)'));
children.push(p([
  new TextRun({ text: 'Words: ', bold: true }),
  new TextRun({ text: '"stop", "enough", "got it", "ok", "okay", "thanks", "thank you", "next", "that\'s enough", "i got it"', italics: true }),
]));
children.push(p('Naavi stops talking, response is discarded entirely. Robert is satisfied; no SMS offered.'));

children.push(h2('New privacy-mute (F1d)'));
children.push(p([
  new TextRun({ text: 'Words: ', bold: true }),
  new TextRun({ text: '"no sound", "quiet", "shh"', italics: true }),
]));
children.push(p([
  new TextRun('Naavi drains the Twilio audio queue immediately, '),
  new TextRun({ text: 'preserves the full response text in memory', bold: true }),
  new TextRun(', and offers "Want me to text the rest to your phone?" Robert says yes → SMS or email is sent. Robert says no or stays silent → response is discarded.'),
]));
children.push(p([
  new TextRun({ text: 'Note: ', bold: true }),
  new TextRun('"stop" deliberately stays in the kill-response bucket for backwards compatibility. Robert who wants the privacy-mute behavior says "no sound" / "quiet" / "shh" explicitly.'),
]));

// Mobile mute mechanics
children.push(h1('Mobile mute mechanics'));
children.push(p('Mobile already supports the necessary primitives:'));
children.push(bullet('The existing orange stop button (app/index.tsx:2050) calls stopSpeaking() (hooks/useOrchestrator.ts:2766) which halts audio without clearing the chat bubble.'));
children.push(bullet([
  new TextRun({ text: 'F1d adds long-press anywhere on the chat screen as an additional mute trigger', bold: true }),
  new TextRun(' during TTS playback.'),
]));
children.push(p([
  new TextRun({ text: 'State-based dispatch in onChatLongPress: ', bold: true }),
]));
children.push(bullet('If isAudioPlaying is true → call stopSpeaking() (mute).'));
children.push(bullet('Otherwise → existing hands-free entry behavior (talk button activation).'));
children.push(p('The two functions are mutually exclusive (Naavi is either speaking or idle), so the same gesture serves both purposes without ambiguity.'));
children.push(p([
  new TextRun({ text: 'No SMS-the-rest follow-up on mobile. ', bold: true }),
  new TextRun('The chat bubble shows the text; Robert can read it silently. Adding SMS would be redundant.'),
]));

// PC mute behavior detail
children.push(h1('PC mute behavior detail'));
children.push(p('When Robert says one of the privacy-mute words during TTS:'));
children.push(numbered([
  new TextRun({ text: 'Drain the Twilio outbound audio queue immediately', bold: true }),
  new TextRun(" (same event:'clear' mechanism shipped 2026-05-09 for music-queue latency). Audio stops within 100 ms."),
]));
children.push(numbered([
  new TextRun({ text: 'Preserve the full response text in memory', bold: true }),
  new TextRun(" for this turn (the server already has the complete text before TTS starts; F1d just doesn't discard it on mute)."),
]));
children.push(numbered([
  new TextRun({ text: 'Naavi asks (binary phrase): ', bold: true }),
  new TextRun({ text: '"Want me to text the rest to your phone?"', italics: true }),
]));
children.push(numbered([
  new TextRun({ text: "Robert's reply", bold: true }),
  new TextRun(' is classified using the existing yes/no/edit classifier from the voice-confirm framework:'),
]));
children.push(bullet([
  new TextRun({ text: '"yes / send / go ahead / ok"', italics: true }),
  new TextRun(' → confirm and deliver content.'),
]));
children.push(bullet([
  new TextRun({ text: '"no / cancel / never mind"', italics: true }),
  new TextRun(' → response is discarded; Naavi moves on.'),
]));
children.push(bullet([
  new TextRun({ text: 'Silence for 30 seconds', bold: true }),
  new TextRun(' (matches existing CONFIRM_TIMEOUT_MS in lib/voice-confirm.ts) → treated as cancel; response is discarded. Same UX as DRAFT_MESSAGE confirmation.'),
]));
children.push(p([
  new TextRun({ text: 'Note: simpler binary phrase', bold: true }),
  new TextRun(', not the standardized "yes to confirm, no to cancel, or tell me what to change" used elsewhere. Reason: the "change" option doesn\'t fit naturally for SMS-the-rest (mostly binary). The yes/no classifier handles edge phrases under the hood.'),
]));

// Content delivery
children.push(h1('Content delivery — always email + SMS hot link'));
children.push(p('Every reply uses the same delivery path regardless of length: email with full content + SMS notification with a hot link.'));
children.push(bullet([
  new TextRun({ text: 'Email', bold: true }),
  new TextRun(' carries the full response content. Subject: "MyNaavi: re: <your question>" (e.g., "MyNaavi: re: did I get any new emails about football?"). Body: brief friendly header ("You asked about <question>. Here\'s what I found:") + the response text. Plain text, readable formatting.'),
]));
children.push(bullet([
  new TextRun({ text: 'SMS', bold: true }),
  new TextRun(' contains a brief notification: "MyNaavi sent you a reply — tap to read: <link>" — the link is a '),
  new TextRun({ text: 'plain HTTPS URL', bold: true }),
  new TextRun(' (https://mynaavi.com/r/<token>) that opens a hosted web page rendering the email content. Universal — works on any device with a browser; no app required.'),
]));
children.push(bullet([
  new TextRun({ text: 'Token security: ', bold: true }),
  new TextRun('plain unauthenticated token. Anyone with the link can read the content. Trade-off accepted: phone hijack / shared device = potential leak; security-vs-friction tilted toward friction-free reading.'),
]));

children.push(h2('Recursive mute (mute during the offer)'));
children.push(p('If Robert says "no sound" / "quiet" / "shh" DURING Naavi\'s "Want me to text the rest?" offer itself:'));
children.push(bullet('The offer\'s audio is drained (Naavi stops mid-question).'));
children.push(bullet([
  new TextRun({ text: 'The offer stays pending', bold: true }),
  new TextRun(' — Robert can still reply "yes" or "no" within the 30-second window.'),
]));
children.push(bullet('The recursive mute does NOT cancel the underlying offer or discard the response.'));

children.push(h2('Fallbacks'));
children.push(bullet('If Robert has no email configured (rare), fall back to SMS-only with multi-segment delivery (Twilio handles fragmentation automatically).'));
children.push(bullet('If Robert has no phone configured, fall back to email-only and Naavi says "I emailed it to you." — no SMS sent.'));
children.push(bullet('If Robert has neither, Naavi says "OK, stopping. I don\'t have a way to send the rest right now." and discards the response.'));

// Recovery
children.push(h1('Recovery'));
children.push(p([
  new TextRun('After mute, the muted response '),
  new TextRun({ text: 'is not stored', bold: true }),
  new TextRun(' in any session memory. If Robert later asks "what was that you were saying?", Naavi treats it as a fresh question:'),
]));
children.push(bullet('Server re-runs the underlying search / LLM call from scratch.'));
children.push(bullet('The new response may differ slightly from the muted one (different LLM sampling, slightly different timing for live data, etc.).'));
children.push(bullet("This is acceptable: F1d's promise is privacy in the moment, not perfect-recall replay."));
children.push(p([
  new TextRun('The SMS or email Robert received via the SMS-the-rest path is the '),
  new TextRun({ text: 'only', bold: true }),
  new TextRun(' way to retrieve the original muted content verbatim.'),
]));

// Edge cases
children.push(h1('Edge cases (defaults)'));
children.push(bullet([
  new TextRun({ text: 'Mute when no SMS phone configured: ', bold: true }),
  new TextRun('fall back to email-only with notification "I emailed it to you."'),
]));
children.push(bullet([
  new TextRun({ text: 'Mute when no email configured either: ', bold: true }),
  new TextRun('Naavi acknowledges the mute but cannot offer follow-up: "OK, stopping. I don\'t have a way to send the rest right now." Response is discarded.'),
]));
children.push(bullet([
  new TextRun({ text: 'Mute during DRAFT_MESSAGE confirmation prompt: ', bold: true }),
  new TextRun('mute cancels the confirmation prompt; the draft stays available. Robert can confirm later ("send it") without re-drafting.'),
]));
children.push(bullet([
  new TextRun({ text: 'Mute during the initial greeting: ', bold: true }),
  new TextRun("greeting is silenced; no SMS-the-rest offer (greeting isn't sensitive content)."),
]));
children.push(bullet([
  new TextRun({ text: 'Multiple consecutive mutes in one call: ', bold: true }),
  new TextRun('each works independently. No special accumulation behavior; the response from each muted turn is independently offered for SMS-the-rest.'),
]));
children.push(bullet([
  new TextRun({ text: 'Mute mid-list (Naavi reading 5 calendar events, Robert mutes after item 3): ', bold: true }),
  new TextRun('Email contains the FULL list (items 1–5), not just items 4+. The point is private delivery of the content, not partial replay of where Robert muted.'),
]));
children.push(bullet([
  new TextRun({ text: 'Recursive mute (mute during the offer itself): ', bold: true }),
  new TextRun('Naavi\'s "Want me to text the rest?" audio drains; the offer stays pending. Robert can still reply yes/no within the 30-second window.'),
]));
children.push(bullet([
  new TextRun({ text: 'Robert silent for 30 seconds after the offer: ', bold: true }),
  new TextRun('Treated as cancel (matches existing CONFIRM_TIMEOUT_MS). Response discarded.'),
]));

// Engineering scope
children.push(h1('Engineering scope'));
children.push(p('Roughly 0.5–1 session to ship. Server-only on PC (no AAB needed); mobile already has the primitives.'));
children.push(h2('Server-side (no AAB needed)'));
children.push(numbered('Add new privacy-mute words to the voice-server stop-handler. Add a separate match for "no sound" / "quiet" / "shh" parallel to the existing kill-response matcher.'));
children.push(numbered('Preserve pendingText on privacy-mute instead of clearing it. The drain (event:\'clear\' on Twilio) handles audio silencing; the response text stays in memory for this turn.'));
children.push(numbered('Inject the SMS-the-rest follow-up as Naavi\'s next utterance: "Want me to text the rest to your phone?" (binary phrase, not the standardized three-option). Use the existing yes/no/edit classifier from lib/voice-confirm.ts.'));
children.push(numbered('On confirm: always email + SMS hot link. Generate a token, store the response content in a hosted-link backend keyed by the token (TTL: 30 days). Send email via existing send-email Edge Function (subject: "MyNaavi: re: <question>", body: framed header + response text). Send SMS via existing send-sms Edge Function with the notification + https://mynaavi.com/r/<token> link.'));
children.push(numbered('New web endpoint at mynaavi.com/r/<token> to render the stored content as a hosted page (plain HTML, no auth, token-only access).'));
children.push(numbered('Voice prompt update in get-naavi-prompt: teach Claude the new mute vocabulary and the SMS-the-rest interaction pattern.'));
children.push(numbered('Recursive-mute handling: when Robert says a privacy-mute word during the SMS-the-rest offer, drain Naavi\'s offer audio but DON\'T cancel the pending offer state; keep the 30-second window alive.'));
children.push(h2('Mobile (no AAB needed for v1; only if adding SMS-the-rest later)'));
children.push(numbered('Update onChatLongPress handler (app/index.tsx) to call stopSpeaking() when isAudioPlaying is true; existing hands-free behavior otherwise.'));
children.push(h2('Testing'));
children.push(numbered('Auto-tester additions:'));
children.push(bullet('Voice prompt regression tests for the new mute vocabulary.'));
children.push(bullet('Smoke test that audio drain happens within 200 ms of mute word detection.'));
children.push(bullet("Multi-user matrix test: mute on one user's call doesn't affect another."));

// Future considerations
children.push(h1('Future considerations (not in F1d v1)'));
children.push(bullet([
  new TextRun({ text: 'Content summarization on long replies. ', bold: true }),
  new TextRun('If users find the SMS hot link friction-y, a v2 could include a one-line summary in the SMS body alongside the link.'),
]));
children.push(bullet([
  new TextRun({ text: 'Per-user mute vocabulary. ', bold: true }),
  new TextRun('Some users might prefer different stop words ("hush" / "silence Naavi"). Add custom vocabulary to user_settings if requests come up.'),
]));
children.push(bullet([
  new TextRun({ text: 'Auto-pause on detected ambient noise. ', bold: true }),
  new TextRun('If a third voice or carrier hand-off (call going on speaker) is detected, Naavi could pause and ask. Out of scope; signal extraction is hard.'),
]));
children.push(bullet([
  new TextRun({ text: 'Privacy mode persistent setting. ', bold: true }),
  new TextRun('Some users might want "always private — never read sensitive things aloud, just text everything." Could add as an opt-in setting later. v1 keeps it purely reactive.'),
]));

// Closing
children.push(h1('Open work'));
children.push(p('None at the spec level. Spec is locked.'));
children.push(p('Build can begin in any future focused session. The engineering scope section above is the launch checklist.'));

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

const out = path.resolve(__dirname, '..', 'docs', 'F1D_USER_CONTROLLED_MUTE_SPEC.docx');
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(out, buffer);
  console.log(`Wrote ${out} (${buffer.length} bytes)`);
});
