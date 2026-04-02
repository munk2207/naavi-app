/**
 * get-travel-time Edge Function
 *
 * Returns driving duration from origin to destination using
 * Google Maps Directions API. Origin is the user's current
 * location (lat/lng from browser geolocation).
 *
 * Uses Directions API (not Distance Matrix) so avoid=highways
 * matches the exact same routing Google Maps shows.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const apiKey = Deno.env.get('distance Matrix API') ?? Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Maps API key not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { destination, originLat, originLng, originAddress, avoidHighways } = body;

    if (!destination) {
      return new Response(JSON.stringify({ error: 'Missing destination' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const origin = (originLat && originLng)
      ? `${originLat},${originLng}`
      : (originAddress ?? 'Ottawa,ON,Canada');

    const url = new URL(DIRECTIONS_URL);
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('units', 'metric');
    if (avoidHighways) url.searchParams.set('avoid', 'highways');
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString());
    const data = await res.json();

    if (data.status !== 'OK') {
      console.error('[get-travel-time] API error:', data.status, data.error_message);
      return new Response(JSON.stringify({ error: data.error_message ?? data.status }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const leg = data.routes?.[0]?.legs?.[0];
    if (!leg) {
      return new Response(JSON.stringify({ durationMinutes: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const durationSeconds = leg.duration.value;
    const durationMinutes = Math.ceil(durationSeconds / 60);
    const distanceKm = (leg.distance.value / 1000).toFixed(1);

    console.log(`[get-travel-time] ${destination} — ${durationMinutes} min (${distanceKm} km)`);

    return new Response(JSON.stringify({ durationMinutes, distanceKm: parseFloat(distanceKm) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[get-travel-time] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
