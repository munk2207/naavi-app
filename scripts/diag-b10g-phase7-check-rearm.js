const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const RULE_ID = 'cbe32422-aad2-48c3-a4a9-d7cb48ad3277';

async function check(label, url, key) {
  const sb = createClient(url, key);
  const { data, error } = await sb
    .from('action_rules')
    .select('id, enabled, created_at, label, trigger_config, action_config')
    .eq('id', RULE_ID)
    .maybeSingle();
  if (error) { console.error(`${label} query error:`, error.message); return; }
  console.log(`\n=== ${label} ===`);
  console.log(data ? JSON.stringify(data, null, 2) : 'NOT FOUND in this environment');
}

(async () => {
  await check('STAGING', process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  await check('PRODUCTION', process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
})();
