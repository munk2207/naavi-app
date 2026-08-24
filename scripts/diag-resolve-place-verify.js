const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

(async () => {
  const prod = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: users, error } = await prod.auth.admin.listUsers({ perPage: 200 });
  if (error) { console.error(error.message); return; }
  const wael = users.users.find(u => u.email === 'wael.aggan@gmail.com');
  if (!wael) { console.log('Wael not found'); return; }
  console.log('Wael user_id:', wael.id);

  console.log('\n=== PRODUCTION resolve-place("500 Eagleson Rd, Kanata, ON K2L 2X1, Canada") ===');
  const r = await fetch(process.env.SUPABASE_URL + '/functions/v1/resolve-place', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ user_id: wael.id, place_name: '500 Eagleson Rd, Kanata, ON K2L 2X1, Canada', save_to_cache: false }),
  });
  console.log('status:', r.status);
  console.log(await r.text());

  console.log('\n=== STAGING resolve-place (sanity check, same address) ===');
  const r2 = await fetch(process.env.STAGING_SUPABASE_URL + '/functions/v1/resolve-place', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({ user_id: 'f1bc46b8-a478-43ad-bf09-e138099c8847', place_name: '500 Eagleson Rd, Kanata, ON K2L 2X1, Canada', save_to_cache: false }),
  });
  console.log('status:', r2.status);
  console.log(await r2.text());
})();
