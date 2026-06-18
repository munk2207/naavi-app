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
    // use_geocoding: true — skip Places Text Search and geocode the address
    // directly. Used for contact-card addresses (residential) that Places
    // Text Search cannot find.
    const useGeocoding   = body.use_geocoding === true;

    if (!user_id || !placeName) {
      return jsonResponse({ status: 'error', error: 'Missing user_id or place_name' }, 400);
    }

    // ── (0) Direct geocoding path (contact-card addresses) ──────────────────
    if (useGeocoding) {
      if (!apiKey) return jsonResponse({ status: 'error', error: 'GOOGLE_PLACES_API_KEY not configured' }, 500);
      return await resolveByAddress({ apiKey, addressQuery: placeName, source: 'contact', radiusOverride });
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
    let homeCountry: string | null = null;
    if (homeAddress) {
      // Always geocode home_address — we need its country for the numeric-
      // address gate, even when bias coords were passed in by the caller.
      const homeCoords = await geocodeAddress(homeAddress, apiKey);
      if (homeCoords) {
        if (biasLat === null || biasLng === null) {
          biasLat = homeCoords.lat;
          biasLng = homeCoords.lng;
        }
        homeCountry = homeCoords.country;
      }
    }

    // 2026-05-16 — numbered street addresses → geocode API with 3-check gate
    // (country, precision, postal completeness). Wael's design principle:
    // reject ANY geocode result lacking a complete postal code (in Canada,
    // 6 chars; 3-char FSA-only means "approximate area," not a real address).
    // No silent fall-through to textsearch — better to ask user to retype
    // than to register an alert at wrong coords.
    // Matches CLAUDE.md holding-list item 16.
    if (/^\s*\d/.test(placeName)) {
      // Try raw geocode first (cheapest path — single API call when the
      // user typed the address correctly).
      let result = await geocodeBestCandidate(placeName, apiKey, homeCountry);

      // 2026-05-16 retry — Google geocode is strict on spelling. Wael's
      // test "8042 Jean d'Arc Boulevard north" returned no usable
      // candidate because the street is actually "Jeanne-d'Arc". Re-trying
      // the SAME query with the user's home city/province appended often
      // disambiguates without changing the user's typo. Costs +1 geocode
      // call ($0.005) ONLY when the first call returned no passing candidate.
      if (!result && homeAddress) {
        const parts = homeAddress.split(/,\s*/);
        if (parts.length >= 2) {
          const cityProv = parts.slice(-2).join(', ');  // "Ottawa, Ontario"
          const enriched = `${placeName}, ${cityProv}`;
          console.log(`[resolve-place v5] geocode no-pass for "${placeName}", retrying with "${enriched}"`);
          result = await geocodeBestCandidate(enriched, apiKey, homeCountry);
        }
      }

      if (result) {
        console.log(`[resolve-place v5] numeric-address path → geocode (gated): "${placeName}" → ${result.formatted}`);
        return jsonResponse({
          status:        'ok',
          source:        'fresh',
          place_name:    result.formatted ?? placeName,
          address:       result.formatted,
          lat:           result.lat,
          lng:           result.lng,
          radius_meters: radiusOverride,
        });
      }
      // 2026-05-16 — gate rejected every candidate (or geocode returned
      // nothing). Return not_found instead of falling through to textsearch.
      // textsearch returns business-name matches for numbered queries,
      // which is wrong (Wael's "8042 Jean d'Arc" test returned "1887 St
      // Joseph Blvd", "Ottawa," etc. — all the wrong place). The
      // orchestrator handles not_found by asking the user to retype.
      console.log(`[resolve-place v5] numeric-address: no candidate passed gate for "${placeName}", returning not_found`);
      return jsonResponse({ status: 'not_found' });
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
        const canonicalName = (typeof r.name === 'string' && r.name.trim())
          ? r.name.trim()
          : (typeof r.formatted_address === 'string' ? r.formatted_address.trim() : placeName);
        return {
          place_name:    placeName,          // user's original term — used in picker speech
          canonical_name: canonicalName,     // Google's name — kept for geocoding reference
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

// 2026-05-16 — extended return shape to include the signals geocodeBestCandidate
// needs (country, postal_code, location_type, partial_match). Callers that only
// use lat/lng/formatted continue to work — extra fields are ignored.
async function geocodeAddress(address: string, apiKey: string): Promise<{
  lat: number;
  lng: number;
  formatted: string | null;
  country: string | null;
  postalCode: string | null;
  locationType: string | null;
  partialMatch: boolean;
} | null> {
  try {
    const qs = new URLSearchParams({ address, key: apiKey });
    const res = await fetch(`${PLACES_GEOCODE}?${qs.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status && data.status !== 'OK') return null;
    const first = data.results?.[0];
    return extractGeocodeFields(first);
  } catch (err) {
    console.error(`[geocode] exception for "${address}":`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// Extract the fields we care about from a single Google geocode result.
// Returns null if lat/lng are missing.
function extractGeocodeFields(result: any): {
  lat: number;
  lng: number;
  formatted: string | null;
  country: string | null;
  postalCode: string | null;
  locationType: string | null;
  partialMatch: boolean;
} | null {
  if (!result) return null;
  const lat = result?.geometry?.location?.lat;
  const lng = result?.geometry?.location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const formatted = result?.formatted_address ?? null;
  const locationType = result?.geometry?.location_type ?? null;
  const partialMatch = result?.partial_match === true;
  const components = Array.isArray(result?.address_components) ? result.address_components : [];
  const countryComp = components.find((c: any) => Array.isArray(c?.types) && c.types.includes('country'));
  const postalComp = components.find((c: any) => Array.isArray(c?.types) && c.types.includes('postal_code'));
  return {
    lat,
    lng,
    formatted,
    country: countryComp?.short_name ?? null,
    postalCode: postalComp?.long_name ?? null,
    locationType,
    partialMatch,
  };
}

// 2026-05-16 — iterate ALL geocode results, return the first one passing the
// 3-check gate (country, precision, postal completeness). Returns null when
// no candidate passes — caller treats that as not_found (no silent fallback
// to textsearch, no silent acceptance of an imprecise coord pair).
async function geocodeBestCandidate(
  address: string,
  apiKey: string,
  expectedCountry: string | null,
): Promise<{ lat: number; lng: number; formatted: string | null; country: string | null; postalCode: string | null } | null> {
  try {
    const qs = new URLSearchParams({ address, key: apiKey });
    const res = await fetch(`${PLACES_GEOCODE}?${qs.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status && data.status !== 'OK') return null;
    const results: any[] = Array.isArray(data.results) ? data.results : [];
    for (const candidate of results) {
      const fields = extractGeocodeFields(candidate);
      if (!fields) continue;
      // Gate 1 — Country must match (kills Albania/Belgium fallbacks).
      if (expectedCountry && fields.country && fields.country !== expectedCountry) {
        console.log(`[geocodeBestCandidate] reject (country=${fields.country}, expected=${expectedCountry}): ${fields.formatted}`);
        continue;
      }
      // Gate 2 — Precision (rejects APPROXIMATE / GEOMETRIC_CENTER and partial matches).
      if (fields.partialMatch || (fields.locationType !== 'ROOFTOP' && fields.locationType !== 'RANGE_INTERPOLATED')) {
        console.log(`[geocodeBestCandidate] reject (precision: loc_type=${fields.locationType} partial=${fields.partialMatch}): ${fields.formatted}`);
        continue;
      }
      // Gate 3 — Postal code completeness (catches FSA-only Canadian results like K1C).
      if (!isPostalCodeComplete(fields.postalCode, fields.country)) {
        console.log(`[geocodeBestCandidate] reject (postal incomplete: ${fields.postalCode}, country=${fields.country}): ${fields.formatted}`);
        continue;
      }
      console.log(`[geocodeBestCandidate] accept: ${fields.formatted}`);
      return {
        lat: fields.lat,
        lng: fields.lng,
        formatted: fields.formatted,
        country: fields.country,
        postalCode: fields.postalCode,
      };
    }
    return null;
  } catch (err) {
    console.error(`[geocodeBestCandidate] exception for "${address}":`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// Country-specific postal code completeness check.
// Wael 2026-05-16: incomplete postal codes (e.g., Canada's 3-char FSA "K1C")
// are a strong signal that geocode fell back to an imprecise area, not a
// specific address. Reject those — return not_found and ask the user to retype.
function isPostalCodeComplete(code: string | null, country: string | null): boolean {
  if (!code) return false;
  const compact = code.replace(/\s+/g, '');
  switch (country) {
    case 'CA':
      // Canadian postal codes: 6 alphanumeric chars in pattern A1A1A1
      return /^[A-Z]\d[A-Z]\d[A-Z]\d$/i.test(compact);
    case 'US':
      // US ZIP: 5 digits, optionally + ZIP+4 (9 digits)
      return /^\d{5}(\d{4})?$/.test(compact);
    case 'GB':
      // UK postcodes: variable but always have outward + inward (5-7 chars)
      return compact.length >= 5;
    default:
      // Permissive default for countries we haven't validated — require
      // any postal code at all + sane minimum length.
      return compact.length >= 3;
  }
}

async function resolveByAddress(opts: {
  apiKey: string | undefined;
  addressQuery: string;
  source: 'settings_home' | 'settings_work' | 'contact';
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
