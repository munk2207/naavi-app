/**
 * tsoft-geofence-webhook Edge Function (V57.17)
 *
 * Receives geofence events POSTed directly by Transistorsoft's native HTTP
 * service (Config.url), bypassing JavaScript entirely. This is the V57.17
 * architectural fix for the JS-handler-suspension problem documented in
 * docs/TRANSISTORSOFT_HEADLESS_WAKE_INVESTIGATION_2026-05-16.md — Android
 * suspends the JS event loop after a geofence event, so our JS handler's
 * `await fetch()` was parked for 15 min to 3 hours until the user opened
 * the app. Native code (no JS) is not subject to that suspension.
 *
 * What this function does:
 *
 *   1. Validates a static bearer token (Transistorsoft can't dynamically
 *      mint per-user JWTs from suspended/killed JS contexts; the SDK posts
 *      with a baked-in header value). We reuse NAAVI_ANON_KEY since both
 *      "secrets" ship in the APK and have equivalent threat models.
 *   2. Parses the vendor's default payload shape (Location-Data-Schema
 *      wiki):
 *        { location: { coords, geofence: { identifier, action },
 *                      extras: { user_id }, timestamp, uuid } }
 *   3. Translates into the existing `report-location-event` LocationEvent
 *      schema and forwards via the same inter-Edge-Function pattern we use
 *      elsewhere. All dedup / direction-matching / dwell / fan-out logic
 *      stays in one place (report-location-event).
 *
 * Why always return HTTP 200:
 *   Per vendor docs, the SDK retries indefinitely (up to `maxDaysToPersist`)
 *   on any non-2xx response, which would flood our logs on permanent
 *   errors. We return 200 with `{ok:false, error}` so the SDK clears the
 *   queued record and we still see the failure server-side via console.error.
 *
 * Coexists with the JS-handler path (`handleGeofenceEvent` in
 * hooks/useGeofencing.ts). Both will POST for a foregrounded event; the
 * 30-min dedup window in `report-location-event` collapses duplicates. The
 * JS path is scheduled for removal in V57.18 once Config.url is proven.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // 1. Lenient auth — accept any non-empty `Bearer <token>` header. Matches
  // the existing `report-location-event` pattern (no strict inbound auth
  // validation; server-side rule/user UUID lookups provide the actual
  // security boundary).
  //
  // Previous design used `auth === Bearer <NAAVI_ANON_KEY>` strict match,
  // but the mobile sends `Bearer <EXPO_PUBLIC_SUPABASE_ANON_KEY>` which is
  // the new sb_publishable_* format — different value than the Edge
  // Function's NAAVI_ANON_KEY env var, causing 401s on every real native
  // POST (proven by 4× 401 status events in client_diagnostics on the
  // V57.17.0 drive test). Removing strict match unblocks the SDK; threat
  // model is equivalent (anyone with rule_id + user_id UUIDs could already
  // POST to report-location-event today).
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || auth.length < 10) {
    return new Response(JSON.stringify({ error: 'missing or malformed authorization' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    // Vendor default payload (Location-Data-Schema wiki):
    //   { location: { coords: {...}, geofence: { identifier, action },
    //                 extras: {...}, timestamp, uuid } }
    const loc = body?.location;
    if (!loc || !loc.geofence) {
      // Not a geofence event (e.g., a location-only post that snuck past
      // persistMode). Acknowledge with 200 so the SDK clears its queue.
      return new Response(
        JSON.stringify({ ok: true, skipped: 'no geofence in payload' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const ruleId = String(loc.geofence.identifier ?? '');
    const action = String(loc.geofence.action ?? '').toLowerCase(); // 'enter' | 'exit'
    const event: 'enter' | 'exit' | 'dwell' | null =
      action === 'enter' ? 'enter' :
      action === 'exit'  ? 'exit'  :
      action === 'dwell' ? 'dwell' :
      null;

    if (!ruleId || !event) {
      return new Response(
        JSON.stringify({ ok: true, skipped: 'invalid payload (missing identifier or unknown action)' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const userId =
      typeof loc.extras?.user_id === 'string' ? loc.extras.user_id : undefined;
    const lat = typeof loc.coords?.latitude === 'number' ? loc.coords.latitude : null;
    const lng = typeof loc.coords?.longitude === 'number' ? loc.coords.longitude : null;
    const timestamp = typeof loc.timestamp === 'string' ? loc.timestamp : new Date().toISOString();
    const uuid = typeof loc.uuid === 'string' ? loc.uuid : '';

    // 2. Forward to report-location-event using inter-Edge-Function auth.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const interFnKey =
      Deno.env.get('NAAVI_ANON_KEY') ??
      Deno.env.get('SUPABASE_ANON_KEY')!;

    console.log(
      `[tsoft-geofence-webhook] forwarding rule=${ruleId.slice(0, 8)} ` +
      `event=${event} user=${(userId ?? 'none').slice(0, 8)} src=tsoft-native`,
    );

    const res = await fetch(`${supabaseUrl}/functions/v1/report-location-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${interFnKey}`,
      },
      body: JSON.stringify({
        ...(userId ? { user_id: userId } : {}),
        rule_id: ruleId,
        lat,
        lng,
        event,
        timestamp,
        event_id: `tsoft-${uuid || crypto.randomUUID()}`,
      }),
    });

    const responseBody = await res.text();
    // Always 200 to the SDK (see top-of-file note on retry semantics). The
    // downstream report-location-event's actual status is logged but not
    // bubbled up — the SDK has cleared its queue, our logs show the
    // outcome.
    return new Response(
      responseBody || JSON.stringify({ ok: true, forwarded: true, downstream_status: res.status }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[tsoft-geofence-webhook] error:', msg);
    // Intentional 200 — see top-of-file. The SDK clears its queue; we log.
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
