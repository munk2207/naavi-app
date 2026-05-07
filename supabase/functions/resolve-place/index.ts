/**
 * resolve-place Edge Function (v3 — data-integrity hardened, V57.13.1)
 *
 * Looks up a named place and returns coordinates + address, or indicates that
 * the user must confirm/clarify. Writes are coords-keyed: if a place at the
 * same physical location already exists for this user, the new alias is
 * appended to that row's `aliases` array — no duplicate row is created.
 *
 * Data integrity contract (matches DB constraints in
 * 20260507_user_places_integrity.sql):
 *
 *   - One row per (user_id, ROUND(lat,5), ROUND(lng,5))
 *   - aliases text[] holds every name the user has called this place
 *   - address text holds the Google-Places formatted_address (always populated
 *     on new writes; legacy rows may have NULL until backfilled or re-saved)
 *
 * This function is the ONLY caller-visible write path to user_places. RLS
 * blocks direct writes from the mobile app and voice server. Any future
 * write logic must come through here.
 *
 * Lookup order:
 *   1. Personal keywords ("home"/"office" → user_settings.home_address /
 *      .work_address). If unset, return personal_unset.
 *   2. Memory — user_places where the slugified spoken name matches any
 *      element of aliases (or fuzzy place_name match for bare brands).
 *   3. Fresh — Google Places API biased by reference coords (caller-supplied
 *      or user's home_address). Returns the result WITHOUT writing to cache
 *      unless save_to_cache=true.
 *
 * Save path (save_to_cache=true):
 *   1. Compute rounded coords (5 decimals = ~1.1m precision).
 *   2. SELECT existing row for this user at those rounded coords.
 *   3. If found → UPDATE: append spoken alias (and canonical, if different)
 *      to aliases array; refresh last_used_at.
 *   4. If not found → INSERT new row with aliases populated and address from
 *      Google Places. The DB UNIQUE (user_id, ROUND(lat,5), ROUND(lng,5))
 *      makes a duplicate-coord INSERT physically impossible.
 *
 * Request body: same shape as v2.
 *
 * Response: same shape as v2 PLUS:
 *   - aliases?: string[]   — full alias array (single-result responses)
 *   - candidates[].address — now populated for memory hits too
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
  'home', 'my-home', 'house', 'the-house', 'my-house', 'my-place', 'home-address',
]);
const PERSONAL_WORK = new Set([
  'office', 'my-office', 'the-office', 'work', 'my-work', 'the-work', 'work-address',
]);

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function isBareBrand(spoken: string): boolean {
  const lower = spoken.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  if (wordCount > 2) return false;
  if (/\d/.test(lower)) return false;
  const disambiguator = /\b(street|st|road|rd|ave|avenue|blvd|boulevard|drive|dr|lane|ln|way|near|at the|the one|north|south|east|west|downtown|merivale|kanata|orleans|bayshore|bel\s*air|carling|innes|bank)\b/i;
  if (disambiguator.test(lower)) return false;
  return true;
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
    const radiusOverride = body.radius_meters !== undefined ? Number(body.radius_meters) : 100;
    const saveToCache    = body.save_to_cache === true;
    const canonicalAlias = body.canonical_alias ? String(body.canonical_alias) : null;

    if (!user_id || !placeName) {
      return jsonResponse({ status: 'error', error: 'Missing user_id or place_name' }, 400);
    }

    const alias = slugify(placeName);

    const { data: settings } = await admin
      .from('user_settings')
      .select('home_address, work_address')
      .eq('user_id', user_id)
      .maybeSingle();

    const homeAddress = settings?.home_address as string | null;
    const workAddress = settings?.work_address as string | null;

    console.log(`[resolve-place v3] place_name="${placeName}" alias="${alias}" home_set=${!!homeAddress} work_set=${!!workAddress}`);

    // ── (1) Personal keywords ────────────────────────────────────────────────
    if (PERSONAL_HOME.has(alias)) {
      if (!homeAddress) return jsonResponse({ status: 'personal_unset', personal: 'home' });
      return await resolveByAddress({
        admin, apiKey, user_id, placeName, alias,
        addressQuery: homeAddress,
        source: 'settings_home',
        radiusOverride, saveToCache, canonicalAlias,
      });
    }
    if (PERSONAL_WORK.has(alias)) {
      if (!workAddress) return jsonResponse({ status: 'personal_unset', personal: 'work' });
      return await resolveByAddress({
        admin, apiKey, user_id, placeName, alias,
        addressQuery: workAddress,
        source: 'settings_work',
        radiusOverride, saveToCache, canonicalAlias,
      });
    }

    // ── (2) Memory lookup ────────────────────────────────────────────────────
    // Match the spoken alias against ANY element of the aliases array, or
    // fuzzy-match place_name for bare brands.
    const bareBrand = isBareBrand(placeName);
    if (bareBrand) {
      const { data: multi } = await admin
        .from('user_places')
        .select('aliases, place_name, address, lat, lng, radius_meters')
        .eq('user_id', user_id)
        .or(`aliases.cs.{${alias}},place_name.ilike.%${placeName}%`)
        .order('last_used_at', { ascending: false })
        .limit(5);

      if (multi && multi.length >= 2) {
        console.log(`[resolve-place v3] bare-brand memory multi: ${multi.length} matches for "${placeName}"`);
        return jsonResponse({
          status: 'multiple',
          source: 'memory',
          candidates: multi.map((r: any) => ({
            alias: (r.aliases ?? [])[0] ?? slugify(r.place_name),
            aliases: r.aliases ?? [],
            place_name: r.place_name,
            address: r.address ?? null,
            lat: r.lat,
            lng: r.lng,
            radius_meters: r.radius_meters,
          })),
        });
      }
      if (multi && multi.length === 1) {
        const c: any = multi[0];
        const finalAliases = await mergeAliasesIfSaving({
          admin, existing: c, user_id,
          newAliases: [alias, canonicalAlias].filter(Boolean) as string[],
          saveToCache,
        });
        return jsonResponse({
          status: 'ok',
          source: 'memory',
          alias: finalAliases[0] ?? alias,
          aliases: finalAliases,
          place_name: c.place_name,
          address: c.address ?? null,
          lat: c.lat,
          lng: c.lng,
          radius_meters: c.radius_meters,
        });
      }
      // 0 saved matches → fall through to fresh
    } else {
      // Exact-alias memory lookup using array containment
      const { data: cached } = await admin
        .from('user_places')
        .select('aliases, place_name, address, lat, lng, radius_meters')
        .eq('user_id', user_id)
        .contains('aliases', [alias])
        .maybeSingle();

      if (cached) {
        const finalAliases = await mergeAliasesIfSaving({
          admin, existing: cached as any, user_id,
          newAliases: [alias, canonicalAlias].filter(Boolean) as string[],
          saveToCache,
        });
        return jsonResponse({
          status: 'ok',
          source: 'memory',
          alias,
          aliases: finalAliases,
          place_name: (cached as any).place_name,
          address: (cached as any).address ?? null,
          lat: (cached as any).lat,
          lng: (cached as any).lng,
          radius_meters: (cached as any).radius_meters,
        });
      }
    }

    // ── (3) Fresh resolve via Places API ────────────────────────────────────
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

    if (bareBrand && specificResults.length >= 2) {
      // Dedupe by rounded coords
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
          address:       r.formatted_address ?? null,
          lat:           r.geometry.location.lat,
          lng:           r.geometry.location.lng,
          radius_meters: radiusOverride,
          canonical_alias: slugify(name),
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
      : (typeof first.formatted_address === 'string' && first.formatted_address.trim())
        ? first.formatted_address.trim()
        : placeName;
    const resolvedAddr  = first.formatted_address ?? null;
    const canonicalSlug = slugify(resolvedName);

    let aliasesAfterSave: string[] = Array.from(new Set([alias, canonicalAlias ?? canonicalSlug].filter(Boolean) as string[]));

    if (saveToCache) {
      const saveResult = await saveOrMerge({
        admin, user_id,
        spokenAlias: alias,
        canonicalAlias: canonicalAlias ?? canonicalSlug,
        placeName: resolvedName,
        address: resolvedAddr,
        lat, lng,
        radius: radiusOverride,
      });
      aliasesAfterSave = saveResult.aliases;
      console.log(`[resolve-place v3] saved (${saveResult.action}) "${placeName}" → ${resolvedName} @ ${lat},${lng} aliases=[${aliasesAfterSave.join(',')}]`);
    }

    return jsonResponse({
      status: 'ok',
      source: 'fresh',
      alias,
      canonical_alias: canonicalSlug,
      aliases: aliasesAfterSave,
      place_name: resolvedName,
      address: resolvedAddr,
      lat,
      lng,
      radius_meters: radiusOverride,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[resolve-place v3] Error:', msg);
    return jsonResponse({ status: 'error', error: msg }, 500);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * On a memory hit with save_to_cache=true, merge any new aliases into the
 * existing row's aliases array AND update last_used_at. If save_to_cache is
 * false, only refresh last_used_at.
 *
 * Critical for the integrity contract: every save_to_cache call must add
 * its alias to the row, even when the place is already cached. Otherwise a
 * user who calls a place by a new name (after an earlier save) would never
 * see that new name added to the row.
 *
 * Returns the final aliases array on the row (echoed in the response).
 */
