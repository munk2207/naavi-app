/**
 * resolve-place Edge Function
 *
 * Turns a named place ("Costco", "Home Depot", "cottage") into coordinates
 * + radius suitable for a geofence. Caches resolutions in the user_places
 * table so repeated uses of the same name are free.
 *
 * Request body:
 *   {
 *     user_id:        "uuid",              // required
 *     place_name:     "Costco",            // required, natural language
 *     reference_lat?: number,              // optional, helps disambiguate (user's home)
 *     reference_lng?: number,              // optional
 *     radius_meters?: number               // optional, default 100
 *   }
 *
 * Returns:
 *   { alias, place_name, lat, lng, radius_meters, from_cache: boolean }
 *
 * Required Supabase secret:
 *   GOOGLE_PLACES_API_KEY — Google Cloud project with Places API enabled.
 *
 * Auth: service role (called from voice server or mobile orchestrator).
 *
 * Caching: results are saved to user_places keyed by (user_id, alias).
 * Alias is derived from place_name (lowercase, dashed). If a user says
 * "Costco" twice and the reference location is the same, the second call
 * returns the cached row instantly without a Places API hit.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PLACES_TEXT_SEARCH = 'https://maps.googleapis.com/maps/api/place/textsearch/json';

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiKey      = Deno.env.get('GOOGLE_PLACES_API_KEY');
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const user_id        = String(body.user_id ?? '');
    const placeName      = String(body.place_name ?? '').trim();
    const referenceLat   = body.reference_lat !== undefined ? Number(body.reference_lat) : null;
    const referenceLng   = body.reference_lng !== undefined ? Number(body.reference_lng) : null;
    const radiusOverride = body.radius_meters !== undefined ? Number(body.radius_meters) : 100;

    if (!user_id || !placeName) {
      return json({ error: 'Missing user_id or place_name' }, 400);
    }

    const alias = slugify(placeName);

    // 1. Check cache
    const { data: cached } = await admin
      .from('user_places')
      .select('alias, place_name, lat, lng, radius_meters')
      .eq('user_id', user_id)
      .eq('alias', alias)
      .maybeSingle();

    if (cached) {
      await admin
        .from('user_places')
        .update({ last_used_at: new Date().toISOString() })
        .eq('user_id', user_id)
        .eq('alias', alias);

      console.log(`[resolve-place] cache hit: ${alias}`);
      return json({ ...cached, from_cache: true });
    }

    // 2. Cache miss — call Places API
    if (!apiKey) {
      return json({ error: 'GOOGLE_PLACES_API_KEY not configured' }, 500);
    }

    const qs = new URLSearchParams({ query: placeName, key: apiKey });
    if (referenceLat !== null && referenceLng !== null && Number.isFinite(referenceLat) && Number.isFinite(referenceLng)) {
      qs.set('location', `${referenceLat},${referenceLng}`);
      qs.set('radius', '50000'); // 50km disambiguation radius
    }

    const res = await fetch(`${PLACES_TEXT_SEARCH}?${qs.toString()}`);
    if (!res.ok) {
      return json({ error: `Places API ${res.status}` }, 502);
    }

    const data = await res.json();
    const first = data.results?.[0];
    if (!first) {
      return json({ error: 'No place found' }, 404);
    }

    const lat = first.geometry?.location?.lat;
    const lng = first.geometry?.location?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return json({ error: 'Place result missing coordinates' }, 502);
    }

    const resolvedName = first.name ?? placeName;

    // 3. Cache the result
    const { error: insertErr } = await admin
      .from('user_places')
      .insert({
        user_id,
        alias,
        place_name: resolvedName,
        lat, lng,
        radius_meters: radiusOverride,
      });

    if (insertErr && !insertErr.message.includes('duplicate key')) {
      console.error('[resolve-place] cache insert failed:', insertErr.message);
      // Fall through — we still have a valid result to return
    }

    console.log(`[resolve-place] resolved "${placeName}" → ${resolvedName} @ ${lat},${lng}`);
    return json({
      alias,
      place_name: resolvedName,
      lat, lng,
      radius_meters: radiusOverride,
      from_cache: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[resolve-place] Error:', msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
