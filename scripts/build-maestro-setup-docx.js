/**
 * Build docs/MAESTRO_SETUP.docx — step-by-step Maestro + Android Emulator
 * setup guide for Wael (Windows PC).
 *
 * Run: node scripts/build-maestro-setup-docx.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, ExternalHyperlink,
} = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 120 },
  });
}

function pRich(runs, opts = {}) {
  return new Paragraph({ children: runs, spacing: { after: 120 }, ...opts });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun(text)],
  });
}

function code(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Consolas', size: 20 })],
    shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
    spacing: { after: 120 },
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun(text)],
    spacing: { before: 240, after: 120 },
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun(text)],
    spacing: { before: 200, after: 100 },
  });
}

function ownerCell(text, fill) {
  return new TableCell({
    borders,
    width: { size: 1200, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20 })],
    })],
  });
}

function stepHeading(num, who, title) {
  const fill = who === 'YOU' ? 'B71C1C' : '1565C0';
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1200, 8160],
    rows: [new TableRow({
      children: [
        ownerCell(who, fill),
        new TableCell({
          borders,
          width: { size: 8160, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 160, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: `Step ${num} — ${title}`, bold: true, size: 26 })],
          })],
        }),
      ],
    })],
  });
}

function legendCell(label, fill) {
  return new TableCell({
    borders,
    width: { size: 1400, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: label, bold: true, color: 'FFFFFF', size: 22 })],
    })],
  });
}

function legendDescCell(text) {
  return new TableCell({
    borders,
    width: { size: 7960, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 160, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, size: 22 })] })],
  });
}

const legendTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [1400, 7960],
  rows: [
    new TableRow({ children: [
      legendCell('YOU', 'B71C1C'),
      legendDescCell('Step you must execute on your PC. I cannot do it for you.'),
    ]}),
    new TableRow({ children: [
      legendCell('ME', '1565C0'),
      legendDescCell('Step I (Claude) handle in code. You wait for me to confirm done.'),
    ]}),
  ],
});

const sections = [{
  properties: {
    page: {
      size: { width: 12240, height: 15840 },
      margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    },
  },
  children: [
    // Title
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: 'MyNaavi — Maestro + Android Emulator Setup', bold: true, size: 36 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: 'Mobile UI test runner — catches bugs the server-side auto-tester cannot.', italics: true, size: 22, color: '666666' })],
    }),

    // Why this exists
    h1('Why we need this'),
    p("The existing auto-tester (npm run test:auto) runs from Node.js against the deployed server. It catches prompt regressions, server logic bugs, and multi-user safety issues — but it cannot catch mobile-platform bugs."),
    p("Bugs that escaped the auto-tester this week:"),
    bullet("V57.9.5 connection-pool leak — RN fetch leaked HTTP connections; third consecutive call hung."),
    bullet("V57.9.4 voice transcription latency — server returned fast, but mobile audio path was slow."),
    bullet("V57.9.7 auth-cache-empty-after-install — AsyncStorage wiped during install, getSession returned null."),
    bullet("Stuck-button after successful send — orchestrator state machine didn't release."),
    p("All of these are MOBILE bugs (React Native runtime + OkHttp + AsyncStorage + state). Maestro runs the actual app on an emulator, so it sees what Wael sees."),

    h1('Legend'),
    legendTable,
    new Paragraph({ children: [new TextRun(' ')], spacing: { after: 100 } }),

    // Steps
    h1('Setup steps'),

    stepHeading(1, 'YOU', 'Install Android Studio'),
    bullet('Open the link below in your browser:'),
    pRich([new ExternalHyperlink({
      children: [new TextRun({ text: 'https://developer.android.com/studio', style: 'Hyperlink' })],
      link: 'https://developer.android.com/studio',
    })]),
    bullet('Download "Android Studio Hedgehog" or newer.'),
    bullet('Run the installer with default options.'),
    bullet('On first launch, Android Studio prompts you to install the SDK + emulator system image — accept all.'),
    bullet('Time: about 30-45 minutes (4 GB download + install).'),
    bullet('Disk space needed: about 15 GB free.'),

    stepHeading(2, 'YOU', 'Create the Naavi-Test virtual device'),
    bullet('In Android Studio top-right toolbar, click the Device Manager icon (looks like a phone with the Android logo).'),
    bullet('Click "+ Create Virtual Device".'),
    bullet('Pick Pixel 7 (or Pixel 6 if Pixel 7 is not in the list).'),
    bullet('System image: pick "API 34" (Android 14). Accept the download — about 2 GB.'),
    bullet('Name: type "Naavi-Test" (without quotes).'),
    bullet('Click Finish.'),
    bullet('Click the play button to launch — the first launch takes 2-3 minutes.'),
    bullet('Time: about 15 minutes total.'),

    stepHeading(3, 'YOU', 'Install Maestro CLI on your PC'),
    bullet('Open PowerShell as your normal user (NOT as administrator).'),
    bullet('Copy-paste this command and press Enter:'),
    code('iwr -useb https://get.maestro.mobile.dev/install-windows.ps1 | iex'),
    bullet('Wait for the installer to finish.'),
    bullet('Close the PowerShell window completely. Open a new one.'),
    bullet('Type maestro --version and press Enter. You should see a version number.'),
    bullet('Time: about 5 minutes.'),
    bullet('Fallback: if the script fails, tell me and I will guide you through WSL2 (Windows Subsystem for Linux) instead.'),

    stepHeading(4, 'ME', 'Write the e2e/ test scenarios'),
    p('I will create a folder called e2e/ in the repo with about 10 YAML test scenarios. Each scenario covers a specific bug class:'),
    bullet('5-consecutive-sends — catches V57.9.5-class connection leaks.'),
    bullet('Voice-then-typed sequence — catches audio-path bugs.'),
    bullet('Sign-in then force-close then reopen — catches V57.9.7-class auth bugs.'),
    bullet('Tap mic, record, stop, verify transcription appears — catches voice path bugs.'),
    bullet('Plus routine ones: sign in, send a message, tap brief, navigate menus.'),
    p('Time: about 3-4 hours of my time. I can start this in parallel while you do steps 1-3.'),

    stepHeading(5, 'ME', 'Wire up npm run test:mobile script'),
    p('I will add a new script to package.json that:'),
    bullet('Detects if the Naavi-Test emulator is running. Boots it if not.'),
    bullet('Pulls the latest AAB from EAS (or installs from Play Store).'),
    bullet('Runs maestro test e2e/ against the emulator.'),
    bullet('Generates a pass/fail report in tests/results/.'),
    p('Time: about 30 minutes of my time.'),

    stepHeading(6, 'YOU', 'First-time install MyNaavi on the emulator (OPTIONAL)'),
    p('This step is OPTIONAL. The Step 5 script can install the AAB automatically. If you want to do it manually once to verify everything works:'),
    bullet('Make sure the Naavi-Test emulator is running.'),
    bullet('Drag the AAB file directly onto the emulator window. OR run:'),
    code('adb install path/to/MyNaavi.aab'),
    bullet('Time: about 5 minutes if manual; skipped entirely if Step 5 automates it.'),

    stepHeading(7, 'BOTH', 'Run npm run test:mobile and iterate on failures'),
    bullet('You run the command on your PC because the emulator runs on your PC, not in my session.'),
    bullet('I read the failure output and fix scenarios or app code as needed.'),
    bullet('Repeat until green.'),

    h1('Critical path you must execute'),
    p('Steps 1, 2, and 3. Without those, Maestro cannot run anything. Total time on your end: about 1-1.5 hours, mostly waiting for downloads.'),
    p('Steps 4 and 5 I can start right now in parallel while you install Android Studio and Maestro. By the time you finish Step 3, the test scenarios are ready to run.'),

    h1('What this catches that the auto-tester cannot'),
    p('Auto-tester (Node.js + server-side):'),
    bullet('✓ Server-side logic bugs.'),
    bullet('✓ Prompt regressions (catches LIST_CREATE-class issues).'),
    bullet('✓ Action-shape regressions.'),
    bullet('✓ Multi-user safety regressions.'),
    bullet('✗ Mobile RN fetch leaks.'),
    bullet('✗ AsyncStorage / install issues.'),
    bullet('✗ Audio focus issues.'),
    bullet('✗ TTS playback issues.'),
    bullet('✗ Network-condition-dependent bugs.'),
    p('Maestro (mobile UI runner on emulator):'),
    bullet('✓ Everything the auto-tester catches that involves a UI flow.'),
    bullet('✓ Connection-pool leaks (consecutive-sends test).'),
    bullet('✓ AsyncStorage persistence (force-close-and-reopen test).'),
    bullet('✓ Voice path end-to-end including transcription latency.'),
    bullet('✓ Stuck-button regressions.'),
    bullet('✗ OS-level Doze / battery optimization (still requires real-device manual testing).'),
    bullet('✗ Twilio voice call flow (different surface, separate setup).'),

    h1('Cost'),
    p('Maestro CLI: free.'),
    p('Android emulator: free (uses your CPU and RAM).'),
    p('Total recurring cost: $0.'),
    p('Optional upgrade later: Maestro Cloud (real-device farm, $99/month). Not needed for our use case yet.'),

    h1('Maintenance reality'),
    p('Once set up, the e2e/ tests need updating whenever:'),
    bullet('A button label or screen layout changes.'),
    bullet('A new feature ships that needs coverage.'),
    bullet('A bug class is found that the test missed (add a scenario for it).'),
    p('Estimate: 30 minutes of my time per AAB build cycle to keep tests in sync. Worth it because each test catches bugs before they reach your phone.'),
  ],
}];

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: 'Arial', color: '1A237E' },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: '283593' },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  sections,
});

Packer.toBuffer(doc).then(buffer => {
  const out = path.resolve(__dirname, '..', 'docs', 'MAESTRO_SETUP.docx');
  fs.writeFileSync(out, buffer);
  console.log(`Wrote ${out} (${buffer.length} bytes)`);
});
