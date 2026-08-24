const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data, error } = await sb.from('gmail_messages')
    .delete()
    .eq('user_id', 'f1bc46b8-a478-43ad-bf09-e138099c8847')
    .like('gmail_message_id', 'demo-seed-james-%')
    .select();
  console.log('error:', error);
  console.log('deleted:', JSON.stringify(data, null, 2));
})();
