const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('C:/Users/waela/OneDrive/Desktop/Naavi/tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const userId = 'f1bc46b8-a478-43ad-bf09-e138099c8847'; // Robert, staging

// Reconstructed from direct evidence captured earlier this session (the
// "What is on my calendar right now" / "I found 4 events matching Gym"
// naavi-chat responses, both queried live before the sync-google-calendar
// incident). google_event_id values are deliberately synthetic and
// clearly marked "restored-" so they are never mistaken for real
// Google-issued IDs and so Ticket C can identify/exclude them.
const rows = [
  { title: 'Gym class', date: '2026-08-02', hour: 8 },   // was 8:00 AM per original dump
  { title: 'Gym class', date: '2026-08-03', hour: 6 },
  { title: 'Gym class', date: '2026-08-05', hour: 6 },
  { title: 'Gym class', date: '2026-08-07', hour: 6 },
  { title: 'Team standup', date: '2026-08-02', hour: 9 },
  { title: 'Team standup', date: '2026-08-03', hour: 9 },
  { title: 'Team standup', date: '2026-08-04', hour: 9 },
  { title: 'Team standup', date: '2026-08-05', hour: 9 },
  { title: 'Team standup', date: '2026-08-06', hour: 9 },
  { title: 'Team standup', date: '2026-08-07', hour: 9 },
].map((r, i) => {
  const description = r.title === 'Gym class' ? '1660 Merivale Rd, Ottawa, ON' : '340 Albert St, Ottawa, ON';
  const start = new Date(`${r.date}T${String(r.hour).padStart(2, '0')}:00:00-04:00`); // EST/EDT approx, matches original UTC offsets observed
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    user_id: userId,
    google_event_id: `restored-${r.title.replace(/\s+/g, '-').toLowerCase()}-${r.date}`,
    title: r.title,
    description,
    location: '',
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    is_all_day: false,
    item_type: 'event',
    updated_at: new Date().toISOString(),
  };
});

(async () => {
  const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  console.log('Restoring', rows.length, 'rows...');
  const { data, error } = await sb
    .from('calendar_events')
    .upsert(rows, { onConflict: 'user_id,google_event_id' })
    .select('title, start_time, google_event_id');
  if (error) { console.error('FAILED:', error.message); return; }
  console.log('Restored:');
  console.log(JSON.stringify(data, null, 2));
})();
