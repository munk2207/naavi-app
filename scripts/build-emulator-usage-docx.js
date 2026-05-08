/**
 * Build docs/EMULATOR_USAGE.docx — day-to-day usage guide for the
 * Naavi-Test Android emulator + Maestro tests.
 *
 * Companion to MAESTRO_SETUP.docx (which covers one-time install).
 *
 * Run: node scripts/build-emulator-usage-docx.js
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

function p(text) {
  return new Paragraph({
    children: [new TextRun(text)],
    spacing: { after: 120 },
  });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun(text)],
  });
}

function num(text) {
  return new Paragraph({
    numbering: { reference: 'numbers', level: 0 },
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

function note(text, color = '1565C0') {
  return new Paragraph({
    children: [new TextRun({ text, italics: true, color })],
    spacing: { after: 140 },
    shading: { type: ShadingType.CLEAR, fill: 'EAF2FB' },
  });
}

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
      children: [new TextRun({ text: 'MyNaavi — Emulator + Maestro Usage Guide', bold: true, size: 36 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: 'Day-to-day usage of the Naavi-Test Android emulator. Companion to MAESTRO_SETUP.docx.', italics: true, size: 22, color: '666666' })],
    }),

    // ============================================================
    h1('What the emulator is'),
    p("The Naavi-Test emulator is a virtual Android phone that runs on your PC inside Android Studio. It behaves exactly like a real phone — same Android version, same Play Store, same MyNaavi app — but lives in a window on your desktop and uses your mouse and keyboard for input."),
    p("Why this matters for Naavi:"),
    bullet("Test new builds without waiting hours for Play Store rollout to your real phone."),
    bullet("Reproduce bugs without bothering Robert."),
    bullet("Run automated mobile UI tests via Maestro (npm run test:mobile)."),
    bullet("Compare emulator vs real-phone behavior to isolate device-specific issues."),

    h1('Booting the emulator'),
    num('Open Android Studio.'),
    num('On the welcome screen click More Actions → Virtual Device Manager. (If a project is already open, the Device Manager icon is in the top-right toolbar — looks like a phone with the Android logo.)'),
    num('In the device list, find the row labeled Naavi-Test.'),
    num('Hover over the row — a play button (▶) appears at the right end. Click it.'),
    num('Wait 30 seconds to 2 minutes. The emulator window opens on your desktop and boots Android. You will see the Android lock screen, then the home screen.'),
    note('Tip: leave the emulator running while you work. Booting it cold each time wastes minutes. Closing the emulator window stops it; clicking the power-off icon on the right toolbar does a clean shutdown. Either is fine.'),

    h1('Using the emulator like a phone'),
    p("Everything you can do on a real Android phone, you can do here. The right-side toolbar is the emulator's hardware buttons:"),
    bullet("Power (top icon) — lock / sleep the screen."),
    bullet("Volume up / down (speaker icons) — adjust media volume."),
    bullet("Camera — virtual camera; opens picture chooser."),
    bullet("Zoom — magnify the screen."),
    bullet("Rotate (curved arrow) — landscape / portrait."),
    bullet("Back, Home, Recent — the standard 3-button Android navigation row."),
    bullet("More (...) — extended controls: GPS location injection, fake battery, network toggles, virtual sensors."),
    p("Inside the emulator screen itself: tap with your mouse, swipe by click-and-drag, type with your keyboard. The emulator captures your typing as if it were the on-screen keyboard."),

    h1('Signing in to MyNaavi inside the emulator'),
    num('Open Play Store inside the emulator. Sign in with your Google account (wael.aggan@gmail.com — same one you use everywhere else for Naavi).'),
    num('Open Chrome inside the emulator and paste the dedicated internal-test URL Google Play sent you (the one that begins https://play.google.com/apps/internaltest/...). Tap Install on the MyNaavi page.'),
    num('After install, find the MyNaavi icon (green-teal brain logo) in the app drawer. Tap to open.'),
    num('Tap the green Sign in with Google button at the top. Pick your account. Complete consent screens.'),
    num('You should now see the brief, weather, and the MyNaavi chat. Same data as your real phone since it is the same account.'),
    note('After this one-time setup, MyNaavi remembers you across emulator restarts. You only re-sign-in if you wipe the emulator data.'),

    h1('Updating MyNaavi to a new build'),
    h2('Option A — through Play Store (waits for Google to propagate the build)'),
    num('Inside the emulator, open Play Store.'),
    num('Tap your profile icon (top-right circle).'),
    num('Tap Manage apps & device → Updates available.'),
    num('If MyNaavi appears, tap Update.'),
    num('If MyNaavi is NOT in the updates list yet, Play Store has not propagated the new version yet. Wait 5-15 minutes after the build was promoted and try again.'),

    h2('Option B — install directly via adb (bypasses Play Store wait)'),
    p("Faster than waiting for Play Store. You install the AAB directly from the EAS build artifact link or from a local file."),
    num('Make sure the emulator is running (you can see it on your desktop).'),
    num('Open PowerShell on your PC.'),
    num('Either download the AAB from the EAS link Claude provided after the build (looks like https://expo.dev/artifacts/eas/XXXX.aab) and save it somewhere local, OR copy the URL.'),
    num('Run (replace path with your actual AAB file location):'),
    code('adb install -r "C:\\Users\\waela\\Downloads\\MyNaavi-V57.9.7.aab"'),
    num('Wait for "Performing Streamed Install" → "Success". About 30-60 seconds.'),
    num('Open MyNaavi inside the emulator. Verify the version line in Settings reads what you expected.'),
    note('The -r flag means "reinstall, keeping app data". Without -r, install fails if a previous version is already there. Do NOT use -t (test) or -d (allow downgrade) unless you know why.'),

    h1('Running the Maestro test suite'),
    p("Tests live in the e2e/ folder of the Naavi repo. The runner script (npm run test:mobile) handles everything: checks Maestro/adb/emulator/app are ready, then runs."),

    h2('Run all tests'),
    code('cd C:\\Users\\waela\\OneDrive\\Desktop\\Naavi\nnpm run test:mobile'),

    h2('Run a single test by filename pattern'),
    code('npm run test:mobile -- 01-smoke-launch\nnpm run test:mobile -- 02-five-consecutive\nnpm run test:mobile -- 05-force-close'),

    h2('First-time-per-PowerShell setup'),
    p("If you opened a fresh PowerShell window and JAVA_HOME isn't set yet, prepend this once per session:"),
    code('$env:JAVA_HOME = "C:\\Program Files\\Android\\Android Studio\\jbr"'),
    p("To make this permanent so you never type it again: Windows key → 'environment variables' → Edit the system environment variables → Environment Variables button → New (under User variables) → Variable name JAVA_HOME, Variable value C:\\Program Files\\Android\\Android Studio\\jbr → OK → OK → OK. Close PowerShell and open a new one."),

    h2('Where to find test results'),
    bullet("Each test run writes detailed logs and screenshots to: C:\\Users\\waela\\.maestro\\tests\\<timestamp>\\"),
    bullet("Failed tests print the failure reason and the path to debug artifacts in the PowerShell output."),
    bullet("Open the artifact folder to inspect: device.png (screenshot at point of failure), commands-output.txt, view-hierarchy.json."),

    h1('Common troubleshooting'),

    h2('"adb device(s): 0" — no emulator detected'),
    bullet("Make sure the Naavi-Test emulator window is open and showing the Android home screen (not the boot animation)."),
    bullet("In PowerShell run: adb devices — should show emulator-5554 with status 'device'."),
    bullet("If status is 'offline', the emulator isn't fully booted yet. Wait another 30 seconds."),
    bullet("If no devices at all, the emulator probably crashed. Close and re-launch from Device Manager."),

    h2('"ca.naavi.app is not installed on the device"'),
    bullet("Either MyNaavi was never installed (use Option A or B above to install)."),
    bullet("Or the emulator was wiped — re-install via Play Store inside the emulator."),

    h2('"Maestro: JAVA_HOME is not set"'),
    bullet("You opened a fresh PowerShell that doesn't have JAVA_HOME persisted. Either set it for this session ($env:JAVA_HOME = ...) or set it permanently via Windows environment variables (steps above)."),

    h2('Test fails with "Assertion is false"'),
    bullet("The text Maestro looked for isn't on screen. Open the screenshot in C:\\Users\\waela\\.maestro\\tests\\<timestamp>\\ to see what the screen actually looked like at that moment."),
    bullet("If the app changed (UI label was renamed, etc.), update the test YAML accordingly. Send Claude the screenshot and the failed assertion line — quick fix."),

    h2('Emulator runs slowly or freezes'),
    bullet("Make sure hardware acceleration is enabled (Intel HAXM or Windows Hypervisor Platform). Android Studio prompts for this on first install — accept."),
    bullet("Close other heavy programs. The emulator wants ~2-4 GB RAM."),
    bullet("If still slow, in Device Manager click Edit (pencil icon) on Naavi-Test → Show Advanced Settings → set Graphics: Hardware (instead of Software)."),

    h1('When NOT to use the emulator'),
    p("Some bugs only show up on a real phone. The emulator is great for almost everything, but skip it for:"),
    bullet("Geofence / location alerts — emulators don't trigger Android Doze, so the 28-minute battery-optimization delay never reproduces."),
    bullet("Push notifications via FCM — works in emulators only with extra setup; easier to verify on the real phone."),
    bullet("Twilio voice calls (the +1 249 523 5394 number) — requires a real cellular network."),
    bullet("Camera / microphone hardware quirks — emulator audio passes through host but rendering can differ from a real phone."),
    p("For everything else (chat send, voice memo path, auth flow, UI rendering, action handling), the emulator is faster than waiting for Play Store rollout to your phone."),

    h1('Quick reference card'),
    p("Cheat sheet — copy this somewhere handy:"),
    code('# Boot emulator from Android Studio Device Manager (▶ next to Naavi-Test)\n\n# Set Java path for this PowerShell session:\n$env:JAVA_HOME = "C:\\Program Files\\Android\\Android Studio\\jbr"\n\n# Run all Maestro tests:\ncd C:\\Users\\waela\\OneDrive\\Desktop\\Naavi\nnpm run test:mobile\n\n# Run one test:\nnpm run test:mobile -- 01-smoke-launch\n\n# Check emulator is detected:\nadb devices\n\n# Install a build directly:\nadb install -r "C:\\path\\to\\app.aab"\n\n# Force-close MyNaavi (test for state-loss bugs):\nadb shell am force-stop ca.naavi.app\n\n# Take a screenshot of the emulator from the command line:\nadb exec-out screencap -p > screenshot.png'),
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
      { reference: 'numbers',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  sections,
});

Packer.toBuffer(doc).then(buffer => {
  const out = path.resolve(__dirname, '..', 'docs', 'EMULATOR_USAGE.docx');
  fs.writeFileSync(out, buffer);
  console.log(`Wrote ${out} (${buffer.length} bytes)`);
});
