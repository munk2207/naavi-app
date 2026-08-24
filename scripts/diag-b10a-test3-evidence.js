const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // B10a manual tests window: pushed 10:09:25 EDT = 14:09:25 UTC. Tests ran
  // shortly after (doc cites 10:13-10:14 AM EDT for test 1). Widen window
  // to cover 14:05 - 15:00 UTC to catch all three scenarios plus the later
  // "abc" attempt for comparison.
  const start = '2026-07-16T14:05:00Z';
  const end   = '2026-07-16T15:05:00Z';

  const { data, error } = await sb
    .from('client_diagnostics')
    .select('*')
    .gte('created_at', start)
    .lte('created_at', end)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) {
    console.error('client_diagnostics query error:', error);
    return;
  }

  console.log(`${data?.length ?? 0} client_diagnostics rows between ${start} and ${end}\n`);
  for (const r of data ?? []) {
    const evt = r.event ?? r.event_name ?? '?';
    const detail = JSON.stringify(r).slice(0, 300);
    console.log(`[${r.created_at}] ${evt}`);
    console.log('  ' + detail);
  }
})();
