/** Discover schema for action_rules, action_rule_log, and any client log table. */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Sample any 1 row from action_rules
  const { data: r1 } = await sb.from('action_rules').select('*').limit(1);
  console.log('action_rules columns:', r1 && r1[0] ? Object.keys(r1[0]) : '(empty)');

  const { data: r2 } = await sb.from('action_rule_log').select('*').limit(1);
  console.log('action_rule_log columns:', r2 && r2[0] ? Object.keys(r2[0]) : '(empty)');

  // Try a few candidate log table names
  for (const t of ['client_logs','remote_logs','debug_logs','logs','app_logs','client_log']) {
    const { data, error } = await sb.from(t).select('*').limit(1);
    if (!error) console.log(`Table ${t} EXISTS, columns:`, data && data[0] ? Object.keys(data[0]) : '(empty)');
  }
})();
