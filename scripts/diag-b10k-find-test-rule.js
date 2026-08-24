const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await sb
    .from('action_rules')
    .select('id, user_id, enabled, created_at, label, trigger_config, action_config')
    .eq('trigger_type', 'location')
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) { console.error('query error:', error.message); return; }
  for (const r of data ?? []) {
    const cfg = r.action_config ?? {};
    const tasks = Array.isArray(cfg.task_actions) ? cfg.task_actions : [];
    console.log(JSON.stringify({
      id: r.id,
      user_id: r.user_id,
      enabled: r.enabled,
      created_at: r.created_at,
      label: r.label,
      trigger_config: r.trigger_config,
      body: cfg.body,
      task_actions: tasks,
    }, null, 2));
    console.log('---');
  }
})();
