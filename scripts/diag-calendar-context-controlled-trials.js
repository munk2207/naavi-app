const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Z3ZuZnVkb2Z1c2t4b2tuaHZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5OTQ0MDMsImV4cCI6MjA5NzU3MDQwM30.QTwlSyP4c1-jIHQ_PryQFwCiKlk-GhBQ6wdfJv1lzlg';
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847'; // Robert, staging
const URL = process.env.STAGING_SUPABASE_URL + '/functions/v1/naavi-chat';

async function call(messages, extra = {}) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ANON },
    body: JSON.stringify({ messages, max_tokens: 600, user_id: USER_ID, channel: 'app', ...extra }),
  });
  const data = await res.json();
  let speech = '';
  let actions = [];
  try {
    const parsed = JSON.parse(data?.rawText ?? '{}');
    speech = parsed.speech ?? '';
    actions = parsed.actions ?? [];
  } catch { /* leave defaults */ }
  return { status: res.status, speech, actions };
}

function summarize(label, r) {
  const actionSummary = r.actions.map(a => `${a.type}${a.destination ? `(dest="${a.destination}")` : ''}`).join(', ') || 'none';
  console.log(`  ${label} | status=${r.status} | actions=[${actionSummary}]`);
  console.log(`    speech: "${r.speech.slice(0, 220)}"`);
}

async function runTrials(phrase, n = 3) {
  console.log(`\n=== "${phrase}" — ${n} trials, fresh conversation each time ===`);
  for (let i = 1; i <= n; i++) {
    const r = await call([{ role: 'user', content: phrase }]);
    summarize(`trial ${i}`, r);
  }
}

(async () => {
  console.log('### PART C — controlled repeated trials, original phrases ###');
  await runTrials('Drive me to my next meeting');
  await runTrials('Drive me to my next appointment');
  await runTrials('What time should I leave for my Team standup?');

  console.log('\n### PART C — semantic boundary controls ###');
  await runTrials('Drive me to my next event.');
  await runTrials('Drive me to my next class.');
  await runTrials('Drive me to Gym class.');
  await runTrials('Drive me to Team standup.');

  console.log('\n### PART D — conversation-state contamination, phrase = "What time should I leave for my Team standup?" ###');

  console.log('\n-- config: new conversation (baseline, same as trial above) --');
  const d1 = await call([{ role: 'user', content: 'What time should I leave for my Team standup?' }]);
  summarize('new-conversation', d1);

  console.log('\n-- config: after an unrelated message --');
  const d2 = await call([
    { role: 'user', content: 'What is the capital of France?' },
    { role: 'assistant', content: 'The capital of France is Paris.' },
    { role: 'user', content: 'What time should I leave for my Team standup?' },
  ]);
  summarize('after-unrelated', d2);

  console.log('\n-- config: immediately after another calendar query --');
  const d3 = await call([
    { role: 'user', content: 'What is on my calendar today?' },
    { role: 'assistant', content: "Here's your schedule for today. 1. Gym class, Aug 2 at 8:00 AM. 2. Team standup, Aug 2 at 9:00 AM." },
    { role: 'user', content: 'What time should I leave for my Team standup?' },
  ]);
  summarize('after-calendar-query', d3);

  console.log('\n-- config: retry in the same thread (ask twice in a row) --');
  const messages = [{ role: 'user', content: 'What time should I leave for my Team standup?' }];
  const d4a = await call(messages);
  summarize('retry-1st-ask', d4a);
  messages.push({ role: 'assistant', content: d4a.speech });
  messages.push({ role: 'user', content: 'What time should I leave for my Team standup?' });
  const d4b = await call(messages);
  summarize('retry-2nd-ask-same-thread', d4b);

  console.log('\nDone.');
})();
