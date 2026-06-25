/**
 * tsoft-geofence-webhook
 *
 * Receives native HTTP POST events from the Transistorsoft Background
 * Geolocation SDK (Config.url / autoSync). The SDK posts directly from
 * native code — NOT from JavaScript — so this fires even when the app's
 * JS engine is suspended by Android Doze.
 *
 * Expected payload (Transistorsoft geofence event format):
 * {
 *   uuid:      "...",          // SDK-assigned dedup key
 *   timestamp: "ISO 8601",
 *   coords:    { latitude, longitude, accuracy, ... },
 *   geofence: {
 *     identifier: "<rule_id>",  // action_rules.id — set at registration time
 *     action:     "ENTER" | "EXIT" | "DWELL",
 *     extras:     { user_id: "<uuid>" }  // baked in at registration time
 *   }
 * }
 *
 * Auth: Authorization: Bearer <SUPABASE_ANON_KEY> (sent by SDK via Config.headers)
 *
 * Forwards to report-location-event using service role so fan-out runs
 * with full privileges.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl        = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey            = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Auth: require any Bearer token (SDK sends anon key; exact format may differ
  // between JWT and sb_publishable_ styles across Supabase project ages).
  // Downstream report-location-event validates rule ownership — that is the
  // real security boundary.
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    console.error('[tsoft-geofence-webhook] missing Bearer token');
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    const rawText = await req.text();
    console.log(`[tsoft-geofence-webhook] raw body: ${rawText.slice(0, 1000)}`);
    body = JSON.parse(rawText);
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // SDK wraps the event inside a "location" key: { location: { geofence, coords, ... } }
  const loc       = body?.location ?? body;
  const geofence  = loc?.geofence;
  const coords    = loc?.coords;
  const ruleId    = geofence?.identifier;
  const action    = (geofence?.action ?? '').toLowerCase() as 'enter' | 'exit' | 'dwell';
  const userId    = geofence?.extras?.user_id ?? null;
  const lat       = coords?.latitude  ?? null;
  const lng       = coords?.longitude ?? null;
  const timestamp = loc?.timestamp ?? new Date().toISOString();
  const eventId   = loc?.uuid ?? undefined;

  console.log(`[tsoft-geofence-webhook] rule=${ruleId} action=${action} user=${userId} lat=${lat} lng=${lng}`);

  if (!ruleId || !action || !lat || !lng) {
    console.error('[tsoft-geofence-webhook] missing required fields', { ruleId, action, lat, lng });
    return new Response(JSON.stringify({ error: 'missing fields' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!['enter', 'exit', 'dwell'].includes(action)) {
    console.log(`[tsoft-geofence-webhook] unknown action "${action}" — skipping`);
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Forward to report-location-event using service role
  const payload: Record<string, unknown> = {
    rule_id:   ruleId,
    lat,
    lng,
    event:     action,
    timestamp,
  };
  if (userId)  payload.user_id  = userId;
  if (eventId) payload.event_id = eventId;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/report-location-event`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log(`[tsoft-geofence-webhook] report-location-event → ${res.status} ${text.slice(0, 200)}`);

    return new Response(JSON.stringify({ ok: true }), {
      status: res.ok ? 200 : 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[tsoft-geofence-webhook] fetch to report-location-event failed:', err);
    return new Response(JSON.stringify({ error: 'upstream failed' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
