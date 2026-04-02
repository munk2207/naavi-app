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
      { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 }
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

    const now = Date.now();
    const eventStart = new Date(eventStartISO);
    const eventIsUpcoming = eventStart.getTime() > now + 10 * 60 * 1000; // at least 10 min away

    let leaveByMs: number;
    let leaveBy: string;

    if (eventIsUpcoming) {
      // Leave in time to arrive 5 min before event
      leaveByMs = eventStart.getTime() - (durationMinutes + 5) * 60 * 1000;
      leaveBy = new Date(leaveByMs).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true });
    } else {
      // No specific event — leave now, show arrival time
      leaveByMs = now;
      const arriveAt = new Date(now + durationMinutes * 60 * 1000);
      leaveBy = `now → arrive ${arriveAt.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    }

    const summary = `🚗 ${durationMinutes} min — leave ${leaveBy}`;

    return { durationMinutes, distanceKm, leaveBy, leaveByMs, summary };
  } catch {
    return null;
  }
}
