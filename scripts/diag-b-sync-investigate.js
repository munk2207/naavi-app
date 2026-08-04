const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';
const URL = process.env.STAGING_SUPABASE_URL + '/functions/v1/sync-google-calendar';

(async () => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({ user_id: USER_ID }),
  });
  const data = await res.json();
  console.log('HTTP status:', res.status);
  console.log('Full raw response:', JSON.stringify(data, null, 2));
})();
