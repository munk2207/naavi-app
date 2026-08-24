const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

(async () => {
  const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);

  const { data: rule } = await sb
    .from('action_rules')
    .select('id, enabled, last_event_at, last_entered_at, action_config')
    .eq('id', '034c3be5-7e87-4ecb-b54b-59b8308a6dc7')
    .maybeSingle();
  console.log('Rule state after fire:', JSON.stringify(rule, null, 2));

  const { data: msgs, error } = await sb
    .from('sent_messages')
    .select('*')
    .gte('created_at', new Date(Date.now() - 5 * 60000).toISOString())
    .order('created_at', { ascending: true });
  if (error) { console.error('sent_messages query error:', error.message); return; }
  console.log(`\nsent_messages in the last 5 minutes: ${msgs?.length ?? 0}`);
  for (const m of msgs ?? []) {
    console.log(JSON.stringify({ channel: m.channel, to_name: m.to_name, to_phone: m.to_phone, body: m.body, source: m.source, delivery_status: m.delivery_status, sent_at: m.sent_at }));
  }
})();