async function mergeAliasesIfSaving(opts: {
  admin: any;
  existing: { aliases?: string[]; lat: number; lng: number };
  user_id: string;
  newAliases: string[];
  saveToCache: boolean;
}): Promise<string[]> {
  const existingAliases = opts.existing.aliases ?? [];
  const now = new Date().toISOString();

  if (!opts.saveToCache) {
    // Just refresh last_used_at, don't merge
    await opts.admin.from('user_places')
      .update({ last_used_at: now })
      .eq('user_id', opts.user_id)
      .eq('lat', opts.existing.lat)
      .eq('lng', opts.existing.lng);
    return existingAliases;
  }

  const merged = Array.from(new Set([...existingAliases, ...opts.newAliases.filter(Boolean)]));
  // Skip the UPDATE if nothing changed to keep this idempotent
  if (merged.length === existingAliases.length) {
    await opts.admin.from('user_places')
      .update({ last_used_at: now })
      .eq('user_id', opts.user_id)
      .eq('lat', opts.existing.lat)
      .eq('lng', opts.existing.lng);
    return existingAliases;
  }

  await opts.admin.from('user_places')
    .update({ aliases: merged, alias: merged[0], last_used_at: now })
    .eq('user_id', opts.user_id)
    .eq('lat', opts.existing.lat)
    .eq('lng', opts.existing.lng);
  return merged;
}


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

  let aliasesAfterSave: string[] = Array.from(new Set([opts.alias, opts.canonicalAlias ?? opts.alias].filter(Boolean) as string[]));

  if (opts.saveToCache) {
    const saveResult = await saveOrMerge({
      admin: opts.admin,
      user_id: opts.user_id,
      spokenAlias: opts.alias,
      canonicalAlias: opts.canonicalAlias ?? opts.alias,
      placeName: opts.addressQuery,
      address: coords.formatted ?? opts.addressQuery,
      lat: coords.lat,
      lng: coords.lng,
      radius: opts.radiusOverride,
    });
    aliasesAfterSave = saveResult.aliases;
  }

  return jsonResponse({
    status: 'ok',
    source: opts.source,
    alias: opts.alias,
    aliases: aliasesAfterSave,
    place_name: opts.addressQuery,
    address: coords.formatted ?? opts.addressQuery,
    lat: coords.lat,
    lng: coords.lng,
    radius_meters: opts.radiusOverride,
  });
}

