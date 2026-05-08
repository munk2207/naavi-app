/**
 * Build docs/VOICE_COMPLETION_ROADMAP_2026-05-07.docx — supersedes 2026-05-04.
 * Eight-session plan to bring the phone (Twilio voice) surface from "works
 * most of the time" to "trustworthy daily driver" — sequenced session-by-session.
 *
 * 2026-05-07 changes vs 2026-05-04: two new sessions (S3 Demo Line Maturity,
 * S7 Voice Structured Outputs Migration) plus three bullet expansions
 * (picker robustness + self-cleansing memory in S1; address read-back
 * bundled into S8). Banned-term cleanup applied (no "active senior").
 *
 * Run: node scripts/build-voice-completion-roadmap-2026-05-07-docx.js
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
  const isAab = scope.includes('AAB');
  const isBlocked = scope.includes('BLOCKED');
  const tagFill = isBlocked ? '7B1FA2' : (isAab ? 'B71C1C' : '2E7D32');
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1100, 5860, 2400],
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
          width: { size: 5860, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: '1F3A68' },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: label, bold: true, color: 'FFFFFF', size: 24 })],
          })],
        }),
        new TableCell({
          borders,
          width: { size: 2400, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: tagFill },
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
children.push(subtitle('2026-05-07 — Eight-session plan to reach "trustworthy daily driver" (supersedes 2026-05-04)'));

// ────────────────────────────────────────────────────────────────
children.push(h1('Why This Document Exists'));
children.push(p(
  'Voice is the competitive moat. A phone call needs no app, no login, no screen — so it scales to anyone with any phone, including people whose hands and eyes are doing other things. Every other AI assistant is screen-first. MyNaavi is the only one a person can trust as a daily driver by talking to it. Mobile is the configuration and visual-confirm surface; voice is the daily driver.'
));
children.push(p(
  'This document supersedes VOICE_COMPLETION_ROADMAP_2026-05-04. The earlier version proposed six sessions. The work between 2026-05-04 and 2026-05-07 surfaced two new sessions and three bullet expansions to existing sessions. The 2026-05-04 file is kept in docs/ for history; this 2026-05-07 file is the canonical plan.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('What Changed Since 2026-05-04'));
children.push(p('Three days of work (V57.13.0 → V57.13.7) surfaced gaps the original roadmap could not have anticipated. Five additions, organized below by where they land in the new structure:'));
children.push(bulletRich([
  new TextRun({ text: 'Demo line as a product surface, not just a greeting (NEW S3). ', bold: true }),
  new TextRun('1-888-91-NAAVI is now a public number with 5 cross-domain scenarios, name capture, personalized SMS from +1-431-300-6228, and a /start landing page. Needs richer scenario data, conversion path back to a real account, telemetry.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Picker robustness on voice (S1 bullet). ', bold: true }),
  new TextRun('V57.13.3 no-cache architecture surfaces a Google picker on every "alert me at X" — every time, no shortcuts. Voice STT for "the second one" / "the Innes Road one" / barge-in mid-list is the gate.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Self-cleansing memory on voice (S1 bullet). ', bold: true }),
  new TextRun('Principle established 2026-05-07. Voice STT mistranscriptions create malformed entries (one "Hussein" becomes three contacts). Phonetic-merge on read; detect-and-flag malformed memory at fetch time.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice migration to Anthropic Structured Outputs (NEW S7). ', bold: true }),
  new TextRun('Mobile shipped V57.12 with ~200 lines of orchestrator band-aid code removed. Voice is still on JSON-in-prompt path — drift growing.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Address read-back as a bundled session (S8 promotion). ', bold: true }),
  new TextRun('V57.13.4 made full address visible on every alert surface. Voice needs the read-back pipeline (postal phonetics, suffix expansion, ordinals) treated as one trust bar, not scattered bullets.'),
]));

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
children.push(bulletRich([
  new TextRun({ text: 'Demo line converts: ', bold: true }),
  new TextRun('a stranger calling 1-888-91-NAAVI ends the call having seen value, given their name, opted in to follow-up, and visited /start. NEW 2026-05-07.'),
]));

// ────────────────────────────────────────────────────────────────
children.push(h1('Session-By-Session Plan'));
children.push(p(
  'Eight focused sessions move voice from where it is today to semi-complete. Sessions can run sequentially; some have external dependencies (noted) and may need to wait. Session order reflects user impact, not difficulty.'
));

// SESSION 1 ────────────────────────────────────────────────────
children.push(sessionHeader(1, 'Voice Quality Foundation', 'Server-only'));
children.push(p('Fix the things that make the user lose trust mid-conversation. Nothing else matters until these are clean.'));
children.push(bulletRich([
  new TextRun({ text: 'Live Google Calendar fetch on voice — ', bold: true }),
  new TextRun('mirror the mobile fix (naavi-chat:397–479). Voice currently reads a stale Supabase snapshot, which is why "next meeting" can be a past event.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Stop-word interrupt — ', bold: true }),
  new TextRun('"Naavi stop" must cut TTS instantly. Currently gets recorded as the next question (memory: project_naavi_stop_word_regression).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Deepgram first-word truncation during barge-in — ', bold: true }),
  new TextRun('"What time is it?" arrives as "Time is it?" and breaks the fast-path regex (memory: project_naavi_deepgram_first_word_truncation).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice name-search — ', bold: true }),
  new TextRun('Deepgram mistranscribes "Hussein" and similar names; mobile text handles them fine. Add phonetic fallback or alias matching server-side.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice latency baseline — ', bold: true }),
  new TextRun('measure today\'s round-trip on trivial questions. Identify the dominant component (STT, Claude, TTS, network). Cut the largest one.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Picker robustness (NEW 2026-05-07) — ', bold: true }),
  new TextRun('V57.13.3 no-cache architecture surfaces a Google picker on every "alert me at X". Voice STT for "the second one" / "the Innes Road one" / "two" / barge-in mid-list is the gate. This is a quality issue, not a feature.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Self-cleansing memory (NEW 2026-05-07) — ', bold: true }),
  new TextRun('STT mistranscriptions create malformed entries (one person becomes three contacts). Phonetic-merge on read; detect-and-flag malformed memory at fetch time. Every read sheds degraded data.'),
]));
children.push(dod('A 5-minute call covering "next meeting", "stop", a name lookup, "what time is it?", and a multi-result location query has zero stale answers, zero dropped first words, picks the right option from the picker, and stops on command.'));

// SESSION 2 ────────────────────────────────────────────────────
children.push(sessionHeader(2, 'Voice Action Parity', 'Server-only'));
children.push(p('Add the four actions the voice surface is missing today. Mobile already has them — voice just needs them wired into naavi-chat or get-naavi-prompt.'));
children.push(bulletRich([
  new TextRun({ text: 'DELETE_EVENT on voice — ', bold: true }),
  new TextRun('"cancel my 3pm" should remove the calendar event. Mirror mobile\'s implementation into the shared prompt and chat handler.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'LIST_RULES on voice — ', bold: true }),
  new TextRun('"what alerts do I have?" should read them back. Mobile has this; voice does not.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'DELETE_MEMORY on voice — ', bold: true }),
  new TextRun('"forget that I take Lipitor" should remove the knowledge fragment. Mobile has this; voice does not.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'SCHEDULE_MEDICATION on voice — ', bold: true }),
  new TextRun('"remind me to take my morning pills at 8" should create a recurring reminder. Mobile has this; voice does not.'),
]));
children.push(dod('On a single phone call, the user can list alerts, delete an event, forget a memory, and schedule a medication — and each one fires the same Edge Function the mobile app does.'));

// SESSION 3 — NEW ──────────────────────────────────────────────
children.push(sessionHeader(3, 'Demo Line Maturity', 'AAB'));
children.push(p('Today (2026-05-07) the demo line works: 5 cross-domain scenarios, name capture, personalized SMS from +1-431-300-6228, /start landing page. Now it needs to convert. NEW 2026-05-07.'));
children.push(bulletRich([
  new TextRun({ text: 'Richer scenario data — ', bold: true }),
  new TextRun('move from placeholder data to a curated demo user with realistic Drive documents, calendar events, contacts, and an active alert. The demo proves capability only if the data behind it is rich enough to demonstrate.'),
]));
children.push(bulletRich([
  new TextRun({ text: '/start → real account conversion path — ', bold: true }),
  new TextRun('today the /start form goes to Formspree (xvzdkjod). Wire a callback flow: form submit → email response → Internal Testing invite → onboarding call.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Demo telemetry — ', bold: true }),
  new TextRun('per-call: scenarios played, name captured, SMS opt-in, /start visit, form submit. Funnel metrics for iteration.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Demo "remind me" loop fix — ', bold: true }),
  new TextRun('current bug: demo runs the real Naavi orchestrator under DEMO_USER_ID with outbound suppressed, but time extraction loops on "remind me" inputs (memory: project_naavi_demo_set_reminder_loop).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Anti-abuse — ', bold: true }),
  new TextRun('rate-limit per caller-ID; cap demo session length; gracefully drop callers spamming the line.'),
]));
children.push(dod('A stranger calls 1-888-91-NAAVI, hears one cross-domain scenario that demonstrably could not be a recording, gives their name, opts into the SMS, visits /start, fills the form, and receives an Internal Testing invite within 48 hours. End-to-end conversion path proven.'));

// SESSION 4 ────────────────────────────────────────────────────
children.push(sessionHeader(4, 'Voice Identity — Multi-Phone Fast Path', 'AAB'));
children.push(p('Was S3 in 2026-05-04 doc. Today, only one phone number per user is recognized. Demo greeting flow shipped 2026-05-07 partially handles unknown callers; remaining work is multi-phone for known users.'));
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
  new TextRun('"this number isn\'t registered" is misleading. Reword to acknowledge the demo line greeting flow that exists.'),
]));
children.push(dod('A user with two phones can call from either and be recognized. The rejection wording no longer lies.'));

// SESSION 5 ────────────────────────────────────────────────────
children.push(sessionHeader(5, 'Voice Identity — Biometric Fallback', 'BLOCKED on Picovoice'));
children.push(p('Picovoice Eagle replaces the discontinued Azure Speaker Recognition. Path A approved 2026-05-07: wait on Picovoice with deadline; ID R&D as backup if no response.'));
children.push(bulletRich([
  new TextRun({ text: 'Picovoice Eagle integration — ', bold: true }),
  new TextRun('server-side voiceprint capture + verification on each unknown caller. Sample phrase: "my voice is my password" (verifying the voiceprint, not the words).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Enrollment flow — ', bold: true }),
  new TextRun('first call from an unknown number captures three reads of the phrase, stores the voiceprint against user_id.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Verification flow — ', bold: true }),
  new TextRun('subsequent unknown-caller-ID calls trigger the phrase prompt; a match unlocks full Naavi; a miss falls through to the demo greeting.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Schema cleanup — ', bold: true }),
  new TextRun('migrate the disused azure_voice_profile_id columns to picovoice_voice_profile_id (or generic voice_profile_id).'),
]));
children.push(dod('A user calling from any phone in the world can prove they are themselves by speaking the phrase. The rejection lane becomes a fallback only when both Caller ID and biometric fail.'));

// SESSION 6 ────────────────────────────────────────────────────
children.push(sessionHeader(6, 'Voice Unification — Polly Joanna', 'AAB — BLOCKED on AWS'));
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

// SESSION 7 — NEW ──────────────────────────────────────────────
children.push(sessionHeader(7, 'Voice Structured Outputs Migration', 'Server-only'));
children.push(p('Mobile shipped Anthropic Structured Outputs in V57.12 (2026-05-06), removing ~200 lines of orchestrator band-aid code. Voice is still on JSON-in-prompt — drift is growing daily. NEW 2026-05-07.'));
children.push(bulletRich([
  new TextRun({ text: 'Match mobile\'s tool registry — ', bold: true }),
  new TextRun('voice server uses the same enum-constrained tools (set_location_rule_chain, etc.) so the prompt regression suite covers both surfaces.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Drop voice-side band-aids — ', bold: true }),
  new TextRun('chain-store auto-fix bridge, JSON-fence stripping, and similar shims. Same cleanup mobile got.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice prompt version unification — ', bold: true }),
  new TextRun('voice and mobile fetch the same get-naavi-prompt v64+. Verify both surfaces emit identical actions for identical user inputs.'),
]));
children.push(dod('Voice surface uses the exact same tool-calling pipeline as mobile. The prompt regression suite passes for both surfaces. ~200 lines of voice-server band-aid removed.'));

// SESSION 8 ────────────────────────────────────────────────────
children.push(sessionHeader(8, 'Voice Polish + Final Verification', 'Server + AAB'));
children.push(p('Final TTS gaps and a structured verification pass on the full voice surface. Address read-back bundled in 2026-05-07 update (was scattered across S6 in the original).'));
children.push(bulletRich([
  new TextRun({ text: 'Address read-back as one trust bar (PROMOTED 2026-05-07) — ', bold: true }),
  new TextRun('postal-code phonetics, street-suffix expansion (Dr→Drive), ordinal expansion (15th→fifteenth) treated as one bundled work item, not three scattered fixes. V57.13.4 made full address visible on every alert surface; voice has to read it back correctly.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice call recording final verify — ', bold: true }),
  new TextRun('"record my visit" flow: confirm AssemblyAI → email summary → Drive save still all working end-to-end (memory: project_naavi_voice_recording).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Soft-tick presence audit — ', bold: true }),
  new TextRun('verify the soft-tick thinking sound plays in every silent gap — including during the now-mandatory ~1s Google Places fetch on every "alert me at X" (V57.13.3 no-cache).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Full voice regression run — ', bold: true }),
  new TextRun('a written test plan modeled on the existing test plan doc, but voice-only. ~30 minutes of structured calls covering every action, every retrieval, every TTS edge case.'),
]));
children.push(dod('A 30-minute structured test call passes every scenario without the user reaching for the app once. Address read-back is correct on every alert. At that point voice is semi-complete.'));

// ────────────────────────────────────────────────────────────────
// PAGE BREAK before parallel tracks, scope, dependencies
children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(h1('Parallel Tracks (Not Voice, But Ongoing)'));
children.push(p('These run alongside voice work and should not block it.'));
children.push(h2('Geofence Reliability'));
children.push(p(
  'Samsung battery exemptions configured. Phone reboot pending. If reboot does not fix it, investigate the Expo geofence library bug — re-registers on every app foreground (~19× per 6h). This is mobile, but it affects voice indirectly because location alerts fan out to SMS + WhatsApp, both of which are voice-adjacent paths.'
));
children.push(h2('Maestro Test PC'));
children.push(p(
  'Setup doc at docs/MAESTRO_SETUP.docx. E2E scenarios live under e2e/. Once Maestro is running on the emulator with Internal Testing installed, voice regression in S8 can borrow its discipline (scripted scenarios) but Maestro itself is mobile-only.'
));
children.push(h2('Mobile-side Todo-List-Per-Alert'));
children.push(p(
  'Each location alert has an attached list (lazy-create on first add; cascade-delete on alert removal; reuses LIST_ADD/REMOVE infrastructure). Half-session of work. Independent of voice but a useful UX layer that voice can later read back at fire time.'
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
  new TextRun('S5 cannot start until the account is approved. Path A (wait with deadline) approved 2026-05-07; ID R&D as backup if no response.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'AWS account for Polly — ', bold: true }),
  new TextRun('S6 needs AWS billing setup. One-time, < 30 minutes.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Demo line curated user data — ', bold: true }),
  new TextRun('S3 needs a demo user with rich, plausible Drive/calendar/contacts/alerts. Captured 2026-05-07.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Phone reboot for geofence test — ', bold: true }),
  new TextRun('parallel track; not blocking voice sessions.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'npm run test:auto fully green before each AAB — ', bold: true }),
  new TextRun('hard rule (CLAUDE.md). S3, S4, S6 build AABs; all must pass the full suite first.'),
]));

// ────────────────────────────────────────────────────────────────
children.push(h1('How This Differs From The Parity Audit'));
children.push(p(
  'The parity audit (MOBILE_VS_PHONE_AUDIT_2026-05-04.docx) lists everything that drifts between the two surfaces, treating mobile and voice as equal partners. It is reference material — useful for spotting drift, not for ordering work.'
));
children.push(p(
  'This roadmap is voice-first. It includes drift items that block voice completion, ignores drift items that only affect mobile, and adds voice-quality work that does not appear in the audit at all (latency, first-word truncation, stop-word, voice unification, biometric, picker robustness, self-cleansing memory, demo line maturity, structured outputs migration). Read this for what to do next; read the audit when you need a line number.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('Bottom Line'));
children.push(p(
  'Eight sessions, three AABs, three external dependencies (Picovoice, AWS, demo data curation). At the end of S8, voice is the surface a user reaches for first and the app is the surface they open only when they need to see something. The demo line converts strangers into users. That is the competitive moat realized.'
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

const outPath = path.join(__dirname, '..', 'docs', 'VOICE_COMPLETION_ROADMAP_2026-05-07.docx');

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log('Wrote', outPath);
});
