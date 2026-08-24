const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WAEL_USER_ID = '788fe85c-b6be-4506-87e8-a8736ec8e1d1';
const RULE_ID = 'c0761f56-8e22-4016-878d-fcd6154e3308';

(async () => {
  console.log('Current UTC time:', new Date().toISOString());

  const { data: rule, error: ruleErr } = await sb
    .from('action_rules')
    .select('*')
    .eq('id', RULE_ID)
    .single();
  console.log('\n=== Rule row now ===');
  if (ruleErr) console.error(ruleErr);
  console.log(JSON.stringify(rule, null, 2));

  const { data: sent, error: sentErr } = await sb
    .from('sent_messages')
    .select('*')
    .eq('user_id', WAEL_USER_ID)
    .gte('created_at', '2026-07-16T23:50:00Z')
    .order('created_at', { ascending: true })
    .limit(30);
  console.log('\n=== sent_messages since 23:50 UTC ===');
  if (sentErr) console.error(sentErr);
  for (const m of sent ?? []) {
    console.log(`[${m.created_at}] channel=${m.channel} to_phone=${m.to_phone} to_email=${m.to_email} body="${m.body}" status=${m.delivery_status} source=${m.source}`);
  }

  // Voice call evidence, if any table/log tracks it
  const { data: diag, error: diagErr } = await sb
    .from('client_diagnostics')
    .select('*')
    .eq('user_id', WAEL_USER_ID)
    .gte('created_at', '2026-07-17T00:00:00Z')
    .lte('created_at', '2026-07-17T00:15:00Z')
    .order('created_at', { ascending: true })
    .limit(50);
  console.log('\n=== client_diagnostics 00:00-00:15 UTC (around fire time) ===');
  if (diagErr) console.error(diagErr);
  for (const r of diag ?? []) {
    console.log(`[${r.created_at}] step=${r.step}`);
    console.log('  ' + JSON.stringify(r.payload).slice(0, 300));
  }
})();
