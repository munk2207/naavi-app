/**
 * Pull client_diagnostics rows for Wael's geofence chain on the 10 AM drive.
 * Tests the leading theory: phantom-suppression at useGeofencing.ts:138.
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WAEL = '788fe85c-b6be-4506-87e8-a8736ec8e1d1';

(async () => {
  const since = new Date(Date.now() - 6*3600*1000).toISOString();
  console.log(`Pulling client_diagnostics for Wael since ${since}`);

  const { data, error } = await sb
    .from('client_diagnostics')
    .select('*')
    .eq('user_id', WAEL)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) { console.log('ERROR:', error.message); return; }
  console.log(`Total rows last 6h: ${data.length}\n`);

  // Group by step name
  const byStep = {};
  for (const r of data) {
    byStep[r.step] = (byStep[r.step] || 0) + 1;
  }
  console.log('=== Step counts ===');
  for (const [k, v] of Object.entries(byStep).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${v.toString().padStart(4)}  ${k}`);
  }

  // Filter to geofence-related steps
  const geofenceSteps = data.filter(r => r.step && (
    r.step.includes('geofence') ||
    r.step.includes('lifecycle') ||
    r.step.includes('syncGeofences') ||
    r.step.includes('location')
  ));
  console.log(`\n=== Geofence/lifecycle events (${geofenceSteps.length}) — last 80 ===`);
  for (const r of geofenceSteps.slice(0, 80)) {
    const p = r.payload ? JSON.stringify(r.payload).slice(0, 180) : '';
    console.log(`  ${r.created_at}  build=${r.build_version || '?'}  ${r.step}  ${p}`);
  }

  // Specifically look for phantom suppression
  const phantoms = data.filter(r => r.step && r.step.includes('phantom'));
  console.log(`\n=== Phantom suppressions (${phantoms.length}) ===`);
  for (const r of phantoms) {
    console.log(`  ${r.created_at}  ${r.step}  ${JSON.stringify(r.payload || {}).slice(0,200)}`);
  }

  // Specifically look for syncGeofences-end results (registration success counts)
  const syncEnds = data.filter(r => r.step === 'syncGeofences-end');
  console.log(`\n=== syncGeofences-end events (${syncEnds.length}) ===`);
  for (const r of syncEnds) {
    console.log(`  ${r.created_at}  ${JSON.stringify(r.payload || {})}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
