const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';

(async () => {
  console.log('=== email_actions schema sample ===');
  const { data: sample, error: sampleErr } = await sb.from('email_actions').select('*').eq('user_id', USER_ID).limit(3);
  console.log('error:', sampleErr);
  console.log('columns:', sample && sample[0] ? Object.keys(sample[0]) : '(no rows)');
  console.log(JSON.stringify(sample, null, 2));

  console.log('\n=== gmail_messages schema sample ===');
  const { data: gmSample, error: gmErr } = await sb.from('gmail_messages').select('*').eq('user_id', USER_ID).limit(3);
  console.log('error:', gmErr);
  console.log('columns:', gmSample && gmSample[0] ? Object.keys(gmSample[0]) : '(no rows)');
})();
