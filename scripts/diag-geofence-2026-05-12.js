/**
 * Geofence reliability diagnostic — 2026-05-12 fresh pull.
 *
 * Three views in one run:
 *   1. client_diagnostics for the 2026-05-11 afternoon test window (21:00-23:00 UTC = 5:00-7:00 PM EDT)
 *      — confirm whether the silence is total (no T1, no syncGeofences, no fg-location-service) or partial.
 *   2. action_rule_log for Wael's location rules over the last 21 days
 *      — quantify the Movati-vs-others asymmetry the 2026-05-03 handoff flagged but never explained.
 *   3. Current location rules with full trigger_config (radius, dwell_seconds, resolved coords, last_fired_at).
 *      — check 962 vs 1026 Terranova distance + radius overlap.
 *
 * Read-only. No writes.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WAEL = '788fe85c-b6be-4506-87e8-a8736ec8e1d1';

// Haversine distance in metres
function metres(latA, lngA, latB, lngB) {
  const R = 6371000;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng/2)**2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

(async () => {
  // ─────────────────────────────────────────────────────────────────────────
  // VIEW 3 first — get rule configs, we'll use them to label fires below
  // ─────────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('VIEW 3 — Wael\'s current location rules');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const { data: rules, error: rulesErr } = await sb
    .from('action_rules')
    .select('id, label, enabled, one_shot, trigger_config, last_fired_at, created_at')
    .eq('user_id', WAEL)
    .eq('trigger_type', 'location')
    .order('created_at', { ascending: true });

  if (rulesErr) { console.log('ERROR loading rules:', rulesErr.message); return; }
  console.log(`Total location rules: ${rules.length}  (enabled: ${rules.filter(r=>r.enabled).length})\n`);

  const ruleById = {};
  for (const r of rules) {
    ruleById[r.id] = r;
    const cfg = r.trigger_config || {};
    const lat = cfg.resolved_lat ?? null;
    const lng = cfg.resolved_lng ?? null;
    const radius = cfg.radius_meters ?? '?';
    const dwell = cfg.dwell_seconds ?? 'default(120)';
    const dir = cfg.direction ?? 'arrive';
    const place = cfg.place_name ?? '?';
    const lastFired = r.last_fired_at ? r.last_fired_at.replace('T',' ').slice(0,16) : 'NEVER';
    console.log(`  [${r.enabled ? 'ON ' : 'off'}] ${r.id.slice(0,8)}  "${r.label || place}"`);
    console.log(`         place="${place}"  dir=${dir}  radius=${radius}m  dwell=${dwell}s`);
    console.log(`         coords=${lat ?? '?'},${lng ?? '?'}  last_fired=${lastFired}`);
    console.log(`         created=${r.created_at.slice(0,10)}  one_shot=${r.one_shot ? 'yes' : 'no'}`);
    console.log('');
  }

  // 962 (home) vs 1026 (test) distance — IF the home rule is one of these
  const enabledWithCoords = rules.filter(r => {
    const c = r.trigger_config || {};
    return r.enabled && typeof c.resolved_lat === 'number' && typeof c.resolved_lng === 'number';
  });
  if (enabledWithCoords.length >= 2) {
    console.log('--- pairwise distances between enabled rules with coords ---');
    for (let i = 0; i < enabledWithCoords.length; i++) {
      for (let j = i+1; j < enabledWithCoords.length; j++) {
        const a = enabledWithCoords[i], b = enabledWithCoords[j];
        const ca = a.trigger_config, cb = b.trigger_config;
        const d = metres(ca.resolved_lat, ca.resolved_lng, cb.resolved_lat, cb.resolved_lng);
        const sumR = (ca.radius_meters || 100) + (cb.radius_meters || 100);
        const overlap = d < sumR;
        if (d < 2000) { // only show pairs within 2 km — noise filter
          console.log(`  ${a.label||'?'} ↔ ${b.label||'?'}  =  ${d}m  (sum_radii=${sumR}m, overlap=${overlap ? 'YES' : 'no'})`);
        }
      }
    }
    console.log('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW 1 — client_diagnostics for 2026-05-11 afternoon test window
  // ─────────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('VIEW 1 — client_diagnostics for 2026-05-11 afternoon (21:00-23:00 UTC = 5-7 PM EDT)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const { data: diag, error: diagErr } = await sb
    .from('client_diagnostics')
    .select('created_at, step, payload, build_version, session_id')
    .eq('user_id', WAEL)
    .gte('created_at', '2026-05-11T21:00:00Z')
    .lte('created_at', '2026-05-11T23:00:00Z')
    .order('created_at', { ascending: true })
    .limit(2000);

  if (diagErr) { console.log('ERROR loading diagnostics:', diagErr.message); }
  else {
    console.log(`Total events in window: ${diag.length}\n`);

    // Counts per step
    const byStep = {};
    for (const r of diag) byStep[r.step] = (byStep[r.step] || 0) + 1;
    console.log('--- step counts ---');
    for (const [k, v] of Object.entries(byStep).sort((a,b)=>b[1]-a[1])) {
      console.log(`  ${String(v).padStart(4)}  ${k}`);
    }
    console.log('');

    // Filtered chronological — geofence + fg-location + lifecycle + syncGeofences
    const interesting = diag.filter(r => r.step && (
      r.step.includes('geofence') ||
      r.step.includes('fg-location') ||
      r.step.includes('syncGeofences') ||
      r.step.includes('lifecycle')
    ));
    console.log(`--- chronological geofence/fg-location/sync events (${interesting.length}) ---`);
    for (const r of interesting) {
      const t = r.created_at.split('T')[1].split('.')[0];
      const p = JSON.stringify(r.payload || {}).slice(0, 200);
      console.log(`  ${t}  build=${r.build_version || '?'}  ${r.step}  ${p}`);
    }
    console.log('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW 2 — action_rule_log for Wael's location rules, last 21 days
  // ─────────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('VIEW 2 — action_rule_log for Wael\'s location rules, last 21 days');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const since21 = new Date(Date.now() - 21*24*3600*1000).toISOString();
  const locationRuleIds = rules.map(r => r.id);

  const { data: fires, error: firesErr } = await sb
    .from('action_rule_log')
    .select('rule_id, trigger_ref, fired_at')
    .in('rule_id', locationRuleIds)
    .gte('fired_at', since21)
    .order('fired_at', { ascending: true });

  if (firesErr) { console.log('ERROR loading action_rule_log:', firesErr.message); }
  else {
    console.log(`Total fires in last 21 days: ${fires.length}\n`);

    // Per-rule fire counts
    const byRule = {};
    for (const f of fires) byRule[f.rule_id] = (byRule[f.rule_id] || 0) + 1;
    console.log('--- per-rule fire counts ---');
    const sorted = Object.entries(byRule).sort((a,b)=>b[1]-a[1]);
    for (const [ruleId, count] of sorted) {
      const r = ruleById[ruleId];
      const label = r ? (r.label || r.trigger_config?.place_name || '?') : '(unknown)';
      const enabled = r ? (r.enabled ? 'ON' : 'off') : '?';
      const radius = r ? (r.trigger_config?.radius_meters ?? '?') : '?';
      console.log(`  ${String(count).padStart(3)}  [${enabled}]  ${label.padEnd(30)}  radius=${radius}m`);
    }
    // Rules that NEVER fired
    const neverFired = rules.filter(r => r.enabled && !byRule[r.id]);
    console.log(`\n--- enabled rules that NEVER fired in last 21 days (${neverFired.length}) ---`);
    for (const r of neverFired) {
      const cfg = r.trigger_config || {};
      console.log(`  ${(r.label || cfg.place_name || '?').padEnd(30)}  radius=${cfg.radius_meters ?? '?'}m  created=${r.created_at.slice(0,10)}`);
    }
    console.log('');

    // Recent fires chronologically (last 30)
    console.log(`--- last 30 fires chronological ---`);
    for (const f of fires.slice(-30)) {
      const r = ruleById[f.rule_id];
      const label = r ? (r.label || r.trigger_config?.place_name || '?') : '?';
      console.log(`  ${f.fired_at.replace('T',' ').slice(0,16)}  ${label.padEnd(25)}  ref=${f.trigger_ref}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('end of diagnostic');
  console.log('═══════════════════════════════════════════════════════════════');
})().catch(e => { console.error(e); process.exit(1); });
