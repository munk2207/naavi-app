const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

async function check(label, url, key) {
  const sb = createClient(url, key);
  const { data, error } = await sb
    .from('action_rules')
    .select('id, user_id, enabled, created_at, label, trigger_type, trigger_config, action_config')
    .eq('trigger_type', 'location')
    .order('created_at', { ascending: false })
    .limit(3);
  if (error) { console.error(`${label} query error:`, error.message); return; }
  console.log(`\n=== ${label} — most recent 3 location rules ===`);
  for (const r of data ?? []) {
    const cfg = r.action_config ?? {};
    console.log(JSON.stringify({
      id: r.id, enabled: r.enabled, created_at: r.created_at, label: r.label,
      body: cfg.body, task_actions: cfg.task_actions ?? [],
    }));
  }
}

(async () => {
  await check('STAGING', process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  await check('PRODUCTION', process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
})();
