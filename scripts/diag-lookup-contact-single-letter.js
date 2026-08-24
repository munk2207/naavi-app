const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const WAEL_USER_ID = '788fe85c-b6be-4506-87e8-a8736ec8e1d1';

(async () => {
  for (const letter of ['A', 'B', 'C']) {
    const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/lookup-contact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ name: letter, user_id: WAEL_USER_ID }),
    });
    const data = await res.json();
    console.log(`\n=== query "${letter}" (status ${res.status}) ===`);
    console.log(JSON.stringify(data, null, 2));
  }
})();
