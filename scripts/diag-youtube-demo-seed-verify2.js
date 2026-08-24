const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

(async () => {
  console.log('=== PRODUCTION calendar_events.location column check ===');
  const prod = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: prodRow, error: prodErr } = await prod
    .from('calendar_events')
    .select('id, location')
    .limit(1);
  if (prodErr) console.error('PRODUCTION error:', prodErr.message);
  else console.log('PRODUCTION: location column exists. Sample:', JSON.stringify(prodRow));

  console.log('\n=== STAGING calendar_events full column probe ===');
  const staging = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  const { data: stagingRow, error: stagingErr } = await staging
    .from('calendar_events')
    .select('*')
    .limit(1);
  if (stagingErr) console.error('STAGING error:', stagingErr.message);
  else console.log('STAGING columns present:', stagingRow?.[0] ? Object.keys(stagingRow[0]) : '(no rows to introspect, table empty)');

  const userId = 'f1bc46b8-a478-43ad-bf09-e138099c8847';
  console.log('\n=== STAGING calendar_events for Robert (title, start_time, description) ===');
  const { data: events, error: eventsErr } = await staging
    .from('calendar_events')
    .select('title, start_time, is_all_day, description')
    .eq('user_id', userId)
    .order('start_time', { ascending: true })
    .limit(25);
  if (eventsErr) console.error('events error:', eventsErr.message);
  else {
    console.log('count:', events.length);
    console.log(JSON.stringify(events, null, 2));
  }

  console.log('\n=== STAGING lists (correct columns) ===');
  const { data: lists, error: listsErr } = await staging
    .from('lists')
    .select('id, name, category, drive_file_id, web_view_link')
    .eq('user_id', userId);
  if (listsErr) console.error('lists error:', listsErr.message);
  else console.log(JSON.stringify(lists, null, 2));
})();
