/**
 * seed-test-user.js — calls the seed-test-user Edge Function for the
 * dedicated mobile-test user (TEST_USER_ID from .env or tests/.env).
 *
 * Run: npm run seed:test-user
 *
 * Prerequisites in .env:
 *   SUPABASE_URL                — required
 *   SUPABASE_SERVICE_ROLE_KEY   — required (passed to the function for auth)
 *   TEST_USER_ID                — required (the user to seed)
 *
 * The Edge Function is idempotent: every test-seeded row carries a
 * "test-seed" marker, and each run deletes prior seed rows before
 * re-inserting. Real user data (other sources / labels) is never touched.
 */

const fs = require('fs');
const path = require('path');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

loadEnv(path.join(process.cwd(), '.env'));
loadEnv(path.join(process.cwd(), 'tests', '.env'));

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID      = process.env.TEST_USER_ID;

if (!SUPABASE_URL || !SERVICE_KEY || !USER_ID) {
  console.error('Missing one of: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_USER_ID');
  console.error('  SUPABASE_URL:               ' + (SUPABASE_URL ? 'present' : 'MISSING'));
  console.error('  SUPABASE_SERVICE_ROLE_KEY:  ' + (SERVICE_KEY  ? 'present' : 'MISSING'));
  console.error('  TEST_USER_ID:               ' + (USER_ID      ? 'present' : 'MISSING'));
  process.exit(2);
}

(async () => {
  console.log(`Seeding test user ${USER_ID.slice(0, 8)}…`);
  const start = Date.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/seed-test-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
      },
      body: JSON.stringify({ user_id: USER_ID }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`✗ seed-test-user returned ${res.status}: ${JSON.stringify(data)}`);
      process.exit(1);
    }
    const ms = Date.now() - start;
    const r = data.result || {};
    console.log(`✓ Seeded in ${ms}ms`);
    console.log(`  contacts:      deleted=${r.contacts?.deleted ?? '?'}  inserted=${r.contacts?.inserted ?? '?'}`);
    console.log(`  email_actions: deleted=${r.email_actions?.deleted ?? '?'}  inserted=${r.email_actions?.inserted ?? '?'}`);
    console.log(`  invoices:      deleted=${r.invoices?.deleted ?? '?'}  inserted=${r.invoices?.inserted ?? '?'}`);
    console.log(`  location:      deleted=${r.location?.deleted ?? '?'}  inserted=${r.location?.inserted ?? '?'}`);
    console.log(`  knowledge:     deleted=${r.knowledge?.deleted ?? '?'}  inserted=${r.knowledge?.inserted ?? '?'}`);
  } catch (err) {
    console.error('✗ seed-test-user threw:', err.message);
    process.exit(1);
  }
})();
