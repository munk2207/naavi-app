const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
const TEST_USER = 'ae1f3438-e132-422a-9b0b-7b8819119b46';

(async () => {
  const { data, error } = await sb
    .from('pending_actions')
    .select('*')
    .eq('user_id', TEST_USER)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) { console.error('pending_actions query error:', error.message); return; }
  console.log(`--- pending_actions rows for test user: ${data?.length ?? 0} ---`);
  for (const r of data ?? []) console.log(JSON.stringify(r));
})();
