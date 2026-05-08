const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await sb.from('client_diagnostics').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(80);
  console.log('Last 80 events in last 60 min:');
  const counts = {};
  for (const r of data ?? []) {
    const e = r.event ?? r.event_name ?? '?';
    counts[e] = (counts[e] ?? 0) + 1;
  }
  for (const [event, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}x  ${event}`);
  }
  console.log('\n--- column names from first row ---');
  if (data && data.length > 0) {
    console.log(Object.keys(data[0]));
  }
})();
