# F2b Scenario Walkthrough — Full Consolidated Diff (all 5 commits)

Companion to `docs/F2B_SCENARIO_WALKTHROUGH_PHASE5_EVIDENCE_2026-07-01.md`. This file is the actual diff text for Phase 6 (ChatGPT technical review) — paste this whole file into ChatGPT alongside the Evidence Package.

Repo: `naavi-voice-server`, branch `staging`. Range: `64a221f^..HEAD` (i.e. everything since the pre-Phase-4 base, collapsing all 5 commits below into one unified diff):

1. `64a221f` — feat: F2b Phase 4 — scenario walkthrough before the reminder flow
2. `e90ab54` — fix: closer line names "another example" instead of dangling "another"
3. `0b58134` — fix: Recap SMS now fires at true end of call, not walkthrough handoff
4. `81c04a7` — fix: trim chattiness — three cuts approved after live call test
5. `039629a` — fix: further chattiness trims — zero-friction-call philosophy

`main` branch of `naavi-voice-server` confirmed untouched throughout (still `d7fafdc`).

---

```diff
diff --git a/src/index.js b/src/index.js
index ce30b4f..783b109 100644
--- a/src/index.js
+++ b/src/index.js
@@ -17,6 +17,16 @@ const listGate = require('./list_confirm_gate.js');
 const { parseTimezone, DEFAULT_TIMEZONE, getZoneLabel } = require('./voice/parseTimezone.js');
 const { parseReminderTime, formatSpokenDateTime } = require('./voice/parseReminderTime.js');
 const { getDemoEnvironment, getDemoEnvironmentByName } = require('./voice/getDemoEnvironment.js');
+const {
+  DEMO_SCENARIO_ORDER,
+  DEMO_WALKTHROUGH_SCENARIOS,
+  wantsToMoveToReminder,
+  getWalkthroughBridgeLine,
+  getDeclineLine,
+  getCloserLine,
+  getCapReachedLine,
+} = require('./voice/scenarioWalkthrough.js');
+const { SCENARIO_RECAP_LINES, buildRecapSmsBody } = require('./voice/recapSms.js');
 
 // Diagnostic mirror for the DELETE_RULE confirmation-gate flow (Wael
 // 2026-05-13). Fire-and-forget POST to client_diagnostics, step
@@ -6891,13 +6901,9 @@ const DEMO_DIGIT_MAP = {
 // One-line recap of each scenario. Used in the post-call SMS so the
 // caller has a refresher of what they heard. The set of lines included
 // is whatever they actually played during the call (state.playedScenarios).
-const SCENARIO_RECAP_LINES = {
-  today:    'Today: your day in one breath.',
-  bills:    'Bills: PDFs read straight from your inbox.',
-  history:  'History: when you last did anything.',
-  location: 'Location: an alert when you arrive somewhere.',
-  capture:  'Capture: anything you want me to remember.',
-};
+// F2b Phase 4 (2026-07-01) — moved to voice/recapSms.js so there is exactly
+// one definition, shared by this (now dead-path) CTA flow and the new
+// Recap SMS. `SCENARIO_RECAP_LINES` is imported at the top of this file.
 
 // Per-call state for the canned demo. Cleaned up when the call's CTA
 // completes OR the watchdog at /voice/demo/connect (no longer used by
@@ -7127,6 +7133,51 @@ async function sendDemoCtaSms(toPhone, callerName, playedScenarios) {
   }
 }
 
+// F2b Phase 4 — Recap SMS. Sent automatically (no permission ask, per
+// docs/F2B_SCENARIO_WALKTHROUGH_SCRIPT_2026-07-01.md §5) the moment the
+// scenario walkthrough hands off into the reminder flow. Fully independent
+// of the Reminder SMS (buildDemoReminderSmsBody below) — different
+// trigger, different timing, different template. Fire-and-forget: a
+// failure here must never block or delay the reminder flow.
+async function sendRecapSms(toPhone, callerName, playedScenarios) {
+  const accountSid = process.env.TWILIO_ACCOUNT_SID;
+  const authToken = process.env.TWILIO_AUTH_TOKEN;
+  if (!accountSid || !authToken || !toPhone) {
+    console.error('[Voice/Demo/F2b] Recap SMS missing creds or phone');
+    return false;
+  }
+  if (!playedScenarios || (playedScenarios.size ?? playedScenarios.length) === 0) {
+    // Nothing was demoed (caller declined every scenario) — no recap to send.
+    return false;
+  }
+  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
+  const params = new URLSearchParams({
+    To: toPhone,
+    From: DEMO_SMS_FROM,
+    Body: buildRecapSmsBody(callerName, playedScenarios),
+  });
+  try {
+    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
+      method: 'POST',
+      headers: {
+        'Authorization': `Basic ${credentials}`,
+        'Content-Type': 'application/x-www-form-urlencoded',
+      },
+      body: params,
+    });
+    if (!r.ok) {
+      const err = await r.text();
+      console.error(`[Voice/Demo/F2b] Recap SMS failed ${r.status}: ${err.slice(0, 200)}`);
+      return false;
+    }
+    console.log(`[Voice/Demo/F2b] Recap SMS sent to ${toPhone}`);
+    return true;
+  } catch (err) {
+    console.error('[Voice/Demo/F2b] Recap SMS exception:', err && err.message);
+    return false;
+  }
+}
+
 app.post('/voice/demo/menu', rejectIfShuttingDown, express.urlencoded({ extended: false }), async (req, res) => {
   const host = req.headers.host;
   const callSid = String(req.query.callSid || req.body.CallSid || '');
@@ -7251,12 +7302,14 @@ app.post('/voice/demo/name', rejectIfShuttingDown, express.urlencoded({ extended
       // F2b (2026-07-01) — was redirecting to the canned 5-scenario menu.
       // Per docs/F2B_PHASE2_CHANGE_PLAN_2026-07-01.md, F2b's reminder flow
       // replaces the menu as the live demo experience; the menu code is
-      // kept in the file but no longer reached from this path. Proceeds
-      // anonymously (no name) straight into the context + timezone ask.
-      console.log(`[Voice/Demo] giving up on name after ${attempt} attempts — proceeding anonymously to F2b reminder flow`);
+      // kept in the file but no longer reached from this path.
+      // Phase 4 (2026-07-01) — now proceeds anonymously (no name) into the
+      // new scenario walkthrough (docs/F2B_SCENARIO_WALKTHROUGH_SCRIPT_2026-07-01.md),
+      // which itself hands off into the context + timezone ask once done.
+      console.log(`[Voice/Demo] giving up on name after ${attempt} attempts — proceeding anonymously to scenario walkthrough`);
       const callSid = req.body.CallSid || '';
       const callerPhone = req.body.From || '';
-      res.type('text/xml').send(buildDemoContextAndTimezoneTwiml(host, callSid, callerPhone, '', environment, 1));
+      res.type('text/xml').send(buildDemoWalkthroughGateTwiml(host, 0, 0, [], callSid, callerPhone, '', environment, 1));
       return;
     }
     res.type('text/xml').send(buildDemoAskNameTwiml(host, attempt + 1, environment));
@@ -7286,10 +7339,12 @@ app.post('/voice/demo/confirm', rejectIfShuttingDown, express.urlencoded({ exten
   if (yes) {
     // F2b (2026-07-01) — replaces the canned 5-scenario menu redirect.
     // See note on the name-fail branch above.
+    // Phase 4 (2026-07-01) — routes into the scenario walkthrough first;
+    // the walkthrough hands off into the reminder flow once done.
     const callerPhone = req.body.From || '';
     const inboundCallSid = req.body.CallSid || '';
-    console.log(`[Voice/Demo] confirm yes — routing to F2b reminder flow (CallSid=${inboundCallSid} caller=${callerPhone} name=${name} env=${environment})`);
-    res.type('text/xml').send(buildDemoContextAndTimezoneTwiml(host, inboundCallSid, callerPhone, name, environment, 1));
+    console.log(`[Voice/Demo] confirm yes — routing to scenario walkthrough (CallSid=${inboundCallSid} caller=${callerPhone} name=${name} env=${environment})`);
+    res.type('text/xml').send(buildDemoWalkthroughGateTwiml(host, 0, 0, [], inboundCallSid, callerPhone, name, environment, 1));
     return;
   }
 
@@ -7354,14 +7409,195 @@ function buildDemoReminderSmsBody(callerName, message, isImmediate) {
     + `Connect your account here: https://mynaavi.com/start Reply STOP to opt out.`;
 }
 
