/** Pull all geofence events from 17:55 UTC onwards (covers 1:55 PM EDT drive). */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
for (const line of fs.readFileSync('tests/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WAEL = '788fe85c-b6be-4506-87e8-a8736ec8e1d1';

(async () => {
  // 2026-05-03 22:00 UTC = 6:00 PM EDT — covers the 8 PM EDT drive yesterday.
  const since = '2026-05-03T22:00:00Z';
  const { data } = await sb
    .from('client_diagnostics')
    .select('created_at, step, payload, build_version')
    .eq('user_id', WAEL)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(500);

  console.log(`Events from ${since}: ${data.length}`);
  console.log('');

  // Show all geofence-related events chronologically
  const interesting = data.filter(r =>
    r.step.includes('geofence') ||
    r.step.includes('lifecycle') ||
    r.step.includes('syncGeofences')
  );
  console.log(`Geofence/lifecycle (chronological, ${interesting.length}):`);
  for (const r of interesting) {
    const t = r.created_at.split('T')[1].split('.')[0];
    const p = JSON.stringify(r.payload || {}).slice(0, 200);
    console.log(`  ${t}  build=${r.build_version}  ${r.step}  ${p}`);
  }

  // Look for action_rule_log fires in this window
  console.log('\n=== action_rule_log fires for Wael since 17:55 UTC ===');
  const { data: ruleIds } = await sb.from('action_rules').select('id').eq('user_id', WAEL);
  const allIds = ruleIds.map(r => r.id);
  const { data: fires } = await sb
    .from('action_rule_log')
    .select('*')
    .in('rule_id', allIds)
    .gte('fired_at', since)
    .order('fired_at', { ascending: true });
  console.log(`Fires: ${fires?.length || 0}`);
  for (const f of (fires || [])) {
    console.log(`  ${f.fired_at}  rule=${f.rule_id?.slice(0,8)}  trigger_ref=${f.trigger_ref || '-'}`);
  }

  // Look for sent_messages in this window (showing if alerts were sent)
  console.log('\n=== sent_messages for Wael since 17:55 UTC ===');
  const { data: msgs } = await sb
    .from('sent_messages')
    .select('*')
    .eq('user_id', WAEL)
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  console.log(`Sent messages: ${msgs?.length || 0}`);
  for (const m of (msgs || [])) {
    console.log(`  ${m.created_at}  channel=${m.channel}  to=${m.recipient || '-'}  status=${m.delivery_status || '-'}  source=${m.source || '-'}`);
  }
})();
