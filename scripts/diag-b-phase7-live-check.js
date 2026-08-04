const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';

(async () => {
  console.log('Server now (UTC):', new Date().toISOString());
  console.log('Server now (Toronto):', new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' }));

  const { data, error } = await sb
    .from('calendar_events')
    .select('title, description, location, start_time, end_time')
    .eq('user_id', USER_ID)
    .gte('start_time', new Date(Date.now() - 6 * 3600 * 1000).toISOString())
    .lte('start_time', new Date(Date.now() + 12 * 3600 * 1000).toISOString())
    .order('start_time', { ascending: true });
  if (error) { console.error(error); return; }
  for (const row of data) {
    const local = new Date(row.start_time).toLocaleString('en-CA', { timeZone: 'America/Toronto' });
    console.log(`[${local} Toronto] ${row.title} | location="${row.location}" | desc="${(row.description||'').slice(0,80)}"`);
  }
})();
