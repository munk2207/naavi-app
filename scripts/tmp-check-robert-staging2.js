const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

(async () => {
  const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await sb
    .from('user_settings')
    .select('user_id, name, phone, alert_channels_enabled, home_address, work_address, updated_at')
    .eq('user_id', 'f1bc46b8-a478-43ad-bf09-e138099c8847')
    .maybeSingle();
  if (error) { console.error('error:', error.message); return; }
  console.log(JSON.stringify(data, null, 2));
})();
