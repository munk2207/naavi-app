/**
 * geofence-health-check Edge Function — daily cron (B4o, Wael 2026-05-23).
 *
 * Server-side safety net for users who don't open the app frequently enough
 * for the in-app reprompt (B4l) or banner (B4n) to trigger. Without this,
 * a user whose Android revokes location permission overnight (Samsung
 * Sleeping Apps, OS update, etc.) silently loses ALL geofence alerts until
 * they next open the app — which may not happen before they drive past a
 * real geofence target.
 *
 * Run flow (daily 8 AM EST via pg_cron):
 *   1. List every user with >= 1 ENABLED action_rule where trigger_type='location'.
 *   2. For each user, check client_diagnostics for any row in last 24h
 *      where step='syncGeofences-end' AND payload.registered > 0.
 *   3. If none → user's phone has either: never registered geofences this
 *      session, lost permission, app uninstalled, or app crashed. We can't
 *      distinguish from server, but ANY of those is a silent-failure state
 *      worth notifying about.
 *   4. Send push notification + SMS (per F2g user alert_channels_enabled
 *      preferences). Body: "Naavi can't see your location — open the app
 *      to fix."
 *
 * Multi-user safe: iterates per user_id; never picks "first user" or
 * .limit(1) on shared tables (CLAUDE.md Rule 10).
 *
 * Auth: cron passes anon JWT; we use service-role internally for the DB
 * queries + the downstream send-push/send-sms calls.
 *
 * Idempotency: we don't track "already notified today" — running this
 * multiple times in 24h would re-notify. The cron schedule (daily) makes
 * that not a real risk; if it becomes one, add a `last_geofence_health_notification_at`
 * column on user_settings and skip if < 22h ago.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

const NOTIFY_BODY = "Naavi can't see your location — open the MyNaavi app to fix it. Your location alerts won't fire until you do.";
const NOTIFY_TITLE = 'MyNaavi — Location alerts paused';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const t0 = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    // ── Step 1: find every user with >= 1 enabled location rule ────────────
    // Distinct user_id list — one row per user.
    const { data: locationUsers, error: usersErr } = await admin
      .from('action_rules')
      .select('user_id')
      .eq('trigger_type', 'location')
      .eq('enabled', true);
    if (usersErr) {
      console.error('[geofence-health-check] action_rules query failed:', usersErr.message);
      return json({ error: usersErr.message }, 500);
    }
    const uniqueUserIds = Array.from(
      new Set((locationUsers ?? []).map((r: any) => String(r.user_id)).filter(Boolean))
    );
    console.log(`[geofence-health-check] ${uniqueUserIds.length} users with active location rules`);

    if (uniqueUserIds.length === 0) {
      return json({ ok: true, checked: 0, dark: 0, notified: 0, ms: Date.now() - t0 });
    }

    // ── Step 2: for each user, check recent client_diagnostics ─────────────
    const sinceISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const darkUsers: string[] = [];
    for (const userId of uniqueUserIds) {
      const { data: diagRows, error: diagErr } = await admin
        .from('client_diagnostics')
        .select('payload')
        .eq('user_id', userId)
        .eq('step', 'syncGeofences-end')
        .gte('created_at', sinceISO)
        .limit(10);
      if (diagErr) {
        console.warn(`[geofence-health-check] diag query failed for ${userId.slice(0, 8)}: ${diagErr.message}`);
        continue;
      }
      const hasHealthySync = (diagRows ?? []).some((r: any) => {
        const reg = Number(r?.payload?.registered ?? 0);
        return reg > 0;
      });
      if (!hasHealthySync) {
        darkUsers.push(userId);
      }
    }
    console.log(`[geofence-health-check] ${darkUsers.length} dark users (no registered>0 in last 24h)`);

    if (darkUsers.length === 0) {
      return json({ ok: true, checked: uniqueUserIds.length, dark: 0, notified: 0, ms: Date.now() - t0 });
    }

    // ── Step 3: for each dark user, fetch settings + send notifications ────
    // Honors F2g per-user alert_channels_enabled preferences. Defaults to
    // push + sms when the column is null (legacy users not yet on F2g).
    const notified: string[] = [];
    const failed:   { userId: string; reason: string }[] = [];

    for (const userId of darkUsers) {
      const { data: settings } = await admin
        .from('user_settings')
        .select('phone, alert_channels_enabled')
        .eq('user_id', userId)
        .maybeSingle();

      const phone = String(settings?.phone || '').trim();
      const channels: string[] = Array.isArray(settings?.alert_channels_enabled)
        ? settings!.alert_channels_enabled
        : ['push', 'sms']; // legacy default — push + sms for users who haven't customized

      let userNotified = false;

      // (a) Push — call send-push-notification with user_id
      if (channels.includes('push')) {
        try {
          const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              user_id: userId,
              title: NOTIFY_TITLE,
              body: NOTIFY_BODY,
            }),
          });
          if (pushRes.ok) userNotified = true;
          else console.warn(`[geofence-health-check] push failed for ${userId.slice(0, 8)}: ${pushRes.status}`);
        } catch (err) {
          console.warn(`[geofence-health-check] push threw for ${userId.slice(0, 8)}:`, (err as Error)?.message);
        }
      }

      // (b) SMS — call send-sms with the body
      if (channels.includes('sms') && phone) {
        try {
          const smsRes = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              user_id: userId,
              to_phone: phone,
              body: NOTIFY_BODY,
            }),
          });
          if (smsRes.ok) userNotified = true;
          else console.warn(`[geofence-health-check] sms failed for ${userId.slice(0, 8)}: ${smsRes.status}`);
        } catch (err) {
          console.warn(`[geofence-health-check] sms threw for ${userId.slice(0, 8)}:`, (err as Error)?.message);
        }
      }

      if (userNotified) {
        notified.push(userId);
      } else {
        failed.push({ userId, reason: 'all-channels-failed' });
      }
    }

    const result = {
      ok: true,
      checked: uniqueUserIds.length,
      dark: darkUsers.length,
      notified: notified.length,
      failed: failed.length,
      ms: Date.now() - t0,
    };
    console.log(`[geofence-health-check] done — ${JSON.stringify(result)}`);
    return json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[geofence-health-check] error:', msg);
    return json({ error: msg }, 500);
  }
});
