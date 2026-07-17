const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);

const TEST_USER = 'ae1f3438-e132-422a-9b0b-7b8819119b46';

(async () => {
  const { data: kfDavid, error: e1 } = await sb
    .from('knowledge_fragments')
    .select('id, user_id, content, created_at')
    .eq('user_id', TEST_USER)
    .ilike('content', '%david%')
    .order('created_at', { ascending: false })
    .limit(10);
  if (e1) { console.error('knowledge_fragments (david, scoped) query error:', e1.message); }
  else {
    console.log(`--- knowledge_fragments for user ${TEST_USER} matching "david": ${kfDavid?.length ?? 0} ---`);
    for (const k of kfDavid ?? []) console.log(JSON.stringify(k));
  }

  const { data: kfRecent, error: e2 } = await sb
    .from('knowledge_fragments')
    .select('id, user_id, content, created_at')
    .eq('user_id', TEST_USER)
    .order('created_at', { ascending: false })
    .limit(15);
  if (e2) { console.error('knowledge_fragments (recent, scoped) query error:', e2.message); }
  else {
    console.log(`\n--- most recent 15 knowledge_fragments for user ${TEST_USER}, regardless of content ---`);
    for (const k of kfRecent ?? []) console.log(JSON.stringify(k));
  }
})();
