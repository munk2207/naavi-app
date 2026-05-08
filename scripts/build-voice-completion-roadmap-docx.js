/**
 * Build docs/VOICE_COMPLETION_ROADMAP_2026-05-04.docx — voice-first plan
 * to bring the phone (Twilio voice) surface from "works most of the time"
 * to "trustworthy daily driver" — sequenced session-by-session.
 *
 * Run: node scripts/build-voice-completion-roadmap-docx.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageBreak,
} = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 120 },
  });
}

function pRich(runs) {
  return new Paragraph({ children: runs, spacing: { after: 120 } });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun(text)],
  });
}

function bulletRich(runs) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: runs,
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
    spacing: { before: 220, after: 110 },
  });
}

function title(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 120 },
    children: [new TextRun({ text, bold: true, size: 40, color: '1F3A68' })],
  });
}

function subtitle(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 360 },
    children: [new TextRun({ text, italics: true, size: 24, color: '555555' })],
  });
}

function dod(text) {
  return new Paragraph({
    spacing: { before: 80, after: 200 },
    indent: { left: 360 },
    children: [
      new TextRun({ text: 'Done when: ', bold: true, color: '2E5599' }),
      new TextRun(text),
    ],
  });
}

function sessionHeader(num, label, scope) {
  // Dark blue header bar with session number + label + scope tag (AAB / Server-only / etc.)
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1100, 6660, 1600],
    rows: [new TableRow({
      children: [
        new TableCell({
          borders,
          width: { size: 1100, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: '1F3A68' },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `S${num}`, bold: true, color: 'FFFFFF', size: 24 })],
          })],
        }),
        new TableCell({
          borders,
          width: { size: 6660, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: '1F3A68' },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: label, bold: true, color: 'FFFFFF', size: 24 })],
          })],
        }),
        new TableCell({
          borders,
          width: { size: 1600, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: scope.includes('AAB') ? 'B71C1C' : '2E7D32' },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: scope, bold: true, color: 'FFFFFF', size: 18 })],
          })],
        }),
      ],
    })],
  });
}

const children = [];

children.push(title('MyNaavi — Voice Completion Roadmap'));
children.push(subtitle('2026-05-04 — Voice-first plan to reach "trustworthy daily driver"'));

// ────────────────────────────────────────────────────────────────
children.push(h1('Why This Document Exists'));
children.push(p(
  'Voice is the competitive moat. There is no other AI assistant that an active senior can call on the phone to manage their daily life — calendar, email, contacts, alerts, memory — with persistent state. Mobile is the configuration and visual-confirm surface; voice is the daily driver.'
));
children.push(p(
  'The earlier Mobile vs Phone Parity Audit (2026-05-04) is reference material — it shows where the surfaces drift apart. This document is the plan: what voice still needs to feel finished, in the order the work should happen.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('Definition: Semi-Complete Voice'));
children.push(p('Voice is "semi-complete" when a daily user does not wish they could open the app instead. That requires:'));
children.push(bulletRich([
  new TextRun({ text: 'Trustworthy: ', bold: true }),
  new TextRun('"my next meeting" is actually next; alerts fire on time; addresses read correctly.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Complete actions: ', bold: true }),
  new TextRun('every action a user might reach for in a normal day is reachable by voice, not just by app.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Recognizes the user: ', bold: true }),
  new TextRun('the right person is identified on every call without typing a PIN.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Listens and stops: ', bold: true }),
  new TextRun('"Naavi stop" interrupts; first word is never dropped; barge-in works.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Speaks naturally: ', bold: true }),
  new TextRun('numbers, dates, postal codes, addresses, names — all sound like a person, not a machine.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Sounds the same as mobile: ', bold: true }),
  new TextRun('one voice across both surfaces so familiarity carries.'),
]));

// ────────────────────────────────────────────────────────────────
children.push(h1('Session-By-Session Plan'));
children.push(p(
  'Six focused sessions move voice from where it is today to semi-complete. Sessions can run sequentially; some have external dependencies (noted) and may need to wait. Session order reflects user impact, not difficulty.'
));

// SESSION 1 ────────────────────────────────────────────────────
children.push(sessionHeader(1, 'Voice Quality Foundation', 'Server-only'));
children.push(p('Fix the things that make the user lose trust mid-conversation. Nothing else matters until these are clean.'));
children.push(bulletRich([
  new TextRun({ text: 'Live Google Calendar fetch on voice — ', bold: true }),
  new TextRun('mirror the mobile fix from this session (naavi-chat:397–479). Voice currently reads a stale Supabase snapshot, which is why "next meeting" can be a past event.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Stop-word interrupt — ', bold: true }),
  new TextRun('"Naavi stop" must cut TTS instantly. It currently gets recorded as the next question (memory: project_naavi_stop_word_regression).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Deepgram first-word truncation during barge-in — ', bold: true }),
  new TextRun('"What time is it?" arrives as "Time is it?" and breaks the fast-path regex (memory: project_naavi_deepgram_first_word_truncation). Investigate Deepgram config or pre-buffer.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice name-search — ', bold: true }),
  new TextRun('Deepgram mistranscribes "Hussein" and similar names; mobile text handles them fine. Add phonetic fallback or alias matching server-side.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice latency baseline — ', bold: true }),
  new TextRun('measure today\'s round-trip on trivial questions. Identify the dominant component (STT, Claude, TTS, network). Cut the largest one.'),
]));
children.push(dod('A 5-minute call covering "next meeting", "stop", a name lookup, and a "what time is it?" query has zero stale answers, zero dropped first words, and stops on command.'));

// SESSION 2 ────────────────────────────────────────────────────
children.push(sessionHeader(2, 'Voice Action Parity', 'Server-only'));
children.push(p('Add the four actions the voice surface is missing today. Mobile already has them — voice just needs them wired into naavi-chat or get-naavi-prompt.'));
children.push(bulletRich([
  new TextRun({ text: 'DELETE_EVENT on voice — ', bold: true }),
  new TextRun('"cancel my 3pm" should remove the calendar event. Mirror mobile\'s implementation (line 1206) into the shared prompt and chat handler.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'LIST_RULES on voice — ', bold: true }),
  new TextRun('"what alerts do I have?" should read them back. Mobile has this (line 1349); voice does not.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'DELETE_MEMORY on voice — ', bold: true }),
  new TextRun('"forget that I take Lipitor" should remove the knowledge fragment. Mobile has this (line 1341); voice does not.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'SCHEDULE_MEDICATION on voice — ', bold: true }),
  new TextRun('"remind me to take my morning pills at 8" should create a recurring reminder. Mobile has this (line 1218); voice does not.'),
]));
children.push(dod('On a single phone call, the user can list alerts, delete an event, forget a memory, and schedule a medication — and each one fires the same Edge Function the mobile app does.'));

// SESSION 3 ────────────────────────────────────────────────────
children.push(sessionHeader(3, 'Voice Identity — Multi-Phone Fast Path', 'AAB'));
children.push(p('Today, only one phone number per user is recognized. Anyone calling from a second device (work phone, spouse\'s phone) is rejected with confusing wording. Fix both.'));
children.push(bulletRich([
  new TextRun({ text: 'Add additional_phones[] to user_settings — ', bold: true }),
  new TextRun('schema change. Caller-ID lookup matches user_settings.phone OR any entry in additional_phones[].'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Mobile UI to manage the list — ', bold: true }),
  new TextRun('Settings screen: add/remove additional numbers. This drives the AAB build.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Fix the rejection wording — ', bold: true }),
  new TextRun('"this number isn\'t registered with Naavi" is misleading. There is no registration concept — phone lives in user_settings because the user typed it in. Reword to something like "I don\'t recognize this number — please call from your registered phone, or visit the app to add this one."'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Demo line greeting flow — ', bold: true }),
  new TextRun('"Hi, this is Naavi. May I have your name?" → caller responds → "I heard [name]. Is that right?" → confirm → name threaded into prompt for every turn. Bundle here because it touches the same greeting code path.'),
]));
children.push(dod('A user with two phones can call from either and be recognized; an unknown caller on the demo line is greeted by name; the rejection wording no longer lies.'));

// SESSION 4 ────────────────────────────────────────────────────
children.push(sessionHeader(4, 'Voice Identity — Biometric Fallback', 'Server-only'));
children.push(p('Picovoice Eagle replaces the retired Azure Speaker Recognition. Allows unknown callers to enroll once and be verified by voice on subsequent calls. Blocked until Picovoice approves the account; do not start until then.'));
children.push(bulletRich([
  new TextRun({ text: 'Picovoice Eagle integration — ', bold: true }),
  new TextRun('server-side voiceprint capture + verification on each unknown caller. Sample phrase: "my voice is my password" (verifying the voiceprint, not the words).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Enrollment flow — ', bold: true }),
  new TextRun('first call to Naavi from an unknown number captures three reads of the phrase, stores the voiceprint against user_id.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Verification flow — ', bold: true }),
  new TextRun('subsequent unknown-caller-ID calls trigger the phrase prompt; a match unlocks full Naavi; a miss falls through to the demo greeting.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Schema cleanup — ', bold: true }),
  new TextRun('migrate the disused azure_voice_profile_id columns to picovoice_voice_profile_id (or generic voice_profile_id).'),
]));
children.push(dod('A user calling from any phone in the world can prove they are Wael (or Robert) by speaking the phrase. The misleading "isn\'t registered" rejection becomes a fallback only when both Caller ID and biometric fail.'));

// SESSION 5 ────────────────────────────────────────────────────
children.push(sessionHeader(5, 'Voice Unification — Polly Joanna', 'AAB'));
children.push(p('Decided 2026-05-04: unify on Polly Joanna across phone and mobile. Today phone uses Polly Joanna (Twilio default), mobile uses Deepgram Aura Hera. Two voices means familiarity does not carry between surfaces.'));
children.push(bulletRich([
  new TextRun({ text: 'AWS account + Polly access — ', bold: true }),
  new TextRun('one-time setup. AWS Polly is pay-per-use, very low cost.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Mobile TTS swap — ', bold: true }),
  new TextRun('text-to-speech Edge Function replaces Deepgram Aura with Polly Joanna. AAB only because the mobile audio cache may need clearing.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Edge case retest — ', bold: true }),
  new TextRun('all the existing TTS normalization (postal codes, street suffixes, ordinals) must keep working with Polly. Some rules were tuned for Aura; verify each one.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Roll back trigger — ', bold: true }),
  new TextRun('if Polly Joanna sounds noticeably worse on mobile than Aura did, rollback path is one env-var flip.'),
]));
children.push(dod('A user hangs up the phone, opens the app, and Naavi sounds identical. Latency, intonation, and pronunciation match within tolerance.'));

// SESSION 6 ────────────────────────────────────────────────────
children.push(sessionHeader(6, 'Voice Polish + Final Verification', 'Server + AAB'));
children.push(p('Final TTS gaps and a structured verification pass on the full voice surface.'));
children.push(bulletRich([
  new TextRun({ text: 'Ordinal expansion on voice — ', bold: true }),
  new TextRun('"15th" → "fifteenth", "1st" → "first" (mobile already does this).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice call recording final verify — ', bold: true }),
  new TextRun('"record my visit" flow: confirm AssemblyAI → email summary → Drive save still all working end-to-end (memory: project_naavi_voice_recording flagged email + Drive needed final verify).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Soft-tick presence audit — ', bold: true }),
  new TextRun('verify the soft-tick thinking sound plays in every silent gap (greeting → first input, mid-response). No silent gaps anywhere.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Full voice regression run — ', bold: true }),
  new TextRun('a written test plan modeled on the existing test plan doc, but voice-only. ~30 minutes of structured calls covering every action, every retrieval, every TTS edge case.'),
]));
children.push(dod('A 30-minute structured test call passes every scenario without the user reaching for the app once. At that point voice is semi-complete.'));

// ────────────────────────────────────────────────────────────────
// PAGE BREAK before the second half (parallel tracks, scope, dependencies)
children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(h1('Parallel Tracks (Not Voice, But Ongoing)'));
children.push(p('These run alongside voice work and should not block it.'));
children.push(h2('Geofence Reliability — Priority 1 from Session 25 handoff'));
children.push(p(
  'Samsung battery exemptions configured. Phone reboot pending. If reboot does not fix it, investigate the Expo geofence library bug (#33433) — re-registers on every app foreground (~19× per 6h). This is mobile, but it affects voice indirectly because location alerts fan out to SMS + WhatsApp, both of which are voice-adjacent paths.'
));
children.push(h2('Maestro Test PC — Priority 3'));
children.push(p(
  'Setup doc at docs/MAESTRO_SETUP.docx. Wael drives steps 1–3 (Android Studio, emulator, Maestro CLI). E2E scenarios live under e2e/. Once Maestro is running, voice regression in Session 6 can borrow its discipline (scripted scenarios) but Maestro itself is mobile-only.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('Explicitly Out Of Scope For "Semi-Complete Voice"'));
children.push(p('Things the parity audit lists but a voice-first roadmap should not pursue. They may be valid in their own right — they are not on the path to voice completion.'));
children.push(bullet('Postal code phonetics on mobile — voice already does it; mobile drift is a parity finding, not a voice gap.'));
children.push(bullet('Province codes on mobile — same: voice has it; mobile lacking it does not block voice.'));
children.push(bullet('UPDATE_MORNING_CALL on mobile — intentional voice-only feature.'));
children.push(bullet('START_CALL_RECORDING on mobile — intentional voice-only feature.'));
children.push(bullet('Mobile-only UI: Visits panel, DraftCard, brief panel, walkie-talkie, calendar PDF injection. These belong to mobile\'s role as configuration + visual-confirm surface.'));
children.push(bullet('New voice features beyond the bar (Naavi-initiated calls, multi-party calls, voice-controlled lists with full Drive sync). Defer until semi-complete.'));

// ────────────────────────────────────────────────────────────────
children.push(h1('Open Dependencies (Blockers)'));
children.push(bulletRich([
  new TextRun({ text: 'Picovoice Eagle approval — ', bold: true }),
  new TextRun('Session 4 cannot start until the account is approved.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'AWS account for Polly — ', bold: true }),
  new TextRun('Session 5 needs an AWS billing setup. One-time, < 30 minutes.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Phone reboot for geofence test — ', bold: true }),
  new TextRun('parallel track; not blocking voice sessions.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'npm run test:auto fully green before each AAB — ', bold: true }),
  new TextRun('hard rule (CLAUDE.md). Sessions 3 and 5 build AABs; both must pass the full suite first.'),
]));

// ────────────────────────────────────────────────────────────────
children.push(h1('How This Differs From The Parity Audit'));
children.push(p(
  'The parity audit (MOBILE_VS_PHONE_AUDIT_2026-05-04.docx) lists everything that drifts between the two surfaces, treating mobile and voice as equal partners. It is reference material — useful for spotting drift, not for ordering work.'
));
children.push(p(
  'This roadmap is voice-first. It includes drift items that block voice completion, ignores drift items that only affect mobile, and adds voice-quality work that does not appear in the audit at all (latency, first-word truncation, stop-word, voice unification, biometric). Read this for what to do next; read the audit when you need a line number.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('Bottom Line'));
children.push(p(
  'Six sessions, two AABs, two external dependencies (Picovoice, AWS). At the end of Session 6, voice is the surface a user reaches for first and the app is the surface they open only when they need to see something. That is the competitive moat realized.'
));

// ────────────────────────────────────────────────────────────────
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
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    children,
  }],
});

const outPath = path.join(__dirname, '..', 'docs', 'VOICE_COMPLETION_ROADMAP_2026-05-04.docx');

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log('Wrote', outPath);
});
