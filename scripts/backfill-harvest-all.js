/**
 * backfill-harvest-all.js
 *
 * Calls harvest-attachment for every email in gmail_messages that:
 *   - belongs to a given user_id
 *   - has NOT already been fully harvested (no documents row linking it)
 *
 * Runs in batches of 5 concurrent requests to stay within Edge Function limits.
 * Logs progress every 10 emails.
 *
 * Usage:
 *   node scripts/backfill-harvest-all.js
 *
 * Reads from .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const fs = require('fs');
const path = require('path');

// Load .env — try tests/.env (has Supabase keys) then scripts/.env
for (const rel of ['tests/.env', 'scripts/.env', '.env']) {
  const envPath = path.join(__dirname, '..', rel);
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER_ID      = '788fe85c-b6be-4506-87e8-a8736ec8e1d1'; // Wael
const BATCH_SIZE   = 5;
const DELAY_MS     = 500; // between batches

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const headers = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function fetchAll(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function callHarvest(gmail_message_id) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/harvest-attachment`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ user_id: USER_ID, gmail_message_id }),
    });
    const data = await res.json();
    if (!res.ok) return { gmail_message_id, ok: false, error: data.error ?? res.status };
    return {
      gmail_message_id,
      ok: true,
      processed: data.processed?.length ?? 0,
      skipped: data.skipped?.length ?? 0,
      reason: data.reason ?? null,
    };
  } catch (err) {
    return { gmail_message_id, ok: false, error: err.message };
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log(`[backfill] Starting harvest backfill for user ${USER_ID}`);

  // Fetch all gmail_message_ids for this user
  let allEmails = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const page = await fetchAll(
      `${SUPABASE_URL}/rest/v1/gmail_messages` +
      `?user_id=eq.${USER_ID}&select=gmail_message_id&order=received_at.desc&limit=${pageSize}&offset=${offset}`
    );
    if (!Array.isArray(page) || page.length === 0) break;
    allEmails = allEmails.concat(page.map(r => r.gmail_message_id));
    if (page.length < pageSize) break;
    offset += pageSize;
    console.log(`[backfill] Loaded ${allEmails.length} emails so far...`);
  }
  console.log(`[backfill] Total emails in DB: ${allEmails.length}`);

  // Fetch already-harvested gmail_message_ids (emails with at least one documents row)
  let harvestedSet = new Set();
  let hoffset = 0;
  while (true) {
    const page = await fetchAll(
      `${SUPABASE_URL}/rest/v1/documents` +
      `?user_id=eq.${USER_ID}&select=gmail_message_id&not.is.gmail_message_id.null&limit=${pageSize}&offset=${hoffset}`
    );
    if (!Array.isArray(page) || page.length === 0) break;
    for (const r of page) if (r.gmail_message_id) harvestedSet.add(r.gmail_message_id);
    if (page.length < pageSize) break;
    hoffset += pageSize;
  }
  console.log(`[backfill] Already harvested: ${harvestedSet.size} emails`);

  const toProcess = allEmails.filter(id => !harvestedSet.has(id));
  console.log(`[backfill] To process: ${toProcess.length} emails`);

  if (toProcess.length === 0) {
    console.log('[backfill] Nothing to do.');
    return;
  }

  let done = 0, totalProcessed = 0, totalSkipped = 0, totalErrors = 0;
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(id => callHarvest(id)));

    for (const r of results) {
      done++;
      if (r.ok) {
        totalProcessed += r.processed;
        totalSkipped += r.skipped;
      } else {
        totalErrors++;
      }
    }

    if (done % 10 === 0 || done === toProcess.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const pct = ((done / toProcess.length) * 100).toFixed(1);
      console.log(
        `[backfill] ${done}/${toProcess.length} (${pct}%) | ` +
        `uploaded=${totalProcessed} skipped=${totalSkipped} errors=${totalErrors} | ${elapsed}s`
      );
    }

    if (i + BATCH_SIZE < toProcess.length) await sleep(DELAY_MS);
  }

  console.log(`\n[backfill] Done.`);
  console.log(`  Emails processed : ${done}`);
  console.log(`  Files uploaded   : ${totalProcessed}`);
  console.log(`  Files skipped    : ${totalSkipped}`);
  console.log(`  Errors           : ${totalErrors}`);
}

main().catch(err => {
  console.error('[backfill] Fatal:', err.message);
  process.exit(1);
});
