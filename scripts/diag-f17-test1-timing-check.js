const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  console.log('Current UTC time:', new Date().toISOString());

  const { data: rule, error } = await sb
    .from('action_rules')
    .select('*')
    .eq('id', 'c0761f56-8e22-4016-878d-fcd6154e3308')
    .single();

  console.log('\n=== Full rule row ===');
  if (error) console.error(error);
  console.log(JSON.stringify(rule, null, 2));
})();
