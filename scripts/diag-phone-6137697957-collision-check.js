const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const PHONE = '+16137697957';

async function main() {
  console.log('Checking production user_settings for:', PHONE);
  console.log('SUPABASE_URL:', SUPABASE_URL);

  const { data, error } = await client
    .from('user_settings')
    .select('user_id, name, phone, phone_numbers')
    .or(`phone.eq.${PHONE},phone_numbers.cs.{${PHONE}}`);

  if (error) {
    console.error('Query error:', error);
    process.exit(1);
  }

  console.log(`Matches: ${data.length}`);
  for (const row of data) {
    console.log(JSON.stringify(row));
  }

  if (data.length > 1) {
    console.log('\n>>> DUPLICATE REGISTRATION CONFIRMED — voice caller-lookup is non-deterministic for this number.');
  } else if (data.length === 1) {
    console.log('\n>>> Single clean match — no collision for this number.');
  } else {
    console.log('\n>>> No match at all.');
  }
}

main();
