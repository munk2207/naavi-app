const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

(async () => {
  const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await sb
    .from('action_rules')
    .select('*')
    .eq('id', '034c3be5-7e87-4ecb-b54b-59b8308a6dc7')
    .maybeSingle();
  if (error) { console.error('query error:', error.message); return; }
  console.log(JSON.stringify(data, null, 2));
})();
