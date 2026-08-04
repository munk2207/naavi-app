const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Z3ZuZnVkb2Z1c2t4b2tuaHZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5OTQ0MDMsImV4cCI6MjA5NzU3MDQwM30.QTwlSyP4c1-jIHQ_PryQFwCiKlk-GhBQ6wdfJv1lzlg';
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';
const URL = process.env.STAGING_SUPABASE_URL + '/functions/v1/naavi-chat';
async function call(phrase) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ANON },
    body: JSON.stringify({ messages: [{role:'user', content: phrase}], max_tokens: 600, user_id: USER_ID, channel: 'app' }),
  });
  const data = await res.json();
  let speech='', actions=[];
  try { const p = JSON.parse(data?.rawText ?? '{}'); speech = p.speech ?? ''; actions = p.actions ?? []; } catch {}
  return { status: res.status, speech, actions };
}
(async () => {
  console.log('=== "Drive me to my next event" — 5 more trials ===');
  for (let i=1;i<=5;i++){
    const r = await call('Drive me to my next event');
    const dest = r.actions.map(a=>a.destination).join(', ') || 'none';
    console.log(`trial ${i}: dest=[${dest}] speech="${r.speech.slice(0,150)}"`);
  }
  console.log('\n=== "Drive me to my next appointment" — 5 more trials ===');
  for (let i=1;i<=5;i++){
    const r = await call('Drive me to my next appointment');
    const dest = r.actions.map(a=>a.destination).join(', ') || 'none';
    console.log(`trial ${i}: dest=[${dest}] speech="${r.speech.slice(0,150)}"`);
  }
  console.log('\n=== "What is my next meeting" (Q&A phrasing, no travel verb) — 3 trials ===');
  for (let i=1;i<=3;i++){
    const r = await call('What is my next meeting?');
    console.log(`trial ${i}: speech="${r.speech.slice(0,200)}"`);
  }
})();
