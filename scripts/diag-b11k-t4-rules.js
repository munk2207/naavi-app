// B11k Phase 7 T4 — READ-ONLY. What action_rules exist for the staging Robert account?
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const UID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';
const est = t => t ? new Date(t).toLocaleString('en-CA', { timeZone: 'America/Toronto' }) : '(null)';
(async () => {
  const url = process.env.STAGING_SUPABASE_URL;
  const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${url}/rest/v1/action_rules?user_id=eq.${UID}&select=id,trigger_type,trigger_config,label,enabled,one_shot,created_at&order=created_at.desc&limit=12`, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
  });
  const rows = await r.json();
  console.log('action_rules rows:', Array.isArray(rows) ? rows.length : JSON.stringify(rows));
  for (const x of (Array.isArray(rows) ? rows : [])) {
    console.log(`  [${x.trigger_type}] enabled=${x.enabled} one_shot=${x.one_shot}`);
    console.log(`     label="${x.label}"  when=${est(x.trigger_config?.datetime)}`);
    console.log(`     created=${est(x.created_at)}  id=${x.id}`);
  }
})();
