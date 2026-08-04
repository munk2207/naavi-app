const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Z3ZuZnVkb2Z1c2t4b2tuaHZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5OTQ0MDMsImV4cCI6MjA5NzU3MDQwM30.QTwlSyP4c1-jIHQ_PryQFwCiKlk-GhBQ6wdfJv1lzlg';
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';
const URL = process.env.STAGING_SUPABASE_URL + '/functions/v1/naavi-chat';

async function call(messages) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ANON },
    body: JSON.stringify({ messages, max_tokens: 600, user_id: USER_ID, channel: 'app' }),
  });
  return await res.json();
}

(async () => {
  const messages = [];
  const turns = ['Drive me to my next meeting', 'Drive me to my next event', 'Drive me to team standup'];
  for (const [i, phrase] of turns.entries()) {
    messages.push({ role: 'user', content: phrase });
    const r = await call(messages);
    console.log(`\n--- Turn ${i+1}: "${phrase}" ---`);
    console.log(r.rawText);
    const parsed = JSON.parse(r.rawText || '{}');
    messages.push({ role: 'assistant', content: parsed.speech || '' });
  }
})();
