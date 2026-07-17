const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

async function search(label, url, key) {
  const sb = createClient(url, key);
  console.log(`\n=== ${label} — sent_messages ILIKE '%mailbox%' ===`);
  const { data, error } = await sb
    .from('sent_messages')
    .select('*')
    .ilike('body', '%mailbox%')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) { console.error(`${label} query error:`, error.message); return; }
  console.log(`rows: ${data?.length ?? 0}`);
  for (const r of data ?? []) console.log(JSON.stringify(r));

  console.log(`\n=== ${label} — action_rules with 'mailbox' anywhere in action_config ===`);
  const { data: rules, error: rulesErr } = await sb
    .from('action_rules')
    .select('*')
    .limit(500);
  if (rulesErr) { console.error(`${label} rules query error:`, rulesErr.message); return; }
  const hits = (rules ?? []).filter(r => JSON.stringify(r).toLowerCase().includes('mailbox'));
  console.log(`matching rules: ${hits.length}`);
  for (const r of hits) console.log(JSON.stringify(r));
}

(async () => {
  await search('STAGING', process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  await search('PRODUCTION', process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
})();
