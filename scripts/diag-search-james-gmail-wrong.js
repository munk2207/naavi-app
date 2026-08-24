const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';
(async () => {
  console.log('=== knowledge_fragments mentioning james ===');
  const { data: kf } = await sb.from('knowledge_fragments').select('*').eq('user_id', USER_ID).ilike('content', '%james%');
  console.log(JSON.stringify(kf, null, 2));

  console.log('\n=== gmail_messages mentioning james.esm ===');
  const { data: gm } = await sb.from('gmail_messages').select('*').eq('user_id', USER_ID).or('sender_email.ilike.%james%,body_text.ilike.%james.esm%,snippet.ilike.%james.esm%');
  console.log(JSON.stringify(gm, null, 2));

  console.log('\n=== email_actions mentioning james ===');
  const { data: ea } = await sb.from('email_actions').select('*').eq('user_id', USER_ID).ilike('vendor', '%james%');
  console.log(JSON.stringify(ea, null, 2));
})();
