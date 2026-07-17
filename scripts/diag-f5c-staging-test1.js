const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: rules, error } = await sb
    .from('action_rules')
    .select('id, user_id, trigger_type, enabled, action_config, trigger_config, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) { console.error('rules query error:', error); return; }
  for (const r of rules ?? []) {
    console.log(`Rule ${r.id} user=${r.user_id} trigger=${r.trigger_type} enabled=${r.enabled} created=${r.created_at}`);
    console.log('  trigger_config:', JSON.stringify(r.trigger_config));
    console.log('  action_config:', JSON.stringify(r.action_config));
    console.log('');
  }
})();
