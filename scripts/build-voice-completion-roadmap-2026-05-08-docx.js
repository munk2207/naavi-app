/**
 * Build docs/VOICE_COMPLETION_ROADMAP_2026-05-08.docx — supersedes 2026-05-07.
 *
 * Reframes the roadmap from session-based ("8 sessions") to work-item-based
 * (list of items in dependency order). The user decides cadence per CLAUDE.md
 * Rule 11; the document does not impose session boundaries.
 *
 * 2026-05-08 changes vs 2026-05-07:
 *   - DROPPED "session" framing — work items in dependency order, no implied stops
 *   - ADDED Refreshed Parity Baseline (prerequisite work item)
 *   - ADDED Voice Privacy UX (F1c — top-severity Feature, missing in 2026-05-07)
 *   - ADDED Voice Automated Regression Suite (analog of Maestro for voice)
 *   - RESCOPED Action Parity — only SCHEDULE_MEDICATION genuinely missing today
 *     (DELETE_EVENT / LIST_RULES / DELETE_MEMORY at parity post-V57.12 voice tool-use migration)
 *   - CORRECTED Voice Unification starting state — both surfaces on Aura today,
 *     not "phone-Polly / mobile-Aura" (verified in code 2026-05-08)
 *   - FOLDED B1b voice-side LIST_RULES speech-override backstop into Action Parity
 *   - FOLDED B3a fragmentation verification as pre-flight to Voice Unification
 *   - FOLDED B3d address-rejection wording into Polish + Final Verification
 *   - FOLDED architectural principle (sync + live-overlay per channel) into Voice Quality Foundation
 *   - REPLACED soft "Done when…" criteria with explicit "voice = mobile" parity tests
 *
 * Run: node scripts/build-voice-completion-roadmap-2026-05-08-docx.js
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

function parityCriterion(text) {
  return new Paragraph({
    spacing: { before: 80, after: 200 },
    indent: { left: 360 },
    children: [
      new TextRun({ text: 'Parity test: ', bold: true, color: '2E7D32' }),
      new TextRun(text),
    ],
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

function workItemHeader(num, label, scope) {
  const isAab = scope.includes('AAB');
  const isBlocked = scope.includes('BLOCKED');
  const tagFill = isBlocked ? '7B1FA2' : (isAab ? 'B71C1C' : '2E7D32');
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1200, 5760, 2400],
    rows: [new TableRow({
      children: [
        new TableCell({
          borders,
          width: { size: 1200, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: '1F3A68' },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `W${num}`, bold: true, color: 'FFFFFF', size: 22 })],
          })],
        }),
        new TableCell({
          borders,
          width: { size: 5760, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: '1F3A68' },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: label, bold: true, color: 'FFFFFF', size: 22 })],
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
children.push(subtitle('2026-05-08 — Voice replicates mobile + voice-native dignity (supersedes 2026-05-07)'));

// ────────────────────────────────────────────────────────────────
children.push(h1('Why This Document Exists'));
children.push(p(
  'Voice (PC) is Naavi\'s main competitive advantage. Every other AI assistant is screen-first. MyNaavi is the only one a person can trust as a daily driver by talking to it. Mobile is the configuration and visual-confirm surface; voice is the daily driver. This document is the work-item plan to make voice strong, reliable, and worth that bar.'
));
children.push(p(
  'Starting target: voice replicates mobile as closely as possible — same actions, same answers, same freshness. Stretch target: voice EXCEEDS mobile in voice-native ways — privacy in public, hands-free interruption, identity without typing.'
));
children.push(p(
  'This document supersedes VOICE_COMPLETION_ROADMAP_2026-05-07. The earlier version proposed eight thematic sessions; this version reframes as a list of work items in dependency order. Cadence is the user\'s call, not a constraint imposed by the document.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('What Changed Since 2026-05-07'));
children.push(p('Three substantive additions plus three corrections plus a structural reframe:'));
children.push(bulletRich([
  new TextRun({ text: 'STRUCTURE — Dropped session framing. ', bold: true }),
  new TextRun('Sessions in 2026-05-07 were thematic groupings without measured boundaries. Replaced with a flat list of work items in dependency order. The user decides when to stop and review.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'ADDED — Refreshed Parity Baseline. ', bold: true }),
  new TextRun('Without a current-state audit, "voice replicates mobile" is asserted, not measured. The 2026-05-04 audit is now four days stale and predates V57.12 / V57.13 / canned demo / Structured Outputs. Refreshing it is a prerequisite.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'ADDED — Voice Privacy UX. ', bold: true }),
  new TextRun('F1c (top-severity Feature) was missing from 2026-05-07 entirely. Voice is the surface where the user is in PUBLIC; reading medical/financial details aloud is a category-blocking UX failure. Voice-native dignity, not optional.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'ADDED — Voice Automated Regression Suite. ', bold: true }),
  new TextRun('Mobile has Maestro for UI regression. Voice has zero automated coverage today. 2026-05-07 proposed a one-shot manual 30-min test call as the acceptance gate; that is not a regression net. Need scripted Twilio calls + Deepgram + Claude action assertions.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'CORRECTED — Action Parity rescoped. ', bold: true }),
  new TextRun('2026-05-07 listed DELETE_EVENT / LIST_RULES / DELETE_MEMORY / SCHEDULE_MEDICATION as missing on voice. Code research 2026-05-08: only SCHEDULE_MEDICATION is genuinely missing. Other three already at parity post V57.12 voice tool-use migration (lines 1938, 6411, 1967 in naavi-voice-server/src/index.js).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'CORRECTED — Voice Unification starting state. ', bold: true }),
  new TextRun('2026-05-07 said "phone uses Polly Joanna, mobile uses Aura Hera." Verified in code 2026-05-08: BOTH surfaces run Aura Hera on production calls. Polly only appears on the demo-line Twilio Say prompts. Migration target unchanged (everything → Polly Joanna), but starting state described needed correction.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'CORRECTED — Soft "Done when…" replaced with explicit parity tests. ', bold: true }),
  new TextRun('Each work item now has a measurable Parity test alongside a Done-when criterion. The parity test answers: does voice produce the same action emission / same answer as mobile for case X?'),
]));

// ────────────────────────────────────────────────────────────────
children.push(h1('Definition: Voice Replicates Mobile + Voice-Native Dignity'));
children.push(p('Voice has reached the bar when:'));
children.push(h2('Replicates mobile'));
children.push(bulletRich([
  new TextRun({ text: 'Same actions. ', bold: true }),
  new TextRun('Every action mobile can do, voice can do (with surface-appropriate adaptations).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Same answers. ', bold: true }),
  new TextRun('Voice produces the same answer as mobile for the same input. Live data freshness, same prompt context, same backstops.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Same prompt understanding. ', bold: true }),
  new TextRun('Voice and mobile agree on what the user just asked for. No surface-specific drift in what Claude emits.'),
]));
children.push(h2('Voice-native dignity'));
children.push(bulletRich([
  new TextRun({ text: 'More private than mobile in public spaces. ', bold: true }),
  new TextRun('Privacy-tagged content prompts SMS-fallback instead of being read aloud.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'More interruptible than mobile. ', bold: true }),
  new TextRun('"Naavi stop" cuts TTS instantly. First word never dropped. Barge-in works.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Recognizes user without typing. ', bold: true }),
  new TextRun('Multi-phone fast path + biometric fallback. No PIN, no password.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Speaks naturally. ', bold: true }),
  new TextRun('Numbers, dates, postal codes, addresses, names — all sound like a person, not a machine.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Sounds the same as mobile. ', bold: true }),
  new TextRun('One voice across both surfaces so familiarity carries.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Demo line converts. ', bold: true }),
  new TextRun('A stranger calling 1-888-91-NAAVI ends the call having seen value, given their name, opted in, and visited /start.'),
]));

// ────────────────────────────────────────────────────────────────
children.push(h1('Architectural Principle (Wael 2026-05-08)'));
children.push(p('Every queryable channel = background sync at per-channel depth + live-overlay at question-time. Applies to calendar, email, SMS, WhatsApp.'));
children.push(p('Today calendar has the live-overlay (V57.11.2 / V57.11.6 mobile; voice still on snapshot). Email has the sync only — no live-overlay yet. SMS / WhatsApp inbound is uncaptured. The principle applies to every new queryable channel that gets added.'));
children.push(p('On voice specifically, this means every "what\'s on my calendar / what bills do I have / did Bob email me" question hits a live source plus the cached snapshot, merged before Claude sees it.'));

// ────────────────────────────────────────────────────────────────
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h1('Work Items In Dependency Order'));
children.push(p(
  'Work items are listed in the order their outputs become available to subsequent items. The user decides cadence. Some work items have external blockers (Picovoice, AWS); those wait until the blocker resolves. Otherwise work flows continuously.'
));

// W0 — Refreshed Parity Baseline ───────────────────────────────────
children.push(workItemHeader('0', 'Refreshed Parity Baseline (prerequisite)', 'Server-only'));
children.push(p('The 2026-05-04 parity audit is now stale and incomplete. Refresh it before any other work so subsequent items have a measured "what voice is missing" reference.'));
children.push(bulletRich([
  new TextRun({ text: 'Action coverage table — ', bold: true }),
  new TextRun('verify each action by reading code, not by trusting the previous audit. Mark "DRIFT" only where current code differs.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Prompt context comparison — ', bold: true }),
  new TextRun('what mobile injects vs what voice injects. User name, phone, addresses, calendar events, brief items, knowledge fragments, lists — same shape, same order, same freshness?'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Backstop coverage — ', bold: true }),
  new TextRun('mobile has the phantom-action loop in useOrchestrator.ts (chain-store auto-fix, LIST_RULES speech override, FETCH_TRAVEL_TIME backstop, etc.). What does voice have? Where are the gaps?'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Knowledge access parity — ', bold: true }),
  new TextRun('does voice see the same knowledge_fragments mobile sees? Same filters, same truncation thresholds?'),
]));
children.push(bulletRich([
  new TextRun({ text: 'TTS normalization deltas — ', bold: true }),
  new TextRun('three known: postal phonetics (mobile lacks), province codes (mobile lacks), ordinals (voice lacks). Verify catalog still applies; check for new ones.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Latency baseline — ', bold: true }),
  new TextRun('measure voice round-trip on 10 trivial questions; identify dominant component (STT, Claude, TTS, network). Establish target: voice = mobile + (STT + TTS overhead).'),
]));
children.push(parityCriterion('A current-dated audit document lists every action / context / backstop / knowledge / TTS / latency drift between voice and mobile, with code line citations. Subsequent work items reference this baseline by line.'));
children.push(dod('docs/MOBILE_VS_PHONE_AUDIT_2026-05-08.docx exists, replaces the stale 2026-05-04 version, and lists every drift with measured evidence (code line, transcript, latency number).'));

// W1 — Voice Quality Foundation ────────────────────────────────────
children.push(workItemHeader('1', 'Voice Quality Foundation', 'Server-only'));
children.push(p('Fix the things that make the user lose trust mid-conversation. Architectural principle (sync + live-overlay) lands here. Picker robustness and self-cleansing memory are quality issues, not new features.'));
children.push(bulletRich([
  new TextRun({ text: 'Voice live-calendar fetch (B1a) — ', bold: true }),
  new TextRun('mirror naavi-chat::fetchLiveCalendarEvents into voice server. Replace fetchCalendarEvents call sites at lines 1441, 3281, 6744 with the live Google API path (refresh-token + Cache-Control: no-cache + Pragma: no-cache).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Stop-word interrupt regression (B2b) — ', bold: true }),
  new TextRun('strip leading wake-word in the stopWords matcher at naavi-voice-server line 5161 so "Naavi stop" matches as well as bare "stop". Optional follow-up: fire on interim transcripts (not just FINAL) for faster cut-off.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Deepgram first-word truncation on barge-in (B2c) — ', bold: true }),
  new TextRun('extend the trivial fast-path regex at naavi-voice-server line 1343 to cover leading-word-clipped variants (time / day / date). Track audio-prebuffer / endpointing-tuning / STT-retry options separately if loss persists post-fix.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice name-search keyterm verification (B2d) — ', bold: true }),
  new TextRun('verify "Hussein" and similar high-value names are in user_settings.voice_keyterms OR knowledge_fragments type=relationship. If still mistranscribing despite keyterm priming, escalate to phonetic fallback (Soundex / Metaphone / Levenshtein on transcript).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Picker robustness on voice — ', bold: true }),
  new TextRun('V57.13.3 no-cache architecture surfaces a Google picker on every "alert me at X". Voice STT for "the second one" / "the Innes Road one" / "two" / barge-in mid-list is the gate. Quality issue, not feature.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Self-cleansing memory on voice — ', bold: true }),
  new TextRun('STT mistranscriptions create malformed entries (one "Hussein" becomes three contacts). Phonetic-merge on read; detect-and-flag malformed memory at fetch time. Every read sheds degraded data.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Email instant-search live-overlay (B1c) — ', bold: true }),
  new TextRun('Apply the architectural principle to email. 7-day sync stays; ADD live Gmail API search at question-time (q= against subject + body, Cache-Control: no-cache, merge with cached gmail_messages). Same shape as fetchLiveCalendarEvents.'),
]));
children.push(parityCriterion('A 5-minute call covering "next meeting", "stop", a name lookup, "what time is it?", "did Bob email me about the renewal?" and a multi-result location query has zero stale answers, zero dropped first words, picks the right option from the picker, stops on command, and never persists a malformed memory entry. Voice answers match what mobile would say for the same questions.'));
children.push(dod('All seven work items above are deployed and the test call passes. Self-cleansing memory log shows zero unhandled malformed-entry detections over a week.'));

// W2 — Voice Action Parity ─────────────────────────────────────────
children.push(workItemHeader('2', 'Voice Action Parity (rescoped)', 'Server-only'));
children.push(p('2026-05-07 listed four missing actions; 2026-05-08 code research showed only one is genuinely missing. The other three are at parity post V57.12 voice tool-use migration. Plus the LIST_RULES backstop gap on voice.'));
children.push(bulletRich([
  new TextRun({ text: 'SCHEDULE_MEDICATION on voice (B2a) — ', bold: true }),
  new TextRun('port the mobile handler at hooks/useOrchestrator.ts line 1549 into the voice server switch statement. Uses the same backend (loop of create-calendar-event calls).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'LIST_RULES voice-side speech-override backstop (B1b voice half) — ', bold: true }),
  new TextRun('voice has the LIST_RULES handler at line 6411 but lacks the phantom-action speech-override that mobile got in V57.11.6. When voice Claude says "you have 3 alerts" without emitting LIST_RULES, voice has no guardrail. Add the backstop in same shape as mobile\'s useOrchestrator.ts line 1207 entry. (Mobile half — synthesizing the LIST_RULES action when the backstop fires — is B1b mobile-side; AAB-required.)'),
]));
children.push(bulletRich([
  new TextRun({ text: 'DELETE_MEMORY behavior-diff sweep — ', bold: true }),
  new TextRun('voice does direct DB DELETE on knowledge_fragments by ILIKE keyword (line 1967); mobile path may differ subtly. Verify same set of fragments is removed for the same input across both surfaces. Fix any divergence.'),
]));
children.push(parityCriterion('On a single phone call, the user can: list their alerts ("you have 4 alerts: …" with the right count and the right alerts), schedule a medication ("remind me at 8 am and 8 pm to take Lipitor for 30 days") and see the events appear in Google Calendar, and forget a memory ("forget that I take Lipitor") and have the same number of fragments removed as the mobile equivalent would remove.'));
children.push(dod('SCHEDULE_MEDICATION shipped on voice with the same Edge Function backend as mobile. LIST_RULES backstop deployed on voice. DELETE_MEMORY parity verified by side-by-side test (same input, same removal count).'));

// W3 — Voice Privacy UX ────────────────────────────────────────────
children.push(workItemHeader('3', 'Voice Privacy UX (4-piece bundle)', 'Both'));
children.push(p('F1c — top-severity Feature, missing from 2026-05-07 entirely. Voice is the surface where users are in PUBLIC. Reading medical / financial / legal content aloud at full volume is a category-blocking failure. Wael 2026-04-20 directive: ship all four pieces together; piece 1 alone has no user-visible effect.'));
children.push(bulletRich([
  new TextRun({ text: 'Per-result privacy labels — ', bold: true }),
  new TextRun('extend the existing SearchAdapter.privacyTag field from hardcoded "general" to per-result classification. Drive + email_actions adapters compute from document_type: medical → "medical"; tax / statement → "financial"; contract → "legal"; else → "general".'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Privacy mode toggle — ', bold: true }),
  new TextRun('add user_settings.privacy_mode_default column (always / manual / off). Mobile Settings UI surface to flip it. Voice command at call start: "Naavi, I\'m not alone" sets mode for the current call only.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice-server decision layer — ', bold: true }),
  new TextRun('pre-TTS check: if privacy mode on AND result tag in [medical, financial, legal], speak a short title only and offer "Want me to text it to your phone?" On "yes" → fire send-sms with full details. On "go ahead" / "read it" → speak details. On "skip" → continue.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Per-category preferences — ', bold: true }),
  new TextRun('user_settings.privacy_medical / privacy_financial / privacy_legal columns, each "always" / "privacy_mode" / "never". Voice decision layer consults these before applying privacy mode. Settings UI surface.'),
]));
children.push(parityCriterion('Privacy mode off → voice behavior unchanged from today (regression check). Privacy mode on, asked about a medical item → Naavi offers SMS fallback before reading. Reply "text it" → SMS arrives with full details and call continues. Category preference medical=always → medical items are private even when privacy mode is off.'));
children.push(dod('All four pieces shipped together. Test plan above passes. Mobile Settings UI exposes the toggle + per-category preferences. Privacy mode honored on voice.'));

// W4 — Voice Identity: Multi-Phone ─────────────────────────────────
children.push(workItemHeader('4', 'Voice Identity — Multi-Phone Fast Path', 'Both'));
children.push(p('Today, only one phone number per user is recognized. Calls from work cell / borrowed phone / etc. are rejected. Adding additional_phones[] is the cheap fix that covers the vast majority of secondary-phone cases — and decouples cleanly from the biometric work below.'));
children.push(bulletRich([
  new TextRun({ text: 'Schema + lookup — ', bold: true }),
  new TextRun('ALTER TABLE user_settings ADD COLUMN additional_phones TEXT[] + index. Extend getUserIdByPhone (naavi-voice-server line 497) to match user_settings.phone OR any entry in additional_phones[].'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Mobile UI to manage the list — ', bold: true }),
  new TextRun('Settings screen: list of phones with primary marker, add / remove / label. Drives the AAB build.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Per-phone SMS verification — ', bold: true }),
  new TextRun('non-negotiable. Without verification a user could claim someone else\'s phone number. Send 6-digit code to the phone; user enters in Settings before phone is added. New verify-additional-phone Edge Function.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Fix the rejection wording — ', bold: true }),
  new TextRun('"this number isn\'t registered" is misleading on a multi-phone account. Reword to acknowledge multi-phone and demo-line greeting flow.'),
]));
children.push(parityCriterion('A user with two verified phones can call from either and be recognized. A user trying to add an unverified phone is blocked at the SMS-code step. The rejection wording matches reality.'));
children.push(dod('additional_phones[] schema deployed, voice lookup honors it, Settings UI ships in next AAB, SMS verification path verified end-to-end.'));

// W5 — Voice Identity: Biometric ───────────────────────────────────
children.push(workItemHeader('5', 'Voice Identity — Biometric Fallback', 'BLOCKED on Picovoice'));
children.push(p('F3a — deferred per the holding-list classification (revisit when unknown-number caller confusion shows up as a real pattern). Path A approved 2026-05-07: wait on Picovoice with deadline; ID R&D as backup. Stays on this list as a forward-looking entry; does not block W4 multi-phone.'));
children.push(bulletRich([
  new TextRun({ text: 'Picovoice Eagle integration — ', bold: true }),
  new TextRun('server-side voiceprint capture + verification on each unknown caller. Sample phrase: "my voice is my password" (verifying voiceprint, not words).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Enrollment flow — ', bold: true }),
  new TextRun('first call from an unknown number captures three reads of the phrase, stores voiceprint against user_id.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Verification flow — ', bold: true }),
  new TextRun('subsequent unknown-caller-ID calls trigger the phrase prompt; match unlocks full Naavi; miss falls through to demo greeting.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Schema cleanup — ', bold: true }),
  new TextRun('drop the dead Azure columns (azure_voice_profile_id, azure_voice_offered_at) in the same migration that adds picovoice_voice_profile_id (or generic voice_profile_id).'),
]));
children.push(parityCriterion('A user calling from any phone in the world can prove they are themselves by speaking the phrase. The rejection lane becomes a fallback only when both Caller ID and biometric fail.'));
children.push(dod('Enrollment + verification ship; rejection lane is now last-resort.'));

// W6 — Voice Unification: Polly Joanna ─────────────────────────────
children.push(workItemHeader('6', 'Voice Unification — Polly Joanna', 'BLOCKED on AWS'));
children.push(p('CORRECTED starting state: BOTH surfaces today run Aura Hera on production calls (verified in code 2026-05-08). The 2026-05-07 description claiming "phone Polly / mobile Aura" was wrong — Polly only appears on demo-line Twilio Say prompts. Migration target unchanged: everything → Polly Joanna.'));
children.push(bulletRich([
  new TextRun({ text: 'Pre-flight: voice fragmentation verification (B3a) — ', bold: true }),
  new TextRun('Wael 2026-05-08 reported perceiving different voices on morning brief vs in-call on +12495235394. Code reads as Aura everywhere. Need a second listener to confirm a real audible difference exists before committing migration scope. If confirmed: sweep all TTS call sites + verify Railway deployed commit matches main.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'AWS account + Polly access — ', bold: true }),
  new TextRun('one-time setup. Pay-per-use, very low cost.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice server TTS swap — ', bold: true }),
  new TextRun('replace the two Deepgram Aura Hera call sites in naavi-voice-server (lines 2547, 2587) with AWS Polly Joanna. Verify mulaw streaming + soft-tick interleaving still work. Latency budget: Polly neural is 300-600ms first-byte vs Aura sub-200ms. Soft-tick masks the gap; verify perceptually.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Mobile TTS swap — ', bold: true }),
  new TextRun('text-to-speech Edge Function at supabase/functions/text-to-speech/index.ts — replace Aura Hera with Polly Joanna. Output stays mp3; mobile code unchanged.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Edge case retest — ', bold: true }),
  new TextRun('all the existing TTS normalization (postal codes, street suffixes, ordinals) must keep working with Polly. Some rules were tuned for Aura; verify each one.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Roll back trigger — ', bold: true }),
  new TextRun('if Polly Joanna sounds noticeably worse on either surface than Aura did, rollback path is one env-var flip.'),
]));
children.push(parityCriterion('A user hangs up the phone, opens the app, and Naavi sounds identical. Latency, intonation, and pronunciation match within tolerance. Postal codes, addresses, ordinals, names all read correctly on both surfaces.'));
children.push(dod('Both surfaces on Polly Joanna with SSML rate control. TTS regression suite passes. Soft-tick still masks the small added Polly latency on calls.'));

// W7 — Voice Structured Outputs Migration ──────────────────────────
children.push(workItemHeader('7', 'Voice Structured Outputs Migration', 'Server-only'));
children.push(p('Mobile is on JSON-in-prompt today; voice is on tool-use post-V57.12. Neither uses Anthropic Structured Outputs (Nov 2025 GA). Migrate both surfaces to Structured Outputs to eliminate prompt-drift cycle at the API level. T1a — top-severity Tooling.'));
children.push(bulletRich([
  new TextRun({ text: 'Both surfaces use response_format: json_schema — ', bold: true }),
  new TextRun('schema-constrained generation, enforced at API level. Removes the chain-store auto-fix bridge (currently in mobile orchestrator).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Drop voice-side band-aids — ', bold: true }),
  new TextRun('JSON-fence stripping, similar shims. Same cleanup mobile got in V57.12.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice prompt version unification — ', bold: true }),
  new TextRun('voice and mobile fetch the same get-naavi-prompt v64+. Verify both surfaces emit identical actions for identical user inputs.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Prompt-regression suite covers both surfaces — ', bold: true }),
  new TextRun('the existing tests/catalogue/prompt-regression.ts covers mobile path. Extend or duplicate to cover voice path. Both must pass green.'),
]));
children.push(parityCriterion('For every test case in the prompt regression suite, voice and mobile emit byte-identical action arrays. The chain-store auto-fix bridge in useOrchestrator.ts is removed (no longer needed).'));
children.push(dod('Both surfaces on Structured Outputs. ~200 lines of mobile orchestrator band-aid code removed. Prompt regression suite green for both surfaces.'));

// W8 — Demo Line Maturity ──────────────────────────────────────────
children.push(workItemHeader('8', 'Demo Line Maturity', 'Server-only'));
children.push(p('F2b — three sub-pieces, kept together as one decision point. Today (2026-05-08) the demo line works as a canned 5-scenario flow with personalized greeting + name capture + SMS recap from +1-431-300-6228 + /start landing page. Now it needs to convert and be measurable.'));
children.push(bulletRich([
  new TextRun({ text: 'Telemetry — ', bold: true }),
  new TextRun('today everything is console.log only, nothing aggregates. Add events table + dashboard query: total calls, avg scenarios played, % opt-in for SMS, click-through on link, conversion to signup, scenario popularity, drop-off points.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Conversion attribution — ', bold: true }),
  new TextRun('SMS link mynaavi.com/start does not track which demo call the lead came from. Add per-call signup token in the SMS link; form captures token; DB join lets us see scenario-to-signup correlations.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Phase 2 demo data (T2b) — ', bold: true }),
  new TextRun('Phase 1 (calendar, 5 events) shipped via scripts/seed-demo-google-data.js. Phase 2 (Gmail) gap — script header ready, seed rows + run not done. Needed for richer scenarios + Maestro #6 deterministic backing.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Scenario richness — ', bold: true }),
  new TextRun('current 5 scenarios are fully hardcoded. Add more scenarios (medication scheduling, navigation, recurring delegation), variable data per call, one-level branching with canned follow-up responses. Sequence after telemetry says which scenarios engage.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Anti-abuse — ', bold: true }),
  new TextRun('rate-limit per caller-ID; cap demo session length; gracefully drop callers spamming the line.'),
]));
children.push(parityCriterion('A stranger calls 1-888-91-NAAVI, hears scenarios that map cleanly to capabilities visible in the real product, gives their name, opts into the SMS, visits /start, fills the form. Telemetry shows the funnel. Conversion attribution links the new signup back to the original demo call. Scenario richness reflects what telemetry says is engaging.'));
children.push(dod('Telemetry events table populated. Conversion attribution proven end-to-end on a test call. Phase 2 demo data seeded. Scenario richness driven by telemetry data, not guesswork. Anti-abuse caps verified.'));

// W9 — Voice Automated Regression Suite ────────────────────────────
children.push(workItemHeader('9', 'Voice Automated Regression Suite', 'Server-only'));
children.push(p('NEW 2026-05-08. Mobile has Maestro for UI regression (13 scenarios, 6/13 passing today). Voice has zero automated coverage. Manual 30-min test calls are an acceptance gate, not a regression net. Build the voice analog so subsequent voice-server changes have a safety net.'));
children.push(bulletRich([
  new TextRun({ text: 'Test framework selection — ', bold: true }),
  new TextRun('script Twilio outbound calls to a target Voice Server endpoint, capture Deepgram transcripts, parse Claude action emissions, assert against expected. Candidate stacks: Twilio test credentials + Node test runner; or third-party voice testing services. Pick based on cost and fidelity.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Initial scenario set — ', bold: true }),
  new TextRun('mirror the parity-test criteria in W1-W8 above. One scenario per parity test in this document. Plus a dozen "voice-native" scenarios (barge-in, stop, identity, privacy mode).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'CI integration — ', bold: true }),
  new TextRun('hook into the same green-before-AAB rule as npm run test:auto. Voice changes (commits to naavi-voice-server) require the voice regression suite green before deploy.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Failure-mode catalog — ', bold: true }),
  new TextRun('document and test what happens when: Twilio drops the stream mid-call; Deepgram disconnects; Claude returns 5xx; voicemail picks up; cellular signal drops; user goes silent for 60s. Each has a defined recovery behavior.'),
]));
children.push(parityCriterion('Every parity criterion in W0-W8 has a corresponding automated voice regression test. CI runs the suite on every voice-server push. A push that breaks any parity test is blocked from deploying.'));
children.push(dod('Voice regression suite running, green, integrated into the deploy gate. Failure-mode catalog complete with each entry verified by an automated test.'));

// W10 — Voice Polish + Final Verification ──────────────────────────
children.push(workItemHeader('10', 'Voice Polish + Final Verification', 'Both'));
children.push(p('Final TTS gaps and a structured verification pass on the full voice surface. Address read-back bundled (was scattered across S6 in 2026-05-07 and earlier). Plus the small B3d address-rejection wording fix.'));
children.push(bulletRich([
  new TextRun({ text: 'Address read-back as one trust bar — ', bold: true }),
  new TextRun('postal-code phonetics, street-suffix expansion (Dr → Drive), ordinal expansion (15th → fifteenth) treated as one bundled work item. V57.13.4 made full address visible on every alert surface; voice has to read it back correctly.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Verified-address rejection wording (B3d) — ', bold: true }),
  new TextRun('hooks/useOrchestrator.ts:1423 currently rejects with generic "I can\'t confirm that address." Captured destination variable is unused. Fix: name the address (`I can\'t confirm \'${destination}\' for your meeting today.`). Mirror in get-naavi-prompt line 620.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice call recording final verify — ', bold: true }),
  new TextRun('"record my visit" flow: AssemblyAI → email summary → Drive save still all working end-to-end. Memory: project_naavi_voice_recording.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Soft-tick presence audit — ', bold: true }),
  new TextRun('verify the soft-tick thinking sound plays in every silent gap — including during the now-mandatory ~1s Google Places fetch on every "alert me at X" (V57.13.3 no-cache).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Full voice regression run via W9 — ', bold: true }),
  new TextRun('use the regression suite from W9 as the structured 30-minute coverage of every action, every retrieval, every TTS edge case. No more manual one-shot acceptance test.'),
]));
children.push(parityCriterion('A full voice regression run via W9\'s suite passes every scenario. Address read-back is correct on every alert. Soft-tick fills every silent gap. The address-rejection message names the rejected address. Voice call recording end-to-end works on a real call.'));
children.push(dod('At this point voice replicates mobile and exceeds it in voice-native ways. The product is ready for real users to depend on as a daily driver.'));

// ────────────────────────────────────────────────────────────────
children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(h1('Parallel Tracks (Not Voice, But Ongoing)'));
children.push(p('These run alongside voice work and should not block it.'));
children.push(h2('Geofence Reliability'));
children.push(p(
  'Tested per Wael 2026-05-08 — no problems found. Will be reported if recurs. Phase 3 background-mode blocked by the OAuth disconnect bug; same rule applies — tracked when it surfaces, not preemptively.'
));
children.push(h2('Maestro Mobile UI Test Suite'));
children.push(p(
  'T2a — 13 scenarios in e2e/, 6/13 passing as of 2026-05-08. Triage required to separate stale assertions from real regressions before the suite becomes a pre-build gate. Independent of voice work but informs the W9 voice regression-suite design (similar discipline, different surface).'
));
children.push(h2('Mobile-Side Todo-List-Per-Alert'));
children.push(p(
  'F1a — each location alert has an attached list (lazy-create on first add; cascade-delete on alert removal). Half-session of work after 4 design questions resolved. Independent of voice but voice can later read the attached list back at fire time.'
));
children.push(h2('Onboarding Review'));
children.push(p(
  'F2a — comprehensive onboarding refresh including multi-phone (which is W4 above) plus 7 other gaps. Each gap to be reviewed before implementation. Independent of voice work; multi-phone item overlaps but does not double up.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('Explicitly Out Of Scope For This Roadmap'));
children.push(p('Things that are real work but not on the voice-completion path. Tracked elsewhere or deferred.'));
children.push(bullet('Postal code phonetics on mobile, province codes on mobile, ordinal expansion drift — three small TTS parity gaps from the parity audit. Mobile-only fixes; do not block voice.'));
children.push(bullet('UPDATE_MORNING_CALL on mobile — intentional voice-only feature; not a parity gap.'));
children.push(bullet('START_CALL_RECORDING on mobile — intentional voice-only feature; not a parity gap.'));
children.push(bullet('Mobile-only UI: Visits panel, DraftCard, brief panel, walkie-talkie, calendar PDF injection. These belong to mobile\'s role as configuration + visual-confirm surface.'));
children.push(bullet('Cosmetic ruler leak on long-wrap user bubbles (B3b) — mobile-only AAB-required cosmetic; bundle into next AAB independently.'));
children.push(bullet('Haptic vibration too subtle on Samsung long-press (B3c) — mobile-only AAB-required polish; bundle into next AAB independently.'));
children.push(bullet('Blog age-framing violations (B3e) — website cleanup; not mobile, not voice.'));
children.push(bullet('list_change / price / health alert triggers (I2a, I2b, I3a) — alert system, not voice-specific.'));
children.push(bullet('New voice features beyond replicates-mobile + voice-native dignity (Naavi-initiated calls, multi-party calls, voice-controlled lists with full Drive sync). Defer until W0-W10 complete.'));

// ────────────────────────────────────────────────────────────────
children.push(h1('Open Dependencies (External Blockers)'));
children.push(bulletRich([
  new TextRun({ text: 'Picovoice Eagle approval — ', bold: true }),
  new TextRun('W5 cannot start until the account is approved. Path A (wait with deadline) approved 2026-05-07; ID R&D as backup if no response.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'AWS account for Polly — ', bold: true }),
  new TextRun('W6 needs AWS billing setup. One-time, < 30 minutes.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Demo line curated user data — ', bold: true }),
  new TextRun('W8 needs a demo user with rich, plausible Drive/calendar/contacts/alerts. Phase 1 calendar shipped; Phase 2 Gmail seed pending (T2b).'),
]));
children.push(bulletRich([
  new TextRun({ text: 'npm run test:auto fully green before each AAB — ', bold: true }),
  new TextRun('hard rule (CLAUDE.md). W3, W4, W6 build AABs; all must pass the full suite first.'),
]));
children.push(bulletRich([
  new TextRun({ text: 'Voice regression suite green before each voice deploy (after W9 lands) — ', bold: true }),
  new TextRun('parallel rule. Once W9 is in place, voice-server commits gate on the voice regression suite the same way mobile commits gate on test:auto.'),
]));

// ────────────────────────────────────────────────────────────────
children.push(h1('How This Differs From The Parity Audit (and the Holding List Classification)'));
children.push(p(
  'The parity audit (MOBILE_VS_PHONE_AUDIT — 2026-05-04 stale, will be refreshed in W0) catalogs every drift between the two surfaces, treating mobile and voice as equal partners. It is reference material — useful for spotting drift, not for ordering work.'
));
children.push(p(
  'The holding list classification (HOLDING_LIST_CLASSIFICATION_2026-05-08) catalogs all 26 items from the V57.13.7 handoff plus one missed item (B1c) classified into Bugs / Features / Tooling / Ideas with severity-encoded IDs. Useful for understanding the boundary of Naavi as a product, not for ordering voice work specifically.'
));
children.push(p(
  'This roadmap is voice-first. It includes drift items that block voice completion, ignores drift items that only affect mobile, and adds voice-quality work that does not appear in the audit at all (latency, first-word truncation, stop-word, voice unification, biometric, picker robustness, self-cleansing memory, demo line maturity, structured outputs migration, automated regression suite, voice privacy UX). Read this for what to do next; read the audit when you need a line number; read the classification doc when you need to know where every item lives.'
));

// ────────────────────────────────────────────────────────────────
children.push(h1('Bottom Line'));
children.push(p(
  'Eleven work items (W0-W10), three external blockers (Picovoice, AWS, demo data curation), zero imposed cadence. At the end of W10, voice replicates mobile on every action and answer, exceeds mobile in voice-native dignity (privacy, interruption, identity), and is locked behind an automated regression suite that catches drift before deploy. That is the competitive moat realized.'
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

const outPath = path.join(__dirname, '..', 'docs', 'VOICE_COMPLETION_ROADMAP_2026-05-08.docx');

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log('Wrote', outPath);
});
