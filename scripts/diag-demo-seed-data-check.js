const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';

(async () => {
  console.log('=== user_settings ===');
  const { data: us, error: usErr } = await sb.from('user_settings').select('*').eq('user_id', USER_ID).maybeSingle();
  if (usErr) console.error(usErr);
  console.log(JSON.stringify({
    name: us?.name, phone: us?.phone, home_address: us?.home_address, work_address: us?.work_address,
    alert_channels_enabled: us?.alert_channels_enabled,
  }, null, 2));

  console.log('\n=== lists ===');
  const { data: lists } = await sb.from('lists').select('id, name, category').eq('user_id', USER_ID);
  console.log(JSON.stringify(lists, null, 2));

  console.log('\n=== action_rules (location, enabled) ===');
  const { data: rules } = await sb.from('action_rules').select('id, label, trigger_type, trigger_config, enabled').eq('user_id', USER_ID).eq('trigger_type', 'location');
  console.log(JSON.stringify(rules, null, 2));

  console.log('\n=== calendar_events matching "meeting" or "standup" (next occurrence) ===');
  const { data: events } = await sb.from('calendar_events').select('title, location, description, start_time').eq('user_id', USER_ID).ilike('title', '%standup%').order('start_time', { ascending: true }).limit(3);
  console.log(JSON.stringify(events, null, 2));
})();
