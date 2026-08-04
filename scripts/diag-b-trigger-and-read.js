const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1Z3ZuZnVkb2Z1c2t4b2tuaHZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5OTQ0MDMsImV4cCI6MjA5NzU3MDQwM30.QTwlSyP4c1-jIHQ_PryQFwCiKlk-GhBQ6wdfJv1lzlg';
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';
const URL = process.env.STAGING_SUPABASE_URL + '/functions/v1/naavi-chat';
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ANON },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'What time should I leave for team standup?' }], max_tokens: 600, user_id: USER_ID, channel: 'app' }),
  });
  const data = await res.json();
  console.log('naavi-chat reply:', data.rawText);

  await new Promise(r => setTimeout(r, 1500));
  const { data: diag } = await sb.from('client_diagnostics').select('*').eq('user_id', USER_ID).eq('session_id', 'b10-diag').order('created_at', { ascending: false }).limit(1);
  console.log('\nDiagnostic row:', JSON.stringify(diag, null, 2));
})();
