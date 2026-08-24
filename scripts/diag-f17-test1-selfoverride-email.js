const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WAEL_USER_ID = '788fe85c-b6be-4506-87e8-a8736ec8e1d1';
const TARGET_EMAIL = 'whwh2207@gmail.com';

(async () => {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: rules, error: rulesErr } = await sb
    .from('action_rules')
    .select('id, trigger_type, action_type, action_config, created_at')
    .eq('user_id', WAEL_USER_ID)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20);

  console.log('=== Recent action_rules (last 30 min) ===');
  if (rulesErr) console.error(rulesErr);
  for (const r of rules ?? []) {
    console.log(`[${r.created_at}] id=${r.id} trigger=${r.trigger_type} action=${r.action_type}`);
    console.log('  action_config:', JSON.stringify(r.action_config));
  }

  const { data: sent, error: sentErr } = await sb
    .from('sent_messages')
    .select('*')
    .eq('user_id', WAEL_USER_ID)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(30);

  console.log('\n=== Recent sent_messages (last 30 min) ===');
  if (sentErr) console.error(sentErr);
  for (const m of sent ?? []) {
    console.log(`[${m.created_at}] channel=${m.channel} to_phone=${m.to_phone} to_email=${m.to_email} to_name=${m.to_name} body="${m.body}" status=${m.delivery_status} source=${m.source}`);
  }

  console.log(`\n=== Filter: any send to ${TARGET_EMAIL}? ===`);
  const matches = (sent ?? []).filter(m => (m.to_email || '').toLowerCase() === TARGET_EMAIL);
  console.log(matches.length ? JSON.stringify(matches, null, 2) : 'NONE FOUND');
})();
