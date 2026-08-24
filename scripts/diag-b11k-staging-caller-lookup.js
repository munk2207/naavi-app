// B11k Phase 7 — READ-ONLY. Which phone numbers does staging recognise?
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
(async () => {
  const url = process.env.STAGING_SUPABASE_URL;
  const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${url}/rest/v1/user_settings?select=user_id,name,phone`, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
  });
  const rows = await r.json();
  console.log('STAGING user_settings rows:', Array.isArray(rows) ? rows.length : JSON.stringify(rows));
  for (const row of (Array.isArray(rows) ? rows : [])) {
    console.log(`  ${row.phone || '(no phone)'}  name=${row.name || '(none)'}  ${row.user_id}`);
  }
})();
