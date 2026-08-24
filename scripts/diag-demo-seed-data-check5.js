const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';

(async () => {
  console.log('=== ALL email_actions for this user (no filter) ===');
  const { count } = await sb.from('email_actions').select('*', { count: 'exact', head: true }).eq('user_id', USER_ID);
  console.log('total count:', count);

  console.log('\n=== James emails via sender_email/sender_name ===');
  const { data: gm1 } = await sb.from('gmail_messages').select('sender_name, sender_email, subject, received_at').eq('user_id', USER_ID).ilike('sender_email', '%james%');
  const { data: gm2 } = await sb.from('gmail_messages').select('sender_name, sender_email, subject, received_at').eq('user_id', USER_ID).ilike('sender_name', '%james%');
  console.log('by email:', JSON.stringify(gm1, null, 2));
  console.log('by name:', JSON.stringify(gm2, null, 2));

  console.log('\n=== documents table for Reyes/invoices ===');
  const { count: docCount } = await sb.from('documents').select('*', { count: 'exact', head: true }).eq('user_id', USER_ID);
  console.log('total documents:', docCount);
})();
