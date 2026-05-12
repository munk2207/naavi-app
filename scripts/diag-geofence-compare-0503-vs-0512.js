/**
 * Compare 2026-05-03 (V57.10.5 build 141, NO foreground service, 28 T1 events observed)
 * vs 2026-05-12 today (V57.14.3 build 169 + V57.14.2 build 168, FG service added).
 *
 * If T1 events fire on 5-03 but not on 5-12, the difference is what V57.14.3 added —
 * candidate culprits: foreground service interaction, persistent registry, or
 * re-registration thrash being amplified.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WAEL = '788fe85c-b6be-4506-87e8-a8736ec8e1d1';

async function pullWindow(label, sinceISO, untilISO) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`${label}`);
  console.log(`  window: ${sinceISO}  →  ${untilISO}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const { data, error } = await sb
    .from('client_diagnostics')
    .select('created_at, step, payload, build_version')
    .eq('user_id', WAEL)
    .gte('created_at', sinceISO)
    .lte('created_at', untilISO)
    .order('created_at', { ascending: true })
    .limit(3000);

  if (error) { console.log('ERROR:', error.message); return; }
  console.log(`Total events: ${data.length}\n`);

  // Builds seen
  const builds = {};
  for (const r of data) builds[r.build_version || '?'] = (builds[r.build_version || '?'] || 0) + 1;
  console.log('--- builds present in window ---');
  for (const [b, c] of Object.entries(builds).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${String(c).padStart(4)}  ${b}`);
  }
  console.log('');

  // Step counts (geofence/sync/fg-location/lifecycle)
  const interesting = data.filter(r => r.step && (
    r.step.includes('geofence') ||
    r.step.includes('fg-location') ||
    r.step.includes('syncGeofences') ||
    r.step === 'lifecycle-appstate'
  ));
  const byStep = {};
  for (const r of interesting) byStep[r.step] = (byStep[r.step] || 0) + 1;
  console.log('--- relevant step counts ---');
  for (const [k, v] of Object.entries(byStep).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  console.log('');

  // KEY NUMBERS for comparison
  const t1Count   = byStep['geofence-T1-task-fired'] || 0;
  const t1Suppress= byStep['geofence-T1-suppressed-phantom'] || 0;
  const t2Count   = byStep['geofence-T2-about-to-post'] || 0;
  const syncStart = byStep['syncGeofences-start'] || 0;
  const syncEnd   = byStep['syncGeofences-end'] || 0;
  const fgStart   = byStep['fg-location-service-started'] || 0;
  const fgStop    = byStep['fg-location-service-stopped'] || 0;
  const appActive = data.filter(r => r.step === 'lifecycle-appstate' && r.payload?.state === 'active').length;
  const appBgnd   = data.filter(r => r.step === 'lifecycle-appstate' && r.payload?.state === 'background').length;

  console.log('--- KEY NUMBERS ---');
  console.log(`  T1 task-fired events       : ${t1Count}`);
  console.log(`  T1 suppressed (phantom)    : ${t1Suppress}`);
  console.log(`  T2 about-to-post events    : ${t2Count}`);
  console.log(`  syncGeofences-start calls  : ${syncStart}`);
  console.log(`  syncGeofences-end calls    : ${syncEnd}`);
  console.log(`  FG service started         : ${fgStart}`);
  console.log(`  FG service stopped         : ${fgStop}`);
  console.log(`  AppState → active          : ${appActive}`);
  console.log(`  AppState → background      : ${appBgnd}`);
  console.log('');

  // Sample T1 events with payload (first 10)
  if (t1Count > 0) {
    const t1s = data.filter(r => r.step === 'geofence-T1-task-fired').slice(0, 10);
    console.log(`--- first ${t1s.length} T1 events ---`);
    for (const r of t1s) {
      const t = r.created_at.split('T')[1].split('.')[0];
      console.log(`  ${t}  build=${r.build_version}  ${JSON.stringify(r.payload || {}).slice(0,180)}`);
    }
    console.log('');
  }

  // Sample syncGeofences-end (first 10) to see register counts
  const ends = data.filter(r => r.step === 'syncGeofences-end').slice(0, 15);
  if (ends.length > 0) {
    console.log(`--- first ${ends.length} syncGeofences-end (showing registered count) ---`);
    for (const r of ends) {
      const t = r.created_at.split('T')[1].split('.')[0];
      console.log(`  ${t}  build=${r.build_version}  ${JSON.stringify(r.payload || {}).slice(0,180)}`);
    }
    console.log('');
  }

  return { t1Count, syncStart, fgStart, fgStop, appActive, totalEvents: data.length };
}

(async () => {
  // 2026-05-03 — V57.10.5 build 141, NO foreground service, no persistent registry
  // 2:02 PM EDT drive = 18:02 UTC; widen to 13:00-22:00 UTC for full coverage
  const r0503 = await pullWindow(
    'WINDOW A — 2026-05-03 (V57.10.5 build 141, no FG service)',
    '2026-05-03T13:00:00Z',
    '2026-05-03T22:00:00Z'
  );

  // 2026-05-12 today — V57.14.3 build 169 + 168, FG service active
  // 5:02 AM EDT = 09:02 UTC; pull through now (let's say 22:00 UTC = 6 PM EDT)
  const r0512 = await pullWindow(
    'WINDOW B — 2026-05-12 today (V57.14.3 build 169 + 168, FG service active)',
    '2026-05-12T08:00:00Z',
    '2026-05-12T23:00:00Z'
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Side-by-side
  // ─────────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SIDE-BY-SIDE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('                              2026-05-03      2026-05-12');
  console.log('                              build 141       build 169');
  console.log('                              no FG service   FG service ON');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log(`  total events            :  ${String(r0503?.totalEvents ?? '-').padStart(8)}        ${String(r0512?.totalEvents ?? '-').padStart(8)}`);
  console.log(`  AppState → active       :  ${String(r0503?.appActive   ?? '-').padStart(8)}        ${String(r0512?.appActive   ?? '-').padStart(8)}`);
  console.log(`  syncGeofences-start     :  ${String(r0503?.syncStart   ?? '-').padStart(8)}        ${String(r0512?.syncStart   ?? '-').padStart(8)}`);
  console.log(`  FG service started      :  ${String(r0503?.fgStart     ?? '-').padStart(8)}        ${String(r0512?.fgStart     ?? '-').padStart(8)}`);
  console.log(`  FG service stopped      :  ${String(r0503?.fgStop      ?? '-').padStart(8)}        ${String(r0512?.fgStop      ?? '-').padStart(8)}`);
  console.log(`  T1 task-fired events    :  ${String(r0503?.t1Count     ?? '-').padStart(8)}        ${String(r0512?.t1Count     ?? '-').padStart(8)}`);
  console.log('');

  // Also pull action_rule_log fires for today on the 3 current rules
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TODAY (2026-05-12) action_rule_log fires for Wael — last 24h');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const since24 = new Date(Date.now() - 24*3600*1000).toISOString();
  const { data: rules } = await sb
    .from('action_rules')
    .select('id, label, trigger_config')
    .eq('user_id', WAEL)
    .eq('trigger_type', 'location');
  const rIds = rules.map(r => r.id);
  const ruleById = {}; for (const r of rules) ruleById[r.id] = r;

  const { data: fires } = await sb
    .from('action_rule_log')
    .select('rule_id, trigger_ref, fired_at')
    .in('rule_id', rIds)
    .gte('fired_at', since24)
    .order('fired_at', { ascending: true });

  console.log(`Fires in last 24h: ${fires?.length || 0}`);
  for (const f of (fires || [])) {
    const r = ruleById[f.rule_id];
    const lbl = r ? (r.label || r.trigger_config?.place_name) : '?';
    console.log(`  ${f.fired_at}  ${lbl}  ref=${f.trigger_ref}`);
  }

  // Also check pending_dwell_fires for today
  const { data: pdf } = await sb
    .from('pending_dwell_fires')
    .select('rule_id, entered_at, fire_at, fired_at, cancelled_at')
    .in('rule_id', rIds)
    .gte('entered_at', since24)
    .order('entered_at', { ascending: true });
  console.log(`\npending_dwell_fires in last 24h: ${pdf?.length || 0}`);
  for (const p of (pdf || [])) {
    const r = ruleById[p.rule_id];
    const lbl = r ? (r.label || r.trigger_config?.place_name) : '?';
    const status = p.fired_at ? `FIRED@${p.fired_at}` : (p.cancelled_at ? `CANCELLED@${p.cancelled_at}` : 'pending');
    console.log(`  ${p.entered_at}  ${lbl}  fire_at=${p.fire_at}  ${status}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
