const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';

(async () => {
  const nowISO = new Date().toISOString();
  console.log('Server "now" (UTC):', nowISO);
  console.log('Server "now" (Toronto):', new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' }));

  const { data, error } = await sb
    .from('calendar_events')
    .select('title, start_time, end_time, is_all_day, start_date, end_date, updated_at')
    .eq('user_id', USER_ID)
    .order('start_time', { ascending: true })
    .limit(10);
  if (error) { console.error('Query error:', error); return; }
  console.log(`Total rows returned (first 10): ${data.length}`);
  for (const row of data) console.log(JSON.stringify(row));

  const { count } = await sb
    .from('calendar_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', USER_ID);
  console.log('Total row count for this user:', count);
})();
