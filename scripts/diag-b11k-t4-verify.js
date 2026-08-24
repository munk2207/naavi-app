// B11k Phase 7, test 4 — READ-ONLY. Did the interrupted REMEMBER survive?
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
  const r = await fetch(`${url}/rest/v1/knowledge_fragments?user_id=eq.${UID}&select=id,content,created_at&order=created_at.desc&limit=8`, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
  });
  const rows = await r.json();
  console.log('Most recent memories on the staging test account:\n');
  for (const x of (Array.isArray(rows) ? rows : [rows])) {
    const hit = /spare key|blue box/i.test(x.content || '') ? '  <<< MATCH' : '';
    console.log(`  ${est(x.created_at)}  ${String(x.content || '').slice(0, 70)}${hit}`);
  }
})();
