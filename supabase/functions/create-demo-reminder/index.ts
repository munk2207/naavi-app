/**
 * create-demo-reminder Edge Function
 *
 * F2b — the single write entry point for demo-line reminder rows, per
 * Data Integrity Layer 2 (docs/CLAUDE.md). Called by the voice server
 * after a demo caller confirms their reminder time and timezone.
 *
 * Reuses the existing action_rules / evaluate-rules infrastructure
 * (trigger_type='time') rather than a dedicated demo_reminders table —
 * see docs/F2B_PHASE2_CHANGE_PLAN_2026-07-01.md decision #2. The demo
 * caller's row is owned by DEMO_USER_ID (an env var scoped to whichever
 * Supabase project this function is deployed to — staging and production
 * each set their own value, same pattern as the voice server's
 * DEMO_USER_ID / STAGING_DEMO_USER_ID split).
 *
 * TCPA gate: refuses to create a reminder for a number in demo_optouts.
 * (evaluate-rules::fireAction re-checks demo_optouts again immediately
 * before sending, to close the gap where STOP arrives after creation but
 * before the reminder fires — see plan §2, accepted operational
 * limitation for the remaining race.)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const demoUserId  = Deno.env.get('DEMO_USER_ID') ?? '';
  const admin       = createClient(supabaseUrl, serviceKey);

  try {
    const { phone, name, fire_at, message } = await req.json();

    if (!phone || !fire_at) {
      return json({ error: 'Missing phone or fire_at' }, 400);
    }
    if (!demoUserId) {
      console.error('[create-demo-reminder] DEMO_USER_ID not configured for this project');
      return json({ error: 'not_configured' }, 500);
    }

    const { data: optOut, error: optErr } = await admin
      .from('demo_optouts')
      .select('phone')
      .eq('phone', phone)
      .maybeSingle();

    if (optErr) {
      console.error('[create-demo-reminder] opt-out check failed:', optErr.message);
      return json({ error: 'optout_check_failed' }, 500);
    }
    if (optOut) {
      console.log(`[create-demo-reminder] refused — ${phone} is opted out`);
      return json({ error: 'opted_out' }, 403);
    }

    const label = name ? `Demo reminder for ${name}` : 'Demo reminder';
    const body = String(message ?? '').trim();
    if (!body) {
      return json({ error: 'Missing message body' }, 400);
    }

    const { data, error } = await admin
      .from('action_rules')
      .insert({
        user_id: demoUserId,
        trigger_type: 'time',
        trigger_config: { datetime: fire_at },
        action_type: 'sms',
        action_config: {
          to_phone: phone,
          to_name: name || undefined,
          body,
          channels: ['sms'],
          source: 'demo_line',
        },
        label,
        one_shot: true,
        enabled: true,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[create-demo-reminder] insert failed:', error.message);
      return json({ error: 'insert_failed' }, 500);
    }

    console.log(`[create-demo-reminder] created rule ${data.id} for ${phone} firing at ${fire_at}`);
    return json({ success: true, rule_id: data.id });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[create-demo-reminder] error:', msg);
    return json({ error: msg }, 500);
  }
});
