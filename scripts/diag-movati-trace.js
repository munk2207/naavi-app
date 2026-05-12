/**
 * Trace the Movati rule end-to-end for 2026-05-12.
 *
 * Question: Wael visited Movati for 45 min today and got nothing. Where did the chain break?
 *
 * Pulls:
 *   1. Movati rule's exact created_at + trigger_config.
 *   2. ALL client_diagnostics for Wael since 00:00 UTC today (no upper bound).
 *   3. Every T1 event whose rule_id matches Movati.
 *   4. Every syncGeofences-end with its registered count (did Movati get registered after creation?).
 *   5. Any pending_dwell_fires or action_rule_log entries for Movati.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WAEL = '788fe85c-b6be-4506-87e8-a8736ec8e1d1';
const MOVATI_RULE_ID = '033db48f-e6a3-44a6-a83d-2f0b09e35e7e'; // partial match; fixed below from query

(async () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. Find the Movati rule precisely
  // ─────────────────────────────────────────────────────────────────────────
  const { data: rules } = await sb
    .from('action_rules')
    .select('id, label, enabled, trigger_config, created_at, last_fired_at')
    .eq('user_id', WAEL)
    .eq('trigger_type', 'location')
    .ilike('label', '%movati%');

  if (!rules || rules.length === 0) {
    console.log('No Movati rule found via ILIKE on label. Trying place_name...');
    const { data: rules2 } = await sb
      .from('action_rules')
      .select('id, label, enabled, trigger_config, created_at, last_fired_at')
      .eq('user_id', WAEL)
      .eq('trigger_type', 'location');
    for (const r of rules2 || []) console.log(`  ${r.id}  ${r.label}  ${r.trigger_config?.place_name}`);
    process.exit(1);
  }

  const movati = rules[0];
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('MOVATI RULE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  id           : ${movati.id}`);
  console.log(`  label        : ${movati.label}`);
  console.log(`  enabled      : ${movati.enabled}`);
  console.log(`  created_at   : ${movati.created_at}`);
  console.log(`  last_fired_at: ${movati.last_fired_at || 'NEVER'}`);
  console.log(`  trigger_cfg  : ${JSON.stringify(movati.trigger_config, null, 2).split('\n').join('\n                  ')}`);
  console.log('');

  const movatiId = movati.id;

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Pull ALL client_diagnostics for Wael since 00:00 UTC today
  // ─────────────────────────────────────────────────────────────────────────
  const { data: diag, error: diagErr } = await sb
    .from('client_diagnostics')
    .select('created_at, step, payload, build_version')
    .eq('user_id', WAEL)
    .gte('created_at', '2026-05-12T00:00:00Z')
    .order('created_at', { ascending: true })
    .limit(5000);

  if (diagErr) { console.log('ERROR diagnostics:', diagErr.message); return; }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`ALL CLIENT_DIAGNOSTICS TODAY — ${diag.length} events`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Last events to verify we have current data
  if (diag.length > 0) {
    console.log(`First event : ${diag[0].created_at}`);
    console.log(`Last event  : ${diag[diag.length-1].created_at}`);
    console.log('');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Movati-specific events
  // ─────────────────────────────────────────────────────────────────────────
  const movatiEvents = diag.filter(r => {
    const p = r.payload;
    return p && (p.rule_id === movatiId || (typeof p === 'object' && JSON.stringify(p).includes(movatiId)));
  });
  console.log(`--- events referencing Movati rule (${movatiEvents.length}) ---`);
  for (const r of movatiEvents) {
    console.log(`  ${r.created_at}  build=${r.build_version}  ${r.step}  ${JSON.stringify(r.payload).slice(0,200)}`);
  }
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // 4. All T1 events today (any rule)
  // ─────────────────────────────────────────────────────────────────────────
  const t1All = diag.filter(r => r.step === 'geofence-T1-task-fired');
  console.log(`--- ALL T1 events today (${t1All.length}) ---`);
  for (const r of t1All) {
    const t = r.created_at.split('T')[1].split('.')[0];
    console.log(`  ${t}  ${JSON.stringify(r.payload)}`);
  }
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // 5. All syncGeofences-end events today (chronological)
  // ─────────────────────────────────────────────────────────────────────────
  const syncEnds = diag.filter(r => r.step === 'syncGeofences-end');
  console.log(`--- ALL syncGeofences-end today (${syncEnds.length}) ---`);
  for (const r of syncEnds) {
    const t = r.created_at.split('T')[1].split('.')[0];
    console.log(`  ${t}  build=${r.build_version}  ${JSON.stringify(r.payload)}`);
  }
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // 6. AppState transitions today
  // ─────────────────────────────────────────────────────────────────────────
  const appStates = diag.filter(r => r.step === 'lifecycle-appstate');
  console.log(`--- AppState transitions today (${appStates.length}) ---`);
  for (const r of appStates) {
    const t = r.created_at.split('T')[1].split('.')[0];
    console.log(`  ${t}  build=${r.build_version}  ${r.payload?.state}`);
  }
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // 7. fg-location-service events
  // ─────────────────────────────────────────────────────────────────────────
  const fgEvents = diag.filter(r => r.step?.includes('fg-location'));
  console.log(`--- FG service events today (${fgEvents.length}) ---`);
  for (const r of fgEvents) {
    const t = r.created_at.split('T')[1].split('.')[0];
    console.log(`  ${t}  build=${r.build_version}  ${r.step}  ${JSON.stringify(r.payload || {})}`);
  }
  console.log('');

  // ─────────────────────────────────────────────────────────────────────────
  // 8. action_rule_log + pending_dwell_fires for Movati
  // ─────────────────────────────────────────────────────────────────────────
  const { data: fires } = await sb
    .from('action_rule_log')
    .select('*')
    .eq('rule_id', movatiId)
    .order('fired_at', { ascending: false });
  console.log(`--- action_rule_log entries for Movati (${fires?.length || 0}) ---`);
  for (const f of (fires || [])) {
    console.log(`  ${f.fired_at}  trigger_ref=${f.trigger_ref}`);
  }
  console.log('');

  const { data: pdf } = await sb
    .from('pending_dwell_fires')
    .select('*')
    .eq('rule_id', movatiId)
    .order('entered_at', { ascending: false });
  console.log(`--- pending_dwell_fires for Movati (${pdf?.length || 0}) ---`);
  for (const p of (pdf || [])) {
    console.log(`  entered=${p.entered_at}  fire_at=${p.fire_at}  fired_at=${p.fired_at || '-'}  cancelled_at=${p.cancelled_at || '-'}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
