/**
 * Google Maps integration
 *
 * Fetches driving travel time from current location to a destination.
 * Called for calendar events that have a location field.
 * API key is kept server-side in the Edge Function.
 */

import { supabase } from './supabase';

export interface TravelTime {
  durationMinutes: number;
  distanceKm: number;
  leaveBy: string;   // e.g. "9:35 AM"
  leaveByMs: number; // epoch ms — for timer comparison
  summary: string;   // e.g. "🚗 25 min — leave by 9:35 AM"
}

// ─── Get browser geolocation ──────────────────────────────────────────────────

function getCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000 }
    );
  });
}

// ─── Fetch travel time for a destination ─────────────────────────────────────

export async function fetchTravelTime(
  destination: string,
  eventStartISO: string
): Promise<TravelTime | null> {
  if (!supabase || !destination.trim()) return null;

  try {
    const location = await getCurrentLocation();

    const { data, error } = await supabase.functions.invoke('get-travel-time', {
      body: {
        destination,
        originLat: location?.lat,
        originLng: location?.lng,
      },
    });

    if (error || !data || data.durationMinutes == null) return null;

    const { durationMinutes, distanceKm } = data;

    // Calculate leave-by time: event start minus travel time minus 5 min buffer
    const eventStart = new Date(eventStartISO);
    const leaveByMs = eventStart.getTime() - (durationMinutes + 5) * 60 * 1000;
    const leaveByDate = new Date(leaveByMs);
    const leaveBy = leaveByDate.toLocaleTimeString('en-CA', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const summary = `🚗 ${durationMinutes} min — leave by ${leaveBy}`;

    return { durationMinutes, distanceKm, leaveBy, leaveByMs, summary };
  } catch {
    return null;
  }
}
