const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

(async () => {
  const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  const userId = 'f1bc46b8-a478-43ad-bf09-e138099c8847'; // Robert, staging

  // Window covering the live phone tests: ~05:55 to 06:20 AM EST on 2026-08-02
  // = ~09:55 to 10:20 UTC.
  const { data, error } = await sb
    .from('client_diagnostics')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', '2026-08-02T09:55:00Z')
    .lte('created_at', '2026-08-02T10:20:00Z')
    .order('created_at', { ascending: true });

  if (error) { console.error(error.message); return; }
  console.log('rows:', data.length);
  for (const row of data) {
    const est = new Date(row.created_at).toLocaleString('en-CA', { timeZone: 'America/Toronto', hour12: true });
    console.log(`${est} EST | step=${row.step} | payload=${JSON.stringify(row.payload)}`);
  }
})();
