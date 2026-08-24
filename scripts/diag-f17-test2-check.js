const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WAEL_USER_ID = '788fe85c-b6be-4506-87e8-a8736ec8e1d1';

(async () => {
  console.log('Current UTC time:', new Date().toISOString());
  const { data, error } = await sb
    .from('action_rules')
    .select('*')
    .eq('user_id', WAEL_USER_ID)
    .order('created_at', { ascending: false })
    .limit(3);
  if (error) return console.error(error);
  for (const r of data ?? []) {
    console.log(`\n[${r.created_at}] id=${r.id}`);
    console.log(JSON.stringify(r, null, 2));
  }
})();
