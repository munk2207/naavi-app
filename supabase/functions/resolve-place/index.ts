/**
 * resolve-place Edge Function (v5 — memory removed, V57.13.3)
 *
 * Wael 2026-05-07: dropped the memory cache (user_places table) entirely.
 * The cache was a constant source of bugs (Toronto-shadows-Ottawa, qualified
 * vs unqualified rows, alias merge edge cases, picker UX coupling). With
 * memory gone, the function does just two things:
 *
 *   1. Personal keywords ("home" / "office") → resolve via the user's saved
 *      home_address / work_address from user_settings, geocoded fresh.
 *   2. Everything else → fresh Google Places search. If 2+ specific results,
 *      return them as a picker; if 1, return as single; if 0, not_found.
 *
 * No DB writes. Orchestrator inserts the chosen result into action_rules
 * with full coords + place_name + address. action_rules has the new
 * unique-coords-per-user constraint so duplicate-prevention is at the DB
 * layer; orchestrator pre-checks for graceful UX.
 *
 * Request body:
 *   {
 *     user_id:        "uuid",                  // required
 *     place_name:     "Costco Merivale",       // required
 *     reference_lat?: number,                  // optional bias anchor
 *     reference_lng?: number,
 *     radius_meters?: number,                  // default 100
 *   }
 *
 * Response:
 *   Single-result:
 *   {
 *     status:        'ok',
 *     source:        'fresh' | 'settings_home' | 'settings_work',
 *     place_name:    "Costco Wholesale",
 *     address:       "1280 Merivale Rd, Ottawa, ON",
 *     lat:           number,
 *     lng:           number,
 *     radius_meters: number
 *   }
 *
 *   Multi-result (Google returned 2+ specific results):
 *   {
 *     status:     'multiple',
 *     source:     'fresh',
 *     candidates: [
 *       { place_name, address, lat, lng, radius_meters },
 *       ...
 *     ]
 *   }
 *
 *   Personal address unset:
 *   { status: 'personal_unset', personal: 'home' | 'work' }
 *
 *   Not found:
 *   { status: 'not_found' }
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PLACES_TEXT_SEARCH = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const PLACES_GEOCODE     = 'https://maps.googleapis.com/maps/api/geocode/json';

const PERSONAL_HOME = new Set([
  'home', 'my home', 'house', 'the house', 'my house', 'my place', 'home address',
]);
const PERSONAL_WORK = new Set([
  'office', 'my office', 'the office', 'work', 'my work', 'the work', 'work address',
]);

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

const SPECIFIC_TYPES = new Set([
  'street_address', 'premise', 'subpremise', 'route',
  'point_of_interest', 'establishment',
  'park', 'airport', 'transit_station',
  'school', 'university', 'hospital', 'restaurant', 'store',
  'shopping_mall', 'gas_station', 'pharmacy',
]);

function isSpecificResult(r: any): boolean {
  const types: string[] = Array.isArray(r?.types) ? r.types : [];
  const hasSpecific = types.some(t => SPECIFIC_TYPES.has(t));
  if (!hasSpecific) return false;
  if (r?.partial_match === true && !hasSpecific) return false;
  if (typeof r?.geometry?.location?.lat !== 'number') return false;
  if (typeof r?.geometry?.location?.lng !== 'number') return false;
  // V57.13.2 fully-qualified rule: a result without formatted_address
  // cannot be displayed meaningfully in a picker. Reject it.
  if (typeof r?.formatted_address !== 'string' || r.formatted_address.trim().length === 0) return false;
  return true;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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
    // V57.16 — default radius 100 → 300m. 100m fired alerts too late
    // (user already inside the building); 300m gives early-arrival
    // alert while the user is still approaching/parking.
    const radiusOverride = body.radius_meters !== undefined ? Number(body.radius_meters) : 300;

    if (!user_id || !placeName) {
      return jsonResponse({ status: 'error', error: 'Missing user_id or place_name' }, 400);
    }

    const normalized = normalize(placeName);

    // Load user_settings — used by personal keywords + reference fallback
    const { data: settings } = await admin
      .from('user_settings')
      .select('home_address, work_address')
      .eq('user_id', user_id)
      .maybeSingle();

    const homeAddress = settings?.home_address as string | null;
    const workAddress = settings?.work_address as string | null;

    console.log(`[resolve-place v5] place_name="${placeName}" home_set=${!!homeAddress} work_set=${!!workAddress}`);

    // ── (1) Personal keywords ────────────────────────────────────────────────
    if (PERSONAL_HOME.has(normalized)) {
      if (!homeAddress) return jsonResponse({ status: 'personal_unset', personal: 'home' });
      return await resolveByAddress({ apiKey, addressQuery: homeAddress, source: 'settings_home', radiusOverride });
    }
    if (PERSONAL_WORK.has(normalized)) {
      if (!workAddress) return jsonResponse({ status: 'personal_unset', personal: 'work' });
      return await resolveByAddress({ apiKey, addressQuery: workAddress, source: 'settings_work', radiusOverride });
    }

    // ── (2) Fresh Google Places search ───────────────────────────────────────
    if (!apiKey) {
      return jsonResponse({ status: 'error', error: 'GOOGLE_PLACES_API_KEY not configured' }, 500);
    }

    let biasLat: number | null = referenceLat;
    let biasLng: number | null = referenceLng;
    if ((biasLat === null || biasLng === null) && homeAddress) {
      const homeCoords = await geocodeAddress(homeAddress, apiKey);
      if (homeCoords) {
        biasLat = homeCoords.lat;
        biasLng = homeCoords.lng;
      }
    }

    const qs = new URLSearchParams({ query: placeName, key: apiKey });
    if (biasLat !== null && biasLng !== null && Number.isFinite(biasLat) && Number.isFinite(biasLng)) {
      qs.set('location', `${biasLat},${biasLng}`);
      qs.set('radius', '50000');
    }

    const res = await fetch(`${PLACES_TEXT_SEARCH}?${qs.toString()}`);
    if (!res.ok) {
      return jsonResponse({ status: 'error', error: `Places API ${res.status}` }, 502);
    }

    const data = await res.json();
    const allResults: any[] = Array.isArray(data.results) ? data.results : [];
    const specificResults = allResults.filter(isSpecificResult);

    // Multi-result: 2+ specific results → return picker. The user always picks.
    if (specificResults.length >= 2) {
      // Dedupe by rounded coords (4 decimals = ~11m) — Google sometimes returns
      // the same physical place twice with different place IDs.
      const seen = new Set<string>();
      const deduped: any[] = [];
      for (const r of specificResults) {
        const key = `${Math.round(r.geometry.location.lat * 10000)},${Math.round(r.geometry.location.lng * 10000)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(r);
      }
      const candidates = deduped.slice(0, 5).map((r: any) => {
        const name = (typeof r.name === 'string' && r.name.trim())
          ? r.name.trim()
          : (typeof r.formatted_address === 'string' ? r.formatted_address.trim() : placeName);
        return {
          place_name:    name,
          address:       r.formatted_address,
          lat:           r.geometry.location.lat,
          lng:           r.geometry.location.lng,
          radius_meters: radiusOverride,
        };
      });
      return jsonResponse({ status: 'multiple', source: 'fresh', candidates });
    }

    const first = specificResults[0];
    if (!first) {
      return jsonResponse({ status: 'not_found' });
    }

    const lat = first.geometry.location.lat;
    const lng = first.geometry.location.lng;
    const resolvedName = (typeof first.name === 'string' && first.name.trim())
      ? first.name.trim()
      : first.formatted_address;
    const resolvedAddr = first.formatted_address;

    return jsonResponse({
      status: 'ok',
      source: 'fresh',
      place_name: resolvedName,
      address: resolvedAddr,
      lat,
      lng,
      radius_meters: radiusOverride,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[resolve-place v5] Error:', msg);
    return jsonResponse({ status: 'error', error: msg }, 500);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function geocodeAddress(address: string, apiKey: string): Promise<{ lat: number; lng: number; formatted: string | null } | null> {
  try {
    const qs = new URLSearchParams({ address, key: apiKey });
    const res = await fetch(`${PLACES_GEOCODE}?${qs.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status && data.status !== 'OK') return null;
    const first = data.results?.[0];
    const lat = first?.geometry?.location?.lat;
    const lng = first?.geometry?.location?.lng;
    const formatted = first?.formatted_address ?? null;
    if (typeof lat === 'number' && typeof lng === 'number') {
      return { lat, lng, formatted };
    }
    return null;
  } catch (err) {
    console.error(`[geocode] exception for "${address}":`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function resolveByAddress(opts: {
  apiKey: string | undefined;
  addressQuery: string;
  source: 'settings_home' | 'settings_work';
  radiusOverride: number;
}): Promise<Response> {
  if (!opts.apiKey) {
    return jsonResponse({ status: 'error', error: 'GOOGLE_PLACES_API_KEY not configured' }, 500);
  }
  const coords = await geocodeAddress(opts.addressQuery, opts.apiKey);
  if (!coords) {
    return jsonResponse({ status: 'not_found' });
  }
  return jsonResponse({
    status: 'ok',
    source: opts.source,
    place_name: opts.addressQuery,
    address: coords.formatted ?? opts.addressQuery,
    lat: coords.lat,
    lng: coords.lng,
    radius_meters: opts.radiusOverride,
  });
}
