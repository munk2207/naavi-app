const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
(async () => {
  const staging = createClient(process.env.STAGING_SUPABASE_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await staging.auth.admin.listUsers({ perPage: 200 });
  if (error) { console.error(error.message); return; }
  const user = data.users.find(u => u.email === 'mynaavi2207@gmail.com');
  console.log(user ? `mynaavi2207@gmail.com -> ${user.id}` : 'mynaavi2207@gmail.com NOT FOUND on staging');
})();