-function buildDemoContextAndTimezoneTwiml(host, callSid, callerPhone, callerName, environment, attempt) {
+// ─── F2b Phase 4 — Scenario walkthrough ──────────────────────────────────
+//
+// Plays up to DEMO_MAX_SCENARIOS of the 5 DEMO_SCENARIO_ORDER scenarios as
+// a yes/no-gated conversation, then hands off into the reminder flow
+// below. Confirmed line-by-line in
+// docs/F2B_SCENARIO_WALKTHROUGH_SCRIPT_2026-07-01.md. Fully stateless —
+// idx/played/playedNames travel through Twilio action-URL query params
+// for the call only, same pattern as the reminder flow itself. No
+// database, no in-memory Map (unlike the old, no-longer-routed-to
+// DEMO_SCENARIOS menu above, which used demoCallState).
+const DEMO_WALKTHROUGH_MAX_ATTEMPTS = 2;
+
+function parsePlayedNames(raw) {
+  return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
+}
+
+// Single choke point for every exit out of the walkthrough (cap reached,
+// caller asked to move to the reminder, scenarios exhausted). Does NOT
+// send the Recap SMS here — live-call feedback (2026-07-01) caught that
+// sending "thanks for trying Naavi" while the caller is still mid-call
+// (about to set up the reminder) reads as illogical: it summarizes the
+// call before the call is over. `playedNames` is instead threaded through
+// every step of the reminder flow below and the Recap SMS fires at
+// whichever point the call actually ends (success, decline, or error).
+function transitionFromWalkthroughToReminder(host, callSid, callerPhone, callerName, environment, playedNames, prefix = '') {
+  return buildDemoContextAndTimezoneTwiml(host, callSid, callerPhone, callerName, environment, 1, prefix, playedNames);
+}
+
+function buildDemoWalkthroughGateTwiml(host, idx, played, playedNames, callSid, callerPhone, callerName, environment, attempt) {
+  const scenarioName = DEMO_SCENARIO_ORDER[idx];
+  const scenario = DEMO_WALKTHROUGH_SCENARIOS[scenarioName];
+  const action = buildDemoActionUrl(host, '/voice/demo/walkthrough/gate', {
+    callSid: callSid || '', callerPhone: callerPhone || '', callerName: callerName || '',
+    env: environment, idx: String(idx), played: String(played), playedNames: playedNames.join(','),
+    attempt: String(attempt),
+  });
+  let prompt;
+  if (attempt > 1) {
+    prompt = `Sorry, I didn't catch that. ${scenario.gate}`;
+  } else if (idx === 0 && played === 0) {
+    // First scenario of the call — prepend the confirmed bridge line
+    // (states the reason: not connected to real calendar/emails yet).
+    prompt = `${getWalkthroughBridgeLine(callerName)}${scenario.gate}`;
+  } else {
+    prompt = scenario.gate;
+  }
+  return `<?xml version="1.0" encoding="UTF-8"?>
+<Response>
+  <Gather input="speech" action="${action}" speechTimeout="2" speechModel="phone_call" language="en-US">
+    <Say voice="Polly.Joanna">${prompt}</Say>
+  </Gather>
+  <Redirect method="POST">${action}</Redirect>
+</Response>`;
+}
+
+app.post('/voice/demo/walkthrough/gate', rejectIfShuttingDown, express.urlencoded({ extended: false }), async (req, res) => {
+  const host = req.headers.host;
+  const callSid = req.query.callSid || req.body.CallSid || '';
+  const callerPhone = req.query.callerPhone || req.body.From || '';
+  const callerName = req.query.callerName || '';
+  const environment = req.query.env === 'staging' ? 'staging' : 'production';
+  const idx = parseInt(req.query.idx || '0', 10);
+  const played = parseInt(req.query.played || '0', 10);
+  const playedNames = parsePlayedNames(req.query.playedNames);
+  const attempt = parseInt(req.query.attempt || '1', 10);
+  const speechResult = String(req.body.SpeechResult || '').toLowerCase();
+  const yes = /\b(yes|yeah|yep|yup|sure|correct|right|okay|ok)\b/.test(speechResult);
+  const no = /\b(no|nope|not really|skip|pass)\b/.test(speechResult);
+  const scenarioName = DEMO_SCENARIO_ORDER[idx];
+  console.log(`[Voice/Demo/F2b/walkthrough] gate idx=${idx}(${scenarioName}) played=${played} attempt=${attempt} speech="${speechResult}" yes=${yes} no=${no}`);
+
+  if (!scenarioName) {
+    // Defensive — idx somehow out of range. Hand off to the reminder flow
+    // rather than error out.
+    res.type('text/xml').send(transitionFromWalkthroughToReminder(host, callSid, callerPhone, callerName, environment, playedNames));
+    return;
+  }
+
+  if (yes) {
+    const scenario = DEMO_WALKTHROUGH_SCENARIOS[scenarioName];
+    const newPlayed = played + 1;
+    const newPlayedNames = [...playedNames, scenarioName];
+    const atCap = newPlayed >= DEMO_MAX_SCENARIOS;
+    const noneLeft = idx + 1 >= DEMO_SCENARIO_ORDER.length;
+
+    if (atCap || noneLeft) {
+      // Cap reached (or all 5 offered) — the cap-reached line always fires
+      // regardless of what the caller says next (plan §8 test 8), so this
+      // is a statement, not a question. Hands straight into the reminder
+      // flow's existing prompt as one combined Say.
+      res.type('text/xml').send(transitionFromWalkthroughToReminder(
+        host, callSid, callerPhone, callerName, environment, newPlayedNames,
+        `${scenario.body} <break time="800ms"/> ${getCapReachedLine()} <break time="500ms"/> `,
+      ));
+      return;
+    }
+
+    const closerAction = buildDemoActionUrl(host, '/voice/demo/walkthrough/closer', {
+      callSid: callSid || '', callerPhone: callerPhone || '', callerName: callerName || '',
+      env: environment, idx: String(idx), played: String(newPlayed), playedNames: newPlayedNames.join(','),
+    });
+    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
+<Response>
+  <Gather input="speech" action="${closerAction}" speechTimeout="3" speechModel="phone_call" language="en-US">
+    <Say voice="Polly.Joanna">${scenario.body} <break time="800ms"/> ${getCloserLine()}</Say>
+  </Gather>
+  <Redirect method="POST">${closerAction}</Redirect>
+</Response>`);
+    return;
+  }
+
+  if (no || attempt >= DEMO_WALKTHROUGH_MAX_ATTEMPTS) {
+    const noneLeft = idx + 1 >= DEMO_SCENARIO_ORDER.length;
+    if (noneLeft) {
+      // Declined the last scenario — nothing left to offer. Hand off
+      // straight into the reminder flow, no cap-reached framing (nothing
+      // was necessarily demoed to summarize).
+      res.type('text/xml').send(transitionFromWalkthroughToReminder(host, callSid, callerPhone, callerName, environment, playedNames));
+      return;
+    }
+    const nextAction = buildDemoActionUrl(host, '/voice/demo/walkthrough/gate', {
+      callSid: callSid || '', callerPhone: callerPhone || '', callerName: callerName || '',
+      env: environment, idx: String(idx + 1), played: String(played), playedNames: playedNames.join(','), attempt: '1',
+    });
+    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
+<Response>
+  <Say voice="Polly.Joanna">${getDeclineLine()}</Say>
+  <Redirect method="POST">${nextAction}</Redirect>
+</Response>`);
+    return;
+  }
+
+  res.type('text/xml').send(buildDemoWalkthroughGateTwiml(host, idx, played, playedNames, callSid, callerPhone, callerName, environment, attempt + 1));
+});
+
+app.post('/voice/demo/walkthrough/closer', rejectIfShuttingDown, express.urlencoded({ extended: false }), async (req, res) => {
+  const host = req.headers.host;
+  const callSid = req.query.callSid || req.body.CallSid || '';
+  const callerPhone = req.query.callerPhone || req.body.From || '';
+  const callerName = req.query.callerName || '';
+  const environment = req.query.env === 'staging' ? 'staging' : 'production';
+  const idx = parseInt(req.query.idx || '0', 10);
+  const played = parseInt(req.query.played || '0', 10);
+  const playedNames = parsePlayedNames(req.query.playedNames);
+  const speechResult = String(req.body.SpeechResult || '').toLowerCase();
+  const explicitNo = /\b(no|nope|not now)\b/.test(speechResult);
+  const moveToReminder = explicitNo || wantsToMoveToReminder(speechResult);
+  console.log(`[Voice/Demo/F2b/walkthrough] closer idx=${idx} played=${played} speech="${speechResult}" moveToReminder=${moveToReminder}`);
+
+  if (moveToReminder) {
+    res.type('text/xml').send(transitionFromWalkthroughToReminder(host, callSid, callerPhone, callerName, environment, playedNames));
+    return;
+  }
+
+  // Per the approved plan (docs/F2B_SCENARIO_WALKTHROUGH_PHASE2_2026-07-01.md
+  // §2/§7): a literal "yes" or any unrecognized answer both advance to the
+  // next scenario — the caller is staying in the loop either way.
+  const noneLeft = idx + 1 >= DEMO_SCENARIO_ORDER.length;
+  if (noneLeft) {
+    res.type('text/xml').send(transitionFromWalkthroughToReminder(
+      host, callSid, callerPhone, callerName, environment, playedNames,
+      `${getCapReachedLine()} <break time="500ms"/> `,
+    ));
+    return;
+  }
+  res.type('text/xml').send(buildDemoWalkthroughGateTwiml(host, idx + 1, played, playedNames, callSid, callerPhone, callerName, environment, 1));
+});
+
+function buildDemoContextAndTimezoneTwiml(host, callSid, callerPhone, callerName, environment, attempt, prefix = '', playedNames = []) {
   const action = buildDemoActionUrl(host, '/voice/demo/timezone', {
     callSid: callSid || '', callerPhone: callerPhone || '', callerName: callerName || '',
-    env: environment, attempt: String(attempt),
+    env: environment, attempt: String(attempt), playedNames: playedNames.join(','),
   });
+  // F2b Phase 4 — `prefix` lets the scenario walkthrough hand off into this
+  // existing prompt with one extra sentence prepended (the scenario body +
+  // closing line), instead of a separate TwiML round trip. Only used on
+  // attempt 1, straight from the walkthrough's transition point; every
+  // other caller of this function omits it (defaults to '').
+  // Trimmed per live-call feedback (2026-07-01) — the original line
+  // ("People use me to remember things, manage their calendars...") was
+  // pure repetition by the time it's reached: the caller just heard 1-3
+  // live examples of exactly those capabilities in the walkthrough. 30
+  // words -> 12. Skipped entirely when a prefix is present (the
+  // cap-reached path) — that prefix already ends with its own "let's set
+  // up a real one for you now," so adding this sentence too would repeat
+  // the same phrase twice in a row (caught in local smoke test).
+  const transitionLine = prefix ? '' : "Let's set up a real one for you. ";
   const prompt = attempt === 1
-    ? `People use me to remember things, manage their calendars, organize tasks, and stay on top of `
-      + `life — all by voice. Let's try it together. <break time="400ms"/> What city or time zone are you in?`
+    ? `${prefix}${transitionLine}<break time="400ms"/> What city or time zone are you in?`
     : `Sorry, I didn't catch that. What city or time zone are you in?`;
   return `<?xml version="1.0" encoding="UTF-8"?>
 <Response>
@@ -7372,10 +7608,10 @@ function buildDemoContextAndTimezoneTwiml(host, callSid, callerPhone, callerName
 </Response>`;
 }
 
