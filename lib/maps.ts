/**
 * Google Maps integration
 *
 * Fetches driving travel time from current location to a destination.
 * Called for calendar events that have a location field.
 * API key is kept server-side in the Edge Function.
 */

import { supabase } from './supabase';
import { invokeWithTimeout, queryWithTimeout, getSessionWithTimeout } from './invokeWithTimeout';
import * as Location from 'expo-location';

export interface TravelTime {
  durationMinutes: number;
  distanceKm: number;
  leaveBy: string;      // e.g. "9:35 AM"
  leaveByMs: number;    // epoch ms — for timer comparison
  leaveByLabel: string; // e.g. "Leave by 9:35 p.m." or "Arrive by 9:35 p.m."
  summary: string;      // e.g. "🚗 25 min — leave by 9:35 AM"
}

// ─── Get stored home address from knowledge fragments ─────────────────────────

async function getStoredHomeAddress(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const session = await getSessionWithTimeout();
    if (!session?.user?.id) return null;
    const { data } = await queryWithTimeout(
      supabase
        .from('knowledge_fragments')
        .select('content')
        .eq('user_id', session.user.id)
        .or('content.ilike.%home address%,content.ilike.%i live at%,content.ilike.%my address%,content.ilike.%home is at%')
        .limit(1)
        .single(),
      15_000,
      'select-home-address-fragment',
    );
    if (!data?.content) return null;
    // Extract the address portion after common phrases
    const match = data.content.match(/(?:home address is|i live at|my address is|home is at)\s+(.+)/i);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// ─── Get device geolocation (Android-safe via expo-location) ─────────────────

async function getCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
  try {
    // Request permission — on Android this shows the system permission dialog
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    // Try cached position first (instant) — good enough for driving directions
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60000 });
    if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };

    // No cache — get fresh position with a timeout
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 10000)),
    ]);
    if (!fresh) return null;
    return { lat: (fresh as Location.LocationObject).coords.latitude, lng: (fresh as Location.LocationObject).coords.longitude };
  } catch {
    return null;
  }
}

// ─── Fetch travel time for a destination ─────────────────────────────────────

export async function fetchTravelTime(
  destination: string,
  eventStartISO: string,
  avoidHighways = false,
  departureISO = ''
): Promise<TravelTime | null> {
  if (!supabase || !destination.trim()) return null;

  try {
    const [location, homeAddress] = await Promise.all([
      getCurrentLocation(),
      getStoredHomeAddress(),
    ]);

    const { data, error } = await invokeWithTimeout('get-travel-time', {
      body: {
        destination,
        originLat: location?.lat,
        originLng: location?.lng,
        originAddress: (!location && homeAddress) ? homeAddress : undefined,
        avoidHighways,
      },
    }, 15_000);

    if (error || !data || data.durationMinutes == null) return null;

    const { durationMinutes, distanceKm } = data;

    const now = Date.now();
    const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };

    let leaveByMs: number;
    let leaveByLabel: string;
    let leaveBy: string;

    const departure = departureISO ? new Date(departureISO) : null;
    const eventStart = eventStartISO ? new Date(eventStartISO) : null;
    const eventIsUpcoming = eventStart && eventStart.getTime() > now + 10 * 60 * 1000;

    if (departure && departure.getTime() > now) {
      // User specified departure time — show arrival time
      leaveByMs = departure.getTime();
      const arriveAt = new Date(departure.getTime() + durationMinutes * 60 * 1000);
      leaveBy = departure.toLocaleTimeString('en-CA', timeOpts);
      leaveByLabel = `Arrive by ${arriveAt.toLocaleTimeString('en-CA', timeOpts)}`;
    } else if (eventIsUpcoming) {
      // Arrival/event time specified — show departure time
      leaveByMs = eventStart!.getTime() - (durationMinutes + 5) * 60 * 1000;
      leaveBy = new Date(leaveByMs).toLocaleTimeString('en-CA', timeOpts);
      leaveByLabel = `Leave by ${leaveBy}`;
    } else {
      // No time specified — leave now, show arrival time
      leaveByMs = now;
      const arriveAt = new Date(now + durationMinutes * 60 * 1000);
      leaveBy = `now → arrive ${arriveAt.toLocaleTimeString('en-CA', timeOpts)}`;
      leaveByLabel = `Arrive by ${arriveAt.toLocaleTimeString('en-CA', timeOpts)}`;
    }

    const summary = `🚗 ${durationMinutes} min — ${leaveByLabel}`;

    return { durationMinutes, distanceKm, leaveBy, leaveByMs, leaveByLabel, summary };
  } catch {
    return null;
  }
}
