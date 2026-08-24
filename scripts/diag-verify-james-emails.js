const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await sb.from('gmail_messages').select('gmail_message_id, sender_name, sender_email, subject, received_at, is_tier1, signal_strength').eq('user_id', 'f1bc46b8-a478-43ad-bf09-e138099c8847').ilike('sender_email', '%james%');
  console.log(JSON.stringify(data, null, 2));
})();
