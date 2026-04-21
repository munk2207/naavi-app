/**
 * report-location-event Edge Function
 *
 * Receives geofence crossing events from the mobile app's background task
 * and fires the matching location rule's action using the standard fan-out
 * (SMS + WhatsApp + Email + Push for self-alerts; SMS + WhatsApp for
 * third-party phone; email for third-party email).
 *
 * Request body:
 *   {
 *     user_id:    "uuid",               // required, phone-identified user
 *     rule_id:    "uuid",               // required, action_rules.id
 *     lat:        number,               // crossing lat
 *     lng:        number,               // crossing lng
 *     event:      "enter" | "exit" | "dwell",
 *     timestamp:  "ISO 8601"
 *   }
 *
 * Auth: service role (phone carries NAAVI_ANON_KEY; rule ownership is
 * verified by matching rule.user_id against body user_id).
 *
 * Dedup: uses action_rule_log with trigger_ref = `loc-{rule_id}-{YYYY-MM-DD}-{event}`
 *        (one fire per rule per day per event type).
 *
 * Architecture note: does not re-use evaluate-rules/fireAction because that
 * function is cron-bound. Duplicating the fan-out here keeps report-location-
 * event self-contained. Keep both in sync when changing the fan-out policy.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildAlertBody } from '../_shared/alert_body.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LocationEvent {
  user_id:   string;
  rule_id:   string;
  lat:       number;
  lng:       number;
  event:     'enter' | 'exit' | 'dwell';
  timestamp: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const interFnKey  = Deno.env.get('NAAVI_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const body = (await req.json()) as LocationEvent;
    const { user_id, rule_id, event } = body;

    if (!user_id || !rule_id || !event) {
      return json({ error: 'Missing user_id, rule_id, or event' }, 400);
    }

    // 1. Fetch the rule — verify ownership + confirm it's a location rule
    const { data: rule, error: ruleErr } = await admin
      .from('action_rules')
      .select('id, user_id, trigger_type, trigger_config, action_type, action_config, label, one_shot, enabled')
      .eq('id', rule_id)
      .maybeSingle();

    if (ruleErr || !rule) return json({ error: 'Rule not found' }, 404);
    if (rule.user_id !== user_id) return json({ error: 'Rule does not belong to user' }, 403);
    if (rule.trigger_type !== 'location') return json({ error: 'Not a location rule' }, 400);
    if (!rule.enabled) return json({ ok: true, skipped: 'rule disabled' });

    // 2. Check direction — only fire if the event matches the rule's direction
    const direction = String(rule.trigger_config?.direction ?? 'arrive');
    const acceptable = direction === 'leave' ? ['exit'] : ['dwell', 'enter'];
    if (!acceptable.includes(event)) {
      return json({ ok: true, skipped: `event ${event} does not match direction ${direction}` });
    }

    // 3. Dedup via action_rule_log
    const today = new Date().toISOString().slice(0, 10);
    const triggerRef = `loc-${rule_id}-${today}-${event}`;

    const { data: existing } = await admin
      .from('action_rule_log')
      .select('id')
      .eq('rule_id', rule_id)
      .eq('trigger_ref', triggerRef)
      .maybeSingle();

    if (existing) {
      return json({ ok: true, skipped: 'already fired today' });
    }

    // 4. Fire the action (replicates evaluate-rules/fireAction fan-out)
    const success = await fireLocationAction(rule, admin, supabaseUrl, interFnKey);

    if (success) {
      // 5. Log the fire to prevent re-firing
      await admin.from('action_rule_log').insert({ rule_id, trigger_ref: triggerRef });
      await admin.from('action_rules').update({ last_fired_at: new Date().toISOString() }).eq('id', rule_id);

      // 6. One-shot disables itself
      if (rule.one_shot) {
        await admin.from('action_rules').update({ enabled: false }).eq('id', rule_id);
      }

      console.log(`[report-location-event] Fired rule ${rule_id} for user ${user_id} (${event})`);
      return json({ ok: true, fired: true });
    }

    console.error(`[report-location-event] Fan-out returned no success for rule ${rule_id}`);
    return json({ ok: false, fired: false }, 500);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[report-location-event] Error:', msg);
    return json({ error: msg }, 500);
  }
});

// ── Fan-out (parallel to evaluate-rules/fireAction) ─────────────────────────

async function fireLocationAction(
  rule: any,
  admin: any,
  supabaseUrl: string,
  interFnKey: string,
): Promise<boolean> {
  const config  = rule.action_config;
  const toPhone = String(config.to_phone ?? '');
  const toEmail = String(config.to_email ?? '');
  const subject = String(config.subject ?? rule.label ?? 'Location alert from MyNaavi');
  const toName  = String(config.to_name ?? '');

  // Build the final body from base + inline tasks + linked list items.
  // Shared merge logic in _shared/alert_body.ts.
  const body = await buildAlertBody(config, rule.user_id, supabaseUrl, interFnKey);

  if (!body) {
    console.error(`[report-location-event] Rule ${rule.id}: empty body after buildAlertBody`);
    return false;
  }

  // User's own contact info for self-alert detection
  const { data: settings } = await admin
    .from('user_settings').select('phone, name').eq('user_id', rule.user_id).maybeSingle();
  const userPhone = settings?.phone ?? null;
  const userName  = settings?.name  ?? null;

  const { data: authData } = await admin.auth.admin.getUserById(rule.user_id);
  const userEmail = authData?.user?.email ?? null;

  const isSelfByPhone = toPhone && userPhone && toPhone === userPhone;
  const isSelfByEmail = toEmail && userEmail && toEmail.toLowerCase() === userEmail.toLowerCase();
  const isSelfAlert   = Boolean(isSelfByPhone || isSelfByEmail);

  const callSMS = (channel: 'sms' | 'whatsapp', to: string) =>
    fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
      body: JSON.stringify({
        to, body, channel,
        user_id: rule.user_id,
        recipient_name: toName || userName || undefined,
        sender_name: 'Naavi',
        source: 'location_alert',
      }),
    }).then(res => ({ channel, ok: res.ok })).catch(() => ({ channel, ok: false }));

  const callEmail = (to: string) =>
    fetch(`${supabaseUrl}/functions/v1/send-user-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
      body: JSON.stringify({ user_id: rule.user_id, subject, body, to }),
    }).then(res => ({ channel: 'email', ok: res.ok })).catch(() => ({ channel: 'email', ok: false }));

  const callPush = () =>
    fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
      body: JSON.stringify({
        user_id: rule.user_id,
        title: rule.label ?? 'Naavi Location Alert',
        body,
      }),
    }).then(res => ({ channel: 'push', ok: res.ok })).catch(() => ({ channel: 'push', ok: false }));

  const sends: Promise<{ channel: string; ok: boolean }>[] = [];
  if (isSelfAlert) {
    if (userPhone) { sends.push(callSMS('sms', userPhone)); sends.push(callSMS('whatsapp', userPhone)); }
    if (userEmail) { sends.push(callEmail(userEmail)); }
    sends.push(callPush());
  } else if (toPhone) {
    sends.push(callSMS('sms', toPhone));
    sends.push(callSMS('whatsapp', toPhone));
  } else if (toEmail) {
    sends.push(callEmail(toEmail));
  } else {
    console.error(`[report-location-event] Rule ${rule.id}: no destination`);
    return false;
  }

  const results = await Promise.allSettled(sends);
  const parts: string[] = [];
  let successCount = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      parts.push(`${r.value.channel}=${r.value.ok ? 'ok' : 'fail'}`);
      if (r.value.ok) successCount++;
    } else {
      parts.push('unknown=error');
    }
  }
  const mode = isSelfAlert ? 'self' : (toPhone ? 'third-party-phone' : 'third-party-email');
  console.log(`[report-location-event] Rule ${rule.id} fan-out (${mode}): ${parts.join(' ')} — ${successCount}/${sends.length} ok`);

  return successCount > 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
