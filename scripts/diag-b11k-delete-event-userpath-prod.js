// B11k Phase 1 — READ-ONLY probe against PRODUCTION. diag:true returns before
// any delete; token resolution runs first, which is the path under test.
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
(async () => {
  const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/delete-calendar-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({ query: 'zzz-b11k-nonexistent-probe', diag: true }),
  });
  console.log('PRODUCTION  HTTP', res.status);
  console.log('body:', JSON.stringify(await res.json()).slice(0, 400));
})();
