const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

(async () => {
  const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);

  console.log('=== Find Robert by email ===');
  const { data: users, error: usersErr } = await sb.auth.admin.listUsers({ perPage: 200 });
  if (usersErr) { console.error('listUsers error:', usersErr.message); return; }
  const robert = users.users.find(u => u.email === 'robert.esm.2207@gmail.com');
  if (!robert) { console.log('Robert not found among', users.users.length, 'users'); return; }
  const userId = robert.id;
  console.log('Robert user_id:', userId);

  console.log('\n=== user_settings ===');
  const { data: settings, error: settingsErr } = await sb
    .from('user_settings')
    .select('name, phone, home_address, work_address, alert_channels_enabled')
    .eq('user_id', userId)
    .maybeSingle();
  if (settingsErr) console.error('settings error:', settingsErr.message);
  else console.log(JSON.stringify(settings, null, 2));

  console.log('\n=== contacts (Linda/James/Tom/Marcus/Priya) ===');
  const { data: contacts, error: contactsErr } = await sb
    .from('contacts')
    .select('name, email, phone')
    .eq('user_id', userId)
    .or('name.ilike.%Linda%,name.ilike.%James%,name.ilike.%Tom%,name.ilike.%Marcus%,name.ilike.%Priya%');
  if (contactsErr) console.error('contacts error:', contactsErr.message);
  else console.log(JSON.stringify(contacts, null, 2));

  console.log('\n=== action_rules (all enabled) ===');
  const { data: rules, error: rulesErr } = await sb
    .from('action_rules')
    .select('id, trigger_type, trigger_config, action_type, action_config, enabled, created_at')
    .eq('user_id', userId)
    .eq('enabled', true);
  if (rulesErr) console.error('rules error:', rulesErr.message);
  else console.log(JSON.stringify(rules, null, 2));

  console.log('\n=== calendar_events count + sample with location ===');
  const { data: events, error: eventsErr } = await sb
    .from('calendar_events')
    .select('title, start_time, is_all_day, location')
    .eq('user_id', userId)
    .order('start_time', { ascending: true })
    .limit(30);
  if (eventsErr) console.error('events error:', eventsErr.message);
  else {
    console.log('total fetched (cap 30):', events.length);
    console.log('with location:', events.filter(e => e.location && e.location.trim()).length);
    console.log(JSON.stringify(events, null, 2));
  }

  console.log('\n=== lists ===');
  const { data: lists, error: listsErr } = await sb
    .from('lists')
    .select('id, name, items')
    .eq('user_id', userId);
  if (listsErr) console.error('lists error:', listsErr.message);
  else console.log(JSON.stringify(lists?.map(l => ({ id: l.id, name: l.name, item_count: Array.isArray(l.items) ? l.items.length : 'n/a' })), null, 2));

  console.log('\n=== knowledge_fragments (wife/Linda/Elena) ===');
  const { data: kf, error: kfErr } = await sb
    .from('knowledge_fragments')
    .select('content, created_at')
    .eq('user_id', userId)
    .or('content.ilike.%wife%,content.ilike.%Linda%,content.ilike.%Elena%');
  if (kfErr) console.error('knowledge_fragments error:', kfErr.message);
  else console.log(JSON.stringify(kf, null, 2));

  console.log('\n=== documents (any harvested yet — should be near-empty pre-seed) ===');
  const { data: docs, error: docsErr, count } = await sb
    .from('documents')
    .select('file_name, document_type, extracted_amount_cents, extracted_date, created_at', { count: 'exact' })
    .eq('user_id', userId)
    .limit(20);
  if (docsErr) console.error('documents error:', docsErr.message);
  else { console.log('total count:', count); console.log(JSON.stringify(docs, null, 2)); }

  console.log('\n=== email_actions (Reyes Build) ===');
  const { data: ea, error: eaErr } = await sb
    .from('email_actions')
    .select('vendor, action_type, amount_cents, created_at')
    .eq('user_id', userId)
    .ilike('vendor', '%Reyes%');
  if (eaErr) console.error('email_actions error:', eaErr.message);
  else console.log(JSON.stringify(ea, null, 2));
})();
