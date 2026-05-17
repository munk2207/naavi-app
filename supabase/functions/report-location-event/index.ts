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
  // V57.16 — now optional. Headless task on the phone may not have a live
  // session and skip the client-side rule lookup; server derives user_id
  // from the rule's owner. If client DID send it, server validates it
  // matches rule.user_id (preserves cross-user safety check).
  user_id?:  string;
  rule_id:   string;
  lat:       number;
  lng:       number;
  event:     'enter' | 'exit' | 'dwell';
  timestamp: string;
  event_id?: string; // V57.10.1 — diagnostic correlation id from client
  // 2026-05-11: set true when fire-pending-dwells cron POSTs back here to
  // run the fan-out after a dwell timer completes. Skips the direction-
  // match block (we're already past that — the original ENTER already
  // matched) and the defer block (no point re-deferring), goes straight
  // to dedup + fire.
  from_pending_dwell?: boolean;
}

// V57.10.1 — direct insert into client_diagnostics so the Doze-delay
// investigation can join client (T1/T2) and server (T3/T4) timestamps
// under the same event_id. Fire-and-forget; never block the main path.
async function diag(
  admin: any,
  eventId: string | undefined,
  userId: string,
  step: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  if (!eventId) return;
  try {
    await admin.from('client_diagnostics').insert({
      session_id: eventId,
      step,
      user_id: userId,
      ms_since_start: 0,
      payload,
      build_version: 'server',
    });
  } catch {
    // intentional: never let diagnostic logging affect the alert path
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const interFnKey  = Deno.env.get('NAAVI_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const body = (await req.json()) as LocationEvent;
    const { rule_id, event, event_id } = body;
    let { user_id } = body;
    const fromPendingDwell = body.from_pending_dwell === true;

    if (!rule_id || !event) {
      return json({ error: 'Missing rule_id or event' }, 400);
    }

    // 1. Fetch the rule first (service-role bypasses RLS) — verify it's a
    // location rule and resolve user_id if the client didn't send one
    // (V57.16: headless-task path may have no live session).
    const { data: rule, error: ruleErr } = await admin
      .from('action_rules')
      .select('id, user_id, trigger_type, trigger_config, action_type, action_config, label, one_shot, enabled')
      .eq('id', rule_id)
      .maybeSingle();

    if (ruleErr || !rule) return json({ error: 'Rule not found' }, 404);

    if (user_id) {
      // Client provided a user_id — validate it matches the rule's owner
      // (cross-user safety: someone with a stolen rule_id can't fire it
      // for a different user).
      if (rule.user_id !== user_id) {
        return json({ error: 'Rule does not belong to user' }, 403);
      }
    } else {
      // Headless / session-less path — derive user_id from the rule itself
      user_id = rule.user_id;
    }

    // V57.10.1 — T3 server received. Pairs with client T1/T2 to expose
    // the Doze-delay segment.
    await diag(admin, event_id, user_id, 'geofence-T3-server-received', {
      rule_id,
      event,
      client_timestamp: body.timestamp,
    });

    if (rule.trigger_type !== 'location') return json({ error: 'Not a location rule' }, 400);
    if (!rule.enabled) return json({ ok: true, skipped: 'rule disabled' });

    // 2026-05-17 — PHANTOM-FIRE REJECTION (cold-start initial-state guard).
    //
    // Wael reported being woken at 02:36 AM 2026-05-17 by alerts for both
    // 8042 and 8182 while physically at home (lat 45.4879, lng -75.5232 —
    // 1+ km from either geofence). The mobile JS handler ran a full chain
    // (T2 → T3 → fan-out) for both rules within the same second. Phone was
    // not in either geofence and had not moved. Almost certainly cold-start
    // initial-state events from Transistorsoft surviving our 5-sec
    // post-registration phantom-suppress on the mobile side (because rules
    // were registered hours/days ago, not seconds).
    //
    // Server-side guard: if the reported location is far outside the rule's
    // geofence radius, reject the fire as phantom. Per vendor type defs
    // (Location.d.ts:18-235), coords are guaranteed non-null in every
    // GeofenceEvent — but our handler-side code defensively sends null on
    // missing coords, so we accept (don't reject) when lat/lng absent.
    //
    // Tolerance: 2× the rule's radius — generous enough to absorb normal
    // GPS noise + the boundary fact that a phone slightly outside the
    // circle can still trigger ENTER. 2× is well outside any normal arrival
    // and well inside the typical phantom-fire distance (today: 10× radius).
    if (!fromPendingDwell) {
      const reportedLat = typeof body.lat === 'number' ? body.lat : null;
      const reportedLng = typeof body.lng === 'number' ? body.lng : null;
      const ruleLat = rule.trigger_config?.resolved_lat;
      const ruleLng = rule.trigger_config?.resolved_lng;
      const radiusM = typeof rule.trigger_config?.radius_meters === 'number'
        ? rule.trigger_config.radius_meters
        : 300;
      if (
        reportedLat !== null && reportedLng !== null &&
        typeof ruleLat === 'number' && typeof ruleLng === 'number'
      ) {
        const distanceM = haversineMeters(reportedLat, reportedLng, ruleLat, ruleLng);
        if (distanceM > radiusM * 2) {
          console.log(
            `[report-location-event] PHANTOM rejected rule=${rule_id.slice(0,8)} ` +
            `reported=(${reportedLat.toFixed(5)}, ${reportedLng.toFixed(5)}) ` +
            `rule_center=(${ruleLat.toFixed(5)}, ${ruleLng.toFixed(5)}) ` +
            `distance=${distanceM.toFixed(0)}m radius=${radiusM}m`
          );
          await diag(admin, event_id, user_id, 'geofence-T3-phantom-rejected', {
            rule_id,
            reported_lat: reportedLat,
            reported_lng: reportedLng,
            rule_lat: ruleLat,
            rule_lng: ruleLng,
            distance_m: Math.round(distanceM),
            radius_m: radiusM,
          });
          return json({
            ok: true,
            skipped: 'phantom — reported location outside geofence',
            distance_m: Math.round(distanceM),
            radius_m: radiusM,
          });
        }
      }
    }

    // V57.16 — dedup window: 30 minutes (was per-day). Wael 2026-05-15:
    // false positives consume the daily dedup and lose the real arrival
    // alert. Per-minute window means a false fire only locks the rule for
    // 30 min; real arrivals after that re-arm. Anti-spam intact for
    // multiple-fires-per-hour cases.
    const DEDUP_WINDOW_MS = 30 * 60 * 1000;
    const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();

    // 2pre. Pending-dwell cron bypass — we already crossed direction matching
    // when the original ENTER landed. Jump to dedup + fire so the fan-out
    // runs after the dwell timer completed.
    if (fromPendingDwell) {
      const direction = String(rule.trigger_config?.direction ?? 'arrive');
      const normalizedEvent = direction === 'leave' ? 'exit' : 'enter';
      const triggerRef = `loc-${rule_id}-${new Date().toISOString()}-${normalizedEvent}`;

      const { data: recentFires } = await admin
        .from('action_rule_log')
        .select('id, fired_at')
        .eq('rule_id', rule_id)
        .gte('fired_at', dedupCutoff)
        .order('fired_at', { ascending: false })
        .limit(1);

      if (recentFires && recentFires.length > 0) {
        return json({ ok: true, skipped: 'already fired within last 30 min' });
      }

      const success = await fireLocationAction(rule, admin, supabaseUrl, interFnKey);
      if (success) {
        await admin.from('action_rule_log').insert({ rule_id, trigger_ref: triggerRef });
        await admin.from('action_rules').update({ last_fired_at: new Date().toISOString() }).eq('id', rule_id);
        if (rule.one_shot) {
          await admin.from('action_rules').update({ enabled: false }).eq('id', rule_id);
        }
        console.log(`[report-location-event] Fired (from pending dwell) rule ${rule_id} for user ${user_id}`);
        return json({ ok: true, fired: true, from_pending_dwell: true });
      }
      console.error(`[report-location-event] Fan-out failed for pending-dwell rule ${rule_id}`);
      return json({ ok: false, fired: false, from_pending_dwell: true }, 500);
    }

    // 2. Direction + dwell-cancellation routing.
    // Three cases:
    //   a. Event matches direction (arrive/inside → enter/dwell; leave → exit)
    //      → continue with dedup + defer/fire below
    //   b. Event is the OPPOSITE direction (user reversed mid-dwell)
    //      → cancel any active pending_dwell_fires row and return
    //   c. Anything else (no geofence direction at all) → skip
    const direction = String(rule.trigger_config?.direction ?? 'arrive');
    const matchesDirection = direction === 'leave'
      ? event === 'exit'
      : (event === 'enter' || event === 'dwell');
    const oppositeOfDirection = direction === 'leave'
      ? (event === 'enter' || event === 'dwell')
      : event === 'exit';

    if (oppositeOfDirection) {
      // User reversed before dwell completed. Cancel any active pending row
      // for this rule so the deferred fire never lands. Idempotent — no-op
      // if no row exists. Cancelling a stale row from yesterday is harmless
      // (we filter on active state, not date).
      const { error: cancelErr } = await admin
        .from('pending_dwell_fires')
        .update({ cancelled_at: new Date().toISOString() })
        .eq('rule_id', rule_id)
        .is('cancelled_at', null)
        .is('fired_at', null);
      if (cancelErr) {
        console.error('[report-location-event] cancel pending dwell error:', cancelErr.message);
      } else {
        console.log(`[report-location-event] Cancelled pending dwell for rule ${rule_id} (user reversed via ${event})`);
      }

      // 2026-05-17 — also update last_exited_at on the state machine. For
      // an "arrive" rule, EXIT is the opposite direction and bails here
      // without reaching the EXIT-handler in step 3 below. Without this
      // write, the state machine would lock the user "inside" forever
      // until the 4h TTL expires — and they'd miss the next legitimate
      // arrival alert.
      if ((direction === 'arrive' || direction === 'inside') && event === 'exit') {
        const { error: exitErr } = await admin
          .from('action_rules')
          .update({ last_exited_at: new Date().toISOString() })
          .eq('id', rule_id);
        if (exitErr) {
          console.error('[report-location-event] last_exited_at UPDATE error (opposite-dir branch):', exitErr.message);
        }
      }

      return json({ ok: true, cancelled: true });
    }

    if (!matchesDirection) {
      return json({ ok: true, skipped: `event ${event} does not match direction ${direction}` });
    }

    // 3. State-machine dedup (2026-05-17, supersedes the action_rule_log
    // 30-min window). Two failure modes the old dedup didn't catch:
    //
    //   A) 11:37 phantom — Transistorsoft re-fires ENTER for a stationary
    //      device hours after the real arrival. The 30-min window had
    //      already expired (117 min elapsed) so the second fire passed
    //      and the user got a duplicate alert while never having moved.
    //   B) 09:40 race — two T3s arrived 283 ms apart, both queried the
    //      action_rule_log in parallel, both saw "no recent fires", both
    //      fanned out. User got double quadruple-channel alerts.
    //
    // Fix: atomic UPDATE on action_rules with a state-machine predicate.
    // Only the winning T3 gets a row back; losers (whether racing or
    // post-stale-ENTER duplicates) see zero rows returned and skip the
    // fan-out. Killing both bugs with one mechanism.
    //
    // Predicate (allow ENTER if any of):
    //   - last_entered_at IS NULL (never entered before)
    //   - last_exited_at is newer than last_entered_at (user left and is
    //     returning — a real second arrival)
    //   - last_entered_at is older than 4 hours (TTL safety net: if
    //     Transistorsoft missed an EXIT event, don't trap the user in
    //     "already inside" forever — auto-treat stale ENTER as exited)
    const normalizedEvent = direction === 'leave' ? 'exit' : 'enter';
    const triggerRef = `loc-${rule_id}-${new Date().toISOString()}-${normalizedEvent}`;
    const STATE_TTL_HOURS = 4;

    if (normalizedEvent === 'enter') {
      // Atomic state-machine check via SQL function (PostgREST cannot do
      // column-to-column comparisons in .or() filters, so we wrap the UPDATE
      // in try_enter_geofence — see migration 20260517_action_rules_inside_
      // outside_state.sql). Returns one row if fanout should proceed, no
      // rows if the rule says we're already inside (stationary re-fire or
      // T3 race loser).
      const { data: rows, error: updErr } = await admin
        .rpc('try_enter_geofence', { p_rule_id: rule_id, p_ttl_hours: STATE_TTL_HOURS });

      if (updErr) {
        console.error('[report-location-event] try_enter_geofence RPC error:', updErr.message);
        // Fail open — if the RPC breaks, fall through to the legacy
        // action_rule_log check below so a real arrival still fires.
      } else if (!rows || rows.length === 0) {
        // State machine said no — user is already considered "inside"
        // (either a duplicate ENTER from a stationary re-fire or the
        // loser of a T3 race).
        console.log(
          `[report-location-event] STATE-MACHINE skipped rule=${rule_id.slice(0,8)} ` +
          `event=${event} reason=already-inside (last_entered_at within ${STATE_TTL_HOURS}h, no exit since)`
        );
        await diag(admin, event_id, user_id, 'geofence-T3-state-already-inside', {
          rule_id,
          event,
          ttl_hours: STATE_TTL_HOURS,
        });
        return json({ ok: true, skipped: 'state-machine — already inside (no exit since last entry)' });
      }
    } else {
      // EXIT — idempotently bump last_exited_at. Multiple consecutive
      // EXITs while already outside are harmless (just keeps the
      // timestamp fresh). Lets the next ENTER pass the state-machine.
      const { error: exitErr } = await admin
        .from('action_rules')
        .update({ last_exited_at: new Date().toISOString() })
        .eq('id', rule_id);
      if (exitErr) {
        console.error('[report-location-event] last_exited_at UPDATE error:', exitErr.message);
      }
    }

    // Legacy fallback dedup (kept as a safety net in case the state-machine
    // UPDATE failed). Same 30-min window as before.
    const { data: recentFires } = await admin
      .from('action_rule_log')
      .select('id, fired_at')
      .eq('rule_id', rule_id)
      .gte('fired_at', dedupCutoff)
      .order('fired_at', { ascending: false })
      .limit(1);

    if (recentFires && recentFires.length > 0) {
      return json({ ok: true, skipped: 'already fired within last 30 min (legacy fallback dedup)' });
    }

    // 3b. Server-side dwell. If > 0, defer the fire instead of running
    // fan-out now. The fire-pending-dwells cron picks it up after the
    // dwell completes — UNLESS the user reverses direction (handled in
    // step 2's oppositeOfDirection branch above). Filters drive-throughs.
    //
    // V57.16 — read EITHER dwell_seconds OR dwell_minutes from trigger_config
    // (rules historically wrote dwell_minutes which the prior code ignored).
    //
    // 2026-05-16 — default 30 s → 0 s (Wael decision). Today's drive proved
    // the JS-handler suspension (V57.16.1 diagnostic finding) is the real
    // latency source, not drive-throughs. With dwell=0 + the V57.16.2
    // startBackgroundTask fix, end-to-end T1→delivery drops from 17-34 min
    // to ~10-30 sec. Drive-through false-fires reintroduced as a trade-off
    // — Wael's use cases are intentional arrivals (Costco, home, work),
    // drive-throughs are rare. Per-rule override still works via
    // trigger_config.dwell_seconds for any rule that wants the old behavior.
    let dwellSeconds: number;
    if (typeof rule.trigger_config?.dwell_seconds === 'number') {
      dwellSeconds = Math.max(0, Math.floor(rule.trigger_config.dwell_seconds));
    } else if (typeof rule.trigger_config?.dwell_minutes === 'number') {
      dwellSeconds = Math.max(0, Math.floor(rule.trigger_config.dwell_minutes * 60));
    } else {
      dwellSeconds = 0;
    }

    if (dwellSeconds > 0) {
      // Defense in depth: clear any stale active row before insert so the
      // partial unique index can't reject the new row. (Should be no-op
      // because oppositeOfDirection cancels en-route exits, but a duplicate
      // ENTER without an intervening EXIT — phantom geofence event — would
      // otherwise collide with the partial UNIQUE.)
      await admin
        .from('pending_dwell_fires')
        .update({ cancelled_at: new Date().toISOString() })
        .eq('rule_id', rule_id)
        .is('cancelled_at', null)
        .is('fired_at', null);

      const now = new Date();
      const fireAt = new Date(now.getTime() + dwellSeconds * 1000);
      const { error: insertErr } = await admin
        .from('pending_dwell_fires')
        .insert({
          rule_id,
          user_id,
          entered_at: now.toISOString(),
          fire_at: fireAt.toISOString(),
        });

      if (insertErr) {
        console.error('[report-location-event] failed to schedule dwell fire:', insertErr.message);
        return json({ error: 'failed to schedule dwell fire' }, 500);
      }

      console.log(`[report-location-event] Deferred rule ${rule_id} for ${dwellSeconds}s dwell — fires at ${fireAt.toISOString()}`);
      await diag(admin, event_id, user_id, 'geofence-T4-deferred', {
        rule_id,
        dwell_seconds: dwellSeconds,
        fire_at: fireAt.toISOString(),
      });
      return json({ ok: true, deferred: true, fire_at: fireAt.toISOString() });
    }

    // 4. Fire the action (replicates evaluate-rules/fireAction fan-out)
    const success = await fireLocationAction(rule, admin, supabaseUrl, interFnKey);

    // V57.10.1 — T4 fan-out finished. Difference vs T3 = server fan-out cost.
    await diag(admin, event_id, user_id, 'geofence-T4-fanout-done', {
      rule_id,
      success,
    });

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
  // Shared merge logic in _shared/alert_body.ts. Pass rule.id so F1a's
  // list_connections path can surface a connected list in the fan-out.
  const body = await buildAlertBody(config, rule.user_id, supabaseUrl, interFnKey, rule.id);

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
  // When a location rule like "alert me at Costco" has no explicit to_phone /
  // to_email, the intent is clearly self-alert — default to user's own
  // channels rather than failing with "no destination". Mirrors the same
  // fallback in evaluate-rules/fireAction (which is the cron path).
  const noRecipient = !toPhone && !toEmail;
  const isSelfAlert = Boolean(isSelfByPhone || isSelfByEmail || noRecipient);

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

  // S12 — outbound voice call as the 5th channel for arrival self-alerts.
  // A driver parking at Costco won't look at SMS/WhatsApp/Email/Push; the
  // phone ringing + speaking the alert body is the only reliable signal.
  // Fires only for arrival (dwell/enter) + self-alert + location trigger.
  const callVoice = async (toNumber: string): Promise<{ channel: string; ok: boolean }> => {
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
    const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')  ?? '';
    const voiceBase  = Deno.env.get('VOICE_SERVER_URL')   ?? '';
    const twilioFrom = '+12495235394';
    // V57.10.5 — diagnostic. Wael 2026-05-03 reported no voice call for a
    // Movati arrival even though SMS + WhatsApp fired. Voice-call rows
    // were ALSO missing from sent_messages because the channel CHECK
    // constraint rejected them (separate fix in same release). This log
    // tells us at audit time whether callVoice even reached the Twilio
    // API call vs bailed early due to missing env, AND surfaces the
    // exact failure reason if Twilio rejects.
    console.log(`[callVoice] entry rule=${rule.id.slice(0,8)} to=${toNumber} accountSid=${accountSid ? 'set' : 'MISSING'} authToken=${authToken ? 'set' : 'MISSING'} voiceBase=${voiceBase ? voiceBase : 'MISSING'}`);
    if (!accountSid || !authToken || !voiceBase) {
      console.error('[report-location-event] callVoice: missing Twilio/voice-server secrets — skipping');
      return { channel: 'voice-call', ok: false };
    }
    try {
      const twiUrl = `${voiceBase}/speak-alert?body=${encodeURIComponent(body)}&user_id=${encodeURIComponent(rule.user_id)}`;
      const form = new URLSearchParams();
      form.append('To',     toNumber);
      form.append('From',   twilioFrom);
      form.append('Url',    twiUrl);
      form.append('Method', 'POST');
      form.append('MachineDetection', 'DetectMessageEnd');
      const creds = btoa(`${accountSid}:${authToken}`);
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
      });
      console.log(`[callVoice] Twilio API responded status=${res.status} ok=${res.ok} for rule=${rule.id.slice(0,8)} to=${toNumber}`);
      // V57.10.2 — track voice calls in sent_messages so the DB has an
      // internal record (parity with SMS/WhatsApp/email rows). Without
      // this we couldn't distinguish "voice call placed" from "voice
      // call never tried" at audit time. Fire-and-forget; never block.
      // V57.10.3 — capture Twilio's error response body in `metadata`
      // so failures can be diagnosed from sent_messages alone (parity
      // with SMS error rows that previously stored only "failed" with
      // no reason).
      let providerSid: string | null = null;
      let errorMetadata: Record<string, unknown> | null = null;
      try {
        const json = await res.clone().json();
        providerSid = typeof json?.sid === 'string' ? json.sid : null;
        if (!res.ok) {
          errorMetadata = {
            twilio_status: res.status,
            twilio_code: json?.code ?? null,
            twilio_message: typeof json?.message === 'string' ? json.message.slice(0, 500) : null,
            twilio_more_info: json?.more_info ?? null,
          };
        }
      } catch {
        if (!res.ok) errorMetadata = { twilio_status: res.status, parse_error: 'response body not JSON' };
      }
      admin.from('sent_messages').insert({
        user_id:         rule.user_id,
        channel:         'voice',
        to_phone:        toNumber,
        body,
        delivery_status: res.ok ? 'sent' : 'failed',
        provider_sid:    providerSid,
        source:          'location_alert',
        metadata:        errorMetadata,
      }).then(() => {}).catch(() => {});
      return { channel: 'voice-call', ok: res.ok };
    } catch (err) {
      console.error('[report-location-event] callVoice error:', err);
      return { channel: 'voice-call', ok: false };
    }
  };

  // Direction check matches the outer handler — arrival means direction
  // 'arrive' (default) or 'inside'; 'leave' stays visual-only since exiting
  // a place isn't an urgent moment.
  const triggerConfig = rule.trigger_config ?? {};
  const direction = String(triggerConfig.direction ?? 'arrive');
  const isArrival = direction !== 'leave';

  const sends: Promise<{ channel: string; ok: boolean }>[] = [];
  if (isSelfAlert) {
    if (userPhone) { sends.push(callSMS('sms', userPhone)); sends.push(callSMS('whatsapp', userPhone)); }
    if (userEmail) { sends.push(callEmail(userEmail)); }
    sends.push(callPush());
    if (userPhone && isArrival) sends.push(callVoice(userPhone));
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

// 2026-05-17 — great-circle distance between two lat/lng points, in meters.
// Used by the phantom-fire guard above to compare the SDK's reported phone
// location to the rule's geofence center. Standard haversine formula.
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => deg * Math.PI / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
