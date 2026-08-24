// B11k Phase 1 — read-only. How many google token rows exist per project?
// Decides whether delete-calendar-event's no-user_id path can resolve at all.
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
(async () => {
  for (const [label, url, key] of [
    ['STAGING', process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY],
    ['PRODUCTION', process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY],
  ]) {
    if (!url || !key) { console.log(`${label}: creds missing in tests/.env — skipped`); continue; }
    const r = await fetch(`${url}/rest/v1/user_tokens?provider=eq.google&select=user_id`, {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
    });
    const rows = await r.json();
    console.log(`${label}: ${Array.isArray(rows) ? rows.length : JSON.stringify(rows)} row(s) with provider='google'`);
  }
})();
