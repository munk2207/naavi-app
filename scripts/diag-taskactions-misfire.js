const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // 1. Find action_rules rows that have task_actions/tasks with a to_name (no to_phone)
  const { data: rules, error: rulesErr } = await sb
    .from('action_rules')
    .select('id, user_id, trigger_type, action_config, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (rulesErr) {
    console.error('rules query error:', rulesErr);
    return;
  }

  const candidates = (rules ?? []).filter(r => {
    const cfg = r.action_config ?? {};
    const tasks = Array.isArray(cfg.task_actions) ? cfg.task_actions : (Array.isArray(cfg.tasks) ? cfg.tasks : []);
    return tasks.length > 0;
  });

  console.log(`Found ${candidates.length} rule(s) with task_actions/tasks out of ${rules?.length ?? 0} recent rules.\n`);
  for (const r of candidates) {
    const cfg = r.action_config ?? {};
    const tasks = Array.isArray(cfg.task_actions) ? cfg.task_actions : (Array.isArray(cfg.tasks) ? cfg.tasks : []);
    console.log(`Rule ${r.id} user=${r.user_id} trigger=${r.trigger_type} created=${r.created_at}`);
    console.log('  task_actions:', JSON.stringify(tasks));
    console.log('  full action_config:', JSON.stringify(cfg));
    console.log('');
  }

  // 2. Pull recent sent_messages tagged source=alert_task (F5c's send-sms call includes source: 'alert_task')
  const { data: sent, error: sentErr } = await sb
    .from('sent_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (sentErr) {
    console.error('\nsent_messages query error (table/columns may differ):', sentErr.message);
  } else {
    console.log(`\n--- Last ${sent?.length ?? 0} sent_messages rows (checking for source=alert_task) ---`);
    for (const m of sent ?? []) {
      if (JSON.stringify(m).includes('alert_task') || JSON.stringify(m).toLowerCase().includes('good morning')) {
        console.log(JSON.stringify(m));
      }
    }
  }
})();
