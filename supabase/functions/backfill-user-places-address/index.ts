/**
 * backfill-user-places-address — one-shot reverse-geocode
 *
 * For every user_places row with address IS NULL, calls Google Places
 * Geocoding API in reverse mode (lat/lng → address) and populates the
 * address column. Run once after the V57.13.1 migration to give legacy
 * rows the address data the new picker needs.
 *
 * Safe to re-run: only touches rows where address IS NULL.
 *
 * Request body:
 *   {
 *     user_id?: string  // optional — if set, only that user's rows;
 *                       //            if absent, all users
 *     dry_run?: boolean // optional — skip the UPDATE, just report what
 *                       //            would change. Default false.
 *   }
 *
 * Response:
 *   {
 *     scanned:  number,           // rows considered
 *     updated:  number,           // rows where address got populated
 *     skipped:  number,           // rows where Google returned no result
 *     details:  Array<{ id, lat, lng, old_address, new_address, status }>
 *   }
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PLACES_GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiKey      = Deno.env.get('GOOGLE_PLACES_API_KEY');
  const admin = createClient(supabaseUrl, serviceKey);

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GOOGLE_PLACES_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));
  const userId: string | null = body.user_id ?? null;
  const dryRun: boolean = body.dry_run === true;

  let q = admin.from('user_places').select('id, user_id, lat, lng, address').is('address', null);
  if (userId) q = q.eq('user_id', userId);
  const { data: rows, error: selErr } = await q;

  if (selErr) {
    return new Response(JSON.stringify({ error: selErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const details: any[] = [];
  let updated = 0;
  let skipped = 0;

  for (const row of rows ?? []) {
    const r: any = row;
    try {
      const qs = new URLSearchParams({ latlng: `${r.lat},${r.lng}`, key: apiKey });
      const res = await fetch(`${PLACES_GEOCODE}?${qs.toString()}`);
      if (!res.ok) {
        skipped++;
        details.push({ id: r.id, lat: r.lat, lng: r.lng, status: `http ${res.status}` });
        continue;
      }
      const data = await res.json();
      const addr: string | undefined = data?.results?.[0]?.formatted_address;
      if (!addr) {
        skipped++;
        details.push({ id: r.id, lat: r.lat, lng: r.lng, status: data?.status ?? 'no result' });
        continue;
      }
      if (!dryRun) {
        await admin.from('user_places').update({ address: addr }).eq('id', r.id);
      }
      updated++;
      details.push({ id: r.id, lat: r.lat, lng: r.lng, old_address: r.address, new_address: addr, status: dryRun ? 'dry-run' : 'updated' });
    } catch (err) {
      skipped++;
      details.push({ id: r.id, lat: r.lat, lng: r.lng, status: `exception: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  return new Response(JSON.stringify({
    scanned: rows?.length ?? 0,
    updated,
    skipped,
    dry_run: dryRun,
    details,
  }, null, 2), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
