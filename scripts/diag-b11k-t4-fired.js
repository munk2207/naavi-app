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
  const r = await fetch(`${url}/rest/v1/action_rules?id=eq.697fa07d-8c1b-459d-834e-1d95c5d186ac&select=*`, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
  });
  const [x] = await r.json();
  if (!x) return console.log('rule not found');
  console.log('label      :', x.label);
  console.log('enabled    :', x.enabled, ' one_shot:', x.one_shot);
  console.log('action_type:', x.action_type);
  console.log('body       :', JSON.stringify(x.action_config));
  console.log('fires at   :', est(x.trigger_config?.datetime));
  console.log('created    :', est(x.created_at));
  console.log('last_fired :', est(x.last_fired_at || x.fired_at));
  console.log('all keys   :', Object.keys(x).join(', '));
})();
