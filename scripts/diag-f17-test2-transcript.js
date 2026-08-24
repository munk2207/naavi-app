const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const start = '2026-07-17T00:11:00Z';
  const end   = '2026-07-17T00:14:00Z';
  const { data, error } = await sb
    .from('client_diagnostics')
    .select('*')
    .eq('user_id', '788fe85c-b6be-4506-87e8-a8736ec8e1d1')
    .gte('created_at', start)
    .lte('created_at', end)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) return console.error(error);
  console.log(`${data?.length ?? 0} rows\n`);
  for (const r of data ?? []) {
    console.log(`[${r.created_at}] step=${r.step}`);
    console.log('  ' + JSON.stringify(r.payload));
  }
})();
