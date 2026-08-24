const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const RULE_ID = 'cbe32422-aad2-48c3-a4a9-d7cb48ad3277';

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: rule, error: ruleErr } = await sb
    .from('action_rules')
    .select('id, enabled, last_event_at, last_entered_at')
    .eq('id', RULE_ID)
    .single();
  if (ruleErr) console.error('rule query error:', ruleErr.message);
  console.log('Rule state after fire attempt:', JSON.stringify(rule, null, 2));

  const { data: msgs, error: msgErr } = await sb
    .from('sent_messages')
    .select('*')
    .gte('created_at', '2026-07-18T14:40:00Z')
    .lte('created_at', '2026-07-18T14:45:00Z')
    .order('created_at', { ascending: true });
  if (msgErr) console.error('sent_messages query error:', msgErr.message);
  console.log(`\nsent_messages in the fire window: ${msgs?.length ?? 0}`);
  for (const m of msgs ?? []) {
    console.log(JSON.stringify(m, null, 2));
  }
})();
