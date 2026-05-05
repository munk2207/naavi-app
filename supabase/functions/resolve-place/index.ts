/**
 * resolve-place Edge Function (v2 — verified-address-only)
 *
 * Looks up a named place and returns coordinates, or indicates that the
 * user must confirm/clarify. Never silently caches a Google guess.
 *
 * Lookup order:
 *   1. Personal keywords ("home"/"house"/"my home" → home_address;
 *      "office"/"work"/"my office" → work_address). If the user has the
 *      address set, resolve that address via Places API. If not set,
 *      return status='personal_unset' so Claude can tell the user to add
 *      it in Settings.
 *   2. Cache — user_places where (user_id, alias) matches the slugified
 *      place_name. Instant hit if a previous conversation saved it.
 *   3. Fresh — Google Places API biased by reference coordinates (from
 *      caller) or by the user's home_address if they have one. Returns
 *      the result WITHOUT writing to cache unless save_to_cache=true.
 *
 * Caching is explicit: callers must set save_to_cache=true AFTER the
 * user has confirmed the address. When saving, two rows are written:
 *   - Row A: slugified spoken name (what the user called the place)
 *   - Row B: slugified canonical name (what Places API named it)
 * Both point to the same coordinates. Subsequent lookups by either
 * name will hit the cache.
 *
 * Request body:
 *   {
 *     user_id:         "uuid",                  // required
 *     place_name:      "Costco Merivale",       // required, what the user said
 *     reference_lat?:  number,                  // optional bias anchor
 *     reference_lng?:  number,
 *     radius_meters?:  number,                  // default 100
 *     save_to_cache?:  boolean,                 // default false
 *     canonical_alias?: string                  // only used when save_to_cache=true
 *   }
 *
 * Response:
 *   {
 *     status:        'ok' | 'personal_unset' | 'not_found',
 *     source:        'memory' | 'fresh' | 'settings_home' | 'settings_work' | null,
 *     alias:         "costco-merivale",
 *     canonical_alias?: "costco-wholesale",
 *     place_name:    "Costco Wholesale",
 *     address?:      "1280 Merivale Rd, Ottawa, ON",
 *     lat:           number,
 *     lng:           number,
 *     radius_meters: number
 *   }
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PLACES_TEXT_SEARCH = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const PLACES_GEOCODE     = 'https://maps.googleapis.com/maps/api/geocode/json';

// Personal-keyword map — aliases that resolve from user_settings columns.
// Keys are slugified forms; compare against slugify(place_name).
const PERSONAL_HOME = new Set([
  'home', 'my-home', 'house', 'the-house', 'my-house', 'my-place', 'home-address',
]);
const PERSONAL_WORK = new Set([
  'office', 'my-office', 'the-office', 'work', 'my-work', 'the-work', 'work-address',
]);

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
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
    const radiusOverride = body.radius_meters !== undefined ? Number(body.radius_meters) : 100;
    const saveToCache    = body.save_to_cache === true;
    const canonicalAlias = body.canonical_alias ? String(body.canonical_alias) : null;

    if (!user_id || !placeName) {
      return jsonResponse({ status: 'error', error: 'Missing user_id or place_name' }, 400);
    }

    const alias = slugify(placeName);

    // ── Load user_settings once — used by personal keywords + reference fallback
    const { data: settings } = await admin
      .from('user_settings')
      .select('home_address, work_address')
      .eq('user_id', user_id)
      .maybeSingle();

    const homeAddress = settings?.home_address as string | null;
    const workAddress = settings?.work_address as string | null;

    console.log(`[resolve-place] called with place_name="${placeName}" alias="${alias}" home_set=${!!homeAddress} work_set=${!!workAddress}`);

    // ── (1) Personal keywords — resolve via saved address or report unset
    if (PERSONAL_HOME.has(alias)) {
      console.log(`[resolve-place] personal HOME keyword matched. home_address="${homeAddress ?? '(null)'}"`);
      if (!homeAddress) {
        return jsonResponse({
          status: 'personal_unset',
          personal: 'home',
        });
      }
      return await resolveByAddress({
        admin, apiKey, user_id, placeName, alias,
        addressQuery: homeAddress,
        source: 'settings_home',
        radiusOverride, saveToCache, canonicalAlias,
      });
    }
    if (PERSONAL_WORK.has(alias)) {
      console.log(`[resolve-place] personal WORK keyword matched. work_address="${workAddress ?? '(null)'}"`);
      if (!workAddress) {
        return jsonResponse({
          status: 'personal_unset',
          personal: 'work',
        });
      }
      return await resolveByAddress({
        admin, apiKey, user_id, placeName, alias,
        addressQuery: workAddress,
        source: 'settings_work',
        radiusOverride, saveToCache, canonicalAlias,
      });
    }

    // ── (2) Memory lookup — any alias this user has previously confirmed
    const { data: cached } = await admin
      .from('user_places')
      .select('alias, place_name, lat, lng, radius_meters')
      .eq('user_id', user_id)
      .eq('alias', alias)
      .maybeSingle();

    if (cached) {
      await admin.from('user_places')
        .update({ last_used_at: new Date().toISOString() })
        .eq('user_id', user_id)
        .eq('alias', alias);

      console.log(`[resolve-place] memory hit: ${alias}`);
      return jsonResponse({
        status: 'ok',
        source: 'memory',
        alias: cached.alias,
        place_name: cached.place_name,
        lat: cached.lat,
        lng: cached.lng,
        radius_meters: cached.radius_meters,
      });
    }

    // ── (3) Fresh resolve via Places API
    if (!apiKey) {
      return jsonResponse({ status: 'error', error: 'GOOGLE_PLACES_API_KEY not configured' }, 500);
    }

    // Pick reference anchor: explicit caller coords > user home_address > nothing
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
      qs.set('radius', '50000'); // 50km bias radius
    }

    const res = await fetch(`${PLACES_TEXT_SEARCH}?${qs.toString()}`);
    if (!res.ok) {
      return jsonResponse({ status: 'error', error: `Places API ${res.status}` }, 502);
    }

    const data = await res.json();
    const first = data.results?.[0];
    if (!first) {
      return jsonResponse({ status: 'not_found' });
    }

    const lat = first.geometry?.location?.lat;
    const lng = first.geometry?.location?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return jsonResponse({ status: 'not_found' });
    }

    // V57.11 — quality check. Google Places Text Search happily returns
    // fuzzy matches even for typo'd or non-existent addresses ("150 Innards
    // Road" was being confirmed as a real place because Google returned the
    // surrounding postal-code area). Reject if:
    //   (a) the match is partial AND the result has no concrete-location
    //       type — Google guessed our way to a generic area
    //   (b) the result types are entirely generic (locality / political /
    //       postal_code) with no street, premise, or establishment
    const resultTypes: string[] = Array.isArray(first.types) ? first.types : [];
    const SPECIFIC_TYPES = new Set([
      'street_address', 'premise', 'subpremise', 'route',
      'point_of_interest', 'establishment',
      'park', 'airport', 'transit_station',
      'school', 'university', 'hospital', 'restaurant', 'store',
      'shopping_mall', 'gas_station', 'pharmacy',
    ]);
    const hasSpecificType = resultTypes.some(t => SPECIFIC_TYPES.has(t));
    const isPartial = first.partial_match === true;
    if (!hasSpecificType || (isPartial && !hasSpecificType)) {
      console.log(`[resolve-place] rejecting "${placeName}" — no concrete-location type. partial=${isPartial} types=${JSON.stringify(resultTypes)} formatted=${JSON.stringify(first.formatted_address ?? null)}`);
      return jsonResponse({ status: 'not_found' });
    }

    // Prefer Google's canonical form (formatted_address or name) over
    // the user's typed input — otherwise a typo gets echoed back to
    // the user as the "found" address. Only fall back to placeName if
    // both Google fields are missing.
    const resolvedName = (typeof first.name === 'string' && first.name.trim())
      ? first.name.trim()
      : (typeof first.formatted_address === 'string' && first.formatted_address.trim())
        ? first.formatted_address.trim()
        : placeName;
    const resolvedAddr  = first.formatted_address ?? null;
    const canonicalSlug = slugify(resolvedName);

    // If save_to_cache, write BOTH alias rows
    if (saveToCache) {
      await writeBothAliases({
        admin, user_id,
        spokenAlias: alias,
        canonicalAlias: canonicalAlias ?? canonicalSlug,
        placeName: resolvedName,
        lat, lng,
        radius: radiusOverride,
      });
      console.log(`[resolve-place] cached (confirmed) "${placeName}" → ${resolvedName} @ ${lat},${lng}`);
    } else {
      console.log(`[resolve-place] fresh (unsaved) "${placeName}" → ${resolvedName} @ ${lat},${lng}`);
    }

    return jsonResponse({
      status: 'ok',
      source: 'fresh',
      alias,
      canonical_alias: canonicalSlug,
      place_name: resolvedName,
      address: resolvedAddr,
      lat,
      lng,
      radius_meters: radiusOverride,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[resolve-place] Error:', msg);
    return jsonResponse({ status: 'error', error: msg }, 500);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function geocodeAddress(address: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const qs = new URLSearchParams({ address, key: apiKey });
    const res = await fetch(`${PLACES_GEOCODE}?${qs.toString()}`);
    if (!res.ok) {
      console.error(`[geocode] HTTP ${res.status} for "${address}"`);
      return null;
    }
    const data = await res.json();
    if (data.status && data.status !== 'OK') {
      console.error(`[geocode] API status="${data.status}" error="${data.error_message ?? 'none'}" for "${address}"`);
      return null;
    }
    const first = data.results?.[0];
    const lat = first?.geometry?.location?.lat;
    const lng = first?.geometry?.location?.lng;
    if (typeof lat === 'number' && typeof lng === 'number') {
      console.log(`[geocode] "${address}" → ${first.formatted_address ?? 'unknown'} @ ${lat},${lng}`);
      return { lat, lng };
    }
    console.error(`[geocode] no results / bad shape for "${address}"`);
    return null;
  } catch (err) {
    console.error(`[geocode] exception for "${address}":`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function resolveByAddress(opts: {
  admin: any;
  apiKey: string | undefined;
  user_id: string;
  placeName: string;
  alias: string;
  addressQuery: string;
  source: 'settings_home' | 'settings_work';
  radiusOverride: number;
  saveToCache: boolean;
  canonicalAlias: string | null;
}): Promise<Response> {
  if (!opts.apiKey) {
    return jsonResponse({ status: 'error', error: 'GOOGLE_PLACES_API_KEY not configured' }, 500);
  }

  const coords = await geocodeAddress(opts.addressQuery, opts.apiKey);
  if (!coords) {
    return jsonResponse({ status: 'not_found' });
  }

  if (opts.saveToCache) {
    await writeBothAliases({
      admin: opts.admin,
      user_id: opts.user_id,
      spokenAlias: opts.alias,
      canonicalAlias: opts.canonicalAlias ?? opts.alias,
      placeName: opts.addressQuery,
      lat: coords.lat,
      lng: coords.lng,
      radius: opts.radiusOverride,
    });
  }

  return jsonResponse({
    status: 'ok',
    source: opts.source,
    alias: opts.alias,
    place_name: opts.addressQuery,
    address: opts.addressQuery,
    lat: coords.lat,
    lng: coords.lng,
    radius_meters: opts.radiusOverride,
  });
}

async function writeBothAliases(opts: {
  admin: any;
  user_id: string;
  spokenAlias: string;
  canonicalAlias: string;
  placeName: string;
  lat: number;
  lng: number;
  radius: number;
}): Promise<void> {
  const now = new Date().toISOString();
  // Row A — spoken alias
  await opts.admin.from('user_places')
    .upsert(
      {
        user_id: opts.user_id,
        alias: opts.spokenAlias,
        place_name: opts.placeName,
        lat: opts.lat, lng: opts.lng,
        radius_meters: opts.radius,
        last_used_at: now,
      },
      { onConflict: 'user_id,alias' },
    );

  // Row B — canonical alias (only if different from spoken)
  if (opts.canonicalAlias && opts.canonicalAlias !== opts.spokenAlias) {
    await opts.admin.from('user_places')
      .upsert(
        {
          user_id: opts.user_id,
          alias: opts.canonicalAlias,
          place_name: opts.placeName,
          lat: opts.lat, lng: opts.lng,
          radius_meters: opts.radius,
          last_used_at: now,
        },
        { onConflict: 'user_id,alias' },
      );
  }
}
