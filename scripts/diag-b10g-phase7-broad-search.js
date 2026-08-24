const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

async function check(label, url, key) {
  const sb = createClient(url, key);
  // Search ALL location rules for anything matching the Terranova address, any status
  const { data, error } = await sb
    .from('action_rules')
    .select('id, user_id, enabled, created_at, label, trigger_config')
    .eq('trigger_type', 'location')
    .ilike('trigger_config->>address', '%Terranova%');
  if (error) { console.error(`${label} query error:`, error.message); return; }
  console.log(`\n=== ${label} — ALL rules matching "Terranova" address, any status ===`);
  console.log(`Count: ${data?.length ?? 0}`);
  for (const r of data ?? []) {
    console.log(JSON.stringify({ id: r.id, user_id: r.user_id, enabled: r.enabled, created_at: r.created_at, label: r.label }));
  }

  // Also list ALL users known in this environment's user_settings, to confirm which user_id Wael actually is here
  const { data: users, error: uErr } = await sb.from('user_settings').select('user_id, name, phone').limit(10);
  if (!uErr) {
    console.log(`\n--- ${label} user_settings (first 10) ---`);
    for (const u of users ?? []) console.log(JSON.stringify(u));
  }
}

(async () => {
  await check('STAGING', process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  await check('PRODUCTION', process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
})();
