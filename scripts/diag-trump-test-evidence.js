const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data, error } = await sb
    .from('client_diagnostics')
    .select('*')
    .eq('user_id', '788fe85c-b6be-4506-87e8-a8736ec8e1d1')
    .order('created_at', { ascending: false })
    .limit(40);

  if (error) {
    console.error('query error:', error);
    return;
  }

  console.log(`Most recent 40 rows for Wael, newest first:\n`);
  for (const r of (data ?? []).reverse()) {
    console.log(`[${r.created_at}] step=${r.step}`);
    console.log('  ' + JSON.stringify(r.payload));
  }
})();
