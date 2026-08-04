const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';

(async () => {
  const now = Date.now();
  console.log('now (UTC):', new Date(now).toISOString());
  const timeMax = new Date(now + 7 * 24 * 60 * 60 * 1000);

  const { data, error } = await sb
    .from('calendar_events')
    .select('title, description, location, start_time, end_time, is_all_day, start_date, end_date')
    .eq('user_id', USER_ID)
    .order('start_time', { ascending: true })
    .limit(200);
  if (error) { console.error(error); return; }

  // Replicate naavi-chat's exact filter: startDate.getTime() > now (timed events)
  const kept = data.filter(e => {
    if (e.is_all_day) return true; // skip all-day logic for this check
    const start = e.start_time;
    if (!start) return false;
    return new Date(start).getTime() > now;
  });

  console.log(`Total rows fetched: ${data.length}, kept after past-filter: ${kept.length}`);
  console.log('\n--- Formatted exactly as naavi-chat would (title + date/time + location-field-only) ---');
  for (const e of kept.slice(0, 15)) {
    const startDate = new Date(e.start_time);
    const timeStr = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Toronto' });
    const dateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' });
    const detail = [`${dateStr} at ${timeStr}`];
    if (e.location) detail.push(`at ${e.location}`);
    console.log(`- [calendar] ${e.title} — ${detail.join(' ')}`);
  }

  const teamStandups = kept.filter(e => /team\s*standup/i.test(e.title));
  console.log(`\nTeam standup occurrences in the kept/future set: ${teamStandups.length}`);
  for (const t of teamStandups) console.log(JSON.stringify(t));
})();
