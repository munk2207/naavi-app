const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';

(async () => {
  const { data: tokenRow } = await sb.from('user_tokens').select('refresh_token').eq('user_id', USER_ID).eq('provider', 'google').single();
  if (!tokenRow?.refresh_token) { console.log('No refresh token found'); return; }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: tokenRow.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) { console.log('Token refresh failed:', JSON.stringify(tokenData)); return; }
  const accessToken = tokenData.access_token;

  const timeMin = new Date();
  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + 7);
  console.log('timeMin:', timeMin.toISOString(), 'timeMax:', timeMax.toISOString());

  const calListRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { headers: { Authorization: `Bearer ${accessToken}` } });
  const calListData = await calListRes.json();
  const calendarIds = (calListData?.items ?? []).map(c => c.id);
  console.log('Calendars found:', JSON.stringify(calendarIds));

  for (const calId of calendarIds) {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`
      + `?singleEvents=true&orderBy=startTime&maxResults=50`
      + `&timeMin=${encodeURIComponent(timeMin.toISOString())}`
      + `&timeMax=${encodeURIComponent(timeMax.toISOString())}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) { console.log(`Calendar ${calId}: HTTP ${res.status}`); continue; }
    const data = await res.json();
    const items = data.items || [];
    console.log(`\nCalendar "${calId}": ${items.length} events`);
    const standups = items.filter(e => /standup/i.test(e.summary || ''));
    console.log(`  "standup" matches in this calendar: ${standups.length}`);
    for (const s of standups) console.log('   ', JSON.stringify({ summary: s.summary, start: s.start }));
    if (items.length >= 50) console.log('  *** HIT maxResults=50 CAP — some events in this window may be missing ***');
  }
})();
