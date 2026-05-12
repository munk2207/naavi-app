/**
 * Diagnose the 1038 Terranova test on V57.14.4 build 170.
 *
 * Critical questions:
 *   1. Did `fg-location-tick` rows fire during the test window? → FG service alive vs dead
 *   2. Did `geofence-T1-task-fired` events fire for the 1038 rule? → Android delivery
 *   3. Did the rule actually fire (action_rule_log + pending_dwell_fires + sent_messages)?
 *
 * Time window: 11:30 UTC (just before rule creation at 11:31:16) through now.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WAEL = '788fe85c-b6be-4506-87e8-a8736ec8e1d1';
const RULE_1038 = '8ccc4579-e51b-46dd-85d7-d15817f49b7b';
const SINCE = '2026-05-12T11:30:00Z';

(async () => {
  // 1. Pull all client_diagnostics in the window
  const { data: diag } = await sb
    .from('client_diagnostics')
    .select('created_at, step, payload, build_version')
    .eq('user_id', WAEL)
    .gte('created_at', SINCE)
    .order('created_at', { ascending: true })
    .limit(5000);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`CLIENT_DIAGNOSTICS since ${SINCE} — ${diag?.length || 0} events`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (diag && diag.length > 0) {
    console.log(`First event: ${diag[0].created_at}`);
    console.log(`Last event:  ${diag[diag.length-1].created_at}`);
  }
  console.log('');

  // Step counts
  const byStep = {};
  for (const r of (diag || [])) byStep[r.step] = (byStep[r.step] || 0) + 1;
  console.log('--- ALL step counts in window ---');
  for (const [k, v] of Object.entries(byStep).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }
  console.log('');

  // CRITICAL — heartbeat presence
  const ticks    = (diag || []).filter(r => r.step === 'fg-location-tick');
  const tickErr  = (diag || []).filter(r => r.step === 'fg-location-tick-error');
  const tickEmpty= (diag || []).filter(r => r.step === 'fg-location-tick-empty');
  console.log(`╔═════════════════════════════════════════════════════════════╗`);
  console.log(`║  HEARTBEAT — V57.14.4 NEW DIAGNOSTIC                        ║`);
  console.log(`║  fg-location-tick:        ${String(ticks.length).padStart(4)}                              ║`);
  console.log(`║  fg-location-tick-error:  ${String(tickErr.length).padStart(4)}                              ║`);
  console.log(`║  fg-location-tick-empty:  ${String(tickEmpty.length).padStart(4)}                              ║`);
  console.log(`╚═════════════════════════════════════════════════════════════╝`);
  console.log('');

  if (ticks.length > 0) {
    console.log('--- fg-location-tick events (chronological) ---');
    for (const r of ticks) {
      const t = r.created_at.split('T')[1].split('.')[0];
      console.log(`  ${t}  build=${r.build_version}  ${JSON.stringify(r.payload)}`);
    }
    console.log('');
  }

  // T1 events (geofence task fires)
  const t1All = (diag || []).filter(r => r.step === 'geofence-T1-task-fired');
  const t1ForRule = t1All.filter(r => r.payload?.rule_id === RULE_1038);
  const t1Suppress = (diag || []).filter(r => r.step === 'geofence-T1-suppressed-phantom');
  console.log(`--- T1 events: ${t1All.length} total, ${t1ForRule.length} for 1038 rule ---`);
  for (const r of t1All) {
    const t = r.created_at.split('T')[1].split('.')[0];
    const isOurRule = r.payload?.rule_id === RULE_1038 ? '  ← 1038!' : '';
    console.log(`  ${t}  ${JSON.stringify(r.payload)}${isOurRule}`);
  }
  console.log(`(plus ${t1Suppress.length} suppressed as phantom)`);
  console.log('');

  // syncGeofences events
  const syncEnds = (diag || []).filter(r => r.step === 'syncGeofences-end');
  console.log(`--- syncGeofences-end (${syncEnds.length}) ---`);
  for (const r of syncEnds) {
    const t = r.created_at.split('T')[1].split('.')[0];
    console.log(`  ${t}  build=${r.build_version}  ${JSON.stringify(r.payload)}`);
  }
  console.log('');

  // FG service start/stop
  const fgEvents = (diag || []).filter(r => r.step?.startsWith('fg-location-service'));
  console.log(`--- fg-location-service events (${fgEvents.length}) ---`);
  for (const r of fgEvents) {
    const t = r.created_at.split('T')[1].split('.')[0];
    console.log(`  ${t}  ${r.step}`);
  }
  console.log('');

  // AppState
  const appStates = (diag || []).filter(r => r.step === 'lifecycle-appstate');
  console.log(`--- lifecycle-appstate (${appStates.length}) ---`);
  for (const r of appStates) {
    const t = r.created_at.split('T')[1].split('.')[0];
    console.log(`  ${t}  build=${r.build_version}  ${r.payload?.state}`);
  }
  console.log('');

  // 2. Rule fire status
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RULE FIRE STATUS (1038 Terranova)');
  console.log('═══════════════════════════════════════════════════════════════');

  const { data: rule } = await sb
    .from('action_rules')
    .select('id, label, enabled, one_shot, last_fired_at, trigger_config')
    .eq('id', RULE_1038)
    .maybeSingle();
  console.log('rule.enabled      :', rule?.enabled);
  console.log('rule.one_shot     :', rule?.one_shot);
  console.log('rule.last_fired_at:', rule?.last_fired_at || 'NEVER');
  console.log('rule.radius_meters:', rule?.trigger_config?.radius_meters);
  console.log('');

  const { data: fires } = await sb
    .from('action_rule_log')
    .select('*')
    .eq('rule_id', RULE_1038);
  console.log(`action_rule_log entries: ${fires?.length || 0}`);
  for (const f of (fires || [])) console.log(`  ${f.fired_at}  ref=${f.trigger_ref}`);
  console.log('');

  const { data: pdf } = await sb
    .from('pending_dwell_fires')
    .select('*')
    .eq('rule_id', RULE_1038);
  console.log(`pending_dwell_fires entries: ${pdf?.length || 0}`);
  for (const p of (pdf || [])) {
    console.log(`  entered=${p.entered_at} fire_at=${p.fire_at} fired=${p.fired_at || '-'} cancelled=${p.cancelled_at || '-'}`);
  }
  console.log('');

  // 3. Sent messages window
  const { data: msgs } = await sb
    .from('sent_messages')
    .select('created_at, channel, to_phone, source, delivery_status')
    .eq('user_id', WAEL)
    .gte('created_at', SINCE)
    .order('created_at', { ascending: true });
  console.log(`sent_messages in window: ${msgs?.length || 0}`);
  for (const m of (msgs || [])) {
    console.log(`  ${m.created_at}  ${m.channel}  to=${m.to_phone}  source=${m.source}  status=${m.delivery_status}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
