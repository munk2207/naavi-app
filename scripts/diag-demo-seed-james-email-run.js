const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.STAGING_SUPABASE_URL + '/functions/v1/seed-demo-email-james';
(async () => {
  const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY }, body: '{}' });
  console.log(res.status, JSON.stringify(await res.json(), null, 2));
})();
