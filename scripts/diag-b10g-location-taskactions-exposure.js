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
    .select('id, user_id, enabled, created_at, action_config')
    .eq('trigger_type', 'location');
  if (error) { console.error(`${label} query error:`, error.message); return; }
  const withTaskActions = (data ?? []).filter(r => {
    const cfg = r.action_config ?? {};
    const tasks = Array.isArray(cfg.task_actions) ? cfg.task_actions : [];
    return tasks.length > 0;
  });
  console.log(`\n=== ${label} — location rules: ${data?.length ?? 0} total, ${withTaskActions.length} with task_actions ===`);
  for (const r of withTaskActions) {
    console.log(JSON.stringify({ id: r.id, user_id: r.user_id, enabled: r.enabled, created_at: r.created_at, task_actions: r.action_config.task_actions }));
  }
}

(async () => {
  await check('STAGING', process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  await check('PRODUCTION', process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
})();
