// B11k Phase 1 — READ-ONLY. Reproduces voice's DELETE_EVENT call shape exactly
// (no user_id, service-role Authorization header) but with diag:true, which
// returns before any delete. Token resolution runs BEFORE the diag branch, so
// this proves whether that resolution can succeed at all.
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
(async () => {
  const url = process.env.STAGING_SUPABASE_URL;
  const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${url}/functions/v1/delete-calendar-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ query: 'zzz-b11k-nonexistent-probe', diag: true }),
  });
  const body = await res.json();
  console.log('STAGING  HTTP', res.status);
  console.log('body:', JSON.stringify(body).slice(0, 400));
})();
