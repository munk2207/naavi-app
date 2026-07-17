const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: sent, error } = await sb
    .from('sent_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) { console.error('sent_messages query error:', error.message); return; }
  for (const m of sent ?? []) {
    console.log(JSON.stringify(m));
  }
  console.log('\n--- current time UTC:', new Date().toISOString());
})();
