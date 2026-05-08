/**
 * Diagnose Wael's 10 AM drive: Gabe's nofrills, Mark's, Home.
 * Pulls: location rules + their last_fired_at, today's action_rule_log fires.
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
  console.log('=== 1. Wael\'s LOCATION rules ===');
  const { data: rules, error: rErr } = await sb
    .from('action_rules')
    .select('*')
    .eq('user_id', WAEL)
    .eq('trigger_type', 'location')
    .order('created_at', { ascending: false });
  if (rErr) { console.log('ERROR:', rErr.message); return; }
  console.log(`Total location rules: ${rules.length}`);
  const ruleIds = rules.map(r => r.id);
  const ruleById = new Map(rules.map(r => [r.id, r]));
  for (const r of rules) {
    const tc = r.trigger_config || {};
    const ac = r.action_config || {};
    const lf = r.last_fired_at ? r.last_fired_at : '(never)';
    console.log(`  - [${r.id.slice(0,8)}] "${r.label || '(no label)'}" enabled=${r.enabled} one_shot=${r.one_shot}`);
    console.log(`      place="${tc.place || tc.name || tc.alias || '?'}" direction=${tc.direction || '?'}`);
    console.log(`      addr="${tc.address || '?'}"  radius=${tc.radius_m || '?'}m`);
    console.log(`      lat=${tc.lat ?? tc.latitude ?? '?'} lng=${tc.lng ?? tc.longitude ?? '?'}`);
    console.log(`      action=${r.action_type} -> to="${ac.to_phone || ac.to_email || '?'}"  body="${(ac.body || ac.message || '').slice(0,60)}"`);
    console.log(`      last_fired_at=${lf}`);
    console.log(`      trigger_config=${JSON.stringify(tc)}`);
  }

  console.log('\n=== 2. action_rule_log fires today (UTC) for Wael\'s location rules ===');
  const startUtc = new Date(); startUtc.setUTCHours(0,0,0,0);
  const startEdt = new Date(Date.now() - 5*3600*1000); // last 5h covers today's drive
  const { data: fires, error: fErr } = await sb
    .from('action_rule_log')
    .select('*')
    .in('rule_id', ruleIds)
    .gte('fired_at', startEdt.toISOString())
    .order('fired_at', { ascending: false });
  if (fErr) { console.log('ERROR:', fErr.message); return; }
  console.log(`Fires last 5h on Wael's location rules: ${fires.length}`);
  for (const f of fires) {
    const r = ruleById.get(f.rule_id);
    const tc = r?.trigger_config || {};
    console.log(`  ${f.fired_at}  rule=${f.rule_id?.slice(0,8)}  place="${tc.place || tc.alias || '?'}" dir=${tc.direction || '?'}  trigger_ref="${f.trigger_ref || '-'}"`);
  }

  // Also get fires today UTC across ALL Wael's rules (not just location) to see anything that fired
  console.log('\n=== 3. ALL action_rule_log fires today UTC (any rule) for Wael ===');
  const allWaelRuleIds = (await sb.from('action_rules').select('id').eq('user_id', WAEL)).data?.map(x=>x.id) || [];
  const { data: allFires } = await sb
    .from('action_rule_log')
    .select('*')
    .in('rule_id', allWaelRuleIds)
    .gte('fired_at', startUtc.toISOString())
    .order('fired_at', { ascending: false });
  console.log(`All fires today UTC: ${allFires?.length || 0}`);
  for (const f of (allFires || [])) {
    const r = ruleById.get(f.rule_id);
    const tc = r?.trigger_config || {};
    const place = tc.place || tc.alias || r?.label || '(non-location)';
    console.log(`  ${f.fired_at}  rule=${f.rule_id?.slice(0,8)}  ${place}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
