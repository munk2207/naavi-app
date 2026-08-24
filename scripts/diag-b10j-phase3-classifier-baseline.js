// B10j Phase 3 — empirical baseline validation.
// Calls the CURRENTLY DEPLOYED naavi-chat (unmodified classifier) with a
// corpus of single-action location phrasings + the 2 known compound
// (positive-control) phrasings, then checks client_diagnostics'
// f15-layer2-action-branch marker to see exactly what Layer 2 classified
// each one as. No DB row is created by this — naavi-chat only returns the
// classification/action JSON; the actual action_rules INSERT happens
// client-side in useOrchestrator.ts, which this script never invokes.
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = {};
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(env.STAGING_SUPABASE_URL, env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
const USER_ID = 'ae1f3438-e132-422a-9b0b-7b8819119b46';

const NEGATIVE_CONTROLS = [ // must stay action / SET_ACTION_RULE (single-action location)
  'Alert me when I arrive at Costco',
  'Text Bob when I arrive at 50 Elm Street',
  'Email Bob when I arrive at 50 Elm Street',
  'Text me at +16135551234 when I arrive at 50 Elm Street',
  'Call me at +16135551234 when I arrive at 50 Elm Street',
  "Remind me with Bob's kid Sam when I arrive at Bob's home",
  'Alert me when I arrive at the office',
  'Text Sarah when I leave home',
  'Notify me when I arrive at Shoppers Drug Mart',
  'Let me know when I get to the gym',
  'Text my wife when I arrive at work',
  'Alert me when I leave the office',
  'Email Sarah when I reach work',
  'Text Bob when I arrive home',
  'WhatsApp me when I arrive at Costco',
];

const POSITIVE_CONTROLS = [ // currently mis-fire (compound); should become chat after the fix
  'Remind me when I arrive home to lock the door AND send SMS to Bob',
  'When I arrive home remind me to lock the door and send sms to bob saying i\'m home',
];

async function callNaaviChat(text) {
  const url = `${env.STAGING_SUPABASE_URL}/functions/v1/naavi-chat`;
  const key = env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      messages: [{ role: 'user', content: text }],
      user_id: USER_ID,
      channel: 'mobile',
    }),
  });
  return res.status;
}

async function latestClassifierMarker(afterIso) {
  const { data, error } = await sb
    .from('client_diagnostics')
    .select('step, payload, created_at')
    .eq('step', 'f15-layer2-action-branch')
    .gt('created_at', afterIso)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) { console.error('query error:', error.message); return null; }
  return data?.[0] ?? null;
}

(async () => {
  const results = [];
  for (const [label, list] of [['NEGATIVE (must stay action)', NEGATIVE_CONTROLS], ['POSITIVE (currently mis-fires)', POSITIVE_CONTROLS]]) {
    console.log(`\n=== ${label} ===`);
    for (const text of list) {
      const beforeIso = new Date().toISOString();
      await callNaaviChat(text);
      // small settle delay so the diagnostic insert lands before we query
      await new Promise(r => setTimeout(r, 1200));
      const marker = await latestClassifierMarker(beforeIso);
      const outcome = marker
        ? `level=${marker.payload.level} intent=${marker.payload.intent} trigger=${marker.payload.params?.trigger_type ?? ''}`
        : 'NO f15-layer2-action-branch marker (did NOT hit Layer-2 action branch — routed elsewhere, e.g. chat/Path B or a different Level-A intent)';
      results.push({ text, outcome });
      console.log(`"${text}" ->\n   ${outcome}`);
    }
  }
  console.log('\n=== SUMMARY ===');
  for (const r of results) console.log(`${r.outcome.startsWith('level=action') ? 'ACTION' : 'OTHER '} | ${r.text}`);
})();
