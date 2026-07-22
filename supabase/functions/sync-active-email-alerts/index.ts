/**
 * sync-active-email-alerts Edge Function
 *
 * Targeted, cost-bounded fast path for email-trigger alerts. Runs on its own
 * 5-minute cron (separate from the general sync-gmail cron, which stays at
 * its existing 30/60-minute cadence for everyone else). Mirrors the same
 * cost-discipline already established for the live-Q&A email read
 * (`fetchLiveRecentEmails` in naavi-chat/index.ts — "cost-tuned: not every
 * turn"): only do the expensive thing (a Gmail sync) for the specific users
 * who actually need it, not for the whole user base.
 *
 * "Need it" = has at least one currently-enabled trigger_type='email'
 * action_rule. Users with no active email alert are entirely unaffected —
 * they stay on the existing 30/60-min sync-gmail cadence, zero cost change.
 *
 * For each qualifying user, calls sync-gmail with target_user_id set (an
 * existing, already-supported parameter — see sync-gmail/index.ts:113-132),
 * so this reuses the proven sync pipeline rather than reimplementing it.
 *
 * B10q follow-up (2026-07-21) — motivated by manual testing showing a
 * user who sets up "alert me when I get an email from Bob" could wait up to
 * 30 minutes to actually be alerted, which is a real UX gap for a feature
 * framed as an "alert."
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Distinct user_ids with at least one enabled email-trigger rule.
    const { data: rows, error } = await admin
      .from('action_rules')
      .select('user_id')
      .eq('trigger_type', 'email')
      .eq('enabled', true);

    if (error) {
      console.error('[sync-active-email-alerts] query failed:', error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userIds = [...new Set((rows ?? []).map((r: { user_id: string }) => r.user_id))];
    console.log(`[sync-active-email-alerts] ${userIds.length} user(s) with an active email alert`);

    if (userIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, synced: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = await Promise.allSettled(
      userIds.map((user_id) =>
        fetch(`${supabaseUrl}/functions/v1/sync-gmail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ target_user_id: user_id }),
        }).then((r) => ({ user_id, ok: r.ok, status: r.status })),
      ),
    );

    const summary = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message ?? String(r.reason) },
    );
    console.log(`[sync-active-email-alerts] dispatch summary:`, JSON.stringify(summary));

    return new Response(JSON.stringify({ ok: true, synced: userIds.length, results: summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sync-active-email-alerts] error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