-function buildDemoTimezoneConfirmTwiml(host, callSid, callerPhone, callerName, environment, timezone, attempt) {
+function buildDemoTimezoneConfirmTwiml(host, callSid, callerPhone, callerName, environment, timezone, attempt, playedNames = []) {
   const action = buildDemoActionUrl(host, '/voice/demo/timezone-confirm', {
     callSid: callSid || '', callerPhone: callerPhone || '', callerName: callerName || '',
-    env: environment, tz: timezone, attempt: String(attempt),
+    env: environment, tz: timezone, attempt: String(attempt), playedNames: playedNames.join(','),
   });
   const label = getZoneLabel(timezone);
   return `<?xml version="1.0" encoding="UTF-8"?>
@@ -7387,17 +7623,21 @@ function buildDemoTimezoneConfirmTwiml(host, callSid, callerPhone, callerName, e
 </Response>`;
 }
 
-function buildDemoReminderTimeTwiml(host, callSid, callerPhone, callerName, environment, timezone, attempt, tzWasDefaulted) {
+function buildDemoReminderTimeTwiml(host, callSid, callerPhone, callerName, environment, timezone, attempt, tzWasDefaulted, playedNames = []) {
   const action = buildDemoActionUrl(host, '/voice/demo/reminder-time', {
     callSid: callSid || '', callerPhone: callerPhone || '', callerName: callerName || '',
-    env: environment, tz: timezone, attempt: String(attempt),
+    env: environment, tz: timezone, attempt: String(attempt), playedNames: playedNames.join(','),
   });
   const namePart = callerName ? `, ${callerName}` : '';
   let prompt;
   if (attempt === 1) {
+    // Trimmed per live-call feedback (2026-07-01) — "Pick any time —
+    // today, tomorrow, next week. I'll text you exactly then." was
+    // explaining something the caller already knows (they're setting a
+    // reminder time). ~15 words cut; the actual reminder confirmation
+    // right after this still states the resolved time back to them.
     const defaultNote = tzWasDefaulted ? `I'll go with ${getZoneLabel(timezone)} time. <break time="300ms"/> ` : '';
-    prompt = `${defaultNote}Pick any time — today, tomorrow, next week. I'll text you exactly then. `
-      + `When should I remind you${namePart}?`;
+    prompt = `${defaultNote}When should I remind you${namePart}?`;
   } else {
     prompt = `Sorry, I didn't catch that. When should I remind you${namePart}?`;
   }
@@ -7420,10 +7660,11 @@ function buildDemoReminderTimeTwiml(host, callSid, callerPhone, callerName, envi
 </Response>`;
 }
 
-function buildDemoReminderConfirmTwiml(host, callSid, callerPhone, callerName, environment, timezone, iso, isImmediate, attempt) {
+function buildDemoReminderConfirmTwiml(host, callSid, callerPhone, callerName, environment, timezone, iso, isImmediate, attempt, playedNames = []) {
   const action = buildDemoActionUrl(host, '/voice/demo/reminder-confirm', {
     callSid: callSid || '', callerPhone: callerPhone || '', callerName: callerName || '',
     env: environment, tz: timezone, iso, immediate: isImmediate ? '1' : '0', attempt: String(attempt),
+    playedNames: playedNames.join(','),
   });
   const namePart = callerName ? `, ${callerName}` : '';
   const spokenTime = formatSpokenDateTime(iso, timezone);
@@ -7436,7 +7677,15 @@ function buildDemoReminderConfirmTwiml(host, callSid, callerPhone, callerName, e
 </Response>`;
 }
 
-function buildDemoDeclineTwiml(callerName) {
+// F2b Phase 4 — call actually ends here (declined reminder). Fires the
+// Recap SMS at this true end-of-call point rather than earlier at the
+// walkthrough hand-off (see note on transitionFromWalkthroughToReminder).
+function buildDemoDeclineTwiml(callerName, callerPhone = '', playedNames = []) {
+  if (callerPhone && playedNames.length > 0) {
+    sendRecapSms(callerPhone, callerName, playedNames).catch((err) => {
+      console.error('[Voice/Demo/F2b] Recap SMS fire-and-forget error:', err && err.message);
+    });
+  }
   const namePart = callerName ? `, ${callerName}` : '';
   return `<?xml version="1.0" encoding="UTF-8"?>
 <Response>
@@ -7452,6 +7701,7 @@ app.post('/voice/demo/timezone', rejectIfShuttingDown, express.urlencoded({ exte
   const callerName = req.query.callerName || '';
   const environment = req.query.env === 'staging' ? 'staging' : 'production';
   const attempt = parseInt(req.query.attempt || '1', 10);
+  const playedNames = parsePlayedNames(req.query.playedNames);
   const speechResult = req.body.SpeechResult || '';
   const tz = parseTimezone(speechResult);
   console.log(`[Voice/Demo/F2b] timezone attempt=${attempt} env=${environment} speech="${speechResult}" parsed="${tz}"`);
@@ -7461,14 +7711,14 @@ app.post('/voice/demo/timezone', rejectIfShuttingDown, express.urlencoded({ exte
       // Disclosed default per plan §2b — never a silent guess; the caller
       // hears the default named in the next line (reminder-time prompt).
       console.log(`[Voice/Demo/F2b] timezone unresolved after ${attempt} attempts — defaulting to ${DEFAULT_TIMEZONE}`);
-      res.type('text/xml').send(buildDemoReminderTimeTwiml(host, callSid, callerPhone, callerName, environment, DEFAULT_TIMEZONE, 1, true));
+      res.type('text/xml').send(buildDemoReminderTimeTwiml(host, callSid, callerPhone, callerName, environment, DEFAULT_TIMEZONE, 1, true, playedNames));
       return;
     }
-    res.type('text/xml').send(buildDemoContextAndTimezoneTwiml(host, callSid, callerPhone, callerName, environment, attempt + 1));
+    res.type('text/xml').send(buildDemoContextAndTimezoneTwiml(host, callSid, callerPhone, callerName, environment, attempt + 1, '', playedNames));
     return;
   }
 
-  res.type('text/xml').send(buildDemoTimezoneConfirmTwiml(host, callSid, callerPhone, callerName, environment, tz, attempt));
+  res.type('text/xml').send(buildDemoTimezoneConfirmTwiml(host, callSid, callerPhone, callerName, environment, tz, attempt, playedNames));
 });
 
 app.post('/voice/demo/timezone-confirm', rejectIfShuttingDown, express.urlencoded({ extended: false }), async (req, res) => {
@@ -7479,28 +7729,29 @@ app.post('/voice/demo/timezone-confirm', rejectIfShuttingDown, express.urlencode
   const environment = req.query.env === 'staging' ? 'staging' : 'production';
   const timezone = req.query.tz || DEFAULT_TIMEZONE;
   const attempt = parseInt(req.query.attempt || '1', 10);
+  const playedNames = parsePlayedNames(req.query.playedNames);
   const speechResult = String(req.body.SpeechResult || '').toLowerCase();
   const yes = /\b(yes|yeah|yep|correct|right|sure)\b/.test(speechResult);
   const no = /\b(no|nope|wrong|incorrect)\b/.test(speechResult);
   console.log(`[Voice/Demo/F2b] timezone-confirm tz=${timezone} speech="${speechResult}" yes=${yes} no=${no}`);
 
   if (yes) {
-    res.type('text/xml').send(buildDemoReminderTimeTwiml(host, callSid, callerPhone, callerName, environment, timezone, 1, false));
+    res.type('text/xml').send(buildDemoReminderTimeTwiml(host, callSid, callerPhone, callerName, environment, timezone, 1, false, playedNames));
     return;
   }
 
   if (no) {
     if (attempt >= DEMO_TIMEZONE_MAX_ATTEMPTS) {
       console.log(`[Voice/Demo/F2b] timezone rejected ${attempt} times — defaulting to ${DEFAULT_TIMEZONE}`);
-      res.type('text/xml').send(buildDemoReminderTimeTwiml(host, callSid, callerPhone, callerName, environment, DEFAULT_TIMEZONE, 1, true));
+      res.type('text/xml').send(buildDemoReminderTimeTwiml(host, callSid, callerPhone, callerName, environment, DEFAULT_TIMEZONE, 1, true, playedNames));
       return;
     }
-    res.type('text/xml').send(buildDemoContextAndTimezoneTwiml(host, callSid, callerPhone, callerName, environment, attempt + 1));
+    res.type('text/xml').send(buildDemoContextAndTimezoneTwiml(host, callSid, callerPhone, callerName, environment, attempt + 1, '', playedNames));
     return;
   }
 
   const action = buildDemoActionUrl(host, '/voice/demo/timezone-confirm', {
-    callSid, callerPhone, callerName, env: environment, tz: timezone, attempt: String(attempt),
+    callSid, callerPhone, callerName, env: environment, tz: timezone, attempt: String(attempt), playedNames: playedNames.join(','),
   });
   res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
 <Response>
@@ -7519,13 +7770,14 @@ app.post('/voice/demo/reminder-time', rejectIfShuttingDown, express.urlencoded({
   const environment = req.query.env === 'staging' ? 'staging' : 'production';
   const timezone = req.query.tz || DEFAULT_TIMEZONE;
   const attempt = parseInt(req.query.attempt || '1', 10);
+  const playedNames = parsePlayedNames(req.query.playedNames);
   const speechResult = req.body.SpeechResult || '';
   const namePart = callerName ? `, ${callerName}` : '';
   console.log(`[Voice/Demo/F2b] reminder-time attempt=${attempt} tz=${timezone} speech="${speechResult}"`);
 
   if (DEMO_REFUSAL_RE.test(speechResult.toLowerCase())) {
     console.log(`[Voice/Demo/F2b] caller declined a reminder — ending gracefully, no SMS`);
-    res.type('text/xml').send(buildDemoDeclineTwiml(callerName));
+    res.type('text/xml').send(buildDemoDeclineTwiml(callerName, callerPhone, playedNames));
     return;
   }
 
@@ -7535,7 +7787,7 @@ app.post('/voice/demo/reminder-time', rejectIfShuttingDown, express.urlencoded({
     // Spec's "vague time" edge case — day given, no time. Ask specifically
     // for a time-of-day rather than a generic re-ask.
     const action = buildDemoActionUrl(host, '/voice/demo/reminder-time', {
-      callSid, callerPhone, callerName, env: environment, tz: timezone, attempt: String(attempt),
+      callSid, callerPhone, callerName, env: environment, tz: timezone, attempt: String(attempt), playedNames: playedNames.join(','),
     });
     res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
 <Response>
@@ -7550,6 +7802,13 @@ app.post('/voice/demo/reminder-time', rejectIfShuttingDown, express.urlencoded({
   if (!parsed.iso) {
     if (attempt >= DEMO_REMINDER_TIME_MAX_ATTEMPTS) {
       console.log(`[Voice/Demo/F2b] reminder time unresolved after ${attempt} attempts — ending gracefully, no SMS`);
+      // F2b Phase 4 — call actually ends here; fire the Recap SMS at this
+      // true end-of-call point (see transitionFromWalkthroughToReminder note).
+      if (callerPhone && playedNames.length > 0) {
+        sendRecapSms(callerPhone, callerName, playedNames).catch((err) => {
+          console.error('[Voice/Demo/F2b] Recap SMS fire-and-forget error:', err && err.message);
+        });
+      }
       res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
 <Response>
   <Say voice="Polly.Joanna">I'm having trouble catching that${namePart}. Visit my naavi dot com to see what else I can do. Have a great day.</Say>
@@ -7557,7 +7816,7 @@ app.post('/voice/demo/reminder-time', rejectIfShuttingDown, express.urlencoded({
 </Response>`);
       return;
     }
-    res.type('text/xml').send(buildDemoReminderTimeTwiml(host, callSid, callerPhone, callerName, environment, timezone, attempt + 1, false));
+    res.type('text/xml').send(buildDemoReminderTimeTwiml(host, callSid, callerPhone, callerName, environment, timezone, attempt + 1, false, playedNames));
     return;
   }
 
@@ -7565,7 +7824,7 @@ app.post('/voice/demo/reminder-time', rejectIfShuttingDown, express.urlencoded({
   if (new Date(parsed.iso).getTime() <= Date.now()) {
     console.log(`[Voice/Demo/F2b] resolved time ${parsed.iso} is in the past — re-asking`);
     const action = buildDemoActionUrl(host, '/voice/demo/reminder-time', {
-      callSid, callerPhone, callerName, env: environment, tz: timezone, attempt: String(attempt),
+      callSid, callerPhone, callerName, env: environment, tz: timezone, attempt: String(attempt), playedNames: playedNames.join(','),
     });
     // States what was actually heard/resolved (2026-07-01) — previously
     // this rejection was silent about the misunderstood time, which made
@@ -7584,7 +7843,7 @@ app.post('/voice/demo/reminder-time', rejectIfShuttingDown, express.urlencoded({
     return;
   }
 
-  res.type('text/xml').send(buildDemoReminderConfirmTwiml(host, callSid, callerPhone, callerName, environment, timezone, parsed.iso, parsed.isImmediate, attempt));
+  res.type('text/xml').send(buildDemoReminderConfirmTwiml(host, callSid, callerPhone, callerName, environment, timezone, parsed.iso, parsed.isImmediate, attempt, playedNames));
 });
 
 app.post('/voice/demo/reminder-confirm', rejectIfShuttingDown, express.urlencoded({ extended: false }), async (req, res) => {
@@ -7597,6 +7856,7 @@ app.post('/voice/demo/reminder-confirm', rejectIfShuttingDown, express.urlencode
   const iso = req.query.iso || '';
   const isImmediate = req.query.immediate === '1';
   const attempt = parseInt(req.query.attempt || '1', 10);
+  const playedNames = parsePlayedNames(req.query.playedNames);
   const speechResult = String(req.body.SpeechResult || '').toLowerCase();
   const yes = /\b(yes|yeah|yep|correct|right|sure)\b/.test(speechResult);
   const no = /\b(no|nope|wrong|incorrect)\b/.test(speechResult);
@@ -7605,11 +7865,12 @@ app.post('/voice/demo/reminder-confirm', rejectIfShuttingDown, express.urlencode
   if (yes && iso) {
     const action = buildDemoActionUrl(host, '/voice/demo/reminder-message', {
       callSid, callerPhone, callerName, env: environment, tz: timezone, iso, immediate: isImmediate ? '1' : '0',
+      playedNames: playedNames.join(','),
     });
     res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
 <Response>
   <Gather input="speech" action="${action}" speechTimeout="2" speechModel="phone_call" language="en-US">
-    <Say voice="Polly.Joanna">Is there anything specific you'd like me to include in that reminder?</Say>
+    <Say voice="Polly.Joanna">Anything specific to include?</Say>
   </Gather>
   <Redirect method="POST">${action}</Redirect>
 </Response>`);
@@ -7618,15 +7879,16 @@ app.post('/voice/demo/reminder-confirm', rejectIfShuttingDown, express.urlencode
 
   if (no) {
     if (attempt >= DEMO_REMINDER_TIME_MAX_ATTEMPTS) {
-      res.type('text/xml').send(buildDemoDeclineTwiml(callerName));
+      res.type('text/xml').send(buildDemoDeclineTwiml(callerName, callerPhone, playedNames));
       return;
     }
-    res.type('text/xml').send(buildDemoReminderTimeTwiml(host, callSid, callerPhone, callerName, environment, timezone, attempt + 1, false));
+    res.type('text/xml').send(buildDemoReminderTimeTwiml(host, callSid, callerPhone, callerName, environment, timezone, attempt + 1, false, playedNames));
     return;
   }
 
   const action = buildDemoActionUrl(host, '/voice/demo/reminder-confirm', {
     callSid, callerPhone, callerName, env: environment, tz: timezone, iso, immediate: isImmediate ? '1' : '0', attempt: String(attempt),
+    playedNames: playedNames.join(','),
   });
   res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
 <Response>
@@ -7645,16 +7907,30 @@ app.post('/voice/demo/reminder-message', rejectIfShuttingDown, express.urlencode
   const timezone = req.query.tz || DEFAULT_TIMEZONE;
   const iso = req.query.iso || '';
   const isImmediate = req.query.immediate === '1';
+  const playedNames = parsePlayedNames(req.query.playedNames);
   const speechResult = String(req.body.SpeechResult || '').trim();
   const namePart = callerName ? `, ${callerName}` : '';
   console.log(`[Voice/Demo/F2b] reminder-message iso=${iso} tz=${timezone} immediate=${isImmediate} message="${speechResult}"`);
 
+  // F2b Phase 4 — every branch below is a true end-of-call point, so each
+  // fires the Recap SMS (fire-and-forget) if any scenarios were played,
+  // right before its own Say/Hangup. See transitionFromWalkthroughToReminder
+  // note for why this moved here instead of firing earlier.
+  const fireRecap = () => {
+    if (callerPhone && playedNames.length > 0) {
+      sendRecapSms(callerPhone, callerName, playedNames).catch((err) => {
+        console.error('[Voice/Demo/F2b] Recap SMS fire-and-forget error:', err && err.message);
+      });
+    }
+  };
+
   const declinesMessage = /^(no|nope|nothing|that's it|thats it|no thanks)\b/i.test(speechResult);
   const message = declinesMessage ? '' : speechResult;
 
   const demoEnv = getDemoEnvironmentByName(environment);
   if (!demoEnv || !demoEnv.supabaseUrl || !iso || !callerPhone) {
     console.error(`[Voice/Demo/F2b] cannot create reminder — missing config/iso/phone (env=${environment} iso=${iso} phone=${callerPhone})`);
+    fireRecap();
     res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
 <Response>
   <Say voice="Polly.Joanna">Sorry, something went wrong on my end${namePart}. Please try calling again. Goodbye.</Say>
@@ -7684,6 +7960,7 @@ app.post('/voice/demo/reminder-message', rejectIfShuttingDown, express.urlencode
     if (!createRes.ok) {
       const errText = await createRes.text().catch(() => '');
       console.error(`[Voice/Demo/F2b] create-demo-reminder failed status=${createRes.status}: ${errText.slice(0, 300)}`);
+      fireRecap();
       res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
 <Response>
   <Say voice="Polly.Joanna">Sorry, I couldn't set that up${namePart}. Please try calling again. Goodbye.</Say>
@@ -7695,6 +7972,7 @@ app.post('/voice/demo/reminder-message', rejectIfShuttingDown, express.urlencode
     console.log(`[Voice/Demo/F2b] reminder created for ${callerPhone} firing at ${iso} (env=${environment})`);
   } catch (err) {
     console.error('[Voice/Demo/F2b] create-demo-reminder exception:', err && err.message);
+    fireRecap();
     res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
 <Response>
   <Say voice="Polly.Joanna">Sorry, I couldn't set that up${namePart}. Please try calling again. Goodbye.</Say>
@@ -7703,6 +7981,8 @@ app.post('/voice/demo/reminder-message', rejectIfShuttingDown, express.urlencode
     return;
   }
 
+  fireRecap();
+
   // Post-action readback per CLAUDE.md Rule #12 — repeats the exact
   // commitment that was just written (time + zone), doubling as the
   // spec's own closing line.
diff --git a/src/voice/recapSms.js b/src/voice/recapSms.js
new file mode 100644
index 0000000..e6af401
--- /dev/null
+++ b/src/voice/recapSms.js
@@ -0,0 +1,47 @@
+/**
+ * F2b Phase 4 — Recap SMS (deterministic, no LLM).
+ *
+ * Confirmed in docs/F2B_SCENARIO_WALKTHROUGH_SCRIPT_2026-07-01.md §5:
+ * a short SMS recapping which scenarios the caller heard, sent
+ * automatically (no permission ask) right after the walkthrough ends —
+ * independent of the Reminder SMS (buildDemoReminderSmsBody in index.js),
+ * which fires later, only if a reminder was actually set, at the
+ * scheduled reminder time. The two must never be merged or substituted
+ * for one another.
+ *
+ * Canonical source for SCENARIO_RECAP_LINES — also used by the older,
+ * still-present (but no longer routed-to) CTA flow in index.js so there
+ * is exactly one place these lines are defined.
+ */
+
+const SCENARIO_RECAP_LINES = {
+  today: 'Today: your day in one breath.',
+  bills: 'Bills: PDFs read straight from your inbox.',
+  history: 'History: when you last did anything.',
+  location: 'Location: an alert when you arrive somewhere.',
+  capture: 'Capture: anything you want me to remember.',
+};
+
+/**
+ * @param {string} callerName - sanitized caller name, may be empty
+ * @param {string[]|Set<string>} playedScenarios - scenario keys actually heard, in order
+ * @returns {string} SMS body
+ */
+function buildRecapSmsBody(callerName, playedScenarios) {
+  const greeting = callerName ? `Hi ${callerName}, thanks for trying Naavi.` : 'Hi, thanks for trying Naavi.';
+  const names = [];
+  if (playedScenarios && typeof playedScenarios.forEach === 'function') {
+    playedScenarios.forEach((name) => {
+      if (SCENARIO_RECAP_LINES[name]) names.push(name);
+    });
+  }
+  const lines = names.map((name) => `- ${SCENARIO_RECAP_LINES[name]}`).join('\n');
+  const heardBlock = lines ? `\n\nHere's what you heard:\n${lines}` : '';
+  return (
+    `${greeting}${heardBlock}\n\n` +
+    'Set up your own MyNaavi:\nhttps://mynaavi.com/start\n\n' +
+    'Reply STOP to opt out.'
+  );
+}
+
+module.exports = { SCENARIO_RECAP_LINES, buildRecapSmsBody };
diff --git a/src/voice/scenarioWalkthrough.js b/src/voice/scenarioWalkthrough.js
new file mode 100644
index 0000000..64def83
--- /dev/null
+++ b/src/voice/scenarioWalkthrough.js
@@ -0,0 +1,111 @@
+/**
+ * F2b Phase 4 — Scenario walkthrough content + routing helpers (no LLM).
+ *
+ * Script fully reviewed and confirmed line-by-line in
+ * docs/F2B_SCENARIO_WALKTHROUGH_SCRIPT_2026-07-01.md. Any wording change
+ * here should update that doc too.
+ *
+ * Same 5 topics/facts as the original menu (DEMO_SCENARIOS in index.js,
+ * untouched) — rewritten as a yes/no gate + spoken answer instead of an
+ * open-ended "try asking X" prompt, per the confirmed script.
+ */
+
+const DEMO_SCENARIO_ORDER = ['today', 'bills', 'history', 'location', 'capture'];
+
+// Gate questions trimmed per live-call feedback (2026-07-01) — "zero
+// friction call, real message is in SMS" philosophy. Each dropped the
+// "Want to..." lead-in; still yes/no-answerable, just shorter.
+const DEMO_WALKTHROUGH_SCENARIOS = {
+  today: {
+    gate: "Hear what's on your day?",
+    body:
+      'You\'ve got three. <break time="300ms"/> Nine — team standup. <break time="300ms"/> ' +
+      'Noon — lunch with David, he just confirmed. <break time="300ms"/> Four — Sam\'s recital. ' +
+      '<break time="500ms"/> Quick heads-up — rain\'s rolling in around three, give yourself a few extra minutes.',
+  },
+  bills: {
+    gate: 'Hear about your bills and emails?',
+    // Trimmed per live-call feedback (2026-07-01) — dropped "I tagged it
+    // for expenses" and "All three are filed in your Drive under Bills":
+    // true but not the point of the demo, ~14 words of pure chattiness.
+    body:
+      'Three this week. Hydro — eighty-two dollars, due Friday. Bell — ninety-six, on autopay. ' +
+      '<break time="300ms"/> Hilton from your Toronto trip — three hundred forty-five came in this morning.',
+  },
+  history: {
+    gate: 'Know when you last got your brakes done?',
+    body:
+      'Brakes were done last September twelfth at Henderson\'s — eight hundred forty dollars. ' +
+      '<break time="300ms"/> You also asked me to flag after fifty thousand kilometers — you\'re at ' +
+      'forty-six now. <break time="500ms"/> Plenty of road left.',
+  },
+  location: {
+    gate: 'Hear how I can text someone when you arrive somewhere?',
+    body:
+      "Say you told me: text Sarah the moment I land at the airport. <break time=\"500ms\"/> " +
+      "From then on, every time you land, I'll text her — even if your phone's on silent, you'll know it sent.",
+  },
+  capture: {
+    gate: 'Hear how I can remember something for you?',
+    body:
+      'Say you told me: remember I parked in row B5. <break time="500ms"/> From then on, whenever ' +
+      "you ask me where you parked, I'll have it for you — row B5.",
+  },
+};
+
+// Matched only at the "want to hear another, or should we set up a
+// reminder for you?" closer — catches intent phrases beyond a literal
+// "no". Deliberately a regex, not an LLM call — see
+// docs/F2B_SCENARIO_WALKTHROUGH_PHASE2_2026-07-01.md §7 for why an LLM
+// was explicitly ruled out for this decision point.
+const DEMO_MOVE_TO_REMINDER_RE =
+  /\b(let'?s (do|set up|get to|move (on )?to) (the |a )?remind\w*|remind me instead|that'?s enough|that'?ll do|ok(ay)? let'?s continue|set up a remind\w*|let'?s set (one|it) up|let'?s continue|move on|no more( scenarios)?)\b/i;
+
+function wantsToMoveToReminder(utterance) {
+  return DEMO_MOVE_TO_REMINDER_RE.test(String(utterance || '').toLowerCase());
+}
+
+// Bridge line, §2 of the script doc — states the reason the examples
+// that follow aren't the caller's real data (Naavi isn't connected to
+// his accounts yet during this demo call). Trimmed per live-call
+// feedback (2026-07-01), 30 words -> 18, reason kept.
+function getWalkthroughBridgeLine(callerName) {
+  const namePart = callerName ? `Thanks ${callerName}. ` : '';
+  return (
+    `${namePart}I'm not connected to your calendar or emails yet, so here's a quick example. ` +
+    'First up: '
+  );
+}
+
+// Confirmed §3 decline line — used at any scenario's yes/no gate when the
+// caller says no. Advances to the next scenario in DEMO_SCENARIO_ORDER;
+// does not count toward DEMO_MAX_SCENARIOS (only heard scenarios do).
+function getDeclineLine() {
+  return "No problem — let's try a different one.";
+}
+
+// §3 closer — asked after a scenario is actually played, as long as the
+// 3-scenario cap hasn't been reached yet. Revised per live-call feedback
+// (2026-07-01): "Want to hear another?" left "another" dangling with no
+// object — now names what's on offer.
+function getCloserLine() {
+  return 'Want to hear another example, or should we set up a reminder for you?';
+}
+
+// Confirmed §3 cap-reached line — replaces the closer once
+// DEMO_MAX_SCENARIOS have been heard, or all 5 have been offered.
+// Always fires regardless of what the caller says after the last one.
+function getCapReachedLine() {
+  return "That's a quick look at what I can do. Let's set up a real one for you now.";
+}
+
+module.exports = {
+  DEMO_SCENARIO_ORDER,
+  DEMO_WALKTHROUGH_SCENARIOS,
+  DEMO_MOVE_TO_REMINDER_RE,
+  wantsToMoveToReminder,
+  getWalkthroughBridgeLine,
+  getDeclineLine,
+  getCloserLine,
+  getCapReachedLine,
+};
diff --git a/test/recapSms.test.js b/test/recapSms.test.js
new file mode 100644
index 0000000..3f9a930
--- /dev/null
+++ b/test/recapSms.test.js
@@ -0,0 +1,59 @@
+/**
+ * Unit tests for recapSms.js — F2b Phase 4 Recap SMS, sent automatically
+ * right after the scenario walkthrough (no permission ask), independent
+ * of the Reminder SMS.
+ *
+ * Run: npm test (from naavi-voice-server/).
+ */
+
+const { test } = require('node:test');
+const assert = require('node:assert/strict');
+
+const { SCENARIO_RECAP_LINES, buildRecapSmsBody } = require('../src/voice/recapSms');
+
+test('SCENARIO_RECAP_LINES has one line per scenario', () => {
+  assert.equal(Object.keys(SCENARIO_RECAP_LINES).length, 5);
+  for (const key of ['today', 'bills', 'history', 'location', 'capture']) {
+    assert.ok(SCENARIO_RECAP_LINES[key], `missing recap line for "${key}"`);
+  }
+});
+
+test('recap body includes only the scenarios actually played, in order', () => {
+  const body = buildRecapSmsBody('Robert', ['today', 'capture']);
+  assert.match(body, /Today: your day in one breath\./);
+  assert.match(body, /Capture: anything you want me to remember\./);
+  assert.doesNotMatch(body, /Bills:/);
+  assert.doesNotMatch(body, /History:/);
+  assert.doesNotMatch(body, /Location:/);
+  // order preserved
+  assert.ok(body.indexOf('Today:') < body.indexOf('Capture:'));
+});
+
+test('recap body greets by name when given, and works anonymously', () => {
+  assert.match(buildRecapSmsBody('Robert', ['today']), /^Hi Robert, thanks for trying Naavi\./);
+  assert.match(buildRecapSmsBody('', ['today']), /^Hi, thanks for trying Naavi\./);
+});
+
+test('recap body includes signup link and STOP opt-out', () => {
+  const body = buildRecapSmsBody('Robert', ['today']);
+  assert.match(body, /https:\/\/mynaavi\.com\/start/);
+  assert.match(body, /Reply STOP to opt out\./);
+});
+
+test('recap body never mentions reminder content — stays fully separate from the Reminder SMS', () => {
+  const body = buildRecapSmsBody('Robert', ['today', 'bills', 'location']);
+  assert.doesNotMatch(body, /remind/i);
+});
+
+test('no scenarios played still produces a valid body with no "heard" section', () => {
+  const body = buildRecapSmsBody('Robert', []);
+  assert.doesNotMatch(body, /Here's what you heard/);
+  assert.match(body, /https:\/\/mynaavi\.com\/start/);
+});
+
+test('accepts a Set as well as an array (matches how index.js tracks played scenarios)', () => {
+  const played = new Set(['today', 'history']);
+  const body = buildRecapSmsBody('Robert', played);
+  assert.match(body, /Today:/);
+  assert.match(body, /History:/);
+});
diff --git a/test/scenarioWalkthrough.test.js b/test/scenarioWalkthrough.test.js
new file mode 100644
index 0000000..aeb879f
--- /dev/null
+++ b/test/scenarioWalkthrough.test.js
@@ -0,0 +1,75 @@
+/**
+ * Unit tests for scenarioWalkthrough.js — F2b Phase 4 scenario walkthrough
+ * content + the deterministic "move to reminder" intent matcher.
+ *
+ * Run: npm test (from naavi-voice-server/).
+ */
+
+const { test } = require('node:test');
+const assert = require('node:assert/strict');
+
+const {
+  DEMO_SCENARIO_ORDER,
+  DEMO_WALKTHROUGH_SCENARIOS,
+  wantsToMoveToReminder,
+  getWalkthroughBridgeLine,
+  getDeclineLine,
+  getCloserLine,
+  getCapReachedLine,
+} = require('../src/voice/scenarioWalkthrough');
+
+test('DEMO_SCENARIO_ORDER has all 5 scenarios, matching original menu order', () => {
+  assert.deepEqual(DEMO_SCENARIO_ORDER, ['today', 'bills', 'history', 'location', 'capture']);
+});
+
+test('every scenario in the order has a gate question and a body', () => {
+  for (const name of DEMO_SCENARIO_ORDER) {
+    const scenario = DEMO_WALKTHROUGH_SCENARIOS[name];
+    assert.ok(scenario, `missing scenario data for "${name}"`);
+    assert.ok(scenario.gate && scenario.gate.length > 0, `missing gate question for "${name}"`);
+    assert.ok(scenario.body && scenario.body.length > 0, `missing body for "${name}"`);
+  }
+});
+
+test('location and capture scenarios frame the specific example as a hypothetical, not an asserted fact', () => {
+  // Regression guard for the "where does it know Row B5?" gap caught in
+  // review — the body must voice the example itself ("say you told
+  // me..."), never assert the caller already said it.
+  assert.match(DEMO_WALKTHROUGH_SCENARIOS.location.body, /say you told me/i);
+  assert.match(DEMO_WALKTHROUGH_SCENARIOS.capture.body, /say you told me/i);
+  assert.doesNotMatch(DEMO_WALKTHROUGH_SCENARIOS.location.gate, /sarah|airport/i);
+  assert.doesNotMatch(DEMO_WALKTHROUGH_SCENARIOS.capture.gate, /row b5/i);
+});
+
+test('wantsToMoveToReminder matches the confirmed intent phrases', () => {
+  assert.equal(wantsToMoveToReminder("let's do the reminder"), true);
+  assert.equal(wantsToMoveToReminder('remind me instead'), true);
+  assert.equal(wantsToMoveToReminder("that's enough"), true);
+  assert.equal(wantsToMoveToReminder("ok let's continue"), true);
+  assert.equal(wantsToMoveToReminder('set up a reminder'), true);
+  assert.equal(wantsToMoveToReminder("let's set one up"), true);
+});
+
+test('wantsToMoveToReminder does not fire on a plain yes or an unrelated answer', () => {
+  assert.equal(wantsToMoveToReminder('yes'), false);
+  assert.equal(wantsToMoveToReminder('yeah sure'), false);
+  assert.equal(wantsToMoveToReminder('tell me about bills'), false);
+  assert.equal(wantsToMoveToReminder(''), false);
+  assert.equal(wantsToMoveToReminder(null), false);
+});
+
+test('bridge line states the reason (not connected to real calendar/email yet) and includes the name when given', () => {
+  const withName = getWalkthroughBridgeLine('Robert');
+  assert.match(withName, /^Thanks Robert\./);
+  assert.match(withName, /not connected to your calendar or emails yet/i);
+
+  const noName = getWalkthroughBridgeLine('');
+  assert.equal(/^Thanks/.test(noName), false);
+  assert.match(noName, /not connected to your calendar or emails yet/i);
+});
+
+test('decline, closer, and cap-reached lines match the confirmed script text exactly', () => {
+  assert.equal(getDeclineLine(), "No problem — let's try a different one.");
+  assert.equal(getCloserLine(), 'Want to hear another example, or should we set up a reminder for you?');
+  assert.equal(getCapReachedLine(), "That's a quick look at what I can do. Let's set up a real one for you now.");
+});
```
