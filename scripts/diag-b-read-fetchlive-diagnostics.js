const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';
(async () => {
  const { data, error } = await sb.from('client_diagnostics').select('*').eq('user_id', USER_ID).eq('session_id', 'b10-diag2').order('created_at', { ascending: true });
  if (error) { console.error(error); return; }
  for (const row of data) console.log(JSON.stringify(row, null, 2));
})();