/**
 * Coords-keyed write — the heart of the integrity contract.
 *
 * Looks up an existing row by (user_id, rounded lat/lng). If found, appends
 * the new aliases to that row's array (idempotent — won't duplicate). If not
 * found, inserts a new row with aliases populated and address always set.
 *
 * Returns the final aliases array on the row so the response can echo it.
 */
async function saveOrMerge(opts: {
  admin: any;
  user_id: string;
  spokenAlias: string;
  canonicalAlias: string;
  placeName: string;
  address: string | null;
  lat: number;
  lng: number;
  radius: number;
}): Promise<{ action: 'merged' | 'inserted'; aliases: string[] }> {
  const newAliases = Array.from(new Set(
    [opts.spokenAlias, opts.canonicalAlias].filter(Boolean) as string[],
  ));
  const now = new Date().toISOString();

  // Look up existing row by rounded coords (5 decimals = ~1.1m).
  // PostgREST doesn't expose ROUND() in filters, so we use lat/lng range
  // queries that capture all rows within ~1.1m of the new coords.
  const epsilon = 0.00001; // 5-decimal rounding tolerance
  const { data: existing } = await opts.admin
    .from('user_places')
    .select('id, aliases')
    .eq('user_id', opts.user_id)
    .gte('lat', opts.lat - epsilon).lte('lat', opts.lat + epsilon)
    .gte('lng', opts.lng - epsilon).lte('lng', opts.lng + epsilon)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Merge: union of existing aliases and new aliases, no duplicates
    const merged = Array.from(new Set([...((existing as any).aliases ?? []), ...newAliases]));
    await opts.admin
      .from('user_places')
      .update({
        aliases: merged,
        alias: merged[0],            // legacy column kept in sync
        place_name: opts.placeName,  // refresh to latest spelling
        address: opts.address,       // backfills NULL on legacy rows
        last_used_at: now,
      })
      .eq('id', (existing as any).id);
    return { action: 'merged', aliases: merged };
  }

  // No existing row at these coords — insert new.
  await opts.admin
    .from('user_places')
    .insert({
      user_id: opts.user_id,
      aliases: newAliases,
      alias: newAliases[0],          // legacy column populated
      place_name: opts.placeName,
      address: opts.address,
      lat: opts.lat,
      lng: opts.lng,
      radius_meters: opts.radius,
      last_used_at: now,
    });
  return { action: 'inserted', aliases: newAliases };
}
