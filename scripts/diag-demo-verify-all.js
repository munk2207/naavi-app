const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Z3ZuZnVkb2Z1c2t4b2tuaHZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5OTQ0MDMsImV4cCI6MjA5NzU3MDQwM30.QTwlSyP4c1-jIHQ_PryQFwCiKlk-GhBQ6wdfJv1lzlg';
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';
const CHAT_URL = process.env.STAGING_SUPABASE_URL + '/functions/v1/naavi-chat';
const SPEND_URL = process.env.STAGING_SUPABASE_URL + '/functions/v1/naavi-spend-summary';

async function chat(phrase) {
  const res = await fetch(CHAT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ANON }, body: JSON.stringify({ messages: [{role:'user', content: phrase}], max_tokens: 600, user_id: USER_ID, channel: 'app' }) });
  return await res.json();
}

(async () => {
  console.log('=== Demo 5: "Tell me about James." ===');
  console.log((await chat('Tell me about James.')).rawText);

  console.log('\n=== Demo 6: naavi-spend-summary direct call (Reyes Build, all time) ===');
  const res = await fetch(SPEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ANON }, body: JSON.stringify({ vendor: 'Reyes Build', period_label: 'all time', mode: 'charged', user_id: USER_ID }) });
  console.log(res.status, JSON.stringify(await res.json(), null, 2));
})();
