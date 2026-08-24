const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const USER_ID = 'f1bc46b8-a478-43ad-bf09-e138099c8847';
const URL = process.env.STAGING_SUPABASE_URL + '/functions/v1/manage-list';

async function call(body) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  console.log(res.status, JSON.stringify(data));
  return data;
}

(async () => {
  console.log('=== LIST_CREATE ===');
  await call({ type: 'LIST_CREATE', name: 'work', category: 'tasks', user_id: USER_ID });

  console.log('=== LIST_ADD ===');
  await call({
    type: 'LIST_ADD',
    listName: 'work',
    items: ['Order flooring for Riverside project', 'Call inspector about permit', 'Send Reyes Build invoice', 'Follow up with electrician'],
    user_id: USER_ID,
  });
})();
