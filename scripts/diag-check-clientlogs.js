const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  for (const t of ['client_diagnostics','client_logs','client_diag','diagnostics','remote_log','remote_logs','app_diagnostics','geofence_log','geofence_events']) {
    const { data, error } = await sb.from(t).select('*').limit(1);
    if (!error) {
      const cols = data && data[0] ? Object.keys(data[0]) : '(empty)';
      console.log(`Table "${t}" EXISTS — columns: ${JSON.stringify(cols)}`);
    }
  }
})();
