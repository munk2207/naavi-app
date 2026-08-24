const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';

const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Z3ZuZnVkb2Z1c2t4b2tuaHZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5OTQ0MDMsImV4cCI6MjA5NzU3MDQwM30.QTwlSyP4c1-jIHQ_PryQFwCiKlk-GhBQ6wdfJv1lzlg';
const URL = process.env.STAGING_SUPABASE_URL + '/functions/v1/naavi-chat';
async function call(phrase) {
  const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ANON }, body: JSON.stringify({ messages: [{role:'user', content: phrase}], max_tokens: 600, user_id: USER_ID, channel: 'app' }) });
  return await res.json();
}

(async () => {
  console.log('=== Linda phone specifically ===');
  console.log((await call("What is Linda's phone number?")).rawText);

  console.log('\n=== email_actions mentioning Reyes ===');
  const { data: ea } = await sb.from('email_actions').select('vendor, amount, action_type, subject, received_at').eq('user_id', USER_ID).ilike('vendor', '%reyes%');
  console.log(JSON.stringify(ea, null, 2));

  console.log('\n=== Any James email in gmail_messages ===');
  const { data: gm } = await sb.from('gmail_messages').select('from_name, from_email, subject, received_at').eq('user_id', USER_ID).ilike('from_email', '%james%').limit(5);
  console.log(JSON.stringify(gm, null, 2));

  console.log('\n=== Any James note in knowledge_fragments ===');
  const { data: kf } = await sb.from('knowledge_fragments').select('content, created_at').eq('user_id', USER_ID).ilike('content', '%james%').limit(5);
  console.log(JSON.stringify(kf, null, 2));
})();
